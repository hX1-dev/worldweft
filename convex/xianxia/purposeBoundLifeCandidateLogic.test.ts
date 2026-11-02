import type { AgentContext } from './agentLogic';
import {
  PURPOSE_BOUND_LIFE_CANDIDATE_LIMIT,
  buildPurposeBoundLifeCandidateBundle,
  candidateMayReplaceActivePurposeGoal,
  revalidatePurposeBoundLifeCandidate,
} from './purposeBoundLifeCandidateLogic';
import {
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';
import {
  SAME_LOCATION_SOCIAL_SOURCE_VERSION,
  type SameLocationSocialSource,
} from './sameLocationSocialOpportunityLogic';
import type { ActivePersonalGoal, PersonalGoalCandidate } from './personalGoalContracts';

function maintenanceSource(
  overrides: Partial<SameLocationSocialSource> = {},
): SameLocationSocialSource {
  return {
    contractVersion: SAME_LOCATION_SOCIAL_SOURCE_VERSION,
    actorId: 'disciple_a',
    targetActorId: 'friend_a',
    kind: 'relationship_maintenance',
    sourceRef: 'relationship:friend_a',
    sourceRevision: 'relationship:rev-40',
    topicRefs: ['relationship:maintenance:friend_a'],
    audience: 'participants',
    urgencyBand: 'routine',
    createdAt: 0,
    expiresAt: 100,
    locationId: 'herb_field',
    targetLocationId: 'herb_field',
    preferredActivity: 'talk',
    targetRelevant: true,
    targetAliveAndCapable: true,
    targetBusy: false,
    targetCanFulfillOutcome: true,
    disclosureAllowed: true,
    cooldownClear: true,
    sessionCapacityAvailable: true,
    maintenanceDebtGameDays: 7,
    ...overrides,
  };
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
    lifeObservation: {
      observationRevision: 'taixu.life_observation.v2:fixture',
    } as AgentContext['lifeObservation'],
    self: {
      actorId: 'disciple_a',
      name: '清河',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 2,
      cultivationXp: 3,
      mood: 1,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 3,
      reputation: 0,
      currentLocationId: 'herb_field',
      inventory: [],
    },
    currentLocationName: '药田',
    currentLocationSpiritualEnergy: 1,
    cultivationModes: ['ambient'],
    others: [],
    recentEvents: [],
    availableActions: ['cultivate', 'gather', 'rest', 'trade', 'talk', 'gift', 'explore'],
    knownLocations: [
      {
        locationId: 'herb_field',
        name: '药田',
        allowedActions: ['gather', 'rest', 'cultivate'],
        dangerLevel: 0,
        spiritualEnergy: 1,
      },
      {
        locationId: 'market',
        name: '坊市',
        allowedActions: ['trade', 'talk', 'explore'],
        dangerLevel: 0,
        spiritualEnergy: 0,
      },
      {
        locationId: 'mountain_gate',
        name: '山门静室',
        allowedActions: ['cultivate', 'rest'],
        dangerLevel: 0,
        spiritualEnergy: 4,
      },
    ],
    stableLifeSemanticTravelV1: false,
    purposeBoundLifeIntentV2: true,
    purposeResourceNodes: [],
    purposeShopOffers: [],
  };
  return {
    ...base,
    ...overrides,
    self: { ...base.self, ...(overrides.self ?? {}) },
  };
}

function candidates(...contexts: AgentContext[]) {
  return contexts.flatMap((entry) => buildPurposeBoundLifeCandidateBundle(entry).candidates);
}

function activePurposeGoal(candidate: PersonalGoalCandidate): ActivePersonalGoal {
  if (!candidate.purposeIntent || !candidate.purposeIntentDigest) {
    throw new Error('active_purpose_goal_fixture_missing_intent');
  }
  return {
    contractVersion: 'taixu.personal-goal.v1',
    goalId: 'goal:active',
    actorId: 'disciple_a',
    revision: 1,
    status: 'active',
    goalKey: candidate.goalKey,
    kind: candidate.kind,
    sourceRef: candidate.sourceRef,
    targetRef: candidate.targetRef,
    candidateId: candidate.candidateId,
    intent: candidate.intent,
    progressScore: candidate.progressScore,
    progressKey: candidate.progressKey,
    progressRevision: 0,
    backlog: [],
    observationRevision: 'observation:active',
    startedGameHour: 1,
    lastProgressGameHour: 1,
    deadlineGameHour: 25,
    hardDeadlineGameHour: 73,
    attemptCount: 0,
    purposeIntent: candidate.purposeIntent,
    purposeIntentDigest: candidate.purposeIntentDigest,
    purposeCadenceKey: candidate.purposeCadenceKey,
    purposeStage: 'activity_ready',
  };
}

