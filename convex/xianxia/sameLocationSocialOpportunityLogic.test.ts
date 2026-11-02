import {
  RELATIONSHIP_MAINTENANCE_DEBT_DAYS,
  SAME_LOCATION_SOCIAL_CANDIDATE_LIMIT,
  SAME_LOCATION_SOCIAL_SOURCE_VERSION,
  SAME_LOCATION_SOCIAL_TARGET_LIMIT,
  buildSameLocationSocialOpportunityBundle,
  deriveSameLocationSocialSources,
  revalidateSameLocationSocialOpportunityEntry,
  sameLocationSocialSourceDigest,
  type SameLocationSocialSource,
  type SameLocationSocialSourceKind,
} from './sameLocationSocialOpportunityLogic';

function source(
  kind: SameLocationSocialSourceKind,
  overrides: Partial<SameLocationSocialSource> = {},
): SameLocationSocialSource {
  const preferredActivity =
    kind === 'knowledge_gap' ? ('teach' as const) :
      kind === 'gratitude_or_repair' ? ('gift' as const) : ('talk' as const);
  return {
    contractVersion: SAME_LOCATION_SOCIAL_SOURCE_VERSION,
    actorId: 'actor:a',
    targetActorId: 'actor:b',
    kind,
    sourceRef: `${kind}:fact-1`,
    sourceRevision: `${kind}:rev-1`,
    topicRefs: [`topic:${kind}`],
    audience: 'participants',
    urgencyBand: kind === 'care_or_aid' ? 'critical' : 'routine',
    createdAt: 100,
    expiresAt: 200,
    locationId: 'herb_field',
    targetLocationId: 'herb_field',
    preferredActivity,
    targetRelevant: true,
    targetAliveAndCapable: true,
    targetBusy: false,
    targetCanFulfillOutcome: true,
    disclosureAllowed: true,
    cooldownClear: true,
    sessionCapacityAvailable: true,
    maintenanceDebtGameDays:
      kind === 'relationship_maintenance' ? RELATIONSHIP_MAINTENANCE_DEBT_DAYS : undefined,
    ...overrides,
  };
}

function build(sources: SameLocationSocialSource[], overrides: Partial<Parameters<typeof buildSameLocationSocialOpportunityBundle>[0]> = {}) {
  return buildSameLocationSocialOpportunityBundle({
    now: 150,
    actorId: 'actor:a',
    locationId: 'herb_field',
    actorAliveAndCapable: true,
    actorBusy: false,
    sources,
    ...overrides,
  });
}

