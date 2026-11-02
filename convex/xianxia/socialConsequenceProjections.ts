import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type { SocialOutcomeBinding } from './socialOutcomeContracts';
import {
  socialConsequenceProjectionSourceRef,
  socialConsequenceProjectionSourceRevision,
} from './socialConsequenceProjectionContracts';
import { grievanceProjectionSourceEvidenceValid } from './socialConsequenceContracts';

export type SocialConsequenceProjectionConsumptionFailure =
  | 'social_consequence_projection_source_missing'
  | 'social_consequence_projection_source_stale'
  | 'social_consequence_projection_not_due'
  | 'social_consequence_projection_expired'
  | 'social_consequence_projection_budget_exhausted'
  | 'social_consequence_projection_subject_mismatch'
  | 'social_consequence_projection_disclosure_forbidden'
  | 'social_consequence_projection_source_kind_mismatch'
  | 'social_consequence_projection_evidence_missing'
  | 'social_consequence_projection_conflict';

/**
 * Consumes an exact consequence projection only after the ordinary action has
 * passed its rules, but before its SocialOutcome receipt is opened. The caller
 * runs in the same mutation as ActionRecord/event creation, so any failure
 * rolls every write back together.
 */
export async function consumeSocialConsequenceProjectionTx(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    binding: SocialOutcomeBinding;
    gameHour: number;
    now: number;
  },
): Promise<
  | { ok: true; consumed: false }
  | { ok: true; consumed: true; consequenceId: string; previousRevision: number }
  | { ok: false; reasonCode: SocialConsequenceProjectionConsumptionFailure }
