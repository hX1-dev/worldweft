import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { stableObservationDigest } from './lifeObservation';
import {
  SOCIAL_OUTCOME_VERSION,
  createSocialOutcomeReceipt,
  socialOutcomeScopeBlocked,
  transitionSocialOutcomeReceipt,
  type SocialOutcomeBinding,
  type SocialOutcomeReceipt,
  type SocialOutcomeTerminalEvidence,
} from './socialOutcomeContracts';
import {
  groupSocialWarrantCandidateBindingDigest,
  type GroupSocialInitiationReceipt,
} from './groupSocialInitiationContracts';
import { appendWorldEvent } from './events';
import { generateMemories } from './memory';
import { isMemorable } from './memoryLogic';
import { versionDurableEventFacts } from './durableContracts';
import {
  deriveAidSocialConsequenceDrafts,
  deriveBoundarySocialConsequenceDraft,
  deriveReliabilitySocialConsequenceDrafts,
  type BoundaryRefusalEvidence,
  type SocialConsequenceDraft,
} from './socialConsequenceContracts';
import { consumeSocialConsequenceProjectionTx } from './socialConsequenceProjections';
import {
  domainOutcomeEvidenceIdempotencyKey,
  projectDomainOutcomeEvidence,
} from './runtimeDomainOutcomeEvidencePort';
import { admitRelationshipMemoryOutcome } from './relationshipMemoryOutcomeAdmissionLogic';

export async function beginSocialOutcomeTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    binding: SocialOutcomeBinding;
    openedByActionId: Id<'actionRecords'>;
    openedEventId: Id<'worldEvents'>;
    gameHour: number;
    now: number;
    conversationId?: string;
    groupConversationId?: string;
  },
) {
  const existing = await ctx.db.query('socialOutcomeReceipts').withIndex('byOutcome', (q) =>
    q.eq('worldId', args.worldId).eq('outcomeId', args.binding.outcomeId)).unique();
  if (existing) {
    return sameOpening(existing, args)
      ? { ok: true as const, replay: true, receipt: rowToReceipt(existing) }
      : rejected('social_outcome_terminal_conflict');
  }
  const scopeRows = await ctx.db.query('socialOutcomeReceipts').withIndex('byScope', (q) =>
    q.eq('worldId', args.worldId).eq('scopeKey', args.binding.scopeKey)).collect();
  const blocked = scopeRows.find((row) => socialOutcomeScopeBlocked(row, args.gameHour));
  if (blocked) {
    return rejected(blocked.status === 'pending'
      ? 'social_outcome_scope_active'
      : 'social_outcome_cooldown_active');
  }
  const projectionConsumption = await consumeSocialConsequenceProjectionTx(ctx, {
    worldId: args.worldId,
    binding: args.binding,
    gameHour: args.gameHour,
    now: args.now,
  });
  if (!projectionConsumption.ok) return rejected(projectionConsumption.reasonCode);
  const receipt = createSocialOutcomeReceipt({
    binding: args.binding,
    openedByActionId: String(args.openedByActionId),
    openedEventId: String(args.openedEventId),
    createdGameHour: args.gameHour,
    conversationId: args.conversationId,
    groupConversationId: args.groupConversationId,
  });
  const {
    openedByActionId: _openedByActionId,
    openedEventId: _openedEventId,
    terminalActionId: _terminalActionId,
    terminalEventId: _terminalEventId,
    outcomeEventId: _outcomeEventId,
    ...persistedReceipt
  } = receipt;
  await ctx.db.insert('socialOutcomeReceipts', {
    worldId: args.worldId,
    ...persistedReceipt,
    openedByActionId: args.openedByActionId,
    openedEventId: args.openedEventId,
    createdAt: args.now,
    updatedAt: args.now,
  });
  return { ok: true as const, replay: false, receipt };
}

