import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionResult } from './actionSchema';
import type { DurableEventFacts } from './durableContracts';
import { versionDurableEventFacts } from './durableContracts';
import { appendWorldEvent } from './events';
import {
  NEGOTIATION_TTL_MS,
  validateEventCompensationSettlement,
  inventoryAvailable,
  negotiationTermsMatchUtterance,
  orderedNegotiationActors,
  parseNegotiationTerms,
  validateRequestDeadlineSettlement,
  validateNegotiationResponse,
} from './negotiationLogic';
import type {
  HerbTradeTerms,
  NegotiationOperation,
  NegotiationTerms,
} from './negotiationContracts';
import {
  commitConversationExpiration,
  prepareConversationTurn,
  type PreparedConversationTurn,
} from './conversations';
import { readGameHour } from './config';
import { nextRequestRevision } from './questLogic';

type NegotiationTurnInput = {
  turnId: string;
  expectedTurnNumber: number;
  utteranceText: string;
  referencedFactIds: string[];
  referencedBeliefIds: string[];
};

export type NegotiationCommitPlan = {
  operation: NegotiationOperation;
  negotiationId: string;
  proposalId: string;
  parentProposalId?: string;
  conversationId: string;
  revision: number;
  terms: NegotiationTerms;
  actorAId: string;
  actorBId: string;
  proposerActorId: string;
  recipientActorId: string;
  mapId: string;
  locationId: string;
  expiresAt: number;
  session?: Doc<'negotiationSessions'>;
  proposal?: Doc<'negotiationProposals'>;
  requestDeadlineSettlement?: {
    request: Doc<'requests'>;
    nextExpiresAt: number;
  };
  eventCompensationSettlement?: {
    encounter: Doc<'combatEncounters'>;
  };
};

export type PreparedNegotiationAction = {
  result: ActionResult;
  facts?: DurableEventFacts;
  plan?: NegotiationCommitPlan;
  invalidationPlan?: NegotiationInvalidationPlan;
  conversationTurn?: PreparedConversationTurn;
};

export type NegotiationInvalidationPlan = {
  session: Doc<'negotiationSessions'>;
  proposal: Doc<'negotiationProposals'>;
  reasonCode: string;
  reason: string;
  facts: DurableEventFacts;
};

