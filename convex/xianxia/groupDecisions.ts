import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { ActionResult, ItemTransfer } from './actionSchema';
import type { DurableEventFacts } from './durableContracts';
import { versionDurableEventFacts } from './durableContracts';
import type { GroupVoteChoice } from './groupDecisionContracts';
import {
  GROUP_PROPOSAL_ITEM_ID,
  GROUP_PROPOSAL_ITEM_QTY,
  GROUP_PROPOSAL_KIND,
  GROUP_PROPOSAL_MAX_PER_SESSION,
  GROUP_PROPOSAL_TTL_MS,
  resolveGroupVote,
  chooseRelationshipVote,
  validateOwnedHerbProposal,
} from './groupDecisionLogic';
import { readGameHour } from './config';
import { relationshipDimsAt } from './relationshipLogic';

type Session = Doc<'groupConversationSessions'>;
type Proposal = Doc<'groupProposals'>;
type Commitment = Doc<'groupCommitments'>;

export type GroupProposalCommitPlan = {
  kind: 'proposal';
  proposalId: string;
  session: Session;
  proposerActorId: string;
  recipientActorId: string;
  quorum: number;
  expiresAt: number;
};

export type GroupVoteCommitPlan = {
  kind: 'vote';
  proposal: Proposal;
  voterActorId: string;
  choice: GroupVoteChoice;
  decisionBasis: string;
  relationshipBand: string;
  approvals: number;
  oppositions: number;
  abstentions: number;
  outcome: 'open' | 'committed' | 'rejected';
  commitmentId?: string;
};

export type GroupCommitmentCommitPlan =
  | { kind: 'execute'; proposal: Proposal; commitment: Commitment; observerActorIds: string[] }
  | { kind: 'breach'; proposal: Proposal; commitment: Commitment; observerActorIds: string[]; reasonCode: string }
  | { kind: 'expire_proposal'; proposal: Proposal };

export type GroupDecisionCommitPlan =
  | GroupProposalCommitPlan
  | GroupVoteCommitPlan
  | GroupCommitmentCommitPlan;

export async function prepareGroupProposal(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    actorId: string;
    groupConversationId: string;
    recipientActorId: string;
    now: number;
  },
): Promise<{ result: ActionResult; facts?: DurableEventFacts; plan?: GroupDecisionCommitPlan }> {
  const sessionCheck = await activeParticipantSession(ctx, args);
  if (!sessionCheck.ok) return { result: rejected(sessionCheck.reasonCode, sessionCheck.reason) };
  const session = sessionCheck.session;
  const open = await ctx.db
    .query('groupProposals')
    .withIndex('byGroupStatus', (q) =>
      q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId).eq('status', 'open'),
    )
    .first();
  if (open) return { result: rejected('group_proposal_already_open', '这场群议已有一项待表决提案。') };
  const prior = await ctx.db
    .query('groupProposals')
    .withIndex('byGroupStatus', (q) => q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId))
    .collect();
  if (prior.length >= GROUP_PROPOSAL_MAX_PER_SESSION) {
    return { result: rejected('group_proposal_limit', '这场群议的提案次数已达上限。') };
  }
  const donor = await loadProfile(ctx, args.worldId, args.actorId);
  const recipient = await loadProfile(ctx, args.worldId, args.recipientActorId);
  if (!donor || !recipient || !isPresentInSession(recipient, session) || recipient.health <= 0) {
    return { result: rejected('group_proposal_recipient_invalid', '受赠者不在现场或当前无法参与。') };
  }
  const availableHerbs = inventoryQuantity(donor, GROUP_PROPOSAL_ITEM_ID);
  const validation = validateOwnedHerbProposal({
    actorId: args.actorId,
    recipientActorId: args.recipientActorId,
    participantActorIds: session.participantActorIds,
    observerActorIds: session.observerActorIds,
    availableHerbs,
  });
  if (!validation.ok) return { result: rejected(validation.reasonCode, validation.reason) };
  const proposalId = `group_proposal:${String(args.actionRecordId)}`;
  const expiresAt = Math.min(session.expiresAt, args.now + GROUP_PROPOSAL_TTL_MS);
  const result = applied(
    'group_proposal_opened',
    `${donor.name}提议将自己的一株灵草交给${recipient.name}，请在场参与者表决。`,
    'group_proposal_opened',
  );
  return {
    result,
    plan: {
      kind: 'proposal', proposalId, session, proposerActorId: args.actorId,
      recipientActorId: args.recipientActorId, quorum: validation.quorum, expiresAt,
    },
    facts: decisionFacts({
      resultCode: result.resultCode, operation: 'propose', groupConversationId: args.groupConversationId,
      proposalId, proposalStatus: 'open', proposerActorId: args.actorId, donorActorId: args.actorId,
      recipientActorId: args.recipientActorId, quorum: validation.quorum,
    }),
  };
}