export async function settleSocialOutcomeTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    outcomeId: string;
    evidence: SocialOutcomeTerminalEvidence;
    terminalActionId: Id<'actionRecords'>;
    terminalEventId: Id<'worldEvents'>;
    gameHour: number;
    now: number;
    boundaryEvidence?: BoundaryRefusalEvidence;
  },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byOutcome', (q) =>
    q.eq('worldId', args.worldId).eq('outcomeId', args.outcomeId)).unique();
  if (!row) return rejected('social_outcome_not_found');
  const transitioned = transitionSocialOutcomeReceipt({
    receipt: rowToReceipt(row),
    evidence: args.evidence,
    terminalActionId: String(args.terminalActionId),
    terminalEventId: String(args.terminalEventId),
    terminalGameHour: args.gameHour,
  });
  if (!transitioned.ok) return rejected(transitioned.reasonCode);
  if (!transitioned.replay) {
    const terminalEvent = await ctx.db.get(args.terminalEventId);
    const consequenceDrafts = [
      ...deriveAidSocialConsequenceDrafts(transitioned.receipt),
      ...deriveReliabilitySocialConsequenceDrafts(transitioned.receipt, terminalEvent),
      ...optionalDraft(deriveBoundarySocialConsequenceDraft(
        transitioned.receipt,
        args.boundaryEvidence ?? null,
      )),
    ];
    await ctx.db.patch(row._id, {
      revision: transitioned.receipt.revision,
      status: transitioned.receipt.status,
      terminalActionId: args.terminalActionId,
      terminalEventId: args.terminalEventId,
      terminalResultCode: transitioned.receipt.terminalResultCode,
      terminalReasonCode: transitioned.receipt.terminalReasonCode,
      cooldownUntilGameHour: transitioned.receipt.cooldownUntilGameHour,
      terminalGameHour: transitioned.receipt.terminalGameHour,
      updatedAt: args.now,
    });
    await insertDerivedSocialConsequencesTx(ctx, {
      worldId: args.worldId,
      drafts: consequenceDrafts,
      now: args.now,
    });
  }
  return { ok: true as const, replay: transitioned.replay, receipt: transitioned.receipt };
}

export async function insertDerivedSocialConsequencesTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    drafts: SocialConsequenceDraft[];
    now: number;
  },
) {
  for (const draft of args.drafts) {
    const existing = await ctx.db.query('socialConsequences').withIndex('byConsequence', (q) =>
      q.eq('worldId', args.worldId).eq('consequenceId', draft.consequenceId)).unique();
    if (existing) throw new Error('social_consequence_terminal_conflict');
    const {
      sourceActionId,
      sourceEventId,
      ...persisted
    } = draft;
    await ctx.db.insert('socialConsequences', {
      worldId: args.worldId,
      ...persisted,
      sourceActionId: sourceActionId as Id<'actionRecords'>,
      sourceEventId: sourceEventId as Id<'worldEvents'>,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
}

export async function settleConversationSocialOutcomeTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    conversationId: string;
    status: 'resolved' | 'cancelled' | 'expired';
    resultCode: string;
    terminalActionId: Id<'actionRecords'>;
    terminalEventId: Id<'worldEvents'>;
    gameHour: number;
    now: number;
  },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byConversation', (q) =>
    q.eq('worldId', args.worldId).eq('conversationId', args.conversationId)).unique();
  if (!row) return { ok: true as const, replay: false, unbound: true as const };
  const [utterances, claims] = await Promise.all([
    ctx.db.query('conversationUtterances').withIndex('byConversationTurn', (q) =>
      q.eq('worldId', args.worldId).eq('conversationId', args.conversationId)).collect(),
    ctx.db.query('socialClaims').withIndex('byConversation', (q) =>
      q.eq('worldId', args.worldId).eq('conversationId', args.conversationId)).collect(),
  ]);
  const provenClaims = claims.filter((claim) =>
    claim.truthStatus !== 'unknown' || claim.referencedFactIds.length > 0 ||
    claim.referencedBeliefIds.length > 0 || claim.evidenceEventId !== undefined);
  const eligibleRefusals = row.intendedOutcome === 'thank_apologize_or_repair'
    ? utterances.filter((entry) =>
        entry.speakerActorId === row.targetActorIds[0] &&
        entry.speechAct === 'refuse' &&
        entry.addressedActorIds.length === 1 && entry.addressedActorIds[0] === row.actorId)
    : [];
  if (eligibleRefusals.length > 1) throw new Error('lwse_1c_boundary_evidence_missing');
  const refusal = eligibleRefusals[0];
  let boundaryEvidence: BoundaryRefusalEvidence | undefined;
  if (refusal) {
    const eventId = ctx.db.normalizeId('worldEvents', refusal.sourceEventId);
    const event = eventId ? await ctx.db.get(eventId) : null;
    if (!event) throw new Error('lwse_1c_boundary_evidence_missing');
    boundaryEvidence = {
      conversationId: refusal.conversationId,
      actionId: String(refusal.actionRecordId),
      event,
      speakerActorId: refusal.speakerActorId,
      addressedActorIds: refusal.addressedActorIds,
      speechAct: refusal.speechAct,
    };
  }
  return await settleSocialOutcomeTx(ctx, {
    worldId: args.worldId,
    outcomeId: row.outcomeId,
    evidence: {
      resultCode: args.resultCode,
      conversationStatus: args.status,
      speech: utterances.map((entry) => ({
        speakerActorId: entry.speakerActorId,
        speechAct: entry.speechAct,
        referencedFactIds: entry.referencedFactIds,
        referencedBeliefIds: entry.referencedBeliefIds,
      })),
      knowledgeDeliveryCount: provenClaims.length,
    },
    terminalActionId: args.terminalActionId,
    terminalEventId: args.terminalEventId,
    gameHour: args.gameHour,
    now: args.now,
    boundaryEvidence,
  });
}