export async function prepareNegotiationAction(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    actor: Doc<'xianxiaProfiles'>;
    target: Doc<'xianxiaProfiles'>;
    operation: NegotiationOperation | null;
    conversationId?: string;
    negotiationId?: string;
    expectedRevision?: number;
    termsInput?: unknown;
    turn?: NegotiationTurnInput;
    now: number;
  },
): Promise<PreparedNegotiationAction> {
  if (!args.operation) return { result: rejected('negotiation_operation_invalid', '需要有效的议价操作。') };
  const conversation = args.conversationId
    ? await ctx.db
        .query('conversationSessions')
        .withIndex('byConversation', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', args.conversationId!),
        )
        .first()
    : null;
  if (conversation?.status === 'active' && conversation.expiresAt <= args.now) {
    await commitConversationExpiration(ctx, conversation, args.now);
  }
  if (
    !conversation ||
    conversation.status !== 'active' ||
    conversation.expiresAt <= args.now
  ) {
    return await rejectedWithInvalidation(ctx, args, 'negotiation_conversation_inactive', '议价必须依附于进行中的双人会话。');
  }
  const participants = new Set([conversation.actorAId, conversation.actorBId]);
  if (
    participants.size !== 2 ||
    !participants.has(args.actor.actorId) ||
    !participants.has(args.target.actorId)
  ) {
    return { result: rejected('negotiation_participant_mismatch', '议价双方必须与会话参与者完全一致。') };
  }
  if (
    conversation.mapId !== (args.actor.mapId ?? 'world') ||
    conversation.locationId !== args.actor.currentLocationId
  ) {
    return await rejectedWithInvalidation(ctx, args, 'negotiation_location_changed', '双方已经离开议价发生地点。');
  }

  if (args.operation === 'open') {
    let active = await activeNegotiationForConversation(ctx, args.worldId, conversation.conversationId);
    if (active && active.expiresAt <= args.now) {
      const staleProposal = await ctx.db
        .query('negotiationProposals')
        .withIndex('byProposal', (q) =>
          q.eq('worldId', args.worldId).eq('proposalId', active!.currentProposalId),
        )
        .first();
      if (staleProposal?.status === 'active') {
        await commitNegotiationExpiration(ctx, active, staleProposal, args.now);
      }
      active = null;
    }
    if (active) {
      return { result: rejected('negotiation_already_active', '这段会话已有一轮进行中的议价。') };
    }
    const parsed = parseNegotiationTerms(args.termsInput, [conversation.actorAId, conversation.actorBId]);
    if (!parsed.ok) return { result: rejected(parsed.reasonCode, parsed.reason) };
    if (
      parsed.terms.kind === 'request_deadline' &&
      (args.actor.actorId !== parsed.terms.assigneeActorId ||
        args.target.actorId !== parsed.terms.issuerActorId)
    ) {
      return {
        result: rejected(
          'negotiation_request_open_role_invalid',
          '只有受托人可以向原委托发起者提出延期。',
        ),
      };
    }
    if (
      parsed.terms.kind === 'event_compensation' &&
      (args.actor.actorId !== parsed.terms.payeeActorId ||
        args.target.actorId !== parsed.terms.payerActorId)
    ) {
      return {
        result: rejected(
          'negotiation_compensation_open_role_invalid',
          '只有原冲突中的受害者可以向责任方提出赔偿。',
        ),
      };
    }
    if (!args.turn) return { result: rejected('negotiation_turn_required', '提出报价必须同时提交一轮真实发言。') };
    if (!negotiationTermsMatchUtterance(args.turn.utteranceText, parsed.terms)) {
      return { result: rejected('negotiation_utterance_terms_mismatch', '发言中的明确数量与结构化报价不一致。') };
    }
    const outcome = await validateNegotiationOutcome(ctx, args.worldId, parsed.terms, args.now);
    if (!outcome.ok) return { result: rejected(outcome.reasonCode, outcome.reason) };
    const proposalId = `proposal:${String(args.actionRecordId)}`;
    const negotiationId = `negotiation:${String(args.actionRecordId)}`;
    const turn = await prepareNegotiationTurn(ctx, args, conversation, args.turn, proposalId, 'request');
    if (!turn.ok) return { result: turn.result };
    const pair = orderedNegotiationActors(args.actor.actorId, args.target.actorId);
    const plan: NegotiationCommitPlan = {
      operation: 'open',
      negotiationId,
      proposalId,
      conversationId: conversation.conversationId,
      revision: 1,
      terms: parsed.terms,
      ...pair,
      proposerActorId: args.actor.actorId,
      recipientActorId: args.target.actorId,
      mapId: conversation.mapId,
      locationId: conversation.locationId,
      expiresAt: args.now + NEGOTIATION_TTL_MS,
    };
    return prepared(plan, turn.prepared);
  }

  if (!args.negotiationId || args.expectedRevision === undefined) {
    return { result: rejected('negotiation_reference_required', '回应议价需要 negotiationId 与 expectedRevision。') };
  }
  const session = await ctx.db
    .query('negotiationSessions')
    .withIndex('byNegotiation', (q) =>
      q.eq('worldId', args.worldId).eq('negotiationId', args.negotiationId!),
    )
    .first();
  if (!session || session.conversationId !== conversation.conversationId) {
    return { result: rejected('negotiation_not_found', '未找到这轮议价。') };
  }
  const proposal = await ctx.db
    .query('negotiationProposals')
    .withIndex('byProposal', (q) =>
      q.eq('worldId', args.worldId).eq('proposalId', session.currentProposalId),
    )
    .first();
  if (!proposal) return { result: rejected('negotiation_proposal_not_found', '当前报价不存在。') };
  const validation = validateNegotiationResponse(session, proposal, {
    actorId: args.actor.actorId,
    operation: args.operation,
    revision: args.expectedRevision,
    now: args.now,
  });
  if (!validation.ok) {
    if (validation.reasonCode === 'negotiation_expired') {
      await commitNegotiationExpiration(ctx, session, proposal, args.now);
    }
    return {
      result: rejected(validation.reasonCode, validation.reason),
      facts: negotiationAttemptFacts(
        session,
        proposal,
        args.operation,
        validation.reasonCode,
      ),
    };
  }
  const currentTerms = termsFromProposal(proposal);
  let requestDeadlineSettlement: NegotiationCommitPlan['requestDeadlineSettlement'];
  let eventCompensationSettlement: NegotiationCommitPlan['eventCompensationSettlement'];
  if (args.operation === 'counter' || args.operation === 'accept') {
    const currentOutcome = await validateNegotiationOutcome(
      ctx,
      args.worldId,
      currentTerms,
      args.now,
    );
    if (!currentOutcome.ok) {
      const invalidationPlan = invalidationPlanFor(
        session,
        proposal,
        currentOutcome.reasonCode,
        currentOutcome.reason,
      );
      return {
        result: invalidated(currentOutcome.reasonCode, currentOutcome.reason),
        facts: invalidationPlan.facts,
        invalidationPlan,
      };
    }
    if (args.operation === 'accept') {
      requestDeadlineSettlement = currentOutcome.requestDeadlineSettlement;
      eventCompensationSettlement = currentOutcome.eventCompensationSettlement;
    }
  }
  let terms = currentTerms;
  let proposalId = proposal.proposalId;
  let parentProposalId: string | undefined;
  let proposerActorId = proposal.proposerActorId;
  let recipientActorId = proposal.recipientActorId;
  let revision = session.revision;
  if (args.operation === 'counter') {
    const parsed = parseNegotiationTerms(args.termsInput, [session.actorAId, session.actorBId]);
    if (!parsed.ok) return { result: rejected(parsed.reasonCode, parsed.reason) };
    if (!sameNegotiationSubject(currentTerms, parsed.terms)) {
      return {
        result: rejected(
          'negotiation_subject_changed',
          '反提议只能调整当前事项的数值，不能更换交易或委托对象。',
        ),
      };
    }
    terms = parsed.terms;
    proposalId = `proposal:${String(args.actionRecordId)}`;
    parentProposalId = proposal.proposalId;
    proposerActorId = args.actor.actorId;
    recipientActorId = args.target.actorId;
    revision += 1;
  }
  if (args.operation === 'counter') {
    const outcome = await validateNegotiationOutcome(ctx, args.worldId, terms, args.now);
    if (!outcome.ok) return { result: rejected(outcome.reasonCode, outcome.reason) };
  }
  let conversationTurn: PreparedConversationTurn | undefined;
  if (args.operation !== 'withdraw') {
    if (!args.turn) return { result: rejected('negotiation_turn_required', '回应报价必须同时提交一轮真实发言。') };
    if (!negotiationTermsMatchUtterance(args.turn.utteranceText, terms)) {
      return { result: rejected('negotiation_utterance_terms_mismatch', '发言中的明确数量与结构化报价不一致。') };
    }
    const speechAct = args.operation === 'reject' ? 'refuse' : args.operation === 'counter' ? 'request' : 'respond';
    const turn = await prepareNegotiationTurn(ctx, args, conversation, args.turn, proposalId, speechAct);
    if (!turn.ok) return { result: turn.result };
    conversationTurn = turn.prepared;
  }
  const plan: NegotiationCommitPlan = {
    operation: args.operation,
    negotiationId: session.negotiationId,
    proposalId,
    parentProposalId,
    conversationId: session.conversationId,
    revision,
    terms,
    actorAId: session.actorAId,
    actorBId: session.actorBId,
    proposerActorId,
    recipientActorId,
    mapId: session.mapId,
    locationId: session.locationId,
    expiresAt: args.now + NEGOTIATION_TTL_MS,
    session,
    proposal,
    requestDeadlineSettlement,
    eventCompensationSettlement,
  };
  return prepared(plan, conversationTurn);
}