export async function prepareGroupVote(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    groupConversationId: string;
    proposalId: string;
    choice: GroupVoteChoice;
    source: 'human' | 'agent' | 'system';
    now: number;
  },
): Promise<{ result: ActionResult; facts?: DurableEventFacts; plan?: GroupDecisionCommitPlan }> {
  const proposal = await loadProposal(ctx, args.worldId, args.proposalId);
  if (!proposal || proposal.groupConversationId !== args.groupConversationId) {
    return { result: rejected('group_proposal_not_found', '未找到该群体提案。') };
  }
  if (proposal.status !== 'open') return { result: rejected('group_proposal_not_open', '该提案已经结束表决。') };
  if (proposal.expiresAt <= args.now) {
    return {
      result: rejected('group_proposal_expired', '该提案已经过期。'),
      plan: { kind: 'expire_proposal', proposal },
    };
  }
  const sessionCheck = await activeParticipantSession(ctx, args);
  if (!sessionCheck.ok) return { result: rejected(sessionCheck.reasonCode, sessionCheck.reason) };
  if (sessionCheck.session.revision !== proposal.sessionRevision) {
    return { result: rejected('group_proposal_not_open', '会话版本已变化，旧提案不能继续表决。') };
  }
  const priorVotes = await ctx.db
    .query('groupVotes')
    .withIndex('byProposal', (q) => q.eq('worldId', args.worldId).eq('proposalId', args.proposalId))
    .collect();
  let choice = args.choice;
  let decisionBasis = 'player_choice';
  let relationshipBand = 'player_choice';
  if (args.source === 'agent') {
    const [relationship, voter, nowGameHour] = await Promise.all([
      ctx.db.query('relationships').withIndex('pair', (q) =>
        q.eq('worldId', args.worldId).eq('fromActorId', args.actorId).eq('toActorId', proposal.recipientActorId),
      ).first(),
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      ).first(),
      readGameHour(ctx, args.worldId, args.now),
    ]);
    const effectiveRelationship = relationshipDimsAt(
      relationship
        ? {
            affinity: relationship.value,
            trust: relationship.trust,
            suspicion: relationship.suspicion,
            debt: relationship.debt,
            fear: relationship.fear,
          }
        : {},
      relationship?.lastTouchedDay,
      Math.floor(nowGameHour / 24),
      voter?.innerTrait ?? '',
      voter?.outerTrait ?? '',
      relationship?.dimensionTouchedDays,
    );
    const derived = chooseRelationshipVote({
      actorId: args.actorId,
      donorActorId: proposal.donorActorId,
      recipientActorId: proposal.recipientActorId,
      relationshipToRecipient: effectiveRelationship.affinity,
      trustToRecipient: effectiveRelationship.trust,
      suspicionToRecipient: effectiveRelationship.suspicion,
      debtToRecipient: effectiveRelationship.debt,
    });
    if (choice !== derived.choice) {
      return { result: rejected('group_vote_invalid', 'Agent 表决与服务端可见利益不一致。') };
    }
    choice = derived.choice;
    decisionBasis = derived.basis;
    relationshipBand = derived.relationshipBand;
  }
  const vote = resolveGroupVote({
    participantActorIds: proposal.participantActorIds,
    voterActorId: args.actorId,
    choice,
    priorVotes: priorVotes.map((row) => ({ actorId: row.actorId, choice: row.choice })),
  });
  if (!vote.ok) return { result: rejected(vote.reasonCode, vote.reason) };
  const commitmentId = vote.outcome === 'committed' ? `group_commitment:${proposal.proposalId}` : undefined;
  const resultCode = vote.outcome === 'committed'
    ? 'group_proposal_committed'
    : vote.outcome === 'rejected'
      ? 'group_proposal_rejected'
      : 'group_vote_recorded';
  const result = applied(resultCode, `已记录${args.actorId}的${voteChoiceLabel(choice)}票。`, 'group_vote_recorded');
  return {
    result,
    plan: {
      kind: 'vote', proposal, voterActorId: args.actorId, choice, decisionBasis, relationshipBand,
      approvals: vote.approvals, oppositions: vote.oppositions, abstentions: vote.abstentions,
      outcome: vote.outcome, commitmentId,
    },
    facts: decisionFacts({
      resultCode, operation: 'vote', groupConversationId: proposal.groupConversationId,
      proposalId: proposal.proposalId, proposalStatus: vote.outcome === 'open' ? 'open' : vote.outcome,
      proposerActorId: proposal.proposerActorId, donorActorId: proposal.donorActorId,
      recipientActorId: proposal.recipientActorId, quorum: proposal.quorum, voteChoice: choice,
      approvals: vote.approvals, oppositions: vote.oppositions, abstentions: vote.abstentions,
      commitmentId, decisionBasis, relationshipBand,
    }),
  };
}

