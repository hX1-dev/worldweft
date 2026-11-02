import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { ActionResult } from './actionSchema';
import type { SpeechAct } from './conversationContracts';
import {
  GROUP_CONVERSATION_MAX_TURNS,
  GROUP_CONVERSATION_TTL_MS,
  planGroupConversationMembership,
  validateGroupConversationTurn,
  type GroupConversationTurnPlan,
} from './groupConversationLogic';
import { speechActCreatesClaim } from './conversationLogic';
import {
  prepareClaimProvenance,
  validateConversationKnowledgeReferences,
} from './conversations';
import { versionDurableEventFacts, type DurableEventFacts } from './durableContracts';
import {
  commitClaimBeliefs,
  registerBeliefEvidence,
  type ClaimProvenance,
} from './beliefs';

type Profile = Doc<'xianxiaProfiles'>;
type Session = Doc<'groupConversationSessions'>;

export type GroupConversationStartPlan = {
  groupConversationId: string;
  hostActorId: string;
  participantActorIds: string[];
  observerActorIds: string[];
  nextSpeakerActorId: string;
  topicId: string;
  mapId: string;
  locationId: string;
  firstUtterance: string;
  now: number;
  sourceBinding?: {
    initiationId: string;
    outcomeId: string;
    warrantId: string;
    warrantDigest: string;
    sourceRef: string;
    sourceRevision: string;
    participantRoles: Array<{ actorId: string; role: 'decision_owner' | 'affected_party' | 'witness' | 'expert' | 'mediator' }>;
  };
};

export type PreparedGroupConversationTurn = {
  session: Session;
  plan: GroupConversationTurnPlan;
  speechAct: SpeechAct;
  turnId: string;
  claimId?: string;
  claimProvenance?: ClaimProvenance;
};

export type GroupConversationTerminalPlan = {
  session: Session;
  status: 'cancelled' | 'expired';
  reasonCode: string;
};

export async function prepareGroupConversationStart(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    actor: Profile;
    participantActorIds: string[];
    observerActorIds: string[];
    topicId?: string;
    intent?: string;
    sourceBinding?: GroupConversationStartPlan['sourceBinding'];
    now: number;
  },
): Promise<
  | { ok: true; plan: GroupConversationStartPlan; result: ActionResult; facts: DurableEventFacts }
  | { ok: false; result: ActionResult }
> {
  const membership = planGroupConversationMembership({
    actorId: args.actor.actorId,
    participantActorIds: args.participantActorIds,
    observerActorIds: args.observerActorIds,
  });
  if (!membership.ok) return { ok: false, result: rejected(membership.reasonCode, membership.reason) };
  const allActorIds = [...membership.participantActorIds, ...membership.observerActorIds];
  const profiles = await loadProfiles(ctx, args.worldId, allActorIds);
  for (const actorId of allActorIds) {
    const profile = profiles.get(actorId);
    if (!profile) return { ok: false, result: rejected('group_member_not_found', `未找到群体成员 ${actorId}。`) };
    if (profile.health <= 0) {
      return { ok: false, result: rejected('group_member_incapacitated', `${profile.name}已失能，不能加入群体会话。`) };
    }
    if (
      (profile.mapId ?? 'world') !== (args.actor.mapId ?? 'world') ||
      !args.actor.currentLocationId ||
      profile.currentLocationId !== args.actor.currentLocationId
    ) {
      return { ok: false, result: rejected('group_member_not_present', `${profile.name}不在会话现场。`) };
    }
    const active = await ctx.db
      .query('groupConversationMemberships')
      .withIndex('byActorStatus', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', actorId).eq('status', 'active'),
      )
      .first();
    if (active) {
      const activeSession = await loadSession(ctx, args.worldId, active.groupConversationId);
      if (activeSession && activeSession.expiresAt <= args.now) {
        await commitGroupConversationTerminal(ctx, {
          session: activeSession,
          status: 'expired',
          reasonCode: 'group_conversation_expired',
        }, undefined, undefined, args.now);
      } else {
        return { ok: false, result: rejected('group_member_busy', `${profile.name}已在另一场群体会话中。`) };
      }
    }
  }
  const groupConversationId = `group_conversation:${String(args.actionRecordId)}`;
  const topicId = normalizeTopic(args.topicId ?? args.intent);
  const firstUtterance = `${args.actor.name}召集在场诸位商议「${topicId}」。`;
  const result: ActionResult = {
    status: 'applied',
    resultCode: 'group_conversation_started',
    reason: firstUtterance,
    effects: {},
    eventType: 'group_conversation_utterance',
    visibility: 'witnessed',
  };
  return {
    ok: true,
    plan: {
      groupConversationId,
      hostActorId: args.actor.actorId,
      participantActorIds: membership.participantActorIds,
      observerActorIds: membership.observerActorIds,
      nextSpeakerActorId: membership.nextSpeakerActorId,
      topicId,
      mapId: args.actor.mapId ?? 'world',
      locationId: args.actor.currentLocationId!,
      firstUtterance,
      now: args.now,
      sourceBinding: args.sourceBinding,
    },
    result,
    facts: groupTurnFacts({
      resultCode: result.resultCode,
      groupConversationId,
      turnId: `${groupConversationId}:turn:1`,
      turnNumber: 1,
      speechAct: 'greet',
      topicId,
      participantActorIds: membership.participantActorIds,
      observerActorIds: membership.observerActorIds,
      addressedActorIds: membership.participantActorIds.filter((id) => id !== args.actor.actorId),
      referencedFactIds: [],
      referencedBeliefIds: [],
    }),
  };
}

