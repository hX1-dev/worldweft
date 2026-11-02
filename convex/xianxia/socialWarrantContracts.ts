import { type Infer, v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';

export const SOCIAL_WARRANT_VERSION = 'taixu.social-warrant.v1' as const;
export const SOCIAL_OPPORTUNITY_CANDIDATE_VERSION =
  'taixu.social-opportunity-candidate.v1' as const;

export const socialWarrantKindValidator = v.union(
  v.literal('care_or_aid'),
  v.literal('active_obligation'),
  v.literal('resource_coordination'),
  v.literal('knowledge_gap'),
  v.literal('teaching_or_advice'),
  v.literal('relationship_maintenance'),
  v.literal('gratitude_or_repair'),
  v.literal('conflict_resolution'),
  v.literal('shared_activity'),
  v.literal('collective_event'),
);

export const socialWarrantOutcomeValidator = v.union(
  v.literal('request_aid'),
  v.literal('respond_to_request'),
  v.literal('trade_or_coordinate'),
  v.literal('ask_or_verify'),
  v.literal('teach_or_advise'),
  v.literal('maintain_bond'),
  v.literal('thank_apologize_or_repair'),
  v.literal('mediate_or_negotiate'),
  v.literal('join_shared_activity'),
  v.literal('reach_group_decision'),
);

export const socialWarrantAudienceValidator = v.union(
  v.literal('private'),
  v.literal('participants'),
  v.literal('local_public'),
);

export const socialWarrantUrgencyValidator = v.union(
  v.literal('critical'),
  v.literal('important'),
  v.literal('routine'),
);

export const socialOpportunityModeValidator = v.union(
  v.literal('start_direct_conversation'),
  v.literal('invite_then_travel'),
  v.literal('respond_to_invitation'),
  v.literal('start_group_conversation'),
  v.literal('wait'),
);

export const socialOpportunityActivityValidator = v.union(
  v.literal('talk'),
  v.literal('gift'),
  v.literal('trade'),
  v.literal('teach'),
  v.literal('negotiate'),
  v.literal('group_decide'),
  v.literal('wait'),
);

export const socialWarrantValidator = v.object({
  contractVersion: v.literal(SOCIAL_WARRANT_VERSION),
  warrantId: v.string(),
  actorId: v.string(),
  kind: socialWarrantKindValidator,
  sourceRef: v.string(),
  sourceRevision: v.string(),
  intendedOutcome: socialWarrantOutcomeValidator,
  eligibleTargetActorIds: v.array(v.string()),
  topicRefs: v.array(v.string()),
  audience: socialWarrantAudienceValidator,
  urgencyBand: socialWarrantUrgencyValidator,
  createdAt: v.number(),
  expiresAt: v.number(),
});

export const socialOpportunityCandidateValidator = v.object({
  contractVersion: v.literal(SOCIAL_OPPORTUNITY_CANDIDATE_VERSION),
  candidateId: v.string(),
  warrantId: v.string(),
  mode: socialOpportunityModeValidator,
  targetActorIds: v.array(v.string()),
  meetingLocationId: v.optional(v.string()),
  intendedActivity: socialOpportunityActivityValidator,
  summary: v.string(),
});

export type SocialWarrantKind = Infer<typeof socialWarrantKindValidator>;
export type SocialWarrantOutcome = Infer<typeof socialWarrantOutcomeValidator>;
export type SocialWarrantAudience = Infer<typeof socialWarrantAudienceValidator>;
export type SocialWarrantUrgency = Infer<typeof socialWarrantUrgencyValidator>;
export type SocialOpportunityMode = Infer<typeof socialOpportunityModeValidator>;
export type SocialOpportunityActivity = Infer<typeof socialOpportunityActivityValidator>;
export type SocialWarrant = Infer<typeof socialWarrantValidator>;
export type SocialOpportunityCandidate = Infer<typeof socialOpportunityCandidateValidator>;

export type SocialWarrantFailureReason =
  | 'social_warrant_not_object'
  | 'social_warrant_unknown_field'
  | 'social_warrant_unsupported_version'
  | 'social_warrant_id_invalid'
  | 'social_warrant_actor_invalid'
  | 'social_warrant_kind_invalid'
  | 'social_warrant_source_ref_invalid'
  | 'social_warrant_source_revision_invalid'
  | 'social_warrant_outcome_invalid'
  | 'social_warrant_kind_outcome_mismatch'
  | 'social_warrant_target_invalid'
  | 'social_warrant_target_duplicate'
  | 'social_warrant_topic_invalid'
  | 'social_warrant_topic_duplicate'
  | 'social_warrant_audience_invalid'
  | 'social_warrant_urgency_invalid'
  | 'social_warrant_time_invalid';

export type SocialOpportunityCandidateFailureReason =
  | 'social_candidate_not_object'
  | 'social_candidate_unknown_field'
  | 'social_candidate_unsupported_version'
  | 'social_candidate_id_invalid'
  | 'social_candidate_warrant_id_invalid'
  | 'social_candidate_mode_invalid'
  | 'social_candidate_target_invalid'
  | 'social_candidate_target_duplicate'
  | 'social_candidate_location_invalid'
  | 'social_candidate_activity_invalid'
  | 'social_candidate_mode_mismatch'
  | 'social_candidate_summary_invalid'
  | 'social_candidate_warrant_mismatch'
  | 'social_candidate_target_ineligible'
  | 'social_candidate_outcome_mismatch';

export type SocialRuntimeReasonCode =
  | 'social_source_stale'
  | 'social_warrant_missing'
  | 'social_target_irrelevant'
  | 'social_target_busy'
  | 'social_target_unavailable'
  | 'social_target_declined'
  | 'social_target_moved'
  | 'social_disclosure_forbidden'
  | 'social_cooldown_active'
  | 'social_session_capacity_full'
  | 'social_meeting_location_invalid'
  | 'social_invitation_expired'
  | 'social_group_insufficient_participants'
  | 'social_group_topic_not_shared';

export type SocialTargetLatestFacts = {
  actorId: string;
  relevant: boolean;
  aliveAndCapable: boolean;
  busy: boolean;
  visibleOrKnownReachable: boolean;
  declined: boolean;
  moved: boolean;
  canFulfillOutcome: boolean;
};

export type SocialOpportunityLatestFacts = {
  now: number;
  source?: {
    sourceRef: string;
    sourceRevision: string;
  };
  actorAliveAndCapable: boolean;
  actorBusy: boolean;
  targetFacts: SocialTargetLatestFacts[];
  disclosureAllowed: boolean;
  cooldownClear: boolean;
  sessionCapacityAvailable: boolean;
  meetingLocationValid: boolean;
  invitationState: 'not_required' | 'pending' | 'accepted' | 'declined' | 'expired';
  sharedTopicRefs: string[];
};

export const SOCIAL_RUNTIME_REASON_CODES: readonly SocialRuntimeReasonCode[] = Object.freeze([
  'social_source_stale',
  'social_warrant_missing',
  'social_target_irrelevant',
  'social_target_busy',
  'social_target_unavailable',
  'social_target_declined',
  'social_target_moved',
  'social_disclosure_forbidden',
  'social_cooldown_active',
  'social_session_capacity_full',
  'social_meeting_location_invalid',
  'social_invitation_expired',
  'social_group_insufficient_participants',
  'social_group_topic_not_shared',
]);

export type SocialWarrantValidation =
  | {
      ok: true;
      warrant: SocialWarrant;
      canonical: string;
      digest: string;
    }
  | { ok: false; reasonCode: SocialWarrantFailureReason };

export type SocialOpportunityCandidateValidation =
  | {
      ok: true;
      candidate: SocialOpportunityCandidate;
      canonical: string;
      digest: string;
      warrantCandidateDigest?: string;
    }
  | { ok: false; reasonCode: SocialOpportunityCandidateFailureReason };

const KINDS = new Set<SocialWarrantKind>([
  'care_or_aid',
  'active_obligation',
  'resource_coordination',
  'knowledge_gap',
  'teaching_or_advice',
  'relationship_maintenance',
  'gratitude_or_repair',
  'conflict_resolution',
  'shared_activity',
  'collective_event',
]);

const OUTCOMES = new Set<SocialWarrantOutcome>([
  'request_aid',
  'respond_to_request',
  'trade_or_coordinate',
  'ask_or_verify',
  'teach_or_advise',
  'maintain_bond',
  'thank_apologize_or_repair',
  'mediate_or_negotiate',
  'join_shared_activity',
  'reach_group_decision',
]);

const EXPECTED_OUTCOME: Readonly<Record<SocialWarrantKind, SocialWarrantOutcome>> = {
  care_or_aid: 'request_aid',
  active_obligation: 'respond_to_request',
  resource_coordination: 'trade_or_coordinate',
  knowledge_gap: 'ask_or_verify',
  teaching_or_advice: 'teach_or_advise',
  relationship_maintenance: 'maintain_bond',
  gratitude_or_repair: 'thank_apologize_or_repair',
  conflict_resolution: 'mediate_or_negotiate',
  shared_activity: 'join_shared_activity',
  collective_event: 'reach_group_decision',
};

const AUDIENCES = new Set<SocialWarrantAudience>([
  'private',
  'participants',
  'local_public',
]);
const URGENCY_BANDS = new Set<SocialWarrantUrgency>(['critical', 'important', 'routine']);
const MODES = new Set<SocialOpportunityMode>([
  'start_direct_conversation',
  'invite_then_travel',
  'respond_to_invitation',
  'start_group_conversation',
  'wait',
]);
const ACTIVITIES = new Set<SocialOpportunityActivity>([
  'talk',
  'gift',
  'trade',
  'teach',
  'negotiate',
  'group_decide',
  'wait',
]);

const OUTCOME_ACTIVITIES: Readonly<
  Record<SocialWarrantOutcome, ReadonlySet<SocialOpportunityActivity>>
> = {
  request_aid: new Set(['talk', 'trade', 'teach']),
  respond_to_request: new Set(['talk', 'gift', 'trade', 'teach']),
  trade_or_coordinate: new Set(['trade', 'negotiate']),
  ask_or_verify: new Set(['talk', 'teach']),
  teach_or_advise: new Set(['talk', 'teach']),
  maintain_bond: new Set(['talk', 'gift']),
  thank_apologize_or_repair: new Set(['talk', 'gift']),
  mediate_or_negotiate: new Set(['talk', 'negotiate']),
  join_shared_activity: new Set(['talk', 'group_decide']),
  reach_group_decision: new Set(['group_decide']),
};

const WARRANT_KEYS = new Set([
  'contractVersion',
  'warrantId',
  'actorId',
  'kind',
  'sourceRef',
  'sourceRevision',
  'intendedOutcome',
  'eligibleTargetActorIds',
  'topicRefs',
  'audience',
  'urgencyBand',
  'createdAt',
  'expiresAt',
]);

const CANDIDATE_KEYS = new Set([
  'contractVersion',
  'candidateId',
  'warrantId',
  'mode',
  'targetActorIds',
  'meetingLocationId',
  'intendedActivity',
  'summary',
]);

export function validateSocialWarrant(input: unknown): SocialWarrantValidation {
  if (!isRecord(input)) return { ok: false, reasonCode: 'social_warrant_not_object' };
  if (input.contractVersion !== SOCIAL_WARRANT_VERSION) {
    return { ok: false, reasonCode: 'social_warrant_unsupported_version' };
  }
  if (!hasExactKeys(input, WARRANT_KEYS)) {
    return { ok: false, reasonCode: 'social_warrant_unknown_field' };
  }
  if (!validIdentifier(input.warrantId, 192)) {
    return { ok: false, reasonCode: 'social_warrant_id_invalid' };
  }
  if (!validIdentifier(input.actorId, 192)) {
    return { ok: false, reasonCode: 'social_warrant_actor_invalid' };
  }
  if (!KINDS.has(input.kind as SocialWarrantKind)) {
    return { ok: false, reasonCode: 'social_warrant_kind_invalid' };
  }
  if (!validReference(input.sourceRef, 256)) {
    return { ok: false, reasonCode: 'social_warrant_source_ref_invalid' };
  }
  if (!validBoundedString(input.sourceRevision, 192)) {
    return { ok: false, reasonCode: 'social_warrant_source_revision_invalid' };
  }
  if (!OUTCOMES.has(input.intendedOutcome as SocialWarrantOutcome)) {
    return { ok: false, reasonCode: 'social_warrant_outcome_invalid' };
  }
  const kind = input.kind as SocialWarrantKind;
  const intendedOutcome = input.intendedOutcome as SocialWarrantOutcome;
  if (EXPECTED_OUTCOME[kind] !== intendedOutcome) {
    return { ok: false, reasonCode: 'social_warrant_kind_outcome_mismatch' };
  }
  const targets = validateStringSet(input.eligibleTargetActorIds, {
    minimum: 1,
    maximum: 12,
    valid: (value) => validIdentifier(value, 192) && value !== input.actorId,
  });
  if (targets === 'invalid') {
    return { ok: false, reasonCode: 'social_warrant_target_invalid' };
  }
  if (targets === 'duplicate') {
    return { ok: false, reasonCode: 'social_warrant_target_duplicate' };
  }
  const topics = validateStringSet(input.topicRefs, {
    minimum: 1,
    maximum: 12,
    valid: (value) => validReference(value, 256),
  });
  if (topics === 'invalid') {
    return { ok: false, reasonCode: 'social_warrant_topic_invalid' };
  }
  if (topics === 'duplicate') {
    return { ok: false, reasonCode: 'social_warrant_topic_duplicate' };
  }
  if (!AUDIENCES.has(input.audience as SocialWarrantAudience)) {
    return { ok: false, reasonCode: 'social_warrant_audience_invalid' };
  }
  if (!URGENCY_BANDS.has(input.urgencyBand as SocialWarrantUrgency)) {
    return { ok: false, reasonCode: 'social_warrant_urgency_invalid' };
  }
  if (
    !nonnegativeSafeInteger(input.createdAt) ||
    !nonnegativeSafeInteger(input.expiresAt) ||
    input.expiresAt <= input.createdAt
  ) {
    return { ok: false, reasonCode: 'social_warrant_time_invalid' };
  }

  const warrant = clone({
    ...(input as SocialWarrant),
    eligibleTargetActorIds: targets,
    topicRefs: topics,
  });
  return {
    ok: true,
    warrant,
    canonical: canonicalJson(warrant),
    digest: stableObservationDigest(warrant),
  };
}

export function validateSocialOpportunityCandidate(
  input: unknown,
  warrant?: SocialWarrant,
): SocialOpportunityCandidateValidation {
  if (!isRecord(input)) return { ok: false, reasonCode: 'social_candidate_not_object' };
  if (input.contractVersion !== SOCIAL_OPPORTUNITY_CANDIDATE_VERSION) {
    return { ok: false, reasonCode: 'social_candidate_unsupported_version' };
  }
  if (!hasExactKeys(input, CANDIDATE_KEYS)) {
    return { ok: false, reasonCode: 'social_candidate_unknown_field' };
  }
  if (!validIdentifier(input.candidateId, 192)) {
    return { ok: false, reasonCode: 'social_candidate_id_invalid' };
  }
  if (!validIdentifier(input.warrantId, 192)) {
    return { ok: false, reasonCode: 'social_candidate_warrant_id_invalid' };
  }
  if (!MODES.has(input.mode as SocialOpportunityMode)) {
    return { ok: false, reasonCode: 'social_candidate_mode_invalid' };
  }
  const targets = validateStringSet(input.targetActorIds, {
    minimum: 0,
    maximum: 5,
    valid: (value) => validIdentifier(value, 192),
  });
  if (targets === 'invalid') {
    return { ok: false, reasonCode: 'social_candidate_target_invalid' };
  }
  if (targets === 'duplicate') {
    return { ok: false, reasonCode: 'social_candidate_target_duplicate' };
  }
  if (
    input.meetingLocationId !== undefined &&
    !validIdentifier(input.meetingLocationId, 192)
  ) {
    return { ok: false, reasonCode: 'social_candidate_location_invalid' };
  }
  if (!ACTIVITIES.has(input.intendedActivity as SocialOpportunityActivity)) {
    return { ok: false, reasonCode: 'social_candidate_activity_invalid' };
  }
  const mode = input.mode as SocialOpportunityMode;
  const activity = input.intendedActivity as SocialOpportunityActivity;
  if (!candidateShapeMatches(mode, targets.length, input.meetingLocationId, activity)) {
    return { ok: false, reasonCode: 'social_candidate_mode_mismatch' };
  }
  if (!validBoundedString(input.summary, 120)) {
    return { ok: false, reasonCode: 'social_candidate_summary_invalid' };
  }
  if (warrant) {
    const validatedWarrant = validateSocialWarrant(warrant);
    if (!validatedWarrant.ok || input.warrantId !== validatedWarrant.warrant.warrantId) {
      return { ok: false, reasonCode: 'social_candidate_warrant_mismatch' };
    }
    const eligible = new Set(validatedWarrant.warrant.eligibleTargetActorIds);
    if (targets.some((target) => !eligible.has(target))) {
      return { ok: false, reasonCode: 'social_candidate_target_ineligible' };
    }
    if (
      activity !== 'wait' &&
      !OUTCOME_ACTIVITIES[validatedWarrant.warrant.intendedOutcome].has(activity)
    ) {
      return { ok: false, reasonCode: 'social_candidate_outcome_mismatch' };
    }
  }

  const candidate = clone({
    ...(input as SocialOpportunityCandidate),
    targetActorIds: targets,
  });
  return {
    ok: true,
    candidate,
    canonical: canonicalJson(candidate),
    digest: stableObservationDigest(candidate),
    warrantCandidateDigest: warrant
      ? socialWarrantCandidateDigest(warrant, candidate)
      : undefined,
  };
}

export function canonicalSocialWarrant(warrant: SocialWarrant) {
  return canonicalJson(normalizedSocialWarrant(warrant));
}

export function canonicalSocialOpportunityCandidate(candidate: SocialOpportunityCandidate) {
  return canonicalJson(normalizedSocialOpportunityCandidate(candidate));
}

export function socialWarrantDigest(warrant: SocialWarrant) {
  return stableObservationDigest(normalizedSocialWarrant(warrant));
}

export function socialOpportunityCandidateDigest(candidate: SocialOpportunityCandidate) {
  return stableObservationDigest(normalizedSocialOpportunityCandidate(candidate));
}

export function socialWarrantCandidateDigest(
  warrant: SocialWarrant,
  candidate: SocialOpportunityCandidate,
) {
  return stableObservationDigest({
    warrant: normalizedSocialWarrant(warrant),
    candidate: normalizedSocialOpportunityCandidate(candidate),
  });
}

export function revalidateSocialOpportunityCandidate(
  warrant: SocialWarrant,
  candidate: SocialOpportunityCandidate,
  latest: SocialOpportunityLatestFacts,
): SocialRuntimeReasonCode | undefined {
  const validatedWarrant = validateSocialWarrant(warrant);
  const validatedCandidate = validateSocialOpportunityCandidate(candidate, warrant);
  if (!validatedWarrant.ok || !validatedCandidate.ok) return 'social_warrant_missing';
  if (
    !latest.source ||
    latest.source.sourceRef !== warrant.sourceRef ||
    latest.source.sourceRevision !== warrant.sourceRevision ||
    !nonnegativeSafeInteger(latest.now) ||
    latest.now < warrant.createdAt ||
    latest.now >= warrant.expiresAt
  ) {
    return 'social_source_stale';
  }
  if (!latest.actorAliveAndCapable || latest.actorBusy) return 'social_target_unavailable';
  if (!latest.disclosureAllowed) return 'social_disclosure_forbidden';
  if (!latest.cooldownClear) return 'social_cooldown_active';
  if (!latest.sessionCapacityAvailable) return 'social_session_capacity_full';
  if (
    candidate.meetingLocationId !== undefined &&
    !latest.meetingLocationValid
  ) {
    return 'social_meeting_location_invalid';
  }
  if (latest.invitationState === 'expired') return 'social_invitation_expired';
  if (latest.invitationState === 'declined') return 'social_target_declined';

  const targets = new Map(latest.targetFacts.map((target) => [target.actorId, target]));
  for (const actorId of candidate.targetActorIds) {
    const target = targets.get(actorId);
    if (!target || !target.aliveAndCapable || !target.visibleOrKnownReachable) {
      return 'social_target_unavailable';
    }
    if (!target.relevant || !target.canFulfillOutcome) return 'social_target_irrelevant';
    if (target.declined) return 'social_target_declined';
    if (target.moved) return 'social_target_moved';
    if (target.busy) return 'social_target_busy';
  }

  if (candidate.mode === 'start_group_conversation') {
    // targetActorIds excludes the host. C021b0d fixes the total group at 3..5,
    // therefore a valid group candidate carries 2..4 targets.
    if (candidate.targetActorIds.length < 2) return 'social_group_insufficient_participants';
    const sharedTopics = new Set(latest.sharedTopicRefs);
    if (!warrant.topicRefs.some((topicRef) => sharedTopics.has(topicRef))) {
      return 'social_group_topic_not_shared';
    }
  }
  return undefined;
}

function normalizedSocialWarrant(warrant: SocialWarrant): SocialWarrant {
  return {
    ...warrant,
    eligibleTargetActorIds: [...warrant.eligibleTargetActorIds].sort(compareText),
    topicRefs: [...warrant.topicRefs].sort(compareText),
  };
}

function normalizedSocialOpportunityCandidate(
  candidate: SocialOpportunityCandidate,
): SocialOpportunityCandidate {
  return {
    ...candidate,
    targetActorIds: [...candidate.targetActorIds].sort(compareText),
  };
}

function candidateShapeMatches(
  mode: SocialOpportunityMode,
  targetCount: number,
  meetingLocationId: unknown,
  activity: SocialOpportunityActivity,
) {
  const hasMeetingLocation = meetingLocationId !== undefined;
  switch (mode) {
    case 'start_direct_conversation':
      return targetCount === 1 && !hasMeetingLocation && directActivity(activity);
    case 'invite_then_travel':
    case 'respond_to_invitation':
      return targetCount === 1 && hasMeetingLocation && directActivity(activity);
    case 'start_group_conversation':
      // targetActorIds excludes the warrant owner/host. C014 requires 3..5
      // total participants, so a group candidate names exactly 2..4 others.
      return targetCount >= 2 && targetCount <= 4 && hasMeetingLocation && activity === 'group_decide';
    case 'wait':
      return targetCount === 0 && !hasMeetingLocation && activity === 'wait';
  }
}

function directActivity(activity: SocialOpportunityActivity) {
  return ['talk', 'gift', 'trade', 'teach', 'negotiate'].includes(activity);
}

function validateStringSet(
  value: unknown,
  input: {
    minimum: number;
    maximum: number;
    valid: (entry: string) => boolean;
  },
): string[] | 'invalid' | 'duplicate' {
  if (!Array.isArray(value) || value.length < input.minimum || value.length > input.maximum) {
    return 'invalid';
  }
  if (value.some((entry) => typeof entry !== 'string' || !input.valid(entry))) {
    return 'invalid';
  }
  const entries = value as string[];
  if (new Set(entries).size !== entries.length) return 'duplicate';
  return [...entries].sort(compareText);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validIdentifier(value: unknown, maximum: number): value is string {
  return validBoundedString(value, maximum) && !/\s/u.test(value);
}

function validReference(value: unknown, maximum: number): value is string {
  if (!validIdentifier(value, maximum)) return false;
  const separator = value.indexOf(':');
  return separator > 0 && separator < value.length - 1;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('social_contract_non_finite_number');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => compareText(left, right));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  throw new Error(`social_contract_unsupported_value:${typeof value}`);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