export async function commitNegotiationPlan(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    eventId: Id<'worldEvents'>;
    plan: NegotiationCommitPlan;
    now: number;
  },
) {
  const p = args.plan;
  if (p.operation === 'open') {
    await ctx.db.insert('negotiationSessions', {
      worldId: args.worldId,
      negotiationId: p.negotiationId,
      conversationId: p.conversationId,
      kind: p.terms.kind,
      status: 'opened',
      actorAId: p.actorAId,
      actorBId: p.actorBId,
      openedByActorId: p.proposerActorId,
      currentProposalId: p.proposalId,
      currentResponderActorId: p.recipientActorId,
      revision: 1,
      mapId: p.mapId,
      locationId: p.locationId,
      openedByActionId: args.actionRecordId,
      openedAt: args.now,
      expiresAt: p.expiresAt,
      updatedAt: args.now,
    });
    await insertProposal(ctx, args, p);
    await ctx.scheduler.runAt(p.expiresAt, internal.xianxia.negotiations.expireNegotiation, {
      worldId: args.worldId,
      negotiationId: p.negotiationId,
      revision: p.revision,
    });
    return;
  }
  if (!p.session || !p.proposal) throw new Error('negotiation_commit_invariant: existing state required');
  if (p.operation === 'counter') {
    await ctx.db.patch(p.proposal._id, {
      status: 'superseded',
      terminalActionId: args.actionRecordId,
      terminalEventId: args.eventId,
      terminalAt: args.now,
      terminalReasonCode: 'negotiation_countered',
    });
    await insertProposal(ctx, args, p);
    await ctx.db.patch(p.session._id, {
      status: 'active',
      currentProposalId: p.proposalId,
      currentResponderActorId: p.recipientActorId,
      revision: p.revision,
      expiresAt: p.expiresAt,
      updatedAt: args.now,
    });
    await ctx.scheduler.runAt(p.expiresAt, internal.xianxia.negotiations.expireNegotiation, {
      worldId: args.worldId,
      negotiationId: p.negotiationId,
      revision: p.revision,
    });
    return;
  }
  const terminal = p.operation === 'accept' ? 'settled' : p.operation === 'reject' ? 'rejected' : 'withdrawn';
  const proposalStatus = p.operation === 'accept' ? 'accepted' : p.operation === 'reject' ? 'rejected' : 'withdrawn';
  if (
    p.operation === 'accept' &&
    p.terms.kind === 'request_deadline' &&
    p.requestDeadlineSettlement
  ) {
    const { request, nextExpiresAt } = p.requestDeadlineSettlement;
    await ctx.db.patch(request._id, {
      expiresAt: nextExpiresAt,
      originalExpiresAt: request.originalExpiresAt ?? request.expiresAt,
      deadlineExtensionCount: 1,
      deadlineExtendedAt: args.now,
      deadlineExtensionHours: p.terms.extensionGameHours,
      deadlineNegotiationId: p.negotiationId,
      revision: nextRequestRevision(request),
      lastTransitionActionId: args.actionRecordId,
      lastTransitionEventId: args.eventId,
      lastTransitionAt: args.now,
    });
  }
  if (
    p.operation === 'accept' &&
    p.terms.kind === 'event_compensation' &&
    p.eventCompensationSettlement
  ) {
    await ctx.db.patch(p.eventCompensationSettlement.encounter._id, {
      compensationNegotiationId: p.negotiationId,
      compensationActionId: args.actionRecordId,
      compensationEventId: args.eventId,
      compensationSpiritStones: p.terms.paymentQty,
      compensatedAt: args.now,
    });
  }
  await ctx.db.patch(p.proposal._id, {
    status: proposalStatus,
    terminalActionId: args.actionRecordId,
    terminalEventId: args.eventId,
    terminalAt: args.now,
    terminalReasonCode: resultCodeFor(p.operation),
  });
  await ctx.db.patch(p.session._id, {
    status: terminal,
    currentResponderActorId: undefined,
    settlementActionId: p.operation === 'accept' ? args.actionRecordId : undefined,
    settlementEventId: p.operation === 'accept' ? args.eventId : undefined,
    terminalActionId: args.actionRecordId,
    terminalEventId: args.eventId,
    terminalAt: args.now,
    terminalReasonCode: resultCodeFor(p.operation),
    updatedAt: args.now,
  });
}

