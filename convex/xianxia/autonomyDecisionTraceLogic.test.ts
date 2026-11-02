import {
  PI_NPC_ELIGIBLE_CANDIDATE_LIMIT,
  PI_NPC_SEMANTIC_TRAVEL_CANDIDATE_LIMIT,
  PI_NPC_SEMANTIC_TRAVEL_MAX_DANGER_LEVEL,
  assertPiNpcCandidateFingerprintsUnique,
  autonomousAgentLlmEnabled,
  buildAutonomyDecisionTrace,
  buildPiNpcEligibleCandidateBundle,
  collectAutonomyCandidates,
  evaluateAutonomyTraceReplay,
  piNpcProposalFingerprint,
  piNpcCanonicalCandidateSetDigest,
  revalidatePiNpcEligibleCandidate,
  selectPersonaPreferredProposal,
} from './autonomyDecisionTraceLogic';
import {
  planCombatIntent,
  planGatherIntent,
  planRestIntent,
  planSelfCareIntent,
  planShopTradeIntent,
  planStrategicIntent,
  type AgentContext,
  type AgentProposal,
} from './agentLogic';
import { planRoutineIntent } from './routineLogic';
import { buildPurposeBoundLifeCandidateBundle } from './purposeBoundLifeCandidateLogic';
import { autonomyCandidateProjectionDigest } from './autonomyDecisionContracts';
import {
  createTaixuSelfCore,
  decisionDispositionsForTaixuSelf,
  taixuSelfDecisionBinding,
  type TaixuSelfCoreV1,
} from './taixuSelfCoreLogic';

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
    lifeObservation: {
      observationRevision: 'taixu.life-observation.v1:fixture-revision',
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
      spirit: 0,
      reputation: 0,
      currentLocationId: 'herb_field',
      inventory: [],
      innerTrait: '中庸',
      outerTrait: '任我',
    },
    currentLocationName: '药田',
    others: [],
    recentEvents: [],
    availableActions: ['cultivate', 'gather', 'rest', 'trade', 'talk', 'use_item'],
    knownLocations: [
      { locationId: 'herb_field', name: '药田', allowedActions: ['gather'] },
      { locationId: 'rest_hut', name: '歇脚棚', allowedActions: ['rest'] },
      { locationId: 'mountain_gate', name: '山门', allowedActions: ['cultivate'] },
    ],
    stableLifeSemanticTravelV1: true,
    resourceNodes: [],
    shopOffers: [],
  };
  return {
    ...base,
    ...overrides,
    self: { ...base.self, ...(overrides.self ?? {}) },
  };
}

function legacyRuleProposal(ctx: AgentContext): AgentProposal | null {
  return (
    planCombatIntent(ctx) ??
    planSelfCareIntent(ctx) ??
    planRestIntent(ctx) ??
    planGatherIntent(ctx) ??
    planShopTradeIntent(ctx) ??
    planStrategicIntent(ctx) ??
    (() => {
      const routine = planRoutineIntent(ctx);
      return routine.kind === 'act' ? routine.proposal : null;
    })()
  );
}