describe('C021b0b same-location causal social opportunities', () => {
  test('derives all five source kinds only from explicit host facts', () => {
    const sources = deriveSameLocationSocialSources({
      nowGameHour: 240,
      currentGameDay: 10,
      actor: {
        actorId: 'actor:a',
        locationId: 'herb_field',
        health: 4,
        maxHealth: 10,
        hasHealingItem: false,
        hasGiftableItem: true,
      },
      targets: [{
        actorId: 'actor:b',
        role: 'herbalist',
        locationId: 'herb_field',
        relationship: 35,
        trust: 20,
        suspicion: 5,
        debt: 10,
        fear: 0,
        lastTouchedDay: 3,
        recentlyTalked: false,
        aliveAndCapable: true,
        busy: false,
        cooldownClear: true,
        sessionCapacityAvailable: true,
      }],
      requests: [{
        requestId: 'request-1',
        revision: 2,
        status: 'ready_to_turn_in',
        issuerActorId: 'actor:b',
      }],
      beliefs: [{
        beliefId: 'belief-1',
        revision: 3,
        sourceActorId: 'actor:b',
        kind: 'belief',
        active: true,
        validity: 'active',
        truthStatus: 'unknown',
      }],
      memories: [{
        sourceEventId: 'event-1',
        aboutActorIds: ['actor:b'],
        type: 'gift',
        source: 'direct',
        createdAt: 1000,
        expiresAt: 300,
      }],
    });
    expect(new Set(sources.map((entry) => entry.kind))).toEqual(new Set([
      'care_or_aid',
      'active_obligation',
      'knowledge_gap',
      'gratitude_or_repair',
      'relationship_maintenance',
    ]));
    expect(build(sources, { now: 240 }).entries).toHaveLength(5);
  });

  test('positive relationship without maintenance debt is not a source', () => {
    const sources = deriveSameLocationSocialSources({
      nowGameHour: 240,
      currentGameDay: 10,
      actor: {
        actorId: 'actor:a',
        locationId: 'herb_field',
        health: 10,
        maxHealth: 10,
        hasHealingItem: false,
        hasGiftableItem: false,
      },
      targets: [{
        actorId: 'actor:b',
        locationId: 'herb_field',
        relationship: 80,
        trust: 50,
        suspicion: 0,
        debt: 0,
        fear: 0,
        lastTouchedDay: 9,
        recentlyTalked: false,
        aliveAndCapable: true,
        busy: false,
        cooldownClear: true,
        sessionCapacityAvailable: true,
      }],
      requests: [],
      beliefs: [],
      memories: [],
    });
    expect(sources).toEqual([]);
  });

  test('derived outcome memories cannot self-excite a gratitude warrant', () => {
    const input = {
      nowGameHour: 240,
      currentGameDay: 10,
      actor: {
        actorId: 'actor:a', locationId: 'herb_field', health: 10, maxHealth: 10,
        hasHealingItem: false, hasGiftableItem: true,
      },
      targets: [{
        actorId: 'actor:b', locationId: 'herb_field', relationship: 0, trust: 0,
        suspicion: 0, debt: 8, fear: 0, recentlyTalked: false, aliveAndCapable: true,
        busy: false, cooldownClear: true, sessionCapacityAvailable: true,
      }],
      requests: [], beliefs: [],
    };
    const onlyOutcome = deriveSameLocationSocialSources({
      ...input,
      memories: [{
        sourceEventId: 'event:outcome', aboutActorIds: ['actor:b'], type: 'social_outcome_resolved',
        source: 'direct' as const, createdAt: 230, expiresAt: 300,
      }],
    });
    expect(onlyOutcome).toEqual([]);

    const withCausalGift = deriveSameLocationSocialSources({
      ...input,
      memories: [
        {
          sourceEventId: 'event:gift', aboutActorIds: ['actor:b'], type: 'gift_given',
          eventActorIds: ['actor:b'], eventTargetActorIds: ['actor:a'],
          source: 'direct' as const, createdAt: 220, expiresAt: 300,
        },
        {
          sourceEventId: 'event:outcome', aboutActorIds: ['actor:b'], type: 'social_outcome_resolved',
          source: 'direct' as const, createdAt: 230, expiresAt: 300,
        },
      ],
    });
    expect(withCausalGift).toHaveLength(1);
    expect(withCausalGift[0]).toMatchObject({
      kind: 'gratitude_or_repair', sourceRef: 'event:event:gift',
    });
  });

  test('event roles prevent actors from thanking targets for the actors own gift', () => {
    const sources = deriveSameLocationSocialSources({
      nowGameHour: 240,
      currentGameDay: 10,
      actor: {
        actorId: 'actor:a', locationId: 'herb_field', health: 10, maxHealth: 10,
        hasHealingItem: false, hasGiftableItem: false,
      },
      targets: [{
        actorId: 'actor:b', locationId: 'herb_field', relationship: 0, trust: 0,
        suspicion: 0, debt: 8, fear: 0, recentlyTalked: false, aliveAndCapable: true,
        busy: false, cooldownClear: true, sessionCapacityAvailable: true,
      }],
      requests: [], beliefs: [],
      memories: [{
        sourceEventId: 'event:actors-gift', aboutActorIds: ['actor:b'], type: 'gift_given',
        eventActorIds: ['actor:a'], eventTargetActorIds: ['actor:b'],
        source: 'direct', createdAt: 230, expiresAt: 300,
      }],
    });
    expect(sources).toEqual([]);
  });

  test('event roles allow actor-caused incidents to support relationship repair', () => {
    const sources = deriveSameLocationSocialSources({
      nowGameHour: 240,
      currentGameDay: 10,
      actor: {
        actorId: 'actor:a', locationId: 'herb_field', health: 10, maxHealth: 10,
        hasHealingItem: false, hasGiftableItem: false,
      },
      targets: [{
        actorId: 'actor:b', locationId: 'herb_field', relationship: -5, trust: 0,
        suspicion: 30, debt: 0, fear: 0, recentlyTalked: false, aliveAndCapable: true,
        busy: false, cooldownClear: true, sessionCapacityAvailable: true,
      }],
      requests: [], beliefs: [],
      memories: [{
        sourceEventId: 'event:incident', aboutActorIds: ['actor:b'], type: 'social_incident',
        eventActorIds: ['actor:a'], eventTargetActorIds: ['actor:b'],
        source: 'direct', createdAt: 230, expiresAt: 300,
      }],
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: 'gratitude_or_repair', sourceRef: 'event:event:incident',
      preferredActivity: 'talk',
    });
  });

  test.each<SameLocationSocialSourceKind>([
    'care_or_aid',
    'active_obligation',
    'knowledge_gap',
    'gratitude_or_repair',
    'relationship_maintenance',
  ])('derives a validated warrant and direct candidate for %s', (kind) => {
    const bundle = build([source(kind)]);
    expect(bundle.entries).toHaveLength(1);
    expect(bundle.entries[0]).toMatchObject({
      warrant: { kind, actorId: 'actor:a', eligibleTargetActorIds: ['actor:b'] },
      candidate: {
        mode: 'start_direct_conversation',
        targetActorIds: ['actor:b'],
      },
    });
    expect(bundle.entries[0].warrantDigest).toMatch(/^stable64:/);
    expect(bundle.entries[0].warrantCandidateDigest).toMatch(/^stable64:/);
  });

  test('no source means no formal candidate; proximity is never synthesized', () => {
    expect(build([])).toMatchObject({ entries: [], targetActorIds: [], rejections: [] });
  });

  test('relationship maintenance requires seven full game days of debt', () => {
    const sixDays = build([
      source('relationship_maintenance', { maintenanceDebtGameDays: 6 }),
    ]);
    expect(sixDays.entries).toHaveLength(0);
    expect(sixDays.rejections[0]?.reasonCode).toBe('social_target_irrelevant');
    expect(
      build([
        source('relationship_maintenance', { maintenanceDebtGameDays: 7 }),
      ]).entries,
    ).toHaveLength(1);
  });

  test('canonical input order and exact duplicates replay to the same bundle', () => {
    const left = source('care_or_aid', { topicRefs: ['topic:z', 'topic:a'] });
    const right = source('knowledge_gap', {
      targetActorId: 'actor:c',
      sourceRef: 'belief:2',
      topicRefs: ['claim:2'],
    });
    const a = build([left, right, { ...left, topicRefs: ['topic:a', 'topic:z'] }]);
    const b = build([right, left]);
    expect(a.sourceSetDigest).toBe(b.sourceSetDigest);
    expect(a.entries.map((entry) => entry.candidate.candidateId)).toEqual(
      b.entries.map((entry) => entry.candidate.candidateId),
    );
  });

  test('conflicting duplicate source identities fail closed', () => {
    const first = source('knowledge_gap');
    expect(() => build([first, { ...first, sourceRevision: 'knowledge_gap:rev-2' }])).toThrow(
      /same_location_social_source_conflict/,
    );
  });

  test('stable ordering limits unique targets to three and entries to twelve', () => {
    const sources = Array.from({ length: 20 }, (_, index) =>
      source(index % 2 === 0 ? 'care_or_aid' : 'active_obligation', {
        targetActorId: `actor:${String(index % 6).padStart(2, '0')}`,
        sourceRef: `request:${String(index).padStart(2, '0')}`,
        sourceRevision: `request:rev-${index}`,
        topicRefs: [`topic:${index}`],
      }),
    );
    const bundle = build(sources);
    expect(bundle.targetActorIds).toHaveLength(SAME_LOCATION_SOCIAL_TARGET_LIMIT);
    expect(bundle.entries.length).toBeLessThanOrEqual(SAME_LOCATION_SOCIAL_CANDIDATE_LIMIT);
    expect(new Set(bundle.entries.map((entry) => entry.source.targetActorId)).size).toBeLessThanOrEqual(3);
  });

  test.each([
    ['target busy', { targetBusy: true }, 'social_target_busy'],
    ['target unavailable', { targetAliveAndCapable: false }, 'social_target_unavailable'],
    ['target irrelevant', { targetRelevant: false }, 'social_target_irrelevant'],
    ['privacy denied', { disclosureAllowed: false }, 'social_disclosure_forbidden'],
    ['cooldown', { cooldownClear: false }, 'social_cooldown_active'],
    ['capacity', { sessionCapacityAvailable: false }, 'social_session_capacity_full'],
    ['moved', { targetLocationId: 'market' }, 'social_target_moved'],
  ] as const)('filters %s with a stable reason', (_label, patch, reasonCode) => {
    const bundle = build([source('care_or_aid', patch)]);
    expect(bundle.entries).toHaveLength(0);
    expect(bundle.rejections[0]?.reasonCode).toBe(reasonCode);
  });

  test('expired and wrong-location sources fail closed', () => {
    expect(build([source('care_or_aid', { expiresAt: 150 })]).rejections[0]?.reasonCode).toBe(
      'social_source_stale',
    );
    expect(build([source('care_or_aid', { locationId: 'market' })]).rejections[0]?.reasonCode).toBe(
      'social_meeting_location_invalid',
    );
  });

  test('latest source revision, movement, privacy and cooldown are revalidated', () => {
    const original = source('knowledge_gap');
    const entry = build([original]).entries[0];
    expect(
      revalidateSameLocationSocialOpportunityEntry({
        entry,
        now: 151,
        actorAliveAndCapable: true,
        actorBusy: false,
        latestSource: original,
      }),
    ).toBeUndefined();
    expect(
      revalidateSameLocationSocialOpportunityEntry({
        entry,
        now: 151,
        actorAliveAndCapable: true,
        actorBusy: false,
        latestSource: { ...original, sourceRevision: 'knowledge_gap:rev-2' },
      }),
    ).toBe('social_source_stale');
    expect(
      revalidateSameLocationSocialOpportunityEntry({
        entry,
        now: 151,
        actorAliveAndCapable: true,
        actorBusy: false,
        latestSource: { ...original, targetLocationId: 'market' },
      }),
    ).toBe('social_target_moved');
    expect(
      revalidateSameLocationSocialOpportunityEntry({
        entry,
        now: 151,
        actorAliveAndCapable: true,
        actorBusy: false,
        latestSource: { ...original, disclosureAllowed: false },
      }),
    ).toBe('social_disclosure_forbidden');
    expect(
      revalidateSameLocationSocialOpportunityEntry({
        entry,
        now: 151,
        actorAliveAndCapable: true,
        actorBusy: false,
        latestSource: { ...original, cooldownClear: false },
      }),
    ).toBe('social_cooldown_active');
  });

  test('unknown fields, duplicate topics and malformed identifiers are rejected', () => {
    expect(() => build([{ ...source('care_or_aid'), extra: true } as SameLocationSocialSource])).toThrow(
      'same_location_social_source_unknown_field',
    );
    expect(() => build([source('care_or_aid', { topicRefs: ['topic:a', 'topic:a'] })])).toThrow(
      /social_warrant_topic_duplicate/,
    );
    expect(() => sameLocationSocialSourceDigest(source('care_or_aid', { targetActorId: 'bad id' }))).toThrow(
      /social_warrant_target_invalid/,
    );
  });
});

