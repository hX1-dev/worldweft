import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionResult } from './actionSchema';
import type { SpeechAct } from './conversationContracts';
import {
  CONVERSATION_MAX_TURNS,
  CONVERSATION_TTL_MS,
  claimBeliefKind,
  initialSpeechAct,
  initialUtterance,
  orderedConversationActors,
  speechActCreatesClaim,
  validateConversationTurn,
  type ConversationTurnPlan,
} from './conversationLogic';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts, type DurableEventFacts } from './durableContracts';
import {
  conversationCooldownEntries,
  evaluateConversationCooldown,
  type ConversationCooldownEntry,
} from './conversationCooldownLogic';
import { authoritativeFactAccess, validateEvidenceUse } from './beliefRevisionLogic';
import {
  commitClaimBeliefs,
  registerBeliefEvidence,
  type ClaimProvenance,
} from './beliefs';
import { readGameHour } from './config';
import {
  ensureSocialOutcomeEventTx,
  settleConversationSocialOutcomeTx,
} from './socialOutcomeReceipts';
import type { SocialOutcomeBinding } from './socialOutcomeContracts';

export type ConversationStartPlan = {
  conversationId: string;
  actorAId: string;
  actorBId: string;
  proposerActorId: string;
  targetActorId: string;
  topicId: string;
  mapId: string;
  locationId: string;
  firstSpeechAct: SpeechAct;
  firstUtterance: string;
  cooldowns: ConversationCooldownEntry[];
  socialOutcomeBinding?: SocialOutcomeBinding;
  now: number;
};

export type PreparedConversationTurn = {
  session: Doc<'conversationSessions'>;
  plan: ConversationTurnPlan;
  speechAct: SpeechAct;
  topicId: string;
  turnId: string;
  proposalId?: string;
  claimId?: string;
  claimProvenance?: ClaimProvenance;
};

export type ConversationKnowledgeReferences = {
  facts: Doc<'worldEvents'>[];
  sourceBeliefs: Doc<'actorBeliefs'>[];
};

export async function prepareConversationStart(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorId: string;
    actionRecordId: Id<'actionRecords'>;
    actorName: string;
    targetName: string;
    intent?: string;
    mapId: string;
    locationId: string;
    now: number;
    socialOutcomeBinding?: SocialOutcomeBinding;
  },
): Promise<{ ok: true; plan: ConversationStartPlan } | { ok: false; result: ActionResult }> {
  const pair = orderedConversationActors(args.actorId, args.targetActorId);
  const existing = await ctx.db
    .query('conversationSessions')
    .withIndex('byPairStatus', (q) =>
      q
        .eq('worldId', args.worldId)
        .eq('actorAId', pair.actorAId)
        .eq('actorBId', pair.actorBId)
        .eq('status', 'active'),
    )
    .first();
  if (existing && existing.expiresAt > args.now) {
    return {
      ok: false,
      result: rejected(
        'conversation_already_active',
        '双方已有一个进行中的会话，必须先继续或结束它。',
      ),
    };
  }
  if (existing) await commitConversationExpiration(ctx, existing, args.now, args.actionRecordId);
  const conversationId = `conversation:${String(args.actionRecordId)}`;
  const topicId = normalizeTopic(args.intent);
  const cooldownEntries = conversationCooldownEntries({
    actorId: args.actorId,
    targetActorId: args.targetActorId,
    topicId,
    startedAt: args.now,
  });
  const cooldownDocs = await Promise.all(
    cooldownEntries.map((entry) =>
      ctx.db
        .query('conversationCooldowns')
        .withIndex('byKey', (q) =>
          q.eq('worldId', args.worldId).eq('cooldownKey', entry.cooldownKey),
        )
        .first(),
    ),
  );
  const cooldown = evaluateConversationCooldown({
    actorId: args.actorId,
    targetActorId: args.targetActorId,
    topicId,
    now: args.now,
    cooldowns: new Map(
      cooldownDocs
        .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
        .map((doc) => [doc.cooldownKey, { nextAllowedAt: doc.nextAllowedAt }]),
    ),
  });
  if (!cooldown.ok) {
    return { ok: false, result: rejected(cooldown.reasonCode, cooldown.reason) };
  }
  return {
    ok: true,
    plan: {
      conversationId,
      ...pair,
      proposerActorId: args.actorId,
      targetActorId: args.targetActorId,
      topicId,
      mapId: args.mapId,
      locationId: args.locationId,
      firstSpeechAct: initialSpeechAct(args.intent),
      firstUtterance: initialUtterance(args.actorName, args.targetName, args.intent),
      cooldowns: cooldownEntries,
      socialOutcomeBinding: args.socialOutcomeBinding,
      now: args.now,
    },
  };
}