export async function prepareGroupConversationTurn(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    groupConversationId: string;
    turnId: string;
    expectedTurnNumber: number;
    speechAct: SpeechAct;
    utteranceText: string;
    addressedActorIds: string[];
    referencedFactIds: string[];
    referencedBeliefIds: string[];
    now: number;
  },
): Promise<
  | { ok: true; prepared: PreparedGroupConversationTurn; result: ActionResult; facts: DurableEventFacts }
  | { ok: false; result: ActionResult; terminalPlan?: GroupConversationTerminalPlan }
> {
  const session = await loadSession(ctx, args.worldId, args.groupConversationId);
  if (!session) return { ok: false, result: rejected('group_conversation_not_found', '未找到该群体会话。') };
  if (session.status === 'active' && session.expiresAt <= args.now) {
    return {
      ok: false,
      result: terminalResult('group_conversation_expired', '群体会话已超时。', 'expired'),
      terminalPlan: { session, status: 'expired', reasonCode: 'group_conversation_expired' },
    };
  }
  const presence = await validateParticipantPresence(ctx, session);
  if (!presence.ok) {
    return {
      ok: false,
      result: terminalResult(presence.reasonCode, presence.reason, 'cancelled'),
      terminalPlan: { session, status: 'cancelled', reasonCode: presence.reasonCode },
    };
  }
  const existingTurn = await ctx.db
    .query('conversationUtterances')
    .withIndex('byTurnId', (q) =>
      q.eq('worldId', args.worldId).eq('conversationId', args.groupConversationId).eq('turnId', args.turnId),
    )
    .first();
  const validated = validateGroupConversationTurn(session, {
    actorId: args.actorId,
    turnId: args.turnId,
    expectedTurnNumber: args.expectedTurnNumber,
    speechAct: args.speechAct,
    utteranceText: args.utteranceText,
    addressedActorIds: args.addressedActorIds,
    referencedFactIds: args.referencedFactIds,
    referencedBeliefIds: args.referencedBeliefIds,
    now: args.now,
  }, existingTurn ? new Set([existingTurn.turnId]) : new Set());
  if (!validated.ok) return { ok: false, result: rejected(validated.reasonCode, validated.reason) };
  const knowledge = await validateConversationKnowledgeReferences(
    ctx,
    args.worldId,
    args.actorId,
    validated.referencedFactIds,
    validated.referencedBeliefIds,
  );
  if (!knowledge.ok) return { ok: false, result: rejected(knowledge.reasonCode, knowledge.reason) };
  const presentObservers = await presentObserverIds(ctx, session);
  const plan = {
    ...validated,
    listenerActorIds: [
      ...session.participantActorIds.filter((actorId) => actorId !== args.actorId),
      ...presentObservers,
    ],
  };
  const claimId = speechActCreatesClaim(args.speechAct)
    ? `claim:${args.groupConversationId}:${args.turnId}`
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
  const resultCode = plan.terminalStatus ? plan.terminalReasonCode! : 'group_conversation_turn_recorded';
  const result: ActionResult = {
    status: 'applied',
    resultCode,
    reason: plan.text,
    effects: {},
    eventType: 'group_conversation_utterance',
    visibility: 'witnessed',
  };
  return {
    ok: true,
    prepared: {
      session,
      plan,
      speechAct: args.speechAct,
      turnId: args.turnId,
      claimId,
      claimProvenance: claimProvenance.provenance,
    },
    result,
    facts: groupTurnFacts({
      resultCode,
      groupConversationId: args.groupConversationId,
      turnId: args.turnId,
      turnNumber: plan.turnNumber,
      speechAct: args.speechAct,
      topicId: session.topicId,
      participantActorIds: session.participantActorIds,
      observerActorIds: presentObservers,
      addressedActorIds: plan.addressedActorIds,
      referencedFactIds: plan.referencedFactIds,
      referencedBeliefIds: plan.referencedBeliefIds,
      claimId,
      subjectClaimId: claimProvenance.provenance?.subjectClaimId,
      evidenceEventId: claimProvenance.provenance?.evidence
        ? String(claimProvenance.provenance.evidence.sourceEventId)
        : undefined,
      evidenceVerdict: claimProvenance.provenance?.evidence?.verdict,
      terminalStatus: plan.terminalStatus,
    }),
  };
}

