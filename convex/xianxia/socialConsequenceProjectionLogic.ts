import { stableObservationDigest } from './lifeObservation';
import {
  SOCIAL_CONSEQUENCE_PROJECTION_VERSION,
  socialConsequenceProjectionIdentity,
  socialConsequenceProjectionSourceRef,
  socialConsequenceProjectionSourceRevision,
} from './socialConsequenceProjectionContracts';
import type { SocialConsequenceKind, SocialConsequenceStatus } from './socialConsequenceContracts';
import type { SameLocationSocialSource } from './sameLocationSocialOpportunityLogic';

export const GRATITUDE_CONSEQUENCE_PROJECTION_VERSION =
  'taixu.gratitude-consequence-projection.v1' as const;
export const GRIEVANCE_CONSEQUENCE_PROJECTION_VERSION =
  'taixu.grievance-consequence-projection.v1' as const;

export type GratitudeProjectionFailureReason =
  | 'social_consequence_projection_source_stale'
  | 'social_consequence_projection_not_due'
  | 'social_consequence_projection_expired'
  | 'social_consequence_projection_budget_exhausted'
  | 'social_consequence_projection_subject_mismatch'
  | 'social_consequence_projection_target_ineligible'
  | 'social_consequence_projection_disclosure_forbidden'
  | 'social_consequence_projection_cooldown_active'
  | 'social_consequence_projection_busy';

export type SocialConsequenceProjectionFact = {
  consequenceId: string;
  revision: number;
  sourceOutcomeId: string;
  sourceOutcomeRevision: number;
  sourceEventId: string;
  sourceRevision: string;
  sourceKind?: 'social_outcome' | 'action_terminal';
  sourceActionId?: string;
  sourceWarrantId?: string;
  actionTerminalEvidenceVerified?: boolean;
  sourceEventAssaultEvidenceCount?: number;
  kind: SocialConsequenceKind;
  subjectActorId: string;
  counterpartActorIds: string[];
  audience: 'private' | 'participants' | 'local_public';
  status: SocialConsequenceStatus;
  remainingProjectionBudget: number;
  dueGameHour?: number;
  expiresGameHour: number;
  createdGameHour: number;
};

export type GratitudeProjectionTargetFact = {
  actorId: string;
  locationId: string;
  aliveAndCapable: boolean;
  busy: boolean;
  disclosureAllowed: boolean;
  cooldownClear: boolean;
  giftCooldownClear: boolean;
  sessionCapacityAvailable: boolean;
};

export type GratitudeConsequenceProjectionInput = {
  nowGameHour: number;
  actor: {
    actorId: string;
    locationId: string;
    aliveAndCapable: boolean;
    busy: boolean;
    hasGiftableItem: boolean;
  };
  consequences: readonly SocialConsequenceProjectionFact[];
  targets: readonly GratitudeProjectionTargetFact[];
};

export type GratitudeConsequenceProjectionBundle = {
  contractVersion: typeof GRATITUDE_CONSEQUENCE_PROJECTION_VERSION;
  projectionSetDigest: string;
  sources: SameLocationSocialSource[];
  rejections: Array<{
    consequenceId: string;
    reasonCode: GratitudeProjectionFailureReason;
  }>;
};

export type GrievanceProjectionFailureReason =
  | GratitudeProjectionFailureReason
  | 'social_consequence_projection_source_kind_mismatch'
  | 'social_consequence_projection_evidence_missing';

export type GrievanceConsequenceProjectionInput = {
  nowGameHour: number;
  actor: {
    actorId: string;
    locationId: string;
    aliveAndCapable: boolean;
    busy: boolean;
  };
  consequences: readonly SocialConsequenceProjectionFact[];
  targets: readonly GratitudeProjectionTargetFact[];
};

export type GrievanceConsequenceProjectionBundle = {
  contractVersion: typeof GRIEVANCE_CONSEQUENCE_PROJECTION_VERSION;
  projectionSetDigest: string;
  sources: SameLocationSocialSource[];
  rejections: Array<{
    consequenceId: string;
    reasonCode: GrievanceProjectionFailureReason;
  }>;
};