export async function commitConversationStart(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actionRecordId: Id<'actionRecords'>,
  eventId: Id<'worldEvents'>,
  plan: ConversationStartPlan,
) {
  const turnId = `${plan.conversationId}:turn:1`;
  const sessionId = await ctx.db.insert('conversationSessions', {
    worldId,
    conversationId: plan.conversationId,
    status: 'active',
    actorAId: plan.actorAId,
    actorBId: plan.actorBId,
    proposerActorId: plan.proposerActorId,
    currentSpeakerActorId: plan.targetActorId,
    topicId: plan.topicId,
    mapId: plan.mapId,
    locationId: plan.locationId,
    turnNumber: 1,
    maxTurns: CONVERSATION_MAX_TURNS,
    revision: 1,
    openedByActionId: actionRecordId,
    startedEventId: eventId,
    socialOutcomeId: plan.socialOutcomeBinding?.outcomeId,
    socialWarrantId: plan.socialOutcomeBinding?.warrantId,
    socialWarrantDigest: plan.socialOutcomeBinding?.warrantDigest,
    socialSourceRef: plan.socialOutcomeBinding?.sourceRef,
    socialSourceRevision: plan.socialOutcomeBinding?.sourceRevision,
    socialIntendedOutcome: plan.socialOutcomeBinding?.intendedOutcome,
    socialTopicRefs: plan.socialOutcomeBinding?.topicRefs,
    proposedAt: plan.now,
    acceptedAt: plan.now,
    startedAt: plan.now,
    lastTurnAt: plan.now,
    expiresAt: plan.now + CONVERSATION_TTL_MS,
    updatedAt: plan.now,
  });
  const utteranceId = await ctx.db.insert('conversationUtterances', {
    worldId,
    conversationId: plan.conversationId,
    turnId,
    turnNumber: 1,
    actionRecordId,
    sourceEventId: eventId,
    speakerActorId: plan.proposerActorId,
    addressedActorIds: [plan.targetActorId],
    speechAct: plan.firstSpeechAct,
    topicId: plan.topicId,
    utteranceText: plan.firstUtterance,
    referencedFactIds: [],
    referencedBeliefIds: [],
    createdAt: plan.now,
  });
  for (const cooldown of plan.cooldowns) {
    const existing = await ctx.db
      .query('conversationCooldowns')
      .withIndex('byKey', (q) =>
        q.eq('worldId', worldId).eq('cooldownKey', cooldown.cooldownKey),
      )
      .first();
    const value = {
      scope: cooldown.scope,
      actorId: cooldown.actorId,
      targetActorId: cooldown.targetActorId,
      topicId: cooldown.topicId,
      conversationId: plan.conversationId,
      nextAllowedAt: cooldown.nextAllowedAt,
      updatedAt: plan.now,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('conversationCooldowns', { worldId, cooldownKey: cooldown.cooldownKey, ...value });
  }
  return { sessionId, utteranceId, conversationId: plan.conversationId, turnId };
}

export async function prepareConversationTurn(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorId?: string;
    conversationId: string;
    turnId: string;
    expectedTurnNumber: number;
    speechAct: SpeechAct;
    utteranceText: string;
    addressedActorIds: string[];
    referencedFactIds: string[];
    referencedBeliefIds: string[];
    now: number;
    actorMapId: string;
    actorLocationId?: string;
    actorHealth: number;
    proposalId?: string;
  },
): Promise<
  | { ok: true; prepared: PreparedConversationTurn; result: ActionResult; facts: DurableEventFacts }
  | { ok: false; result: ActionResult; expiredSession?: Doc<'conversationSessions'> }