function optionalDraft(draft: SocialConsequenceDraft | null): SocialConsequenceDraft[] {
  return draft ? [draft] : [];
}

export async function settleGroupSocialOutcomeTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    groupConversationId: string;
    evidence: SocialOutcomeTerminalEvidence;
    terminalActionId: Id<'actionRecords'>;
    terminalEventId: Id<'worldEvents'>;
    gameHour: number;
    now: number;
  },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byGroupConversation', (q) =>
    q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId)).unique();
  if (!row) return { ok: true as const, replay: false, unbound: true as const };
  return await settleSocialOutcomeTx(ctx, {
    worldId: args.worldId,
    outcomeId: row.outcomeId,
    evidence: args.evidence,
    terminalActionId: args.terminalActionId,
    terminalEventId: args.terminalEventId,
    gameHour: args.gameHour,
    now: args.now,
  });
}

/** A group session may continue long enough to record a courteous closing
 * turn after its bound resource decision has already settled the outcome.
 * Callers use this narrow probe to avoid attempting a second, conflicting
 * terminal transition; it never changes the receipt itself. */
export async function groupSocialOutcomePendingTx(
  ctx: QueryCtx,
  args: { worldId: Id<'worlds'>; groupConversationId: string },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byGroupConversation', (q) =>
    q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId)).unique();
  return row?.status === 'pending';
}

export async function bindGroupConversationSocialOutcomeTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    binding: SocialOutcomeBinding;
    groupConversationId: string;
    now: number;
  },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byOutcome', (q) =>
    q.eq('worldId', args.worldId).eq('outcomeId', args.binding.outcomeId)).unique();
  if (!row) return rejected('social_outcome_not_found');
  if (row.groupConversationId === args.groupConversationId) {
    return { ok: true as const, replay: true, receipt: rowToReceipt(row) };
  }
  if (
    row.status !== 'pending' || row.groupConversationId !== undefined ||
    row.scopeKey !== args.binding.scopeKey ||
    row.warrantDigest !== args.binding.warrantDigest ||
    row.candidateDigest !== args.binding.candidateDigest
  ) {
    return rejected('social_outcome_terminal_conflict');
  }
  await ctx.db.patch(row._id, { groupConversationId: args.groupConversationId, updatedAt: args.now });
  return {
    ok: true as const,
    replay: false,
    receipt: { ...rowToReceipt(row), groupConversationId: args.groupConversationId },
  };
}

export async function settleActionSocialOutcomeTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    actionRecordId: Id<'actionRecords'>;
    terminalEventId: Id<'worldEvents'>;
    resultCode: string;
    gameHour: number;
    now: number;
  },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byOpenedAction', (q) =>
    q.eq('worldId', args.worldId).eq('openedByActionId', args.actionRecordId)).unique();
  if (!row) return { ok: true as const, replay: false, unbound: true as const };
  return await settleSocialOutcomeTx(ctx, {
    worldId: args.worldId,
    outcomeId: row.outcomeId,
    evidence: { resultCode: args.resultCode },
    terminalActionId: args.actionRecordId,
    terminalEventId: args.terminalEventId,
    gameHour: args.gameHour,
    now: args.now,
  });
}