export async function prepareNegotiationInvalidation(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    negotiationId?: string;
    actorId: string;
    reasonCode: string;
    reason: string;
  },
): Promise<NegotiationInvalidationPlan | undefined> {
  if (!args.negotiationId) return undefined;
  const session = await ctx.db
    .query('negotiationSessions')
    .withIndex('byNegotiation', (q) =>
      q.eq('worldId', args.worldId).eq('negotiationId', args.negotiationId!),
    )
    .first();
  if (
    !session ||
    !['opened', 'active'].includes(session.status) ||
    (session.actorAId !== args.actorId && session.actorBId !== args.actorId)
  ) {
    return undefined;
  }
  const proposal = await ctx.db
    .query('negotiationProposals')
    .withIndex('byProposal', (q) =>
      q.eq('worldId', args.worldId).eq('proposalId', session.currentProposalId),
    )
    .first();
  if (!proposal || proposal.status !== 'active') return undefined;
  return invalidationPlanFor(session, proposal, args.reasonCode, args.reason);
}

export async function commitNegotiationInvalidation(
  ctx: MutationCtx,
  args: {
    plan: NegotiationInvalidationPlan;
    actionRecordId: Id<'actionRecords'>;
    eventId: Id<'worldEvents'>;
    now: number;
  },
) {
  const { session, proposal } = args.plan;
  if (
    !['opened', 'active'].includes(session.status) ||
    proposal.status !== 'active' ||
    session.currentProposalId !== proposal.proposalId ||
    session.revision !== proposal.revision
  ) {
    return false;
  }
  await ctx.db.patch(proposal._id, {
    status: 'rejected',
    terminalActionId: args.actionRecordId,
    terminalEventId: args.eventId,
    terminalAt: args.now,
    terminalReasonCode: args.plan.reasonCode,
  });
  await ctx.db.patch(session._id, {
    status: 'rejected',
    currentResponderActorId: undefined,
    terminalActionId: args.actionRecordId,
    terminalEventId: args.eventId,
    terminalAt: args.now,
    terminalReasonCode: args.plan.reasonCode,
    updatedAt: args.now,
  });
  return true;
}

export const expireNegotiation = internalMutation({
  args: { worldId: v.id('worlds'), negotiationId: v.string(), revision: v.number() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('negotiationSessions')
      .withIndex('byNegotiation', (q) =>
        q.eq('worldId', args.worldId).eq('negotiationId', args.negotiationId),
      )
      .first();
    if (!session || !['opened', 'active'].includes(session.status) || session.revision !== args.revision || session.expiresAt > Date.now()) {
      return { expired: false };
    }
    const proposal = await ctx.db
      .query('negotiationProposals')
      .withIndex('byProposal', (q) =>
        q.eq('worldId', args.worldId).eq('proposalId', session.currentProposalId),
      )
      .first();
    if (!proposal || proposal.status !== 'active') return { expired: false };
    await commitNegotiationExpiration(ctx, session, proposal, Date.now());
    return { expired: true };
  },
});