export async function prepareGroupCommitmentExecution(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    groupConversationId: string;
    commitmentId: string;
    now: number;
  },
): Promise<{ result: ActionResult; facts?: DurableEventFacts; plan?: GroupDecisionCommitPlan }> {
  const commitment = await loadCommitment(ctx, args.worldId, args.commitmentId);
  if (!commitment || commitment.groupConversationId !== args.groupConversationId) {
    return { result: rejected('group_commitment_not_found', '未找到该群体承诺。') };
  }
  if (commitment.status !== 'pending') return { result: rejected('group_commitment_not_pending', '该承诺已经终结。') };
  if (commitment.donorActorId !== args.actorId) {
    return { result: rejected('group_commitment_executor_forbidden', '只有承诺中的捐赠者可以执行。') };
  }
  const proposal = await loadProposal(ctx, args.worldId, commitment.proposalId);
  if (!proposal) return { result: rejected('group_proposal_not_found', '承诺引用的提案不存在。') };
  const sessionCheck = await activeParticipantSession(ctx, args);
  if (!sessionCheck.ok) return { result: rejected(sessionCheck.reasonCode, sessionCheck.reason) };
  const donor = await loadProfile(ctx, args.worldId, commitment.donorActorId);
  const recipient = await loadProfile(ctx, args.worldId, commitment.recipientActorId);
  if (!donor || !recipient || !isPresentInSession(recipient, sessionCheck.session) || recipient.health <= 0) {
    return { result: rejected('group_proposal_recipient_invalid', '承诺的受赠者已不在可执行现场。') };
  }
  if (inventoryQuantity(donor, commitment.itemId) < commitment.itemQty) {
    const reasonCode = 'group_commitment_resource_unavailable';
    const result = applied(
      'group_commitment_breached',
      `${donor.name}已无承诺的灵草，未能履行对${recipient.name}的群议承诺。`,
      'group_commitment_breached',
    );
    return {
      result,
      plan: {
        kind: 'breach', proposal, commitment,
        observerActorIds: sessionCheck.session.observerActorIds,
        reasonCode,
      },
      facts: decisionFacts({
        resultCode: result.resultCode, operation: 'execute', groupConversationId: proposal.groupConversationId,
        proposalId: proposal.proposalId, proposalStatus: 'committed', proposerActorId: proposal.proposerActorId,
        donorActorId: proposal.donorActorId, recipientActorId: proposal.recipientActorId,
        quorum: proposal.quorum, commitmentId: commitment.commitmentId, commitmentStatus: 'breached', reasonCode,
      }),
    };
  }
  const transfer: ItemTransfer = {
    from: commitment.donorActorId,
    to: commitment.recipientActorId,
    itemId: commitment.itemId,
    qty: commitment.itemQty,
  };
  const result: ActionResult = {
    ...applied('group_commitment_fulfilled', `${donor.name}履行群议承诺，将一株灵草交给${recipient.name}。`, 'group_commitment_fulfilled'),
    effects: { items: [transfer] },
  };
  return {
    result,
    plan: {
      kind: 'execute', proposal, commitment,
      observerActorIds: sessionCheck.session.observerActorIds,
    },
    facts: decisionFacts({
      resultCode: result.resultCode, operation: 'execute', groupConversationId: proposal.groupConversationId,
      proposalId: proposal.proposalId, proposalStatus: proposal.status, proposerActorId: proposal.proposerActorId,
      donorActorId: proposal.donorActorId, recipientActorId: proposal.recipientActorId,
      quorum: proposal.quorum, commitmentId: commitment.commitmentId, commitmentStatus: 'fulfilled',
    }),
  };
}