describe('拟人生活 v1：维护情谊按亲疏分档、好友之间送礼', () => {
  const derive = (
    relationship: number,
    lastTouchedDay: number,
    options: {
      tiers?: Array<{ minRelationship: number; debtDays: number }>;
      giftAt?: number;
      hasGiftableItem?: boolean;
      giftCooldownClear?: boolean;
    } = {},
  ) =>
    deriveSameLocationSocialSources({
      nowGameHour: 240,
      currentGameDay: 10,
      maintenanceMinRelationship: 15,
      maintenanceDebtDays: 1,
      ...(options.tiers ? { maintenanceDebtDaysByRelationship: options.tiers } : {}),
      ...(options.giftAt !== undefined ? { maintenanceGiftMinRelationship: options.giftAt } : {}),
      actor: {
        actorId: 'actor:a',
        locationId: 'herb_field',
        health: 10,
        maxHealth: 10,
        hasHealingItem: false,
        hasGiftableItem: options.hasGiftableItem ?? false,
      },
      targets: [{
        actorId: 'actor:b',
        locationId: 'herb_field',
        relationship,
        trust: 5,
        suspicion: 0,
        debt: 0,
        fear: 0,
        lastTouchedDay,
        recentlyTalked: false,
        aliveAndCapable: true,
        busy: false,
        cooldownClear: true,
        sessionCapacityAvailable: true,
        ...(options.giftCooldownClear !== undefined ? { giftCooldownClear: options.giftCooldownClear } : {}),
      }],
      requests: [],
      beliefs: [],
      memories: [],
    });
  const tiers = [
    { minRelationship: 40, debtDays: 1 },
    { minRelationship: 25, debtDays: 3 },
    { minRelationship: 15, debtDays: 6 },
  ];

  test('closer people are due sooner than acquaintances', () => {
    expect(derive(45, 9, { tiers })).toHaveLength(1);
    expect(derive(30, 9, { tiers })).toHaveLength(0);
    expect(derive(30, 7, { tiers })).toHaveLength(1);
    expect(derive(18, 5, { tiers })).toHaveLength(0);
    expect(derive(18, 4, { tiers })).toHaveLength(1);
    // Without tiers the single threshold still applies, as before.
    expect(derive(18, 9)).toHaveLength(1);
  });

  test('a close friend gets a gift when one is at hand and none was exchanged lately', () => {
    const activity = (relationship: number, hasGiftableItem: boolean, giftCooldownClear?: boolean) =>
      derive(relationship, 8, { giftAt: 40, hasGiftableItem, giftCooldownClear })[0]?.preferredActivity;
    expect(activity(45, true)).toBe('gift');
    expect(activity(45, true, false)).toBe('talk');
    expect(activity(45, false)).toBe('talk');
    expect(activity(30, true)).toBe('talk');
    // No gift threshold given: maintenance stays a talk, as before.
    expect(derive(45, 8, { hasGiftableItem: true })[0]?.preferredActivity).toBe('talk');
  });
});
