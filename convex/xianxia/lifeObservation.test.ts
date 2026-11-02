import type { AgentContext } from './agentLogic';
import {
  LIFE_OBSERVATION_LIMITS,
  LifeObservationContractError,
  buildLifeObservation,
  stableObservationDigest,
  type LifeObservationSource,
} from './lifeObservation';

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    self: {
      actorId: 'observer',
      name: '观察者旧名',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 2,
      cultivationXp: 20,
      mood: 1,
      health: 10,
      maxHealth: 10,
      fatigue: 5,
      spirit: 8,
      reputation: 0,
      currentLocationId: 'semantic_courtyard',
      inventory: [{ itemId: 'spirit_herb', qty: 2 }],
      persona: '沉稳守信',
    },
    currentLocationName: '灰盒庭院',
    currentLocationSpiritualEnergy: 2,
    others: [
      {
        actorId: 'nearby_friend',
        name: '近邻甲',
        realm: 'qi_refining',
        relationship: 12,
        trust: 4,
        suspicion: 0,
        debt: 0,
        fear: 0,
      },
    ],
    recentEvents: [],
    availableActions: ['talk', 'decline_request'],
    activeRequests: [
      {
        requestId: 'request_remote',
        revision: 3,
        status: 'offered',
        type: 'collect_item',
        issuerActorId: 'remote_issuer',
        issuerLocationId: 'remote_hall',
        summary: '远方委托',
      },
      {
        requestId: 'request_nearby',
        revision: 2,
        status: 'offered',
        type: 'collect_item',
        issuerActorId: 'nearby_friend',
        summary: '当面委托',
      },
    ],
    activeConversation: {
      conversationId: 'conversation_1',
      topicId: 'topic_1',
      otherActorId: 'nearby_friend',
      otherActorName: '近邻甲',
      turnNumber: 1,
      maxTurns: 6,
      expiresAt: 999_999,
      recentTurns: [],
      visibleFacts: [],
      beliefs: [],
    },
    activeGroupConversation: {
      groupConversationId: 'group_1',
      role: 'participant',
      topicId: 'group_topic',
      participantActorIds: ['observer', 'group_remote'],
      observerActorIds: ['group_observer'],
      turnNumber: 0,
      maxTurns: 8,
      expiresAt: 999_999,
      expired: false,
      recentTurns: [],
      beliefs: [],
    },
    activeNegotiation: {
      negotiationId: 'negotiation_1',
      proposalId: 'proposal_1',
      revision: 4,
      proposerActorId: 'observer',
      recipientActorId: 'negotiation_target',
      terms: {
        kind: 'herb_trade',
        sellerActorId: 'observer',
        buyerActorId: 'negotiation_target',
        itemId: 'spirit_herb',
        itemQty: 1,
        paymentItemId: 'spirit_stone',
        paymentQty: 2,
      },
      priorOffers: [],
    },
    combat: { opponentActorId: 'combat_target', opponentHealth: 7, lootTargets: [] },
    phase: 'day',
    ...overrides,
  };
}