> {
  const session = await ctx.db
    .query('conversationSessions')
    .withIndex('byConversation', (q) =>
      q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
    )
    .first();
  if (!session) return { ok: false, result: rejected('conversation_not_found', '未找到该会话。') };
  if (args.actorHealth <= 0) {
    return {
      ok: false,
      result: rejected('conversation_actor_incapacitated', '失能角色不能继续发言。'),
    };
  }
  if (session.mapId !== args.actorMapId || session.locationId !== args.actorLocationId) {
    return {
      ok: false,
      result: rejected('conversation_location_changed', '角色已经离开会话发生地点。'),
    };
  }
  const existingTurn = await ctx.db
    .query('conversationUtterances')
    .withIndex('byTurnId', (q) =>
      q
        .eq('worldId', args.worldId)
        .eq('conversationId', args.conversationId)
        .eq('turnId', args.turnId),
    )
    .first();
  const validated = validateConversationTurn(
    session,
    {
      actorId: args.actorId,
      targetActorId: args.targetActorId,
      turnId: args.turnId,
      expectedTurnNumber: args.expectedTurnNumber,
      speechAct: args.speechAct,
      utteranceText: args.utteranceText,
      addressedActorIds: args.addressedActorIds,
      referencedFactIds: args.referencedFactIds,
      referencedBeliefIds: args.referencedBeliefIds,
      now: args.now,
    },
    existingTurn ? new Set([existingTurn.turnId]) : new Set(),
  );
  if (!validated.ok) {
    return {
      ok: false,
      result: rejected(validated.reasonCode, validated.reason),
      expiredSession: validated.reasonCode === 'conversation_expired' ? session : undefined,
    };
  }
  const knowledge = await validateConversationKnowledgeReferences(
    ctx,
    args.worldId,
    args.actorId,
    validated.referencedFactIds,
    validated.referencedBeliefIds,
  );
  if (!knowledge.ok) return { ok: false, result: rejected(knowledge.reasonCode, knowledge.reason) };
  const claimId = speechActCreatesClaim(args.speechAct)
    ? `claim:${args.conversationId}:${args.turnId}`
    : undefined;
  const claimProvenance = claimId
    ? await prepareClaimProvenance(ctx, {
        worldId: args.worldId,
        actorId: args.actorId,
        claimId,
        speechAct: args.speechAct,
        topicId: session.topicId,
        knowledge,
      })
    : { ok: true as const, provenance: undefined };
  if (!claimProvenance.ok) {
    return { ok: false, result: rejected(claimProvenance.reasonCode, claimProvenance.reason) };
  }
  const resultCode = validated.terminalStatus
    ? validated.terminalReasonCode!
    : 'conversation_turn_recorded';
  const result: ActionResult = {
    status: 'applied',
    resultCode,
    reason: validated.text,
    effects: {},
    eventType: 'conversation_utterance',
    visibility: 'private',
  };
  return {
    ok: true,
    prepared: {
      session,
      plan: validated,
      speechAct: args.speechAct,
      topicId: session.topicId,
      turnId: args.turnId,
      proposalId: args.proposalId,
      claimId,
      claimProvenance: claimProvenance.provenance,
    },
    result,
    facts: versionDurableEventFacts({
      resultCode,
      conversationId: args.conversationId,
      turnId: args.turnId,
      turnNumber: validated.turnNumber,
      speechAct: args.speechAct,
      topicId: session.topicId,
      addressedActorIds: validated.addressedActorIds,
      referencedFactIds: validated.referencedFactIds,
      referencedBeliefIds: validated.referencedBeliefIds,
      proposalId: args.proposalId,
      claimId,
      subjectClaimId: claimProvenance.provenance?.subjectClaimId,
      evidenceEventId: claimProvenance.provenance?.evidence
        ? String(claimProvenance.provenance.evidence.sourceEventId)
        : undefined,
      evidenceVerdict: claimProvenance.provenance?.evidence?.verdict,
      terminalStatus: validated.terminalStatus,
    }),
  };
}