export async function ensureSocialOutcomeEventTx(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; outcomeId: string; now: number; gameHour: number },
) {
  const row = await ctx.db.query('socialOutcomeReceipts').withIndex('byOutcome', (q) =>
    q.eq('worldId', args.worldId).eq('outcomeId', args.outcomeId)).unique();
  if (!row || row.status === 'pending') return rejected('social_outcome_not_pending');
  if (row.outcomeEventId) return { ok: true as const, replay: true, eventId: row.outcomeEventId };
  if (!row.terminalEventId) return rejected('social_outcome_terminal_mismatch');
  const terminalEvent = await ctx.db.get(row.terminalEventId);
  if (terminalEvent && isMemorable(terminalEvent.type)) {
    await ctx.db.patch(row._id, { outcomeEventId: row.terminalEventId, updatedAt: args.now });
    return { ok: true as const, replay: false, eventId: row.terminalEventId };
  }
  const eventType = row.status === 'resolved'
    ? 'social_outcome_resolved'
    : row.status === 'failed'
      ? 'social_outcome_failed'
      : 'social_outcome_closed';
  const eventId = await appendWorldEvent(ctx, {
    worldId: args.worldId,
    type: eventType,
    createdAt: args.now,
    actorIds: [row.actorId],
    targetActorIds: row.targetActorIds,
    locationId: terminalEvent?.locationId,
    actionId: row.terminalActionId,
    visibility: row.audience === 'private' ? 'private' : 'local',
    summary: `有因社交「${row.topicRefs.join('、')}」以 ${row.status} 收束。`,
    facts: versionDurableEventFacts({
      resultCode: row.terminalResultCode ?? eventType,
      reasonCode: row.terminalReasonCode,
      migration: row.outcomeId,
    }),
    mapId: terminalEvent?.mapId,
  });
  const memorySourceRef = row.outcomeId;
  const memorySourceRevision = row.revision;
  const memoryEffectReceiptRef = `memory_event:${String(eventId)}`;
  const memoryOutcomeReceipt = projectDomainOutcomeEvidence({
    domain: 'memory',
    source: 'conversation_session',
    sourceRef: memorySourceRef,
    sourceRevision: memorySourceRevision,
    idempotencyKey: domainOutcomeEvidenceIdempotencyKey(
      'memory',
      memorySourceRef,
      memorySourceRevision,
    ),
    effectReceiptRef: memoryEffectReceiptRef,
    outcome: isMemorable(eventType) ? 'applied' : 'no_effect',
    replay: false,
  });
  const memoryAdmission = memoryOutcomeReceipt
    ? admitRelationshipMemoryOutcome({
        receipt: memoryOutcomeReceipt,
        expected: {
          domain: 'memory',
          source: 'conversation_session',
          sourceRef: memorySourceRef,
          sourceRevision: memorySourceRevision,
          effectReceiptRef: memoryEffectReceiptRef,
        },
      })
    : undefined;
  if (!memoryAdmission) throw new Error('social_outcome_memory_evidence_invalid');
  if (memoryAdmission.status === 'admitted') {
    await generateMemories(ctx, args.worldId, {
      eventId,
      type: eventType,
      visibility: row.audience === 'private' ? 'private' : 'local',
      actorIds: [row.actorId],
      targetActorIds: row.targetActorIds,
      locationId: terminalEvent?.locationId,
      summary: `有因社交「${row.topicRefs.join('、')}」以 ${row.status} 收束。`,
      createdAt: args.now,
    }, args.gameHour);
  }
  await ctx.db.patch(row._id, { outcomeEventId: eventId, updatedAt: args.now });
  return { ok: true as const, replay: false, eventId };
}

export function groupSocialOutcomeBinding(
  receipt: GroupSocialInitiationReceipt,
): SocialOutcomeBinding {
  const targetActorIds = receipt.participantActorIds
    .filter((actorId) => actorId !== receipt.hostActorId)
    .sort();
  const topicRefs = [...receipt.topicRefs].sort();
  return {
    contractVersion: SOCIAL_OUTCOME_VERSION,
    outcomeId: `social_outcome:${stableObservationDigest({
      warrantDigest: receipt.warrantDigest,
      candidateDigest: receipt.candidateDigest,
    })}`,
    scopeKey: `social_outcome_scope:group:${stableObservationDigest({
      sourceRef: receipt.sourceRef,
      intendedOutcome: 'reach_group_decision',
      topicRefs,
    })}`,
    actorId: receipt.hostActorId,
    targetActorIds,
    sourceRef: receipt.sourceRef,
    sourceRevision: receipt.sourceRevision,
    intendedOutcome: 'reach_group_decision',
    activity: 'group_decide',
    topicRefs,
    audience: receipt.audience,
    warrantId: receipt.warrantId,
    warrantDigest: receipt.warrantDigest,
    candidateId: receipt.candidateId,
    candidateDigest: receipt.candidateDigest,
    warrantCandidateDigest: groupSocialWarrantCandidateBindingDigest({
      warrantDigest: receipt.warrantDigest,
      candidateDigest: receipt.candidateDigest,
    }),
  };
}