export async function prepareGroupConversationLeave(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actorId: string; groupConversationId: string },
): Promise<
  | { ok: true; plan: GroupConversationTerminalPlan; result: ActionResult; facts: DurableEventFacts }
  | { ok: false; result: ActionResult }
> {
  const session = await loadSession(ctx, args.worldId, args.groupConversationId);
  if (!session) return { ok: false, result: rejected('group_conversation_not_found', '未找到该群体会话。') };
  if (session.status !== 'active') return { ok: false, result: rejected('group_conversation_not_active', '群体会话已经结束。') };
  if (!session.participantActorIds.includes(args.actorId)) {
    return { ok: false, result: rejected('group_observer_cannot_leave_session', '只有发言参与者的离场会终止会话。') };
  }
  const result = terminalResult('group_conversation_participant_left', '参与者离场，群体会话结束。', 'cancelled');
  return {
    ok: true,
    plan: { session, status: 'cancelled', reasonCode: result.resultCode },
    result,
    facts: versionDurableEventFacts({
      resultCode: result.resultCode,
      groupConversationId: session.groupConversationId,
      terminalStatus: 'cancelled',
      reasonCode: result.resultCode,
      participantActorIds: session.participantActorIds,
      observerActorIds: session.observerActorIds,
    }),
  };
}

export async function commitGroupConversationStart(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actionRecordId: Id<'actionRecords'>; eventId: Id<'worldEvents'>; plan: GroupConversationStartPlan },
) {
  const { plan } = args;
  const sessionId = await ctx.db.insert('groupConversationSessions', {
    worldId: args.worldId,
    groupConversationId: plan.groupConversationId,
    status: 'active',
    hostActorId: plan.hostActorId,
    participantActorIds: plan.participantActorIds,
    observerActorIds: plan.observerActorIds,
    currentSpeakerActorId: plan.nextSpeakerActorId,
    topicId: plan.topicId,
    mapId: plan.mapId,
    locationId: plan.locationId,
    groupSocialInitiationId: plan.sourceBinding?.initiationId,
    socialOutcomeId: plan.sourceBinding?.outcomeId,
    socialWarrantId: plan.sourceBinding?.warrantId,
    socialWarrantDigest: plan.sourceBinding?.warrantDigest,
    socialSourceRef: plan.sourceBinding?.sourceRef,
    socialSourceRevision: plan.sourceBinding?.sourceRevision,
    socialParticipantRoles: plan.sourceBinding?.participantRoles,
    turnNumber: 1,
    maxTurns: GROUP_CONVERSATION_MAX_TURNS,
    revision: 1,
    openedByActionId: args.actionRecordId,
    startedEventId: args.eventId,
    startedAt: plan.now,
    lastTurnAt: plan.now,
    expiresAt: plan.now + GROUP_CONVERSATION_TTL_MS,
    updatedAt: plan.now,
  });
  for (const actorId of plan.participantActorIds) {
    await ctx.db.insert('groupConversationMemberships', {
      worldId: args.worldId, groupConversationId: plan.groupConversationId, actorId,
      role: 'participant', status: 'active', joinedAt: plan.now, updatedAt: plan.now,
    });
  }
  for (const actorId of plan.observerActorIds) {
    await ctx.db.insert('groupConversationMemberships', {
      worldId: args.worldId, groupConversationId: plan.groupConversationId, actorId,
      role: 'observer', status: 'active', joinedAt: plan.now, updatedAt: plan.now,
    });
  }
  const turnId = `${plan.groupConversationId}:turn:1`;
  const utteranceId = await ctx.db.insert('conversationUtterances', {
    worldId: args.worldId,
    conversationId: plan.groupConversationId,
    turnId,
    turnNumber: 1,
    actionRecordId: args.actionRecordId,
    sourceEventId: args.eventId,
    speakerActorId: plan.hostActorId,
    addressedActorIds: plan.participantActorIds.filter((id) => id !== plan.hostActorId),
    speechAct: 'greet',
    topicId: plan.topicId,
    utteranceText: plan.firstUtterance,
    referencedFactIds: [],
    referencedBeliefIds: [],
    createdAt: plan.now,
  });
  return { sessionId, utteranceId, groupConversationId: plan.groupConversationId, turnId, status: 'active' as const, nextSpeakerActorId: plan.nextSpeakerActorId };
}