async function prepareNegotiationTurn(
  ctx: MutationCtx,
  args: Parameters<typeof prepareNegotiationAction>[1],
  conversation: Doc<'conversationSessions'>,
  turn: NegotiationTurnInput,
  proposalId: string,
  speechAct: 'request' | 'respond' | 'refuse',
) {
  return await prepareConversationTurn(ctx, {
    worldId: args.worldId,
    actorId: args.actor.actorId,
    targetActorId: args.target.actorId,
    conversationId: conversation.conversationId,
    turnId: turn.turnId,
    expectedTurnNumber: turn.expectedTurnNumber,
    speechAct,
    utteranceText: turn.utteranceText,
    addressedActorIds: [args.target.actorId],
    referencedFactIds: turn.referencedFactIds,
    referencedBeliefIds: turn.referencedBeliefIds,
    proposalId,
    now: args.now,
    actorMapId: args.actor.mapId ?? 'world',
    actorLocationId: args.actor.currentLocationId,
    actorHealth: args.actor.health,
  });
}

function prepared(plan: NegotiationCommitPlan, conversationTurn?: PreparedConversationTurn): PreparedNegotiationAction {
  const resultCode = resultCodeFor(plan.operation);
  const terminal = plan.operation === 'accept' ? 'settled' : plan.operation === 'reject' ? 'rejected' : plan.operation === 'withdraw' ? 'withdrawn' : plan.operation === 'open' ? 'opened' : 'active';
  const proposalStatus = plan.operation === 'counter' ? 'active' : plan.operation === 'accept' ? 'accepted' : plan.operation === 'reject' ? 'rejected' : plan.operation === 'withdraw' ? 'withdrawn' : 'active';
  const result: ActionResult = {
    status: 'applied',
    resultCode,
    reason: summaryFor(plan),
    effects:
      plan.operation === 'accept' && plan.terms.kind === 'herb_trade'
        ? {
            items: [
              { from: plan.terms.sellerActorId, to: plan.terms.buyerActorId, itemId: 'spirit_herb', qty: plan.terms.itemQty },
              { from: plan.terms.buyerActorId, to: plan.terms.sellerActorId, itemId: 'spirit_stone', qty: plan.terms.paymentQty },
            ],
          }
        : plan.operation === 'accept' && plan.terms.kind === 'event_compensation'
          ? {
              items: [
                {
                  from: plan.terms.payerActorId,
                  to: plan.terms.payeeActorId,
                  itemId: 'spirit_stone',
                  qty: plan.terms.paymentQty,
                },
              ],
            }
        : {},
    eventType: plan.operation === 'accept' ? 'negotiation_settled' : `negotiation_${plan.operation}`,
    visibility: 'private',
  };
  return {
    result,
    facts: factsFor(plan, resultCode, terminal, proposalStatus),
    plan,
    conversationTurn,
  };
}

function factsFor(
  plan: NegotiationCommitPlan,
  resultCode: string,
  negotiationStatus: string,
  proposalStatus: string,
  operation = plan.operation as string,
): DurableEventFacts {
  return versionDurableEventFacts({
    resultCode,
    negotiationId: plan.negotiationId,
    conversationId: plan.conversationId,
    proposalId: plan.proposalId,
    revision: plan.revision,
    operation,
    negotiationStatus,
    proposalStatus,
    ...plan.terms,
    requestExpiresAtAfter:
      plan.operation === 'accept' && plan.terms.kind === 'request_deadline'
        ? plan.requestDeadlineSettlement?.nextExpiresAt
        : undefined,
    parentProposalId: plan.parentProposalId,
  });
}

async function insertProposal(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actionRecordId: Id<'actionRecords'>; eventId: Id<'worldEvents'>; now: number },
  plan: NegotiationCommitPlan,
) {
  await ctx.db.insert('negotiationProposals', {
    worldId: args.worldId,
    proposalId: plan.proposalId,
    negotiationId: plan.negotiationId,
    conversationId: plan.conversationId,
    revision: plan.revision,
    status: 'active',
    proposerActorId: plan.proposerActorId,
    recipientActorId: plan.recipientActorId,
    parentProposalId: plan.parentProposalId,
    ...plan.terms,
    actionRecordId: args.actionRecordId,
    sourceEventId: args.eventId,
    createdAt: args.now,
  });
}

async function activeNegotiationForConversation(ctx: MutationCtx, worldId: Id<'worlds'>, conversationId: string) {
  for (const status of ['opened', 'active'] as const) {
    const session = await ctx.db
      .query('negotiationSessions')
      .withIndex('byConversationStatus', (q) =>
        q.eq('worldId', worldId).eq('conversationId', conversationId).eq('status', status),
      )
      .first();
    if (session) return session;
  }
  return null;
}