export async function socialOutcomeScopeAvailable(
  ctx: MutationCtx | QueryCtx,
  worldId: Id<'worlds'>,
  scopeKey: string,
  nowGameHour: number,
) {
  const rows = await ctx.db.query('socialOutcomeReceipts').withIndex('byScope', (q) =>
    q.eq('worldId', worldId).eq('scopeKey', scopeKey)).collect();
  return !rows.some((row) => socialOutcomeScopeBlocked(row, nowGameHour));
}

/**
 * A terminal outcome closes the causal source, not merely the concrete
 * expression used to pursue it. This prevents a completed gift from becoming
 * a follow-up talk (or vice versa) for the same actor/targets/source/outcome.
 */
export async function socialOutcomeSourceAvailable(
  ctx: MutationCtx | QueryCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    targetActorIds: readonly string[];
    sourceRef: string;
    intendedOutcome: string;
    nowGameHour: number;
  },
) {
  const targets = [...new Set(args.targetActorIds)].sort();
  for (const status of ['pending', 'resolved', 'failed', 'cancelled', 'expired'] as const) {
    const rows = await ctx.db.query('socialOutcomeReceipts').withIndex('byActorStatus', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.actorId).eq('status', status),
    ).collect();
    if (rows.some((row) =>
      row.sourceRef === args.sourceRef &&
      row.intendedOutcome === args.intendedOutcome &&
      sameActorTargets(row.targetActorIds, targets) &&
      socialOutcomeScopeBlocked(row, args.nowGameHour),
    )) return false;
  }
  return true;
}

export function rowToReceipt(row: Doc<'socialOutcomeReceipts'>): SocialOutcomeReceipt {
  return {
    contractVersion: row.contractVersion,
    outcomeId: row.outcomeId,
    scopeKey: row.scopeKey,
    revision: row.revision,
    actorId: row.actorId,
    targetActorIds: row.targetActorIds,
    sourceRef: row.sourceRef,
    sourceRevision: row.sourceRevision,
    intendedOutcome: row.intendedOutcome,
    activity: row.activity,
    topicRefs: row.topicRefs,
    audience: row.audience,
    warrantId: row.warrantId,
    warrantDigest: row.warrantDigest,
    candidateId: row.candidateId,
    candidateDigest: row.candidateDigest,
    warrantCandidateDigest: row.warrantCandidateDigest,
    status: row.status,
    openedByActionId: String(row.openedByActionId),
    openedEventId: String(row.openedEventId),
    conversationId: row.conversationId,
    groupConversationId: row.groupConversationId,
    terminalActionId: row.terminalActionId ? String(row.terminalActionId) : undefined,
    terminalEventId: row.terminalEventId ? String(row.terminalEventId) : undefined,
    outcomeEventId: row.outcomeEventId ? String(row.outcomeEventId) : undefined,
    terminalResultCode: row.terminalResultCode,
    terminalReasonCode: row.terminalReasonCode,
    cooldownUntilGameHour: row.cooldownUntilGameHour,
    createdGameHour: row.createdGameHour,
    terminalGameHour: row.terminalGameHour,
  };
}

function sameOpening(
  row: Doc<'socialOutcomeReceipts'>,
  args: {
    binding: SocialOutcomeBinding;
    openedByActionId: Id<'actionRecords'>;
    openedEventId: Id<'worldEvents'>;
    conversationId?: string;
    groupConversationId?: string;
  },
) {
  return row.scopeKey === args.binding.scopeKey &&
    row.warrantDigest === args.binding.warrantDigest &&
    row.candidateDigest === args.binding.candidateDigest &&
    row.openedByActionId === args.openedByActionId &&
    row.openedEventId === args.openedEventId &&
    row.conversationId === args.conversationId &&
    row.groupConversationId === args.groupConversationId;
}

function rejected(reasonCode: string) {
  return { ok: false as const, reasonCode };
}

function sameActorTargets(left: readonly string[], right: readonly string[]) {
  const normalized = [...new Set(left)].sort();
  return normalized.length === right.length && normalized.every((value, index) => value === right[index]);
}