export async function commitGroupDecision(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    eventId: Id<'worldEvents'>;
    plan: GroupDecisionCommitPlan;
    now: number;
  },
) {
  const { plan } = args;
  if (plan.kind === 'proposal') {
    await ctx.db.insert('groupProposals', {
      worldId: args.worldId, proposalId: plan.proposalId,
      groupConversationId: plan.session.groupConversationId, kind: GROUP_PROPOSAL_KIND, status: 'open',
      proposerActorId: plan.proposerActorId, donorActorId: plan.proposerActorId,
      recipientActorId: plan.recipientActorId, itemId: GROUP_PROPOSAL_ITEM_ID, itemQty: GROUP_PROPOSAL_ITEM_QTY,
      participantActorIds: plan.session.participantActorIds, sessionRevision: plan.session.revision,
      mapId: plan.session.mapId, locationId: plan.session.locationId, quorum: plan.quorum,
      approvals: 0, oppositions: 0, abstentions: 0,
      openedByActionId: args.actionRecordId, openedEventId: args.eventId,
      createdAt: args.now, expiresAt: plan.expiresAt, updatedAt: args.now,
    });
    return { proposalId: plan.proposalId, status: 'open' as const };
  }
  if (plan.kind === 'vote') {
    await ctx.db.insert('groupVotes', {
      worldId: args.worldId, proposalId: plan.proposal.proposalId, actorId: plan.voterActorId,
      choice: plan.choice, decisionBasis: plan.decisionBasis, relationshipBand: plan.relationshipBand,
      actionRecordId: args.actionRecordId, sourceEventId: args.eventId, createdAt: args.now,
    });
    await ctx.db.patch(plan.proposal._id, {
      status: plan.outcome, approvals: plan.approvals, oppositions: plan.oppositions,
      abstentions: plan.abstentions, commitmentId: plan.commitmentId,
      terminalActionId: plan.outcome === 'open' ? undefined : args.actionRecordId,
      terminalEventId: plan.outcome === 'open' ? undefined : args.eventId,
      terminalReasonCode: plan.outcome === 'rejected' ? 'group_quorum_unreachable' : undefined,
      updatedAt: args.now,
    });
    if (plan.outcome === 'committed' && plan.commitmentId) {
      await ctx.db.insert('groupCommitments', {
        worldId: args.worldId, commitmentId: plan.commitmentId, proposalId: plan.proposal.proposalId,
        groupConversationId: plan.proposal.groupConversationId, status: 'pending',
        donorActorId: plan.proposal.donorActorId, recipientActorId: plan.proposal.recipientActorId,
        itemId: plan.proposal.itemId, itemQty: plan.proposal.itemQty,
        approvedByActionId: args.actionRecordId, approvedEventId: args.eventId,
        createdAt: args.now, updatedAt: args.now,
      });
    }
    return { proposalId: plan.proposal.proposalId, status: plan.outcome, commitmentId: plan.commitmentId };
  }
  if (plan.kind === 'expire_proposal') {
    await ctx.db.patch(plan.proposal._id, {
      status: 'expired', terminalActionId: args.actionRecordId, terminalEventId: args.eventId,
      terminalReasonCode: 'group_proposal_expired', updatedAt: args.now,
    });
    return { proposalId: plan.proposal.proposalId, status: 'expired' as const };
  }
  if (plan.kind === 'breach') {
    await ctx.db.patch(plan.commitment._id, {
      status: 'breached', settlementActionId: args.actionRecordId, settlementEventId: args.eventId,
      terminalReasonCode: plan.reasonCode, terminalAt: args.now, updatedAt: args.now,
    });
    return { commitmentId: plan.commitment.commitmentId, status: 'breached' as const };
  }
  await ctx.db.patch(plan.commitment._id, {
    status: 'fulfilled', settlementActionId: args.actionRecordId, settlementEventId: args.eventId,
    terminalAt: args.now, updatedAt: args.now,
  });
  return { commitmentId: plan.commitment.commitmentId, status: 'fulfilled' as const };
}