async function validateTradeResources(ctx: MutationCtx, worldId: Id<'worlds'>, terms: HerbTradeTerms, now: number) {
  const seller = await profile(ctx, worldId, terms.sellerActorId);
  const buyer = await profile(ctx, worldId, terms.buyerActorId);
  if (!seller || !buyer) return { ok: false as const, reasonCode: 'negotiation_participant_unavailable', reason: '买卖一方已经不可用。' };
  const sellerReserved = await activeInventoryReservation(ctx, worldId, terms.sellerActorId, 'spirit_herb', now);
  if (!inventoryAvailable(seller.inventory ?? [], 'spirit_herb', terms.itemQty, sellerReserved)) {
    return { ok: false as const, reasonCode: 'negotiation_seller_inventory_unavailable', reason: '卖方没有足够的未预约灵草。' };
  }
  const buyerReserved = await activeInventoryReservation(ctx, worldId, terms.buyerActorId, 'spirit_stone', now);
  if (!inventoryAvailable(buyer.inventory ?? [], 'spirit_stone', terms.paymentQty, buyerReserved)) {
    return { ok: false as const, reasonCode: 'negotiation_buyer_payment_unavailable', reason: '买方没有足够的未预约灵石。' };
  }
  return { ok: true as const };
}

async function validateNegotiationOutcome(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  terms: NegotiationTerms,
  now: number,
): Promise<
  | {
      ok: true;
      requestDeadlineSettlement?: {
        request: Doc<'requests'>;
        nextExpiresAt: number;
      };
      eventCompensationSettlement?: {
        encounter: Doc<'combatEncounters'>;
      };
    }
  | { ok: false; reasonCode: string; reason: string }
> {
  if (terms.kind === 'herb_trade') {
    return await validateTradeResources(ctx, worldId, terms, now);
  }
  if (terms.kind === 'event_compensation') {
    const eventId = ctx.db.normalizeId('worldEvents', terms.harmEventId);
    const harmEvent = eventId ? await ctx.db.get(eventId) : null;
    const encounter = await ctx.db
      .query('combatEncounters')
      .withIndex('byEncounter', (q) =>
        q.eq('worldId', worldId).eq('encounterId', terms.encounterId),
      )
      .first();
    if (!harmEvent || harmEvent.worldId !== worldId || !encounter) {
      return {
        ok: false,
        reasonCode: 'negotiation_compensation_event_not_found',
        reason: '找不到赔偿条款引用的冲突事件或遭遇。',
      };
    }
    const payer = await profile(ctx, worldId, terms.payerActorId);
    const payee = await profile(ctx, worldId, terms.payeeActorId);
    if (!payer || !payee) {
      return {
        ok: false,
        reasonCode: 'negotiation_participant_unavailable',
        reason: '赔偿的一方已经不可用。',
      };
    }
    const reserved = await activeInventoryReservation(
      ctx,
      worldId,
      terms.payerActorId,
      'spirit_stone',
      now,
    );
    const facts = (harmEvent.facts ?? {}) as Record<string, unknown>;
    const nowGameHour = await readGameHour(ctx, worldId, now);
    const eventGameHour = await readGameHour(ctx, worldId, harmEvent.createdAt);
    const validation = validateEventCompensationSettlement(
      terms,
      {
        harmEventId: String(harmEvent._id),
        encounterId: encounter.encounterId,
        attackerActorId: encounter.attackerActorId,
        defenderActorId: encounter.defenderActorId,
        encounterStatus: encounter.status,
        winnerActorId: encounter.winnerActorId,
        defeatedActorId: encounter.defeatedActorId,
        terminalEventId: encounter.terminalEventId
          ? String(encounter.terminalEventId)
          : undefined,
        compensationNegotiationId: encounter.compensationNegotiationId,
        eventType: harmEvent.type,
        eventActorIds: harmEvent.actorIds,
        eventTargetActorIds: harmEvent.targetActorIds ?? [],
        eventEncounterId:
          typeof facts.encounterId === 'string' ? facts.encounterId : undefined,
        eventTargetActorId:
          typeof facts.targetActorId === 'string' ? facts.targetActorId : undefined,
        eventDamage: typeof facts.damage === 'number' ? facts.damage : undefined,
        eventDefeated: facts.defeated === true,
        eventGameHour,
        payerAvailableSpiritStones: Math.max(
          0,
          ((payer.inventory ?? []).find((item) => item.itemId === 'spirit_stone')?.qty ?? 0) -
            reserved,
        ),
      },
      nowGameHour,
    );
    if (!validation.ok) return validation;
    return { ok: true, eventCompensationSettlement: { encounter } };
  }
  const request = await ctx.db.get(terms.requestId as Id<'requests'>);
  if (!request || request.worldId !== worldId) {
    return {
      ok: false,
      reasonCode: 'negotiation_request_not_found',
      reason: '找不到延期条款引用的委托。',
    };
  }
  const nowGameHour = await readGameHour(ctx, worldId, now);
  const validation = validateRequestDeadlineSettlement(terms, request, nowGameHour);
  if (!validation.ok) return validation;
  return {
    ok: true,
    requestDeadlineSettlement: { request, nextExpiresAt: validation.nextExpiresAt },
  };
}