describe('C021q2 fact-grounded purpose-bound life candidates', () => {
  test('accepts event- and belief-bound relationship candidates without rewriting their source', () => {
    const eventContext = context({
      self: {
        ...context().self,
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      others: [{
        actorId: 'friend_a', name: '林小满', realm: 'qi_refining', relationship: 20,
      }],
      sameLocationSocialSources: [maintenanceSource({
        kind: 'gratitude_or_repair',
        sourceRef: 'event:event_helped_once',
        sourceRevision: 'event:stable64:helped',
        topicRefs: ['event:event_helped_once'],
        preferredActivity: 'gift',
        maintenanceDebtGameDays: undefined,
      })],
    });
    const beliefContext = context({
      others: [{
        actorId: 'friend_a', name: '林小满', realm: 'qi_refining', relationship: 20,
      }],
      sameLocationSocialSources: [maintenanceSource({
        kind: 'knowledge_gap',
        sourceRef: 'belief:belief_uncertain',
        sourceRevision: 'belief:3',
        topicRefs: ['belief:belief_uncertain'],
        preferredActivity: 'talk',
        maintenanceDebtGameDays: undefined,
      })],
    });

    const eventCandidate = buildPurposeBoundLifeCandidateBundle(eventContext).candidates.find(
      (candidate) => candidate.intent.sourceRef === 'event:event_helped_once',
    );
    const beliefCandidate = buildPurposeBoundLifeCandidateBundle(beliefContext).candidates.find(
      (candidate) => candidate.intent.sourceRef === 'belief:belief_uncertain',
    );
    expect(eventCandidate).toMatchObject({
      intent: { purposeKind: 'relationship', intendedActivity: 'gift' },
      proposal: { type: 'gift' },
    });
    expect(beliefCandidate).toMatchObject({
      intent: { purposeKind: 'relationship', intendedActivity: 'talk' },
      proposal: { type: 'talk' },
    });
  });

  test('hides ordinary conflicts while a purpose goal is committed but keeps permitted interrupts', () => {
    const cultivation = buildPurposeBoundLifeCandidateBundle(context()).candidates.find(
      (candidate) => candidate.intent.purposeKind === 'cultivation',
    );
    const obligation = buildPurposeBoundLifeCandidateBundle(context({
      activeRequests: [{
        requestId: 'request_1', revision: 1, status: 'accepted', type: 'explore_location',
        locationId: 'market', summary: '查看坊市异常',
      }],
    })).candidates.find((candidate) => candidate.intent.purposeKind === 'obligation');
    expect(cultivation).toBeDefined();
    expect(obligation).toBeDefined();
    if (!cultivation || !obligation) throw new Error('purpose_goal_fixture_candidates_missing');

    const active = activePurposeGoal(cultivation.personalGoalCandidate);
    expect(candidateMayReplaceActivePurposeGoal(active, cultivation.personalGoalCandidate)).toBe(true);
    expect(candidateMayReplaceActivePurposeGoal(active, obligation.personalGoalCandidate)).toBe(false);

    const withCommittedGoal = buildPurposeBoundLifeCandidateBundle(context({
      personalGoal: active,
      activeRequests: [{
        requestId: 'request_1', revision: 1, status: 'accepted', type: 'explore_location',
        locationId: 'market', summary: '查看坊市异常',
      }],
    }));
    expect(withCommittedGoal.candidates.map((candidate) => candidate.personalGoalCandidate.goalKey))
      .toEqual([active.goalKey]);
  });

  test('generates all seven purpose classes from explicit server facts', () => {
    const recovery = context({
      self: { ...context().self, fatigue: 75 },
    });
    const livelihood = context({
      purposeResourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: '朝露草丛',
          locationId: 'herb_field',
          itemId: 'spirit_herb',
          available: 2,
          sourceRevision: 'resource:v2',
        },
      ],
    });
    const obligation = context({
      activeRequests: [
        {
          requestId: 'request_1',
          revision: 2,
          status: 'accepted',
          type: 'explore_location',
          locationId: 'market',
          summary: '查看坊市异常',
        },
      ],
    });
    const relationship = context({
      others: [
        {
          actorId: 'friend_a',
          name: '林小满',
          realm: 'qi_refining',
          relationship: 40,
          trust: 20,
        },
      ],
      sameLocationSocialSources: [maintenanceSource()],
    });
    const exploration = context({
      worldPressures: [
        {
          pressureId: 'miasma_1',
          revision: 3,
          kind: 'herb_miasma',
          status: 'active',
          mapId: 'world',
          locationId: 'market',
          affectedResourceNodeIds: [],
          severity: 1,
          effectCodes: ['resource_refresh_delayed'],
          endsAt: 10_000,
          endsAtGameHour: 20,
          sourceEventId: 'event_1',
        },
      ],
    });
    const all = candidates(recovery, livelihood, obligation, relationship, exploration);
    expect(new Set(all.map((candidate) => candidate.intent.purposeKind))).toEqual(
      new Set([
        'recovery',
        'cultivation',
        'livelihood',
        'obligation',
        'relationship',
        'exploration',
        'duty_return',
      ]),
    );
    for (const candidate of all) {
      expect(validatePurposeBoundLifeIntentV2(candidate.intent).ok).toBe(true);
      expect(candidate.intentDigest).toBe(purposeBoundLifeIntentDigest(candidate.intent));
      expect(candidate.proposal.params).toMatchObject({
        purposeBoundIntent: candidate.intent,
        purposeBoundIntentDigest: candidate.intentDigest,
      });
    }
  });

  test('tells the gatherer what the trip looks like without changing the intent it commits to', () => {
    const node = {
      resourceNodeId: 'dew_patch',
      name: '朝露草丛',
      locationId: 'herb_field',
      itemId: 'spirit_herb',
      available: 1,
      sourceRevision: 'resource:v2',
    };
    const plain = buildPurposeBoundLifeCandidateBundle(
      context({ purposeResourceNodes: [node] }),
    ).candidates.find((candidate) => candidate.planner === 'gather');
    const informed = buildPurposeBoundLifeCandidateBundle(
      context({
        purposeResourceNodes: [
          {
            ...node,
            outlook: {
              inTransitActorCount: 1,
              heldForRequestCount: 0,
              etaGameHours: 0,
              expectedAvailableOnArrival: 0,
              lastOutcome: { status: 'failed', reasonCode: 'purpose_goal_source_missing', hoursAgo: 12 },
            },
          },
        ],
      }),
    ).candidates.find((candidate) => candidate.planner === 'gather');

    expect(plain?.proposal.intent).toBe('行囊缺少spirit_herb，从朝露草丛采集一份');
    expect(informed?.proposal.intent).toBe(
      '行囊缺少spirit_herb，从朝露草丛采集一份（另有1人已动身，预计到达时剩0份，你上次来此扑空（12小时前））',
    );
    expect(informed?.candidateId).toBe(plain?.candidateId);
    expect(informed?.intentDigest).toBe(plain?.intentDigest);
    expect(informed?.intent).toEqual(plain?.intent);
  });

  test('finishes the gather step of a collect request at ready_to_turn_in, not completed', () => {
    const accepted = context({
      activeRequests: [
        {
          requestId: 'request_collect_1',
          revision: 4,
          status: 'accepted',
          type: 'collect_item',
          itemId: 'spirit_herb',
          qty: 1,
          summary: '采集一株灵草',
        },
      ],
      purposeResourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: '朝露草丛',
          locationId: 'herb_field',
          itemId: 'spirit_herb',
          available: 1,
          sourceRevision: 'resource:v4',
        },
      ],
    });

    const gather = buildPurposeBoundLifeCandidateBundle(accepted).candidates.find(
      (candidate) =>
        candidate.intent.purposeKind === 'obligation' &&
        candidate.intent.intendedActivity === 'gather',
    );
    expect(gather?.intent.completionCondition).toMatchObject({
      kind: 'request_status_equals',
      status: 'ready_to_turn_in',
    });
  });

  test('does not turn location affordances into random travel when no purpose fact exists', () => {
    const merchant = context({
      self: {
        ...context().self,
        actorId: 'merchant_a',
        role: 'merchant',
        currentLocationId: 'market',
      },
      currentLocationName: '坊市',
      availableActions: ['trade', 'rest', 'talk'],
      purposeResourceNodes: [],
      purposeShopOffers: [],
    });
    const bundle = buildPurposeBoundLifeCandidateBundle(merchant);
    expect(bundle.candidates).toEqual([]);
    expect(bundle.intentionalIdle).toMatchObject({ reasonCode: 'awaiting_customer' });
  });

  test('binds remote livelihood travel to the exact resource node or shop quote', () => {
    const ctx = context({
      self: {
        ...context().self,
        currentLocationId: 'mountain_gate',
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      purposeResourceNodes: [
        {
          resourceNodeId: 'ore_1',
          name: '浅层矿脉',
          locationId: 'herb_field',
          itemId: 'iron_ore',
          available: 1,
          sourceRevision: 'resource:v4',
        },
      ],
      purposeShopOffers: [
        {
          shopId: 'shop_1',
          shopName: '百草铺',
          locationId: 'market',
          targetActorId: 'merchant_a',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 6,
          totalPrice: 6,
          stock: 2,
          capacity: 8,
          walletSpiritStones: 30,
          sourceRevision: 'shop:v7',
        },
      ],
    });
    const bundle = buildPurposeBoundLifeCandidateBundle(ctx);
    const gather = bundle.candidates.find(
      (candidate) => candidate.intent.intendedActivity === 'gather',
    );
    const trade = bundle.candidates.find(
      (candidate) => candidate.intent.intendedActivity === 'trade',
    );
    expect(gather?.proposal).toMatchObject({
      type: 'travel',
      targetId: 'herb_field',
      params: { resourceNodeId: 'ore_1' },
    });
    expect(trade?.proposal).toMatchObject({
      type: 'travel',
      targetId: 'market',
      params: { shopId: 'shop_1', quoteRevision: 'shop:v7' },
    });
  });

  test('is deterministic under input reordering and never exceeds twelve choices', () => {
    const nodes = Array.from({ length: 20 }, (_, index) => ({
      resourceNodeId: `node_${index.toString().padStart(2, '0')}`,
      name: `资源 ${index}`,
      locationId: 'herb_field',
      itemId: `item_${index}`,
      available: 1,
      sourceRevision: `resource:v${index}`,
    }));
    const forward = buildPurposeBoundLifeCandidateBundle(
      context({ purposeResourceNodes: nodes }),
    );
    const reverse = buildPurposeBoundLifeCandidateBundle(
      context({
        purposeResourceNodes: [...nodes].reverse(),
        knownLocations: [...(context().knownLocations ?? [])].reverse(),
      }),
    );
    expect(forward.candidates).toHaveLength(PURPOSE_BOUND_LIFE_CANDIDATE_LIMIT);
    expect(reverse.candidateSetDigest).toBe(forward.candidateSetDigest);
    expect(reverse.candidates.map((candidate) => candidate.candidateId)).toEqual(
      forward.candidates.map((candidate) => candidate.candidateId),
    );
  });

  test('rejects changed and disappeared facts instead of silently retargeting', () => {
    const originalContext = context({
      purposeResourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: '朝露草丛',
          locationId: 'herb_field',
          itemId: 'spirit_herb',
          available: 2,
          sourceRevision: 'resource:v2',
        },
      ],
    });
    const candidate = buildPurposeBoundLifeCandidateBundle(originalContext).candidates.find(
      (entry) => entry.intent.sourceRef === 'resource:dew_patch',
    );
    expect(candidate).toBeDefined();
    if (!candidate) return;
    const base = {
      actorId: originalContext.self.actorId,
      candidateId: candidate.candidateId,
      intent: candidate.intent,
      intentDigest: candidate.intentDigest,
      proposalDigest: candidate.proposalDigest,
    };
    expect(
      revalidatePurposeBoundLifeCandidate({
        ...base,
        freshContext: context({
          purposeResourceNodes: [
            {
              ...originalContext.purposeResourceNodes![0],
              sourceRevision: 'resource:v3',
            },
          ],
        }),
      }),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_revision_stale' });
    expect(
      revalidatePurposeBoundLifeCandidate({
        ...base,
        freshContext: context({ purposeResourceNodes: [] }),
      }),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_missing' });
    expect(
      revalidatePurposeBoundLifeCandidate({
        ...base,
        freshContext: context({
          knownLocations: (context().knownLocations ?? []).filter(
            (location) => location.locationId !== 'herb_field',
          ),
          purposeResourceNodes: originalContext.purposeResourceNodes,
        }),
      }),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_target_stale' });
  });

  test('fail-closes every purpose family when its originating fact drifts', () => {
    const resultFor = (
      originalContext: AgentContext,
      freshContext: AgentContext,
      purposeKind: string,
      intendedActivity?: string,
    ) => {
      const candidate = buildPurposeBoundLifeCandidateBundle(originalContext).candidates.find(
        (entry) =>
          entry.intent.purposeKind === purposeKind &&
          (!intendedActivity || entry.intent.intendedActivity === intendedActivity),
      );
      expect(candidate).toBeDefined();
      if (!candidate) throw new Error(`missing fixture candidate: ${purposeKind}`);
      return revalidatePurposeBoundLifeCandidate({
        actorId: originalContext.self.actorId,
        candidateId: candidate.candidateId,
        intent: candidate.intent,
        intentDigest: candidate.intentDigest,
        proposalDigest: candidate.proposalDigest,
        freshContext,
      });
    };

    expect(
      resultFor(
        context({ self: { ...context().self, fatigue: 75 } }),
        context({ self: { ...context().self, fatigue: 10 } }),
        'recovery',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_activity_unavailable' });

    const cultivation = context();
    expect(
      resultFor(
        cultivation,
        context({
          self: { ...cultivation.self, cultivationXp: cultivation.self.cultivationXp + 1 },
        }),
        'cultivation',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_revision_stale' });

    const trade = context({
      self: {
        ...context().self,
        currentLocationId: 'mountain_gate',
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      purposeShopOffers: [
        {
          shopId: 'shop_1',
          shopName: '百草铺',
          locationId: 'market',
          targetActorId: 'merchant_a',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 6,
          totalPrice: 6,
          stock: 2,
          capacity: 8,
          walletSpiritStones: 30,
          sourceRevision: 'shop:v7',
        },
      ],
    });
    expect(
      resultFor(
        trade,
        context({
          self: trade.self,
          purposeShopOffers: [
            { ...trade.purposeShopOffers![0], totalPrice: 5, sourceRevision: 'shop:v8' },
          ],
        }),
        'livelihood',
        'trade',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_revision_stale' });

    const obligation = context({
      activeRequests: [
        {
          requestId: 'request_1',
          revision: 2,
          status: 'accepted',
          type: 'explore_location',
          locationId: 'market',
          summary: '查看坊市异常',
        },
      ],
    });
    expect(
      resultFor(
        obligation,
        context({
          activeRequests: [{ ...obligation.activeRequests![0], revision: 3 }],
        }),
        'obligation',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_revision_stale' });

    const relationship = context({
      others: [
        {
          actorId: 'friend_a',
          name: '林小满',
          realm: 'qi_refining',
          relationship: 40,
          trust: 20,
        },
      ],
      sameLocationSocialSources: [maintenanceSource()],
    });
    expect(
      resultFor(
        relationship,
        context({
          others: [{ ...relationship.others[0], relationship: 41 }],
          sameLocationSocialSources: [
            maintenanceSource({ sourceRevision: 'relationship:rev-41' }),
          ],
        }),
        'relationship',
        'talk',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_revision_stale' });

    const pressure: NonNullable<AgentContext['worldPressures']>[number] = {
      pressureId: 'miasma_1',
      revision: 3,
      kind: 'herb_miasma',
      status: 'active',
      mapId: 'world',
      locationId: 'market',
      affectedResourceNodeIds: [],
      severity: 1,
      effectCodes: ['resource_refresh_delayed'],
      endsAt: 10_000,
      endsAtGameHour: 20,
      sourceEventId: 'event_1',
    };
    expect(
      resultFor(
        context({ worldPressures: [pressure] }),
        context({ worldPressures: [{ ...pressure, revision: 4 }] }),
        'exploration',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_source_revision_stale' });

    const duty = context();
    expect(
      resultFor(
        duty,
        context({ self: { ...duty.self, currentLocationId: 'mountain_gate' } }),
        'duty_return',
      ),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_candidate_activity_unavailable' });
  });
});

describe('拟人生活 v1：作息、散心与谋生的候选', () => {
  const places: NonNullable<AgentContext['knownLocations']> = [
    { locationId: 'mountain_gate', name: '山门', allowedActions: ['cultivate', 'rest', 'talk', 'gift'], dangerLevel: 0, spiritualEnergy: 4 },
    { locationId: 'herb_field', name: '药圃', allowedActions: ['gather', 'cultivate', 'rest', 'talk'], dangerLevel: 0, spiritualEnergy: 1 },
    { locationId: 'market', name: '坊市', allowedActions: ['trade', 'rest', 'talk', 'gift'], dangerLevel: 0, spiritualEnergy: 0 },
    { locationId: 'rest_pavilion', name: '歇脚亭', allowedActions: ['rest', 'talk'], dangerLevel: 0, spiritualEnergy: 0 },
    { locationId: 'alchemy_room', name: '丹房', allowedActions: ['rest', 'talk', 'inspect'], dangerLevel: 0, spiritualEnergy: 1 },
  ];
  type Focus = NonNullable<NonNullable<AgentContext['humanDay']>['focus']>;
  const human = (
    hour: number,
    self: Partial<AgentContext['self']> = {},
    day: { focus?: Focus; keepForGift?: number } = {},
    overrides: Partial<AgentContext> = {},
  ) =>
    context({
      knownLocations: places,
      currentGameHour: hour,
      humanLifeV1: true,
      humanDay: { bedtimeHour: 22, wakeHour: 6, ...day },
      ...overrides,
      self: { mood: 5, currentLocationId: 'mountain_gate', ...self } as AgentContext['self'],
    });
  const purposes = (entry: AgentContext) =>
    buildPurposeBoundLifeCandidateBundle(entry).candidates.map((candidate) => ({
      planner: candidate.planner,
      activity: candidate.personalGoalCandidate?.purposeIntent?.intendedActivity,
      target: candidate.personalGoalCandidate?.purposeIntent?.targetLocationId,
    }));

  test('at bedtime someone away from home walks home to sleep, tired or not', () => {
    expect(purposes(human(23, { currentLocationId: 'market', fatigue: 0 }))).toEqual([
      { planner: 'rest', activity: 'rest', target: 'mountain_gate' },
    ]);
    const atHome = buildPurposeBoundLifeCandidateBundle(human(23, { fatigue: 0 }));
    expect(atHome.candidates).toEqual([]);
    expect(atHome.intentionalIdle).toMatchObject({ reasonCode: 'sleeping', untilGameHour: 30 });
  });

  test('asleep, nothing but the body is offered', () => {
    const night = purposes(human(2, { fatigue: 30 }));
    expect(night.length).toBeGreaterThan(0);
    expect(night.every((entry) => entry.planner === 'rest' && entry.activity === 'rest')).toBe(true);
    expect(purposes(human(12, { fatigue: 30 })).some((entry) => entry.activity === 'cultivate')).toBe(true);
  });

  test('a tired person unwinds at a public spot, never at a guard post, and not on a cultivation day', () => {
    const leisure = (focus: Focus) =>
      purposes(human(12, { fatigue: 30 }, { focus })).filter((entry) => entry.planner === 'leisure');
    expect(leisure('social')).toEqual([{ planner: 'leisure', activity: 'rest', target: 'market' }]);
    expect(leisure('idle')).toEqual([{ planner: 'leisure', activity: 'rest', target: 'rest_pavilion' }]);
    expect(leisure('cultivation')).toEqual([]);
  });

  test('on a free day an ordinary mood goes out once; a cheered one stays', () => {
    const outing = (mood: number, currentLocationId = 'mountain_gate') =>
      purposes(human(10, { fatigue: 0, mood, currentLocationId }, { focus: 'idle' })).filter(
        (entry) => entry.planner === 'leisure',
      );
    expect(outing(5)).toEqual([{ planner: 'leisure', activity: 'rest', target: 'rest_pavilion' }]);
    expect(outing(6)).toEqual([]);
    expect(outing(5, 'rest_pavilion')).toEqual([]);
    expect(
      purposes(human(10, { fatigue: 0, mood: 5 }, { focus: 'cultivation' })).some(
        (entry) => entry.planner === 'leisure',
      ),
    ).toBe(false);
  });

  test('cultivation is spaced by the focus of the day', () => {
    const window = {
      goalId: 'goal:cultivate',
      cadenceKey: 'purpose_cadence:earlier',
      sourceRef: 'cultivation:disciple_a',
      sourceRevision: 'cultivation:rev',
      purposeKind: 'cultivation' as const,
      intendedActivity: 'cultivate' as const,
      terminalStatus: 'completed' as const,
      terminalReasonCode: 'purpose_goal_activity_completed',
      terminalGameHour: 9,
      nextEligibleGameHour: 11,
    };
    const cultivates = (focus: Focus) =>
      purposes(human(12, { fatigue: 0 }, { focus }, { personalGoalCadences: [window] })).some(
        (entry) => entry.activity === 'cultivate',
      );
    expect(cultivates('cultivation')).toBe(true);
    expect(cultivates('idle')).toBe(false);
  });

  test('an herb kept for a gift is not sold, and does not stop the gathering', () => {
    const offers: AgentContext['purposeShopOffers'] = [{
      shopId: 'shop_1',
      shopName: '百草铺',
      locationId: 'market',
      targetActorId: 'merchant_a',
      direction: 'sell',
      itemId: 'spirit_herb',
      qty: 1,
      unitPrice: 6,
      totalPrice: 6,
      stock: 2,
      capacity: 8,
      walletSpiritStones: 30,
      sourceRevision: 'shop:v7',
    }];
    const nodes: AgentContext['purposeResourceNodes'] = [{
      resourceNodeId: 'dew_patch',
      name: '朝露草丛',
      locationId: 'herb_field',
      itemId: 'spirit_herb',
      available: 2,
      sourceRevision: 'resource:v2',
    }];
    const holding = (keepForGift?: number) =>
      purposes(
        human(
          10,
          { fatigue: 0, inventory: [{ itemId: 'spirit_herb', qty: 1 }] },
          { focus: 'livelihood', ...(keepForGift ? { keepForGift } : {}) },
          { purposeShopOffers: offers, purposeResourceNodes: nodes },
        ),
      ).map((entry) => entry.activity);
    expect(holding()).toEqual(expect.arrayContaining(['trade']));
    expect(holding()).not.toContain('gather');
    expect(holding(1)).not.toContain('trade');
    expect(holding(1)).toContain('gather');
  });
});

describe('拟人生活 v1：记仇和名声改变找谁聊', () => {
  test('a grudge or a bad name keeps people from seeking someone out, close friends excepted', () => {
    const source = (targetActorId: string) =>
      maintenanceSource({
        targetActorId,
        sourceRef: `relationship:${targetActorId}`,
        sourceRevision: `relationship:rev-${targetActorId}`,
        topicRefs: [`relationship:maintenance:${targetActorId}`],
        locationId: 'mountain_gate',
        targetLocationId: 'mountain_gate',
        maintenanceDebtGameDays: 9,
      });
    const others: AgentContext['others'] = [
      { actorId: 'grudged', name: 'G', realm: 'qi_refining', relationship: 30, suspicion: 20 },
      { actorId: 'rowdy', name: 'R', realm: 'qi_refining', relationship: 30, impression: { warmth: 0, trouble: 1.2 } },
      { actorId: 'old_friend', name: 'F', realm: 'qi_refining', relationship: 50, impression: { warmth: 0, trouble: 1.2 } },
      { actorId: 'plain', name: 'P', realm: 'qi_refining', relationship: 30 },
    ];
    const bundle = buildPurposeBoundLifeCandidateBundle(
      context({
        knownLocations: [
          { locationId: 'mountain_gate', name: '山门', allowedActions: ['cultivate', 'rest', 'talk', 'gift'], dangerLevel: 0, spiritualEnergy: 4 },
        ],
        currentGameHour: 10,
        humanLifeV1: true,
        humanDay: { bedtimeHour: 22, wakeHour: 6, focus: 'social' },
        others,
        sameLocationSocialSources: others.map((other) => source(other.actorId)),
        self: { ...context().self, currentLocationId: 'mountain_gate', mood: 5 },
      }),
    );
    const sought = bundle.candidates
      .filter((candidate) => candidate.planner === 'social_warrant')
      .map((candidate) => candidate.proposal.targetActorId)
      .sort();
    expect(sought).toEqual(['old_friend', 'plain']);
  });
});