function source(overrides: Partial<LifeObservationSource> = {}): LifeObservationSource {
  return {
    context: context(),
    semanticTime: { gameHour: 120, gameDay: 5, phase: 'day' },
    mapId: 'graybox_map',
    currentTile: { x: 10, y: 20 },
    memories: [
      {
        memoryId: 'memory_direct',
        actorId: 'observer',
        sourceEventId: 'event_direct',
        type: 'conversation_completed',
        summary: '我亲历了一次交谈。',
        source: 'direct',
        salience: 3,
        createdAt: 100,
        expiresAt: 300,
        lifecycle: 'active',
      },
      {
        memoryId: 'memory_rumor',
        actorId: 'observer',
        sourceEventId: 'event_rumor',
        type: 'rumor_heard',
        summary: '我听到一个传闻。',
        source: 'rumor',
        distorted: true,
        salience: 2,
        createdAt: 99,
        expiresAt: 300,
        lifecycle: 'active',
      },
      {
        memoryId: 'memory_archived',
        actorId: 'observer',
        sourceEventId: 'event_archived',
        type: 'old_event',
        summary: '已经压缩的往事。',
        source: 'direct',
        salience: 1,
        createdAt: 1,
        expiresAt: 999,
        lifecycle: 'archived',
      },
    ],
    summaries: [
      {
        summaryId: 'summary_1',
        actorId: 'observer',
        subjectActorId: 'nearby_friend',
        summary: '对近邻的长期印象。',
        revision: 2,
        updatedAt: 100,
      },
    ],
    beliefs: [
      {
        beliefId: 'belief_1',
        actorId: 'observer',
        kind: 'rumor',
        sourceActorId: 'nearby_friend',
        sourceClaimId: 'claim_1',
        subjectActorIds: ['combat_target'],
        summary: '听说战斗目标藏有草药。',
        confidence: 0.4,
        active: true,
        revision: 2,
        validity: 'active',
        truthStatus: 'unknown',
        updatedAt: 100,
      },
    ],
    relationships: [
      { actorId: 'nearby_friend', affinity: 12, trust: 4, suspicion: 0, debt: 0, fear: 0 },
      { actorId: 'remote_issuer', affinity: 2, trust: 1, suspicion: 0, debt: 0, fear: 0 },
      { actorId: 'unrelated_private_actor', affinity: -2, trust: 0, suspicion: 3, debt: 0, fear: 0 },
    ],
    activeExecution: {
      executionId: 'execution_1',
      revision: 2,
      actionType: 'gift',
      status: 'acting',
      targetActorId: 'execution_target',
      expiresAt: 999_999,
    },
    activeMovement: {
      commandId: 'movement_1',
      revision: 5,
      status: 'moving',
      requestedTarget: { kind: 'actor', actorId: 'movement_target' },
      intent: '去找一名角色',
      expiresAt: 999_999,
      acceptedTile: { x: 30, y: 40 },
    },
    ...overrides,
  };
}