export async function commitConversationTurn(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    actionRecordId: Id<'actionRecords'>;
    eventId: Id<'worldEvents'>;
    prepared: PreparedConversationTurn;
    now: number;
  },
) {
  const { prepared } = args;
  const utteranceId = await ctx.db.insert('conversationUtterances', {
    worldId: args.worldId,
    conversationId: prepared.session.conversationId,
    turnId: prepared.turnId,
    turnNumber: prepared.plan.turnNumber,
    actionRecordId: args.actionRecordId,
    sourceEventId: args.eventId,
    speakerActorId: args.actorId,
    addressedActorIds: prepared.plan.addressedActorIds,
    speechAct: prepared.speechAct,
    topicId: prepared.topicId,
    utteranceText: prepared.plan.text,
    referencedFactIds: prepared.plan.referencedFactIds,
    referencedBeliefIds: prepared.plan.referencedBeliefIds,
    proposalId: prepared.proposalId,
    createdAt: args.now,
  });
  let claimId: string | undefined;
  if (prepared.claimId) {
    claimId = prepared.claimId;
    await ctx.db.insert('socialClaims', {
      worldId: args.worldId,
      claimId,
      conversationId: prepared.session.conversationId,
      utteranceId,
      sourceEventId: args.eventId,
      assertedByActorId: args.actorId,
      summary: prepared.plan.text,
      referencedFactIds: prepared.plan.referencedFactIds,
      referencedBeliefIds: prepared.plan.referencedBeliefIds,
      truthStatus: prepared.claimProvenance!.truthStatus,
      topicId: prepared.claimProvenance!.topicId,
      subjectClaimId: prepared.claimProvenance!.subjectClaimId,
      subjectActorIds: prepared.claimProvenance!.subjectActorIds,
      evidenceEventId: prepared.claimProvenance!.evidence
        ? String(prepared.claimProvenance!.evidence!.sourceEventId)
        : undefined,
      evidenceVerdict: prepared.claimProvenance!.evidence?.verdict,
      createdAt: args.now,
    });
    if (
      !prepared.claimProvenance!.evidence &&
      prepared.claimProvenance!.truthStatus === 'supported' &&
      prepared.plan.referencedFactIds.length === 1
    ) {
      const evidenceEventId = ctx.db.normalizeId(
        'worldEvents',
        prepared.plan.referencedFactIds[0],
      );
      if (evidenceEventId) {
        await registerBeliefEvidence(ctx, {
          worldId: args.worldId,
          subjectClaimId: prepared.claimProvenance!.subjectClaimId,
          topicId: prepared.claimProvenance!.topicId,
          subjectActorIds: prepared.claimProvenance!.subjectActorIds,
          sourceEventId: evidenceEventId,
          verdict: 'confirm',
          now: args.now,
        });
      }
    }
    await commitClaimBeliefs(ctx, {
      worldId: args.worldId,
      claimId,
      utteranceId,
      clarificationEventId: args.eventId,
      sourceActorId: args.actorId,
      summary: prepared.plan.text,
      recipientActorIds: prepared.claimProvenance!.evidence
        ? [args.actorId, ...prepared.plan.addressedActorIds]
        : prepared.plan.addressedActorIds,
      provenance: prepared.claimProvenance!,
      now: args.now,
    });
  }
  await ctx.db.patch(prepared.session._id, {
    status: prepared.plan.terminalStatus ?? 'active',
    currentSpeakerActorId: prepared.plan.nextSpeakerActorId,
    turnNumber: prepared.plan.turnNumber,
    revision: prepared.session.revision + 1,
    lastTurnAt: args.now,
    terminalAt: prepared.plan.terminalStatus ? args.now : undefined,
    terminalReasonCode: prepared.plan.terminalReasonCode,
    expiresAt: prepared.plan.terminalStatus ? prepared.session.expiresAt : args.now + CONVERSATION_TTL_MS,
    updatedAt: args.now,
  });
  return {
    conversationId: prepared.session.conversationId,
    turnId: prepared.turnId,
    turnNumber: prepared.plan.turnNumber,
    utteranceId,
    claimId,
    status: prepared.plan.terminalStatus ?? 'active',
    nextSpeakerActorId: prepared.plan.nextSpeakerActorId,
  };
}

export async function commitConversationExpiration(
  ctx: MutationCtx,
  session: Doc<'conversationSessions'>,
  now: number,
  terminalActionId: Id<'actionRecords'> = session.openedByActionId,
) {
  if (session.status !== 'active') return;
  await ctx.db.patch(session._id, {
    status: 'expired',
    currentSpeakerActorId: undefined,
    terminalAt: now,
    terminalReasonCode: 'conversation_expired',
    revision: session.revision + 1,
    updatedAt: now,
  });
  const eventId = await appendWorldEvent(ctx, {
    worldId: session.worldId,
    type: 'conversation_expired',
    createdAt: now,
    actorIds: [session.actorAId, session.actorBId],
    targetActorIds: [session.actorBId],
    locationId: session.locationId,
    visibility: 'private',
    summary: '双方久未继续交谈，这次会话已经结束。',
    facts: versionDurableEventFacts({
      resultCode: 'conversation_expired',
      conversationId: session.conversationId,
      terminalStatus: 'expired',
      reasonCode: 'conversation_expired',
    }),
    mapId: session.mapId,
  });
  const gameHour = await readGameHour(ctx, session.worldId, now);
  const settled = await settleConversationSocialOutcomeTx(ctx, {
    worldId: session.worldId,
    conversationId: session.conversationId,
    status: 'expired',
    resultCode: 'conversation_expired',
    terminalActionId,
    terminalEventId: eventId,
    gameHour,
    now,
  });
  if (!settled.ok) throw new Error(settled.reasonCode);
  if (!('unbound' in settled) && settled.receipt.status !== 'pending') {
    const outcomeEvent = await ensureSocialOutcomeEventTx(ctx, {
      worldId: session.worldId,
      outcomeId: settled.receipt.outcomeId,
      now,
      gameHour,
    });
    if (!outcomeEvent.ok) throw new Error(outcomeEvent.reasonCode);
  }
  return eventId;
}

