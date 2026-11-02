import {
  C020D3C6_LEGACY_CANDIDATE_SET_DIGEST,
  C020D3C6_LEGACY_REPLAY_MANIFEST,
  LEGACY_SEMANTIC_TRAVEL_VERSION,
  PURPOSE_BOUND_LIFE_INTENT_VERSION,
  canonicalPurposeBoundLifeIntentV2,
  purposeBoundLifeIntentDigest,
  revalidatePurposeBoundLifeIntentV2,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';

function recoveryIntent(): PurposeBoundLifeIntentV2 {
  return {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'recovery',
    sourceRef: 'body:actor_a',
    sourceRevision: 'body:v4',
    targetLocationId: 'rest_pavilion',
    intendedActivity: 'rest',
    completionCondition: {
      kind: 'body_metric_at_or_below',
      subjectRef: 'body:actor_a',
      metric: 'fatigue',
      threshold: 40,
    },
    interruptionPolicy: 'hard_obligation_or_invalidated',
  };
}

const validMatrix: PurposeBoundLifeIntentV2[] = [
  recoveryIntent(),
  {
    ...recoveryIntent(),
    intendedActivity: 'use_item',
    targetLocationId: undefined,
    completionCondition: {
      kind: 'body_metric_at_or_above',
      subjectRef: 'body:actor_a',
      metric: 'health',
      threshold: 8,
    },
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'cultivation',
    sourceRef: 'cultivation:actor_a',
    sourceRevision: 'cultivation:v9',
    targetLocationId: 'quiet_retreat',
    intendedActivity: 'cultivate',
    completionCondition: {
      kind: 'cultivation_xp_at_or_above',
      subjectRef: 'cultivation:actor_a',
      baselineXp: 20,
      minimumXp: 21,
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'livelihood',
    sourceRef: 'resource:dew_herb_patch',
    sourceRevision: 'resource:v3',
    targetLocationId: 'herb_field',
    intendedActivity: 'gather',
    completionCondition: {
      kind: 'inventory_quantity_at_or_above',
      subjectRef: 'inventory:actor_a:spirit_herb',
      itemId: 'spirit_herb',
      baselineQuantity: 0,
      quantity: 1,
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'livelihood',
    sourceRef: 'shop:river_market',
    sourceRevision: 'shop:v11',
    targetLocationId: 'market',
    intendedActivity: 'trade',
    completionCondition: {
      kind: 'inventory_quantity_at_or_below',
      subjectRef: 'inventory:actor_a:spirit_herb',
      itemId: 'spirit_herb',
      baselineQuantity: 1,
      quantity: 0,
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'obligation',
    sourceRef: 'request:req_1',
    sourceRevision: 'request:rev:2',
    targetLocationId: 'herb_field',
    intendedActivity: 'gather',
    completionCondition: {
      kind: 'request_status_equals',
      subjectRef: 'request:req_1',
      expectedRevision: 'request:rev:2',
      status: 'completed',
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'obligation',
    sourceRef: 'request:req_discuss',
    sourceRevision: 'request:rev:3',
    targetLocationId: 'quiet_pavilion',
    intendedActivity: 'talk',
    completionCondition: {
      kind: 'interaction_event_recorded',
      subjectRef: 'request:req_discuss',
      afterEventRevision: 'request:rev:3',
      interactionType: 'talk',
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'relationship',
    sourceRef: 'actor:friend',
    sourceRevision: 'relationship:v5',
    targetLocationId: 'market',
    intendedActivity: 'talk',
    completionCondition: {
      kind: 'interaction_event_recorded',
      subjectRef: 'actor:friend',
      afterEventRevision: 'event:v8',
      interactionType: 'talk',
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'exploration',
    sourceRef: 'rumor:mist_cave',
    sourceRevision: 'belief:v3',
    targetLocationId: 'mist_cave',
    intendedActivity: 'explore',
    completionCondition: {
      kind: 'exploration_fact_recorded',
      subjectRef: 'rumor:mist_cave',
      expectedRevision: 'belief:v3',
      factRef: 'world_fact:mist_cave_inspected',
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'duty_return',
    sourceRef: 'duty:actor_guard',
    sourceRevision: 'duty:v2',
    targetLocationId: 'mountain_gate',
    intendedActivity: 'intentional_idle',
    completionCondition: {
      kind: 'duty_state_confirmed',
      subjectRef: 'duty:actor_guard',
      expectedRevision: 'duty:v2',
      locationId: 'mountain_gate',
      dutyState: 'on_watch',
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
  {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'duty_return',
    sourceRef: 'duty:actor_herbalist',
    sourceRevision: 'duty:v3',
    targetLocationId: 'herb_field',
    intendedActivity: 'intentional_idle',
    completionCondition: {
      kind: 'duty_state_confirmed',
      subjectRef: 'duty:actor_herbalist',
      expectedRevision: 'duty:v3',
      locationId: 'herb_field',
      dutyState: 'tending_resources',
    },
    interruptionPolicy: 'survival_or_invalidated',
  },
];

describe('C021q1 purpose-bound life intent v2 contract', () => {
  test('accepts all seven purposes and every frozen completion shape', () => {
    const purposes = new Set<string>();
    const conditions = new Set<string>();
    for (const intent of validMatrix) {
      const result = validatePurposeBoundLifeIntentV2(intent);
      expect(result).toMatchObject({
        ok: true,
        digest: expect.stringMatching(/^stable64:[0-9a-f]{16}$/u),
      });
      if (result.ok) {
        expect(result.intent).toEqual(intent);
        expect(result.canonical).toBe(canonicalPurposeBoundLifeIntentV2(intent));
      }
      purposes.add(intent.purposeKind);
      conditions.add(intent.completionCondition.kind);
    }
    expect([...purposes].sort()).toEqual([
      'cultivation',
      'duty_return',
      'exploration',
      'livelihood',
      'obligation',
      'recovery',
      'relationship',
    ]);
    expect([...conditions].sort()).toEqual([
      'body_metric_at_or_above',
      'body_metric_at_or_below',
      'cultivation_xp_at_or_above',
      'duty_state_confirmed',
      'exploration_fact_recorded',
      'interaction_event_recorded',
      'inventory_quantity_at_or_above',
      'inventory_quantity_at_or_below',
      'request_status_equals',
    ]);
  });

  test('canonicalizes object keys and binds every semantic field', () => {
    const original = recoveryIntent();
    const reordered = {
      interruptionPolicy: original.interruptionPolicy,
      completionCondition: {
        threshold: 40,
        metric: 'fatigue',
        subjectRef: 'body:actor_a',
        kind: 'body_metric_at_or_below',
      },
      intendedActivity: original.intendedActivity,
      targetLocationId: original.targetLocationId,
      sourceRevision: original.sourceRevision,
      sourceRef: original.sourceRef,
      purposeKind: original.purposeKind,
      contractVersion: original.contractVersion,
    };
    const first = validatePurposeBoundLifeIntentV2(original);
    const second = validatePurposeBoundLifeIntentV2(reordered);
    expect(first).toEqual(second);
    expect(first.ok && first.digest).toBe(purposeBoundLifeIntentDigest(original));

    const validMutations: PurposeBoundLifeIntentV2[] = [
      { ...original, sourceRevision: 'body:v5' },
      { ...original, targetLocationId: 'other_pavilion' },
      { ...original, interruptionPolicy: 'survival_or_invalidated' },
      {
        ...original,
        completionCondition: {
          kind: 'body_metric_at_or_below',
          subjectRef: 'body:actor_a',
          metric: 'fatigue',
          threshold: 39,
        },
      },
      validMatrix[1],
    ];
    for (const mutation of validMutations) {
      expect(purposeBoundLifeIntentDigest(mutation)).not.toBe(
        purposeBoundLifeIntentDigest(original),
      );
    }
  });

  test('accepts a relationship intent bound to a server-owned consequence projection', () => {
    const consequenceIntent: PurposeBoundLifeIntentV2 = {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'relationship',
      sourceRef: 'consequence:social_consequence:gratitude',
      sourceRevision: 'consequence_revision:stable64:0123456789abcdef',
      targetLocationId: 'rest_pavilion',
      intendedActivity: 'talk',
      completionCondition: {
        kind: 'interaction_event_recorded',
        subjectRef: 'consequence:social_consequence:gratitude',
        afterEventRevision: 'event:before',
        interactionType: 'talk',
      },
      interruptionPolicy: 'survival_or_invalidated',
    };
    expect(validatePurposeBoundLifeIntentV2(consequenceIntent)).toMatchObject({ ok: true });
  });

  test.each([
    [null, 'purpose_intent_not_object'],
    [C020D3C6_LEGACY_REPLAY_MANIFEST, 'purpose_intent_legacy_v1_replay_only'],
    [{ ...recoveryIntent(), contractVersion: 'v3' }, 'purpose_intent_unsupported_version'],
    [{ ...recoveryIntent(), extra: true }, 'purpose_intent_unknown_field'],
    [{ ...recoveryIntent(), purposeKind: 'wandering' }, 'purpose_intent_purpose_invalid'],
    [{ ...recoveryIntent(), sourceRef: '' }, 'purpose_intent_source_ref_invalid'],
    [
      { ...recoveryIntent(), sourceRef: 'location:rest_pavilion' },
      'purpose_intent_source_namespace_mismatch',
    ],
    [{ ...recoveryIntent(), sourceRevision: ' ' }, 'purpose_intent_source_revision_invalid'],
    [
      { ...recoveryIntent(), targetLocationId: 'bad place' },
      'purpose_intent_target_location_invalid',
    ],
    [{ ...recoveryIntent(), intendedActivity: 'attack' }, 'purpose_intent_activity_invalid'],
    [{ ...recoveryIntent(), intendedActivity: 'trade' }, 'purpose_intent_activity_mismatch'],
    [{ ...recoveryIntent(), completionCondition: undefined }, 'purpose_intent_completion_invalid'],
    [
      {
        ...recoveryIntent(),
        completionCondition: {
          ...recoveryIntent().completionCondition,
          invented: true,
        },
      },
      'purpose_intent_completion_invalid',
    ],
    [
      {
        ...recoveryIntent(),
        completionCondition: {
          kind: 'body_metric_at_or_above',
          subjectRef: 'body:actor_a',
          metric: 'health',
          threshold: 8,
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      {
        ...recoveryIntent(),
        completionCondition: {
          ...recoveryIntent().completionCondition,
          subjectRef: 'body:other_actor',
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      {
        ...recoveryIntent(),
        completionCondition: {
          ...recoveryIntent().completionCondition,
          threshold: Number.NaN,
        },
      },
      'purpose_intent_completion_invalid',
    ],
    [
      {
        ...validMatrix[2],
        completionCondition: {
          ...validMatrix[2].completionCondition,
          minimumXp: Number.MAX_SAFE_INTEGER + 1,
        },
      },
      'purpose_intent_completion_invalid',
    ],
    [
      {
        ...validMatrix[3],
        completionCondition: {
          ...validMatrix[3].completionCondition,
          subjectRef: 'inventory:actor_a:different_herb',
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      {
        ...validMatrix[5],
        completionCondition: {
          ...validMatrix[5].completionCondition,
          expectedRevision: 'request:rev:3',
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      {
        ...validMatrix[7],
        completionCondition: {
          ...validMatrix[7].completionCondition,
          interactionType: 'gift',
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      {
        ...validMatrix[8],
        completionCondition: {
          ...validMatrix[8].completionCondition,
          expectedRevision: 'belief:v4',
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      {
        ...validMatrix[9],
        completionCondition: {
          ...validMatrix[9].completionCondition,
          locationId: 'quiet_retreat',
        },
      },
      'purpose_intent_completion_mismatch',
    ],
    [
      { ...recoveryIntent(), interruptionPolicy: 'never_interrupt' },
      'purpose_intent_interruption_policy_invalid',
    ],
  ])('rejects malformed or semantically mismatched input %#', (input, reasonCode) => {
    expect(validatePurposeBoundLifeIntentV2(input)).toEqual({ ok: false, reasonCode });
  });

  test('revalidates the exact latest source, destination, activity and completion subject', () => {
    const intent = recoveryIntent();
    const latest = {
      source: { sourceRef: 'body:actor_a', sourceRevision: 'body:v4' },
      knownLocationIds: ['rest_pavilion', 'market'],
      eligibleActivities: ['rest'] as const,
      completionSubject: { subjectRef: 'body:actor_a' },
    };
    expect(revalidatePurposeBoundLifeIntentV2(intent, latest)).toBeUndefined();
    expect(revalidatePurposeBoundLifeIntentV2(intent, { ...latest, source: undefined })).toBe(
      'purpose_intent_source_missing',
    );
    expect(
      revalidatePurposeBoundLifeIntentV2(intent, {
        ...latest,
        source: { ...latest.source, sourceRevision: 'body:v5' },
      }),
    ).toBe('purpose_intent_source_revision_stale');
    expect(
      revalidatePurposeBoundLifeIntentV2(intent, {
        ...latest,
        knownLocationIds: ['market'],
      }),
    ).toBe('purpose_intent_target_location_stale');
    expect(
      revalidatePurposeBoundLifeIntentV2(intent, {
        ...latest,
        eligibleActivities: [],
      }),
    ).toBe('purpose_intent_activity_unavailable');
    expect(
      revalidatePurposeBoundLifeIntentV2(intent, {
        ...latest,
        completionSubject: undefined,
      }),
    ).toBe('purpose_intent_completion_subject_missing');

    const exploration = validMatrix.find((candidate) => candidate.purposeKind === 'exploration')!;
    expect(
      revalidatePurposeBoundLifeIntentV2(exploration, {
        source: {
          sourceRef: exploration.sourceRef,
          sourceRevision: exploration.sourceRevision,
        },
        knownLocationIds: [exploration.targetLocationId!],
        eligibleActivities: [exploration.intendedActivity],
        completionSubject: {
          subjectRef: exploration.completionCondition.subjectRef,
          revision: 'belief:v4',
        },
      }),
    ).toBe('purpose_intent_completion_revision_stale');
  });

  test('keeps C020d3c6 v1 replay-only and never treats it as executable v2', () => {
    expect(C020D3C6_LEGACY_REPLAY_MANIFEST).toEqual({
      contractVersion: LEGACY_SEMANTIC_TRAVEL_VERSION,
      sourceClosure: 'c020d3c6-stable-life-semantic-travel',
      historicalCandidateSetDigest: 'stable64:660b113098a3ada0',
      executionPolicy: 'replay_only',
    });
    expect(C020D3C6_LEGACY_CANDIDATE_SET_DIGEST).toBe('stable64:660b113098a3ada0');
    expect(validatePurposeBoundLifeIntentV2(C020D3C6_LEGACY_REPLAY_MANIFEST)).toEqual({
      ok: false,
      reasonCode: 'purpose_intent_legacy_v1_replay_only',
    });
  });
});