export function projectGratitudeDueConsequences(
  input: GratitudeConsequenceProjectionInput,
): GratitudeConsequenceProjectionBundle {
  const nowGameHour = Math.max(0, Math.floor(input.nowGameHour));
  const targets = new Map(input.targets.map((target) => [target.actorId, target]));
  const sources: SameLocationSocialSource[] = [];
  const rejections: GratitudeConsequenceProjectionBundle['rejections'] = [];
  for (const consequence of [...input.consequences].sort(compareConsequences)) {
    if (consequence.kind !== 'gratitude_due') continue;
    const failure = gratitudeProjectionFailure(input, consequence, targets, nowGameHour);
    if (failure) {
      rejections.push({ consequenceId: consequence.consequenceId, reasonCode: failure });
      continue;
    }
    const target = targets.get(consequence.counterpartActorIds[0])!;
    const sourceRevision = socialConsequenceProjectionSourceRevision({
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
    const projection = socialConsequenceProjectionIdentity({
      consequenceId: consequence.consequenceId,
      consequenceRevision: consequence.revision,
      sourceOutcomeId: consequence.sourceOutcomeId,
      sourceOutcomeRevision: consequence.sourceOutcomeRevision,
      sourceEventId: consequence.sourceEventId,
      sourceRevision,
      kind: 'gratitude_due',
    });
    sources.push({
      contractVersion: 'taixu.same-location-social-source.v1',
      actorId: input.actor.actorId,
      targetActorId: target.actorId,
      kind: 'gratitude_or_repair',
      sourceRef: socialConsequenceProjectionSourceRef(consequence.consequenceId),
      sourceRevision,
      topicRefs: [
        `consequence:${consequence.consequenceId}`,
        `event:${consequence.sourceEventId}`,
        `outcome:${consequence.sourceOutcomeId}`,
      ].sort(),
      audience: consequence.audience,
      urgencyBand: 'routine',
      createdAt: consequence.dueGameHour!,
      expiresAt: consequence.expiresGameHour,
      locationId: input.actor.locationId,
      targetLocationId: target.locationId,
      preferredActivity:
        input.actor.hasGiftableItem && target.giftCooldownClear ? 'gift' : 'talk',
      targetRelevant: true,
      targetAliveAndCapable: target.aliveAndCapable,
      targetBusy: target.busy,
      targetCanFulfillOutcome: true,
      disclosureAllowed: target.disclosureAllowed,
      cooldownClear: target.cooldownClear,
      sessionCapacityAvailable: target.sessionCapacityAvailable,
      socialConsequenceProjection: projection,
    });
  }
  return {
    contractVersion: GRATITUDE_CONSEQUENCE_PROJECTION_VERSION,
    projectionSetDigest: stableObservationDigest({
      contractVersion: GRATITUDE_CONSEQUENCE_PROJECTION_VERSION,
      projectionContractVersion: SOCIAL_CONSEQUENCE_PROJECTION_VERSION,
      sources: sources.map((source) => ({
        sourceRef: source.sourceRef,
        sourceRevision: source.sourceRevision,
        targetActorId: source.targetActorId,
        projectionDigest: source.socialConsequenceProjection?.projectionDigest,
      })),
      rejections,
    }),
    sources,
    rejections,
  };
}

/**
 * Projects one optional, private conflict-resolution request from an exact
 * hostile body terminal. It never assumes that the attacker accepts,
 * compensates, apologizes, or reconciles; those require later real terminals.
 */
export function projectGrievanceCreatedConsequences(
  input: GrievanceConsequenceProjectionInput,
): GrievanceConsequenceProjectionBundle {
  const nowGameHour = Math.max(0, Math.floor(input.nowGameHour));
  const targets = new Map(input.targets.map((target) => [target.actorId, target]));
  const sources: SameLocationSocialSource[] = [];
  const rejections: GrievanceConsequenceProjectionBundle['rejections'] = [];
  for (const consequence of [...input.consequences].sort(compareConsequences)) {
    if (consequence.kind !== 'grievance_created') continue;
    const failure = grievanceProjectionFailure(input, consequence, targets, nowGameHour);
    if (failure) {
      rejections.push({ consequenceId: consequence.consequenceId, reasonCode: failure });
      continue;
    }
    const target = targets.get(consequence.counterpartActorIds[0])!;
    const sourceRevision = socialConsequenceProjectionSourceRevision({
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
    const projection = socialConsequenceProjectionIdentity({
      consequenceId: consequence.consequenceId,
      consequenceRevision: consequence.revision,
      sourceOutcomeId: consequence.sourceOutcomeId,
      sourceOutcomeRevision: consequence.sourceOutcomeRevision,
      sourceEventId: consequence.sourceEventId,
      sourceRevision,
      kind: 'grievance_created',
    });
    sources.push({
      contractVersion: 'taixu.same-location-social-source.v1',
      actorId: input.actor.actorId,
      targetActorId: target.actorId,
      kind: 'conflict_resolution',
      sourceRef: socialConsequenceProjectionSourceRef(consequence.consequenceId),
      sourceRevision,
      topicRefs: [
        `action:${consequence.sourceActionId}`,
        `consequence:${consequence.consequenceId}`,
        `event:${consequence.sourceEventId}`,
      ].sort(),
      audience: 'private',
      urgencyBand: 'important',
      createdAt: consequence.createdGameHour,
      expiresAt: consequence.expiresGameHour,
      locationId: input.actor.locationId,
      targetLocationId: target.locationId,
      preferredActivity: 'talk',
      targetRelevant: true,
      targetAliveAndCapable: target.aliveAndCapable,
      targetBusy: target.busy,
      targetCanFulfillOutcome: true,
      disclosureAllowed: target.disclosureAllowed,
      cooldownClear: target.cooldownClear,
      sessionCapacityAvailable: target.sessionCapacityAvailable,
      socialConsequenceProjection: projection,
    });
  }
  return {
    contractVersion: GRIEVANCE_CONSEQUENCE_PROJECTION_VERSION,
    projectionSetDigest: stableObservationDigest({
      contractVersion: GRIEVANCE_CONSEQUENCE_PROJECTION_VERSION,
      projectionContractVersion: SOCIAL_CONSEQUENCE_PROJECTION_VERSION,
      sources: sources.map((source) => ({
        sourceRef: source.sourceRef,
        sourceRevision: source.sourceRevision,
        targetActorId: source.targetActorId,
        projectionDigest: source.socialConsequenceProjection?.projectionDigest,
      })),
      rejections,
    }),
    sources,
    rejections,
  };
}

function gratitudeProjectionFailure(
  input: GratitudeConsequenceProjectionInput,
  consequence: SocialConsequenceProjectionFact,
  targets: ReadonlyMap<string, GratitudeProjectionTargetFact>,
  nowGameHour: number,
): GratitudeProjectionFailureReason | undefined {
  if (
    consequence.status === 'expired' ||
    (consequence.status === 'active' && nowGameHour >= consequence.expiresGameHour)
  ) return 'social_consequence_projection_expired';
  if (consequence.status !== 'active') return 'social_consequence_projection_source_stale';
  if (consequence.remainingProjectionBudget <= 0) {
    return 'social_consequence_projection_budget_exhausted';
  }
  if (consequence.dueGameHour === undefined || nowGameHour < consequence.dueGameHour) {
    return 'social_consequence_projection_not_due';
  }
  if (
    consequence.subjectActorId !== input.actor.actorId ||
    consequence.counterpartActorIds.length !== 1 ||
    consequence.counterpartActorIds[0] === input.actor.actorId
  ) return 'social_consequence_projection_subject_mismatch';
  if (!input.actor.aliveAndCapable || input.actor.busy) {
    return 'social_consequence_projection_busy';
  }
  const target = targets.get(consequence.counterpartActorIds[0]);
  if (
    !target ||
    !target.aliveAndCapable ||
    target.locationId !== input.actor.locationId
  ) return 'social_consequence_projection_target_ineligible';
  if (target.busy) return 'social_consequence_projection_busy';
  if (!target.disclosureAllowed || consequence.audience === 'private') {
    return 'social_consequence_projection_disclosure_forbidden';
  }
  if (!target.cooldownClear) return 'social_consequence_projection_cooldown_active';
  if (!target.sessionCapacityAvailable) return 'social_consequence_projection_busy';
  return undefined;
}

function grievanceProjectionFailure(
  input: GrievanceConsequenceProjectionInput,
  consequence: SocialConsequenceProjectionFact,
  targets: ReadonlyMap<string, GratitudeProjectionTargetFact>,
  nowGameHour: number,
): GrievanceProjectionFailureReason | undefined {
  if (
    consequence.status === 'expired' ||
    (consequence.status === 'active' && nowGameHour >= consequence.expiresGameHour)
  ) return 'social_consequence_projection_expired';
  if (consequence.status !== 'active') return 'social_consequence_projection_source_stale';
  if (consequence.remainingProjectionBudget <= 0) {
    return 'social_consequence_projection_budget_exhausted';
  }
  if (
    consequence.subjectActorId !== input.actor.actorId ||
    consequence.counterpartActorIds.length !== 1 ||
    consequence.counterpartActorIds[0] === input.actor.actorId
  ) return 'social_consequence_projection_subject_mismatch';
  if (
    consequence.sourceKind !== 'action_terminal' ||
    consequence.sourceWarrantId !== undefined ||
    !consequence.sourceActionId
  ) return 'social_consequence_projection_source_kind_mismatch';
  if (
    consequence.actionTerminalEvidenceVerified !== true ||
    consequence.sourceEventAssaultEvidenceCount !== 1
  ) return 'social_consequence_projection_evidence_missing';
  if (!input.actor.aliveAndCapable || input.actor.busy) {
    return 'social_consequence_projection_busy';
  }
  const target = targets.get(consequence.counterpartActorIds[0]);
  if (!target || !target.aliveAndCapable || target.locationId !== input.actor.locationId) {
    return 'social_consequence_projection_target_ineligible';
  }
  if (target.busy) return 'social_consequence_projection_busy';
  if (consequence.audience !== 'private' || !target.disclosureAllowed) {
    return 'social_consequence_projection_disclosure_forbidden';
  }
  if (!target.cooldownClear) return 'social_consequence_projection_cooldown_active';
  if (!target.sessionCapacityAvailable) return 'social_consequence_projection_busy';
  return undefined;
}

function compareConsequences(
  left: SocialConsequenceProjectionFact,
  right: SocialConsequenceProjectionFact,
) {
  return (
    (left.dueGameHour ?? Number.MAX_SAFE_INTEGER) -
      (right.dueGameHour ?? Number.MAX_SAFE_INTEGER) ||
    left.consequenceId.localeCompare(right.consequenceId)
  );
}
