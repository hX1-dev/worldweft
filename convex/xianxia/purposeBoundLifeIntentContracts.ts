import { type Infer, v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';

export const PURPOSE_BOUND_LIFE_INTENT_VERSION = 'taixu.purpose-bound-life-intent.v2' as const;
export const LEGACY_SEMANTIC_TRAVEL_VERSION = 'taixu.stable-life-semantic-travel.v1' as const;
export const C020D3C6_LEGACY_CANDIDATE_SET_DIGEST = 'stable64:660b113098a3ada0' as const;

export const C020D3C6_LEGACY_REPLAY_MANIFEST = Object.freeze({
  contractVersion: LEGACY_SEMANTIC_TRAVEL_VERSION,
  sourceClosure: 'c020d3c6-stable-life-semantic-travel',
  historicalCandidateSetDigest: C020D3C6_LEGACY_CANDIDATE_SET_DIGEST,
  executionPolicy: 'replay_only',
} as const);

export const purposeBoundLifePurposeValidator = v.union(
  v.literal('recovery'),
  v.literal('cultivation'),
  v.literal('livelihood'),
  v.literal('obligation'),
  v.literal('relationship'),
  v.literal('exploration'),
  v.literal('duty_return'),
);

export const purposeBoundIntendedActivityValidator = v.union(
  v.literal('rest'),
  v.literal('use_item'),
  v.literal('cultivate'),
  v.literal('gather'),
  v.literal('trade'),
  v.literal('accept_request'),
  v.literal('decline_request'),
  v.literal('turn_in_request'),
  v.literal('talk'),
  v.literal('gift'),
  v.literal('request_teaching'),
  v.literal('explore'),
  v.literal('inspect'),
  v.literal('intentional_idle'),
);

export const purposeBoundInterruptionPolicyValidator = v.union(
  v.literal('survival_or_invalidated'),
  v.literal('hard_obligation_or_invalidated'),
);

export const purposeBoundCompletionConditionValidator = v.union(
  v.object({
    kind: v.literal('body_metric_at_or_below'),
    subjectRef: v.string(),
    metric: v.literal('fatigue'),
    threshold: v.number(),
  }),
  v.object({
    kind: v.literal('body_metric_at_or_above'),
    subjectRef: v.string(),
    metric: v.literal('health'),
    threshold: v.number(),
  }),
  v.object({
    kind: v.literal('cultivation_xp_at_or_above'),
    subjectRef: v.string(),
    baselineXp: v.number(),
    minimumXp: v.number(),
  }),
  v.object({
    kind: v.literal('inventory_quantity_at_or_above'),
    subjectRef: v.string(),
    itemId: v.string(),
    baselineQuantity: v.number(),
    quantity: v.number(),
  }),
  v.object({
    kind: v.literal('inventory_quantity_at_or_below'),
    subjectRef: v.string(),
    itemId: v.string(),
    baselineQuantity: v.number(),
    quantity: v.number(),
  }),
  v.object({
    kind: v.literal('request_status_equals'),
    subjectRef: v.string(),
    expectedRevision: v.string(),
    status: v.union(
      v.literal('offered'),
      v.literal('accepted'),
      v.literal('ready_to_turn_in'),
      v.literal('completed'),
      v.literal('declined'),
      v.literal('expired'),
    ),
  }),
  v.object({
    kind: v.literal('interaction_event_recorded'),
    subjectRef: v.string(),
    afterEventRevision: v.string(),
    interactionType: v.union(v.literal('talk'), v.literal('gift'), v.literal('request_teaching')),
  }),
  v.object({
    kind: v.literal('social_session_terminal'),
    subjectRef: v.string(),
    expectedRevision: v.string(),
    warrantDigest: v.string(),
    targetActorId: v.string(),
    terminalStatus: v.literal('resolved'),
  }),
  v.object({
    kind: v.literal('exploration_fact_recorded'),
    subjectRef: v.string(),
    expectedRevision: v.string(),
    factRef: v.string(),
  }),
  v.object({
    kind: v.literal('duty_state_confirmed'),
    subjectRef: v.string(),
    expectedRevision: v.string(),
    locationId: v.string(),
    dutyState: v.union(
      v.literal('on_watch'),
      v.literal('awaiting_customer'),
      v.literal('cultivating'),
      v.literal('tending_resources'),
    ),
  }),
);

export const purposeBoundLifeIntentV2Validator = v.object({
  contractVersion: v.literal(PURPOSE_BOUND_LIFE_INTENT_VERSION),
  purposeKind: purposeBoundLifePurposeValidator,
  sourceRef: v.string(),
  sourceRevision: v.string(),
  targetLocationId: v.optional(v.string()),
  intendedActivity: purposeBoundIntendedActivityValidator,
  completionCondition: purposeBoundCompletionConditionValidator,
  interruptionPolicy: purposeBoundInterruptionPolicyValidator,
});

export type PurposeBoundLifePurpose = Infer<typeof purposeBoundLifePurposeValidator>;
export type PurposeBoundIntendedActivity = Infer<typeof purposeBoundIntendedActivityValidator>;
export type PurposeBoundInterruptionPolicy = Infer<typeof purposeBoundInterruptionPolicyValidator>;
export type PurposeBoundCompletionCondition = Infer<
  typeof purposeBoundCompletionConditionValidator
>;
export type PurposeBoundLifeIntentV2 = Infer<typeof purposeBoundLifeIntentV2Validator>;

export type PurposeBoundIntentFailureReason =
  | 'purpose_intent_not_object'
  | 'purpose_intent_unknown_field'
  | 'purpose_intent_unsupported_version'
  | 'purpose_intent_legacy_v1_replay_only'
  | 'purpose_intent_purpose_invalid'
  | 'purpose_intent_source_ref_invalid'
  | 'purpose_intent_source_namespace_mismatch'
  | 'purpose_intent_source_revision_invalid'
  | 'purpose_intent_target_location_invalid'
  | 'purpose_intent_activity_invalid'
  | 'purpose_intent_activity_mismatch'
  | 'purpose_intent_completion_invalid'
  | 'purpose_intent_completion_mismatch'
  | 'purpose_intent_interruption_policy_invalid';

export type PurposeBoundIntentStaleReason =
  | 'purpose_intent_source_missing'
  | 'purpose_intent_source_revision_stale'
  | 'purpose_intent_target_location_stale'
  | 'purpose_intent_activity_unavailable'
  | 'purpose_intent_completion_subject_missing'
  | 'purpose_intent_completion_revision_stale';

export type PurposeBoundIntentValidation =
  | {
      ok: true;
      intent: PurposeBoundLifeIntentV2;
      canonical: string;
      digest: string;
    }
  | { ok: false; reasonCode: PurposeBoundIntentFailureReason };

export type PurposeBoundLatestFacts = {
  source?: {
    sourceRef: string;
    sourceRevision: string;
  };
  knownLocationIds: readonly string[];
  eligibleActivities: readonly PurposeBoundIntendedActivity[];
  completionSubject?: {
    subjectRef: string;
    revision?: string;
  };
};

const PURPOSES = new Set<PurposeBoundLifePurpose>([
  'recovery',
  'cultivation',
  'livelihood',
  'obligation',
  'relationship',
  'exploration',
  'duty_return',
]);

const ACTIVITIES = new Set<PurposeBoundIntendedActivity>([
  'rest',
  'use_item',
  'cultivate',
  'gather',
  'trade',
  'accept_request',
  'decline_request',
  'turn_in_request',
  'talk',
  'gift',
  'request_teaching',
  'explore',
  'inspect',
  'intentional_idle',
]);

const INTERRUPTION_POLICIES = new Set<PurposeBoundInterruptionPolicy>([
  'survival_or_invalidated',
  'hard_obligation_or_invalidated',
]);

const SOURCE_NAMESPACES: Record<PurposeBoundLifePurpose, ReadonlySet<string>> = {
  recovery: new Set(['body', 'invitation']),
  cultivation: new Set(['cultivation']),
  livelihood: new Set(['resource', 'inventory', 'shop']),
  obligation: new Set(['request', 'world_event', 'invitation', 'shared_plan']),
  // Same-location warrants keep their exact server-owned source namespace:
  // relationship maintenance is relationship:, knowledge repair is belief:,
  // gratitude/repair can be bound to its originating event or to a durable
  // consequence projection. All are revalidated before execution.
  relationship: new Set([
    'actor',
    'relationship',
    'belief',
    'event',
    'world_event',
    'invitation',
    'consequence',
  ]),
  exploration: new Set(['exploration', 'rumor', 'request', 'world_event']),
  duty_return: new Set(['duty']),
};

const PURPOSE_ACTIVITIES: Record<
  PurposeBoundLifePurpose,
  ReadonlySet<PurposeBoundIntendedActivity>
> = {
  recovery: new Set(['rest', 'use_item', 'talk']),
  cultivation: new Set(['cultivate']),
  livelihood: new Set(['gather', 'trade']),
  obligation: new Set([
    'accept_request',
    'decline_request',
    'turn_in_request',
    'gather',
    'rest',
    'request_teaching',
    'talk',
    'explore',
    'inspect',
  ]),
  relationship: new Set(['talk', 'gift', 'request_teaching']),
  exploration: new Set(['explore', 'inspect']),
  duty_return: new Set(['intentional_idle']),
};

const PURPOSE_COMPLETIONS: Record<PurposeBoundLifePurpose, ReadonlySet<string>> = {
  recovery: new Set([
    'body_metric_at_or_below',
    'body_metric_at_or_above',
    'interaction_event_recorded',
    'social_session_terminal',
  ]),
  cultivation: new Set(['cultivation_xp_at_or_above']),
  livelihood: new Set(['inventory_quantity_at_or_above', 'inventory_quantity_at_or_below']),
  obligation: new Set([
    'request_status_equals',
    'interaction_event_recorded',
    'social_session_terminal',
    'inventory_quantity_at_or_above',
    'body_metric_at_or_below',
  ]),
  relationship: new Set(['interaction_event_recorded', 'social_session_terminal']),
  exploration: new Set(['exploration_fact_recorded']),
  duty_return: new Set(['duty_state_confirmed']),
};

const TOP_LEVEL_KEYS = new Set([
  'contractVersion',
  'purposeKind',
  'sourceRef',
  'sourceRevision',
  'targetLocationId',
  'intendedActivity',
  'completionCondition',
  'interruptionPolicy',
]);

const COMPLETION_KEYS: Record<string, ReadonlySet<string>> = {
  body_metric_at_or_below: new Set(['kind', 'subjectRef', 'metric', 'threshold']),
  body_metric_at_or_above: new Set(['kind', 'subjectRef', 'metric', 'threshold']),
  cultivation_xp_at_or_above: new Set(['kind', 'subjectRef', 'baselineXp', 'minimumXp']),
  inventory_quantity_at_or_above: new Set([
    'kind',
    'subjectRef',
    'itemId',
    'baselineQuantity',
    'quantity',
  ]),
  inventory_quantity_at_or_below: new Set([
    'kind',
    'subjectRef',
    'itemId',
    'baselineQuantity',
    'quantity',
  ]),
  request_status_equals: new Set(['kind', 'subjectRef', 'expectedRevision', 'status']),
  interaction_event_recorded: new Set([
    'kind',
    'subjectRef',
    'afterEventRevision',
    'interactionType',
  ]),
  social_session_terminal: new Set([
    'kind',
    'subjectRef',
    'expectedRevision',
    'warrantDigest',
    'targetActorId',
    'terminalStatus',
  ]),
  exploration_fact_recorded: new Set(['kind', 'subjectRef', 'expectedRevision', 'factRef']),
  duty_state_confirmed: new Set([
    'kind',
    'subjectRef',
    'expectedRevision',
    'locationId',
    'dutyState',
  ]),
};

const REQUEST_STATUSES = new Set([
  'offered',
  'accepted',
  'ready_to_turn_in',
  'completed',
  'declined',
  'expired',
]);
const INTERACTION_TYPES = new Set(['talk', 'gift', 'request_teaching']);
const DUTY_STATES = new Set([
  'on_watch',
  'awaiting_customer',
  'cultivating',
  'tending_resources',
]);

export function validatePurposeBoundLifeIntentV2(input: unknown): PurposeBoundIntentValidation {
  if (!isRecord(input)) return failure('purpose_intent_not_object');
  if (input.contractVersion === LEGACY_SEMANTIC_TRAVEL_VERSION) {
    return failure('purpose_intent_legacy_v1_replay_only');
  }
  if (input.contractVersion !== PURPOSE_BOUND_LIFE_INTENT_VERSION) {
    return failure('purpose_intent_unsupported_version');
  }
  if (!hasExactKeys(input, TOP_LEVEL_KEYS)) {
    return failure('purpose_intent_unknown_field');
  }
  if (!PURPOSES.has(input.purposeKind as PurposeBoundLifePurpose)) {
    return failure('purpose_intent_purpose_invalid');
  }
  const purposeKind = input.purposeKind as PurposeBoundLifePurpose;
  if (!validReference(input.sourceRef, 192)) {
    return failure('purpose_intent_source_ref_invalid');
  }
  const sourceNamespace = referenceNamespace(input.sourceRef);
  if (!SOURCE_NAMESPACES[purposeKind].has(sourceNamespace)) {
    return failure('purpose_intent_source_namespace_mismatch');
  }
  if (!validBoundedString(input.sourceRevision, 192)) {
    return failure('purpose_intent_source_revision_invalid');
  }
  if (input.targetLocationId !== undefined && !validIdentifier(input.targetLocationId, 128)) {
    return failure('purpose_intent_target_location_invalid');
  }
  if (!ACTIVITIES.has(input.intendedActivity as PurposeBoundIntendedActivity)) {
    return failure('purpose_intent_activity_invalid');
  }
  const intendedActivity = input.intendedActivity as PurposeBoundIntendedActivity;
  if (!PURPOSE_ACTIVITIES[purposeKind].has(intendedActivity)) {
    return failure('purpose_intent_activity_mismatch');
  }
  const completionFailure = validateCompletionCondition(input.completionCondition);
  if (completionFailure) return failure(completionFailure);
  const completionCondition = input.completionCondition as PurposeBoundCompletionCondition;
  if (!PURPOSE_COMPLETIONS[purposeKind].has(completionCondition.kind)) {
    return failure('purpose_intent_completion_mismatch');
  }
  if (!completionMatchesActivity(intendedActivity, completionCondition)) {
    return failure('purpose_intent_completion_mismatch');
  }
  if (
    !completionMatchesSource({
      purpose: purposeKind,
      sourceRef: input.sourceRef,
      sourceRevision: input.sourceRevision,
      targetLocationId: input.targetLocationId as string | undefined,
      condition: completionCondition,
    })
  ) {
    return failure('purpose_intent_completion_mismatch');
  }
  if (!INTERRUPTION_POLICIES.has(input.interruptionPolicy as PurposeBoundInterruptionPolicy)) {
    return failure('purpose_intent_interruption_policy_invalid');
  }
  const intent = cloneIntent(input as PurposeBoundLifeIntentV2);
  const canonical = canonicalPurposeBoundLifeIntentV2(intent);
  return {
    ok: true,
    intent,
    canonical,
    digest: stableObservationDigest(intent),
  };
}

export function canonicalPurposeBoundLifeIntentV2(intent: PurposeBoundLifeIntentV2) {
  return canonicalJson(intent);
}

export function purposeBoundLifeIntentDigest(intent: PurposeBoundLifeIntentV2) {
  return stableObservationDigest(intent);
}

export function revalidatePurposeBoundLifeIntentV2(
  intent: PurposeBoundLifeIntentV2,
  latest: PurposeBoundLatestFacts,
): PurposeBoundIntentStaleReason | undefined {
  const validated = validatePurposeBoundLifeIntentV2(intent);
  if (!validated.ok) {
    throw new Error(`purpose_intent_revalidation_invalid:${validated.reasonCode}`);
  }
  if (!latest.source || latest.source.sourceRef !== intent.sourceRef) {
    return 'purpose_intent_source_missing';
  }
  if (latest.source.sourceRevision !== intent.sourceRevision) {
    return 'purpose_intent_source_revision_stale';
  }
  if (intent.targetLocationId && !new Set(latest.knownLocationIds).has(intent.targetLocationId)) {
    return 'purpose_intent_target_location_stale';
  }
  if (!new Set(latest.eligibleActivities).has(intent.intendedActivity)) {
    return 'purpose_intent_activity_unavailable';
  }
  if (
    !latest.completionSubject ||
    latest.completionSubject.subjectRef !== intent.completionCondition.subjectRef
  ) {
    return 'purpose_intent_completion_subject_missing';
  }
  const expectedRevision = completionExpectedRevision(intent.completionCondition);
  if (expectedRevision !== undefined && latest.completionSubject.revision !== expectedRevision) {
    return 'purpose_intent_completion_revision_stale';
  }
  return undefined;
}

function validateCompletionCondition(input: unknown): PurposeBoundIntentFailureReason | undefined {
  if (!isRecord(input) || typeof input.kind !== 'string') {
    return 'purpose_intent_completion_invalid';
  }
  const keys = COMPLETION_KEYS[input.kind];
  if (!keys || !hasExactKeys(input, keys) || !validReference(input.subjectRef, 192)) {
    return 'purpose_intent_completion_invalid';
  }
  switch (input.kind) {
    case 'body_metric_at_or_below':
      return input.metric === 'fatigue' && boundedInteger(input.threshold, 0, 100)
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'body_metric_at_or_above':
      return input.metric === 'health' && boundedInteger(input.threshold, 0, 1_000_000)
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'cultivation_xp_at_or_above':
      return nonnegativeSafeInteger(input.baselineXp) &&
        nonnegativeSafeInteger(input.minimumXp) &&
        input.minimumXp > input.baselineXp
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'inventory_quantity_at_or_above':
      return validIdentifier(input.itemId, 96) &&
        nonnegativeSafeInteger(input.baselineQuantity) &&
        nonnegativeSafeInteger(input.quantity) &&
        input.quantity > input.baselineQuantity
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'inventory_quantity_at_or_below':
      return validIdentifier(input.itemId, 96) &&
        nonnegativeSafeInteger(input.baselineQuantity) &&
        nonnegativeSafeInteger(input.quantity) &&
        input.quantity < input.baselineQuantity
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'request_status_equals':
      return referenceNamespace(input.subjectRef) === 'request' &&
        validBoundedString(input.expectedRevision, 192) &&
        REQUEST_STATUSES.has(input.status as string)
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'interaction_event_recorded':
      return [
        'actor',
        'relationship',
        'belief',
        'event',
        'invitation',
        'request',
        'consequence',
      ].includes(
        referenceNamespace(input.subjectRef),
      ) &&
        validBoundedString(input.afterEventRevision, 192) &&
        INTERACTION_TYPES.has(input.interactionType as string)
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'social_session_terminal':
      return referenceNamespace(input.subjectRef) === 'invitation' &&
        validBoundedString(input.expectedRevision, 192) &&
        validBoundedString(input.warrantDigest, 96) &&
        validIdentifier(input.targetActorId, 192) &&
        input.terminalStatus === 'resolved'
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'exploration_fact_recorded':
      return ['exploration', 'rumor', 'request', 'world_event'].includes(
        referenceNamespace(input.subjectRef),
      ) &&
        validBoundedString(input.expectedRevision, 192) &&
        validReference(input.factRef, 192)
        ? undefined
        : 'purpose_intent_completion_invalid';
    case 'duty_state_confirmed':
      return referenceNamespace(input.subjectRef) === 'duty' &&
        validBoundedString(input.expectedRevision, 192) &&
        validIdentifier(input.locationId, 128) &&
        DUTY_STATES.has(input.dutyState as string)
        ? undefined
        : 'purpose_intent_completion_invalid';
    default:
      return 'purpose_intent_completion_invalid';
  }
}

function completionMatchesActivity(
  activity: PurposeBoundIntendedActivity,
  condition: PurposeBoundCompletionCondition,
) {
  switch (activity) {
    case 'rest':
      return condition.kind === 'body_metric_at_or_below';
    case 'use_item':
      return condition.kind === 'body_metric_at_or_above';
    case 'cultivate':
      return condition.kind === 'cultivation_xp_at_or_above';
    case 'gather':
      return (
        condition.kind === 'inventory_quantity_at_or_above' ||
        condition.kind === 'request_status_equals'
      );
    case 'trade':
      return condition.kind === 'inventory_quantity_at_or_below';
    case 'accept_request':
      return condition.kind === 'request_status_equals' && condition.status === 'accepted';
    case 'decline_request':
      return condition.kind === 'request_status_equals' && condition.status === 'declined';
    case 'turn_in_request':
      return condition.kind === 'request_status_equals' && condition.status === 'completed';
    case 'talk':
      return (
        (condition.kind === 'interaction_event_recorded' && condition.interactionType === 'talk') ||
        condition.kind === 'social_session_terminal' ||
        (condition.kind === 'request_status_equals' && condition.status === 'completed')
      );
    case 'gift':
      return (
        condition.kind === 'interaction_event_recorded' && condition.interactionType === 'gift'
      );
    case 'request_teaching':
      return (
        condition.kind === 'interaction_event_recorded' &&
        condition.interactionType === 'request_teaching'
      );
    case 'explore':
    case 'inspect':
      return (
        condition.kind === 'exploration_fact_recorded' ||
        (condition.kind === 'request_status_equals' && condition.status === 'completed')
      );
    case 'intentional_idle':
      return condition.kind === 'duty_state_confirmed';
  }
}

function completionMatchesSource(input: {
  purpose: PurposeBoundLifePurpose;
  sourceRef: string;
  sourceRevision: string;
  targetLocationId?: string;
  condition: PurposeBoundCompletionCondition;
}) {
  const { purpose, sourceRef, sourceRevision, targetLocationId, condition } = input;
  switch (purpose) {
    case 'recovery':
    case 'cultivation':
      return condition.subjectRef === sourceRef;
    case 'livelihood':
      return (
        referenceNamespace(condition.subjectRef) === 'inventory' &&
        'itemId' in condition &&
        condition.subjectRef.endsWith(`:${condition.itemId}`)
      );
    case 'obligation':
      if (referenceNamespace(sourceRef) === 'invitation') {
        return condition.subjectRef === sourceRef &&
          (condition.kind === 'social_session_terminal' ||
            condition.kind === 'interaction_event_recorded');
      }
      if (referenceNamespace(sourceRef) === 'shared_plan') {
        return (condition.kind === 'inventory_quantity_at_or_above' &&
          referenceNamespace(condition.subjectRef) === 'inventory') ||
          (condition.kind === 'interaction_event_recorded' &&
            referenceNamespace(condition.subjectRef) === 'actor') ||
          (condition.kind === 'body_metric_at_or_below' &&
            referenceNamespace(condition.subjectRef) === 'body');
      }
      return referenceNamespace(condition.subjectRef) === 'request' &&
        (referenceNamespace(sourceRef) !== 'request' ||
          (condition.subjectRef === sourceRef &&
            ((condition.kind === 'request_status_equals' &&
              condition.expectedRevision === sourceRevision) ||
              condition.kind === 'interaction_event_recorded')));
    case 'relationship':
      if (referenceNamespace(sourceRef) === 'invitation') {
        return condition.subjectRef === sourceRef &&
          (condition.kind === 'social_session_terminal' ||
            condition.kind === 'interaction_event_recorded');
      }
      if (['belief', 'event', 'consequence'].includes(referenceNamespace(sourceRef))) {
        return condition.subjectRef === sourceRef;
      }
      return ['actor', 'relationship'].includes(referenceNamespace(condition.subjectRef));
    case 'exploration':
      return (
        ['exploration', 'rumor', 'request', 'world_event'].includes(
          referenceNamespace(condition.subjectRef),
        ) &&
        (condition.subjectRef !== sourceRef ||
          (condition.kind === 'exploration_fact_recorded' &&
            condition.expectedRevision === sourceRevision))
      );
    case 'duty_return':
      return (
        condition.kind === 'duty_state_confirmed' &&
        condition.subjectRef === sourceRef &&
        condition.expectedRevision === sourceRevision &&
        targetLocationId !== undefined &&
        condition.locationId === targetLocationId
      );
  }
}

function completionExpectedRevision(condition: PurposeBoundCompletionCondition) {
  switch (condition.kind) {
    case 'request_status_equals':
    case 'exploration_fact_recorded':
    case 'duty_state_confirmed':
      return condition.expectedRevision;
    case 'interaction_event_recorded':
      return condition.afterEventRevision;
    case 'social_session_terminal':
      return condition.expectedRevision;
    default:
      return undefined;
  }
}

function cloneIntent(intent: PurposeBoundLifeIntentV2): PurposeBoundLifeIntentV2 {
  return JSON.parse(JSON.stringify(intent)) as PurposeBoundLifeIntentV2;
}

function failure(reasonCode: PurposeBoundIntentFailureReason): PurposeBoundIntentValidation {
  return { ok: false, reasonCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function validIdentifier(value: unknown, maxLength: number): value is string {
  return validBoundedString(value, maxLength) && !/\s/u.test(value);
}

function validReference(value: unknown, maxLength: number): value is string {
  if (!validIdentifier(value, maxLength)) return false;
  const separator = value.indexOf(':');
  return separator > 0 && separator < value.length - 1;
}

function referenceNamespace(value: unknown) {
  if (typeof value !== 'string') return '';
  const separator = value.indexOf(':');
  return separator > 0 ? value.slice(0, separator) : '';
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('purpose_intent_non_finite_number');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  throw new Error(`purpose_intent_unsupported_value:${typeof value}`);
}