export async function commitGroupConversationTurn(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; actorId: string; actionRecordId: Id<'actionRecords'>; eventId: Id<'worldEvents'>; prepared: PreparedGroupConversationTurn; now: number },
) {
  const { prepared } = args;
  const utteranceId = await ctx.db.insert('conversationUtterances', {
    worldId: args.worldId,
    conversationId: prepared.session.groupConversationId,
    turnId: prepared.turnId,
    turnNumber: prepared.plan.turnNumber,
    actionRecordId: args.actionRecordId,
    sourceEventId: args.eventId,
    speakerActorId: args.actorId,
    addressedActorIds: prepared.plan.addressedActorIds,
    speechAct: prepared.speechAct,
    topicId: prepared.session.topicId,
    utteranceText: prepared.plan.text,
    referencedFactIds: prepared.plan.referencedFactIds,
    referencedBeliefIds: prepared.plan.referencedBeliefIds,
    createdAt: args.now,
  });
  if (prepared.claimId) {
    await ctx.db.insert('socialClaims', {
      worldId: args.worldId,
      claimId: prepared.claimId,
      conversationId: prepared.session.groupConversationId,
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
      claimId: prepared.claimId,
      utteranceId,
      clarificationEventId: args.eventId,
      sourceActorId: args.actorId,
      summary: prepared.plan.text,
      recipientActorIds: prepared.claimProvenance!.evidence
        ? [args.actorId, ...prepared.plan.listenerActorIds]
        : prepared.plan.listenerActorIds,
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
    terminalActionId: prepared.plan.terminalStatus ? args.actionRecordId : undefined,
    terminalEventId: prepared.plan.terminalStatus ? args.eventId : undefined,
    terminalAt: prepared.plan.terminalStatus ? args.now : undefined,
    terminalReasonCode: prepared.plan.terminalReasonCode,
    expiresAt: prepared.plan.terminalStatus ? prepared.session.expiresAt : args.now + GROUP_CONVERSATION_TTL_MS,
    updatedAt: args.now,
  });
  if (prepared.plan.terminalStatus) {
    await patchMembershipsTerminal(ctx, prepared.session, prepared.plan.terminalStatus, prepared.plan.terminalReasonCode!, args.now);
    await invalidateGroupDecisions(
      ctx,
      prepared.session,
      prepared.plan.terminalReasonCode!,
      args.actionRecordId,
      args.eventId,
      args.now,
    );
  }
  return {
    groupConversationId: prepared.session.groupConversationId,
    turnId: prepared.turnId,
    turnNumber: prepared.plan.turnNumber,
    utteranceId,
    claimId: prepared.claimId,
    status: prepared.plan.terminalStatus ?? 'active',
    nextSpeakerActorId: prepared.plan.nextSpeakerActorId,
  };
}

export async function commitGroupConversationTerminal(
  ctx: MutationCtx,
  plan: GroupConversationTerminalPlan,
  actionRecordId: Id<'actionRecords'> | undefined,
  eventId: Id<'worldEvents'> | undefined,
  now: number,
) {
  if (plan.session.status !== 'active') return;
  await ctx.db.patch(plan.session._id, {
    status: plan.status,
    currentSpeakerActorId: undefined,
    revision: plan.session.revision + 1,
    terminalActionId: actionRecordId,
    terminalEventId: eventId,
    terminalAt: now,
    terminalReasonCode: plan.reasonCode,
    updatedAt: now,
  });
  await patchMembershipsTerminal(ctx, plan.session, plan.status, plan.reasonCode, now);
  await invalidateGroupDecisions(ctx, plan.session, plan.reasonCode, actionRecordId, eventId, now);
}

async function invalidateGroupDecisions(
  ctx: MutationCtx,
  session: Session,
  sessionReasonCode: string,
  actionRecordId: Id<'actionRecords'> | undefined,
  eventId: Id<'worldEvents'> | undefined,
  now: number,
) {
  const proposals = await ctx.db
    .query('groupProposals')
    .withIndex('byGroupStatus', (q) =>
      q.eq('worldId', session.worldId).eq('groupConversationId', session.groupConversationId),
    )
    .collect();
  for (const proposal of proposals) {
    if (proposal.status === 'open') {
      await ctx.db.patch(proposal._id, {
        status: 'invalidated', terminalActionId: actionRecordId, terminalEventId: eventId,
        terminalReasonCode: `group_session_terminated:${sessionReasonCode}`, updatedAt: now,
      });
      continue;
    }
    if (proposal.status !== 'committed' || !proposal.commitmentId) continue;
    const commitment = await ctx.db.query('groupCommitments').withIndex('byCommitment', (q) =>
      q.eq('worldId', session.worldId).eq('commitmentId', proposal.commitmentId!),
    ).first();
    if (!commitment || commitment.status !== 'pending') continue;
    const reasonCode = `group_session_terminated:${sessionReasonCode}`;
    await ctx.db.patch(commitment._id, {
      status: 'invalidated', settlementActionId: actionRecordId, settlementEventId: eventId,
      terminalReasonCode: reasonCode, terminalAt: now, updatedAt: now,
    });
    await ctx.db.patch(proposal._id, {
      status: 'invalidated', terminalActionId: actionRecordId, terminalEventId: eventId,
      terminalReasonCode: reasonCode, updatedAt: now,
    });
  }
}

async function patchMembershipsTerminal(
  ctx: MutationCtx,
  session: Session,
  status: 'resolved' | 'cancelled' | 'expired',
  reasonCode: string,
  now: number,
) {
  const memberships = await ctx.db
    .query('groupConversationMemberships')
    .filter((q) => q.eq(q.field('worldId'), session.worldId))
    .filter((q) => q.eq(q.field('groupConversationId'), session.groupConversationId))
    .collect();
  for (const membership of memberships) {
    if (membership.status !== 'active') continue;
    await ctx.db.patch(membership._id, { status, terminalAt: now, terminalReasonCode: reasonCode, updatedAt: now });
  }
}

async function validateParticipantPresence(
  ctx: MutationCtx,
  session: Session,
): Promise<{ ok: true } | { ok: false; reasonCode: string; reason: string }> {
  const profiles = await loadProfiles(ctx, session.worldId, session.participantActorIds);
  for (const actorId of session.participantActorIds) {
    const profile = profiles.get(actorId);
    if (!profile || profile.health <= 0) {
      return { ok: false, reasonCode: 'group_participant_incapacitated', reason: '参与者失能，群体会话已取消。' };
    }
    if ((profile.mapId ?? 'world') !== session.mapId || profile.currentLocationId !== session.locationId) {
      return { ok: false, reasonCode: 'group_participant_left', reason: '参与者已离开会话现场。' };
    }
  }
  return { ok: true };
}

async function presentObserverIds(ctx: MutationCtx, session: Session) {
  const profiles = await loadProfiles(ctx, session.worldId, session.observerActorIds);
  return session.observerActorIds.filter((actorId) => {
    const profile = profiles.get(actorId);
    return profile && profile.health > 0 && (profile.mapId ?? 'world') === session.mapId && profile.currentLocationId === session.locationId;
  });
}

async function loadProfiles(ctx: MutationCtx, worldId: Id<'worlds'>, actorIds: string[]) {
  const entries = await Promise.all(actorIds.map(async (actorId) => [
    actorId,
    await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId)).first(),
  ] as const));
  return new Map(entries.filter((entry): entry is readonly [string, Profile] => entry[1] !== null));
}