describe('C017a–C017c bounded autonomy decision trace', () => {
  test('keeps external autonomy LLM calls disabled unless explicitly enabled', () => {
    expect(autonomousAgentLlmEnabled(undefined)).toBe(false);
    expect(autonomousAgentLlmEnabled('0')).toBe(false);
    expect(autonomousAgentLlmEnabled('true')).toBe(false);
    expect(autonomousAgentLlmEnabled('1')).toBe(true);
  });

  test('collects simultaneous legal planners while preserving the legacy self-care choice', () => {
    const ctx = context({
      self: {
        ...context().self,
        health: 4,
        fatigue: 80,
        inventory: [
          { itemId: 'healing_pill', qty: 1 },
          { itemId: 'spirit_herb', qty: 1 },
        ],
      },
      resourceNodes: [
        {
          resourceNodeId: 'ore_1',
          name: '碎矿脉',
          itemId: 'iron_ore',
          stock: 3,
          available: 3,
        },
      ],
      shopOffers: [
        {
          shopId: 'shop_1',
          shopName: '补给铺',
          targetActorId: 'merchant',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 6,
          totalPrice: 6,
          stock: 0,
          capacity: 5,
          walletSpiritStones: 20,
        },
      ],
    });
    const before = legacyRuleProposal(ctx);
    expect(before?.type).toBe('use_item');
    const trace = buildAutonomyDecisionTrace({
      context: ctx,
      now: 1_000,
      selectedProposal: before ?? undefined,
      decisionSource: 'rule',
    });
    const after = legacyRuleProposal(ctx);
    expect(after).toEqual(before);
    expect(
      new Set(
        trace.candidates
          .filter((candidate) => candidate.status === 'eligible')
          .map((candidate) => candidate.planner),
      ),
    ).toEqual(new Set(['survival', 'self_care', 'rest', 'gather', 'shop', 'routine', 'lifestyle']));
    expect(
      trace.candidates.find((candidate) => candidate.candidateId === trace.chosenCandidateId),
    ).toMatchObject({
      planner: 'survival',
      intentKind: 'use_item',
      survivalUrgency: 90,
      survivalReasonCodes: ['survival_serious_injury'],
    });
    expect(trace.contractVersion).toBe('taixu.autonomy-decision.v3');
    expect(trace.personaPolicy).toMatchObject({
      policyVersion: 'taixu.persona-policy.v1',
      innerTrait: '中庸',
      outerTrait: '任我',
    });
    expect(trace.survivalEnvelope).toMatchObject({
      state: 'recovery',
      urgency: 90,
      decisionKind: 'use_item',
    });
  });

  test('enumerates resource, shop and quest variants without changing each legacy first choice', () => {
    const ctx = context({
      self: {
        ...context().self,
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      resourceNodes: [
        { resourceNodeId: 'a', name: '甲矿', itemId: 'iron_ore', stock: 2, available: 2 },
        { resourceNodeId: 'b', name: '乙木', itemId: 'spirit_wood', stock: 2, available: 2 },
      ],
      shopOffers: [
        {
          shopId: 'a_shop',
          shopName: '甲铺',
          targetActorId: 'merchant_a',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 6,
          totalPrice: 6,
          stock: 0,
          capacity: 5,
          walletSpiritStones: 20,
        },
        {
          shopId: 'b_shop',
          shopName: '乙铺',
          targetActorId: 'merchant_b',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 7,
          totalPrice: 7,
          stock: 0,
          capacity: 5,
          walletSpiritStones: 20,
        },
      ],
      activeRequests: [
        {
          requestId: 'request_a',
          status: 'accepted',
          type: 'explore_location',
          locationId: 'rest_hut',
          summary: '查看歇脚棚',
        },
        {
          requestId: 'request_b',
          status: 'offered',
          type: 'collect_item',
          itemId: 'iron_ore',
          summary: '收集铁矿',
        },
      ],
    });
    const candidates = collectAutonomyCandidates(ctx, 1_000);
    expect(candidates.filter((candidate) => candidate.planner === 'gather')).toHaveLength(2);
    expect(candidates.filter((candidate) => candidate.planner === 'shop')).toHaveLength(2);
    expect(candidates.filter((candidate) => candidate.planner === 'quest')).toHaveLength(2);
    expect(candidates).toContainEqual(
      expect.objectContaining({
        planner: 'quest',
        targetRef: 'request:request_b',
        blockedReasonCode: 'quest_offer_source_missing',
      }),
    );
    expect(planGatherIntent(ctx)?.params).toEqual({ resourceNodeId: 'a' });
    expect(planShopTradeIntent(ctx)?.targetActorId).toBe('merchant_a');
    expect(planStrategicIntent(ctx)?.targetId).toBe('rest_hut');
  });

  test('turns the same depleted seasonal herb observation from winter-blocked to spring-eligible', () => {
    const winter = context({
      availableActions: ['gather'],
      resourceNodes: [
        {
          resourceNodeId: 'dew_herb_patch',
          name: '凝露草丛',
          itemId: 'spirit_herb',
          stock: 0,
          available: 0,
          seasonalState: 'dormant',
          seasonalRefreshBlockedUntil: 10_000,
        },
      ],
    });
    const winterCandidates = collectAutonomyCandidates(winter, 1_000).filter(
      (candidate) => candidate.planner === 'gather',
    );
    expect(winterCandidates).toEqual([
      expect.objectContaining({
        status: 'blocked',
        blockedReasonCode: 'resource_season_dormant',
      }),
    ]);

    const spring = context({
      availableActions: ['gather'],
      resourceNodes: [
        {
          resourceNodeId: 'dew_herb_patch',
          name: '凝露草丛',
          itemId: 'spirit_herb',
          stock: 1,
          available: 1,
          seasonalState: 'growing',
        },
      ],
    });
    const springCandidates = collectAutonomyCandidates(spring, 10_000).filter(
      (candidate) => candidate.planner === 'gather',
    );
    expect(springCandidates).toEqual([
      expect.objectContaining({
        status: 'eligible',
        targetRef: 'resource:dew_herb_patch',
      }),
    ]);
    expect(planGatherIntent(spring)?.params).toEqual({
      resourceNodeId: 'dew_herb_patch',
    });
  });

  test('lets a herbalist autonomously carry gathered herbs to a known market', () => {
    const ctx = context({
      self: {
        ...context().self,
        role: 'herbalist',
        innerTrait: '利己',
        outerTrait: '名声',
        currentLocationId: 'herb_field',
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      availableActions: ['travel', 'gather', 'talk'],
      knownLocations: [
        { locationId: 'herb_field', name: '药田', allowedActions: ['gather'] },
        { locationId: 'market', name: '青石坊市', allowedActions: ['trade'] },
      ],
      resourceNodes: [],
      shopOffers: [],
    });

    expect(selectPersonaPreferredProposal(ctx, 1_000)?.proposal).toMatchObject({
      type: 'travel',
      targetId: 'market',
      params: { livelihoodKind: 'sell_spirit_herb' },
    });
    const marketTravels = buildPiNpcEligibleCandidateBundle(ctx, 1_000).options.filter(
      (option) => option.proposal.type === 'travel' && option.proposal.targetId === 'market',
    );
    expect(marketTravels).toHaveLength(1);
  });

  test('builds at most three deterministic semantic travel choices from known low-risk places', () => {
    const stable = context({
      self: {
        ...context().self,
        currentLocationId: 'market',
        inventory: [],
      },
      currentLocationName: '青石坊市',
      availableActions: ['talk', 'trade', 'gift', 'steal'],
      knownLocations: [
        {
          locationId: 'danger_den',
          name: '险窟',
          allowedActions: ['explore'],
          dangerLevel: PI_NPC_SEMANTIC_TRAVEL_MAX_DANGER_LEVEL + 1,
        },
        {
          locationId: 'rest_hut',
          name: '歇脚棚',
          allowedActions: ['rest'],
        },
        {
          locationId: 'market',
          name: '青石坊市',
          allowedActions: ['trade'],
        },
        {
          locationId: 'tea_house',
          name: '茶寮',
          allowedActions: ['talk'],
        },
        {
          locationId: 'mountain_gate',
          name: '山门',
          allowedActions: ['cultivate'],
        },
        {
          locationId: 'herb_field',
          name: '药田',
          allowedActions: ['gather'],
        },
      ],
    });
    const reversed = {
      ...stable,
      knownLocations: [...(stable.knownLocations ?? [])].reverse(),
    };
    const semantic = (ctx: AgentContext) =>
      buildPiNpcEligibleCandidateBundle(ctx, 1_000).options.filter(
        (option) => option.proposal.params?.lifestyleKind === 'semantic_travel',
      );
    const first = semantic(stable);
    const second = semantic(reversed);
    expect(first).toHaveLength(PI_NPC_SEMANTIC_TRAVEL_CANDIDATE_LIMIT);
    expect(first.map((option) => option.proposal.targetId)).toEqual([
      'herb_field',
      'rest_hut',
      'tea_house',
    ]);
    expect(second.map((option) => option.candidate.candidateId)).toEqual(
      first.map((option) => option.candidate.candidateId),
    );
    expect(buildPiNpcEligibleCandidateBundle(stable, 1_000).candidateSetDigest).toBe(
      buildPiNpcEligibleCandidateBundle(reversed, 1_000).candidateSetDigest,
    );
    expect(
      first.some(
        (option) =>
          option.proposal.targetId === 'market' || option.proposal.targetId === 'danger_den',
      ),
    ).toBe(false);
    const allTravelTargets = buildPiNpcEligibleCandidateBundle(stable, 1_000)
      .options.filter((option) => option.proposal.type === 'travel')
      .map((option) => option.proposal.targetId);
    expect(new Set(allTravelTargets).size).toBe(allTravelTargets.length);
  });

  test('rejects a semantic travel candidate when the latest destination facts drift', () => {
    const original = context({
      self: {
        ...context().self,
        currentLocationId: 'market',
      },
      knownLocations: [
        {
          locationId: 'market',
          name: '青石坊市',
          allowedActions: ['trade'],
        },
        {
          locationId: 'herb_field',
          name: '药田',
          allowedActions: ['gather'],
        },
        {
          locationId: 'rest_hut',
          name: '歇脚棚',
          allowedActions: ['rest'],
        },
      ],
    });
    const option = buildPiNpcEligibleCandidateBundle(original, 1_000).options.find(
      (candidate) => candidate.proposal.targetId === 'herb_field',
    );
    expect(option).toBeDefined();
    const revalidate = (freshContext: AgentContext) =>
      revalidatePiNpcEligibleCandidate({
        actorId: original.self.actorId,
        candidateId: option!.candidate.candidateId,
        proposalFingerprint: option!.proposalFingerprint,
        freshContext,
        now: 1_001,
      });
    expect(
      revalidate({
        ...original,
        knownLocations: [...(original.knownLocations ?? [])].reverse(),
      }).ok,
    ).toBe(true);
    expect(
      revalidate({
        ...original,
        knownLocations: (original.knownLocations ?? []).map((location) =>
          location.locationId === 'herb_field'
            ? {
                ...location,
                allowedActions: ['attack', 'steal'],
              }
            : location,
        ),
      }),
    ).toMatchObject({
      ok: false,
      reasonCode: 'stale_or_invalid_candidate',
    });
    expect(
      revalidate({
        ...original,
        self: {
          ...original.self,
          currentLocationId: 'herb_field',
        },
      }),
    ).toMatchObject({
      ok: false,
      reasonCode: 'stale_or_invalid_candidate',
    });
  });

  test('purpose v2 removes affordance-only travel while legacy v1 remains replayable', () => {
    const legacy = context({
      self: {
        ...context().self,
        actorId: 'merchant_a',
        role: 'merchant',
        currentLocationId: 'market',
      },
      currentLocationName: '青石坊市',
      availableActions: ['trade', 'talk', 'rest'],
      knownLocations: [
        { locationId: 'market', name: '青石坊市', allowedActions: ['trade'] },
        { locationId: 'herb_field', name: '药田', allowedActions: ['gather'] },
        { locationId: 'rest_hut', name: '歇脚棚', allowedActions: ['rest'] },
      ],
      stableLifeSemanticTravelV1: true,
    });
    expect(
      buildPiNpcEligibleCandidateBundle(legacy, 1_000).options.some(
        (option) => option.proposal.params?.lifestyleKind === 'semantic_travel',
      ),
    ).toBe(true);
    const purposeV2: AgentContext = {
      ...legacy,
      stableLifeSemanticTravelV1: false,
      purposeBoundLifeIntentV2: true,
      purposeResourceNodes: [],
      purposeShopOffers: [],
    };
    purposeV2.purposeBoundLifeCandidateBundle =
      buildPurposeBoundLifeCandidateBundle(purposeV2);
    const bundle = buildPiNpcEligibleCandidateBundle(purposeV2, 1_000);
    expect(
      bundle.options.some(
        (option) => option.proposal.params?.lifestyleKind === 'semantic_travel',
      ),
    ).toBe(false);
    expect(bundle.options.some((option) => option.proposal.type === 'travel')).toBe(false);
  });

  test('bounds a detailed social-warrant Pi fingerprint without changing its identity', () => {
    const proposal: AgentProposal = {
      type: 'talk',
      targetActorId: 'old_friend',
      locationId: 'quiet_courtyard',
      intent: '以旧日情谊问候故人',
      source: 'agent',
      params: {
        socialWarrant: {
          contractVersion: 'taixu.social-warrant.v1',
          topicRefs: Array.from({ length: 80 }, (_, index) => `relationship:maintenance:${index}`),
        },
      },
    };
    const first = piNpcProposalFingerprint('disciple_a', proposal);
    const second = piNpcProposalFingerprint('disciple_a', proposal);
    expect(first).toBe(second);
    expect(first).toMatch(/^pi-npc-proposal:stable64:/);
    expect(Array.from(first).length).toBeLessThanOrEqual(512);
  });

  test('persists exact social candidate lineage on the immutable v3 decision candidate', () => {
    const proposal: AgentProposal = {
      type: 'talk',
      targetActorId: 'old_friend',
      locationId: 'quiet_courtyard',
      intent: '就具名旧事向故人说明',
      source: 'agent',
      params: {
        socialOpportunityCandidateId: 'social_opportunity:source-1',
        socialOpportunityCandidateDigest: 'stable64:source-1',
        socialWarrantCandidateDigest: 'stable64:warrant-source-1',
      },
    };
    const trace = buildAutonomyDecisionTrace({
      context: context(), now: 1_000, selectedProposal: proposal, decisionSource: 'rule',
    });
    const selected = trace.candidates.find(
      (candidate) => candidate.candidateId === trace.chosenCandidateId,
    );

    expect(selected?.projectedFromCandidateId).toBe('social_opportunity:source-1');
    expect(selected?.candidateProjectionDigest).toBe(autonomyCandidateProjectionDigest({
      projectedFromCandidateId: 'social_opportunity:source-1',
      projectedCandidateId: selected!.candidateId,
      sourceCandidateDigest: 'stable64:source-1',
      warrantCandidateDigest: 'stable64:warrant-source-1',
    }));
  });

  test('binds mandatory fatigue recovery to the purpose-v2 goal instead of a legacy rest action', () => {
    const purposeV2 = context({
      self: { ...context().self, fatigue: 75 },
      stableLifeSemanticTravelV1: false,
      purposeBoundLifeIntentV2: true,
      purposeResourceNodes: [],
      purposeShopOffers: [],
    });
    purposeV2.purposeBoundLifeCandidateBundle =
      buildPurposeBoundLifeCandidateBundle(purposeV2);

    const selected = selectPersonaPreferredProposal(purposeV2, 1_000);
    expect(selected).toMatchObject({
      proposal: {
        type: 'travel',
        targetId: 'rest_hut',
        params: {
          purposeBoundIntent: {
            contractVersion: 'taixu.purpose-bound-life-intent.v2',
          },
        },
      },
      personalGoalPlan: {
        selected: {
          purposeIntent: {
            purposeKind: 'recovery',
            intendedActivity: 'rest',
          },
        },
      },
    });
  });

  test('keeps semantic travel behind life, execution, conversation and mandatory survival gates', () => {
    const semanticCount = (ctx: AgentContext) =>
      buildPiNpcEligibleCandidateBundle(ctx, 1_000).options.filter(
        (option) => option.proposal.params?.lifestyleKind === 'semantic_travel',
      ).length;
    expect(
      semanticCount(
        context({
          activeConversation: {
            conversationId: 'conversation:active',
            topicId: 'daily_life',
            otherActorId: 'friend',
            otherActorName: '故友',
            turnNumber: 0,
            maxTurns: 4,
            expiresAt: 2_000,
            recentTurns: [],
            visibleFacts: [],
            beliefs: [],
          },
        }),
      ),
    ).toBe(0);
    expect(
      collectAutonomyCandidates(
        context({
          activeExecution: {
            executionId: 'execution:active',
            actionType: 'travel',
            status: 'acting',
            expiresAt: 2_000,
          },
        }),
        1_000,
      ),
    ).toEqual([
      expect.objectContaining({
        blockedReasonCode: 'action_execution_active',
      }),
    ]);
    const survival = buildPiNpcEligibleCandidateBundle(
      context({
        self: {
          ...context().self,
          health: 4,
          inventory: [
            {
              itemId: 'healing_pill',
              qty: 1,
            },
          ],
        },
      }),
      1_000,
    );
    expect(survival.options).toHaveLength(1);
    expect(survival.options[0]?.candidate.planner).toBe('survival');
  });

  test('lets a herbalist complete the livelihood loop with an authoritative market quote', () => {
    const ctx = context({
      self: {
        ...context().self,
        role: 'herbalist',
        innerTrait: '利己',
        outerTrait: '孤僻',
        currentLocationId: 'market',
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      availableActions: ['trade', 'talk', 'gift', 'use_item'],
      knownLocations: [
        { locationId: 'herb_field', name: '药田', allowedActions: ['gather'] },
        { locationId: 'market', name: '青石坊市', allowedActions: ['trade'] },
      ],
      others: [{ actorId: 'merchant', name: '药铺掌柜', realm: 'qi_refining', relationship: 0 }],
      resourceNodes: [],
      shopOffers: [
        {
          shopId: 'market_shop',
          shopName: '药铺',
          targetActorId: 'merchant',
          direction: 'sell',
          itemId: 'spirit_herb',
          qty: 1,
          unitPrice: 8,
          totalPrice: 8,
          stock: 2,
          capacity: 64,
          walletSpiritStones: 600,
        },
      ],
    });

    expect(selectPersonaPreferredProposal(ctx, 1_000)?.proposal).toMatchObject({
      type: 'trade',
      targetActorId: 'merchant',
    });
  });

  test('does not keep selecting a gift while the authoritative pair cooldown is active', () => {
    const social = context({
      self: {
        ...context().self,
        innerTrait: '仁善',
        outerTrait: '情种',
        inventory: [{ itemId: 'talisman', qty: 1 }],
      },
      availableActions: ['gift', 'explore'],
      resourceNodes: [],
      others: [{ actorId: 'friend', name: '故友', realm: 'qi_refining', relationship: 30 }],
    });

    expect(selectPersonaPreferredProposal(social, 1_000)?.proposal.type).toBe('gift');
    expect(
      selectPersonaPreferredProposal({ ...social, giftCooldownTargetActorIds: ['friend'] }, 1_000)
        ?.proposal.type,
    ).not.toBe('gift');
  });

  test('matches deterministic cultivation-mode enrichment back to the routine candidate', () => {
    const ctx = context({
      self: {
        ...context().self,
        role: 'elder',
        currentLocationId: 'mountain_gate',
      },
      availableActions: ['cultivate', 'talk'],
    });
    const trace = buildAutonomyDecisionTrace({
      context: ctx,
      now: 1_000,
      selectedProposal: {
        type: 'cultivate',
        locationId: 'mountain_gate',
        intent: '闭关参悟',
        source: 'agent',
        params: { cultivationMode: 'ambient' },
      },
      decisionSource: 'rule',
    });
    expect(
      trace.candidates.find((candidate) => candidate.candidateId === trace.chosenCandidateId),
    ).toMatchObject({ planner: 'routine', intentKind: 'cultivate' });
    expect(trace.exceptionReason).toBeUndefined();
    expect(trace.survivalEnvelope).toMatchObject({
      state: 'stable',
      urgency: 0,
      decisionKind: 'pass',
    });
  });

  test('stable health does not suppress social, duty or explicit idle outcomes', () => {
    const socialTrace = buildAutonomyDecisionTrace({
      context: context(),
      now: 1_000,
      selectedProposal: {
        type: 'talk',
        targetActorId: 'peer',
        locationId: 'herb_field',
        intent: '与同门说两句话',
        source: 'agent',
      },
      decisionSource: 'rule',
    });
    const dutyTrace = buildAutonomyDecisionTrace({
      context: context({
        lifeObservation: {
          observationRevision: 'taixu.life-observation.v1:duty-revision',
        } as AgentContext['lifeObservation'],
      }),
      now: 1_001,
      selectedProposal: {
        type: 'travel',
        targetId: 'mountain_gate',
        locationId: 'herb_field',
        intent: '返回山门履行职责',
        source: 'agent',
      },
      decisionSource: 'rule',
    });
    const idleTrace = buildAutonomyDecisionTrace({
      context: context({
        lifeObservation: {
          observationRevision: 'taixu.life-observation.v1:idle-revision',
        } as AgentContext['lifeObservation'],
      }),
      now: 1_002,
      idleReasonCode: 'no_meaningful_action',
      decisionSource: 'rule',
    });
    for (const trace of [socialTrace, dutyTrace, idleTrace]) {
      expect(trace.survivalEnvelope).toMatchObject({
        state: 'stable',
        urgency: 0,
        decisionKind: 'pass',
      });
    }
    expect(socialTrace.outcome).toBe('chosen');
    expect(dutyTrace.outcome).toBe('chosen');
    expect(idleTrace).toMatchObject({
      outcome: 'idle',
      idleReasonCode: 'no_meaningful_action',
    });
  });

  test('records stable life, execution, resource, location and cooldown reasons', () => {
    expect(
      collectAutonomyCandidates(context({ self: { ...context().self, health: 0 } }), 1_000),
    ).toEqual([expect.objectContaining({ blockedReasonCode: 'actor_incapacitated' })]);
    expect(
      collectAutonomyCandidates(
        context({
          activeExecution: {
            executionId: 'exec_1',
            actionType: 'cultivate',
            status: 'acting',
            expiresAt: 2_000,
          },
        }),
        1_000,
      ),
    ).toEqual([expect.objectContaining({ blockedReasonCode: 'action_execution_active' })]);
    const blocked = collectAutonomyCandidates(
      context({
        self: { ...context().self, fatigue: 90 },
        knownLocations: [],
        resourceNodes: [],
        others: [{ actorId: 'friend', name: '故友', realm: 'qi_refining', relationship: 30 }],
        recentlyTalked: ['friend'],
      }),
      1_000,
    );
    expect(blocked).toContainEqual(
      expect.objectContaining({ blockedReasonCode: 'rest_location_unavailable' }),
    );
    expect(blocked).toContainEqual(
      expect.objectContaining({ blockedReasonCode: 'resource_node_unavailable' }),
    );
    expect(blocked).toContainEqual(
      expect.objectContaining({ blockedReasonCode: 'conversation_cooldown_active' }),
    );
  });

  test('caps at 32 and always retains the chosen runtime candidate', () => {
    const ctx = context({
      resourceNodes: Array.from({ length: 48 }, (_, index) => ({
        resourceNodeId: `node_${String(index).padStart(2, '0')}`,
        name: `节点${index}`,
        itemId: `item_${index}`,
        stock: 1,
        available: 1,
      })),
    });
    const selected: AgentProposal = {
      type: 'explore',
      locationId: 'herb_field',
      intent: '旧模型选择的受限本地动作',
      source: 'agent',
    };
    const trace = buildAutonomyDecisionTrace({
      context: ctx,
      now: 1_000,
      selectedProposal: selected,
      decisionSource: 'fallback',
    });
    expect(trace.candidates).toHaveLength(32);
    expect(trace.bounds).toMatchObject({ limit: 32, truncated: true });
    expect(
      trace.candidates.some((candidate) => candidate.candidateId === trace.chosenCandidateId),
    ).toBe(true);
    expect(trace.exceptionReason).toBe('selected_proposal_outside_shadow_planners');
  });

  test('same revision and semantics replay, while a changed choice conflicts', () => {
    const ctx = context();
    const first = buildAutonomyDecisionTrace({
      context: ctx,
      now: 1_000,
      idleReasonCode: 'on_watch',
      decisionSource: 'rule',
    });
    const replay = { ...first, createdAt: 9_999 };
    expect(evaluateAutonomyTraceReplay(null, first)).toBe('new');
    expect(evaluateAutonomyTraceReplay(first, replay)).toBe('replay');
    expect(evaluateAutonomyTraceReplay(first, { ...replay, idleReasonCode: 'on_duty' })).toBe(
      'conflict',
    );
  });

  test('binds a Stable Self revision and rejects replay against a newer active Self', () => {
    const stableSelf = createTaixuSelfCore({
      actorId: 'disciple_a',
      revision: 1,
      authoredFrom: ['character_creation:disciple_a'],
      identity: { name: '清河', role: '外门弟子', selfSummary: '重义而谨慎。' },
      values: {
        weights: {
          survival: 90,
          commitments: 80,
          compassion: 65,
          autonomy: 35,
          cultivation: 55,
          relationships: 75,
          reputation: 30,
          resourceStewardship: 45,
        },
        bottomLines: ['不违背硬承诺'],
      },
      expression: {
        register: 'reserved',
        brevity: 70,
        forbiddenClaims: ['已修改世界事实'],
        allowedPhraseTags: ['简短'],
      },
      status: 'active',
      innerTrait: '无私',
      outerTrait: '义气',
    });
    const boundContext = {
      ...context({
        self: { ...context().self, innerTrait: '邪恶', outerTrait: '睚眦' },
      }),
      stableSelfCore: stableSelf,
    } as AgentContext & { stableSelfCore: TaixuSelfCoreV1 };
    const trace = buildAutonomyDecisionTrace({
      context: boundContext,
      now: 1_000,
      decisionSource: 'rule',
    });
    expect(trace.personaPolicy).toMatchObject({
      reasonCodes: ['persona_policy_stable_self'],
      dimensions: decisionDispositionsForTaixuSelf(stableSelf),
      selfBinding: {
        actorId: 'disciple_a',
        revision: 1,
        digest: stableSelf.digest,
        sourceRefs: ['character_creation:disciple_a'],
      },
    });
    expect(evaluateAutonomyTraceReplay(null, trace, stableSelf)).toBe('new');

    const newerSelf = createTaixuSelfCore({
      actorId: 'disciple_a',
      revision: 2,
      supersedesRevision: 1,
      authoredFrom: ['creator:update:2'],
      identity: stableSelf.identity,
      values: stableSelf.values,
      expression: stableSelf.expression,
      status: 'active',
      innerTrait: '无私',
      outerTrait: '义气',
    });
    expect(() => evaluateAutonomyTraceReplay(null, trace, newerSelf))
      .toThrow('self_stale_decision');
  });

  test('same low-risk combat diverges by persona, while high-risk survival remains mandatory', () => {
    const combat = {
      activeEncounterId: 'encounter_1',
      opponentActorId: 'enemy',
      opponentName: '宿敌',
      opponentHealth: 3,
      lootTargets: [],
    };
    const aggressive = context({
      self: {
        ...context().self,
        health: 8,
        innerTrait: '狂邪',
        outerTrait: '睚眦',
      },
      availableActions: ['attack', 'flee'],
      combat,
    });
    const benevolent = context({
      self: {
        ...context().self,
        health: 8,
        innerTrait: '仁善',
        outerTrait: '孤僻',
      },
      availableActions: ['attack', 'flee'],
      combat,
    });
    expect(selectPersonaPreferredProposal(aggressive, 1_000)?.proposal.type).toBe('attack');
    expect(selectPersonaPreferredProposal(benevolent, 1_000)?.proposal.type).toBe('flee');

    const injuredAggressive = context({
      ...aggressive,
      self: { ...aggressive.self, health: 5 },
      combat: { ...combat, opponentHealth: 9 },
    });
    const injuredBenevolent = context({
      ...benevolent,
      self: { ...benevolent.self, health: 5 },
      combat: { ...combat, opponentHealth: 9 },
    });
    for (const ctx of [injuredAggressive, injuredBenevolent]) {
      const selected = selectPersonaPreferredProposal(ctx, 1_000);
      expect(selected?.proposal.type).toBe('flee');
      expect(
        collectAutonomyCandidates(ctx, 1_000).find(
          (candidate) => candidate.candidateId === selected?.candidateId,
        )?.survivalUrgency,
      ).toBe(100);
    }
  });

  test('offered request is accepted by selfless loyalty and declined by selfish independence', () => {
    const offer = {
      requestId: 'request_offer',
      revision: 2,
      status: 'offered' as const,
      type: 'collect_item',
      itemId: 'spirit_herb',
      qty: 1,
      issuerActorId: 'elder',
      issuerLocationId: 'herb_field',
      summary: '替长老采一株灵草',
    };
    const shared = {
      activeRequests: [offer],
      others: [
        {
          actorId: 'elder',
          name: '长老',
          realm: 'foundation_building',
          relationship: 10,
        },
      ],
      availableActions: [
        'accept_request',
        'decline_request',
        'cultivate',
      ] as AgentContext['availableActions'],
    };
    const loyal = context({
      ...shared,
      self: { ...context().self, innerTrait: '无私', outerTrait: '义气' },
    });
    const selfish = context({
      ...shared,
      self: { ...context().self, innerTrait: '利己', outerTrait: '任我' },
    });
    expect(selectPersonaPreferredProposal(loyal, 1_000)?.proposal).toMatchObject({
      type: 'accept_request',
      params: { requestId: 'request_offer', expectedRevision: 2 },
    });
    expect(selectPersonaPreferredProposal(selfish, 1_000)?.proposal).toMatchObject({
      type: 'decline_request',
      params: { requestId: 'request_offer', expectedRevision: 2 },
    });
  });

  test('a remote offered request does not strand a recovered disciple away from home', () => {
    const remoteOffer = {
      requestId: 'request_remote_offer',
      revision: 1,
      status: 'offered' as const,
      type: 'collect_item',
      itemId: 'spirit_herb',
      qty: 1,
      issuerActorId: 'elder',
      issuerLocationId: 'mountain_gate',
      summary: '替长老采一株灵草',
    };
    const recoveredAwayFromHome = context({
      self: {
        ...context().self,
        role: 'inner_disciple',
        currentLocationId: 'rest_hut',
        fatigue: 30,
        innerTrait: '无私',
        outerTrait: '义气',
      },
      currentLocationName: '歇脚棚',
      activeRequests: [remoteOffer],
      others: [],
      availableActions: ['rest', 'talk'],
    });
    const candidates = collectAutonomyCandidates(recoveredAwayFromHome, 1_000);
    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planner: 'quest',
          status: 'blocked',
          blockedReasonCode: 'quest_offer_issuer_not_nearby',
        }),
        expect.objectContaining({
          planner: 'routine',
          intentKind: 'travel',
          status: 'eligible',
          targetRef: 'location:mountain_gate',
        }),
      ]),
    );
    expect(selectPersonaPreferredProposal(recoveredAwayFromHome, 1_000)?.proposal).toMatchObject({
      type: 'travel',
      targetId: 'mountain_gate',
    });
  });

  test('accepted commitment outranks leisure and records a sourced exception for a reluctant persona', () => {
    const reluctant = context({
      self: {
        ...context().self,
        innerTrait: '利己',
        outerTrait: '任我',
        currentLocationId: 'herb_field',
      },
      availableActions: ['cultivate', 'explore'],
      activeRequests: [
        {
          requestId: 'request_bound',
          revision: 3,
          status: 'accepted',
          type: 'explore_location',
          locationId: 'rest_hut',
          summary: '查看歇脚棚',
        },
      ],
    });
    const selected = selectPersonaPreferredProposal(reluctant, 1_000);
    expect(selected?.proposal).toMatchObject({
      type: 'travel',
      targetId: 'rest_hut',
    });
    expect(selected?.exceptionReason).toBe('strong_commitment');
    expect(selected?.exceptionSourceIds).toEqual(['request:request_bound']);
    const trace = buildAutonomyDecisionTrace({
      context: reluctant,
      now: 1_000,
      selectedProposal: selected?.proposal,
      decisionSource: 'rule',
      exceptionReason: selected?.exceptionReason,
      exceptionSourceIds: selected?.exceptionSourceIds,
    });
    expect(trace.exceptionReason).toBe('strong_commitment');
    expect(trace.exceptionSourceIds).toEqual(['request:request_bound']);
  });

  test('help/social and cultivation choices differ without changing legal capabilities', () => {
    const shared = {
      availableActions: ['gift', 'cultivate', 'explore'] as AgentContext['availableActions'],
      others: [
        {
          actorId: 'friend',
          name: '故友',
          realm: 'qi_refining',
          relationship: 35,
          trust: 10,
        },
      ],
    };
    const loyal = context({
      ...shared,
      self: {
        ...context().self,
        innerTrait: '无私',
        outerTrait: '义气',
        currentLocationId: 'mountain_gate',
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
    });
    const solitary = context({
      ...shared,
      self: {
        ...context().self,
        innerTrait: '利己',
        outerTrait: '孤僻',
        currentLocationId: 'mountain_gate',
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
    });
    expect(selectPersonaPreferredProposal(loyal, 1_000)?.proposal.type).toBe('gift');
    expect(selectPersonaPreferredProposal(solitary, 1_000)?.proposal.type).toBe('cultivate');
  });

  test('social warmth chooses a needed conversation while a solitary profile keeps cultivating', () => {
    const shared = {
      availableActions: ['talk', 'cultivate'] as AgentContext['availableActions'],
      others: [
        {
          actorId: 'friend',
          name: '故友',
          realm: 'qi_refining',
          relationship: 35,
          trust: 10,
        },
      ],
    };
    const social = context({
      ...shared,
      self: {
        ...context().self,
        innerTrait: '仁善',
        outerTrait: '义气',
        currentLocationId: 'mountain_gate',
      },
    });
    const solitary = context({
      ...shared,
      self: {
        ...context().self,
        innerTrait: '中庸',
        outerTrait: '孤僻',
        currentLocationId: 'mountain_gate',
      },
    });
    expect(selectPersonaPreferredProposal(social, 1_000)?.proposal.type).toBe('talk');
    expect(selectPersonaPreferredProposal(solitary, 1_000)?.proposal.type).toBe('cultivate');
  });

  test('cultivation drive creates a bounded power versus romantic exploration difference', () => {
    const power = context({
      self: {
        ...context().self,
        innerTrait: '中庸',
        outerTrait: '权力',
        currentLocationId: 'mountain_gate',
      },
      availableActions: ['cultivate', 'explore'],
    });
    const romantic = context({
      self: {
        ...context().self,
        innerTrait: '中庸',
        outerTrait: '情种',
        currentLocationId: 'mountain_gate',
      },
      availableActions: ['cultivate', 'explore'],
    });
    expect(selectPersonaPreferredProposal(power, 1_000)?.proposal.type).toBe('cultivate');
    expect(selectPersonaPreferredProposal(romantic, 1_000)?.proposal.type).toBe('explore');
  });

  test('strongly contrary runtime choices fail closed without a source and retain a sourced relationship exception', () => {
    const benevolent = context({
      self: { ...context().self, innerTrait: '仁善', outerTrait: '孤僻' },
      availableActions: ['steal'],
    });
    const steal: AgentProposal = {
      type: 'steal',
      targetActorId: 'stranger',
      locationId: 'herb_field',
      params: { itemId: 'spirit_herb' },
      intent: '临时起意偷取',
      source: 'agent',
    };
    expect(() =>
      buildAutonomyDecisionTrace({
        context: benevolent,
        now: 1_000,
        selectedProposal: steal,
        decisionSource: 'llm',
      }),
    ).toThrow('persona_exception_source_missing');

    const sourced = context({
      ...benevolent,
      lifeObservation: {
        observationRevision: 'taixu.life-observation.v1:sourced',
      } as AgentContext['lifeObservation'],
      others: [
        {
          actorId: 'stranger',
          name: '仇敌',
          realm: 'qi_refining',
          relationship: -30,
          suspicion: 45,
        },
      ],
    });
    const trace = buildAutonomyDecisionTrace({
      context: sourced,
      now: 1_001,
      selectedProposal: steal,
      decisionSource: 'llm',
    });
    expect(trace.exceptionReason).toBe('important_relationship');
    expect(trace.exceptionSourceIds).toEqual(['relationship:stranger']);
  });

  test('free persona prose cannot change deterministic policy or selection', () => {
    const first = context({
      self: {
        ...context().self,
        innerTrait: '中庸',
        outerTrait: '权力',
        persona: '措辞甲',
      },
      availableActions: ['cultivate', 'explore'],
    });
    const second = context({
      ...first,
      lifeObservation: {
        observationRevision: 'taixu.life-observation.v1:prose-two',
      } as AgentContext['lifeObservation'],
      self: { ...first.self, persona: '完全不同的措辞乙' },
    });
    expect(selectPersonaPreferredProposal(first, 1_000)?.proposal.type).toBe(
      selectPersonaPreferredProposal(second, 1_000)?.proposal.type,
    );
    const firstTrace = buildAutonomyDecisionTrace({
      context: first,
      now: 1_000,
      selectedProposal: selectPersonaPreferredProposal(first, 1_000)?.proposal,
      decisionSource: 'rule',
    });
    const secondTrace = buildAutonomyDecisionTrace({
      context: second,
      now: 1_001,
      selectedProposal: selectPersonaPreferredProposal(second, 1_001)?.proposal,
      decisionSource: 'rule',
    });
    expect(firstTrace.personaPolicy.policyDigest).toBe(secondTrace.personaPolicy.policyDigest);
  });

  test('offers bounded pressure responses without forcing every actor to react', () => {
    const pressureContext = context({
      worldPressures: [
        {
          pressureId: 'pressure:herb_miasma:1',
          revision: 1,
          kind: 'herb_miasma',
          status: 'active',
          mapId: 'graybox',
          locationId: 'herb_field',
          affectedResourceNodeIds: ['herb_node'],
          severity: 60,
          effectCodes: ['resource_refresh_delayed'],
          endsAt: 10_000,
          endsAtGameHour: 12,
          sourceEventId: 'event:pressure_started',
        },
      ],
      self: {
        ...context().self,
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
        innerTrait: '仁善',
        outerTrait: '义气',
      },
      others: [
        {
          actorId: 'guard',
          name: '守谷弟子',
          role: 'valley_guard',
          realm: 'qi_refining',
          relationship: 5,
        },
      ],
      availableActions: ['cultivate', 'explore', 'gift', 'talk'],
    });
    const candidates = collectAutonomyCandidates(pressureContext, 1_000);
    const pressureCandidates = candidates.filter(
      (candidate) => candidate.planner === 'world_pressure',
    );
    expect(pressureCandidates.map((candidate) => candidate.intentKind).sort()).toEqual([
      'explore',
      'gift',
      'talk',
      'travel',
    ]);
    expect(
      pressureCandidates.every((candidate) =>
        candidate.memorySourceIds.includes('event:pressure_started'),
      ),
    ).toBe(true);
    expect(candidates.some((candidate) => candidate.planner === 'lifestyle')).toBe(true);
  });

  test('builds at most 12 Pi NPC options after excluding blocked and delegated entries', () => {
    const ctx = context({
      activeConversation: {
        conversationId: 'conversation:delegated',
        topicId: 'daily_life',
        otherActorId: 'friend',
        otherActorName: '故友',
        turnNumber: 0,
        maxTurns: 4,
        expiresAt: 10_000,
        recentTurns: [],
        visibleFacts: [],
        beliefs: [],
      },
      resourceNodes: Array.from({ length: 20 }, (_, index) => ({
        resourceNodeId: `node_${String(index).padStart(2, '0')}`,
        name: `资源点${index}`,
        itemId: `item_${index}`,
        stock: 1,
        available: 1,
      })),
    });
    const allCandidates = collectAutonomyCandidates(ctx, 1_000);
    expect(allCandidates.some((candidate) => candidate.status === 'blocked')).toBe(true);
    expect(allCandidates.some((candidate) => candidate.status === 'delegated')).toBe(true);

    const bundle = buildPiNpcEligibleCandidateBundle(ctx, 1_000);
    expect(bundle.options).toHaveLength(PI_NPC_ELIGIBLE_CANDIDATE_LIMIT);
    expect(bundle.candidates).toHaveLength(PI_NPC_ELIGIBLE_CANDIDATE_LIMIT);
    expect(bundle.options.every((option) => option.candidate.status === 'eligible')).toBe(true);
    expect(bundle.options.some((option) => option.candidate.status === 'delegated')).toBe(false);
  });

  test('keeps the Pi candidate digest stable and accepts a natural observation revision change', () => {
    const initial = context({
      resourceNodes: [
        {
          resourceNodeId: 'herb_node',
          name: '灵草圃',
          itemId: 'spirit_herb',
          stock: 2,
          available: 2,
        },
      ],
    });
    const initialBundle = buildPiNpcEligibleCandidateBundle(initial, 1_000);
    const selected = initialBundle.options.find((option) => option.proposal.type === 'gather');
    expect(selected).toBeDefined();
    const fresh: AgentContext = {
      ...initial,
      lifeObservation: {
        ...initial.lifeObservation!,
        observationRevision: 'taixu.life-observation.v2:natural-time-change',
      },
    };
    const freshBundle = buildPiNpcEligibleCandidateBundle(fresh, 2_000);
    expect(freshBundle.observationRevision).not.toBe(initialBundle.observationRevision);
    expect(freshBundle.candidateSetDigest).toBe(initialBundle.candidateSetDigest);
    expect(
      revalidatePiNpcEligibleCandidate({
        actorId: initial.self.actorId,
        candidateId: selected!.candidate.candidateId,
        proposalFingerprint: selected!.proposalFingerprint,
        freshContext: fresh,
        now: 2_000,
      }),
    ).toMatchObject({
      ok: true,
      validatedObservationRevision: fresh.lifeObservation?.observationRevision,
    });
  });

  test('strict Pi proposal fingerprints cover intent and params', () => {
    const base: AgentProposal = {
      type: 'gather',
      locationId: 'herb_field',
      params: { resourceNodeId: 'node_a' },
      intent: '采集甲处灵草',
      source: 'agent',
    };
    const fingerprint = piNpcProposalFingerprint('disciple_a', base);
    expect(
      piNpcProposalFingerprint('disciple_a', {
        ...base,
        intent: '采集乙处灵草',
      }),
    ).not.toBe(fingerprint);
    expect(
      piNpcProposalFingerprint('disciple_a', {
        ...base,
        params: { resourceNodeId: 'node_b' },
      }),
    ).not.toBe(fingerprint);
  });

  test('rejects an eligible candidate when its intent or request params change', () => {
    const initialGather = context({
      resourceNodes: [
        {
          resourceNodeId: 'stable_node',
          name: '旧名药圃',
          itemId: 'spirit_herb',
          stock: 1,
          available: 1,
        },
      ],
    });
    const gather = buildPiNpcEligibleCandidateBundle(initialGather, 1_000).options.find(
      (option) => option.proposal.type === 'gather',
    );
    expect(gather).toBeDefined();
    const renamedNode = context({
      ...initialGather,
      lifeObservation: {
        ...initialGather.lifeObservation!,
        observationRevision: 'revision:renamed-node',
      },
      resourceNodes: [
        {
          resourceNodeId: 'stable_node',
          name: '新名药圃',
          itemId: 'spirit_herb',
          stock: 1,
          available: 1,
        },
      ],
    });
    expect(
      revalidatePiNpcEligibleCandidate({
        actorId: initialGather.self.actorId,
        candidateId: gather!.candidate.candidateId,
        proposalFingerprint: gather!.proposalFingerprint,
        freshContext: renamedNode,
        now: 2_000,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'stale_or_invalid_candidate' });

    const offered = context({
      availableActions: ['accept_request', 'decline_request'],
      others: [
        {
          actorId: 'elder',
          name: '长老',
          realm: 'foundation_building',
          relationship: 10,
        },
      ],
      activeRequests: [
        {
          requestId: 'request:revision',
          revision: 1,
          status: 'offered',
          type: 'collect_item',
          issuerActorId: 'elder',
          summary: '采集一株灵草',
        },
      ],
    });
    const accepted = buildPiNpcEligibleCandidateBundle(offered, 1_000).options.find(
      (option) => option.proposal.type === 'accept_request',
    );
    expect(accepted).toBeDefined();
    const revised = context({
      ...offered,
      lifeObservation: {
        ...offered.lifeObservation!,
        observationRevision: 'revision:request-2',
      },
      activeRequests: [
        {
          ...offered.activeRequests![0],
          revision: 2,
        },
      ],
    });
    expect(
      revalidatePiNpcEligibleCandidate({
        actorId: offered.self.actorId,
        candidateId: accepted!.candidate.candidateId,
        proposalFingerprint: accepted!.proposalFingerprint,
        freshContext: revised,
        now: 2_000,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'stale_or_invalid_candidate' });
  });

  test('rejects unknown or removed Pi candidates', () => {
    const initial = context({
      resourceNodes: [
        {
          resourceNodeId: 'vanishing_node',
          name: '将空药圃',
          itemId: 'spirit_herb',
          stock: 1,
          available: 1,
        },
      ],
    });
    const selected = buildPiNpcEligibleCandidateBundle(initial, 1_000).options.find(
      (option) => option.proposal.type === 'gather',
    );
    expect(selected).toBeDefined();
    expect(
      revalidatePiNpcEligibleCandidate({
        actorId: initial.self.actorId,
        candidateId: 'unknown:candidate',
        proposalFingerprint: selected!.proposalFingerprint,
        freshContext: initial,
        now: 1_000,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'stale_or_invalid_candidate' });
    const depleted = context({
      ...initial,
      lifeObservation: {
        ...initial.lifeObservation!,
        observationRevision: 'revision:depleted',
      },
      resourceNodes: [
        {
          ...initial.resourceNodes![0],
          stock: 0,
          available: 0,
        },
      ],
    });
    expect(
      revalidatePiNpcEligibleCandidate({
        actorId: initial.self.actorId,
        candidateId: selected!.candidate.candidateId,
        proposalFingerprint: selected!.proposalFingerprint,
        freshContext: depleted,
        now: 2_000,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'stale_or_invalid_candidate' });
  });

  test('hard commitments preempt routine candidates and stale an older choice', () => {
    const ordinary = context({
      availableActions: ['gather', 'travel', 'cultivate'],
      resourceNodes: [
        {
          resourceNodeId: 'ordinary_node',
          name: '日常药圃',
          itemId: 'spirit_herb',
          stock: 2,
          available: 2,
        },
      ],
    });
    const ordinaryChoice = buildPiNpcEligibleCandidateBundle(ordinary, 1_000).options.find(
      (option) => option.proposal.type === 'gather',
    );
    expect(ordinaryChoice).toBeDefined();

    const obligated: AgentContext = {
      ...ordinary,
      lifeObservation: {
        ...ordinary.lifeObservation!,
        observationRevision: 'revision:hard-commitment',
      },
      activeRequests: [
        {
          requestId: 'request:accepted',
          revision: 1,
          status: 'accepted',
          type: 'explore_location',
          locationId: 'rest_hut',
          summary: '已答应查看歇脚棚',
        },
      ],
    };
    const bundle = buildPiNpcEligibleCandidateBundle(obligated, 2_000);
    expect(bundle.options.length).toBeGreaterThan(0);
    expect(bundle.options.every((option) => option.candidate.commitmentUrgency >= 90)).toBe(true);
    expect(
      revalidatePiNpcEligibleCandidate({
        actorId: ordinary.self.actorId,
        candidateId: ordinaryChoice!.candidate.candidateId,
        proposalFingerprint: ordinaryChoice!.proposalFingerprint,
        freshContext: obligated,
        now: 2_000,
      }),
    ).toMatchObject({
      ok: false,
      reasonCode: 'stale_or_invalid_candidate',
    });
  });

  test('fails closed when one Pi candidate id maps to different proposal semantics', () => {
    expect(() =>
      assertPiNpcCandidateFingerprintsUnique([
        { candidateId: 'same', proposalFingerprint: 'fingerprint:a' },
        { candidateId: 'same', proposalFingerprint: 'fingerprint:b' },
      ]),
    ).toThrow('pi_npc_candidate_id_collision');
    expect(() =>
      assertPiNpcCandidateFingerprintsUnique([
        { candidateId: 'same', proposalFingerprint: 'fingerprint:a' },
        { candidateId: 'same', proposalFingerprint: 'fingerprint:a' },
      ]),
    ).not.toThrow();
  });

  test('C021g2 distinguishes SelfCore, projection, lane and reason-factor drift', () => {
    const stableSelf = createTaixuSelfCore({
      actorId: 'disciple_a', revision: 1, authoredFrom: ['fixture:c021g2'],
      identity: { name: '清河', role: '外门弟子', selfSummary: '谨慎守诺。' },
      values: {
        weights: {
          survival: 90, commitments: 80, compassion: 40, autonomy: 20,
          cultivation: 60, relationships: 45, reputation: 30, resourceStewardship: 70,
        },
        bottomLines: ['不虚构世界事实'],
      },
      expression: {
        register: 'reserved', brevity: 80,
        forbiddenClaims: ['已修改世界事实'], allowedPhraseTags: ['简短'],
      },
      status: 'active', innerTrait: '中庸', outerTrait: '忠贞',
    });
    const initial = context({
      decisionPriorityProjectionV1: true,
      stableSelfCore: stableSelf,
      resourceNodes: [{
        resourceNodeId: 'g2_node', name: '灵草圃', itemId: 'spirit_herb', stock: 2, available: 2,
      }],
    });
    const bundle = buildPiNpcEligibleCandidateBundle(initial, 1_000);
    const selected = bundle.options[0];
    expect(selected.priorityProjectionDigest).toBeDefined();
    const base = {
      actorId: initial.self.actorId,
      candidateId: selected.candidate.candidateId,
      proposalFingerprint: selected.proposalFingerprint,
      priorityProjectionDigest: selected.priorityProjectionDigest,
      expectedCandidateSetDigest: piNpcCanonicalCandidateSetDigest(bundle.options),
      selfBinding: taixuSelfDecisionBinding(stableSelf, initial.self.actorId),
      freshContext: initial,
      now: 1_000,
    };
    expect(revalidatePiNpcEligibleCandidate({
      ...base,
      reasonFactorIds: ['not_in_context'],
    })).toMatchObject({ ok: false, reasonCode: 'reason_factor_not_in_context' });

    const newerSelf = createTaixuSelfCore({
      actorId: stableSelf.actorId, revision: 2, supersedesRevision: 1,
      authoredFrom: ['fixture:c021g2:revision2'], identity: stableSelf.identity,
      values: stableSelf.values, expression: stableSelf.expression, status: 'active',
      innerTrait: '中庸', outerTrait: '忠贞',
    });
    expect(revalidatePiNpcEligibleCandidate({
      ...base,
      freshContext: { ...initial, stableSelfCore: newerSelf },
    })).toMatchObject({ ok: false, reasonCode: 'self_core_stale' });

    const revisionChanged: AgentContext = {
      ...initial,
      lifeObservation: {
        ...initial.lifeObservation!,
        observationRevision: 'taixu.life-observation.v2:g2-projection-change',
      },
    };
    expect(revalidatePiNpcEligibleCandidate({
      ...base,
      freshContext: revisionChanged,
    })).toMatchObject({ ok: false, reasonCode: 'candidate_projection_stale' });

    const higherLane: AgentContext = {
      ...initial,
      self: { ...initial.self, fatigue: 90 },
    };
    expect(revalidatePiNpcEligibleCandidate({
      ...base,
      expectedCandidateSetDigest: undefined,
      priorityProjectionDigest: undefined,
      freshContext: higherLane,
    })).toMatchObject({ ok: false, reasonCode: 'priority_lane_changed' });
  });

  test('C021g3 keeps a firm intention across pure time and only permits its declared interruptions', () => {
    const base = context({
      decisionPriorityProjectionV1: true,
      purposeBoundLifeIntentV2: true,
      stableLifeSemanticTravelV1: false,
      availableActions: [
        'cultivate', 'gather', 'rest', 'trade', 'talk', 'use_item',
        'explore', 'travel', 'turn_in_request',
      ],
      purposeResourceNodes: [{
        resourceNodeId: 'firm_dew', name: '朝露草', locationId: 'herb_field',
        itemId: 'spirit_herb', available: 2, sourceRevision: 'resource:firm:1',
      }],
      knownLocations: [
        ...(context().knownLocations ?? []),
        { locationId: 'request_site', name: '委托地', allowedActions: ['explore'] },
      ],
      activeRequests: [{
        requestId: 'firm_request', revision: 1, status: 'accepted',
        type: 'explore_location', locationId: 'request_site', summary: '前往委托地查看。',
      }],
    });
    const initialPurpose = buildPurposeBoundLifeCandidateBundle(base);
    expect(initialPurpose.candidates.some((candidate) =>
      candidate.intent.purposeKind === 'obligation')).toBe(true);
    const livelihood = initialPurpose.candidates.find(
      (candidate) => candidate.intent.sourceRef === 'resource:firm_dew',
    );
    expect(livelihood).toBeDefined();
    if (!livelihood) return;
    const selected = livelihood.personalGoalCandidate;
    base.personalGoal = {
      contractVersion: 'taixu.personal-goal.v1',
      goalId: 'goal:firm', actorId: base.self.actorId, revision: 1, status: 'active',
      goalKey: selected.goalKey, kind: selected.kind, sourceRef: selected.sourceRef,
      targetRef: selected.targetRef, candidateId: selected.candidateId, intent: selected.intent,
      progressScore: selected.progressScore, progressKey: selected.progressKey, progressRevision: 1,
      backlog: [], observationRevision: base.lifeObservation!.observationRevision,
      startedGameHour: 1, lastProgressGameHour: 1, deadlineGameHour: 24,
      hardDeadlineGameHour: 72, attemptCount: 0,
      purposeIntent: selected.purposeIntent,
      purposeIntentDigest: selected.purposeIntentDigest,
      purposeCadenceKey: selected.purposeCadenceKey,
      purposeStage: 'travel_pending',
    };
    // Keep the same authoritative candidate snapshot so the policy boundary,
    // rather than the purpose planner's own continuity shortcut, is exercised.
    base.purposeBoundLifeCandidateBundle = initialPurpose;
    const first = buildPiNpcEligibleCandidateBundle(base, 1_000);
    const later = buildPiNpcEligibleCandidateBundle(
      { ...base, currentGameHour: (base.currentGameHour ?? 0) + 1 },
      2_000,
    );
    expect(first.options.length).toBeGreaterThan(0);
    expect(first.options.every((option) =>
      option.priorityProjection?.whyNowCode === 'continue_active_personal_goal')).toBe(true);
    expect(later.options.map((option) => option.candidate.candidateId))
      .toEqual(first.options.map((option) => option.candidate.candidateId));

    const interruptible = {
      ...base,
      personalGoal: {
        ...base.personalGoal,
        purposeIntent: {
          ...base.personalGoal.purposeIntent!,
          interruptionPolicy: 'hard_obligation_or_invalidated' as const,
        },
      },
    };
    const interrupted = buildPiNpcEligibleCandidateBundle(interruptible, 2_000);
    expect(interrupted.options.length).toBeGreaterThan(0);
    expect([...new Set(interrupted.options.map((option) =>
      option.priorityProjection?.priorityLane))]).toEqual(['L2_hard_obligation']);
  });

  test('C021g3 rejects server-confirmed bottom-line conflicts without opening a lower lane', () => {
    const bottomLine = '不越过生存与世界硬规则';
    const stableSelf = createTaixuSelfCore({
      actorId: 'disciple_a', revision: 1, authoredFrom: ['fixture:c021g3:bottom-line'],
      identity: { name: '清河', role: '外门弟子', selfSummary: '守住底线。' },
      values: {
        weights: {
          survival: 100, commitments: 70, compassion: 50, autonomy: 40,
          cultivation: 60, relationships: 50, reputation: 50, resourceStewardship: 70,
        },
        bottomLines: [bottomLine],
      },
      expression: {
        register: 'reserved', brevity: 80,
        forbiddenClaims: ['已修改世界事实'], allowedPhraseTags: ['简短'],
      },
      status: 'active', innerTrait: '中庸', outerTrait: '忠贞',
    });
    const base = context({
      decisionPriorityProjectionV1: true,
      stableSelfCore: stableSelf,
      purposeBoundLifeIntentV2: true,
      stableLifeSemanticTravelV1: false,
      purposeResourceNodes: [{
        resourceNodeId: 'conflict_dew', name: '禁行草', locationId: 'herb_field',
        itemId: 'spirit_herb', available: 2, sourceRevision: 'resource:conflict:1',
      }],
    });
    const purpose = buildPurposeBoundLifeCandidateBundle(base);
    base.purposeBoundLifeCandidateBundle = {
      ...purpose,
      candidates: purpose.candidates.map((candidate) => ({
        ...candidate,
        proposal: {
          ...candidate.proposal,
          params: {
            ...candidate.proposal.params,
            serverBottomLineConflictCodes: [bottomLine],
          },
        },
      })),
    };
    expect(buildPiNpcEligibleCandidateBundle(base, 1_000).options).toEqual([]);
  });
});

describe('contended gather outlook', () => {
  function herbContext(
    expectedAvailableOnArrival: number,
    overrides: Partial<AgentContext> = {},
  ): AgentContext {
    const purposeV2 = context({
      stableLifeSemanticTravelV1: false,
      purposeBoundLifeIntentV2: true,
      currentGameHour: 10,
      availableActions: ['gather', 'cultivate'],
      knownLocations: [
        { locationId: 'herb_field', name: '药田', allowedActions: ['gather', 'cultivate'] },
      ],
      purposeResourceNodes: [
        {
          resourceNodeId: 'dew_patch',
          name: '朝露草丛',
          locationId: 'herb_field',
          itemId: 'spirit_herb',
          available: 1,
          sourceRevision: 'resource:dew:1',
          outlook: {
            inTransitActorCount: 1 - Math.min(1, expectedAvailableOnArrival),
            heldForRequestCount: 0,
            etaGameHours: 0,
            expectedAvailableOnArrival,
          },
        },
      ],
      purposeShopOffers: [],
      ...overrides,
    });
    purposeV2.purposeBoundLifeCandidateBundle = buildPurposeBoundLifeCandidateBundle(purposeV2);
    return purposeV2;
  }

  test('rules pass over a trip projected to find nothing left', () => {
    const contended = herbContext(0);
    expect(selectPersonaPreferredProposal(contended, 1_000)?.proposal.type).toBe('cultivate');

    const gather = buildPiNpcEligibleCandidateBundle(contended, 1_000).options.find(
      (option) => option.proposal.type === 'gather',
    );
    // The model still sees the trip, with the reason it ranks last.
    expect(gather?.providerView).toMatchObject({
      needScore: 5,
      commitmentUrgency: 0,
      resourceOutlook: { inTransitActorCount: 1, expectedAvailableOnArrival: 0 },
    });
    expect(gather?.proposal.intent).toContain('另有1人已动身，预计到达时剩0份');
  });

  test('keeps ordinary gather scores when something is left on arrival', () => {
    const open = herbContext(1);
    const gather = buildPiNpcEligibleCandidateBundle(open, 1_000).options.find(
      (option) => option.proposal.type === 'gather',
    );
    expect(gather?.providerView.needScore).toBe(45);
    const onlyGather = herbContext(1, {
      availableActions: ['gather'],
      knownLocations: [{ locationId: 'herb_field', name: '药田', allowedActions: ['gather'] }],
    });
    expect(selectPersonaPreferredProposal(onlyGather, 1_000)?.proposal.type).toBe('gather');
  });

  test('waits rather than start a contended trip when it is the only option', () => {
    const onlyGather = herbContext(0, {
      availableActions: ['gather'],
      knownLocations: [{ locationId: 'herb_field', name: '药田', allowedActions: ['gather'] }],
    });
    expect(
      buildPiNpcEligibleCandidateBundle(onlyGather, 1_000).options.map((option) => option.proposal.type),
    ).toEqual(['gather']);
    expect(selectPersonaPreferredProposal(onlyGather, 1_000)).toBeNull();
  });
});