async function activeInventoryReservation(ctx: MutationCtx, worldId: Id<'worlds'>, actorId: string, itemId: string, now: number) {
  let reserved = 0;
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const own = await ctx.db.query('actionExecutions').withIndex('byActorStatus', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId).eq('status', status),
    ).collect();
    const targeted = await ctx.db.query('actionExecutions').withIndex('byTargetStatus', (q) =>
      q.eq('worldId', worldId).eq('targetActorId', actorId).eq('status', status),
    ).collect();
    for (const execution of own) {
      if (execution.expiresAt > now && execution.hardDeadlineAt > now && execution.reservedItemId === itemId) reserved += execution.reservedItemQuantity ?? 0;
    }
    for (const execution of targeted) {
      if (execution.expiresAt > now && execution.hardDeadlineAt > now && execution.reservedTargetItemId === itemId) reserved += execution.reservedTargetItemQuantity ?? 0;
    }
  }
  return reserved;
}

async function profile(ctx: MutationCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
    q.eq('worldId', worldId).eq('actorId', actorId),
  ).first();
}

async function commitNegotiationExpiration(ctx: MutationCtx, session: Doc<'negotiationSessions'>, proposal: Doc<'negotiationProposals'>, now: number) {
  const terms = termsFromProposal(proposal);
  const terminalEventId = await appendWorldEvent(ctx, {
    worldId: session.worldId,
    type: 'negotiation_expired',
    createdAt: now,
    actorIds: [session.actorAId, session.actorBId],
    locationId: session.locationId,
    actionId: session.openedByActionId,
    visibility: 'private',
    summary: '双方未在时限内回应，议价已经失效。',
    facts: factsFor({
      operation: 'withdraw', negotiationId: session.negotiationId, proposalId: proposal.proposalId,
      conversationId: session.conversationId, revision: session.revision, terms,
      actorAId: session.actorAId, actorBId: session.actorBId, proposerActorId: proposal.proposerActorId,
      recipientActorId: proposal.recipientActorId, mapId: session.mapId, locationId: session.locationId,
      expiresAt: session.expiresAt,
    }, 'negotiation_expired', 'expired', 'expired', 'expire'),
    mapId: session.mapId,
  });
  await ctx.db.patch(proposal._id, {
    status: 'expired',
    terminalEventId,
    terminalAt: now,
    terminalReasonCode: 'negotiation_expired',
  });
  await ctx.db.patch(session._id, {
    status: 'expired',
    currentResponderActorId: undefined,
    terminalEventId,
    terminalAt: now,
    terminalReasonCode: 'negotiation_expired',
    updatedAt: now,
  });
}

function invalidationPlanFor(
  session: Doc<'negotiationSessions'>,
  proposal: Doc<'negotiationProposals'>,
  reasonCode: string,
  reason: string,
): NegotiationInvalidationPlan {
  const terms = termsFromProposal(proposal);
  return {
    session,
    proposal,
    reasonCode,
    reason,
    facts: versionDurableEventFacts({
      resultCode: reasonCode,
      negotiationId: session.negotiationId,
      conversationId: session.conversationId,
      proposalId: proposal.proposalId,
      revision: session.revision,
      operation: 'invalidate',
      negotiationStatus: 'rejected',
      proposalStatus: 'rejected',
      ...terms,
    }),
  };
}

function negotiationAttemptFacts(
  session: Doc<'negotiationSessions'>,
  proposal: Doc<'negotiationProposals'>,
  operation: NegotiationOperation,
  resultCode: string,
) {
  return versionDurableEventFacts({
    resultCode,
    negotiationId: session.negotiationId,
    conversationId: session.conversationId,
    proposalId: proposal.proposalId,
    revision: session.revision,
    operation,
    negotiationStatus: session.status,
    proposalStatus: proposal.status,
    ...termsFromProposal(proposal),
  });
}

async function rejectedWithInvalidation(
  ctx: MutationCtx,
  args: Parameters<typeof prepareNegotiationAction>[1],
  reasonCode: string,
  reason: string,
): Promise<PreparedNegotiationAction> {
  const invalidationPlan =
    args.operation && args.operation !== 'open'
      ? await prepareNegotiationInvalidation(ctx, {
          worldId: args.worldId,
          negotiationId: args.negotiationId,
          actorId: args.actor.actorId,
          reasonCode,
          reason,
        })
      : undefined;
  return invalidationPlan
    ? {
        result: invalidated(reasonCode, reason),
        facts: invalidationPlan.facts,
        invalidationPlan,
      }
    : { result: rejected(reasonCode, reason) };
}