async function activeParticipantSession(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actorId: string; groupConversationId: string; now: number },
): Promise<{ ok: true; session: Session } | { ok: false; reasonCode: string; reason: string }> {
  const session = await ctx.db
    .query('groupConversationSessions')
    .withIndex('byGroupConversation', (q) => q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId))
    .first();
  if (!session) return { ok: false, reasonCode: 'group_conversation_not_found', reason: '未找到该群体会话。' };
  if (session.status !== 'active') return { ok: false, reasonCode: 'group_conversation_not_active', reason: '群体会话已经结束。' };
  if (session.expiresAt <= args.now) return { ok: false, reasonCode: 'group_conversation_expired', reason: '群体会话已经超时。' };
  if (!session.participantActorIds.includes(args.actorId)) {
    return { ok: false, reasonCode: 'group_proposal_actor_ineligible', reason: '只有发言参与者拥有提案与表决权。' };
  }
  const actor = await loadProfile(ctx, args.worldId, args.actorId);
  if (!actor || actor.health <= 0) return { ok: false, reasonCode: 'group_member_incapacitated', reason: '行动者已失能。' };
  if (!isPresentInSession(actor, session)) return { ok: false, reasonCode: 'group_member_not_present', reason: '行动者已不在群议现场。' };
  return { ok: true, session };
}

function isPresentInSession(profile: Doc<'xianxiaProfiles'>, session: Session) {
  return (profile.mapId ?? 'world') === session.mapId && profile.currentLocationId === session.locationId;
}

async function loadProfile(ctx: MutationCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId)).first();
}

async function loadProposal(ctx: MutationCtx, worldId: Id<'worlds'>, proposalId: string) {
  return await ctx.db.query('groupProposals').withIndex('byProposal', (q) => q.eq('worldId', worldId).eq('proposalId', proposalId)).first();
}

async function loadCommitment(ctx: MutationCtx, worldId: Id<'worlds'>, commitmentId: string) {
  return await ctx.db.query('groupCommitments').withIndex('byCommitment', (q) => q.eq('worldId', worldId).eq('commitmentId', commitmentId)).first();
}

function inventoryQuantity(profile: Doc<'xianxiaProfiles'>, itemId: string) {
  return profile.inventory?.find((item) => item.itemId === itemId)?.qty ?? 0;
}

function voteChoiceLabel(choice: GroupVoteChoice) {
  return choice === 'approve' ? '赞成' : choice === 'oppose' ? '反对' : '弃权';
}

function applied(resultCode: string, reason: string, eventType: string): ActionResult {
  return { status: 'applied', resultCode, reason, effects: {}, eventType, visibility: 'witnessed' };
}

function rejected(resultCode: string, reason: string): ActionResult {
  return { status: 'rejected', resultCode, reason, effects: {}, eventType: 'group_decision_rejected', visibility: 'private' };
}

function decisionFacts(input: {
  resultCode: string; operation: string; groupConversationId: string; proposalId: string;
  proposalStatus: string; proposerActorId: string; donorActorId: string; recipientActorId: string;
  quorum: number; voteChoice?: string; approvals?: number; oppositions?: number; abstentions?: number;
  commitmentId?: string; commitmentStatus?: string; reasonCode?: string;
  decisionBasis?: string; relationshipBand?: string;
}): DurableEventFacts {
  return versionDurableEventFacts({
    ...input, kind: GROUP_PROPOSAL_KIND, itemId: GROUP_PROPOSAL_ITEM_ID, itemQty: GROUP_PROPOSAL_ITEM_QTY,
  });
}