> {
  const consequenceId = consequenceIdFromSourceRef(args.binding.sourceRef);
  if (!consequenceId) return { ok: true, consumed: false };
  const consequence = await ctx.db.query('socialConsequences').withIndex('byConsequence', (q) =>
    q.eq('worldId', args.worldId).eq('consequenceId', consequenceId)).unique();
  if (!consequence) return rejected('social_consequence_projection_source_missing');
  if (!['gratitude_due', 'grievance_created'].includes(consequence.kind)) {
    return rejected('social_consequence_projection_source_stale');
  }
  if (
    consequence.status === 'expired' ||
    (consequence.status === 'active' && args.gameHour >= consequence.expiresGameHour)
  ) return rejected('social_consequence_projection_expired');
  if (consequence.status !== 'active') {
    return rejected('social_consequence_projection_source_stale');
  }
  if (
    (consequence.kind === 'gratitude_due' &&
      (consequence.sourceKind !== 'social_outcome' || consequence.sourceWarrantId === undefined)) ||
    (consequence.kind === 'grievance_created' &&
      (consequence.sourceKind !== 'action_terminal' || consequence.sourceWarrantId !== undefined))
  ) return rejected('social_consequence_projection_source_kind_mismatch');
  const expectedRevision = socialConsequenceProjectionSourceRevision({
    consequenceId: consequence.consequenceId,
    consequenceRevision: consequence.revision,
    sourceOutcomeId: consequence.sourceOutcomeId,
    sourceOutcomeRevision: consequence.sourceOutcomeRevision,
    sourceRevision: consequence.sourceRevision,
    status: consequence.status,
    remainingProjectionBudget: consequence.remainingProjectionBudget,
    dueGameHour: consequence.dueGameHour,
    expiresGameHour: consequence.expiresGameHour,
  });
  if (
    args.binding.sourceRef !== socialConsequenceProjectionSourceRef(consequence.consequenceId) ||
    args.binding.sourceRevision !== expectedRevision
  ) return rejected('social_consequence_projection_source_stale');
  if (
    consequence.kind === 'gratitude_due' &&
    (consequence.dueGameHour === undefined || args.gameHour < consequence.dueGameHour)
  ) {
    return rejected('social_consequence_projection_not_due');
  }
  if (consequence.remainingProjectionBudget <= 0) {
    return rejected('social_consequence_projection_budget_exhausted');
  }
  const targets = [...new Set(args.binding.targetActorIds)].sort();
  const counterparts = [...new Set(consequence.counterpartActorIds)].sort();
  const expectedOutcome = consequence.kind === 'grievance_created'
    ? 'mediate_or_negotiate'
    : 'thank_apologize_or_repair';
  if (
    args.binding.actorId !== consequence.subjectActorId ||
    args.binding.intendedOutcome !== expectedOutcome ||
    (consequence.kind === 'grievance_created' && args.binding.activity !== 'talk') ||
    targets.length !== 1 ||
    counterparts.length !== 1 ||
    targets[0] !== counterparts[0] ||
    targets[0] === args.binding.actorId
  ) return rejected('social_consequence_projection_subject_mismatch');
  if (args.binding.audience !== consequence.audience) {
    return rejected('social_consequence_projection_disclosure_forbidden');
  }
  if (consequence.kind === 'gratitude_due') {
    const [sourceOutcome, sourceEvent] = await Promise.all([
      ctx.db.query('socialOutcomeReceipts').withIndex('byOutcome', (q) =>
        q.eq('worldId', args.worldId).eq('outcomeId', consequence.sourceOutcomeId)).unique(),
      ctx.db.get(consequence.sourceEventId),
    ]);
    if (!sourceOutcome || !sourceEvent) {
      return rejected('social_consequence_projection_source_missing');
    }
    if (
      sourceOutcome.revision !== consequence.sourceOutcomeRevision ||
      sourceOutcome.status !== 'resolved' ||
      sourceOutcome.terminalActionId !== consequence.sourceActionId ||
      sourceOutcome.terminalEventId !== consequence.sourceEventId ||
      sourceEvent.actionId !== consequence.sourceActionId
    ) return rejected('social_consequence_projection_source_stale');
  } else {
    const sourceActionId = ctx.db.normalizeId('actionRecords', consequence.sourceActionId);
    const [sourceAction, sourceEvent, assaultEvidence] = await Promise.all([
      sourceActionId ? ctx.db.get(sourceActionId) : Promise.resolve(null),
      ctx.db.get(consequence.sourceEventId),
      ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) =>
        q.eq('worldId', args.worldId).eq('sourceEventId', String(consequence.sourceEventId)),
      ).collect(),
    ]);
    if (!sourceAction || !sourceEvent || assaultEvidence.length === 0) {
      return rejected('social_consequence_projection_evidence_missing');
    }
    if (!grievanceProjectionSourceEvidenceValid({
      consequence: {
        sourceKind: consequence.sourceKind,
        sourceActionId: consequence.sourceActionId,
        sourceEventId: String(consequence.sourceEventId),
        sourceOutcomeId: consequence.sourceOutcomeId,
        sourceOutcomeRevision: consequence.sourceOutcomeRevision,
        sourceWarrantId: consequence.sourceWarrantId,
        sourceRevision: consequence.sourceRevision,
        subjectActorId: consequence.subjectActorId,
        counterpartActorIds: consequence.counterpartActorIds,
      },
      action: {
        id: String(sourceAction._id), type: sourceAction.type, status: sourceAction.status,
        actorId: sourceAction.actorId, targetActorId: sourceAction.targetActorId,
      },
      event: {
        _id: String(sourceEvent._id), worldId: String(sourceEvent.worldId),
        type: sourceEvent.type, actorIds: sourceEvent.actorIds,
        targetActorIds: sourceEvent.targetActorIds, actionId: sourceEvent.actionId
          ? String(sourceEvent.actionId) : undefined,
        facts: sourceEvent.facts,
      },
      assaultEvidence: assaultEvidence.map((row) => ({
        sourceEventId: row.sourceEventId, fromActorId: row.fromActorId,
        toActorId: row.toActorId, effectKind: row.effectKind,
      })),
    })) return rejected('social_consequence_projection_source_stale');
  }
  if (consequence.remainingProjectionBudget !== 1) {
    return rejected('social_consequence_projection_conflict');
  }
  await ctx.db.patch(consequence._id, {
    revision: consequence.revision + 1,
    remainingProjectionBudget: 0,
    updatedAt: args.now,
  });
  return {
    ok: true,
    consumed: true,
    consequenceId: consequence.consequenceId,
    previousRevision: consequence.revision,
  };
}

function consequenceIdFromSourceRef(sourceRef: string) {
  if (!sourceRef.startsWith('consequence:')) return undefined;
  const consequenceId = sourceRef.slice('consequence:'.length);
  return consequenceId.length > 0 ? consequenceId : undefined;
}

function rejected(reasonCode: SocialConsequenceProjectionConsumptionFailure) {
  return { ok: false as const, reasonCode };
}