export function termsFromProposal(proposal: Doc<'negotiationProposals'>): NegotiationTerms {
  if (proposal.kind === 'event_compensation') {
    if (
      !proposal.harmEventId ||
      !proposal.encounterId ||
      !proposal.payerActorId ||
      !proposal.payeeActorId ||
      proposal.harmDamage === undefined ||
      proposal.paymentQty === undefined
    ) {
      throw new Error(`negotiation_proposal_invariant: incomplete event compensation terms ${proposal.proposalId}`);
    }
    return {
      kind: 'event_compensation',
      harmEventId: proposal.harmEventId,
      encounterId: proposal.encounterId,
      payerActorId: proposal.payerActorId,
      payeeActorId: proposal.payeeActorId,
      harmDamage: proposal.harmDamage,
      paymentItemId: 'spirit_stone',
      paymentQty: proposal.paymentQty,
    };
  }
  if (proposal.kind === 'request_deadline') {
    if (
      !proposal.requestId ||
      !proposal.issuerActorId ||
      !proposal.assigneeActorId ||
      proposal.baseExpiresAtGameHour === undefined ||
      proposal.extensionGameHours === undefined
    ) {
      throw new Error(`negotiation_proposal_invariant: incomplete request deadline terms ${proposal.proposalId}`);
    }
    return {
      kind: 'request_deadline',
      requestId: proposal.requestId,
      issuerActorId: proposal.issuerActorId,
      assigneeActorId: proposal.assigneeActorId,
      baseExpiresAtGameHour: proposal.baseExpiresAtGameHour,
      extensionGameHours: proposal.extensionGameHours,
    };
  }
  if (
    !proposal.sellerActorId ||
    !proposal.buyerActorId ||
    proposal.itemQty === undefined ||
    proposal.paymentQty === undefined
  ) {
    throw new Error(`negotiation_proposal_invariant: incomplete herb trade terms ${proposal.proposalId}`);
  }
  return {
    kind: 'herb_trade',
    sellerActorId: proposal.sellerActorId,
    buyerActorId: proposal.buyerActorId,
    itemId: 'spirit_herb',
    itemQty: proposal.itemQty,
    paymentItemId: 'spirit_stone',
    paymentQty: proposal.paymentQty,
  };
}

function sameNegotiationSubject(current: NegotiationTerms, next: NegotiationTerms) {
  if (current.kind !== next.kind) return false;
  if (current.kind === 'herb_trade' && next.kind === 'herb_trade') {
    return (
      current.sellerActorId === next.sellerActorId &&
      current.buyerActorId === next.buyerActorId &&
      current.itemId === next.itemId &&
      current.itemQty === next.itemQty &&
      current.paymentItemId === next.paymentItemId
    );
  }
  if (current.kind === 'request_deadline' && next.kind === 'request_deadline') {
    return (
      current.requestId === next.requestId &&
      current.issuerActorId === next.issuerActorId &&
      current.assigneeActorId === next.assigneeActorId &&
      current.baseExpiresAtGameHour === next.baseExpiresAtGameHour
    );
  }
  if (current.kind === 'event_compensation' && next.kind === 'event_compensation') {
    return (
      current.harmEventId === next.harmEventId &&
      current.encounterId === next.encounterId &&
      current.payerActorId === next.payerActorId &&
      current.payeeActorId === next.payeeActorId &&
      current.harmDamage === next.harmDamage &&
      current.paymentItemId === next.paymentItemId
    );
  }
  return false;
}

function resultCodeFor(operation: NegotiationOperation) {
  return operation === 'open' ? 'negotiation_opened' : operation === 'counter' ? 'negotiation_countered' : operation === 'accept' ? 'negotiation_settled' : operation === 'reject' ? 'negotiation_rejected' : 'negotiation_withdrawn';
}

function summaryFor(plan: NegotiationCommitPlan) {
  const t = plan.terms;
  const offer =
    t.kind === 'herb_trade'
      ? `${t.itemQty}株灵草换${t.paymentQty}枚灵石`
      : t.kind === 'request_deadline'
        ? `将委托延期${t.extensionGameHours}个游戏小时`
        : `就冲突事件赔偿${t.paymentQty}枚灵石`;
  if (plan.operation === 'open') return `提出方案：${offer}。`;
  if (plan.operation === 'counter') return `提出反方案：${offer}。`;
  if (plan.operation === 'accept') {
    return t.kind === 'herb_trade'
      ? `双方接受报价并完成交换：${offer}。`
      : t.kind === 'request_deadline'
        ? `双方接受方案并更新委托期限：${offer}。`
        : `双方接受方案并完成冲突赔偿：${offer}。`;
  }
  if (plan.operation === 'reject') return `对方拒绝了方案：${offer}。`;
  return `提出者撤回了方案：${offer}。`;
}

function rejected(resultCode: string, reason: string): ActionResult {
  return { status: 'rejected', resultCode, reason, effects: {}, eventType: 'negotiation_rejected', visibility: 'private' };
}

function invalidated(resultCode: string, reason: string): ActionResult {
  return {
    status: 'rejected',
    resultCode,
    reason,
    effects: {},
    eventType: 'negotiation_invalidated',
    visibility: 'private',
  };
}