async function loadSession(ctx: MutationCtx, worldId: Id<'worlds'>, groupConversationId: string) {
  return await ctx.db
    .query('groupConversationSessions')
    .withIndex('byGroupConversation', (q) => q.eq('worldId', worldId).eq('groupConversationId', groupConversationId))
    .first();
}

function normalizeTopic(value?: string) {
  const topic = value?.trim().slice(0, 80);
  return topic || 'group_affairs';
}

function rejected(resultCode: string, reason: string): ActionResult {
  return { status: 'rejected', resultCode, reason, effects: {}, eventType: 'action_rejected', visibility: 'private' };
}

function terminalResult(resultCode: string, reason: string, _status: 'cancelled' | 'expired'): ActionResult {
  return { status: 'applied', resultCode, reason, effects: {}, eventType: 'group_conversation_terminal', visibility: 'witnessed' };
}

function groupTurnFacts(input: {
  resultCode: string;
  groupConversationId: string;
  turnId: string;
  turnNumber: number;
  speechAct: string;
  topicId: string;
  participantActorIds: string[];
  observerActorIds: string[];
  addressedActorIds: string[];
  referencedFactIds: string[];
  referencedBeliefIds: string[];
  claimId?: string;
  subjectClaimId?: string;
  evidenceEventId?: string;
  evidenceVerdict?: string;
  terminalStatus?: string;
}) {
  return versionDurableEventFacts(input);
}