export async function validateConversationKnowledgeReferences(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  factIds: string[],
  beliefIds: string[],
): Promise<
  | ({ ok: true } & ConversationKnowledgeReferences)
  | { ok: false; reasonCode: string; reason: string }
> {
  const facts: Doc<'worldEvents'>[] = [];
  for (const factId of factIds) {
    const id = ctx.db.normalizeId('worldEvents', factId);
    const event = id ? await ctx.db.get(id) : null;
    if (!event || event.worldId !== worldId) {
      return { ok: false, reasonCode: 'conversation_fact_not_visible', reason: '引用了不可见的世界事实。' };
    }
    const principal =
      event.actorIds.includes(actorId) ||
      (event.targetActorIds ?? []).includes(actorId) ||
      (event.witnessActorIds ?? []).includes(actorId);
    const memories = !principal && event.visibility !== 'public'
      ? await ctx.db
          .query('shortMemories')
          .withIndex('bySourceEvent', (q) => q.eq('worldId', worldId).eq('sourceEventId', factId))
          .take(128)
      : [];
    const access = authoritativeFactAccess({
      eventVisibility: event.visibility,
      eventType: event.type,
      eventContainsClaim: !!(event.facts as { claimId?: string } | undefined)?.claimId,
      principal,
      memories: memories
        .filter((memory) => memory.actorId === actorId)
        .map((memory) => ({ source: memory.source ?? 'direct', distorted: memory.distorted ?? false })),
    });
    if (!access.ok) {
      return {
        ok: false,
        reasonCode: access.reasonCode,
        reason: access.reasonCode === 'conversation_fact_not_authoritative'
          ? '引用的是传闻、扭曲记忆或他人主张，不能当作服务端事实。'
          : '引用了角色并不知道的世界事实。',
      };
    }
    facts.push(event);
  }
  const sourceBeliefs: Doc<'actorBeliefs'>[] = [];
  for (const beliefId of beliefIds) {
    const belief = await ctx.db
      .query('actorBeliefs')
      .withIndex('byActorBelief', (q) =>
        q.eq('worldId', worldId).eq('actorId', actorId).eq('beliefId', beliefId),
      )
      .first();
    if (!belief) {
      return { ok: false, reasonCode: 'conversation_belief_not_owned', reason: '引用了不属于该角色的信念。' };
    }
    if (!belief.active || (belief.validity && belief.validity !== 'active')) {
      return { ok: false, reasonCode: 'conversation_belief_not_current', reason: '引用了已经被修订或失效的旧信念。' };
    }
    sourceBeliefs.push(belief);
  }
  return { ok: true, facts, sourceBeliefs };
}

export async function prepareClaimProvenance(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    claimId: string;
    speechAct: SpeechAct;
    topicId: string;
    knowledge: ConversationKnowledgeReferences;
  },
): Promise<
  | { ok: true; provenance: ClaimProvenance }
  | { ok: false; reasonCode: string; reason: string }