describe('C016e4 bounded life observation', () => {
  it('canonicalizes object keys and source ordering into a stable revision', () => {
    expect(stableObservationDigest({ b: 2, a: 1 })).toBe(stableObservationDigest({ a: 1, b: 2 }));
    expect(stableObservationDigest({ a: 1, b: 2 })).toMatch(/^stable64:[0-9a-f]{16}$/);
    const first = buildLifeObservation(source());
    const reordered = source();
    reordered.context.others.reverse();
    reordered.relationships.reverse();
    reordered.memories.reverse();
    const second = buildLifeObservation(reordered);
    expect(second).toEqual(first);
    expect(first.observationRevision).toBe(`${first.contractVersion}:${first.observationDigest}`);
  });

  it('keeps active participant, issuer and target refs independent from nearby pagination', () => {
    const observation = buildLifeObservation(source());
    const targetIds = observation.targetRefs.map((target) => target.actorId);
    expect(targetIds).toEqual(expect.arrayContaining([
      'remote_issuer',
      'nearby_friend',
      'group_remote',
      'group_observer',
      'negotiation_target',
      'combat_target',
      'execution_target',
      'movement_target',
    ]));
    expect(observation.targetRefs.find((target) => target.actorId === 'remote_issuer')?.nearby).toBe(false);
    expect(observation.targetRefs.find((target) => target.actorId === 'nearby_friend')?.nearby).toBe(true);
    expect(observation.capabilities).toEqual([]);
  });

  it('binds nearby request capabilities but does not make a remote target locally legal', () => {
    const input = source({ activeExecution: undefined });
    const observation = buildLifeObservation(input);
    expect(observation.capabilities).toContainEqual(expect.objectContaining({
      actionType: 'decline_request',
      requestId: 'request_nearby',
      requestRevision: 2,
      targetActorId: 'nearby_friend',
    }));
    expect(observation.capabilities).not.toContainEqual(expect.objectContaining({
      requestId: 'request_remote',
    }));
  });

  it('keeps archived summaries out of facts and preserves rumor epistemic labels', () => {
    const observation = buildLifeObservation(source());
    expect(observation.memories.map((memory) => memory.memoryId)).toEqual([
      'memory_direct',
      'memory_rumor',
    ]);
    expect(observation.factEventIds).toEqual(['event_direct']);
    expect(observation.factEventIds).not.toContain('event_archived');
    expect(observation.factEventIds).not.toContain('event_rumor');
    expect(observation.backgroundSummaries).toEqual([
      expect.objectContaining({ summaryId: 'summary_1', epistemicKind: 'non_fact_summary' }),
    ]);
    expect(JSON.stringify(observation.backgroundSummaries)).not.toContain('event_archived');
    expect(observation.beliefs[0]).toEqual(expect.objectContaining({
      beliefId: 'belief_1',
      kind: 'rumor',
      validity: 'active',
      truthStatus: 'unknown',
      revision: 2,
    }));
  });

  it('rejects another actor private source instead of leaking it', () => {
    const input = source();
    input.memories.push({
      ...input.memories[0],
      memoryId: 'other_secret_memory',
      actorId: 'other_actor',
      summary: '不属于观察者的秘密。',
    });
    expect(() => buildLifeObservation(input)).toThrow(LifeObservationContractError);
    try {
      buildLifeObservation(input);
    } catch (error) {
      expect((error as LifeObservationContractError).code).toBe('observation_invalid_source_owner');
    }
  });

  it('bounds ordinary collections but fails closed instead of truncating exact active targets', () => {
    const manyItems = Array.from({ length: LIFE_OBSERVATION_LIMITS.inventory + 5 }, (_, index) => ({
      itemId: `item_${String(index).padStart(2, '0')}`,
      qty: 1,
    }));
    const bounded = source({
      context: context({ self: { ...context().self, inventory: manyItems } }),
    });
    const observation = buildLifeObservation(bounded);
    expect(observation.self.inventory).toHaveLength(LIFE_OBSERVATION_LIMITS.inventory);
    expect(observation.bounds.inventory).toEqual(expect.objectContaining({
      total: manyItems.length,
      truncated: true,
    }));

    const overflowContext = context({
      activeGroupConversation: {
        groupConversationId: 'overflow_group',
        role: 'participant',
        topicId: 'overflow',
        participantActorIds: ['observer', ...Array.from(
          { length: LIFE_OBSERVATION_LIMITS.targetRefs + 1 },
          (_, index) => `participant_${index}`,
        )],
        observerActorIds: [],
        turnNumber: 0,
        maxTurns: 100,
        expiresAt: 999_999,
        expired: false,
        recentTurns: [],
        beliefs: [],
      },
      activeRequests: [],
      activeConversation: undefined,
      activeNegotiation: undefined,
      combat: { lootTargets: [] },
    });
    expect(() => buildLifeObservation(source({
      context: overflowContext,
      activeExecution: undefined,
      activeMovement: undefined,
    }))).toThrow(expect.objectContaining({ code: 'observation_active_target_overflow' }));
  });

  it('keeps semantic digest stable when only map, tile and display names are replaced', () => {
    const graybox = buildLifeObservation(source());
    const formalInput = source({ mapId: 'formal_xianxia_map', currentTile: { x: 210, y: 75 } });
    formalInput.context.self.name = '正式角色名';
    formalInput.context.currentLocationName = '正式美术庭院';
    formalInput.context.others = formalInput.context.others.map((actor) => ({ ...actor, name: '正式近邻名' }));
    if (formalInput.activeMovement) formalInput.activeMovement.acceptedTile = { x: 400, y: 300 };
    const formal = buildLifeObservation(formalInput);
    expect(formal.semanticDigest).toBe(graybox.semanticDigest);
    expect(formal.observationDigest).not.toBe(graybox.observationDigest);
  });

  it('changes the semantic revision when structured persona traits change', () => {
    const firstInput = source();
    firstInput.context.self.innerTrait = '仁善';
    firstInput.context.self.outerTrait = '义气';
    const secondInput = source();
    secondInput.context.self.innerTrait = '狂邪';
    secondInput.context.self.outerTrait = '睚眦';
    const first = buildLifeObservation(firstInput);
    const second = buildLifeObservation(secondInput);
    expect(first.self.identity).toEqual(expect.objectContaining({
      innerTrait: '仁善',
      outerTrait: '义气',
    }));
    expect(second.self.identity).toEqual(expect.objectContaining({
      innerTrait: '狂邪',
      outerTrait: '睚眦',
    }));
    expect(second.semanticDigest).not.toBe(first.semanticDigest);
    expect(second.observationRevision).not.toBe(first.observationRevision);
  });

  it('projects only the observing actor personal goal as a compact obligation', () => {
    const input = source({
      context: context({
        personalGoal: {
          contractVersion: 'taixu.personal-goal.v1',
          goalId: 'personal_goal:observer:4',
          actorId: 'observer',
          revision: 4,
          status: 'active',
          goalKey: 'relationship:actor:remote_issuer',
          kind: 'relationship',
          sourceRef: 'actor:remote_issuer',
          targetRef: 'actor:remote_issuer',
          candidateId: 'candidate:talk',
          intent: '履行已有关系维护目标',
          progressScore: 1,
          progressKey: 'relationship:remote_issuer:1',
          progressRevision: 2,
          backlog: [],
          observationRevision: 'previous',
          startedGameHour: 100,
          lastProgressGameHour: 110,
          deadlineGameHour: 134,
          hardDeadlineGameHour: 172,
          attemptCount: 1,
        },
      }),
    });
    const observation = buildLifeObservation(input);
    expect(observation.obligations).toContainEqual({
      kind: 'personal_goal',
      obligationId: 'personal_goal:observer:4',
      status: 'active',
      revision: 4,
      counterpartyActorIds: ['remote_issuer'],
    });
    expect(observation.self.duties).toContainEqual({
      kind: 'goal',
      dutyId: 'personal_goal:observer:4',
      status: 'relationship',
    });
    expect(
      observation.targetRefs.find((target) => target.actorId === 'remote_issuer')?.reasons,
    ).toEqual(expect.arrayContaining([
      'active_personal_goal_source',
      'active_personal_goal_target',
    ]));
    expect(JSON.stringify(observation)).not.toContain('another_actor_personal_goal');
  });

  it('projects a C021b0d coordination receipt as a bounded social obligation', () => {
    const group = {
      receipt: {
        contractVersion: 'taixu.group-social-initiation.v1',
        initiationId: 'group_social_initiation:1', revision: 2, hostActorId: 'host',
        sourceKind: 'shared_request', sourceRef: 'request:1', sourceRevision: 'request:rev:1',
        warrantId: 'warrant:1', warrantDigest: 'stable64:warrant', candidateId: 'candidate:1',
        candidateDigest: 'stable64:candidate', topicRefs: ['request:1'], audience: 'participants',
        meetingMapId: 'graybox_map', meetingLocationId: 'semantic_courtyard',
        participantActorIds: ['host', 'observer', 'expert'],
        participantRoles: [
          { actorId: 'expert', role: 'expert' },
          { actorId: 'host', role: 'decision_owner' },
          { actorId: 'observer', role: 'affected_party' },
        ],
        observerActorIds: [], status: 'pending', createdAt: 100, expiresAt: 500,
      },
      members: [], canRespond: true, canStart: false,
    } as NonNullable<AgentContext['groupSocialCoordination']>[number];
    const observation = buildLifeObservation(source({
      context: context({ activeGroupConversation: undefined, groupSocialCoordination: [group] }),
    }));
    expect(observation.obligations).toContainEqual({
      kind: 'group_initiation',
      obligationId: 'group_social_initiation:1',
      status: 'pending',
      revision: 2,
      counterpartyActorIds: ['expert', 'host'],
      expiresAt: 500,
    });
  });

  it('projects at most four active same-map pressures and treats source events as facts', () => {
    const worldPressures = Array.from({ length: 7 }, (_, index) => ({
      pressureId: `pressure:${index}`,
      revision: 1,
      kind: 'herb_miasma' as const,
      status: 'active' as const,
      mapId: 'graybox_map',
      locationId: `slope_${index}`,
      affectedResourceNodeIds: [`node_${index}`],
      severity: 60 + index,
      effectCodes: ['resource_refresh_delayed' as const],
      endsAt: 999_999,
      endsAtGameHour: 200 + index,
      sourceEventId: `event_pressure_${index}`,
    }));
    const observation = buildLifeObservation(source({
      context: context({ worldPressures }),
    }));
    expect(observation.contractVersion).toBe('taixu.life_observation.v2');
    expect(observation.worldPressures).toHaveLength(4);
    expect(observation.bounds.worldPressures).toEqual({
      limit: 4,
      included: 4,
      total: 7,
      truncated: true,
    });
    for (const pressure of observation.worldPressures) {
      expect(observation.factEventIds).toContain(pressure.sourceEventId);
    }
  });
});