> {
  const sourceBeliefs = args.knowledge.sourceBeliefs;
  const subjectClaimIds = [...new Set(sourceBeliefs.map((belief) => belief.subjectClaimId ?? belief.sourceClaimId))];
  const beliefTopicIds = [...new Set(sourceBeliefs.map((belief) => belief.topicId ?? args.topicId))];
  if (subjectClaimIds.length > 1) {
    return { ok: false, reasonCode: 'conversation_evidence_subject_mismatch', reason: '一轮发言不能混合不同主张主体的信念。' };
  }
  if (beliefTopicIds.length > 1 || (beliefTopicIds[0] && beliefTopicIds[0] !== args.topicId)) {
    return { ok: false, reasonCode: 'conversation_evidence_topic_mismatch', reason: '引用信念的话题与当前会话不一致。' };
  }
  const subjectClaimId = subjectClaimIds[0] ?? args.claimId;
  const evidenceEvent = args.knowledge.facts[0];
  const evidence = evidenceEvent && sourceBeliefs.length > 0
    ? await ctx.db
        .query('beliefEvidence')
        .withIndex('byClaimEvent', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('subjectClaimId', subjectClaimId)
            .eq('sourceEventId', evidenceEvent._id),
        )
        .first()
    : null;
  let evidenceForValidation = evidence;
  if (!evidenceForValidation && evidenceEvent && sourceBeliefs.length > 0) {
    evidenceForValidation = await ctx.db
      .query('beliefEvidence')
      .withIndex('bySourceEvent', (q) =>
        q.eq('worldId', args.worldId).eq('sourceEventId', evidenceEvent._id),
      )
      .first();
  }
  const evidenceUse = validateEvidenceUse({
    speechAct: args.speechAct,
    factCount: args.knowledge.facts.length,
    beliefCount: sourceBeliefs.length,
    currentTopicId: args.topicId,
    beliefTopicId: beliefTopicIds[0],
    beliefSubjectClaimId: subjectClaimIds[0],
    evidenceTopicId: evidenceForValidation?.topicId,
    evidenceSubjectClaimId: evidenceForValidation?.subjectClaimId,
    evidenceFound: !!evidenceForValidation,
  });
  if (!evidenceUse.ok) {
    return { ok: false, reasonCode: evidenceUse.reasonCode, reason: evidenceReason(evidenceUse.reasonCode) };
  }
  if (args.knowledge.facts.length > 0 && sourceBeliefs.length > 0 && !evidence) {
    return { ok: false, reasonCode: 'conversation_evidence_subject_mismatch', reason: '证据不属于所引用信念的主张主体。' };
  }
  const subjectActorIds = sourceBeliefs.length > 0
    ? normalized(sourceBeliefs.flatMap((belief) => belief.subjectActorIds ?? [belief.sourceActorId]))
    : normalized(args.knowledge.facts.flatMap((fact) => [...fact.actorIds, ...(fact.targetActorIds ?? [])]));
  return {
    ok: true,
    provenance: {
      subjectClaimId,
      topicId: args.topicId,
      subjectActorIds: subjectActorIds.length > 0 ? subjectActorIds : [args.actorId],
      kind: evidence ? 'claim' : claimBeliefKind(sourceBeliefs.map((belief) => belief.kind)),
      truthStatus: args.knowledge.facts.length > 0 ? 'supported' : 'unknown',
      evidence: evidence ?? undefined,
    },
  };
}

function evidenceReason(reasonCode: string) {
  switch (reasonCode) {
    case 'conversation_evidence_requires_clarify': return '事实与信念同时引用时必须使用明确的澄清动作。';
    case 'conversation_evidence_arity_invalid': return '一次澄清只能核验一个信念与一条服务端证据。';
    case 'conversation_evidence_topic_mismatch': return '证据话题与当前信念不一致。';
    case 'conversation_evidence_subject_mismatch': return '证据主体与当前信念不一致。';
    default: return '规则层没有登记这条证据与主张之间的关系。';
  }
}

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export const getConversationContext = query({
  args: { worldId: v.id('worlds'), conversationId: v.string(), actorId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query('conversationSessions')
      .withIndex('byConversation', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .first();
    if (!session || ![session.actorAId, session.actorBId].includes(args.actorId)) return null;
    const turns = await ctx.db
      .query('conversationUtterances')
      .withIndex('byConversationTurn', (q) =>
        q.eq('worldId', args.worldId).eq('conversationId', args.conversationId),
      )
      .order('desc')
      .take(8);
    const beliefs = await ctx.db
      .query('actorBeliefs')
      .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .order('desc')
      .take(12);
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .order('desc')
      .take(12);
    return { session, turns: turns.reverse(), beliefs: beliefs.filter((belief) => belief.active), memories };
  },
});

export const listActiveConversations = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('conversationSessions')
      .filter((q) => q.eq(q.field('worldId'), args.worldId))
      .filter((q) => q.eq(q.field('status'), 'active'))
      .order('desc')
      .take(Math.max(1, Math.min(50, args.limit ?? 20)));
  },
});

function normalizeTopic(intent?: string) {
  const topic = intent?.trim().slice(0, 80);
  return topic || 'daily_greeting';
}

function rejected(resultCode: string, reason: string): ActionResult {
  return {
    status: 'rejected',
    resultCode,
    reason,
    effects: {},
    eventType: 'conversation_utterance_rejected',
    visibility: 'private',
  };
}
