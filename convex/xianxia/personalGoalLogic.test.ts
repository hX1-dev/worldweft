import type { AutonomyCandidateV3 } from './autonomyDecisionContracts';
import {
  buildPersonalGoalPlanForProposal,
  selectPersonaPreferredProposal,
} from './autonomyDecisionTraceLogic';
import type { AgentContext, AgentProposal } from './agentLogic';
import {
  boundedPersonalGoalBacklog,
  personalGoalCandidateForProposal,
} from './personalGoalLogic';

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  const base: AgentContext = {
    lifeObservation: {
      observationRevision: 'taixu.life_observation.v1:goal-fixture',
    } as AgentContext['lifeObservation'],
    self: {
      actorId: 'disciple_goal',
      name: '守一',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 2,
      cultivationXp: 10,
      mood: 1,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 4,
      reputation: 0,
      currentLocationId: 'market',
      inventory: [],
      innerTrait: '中庸',
      outerTrait: '忠贞',
    },
    currentLocationName: '坊市',
    others: [],
    recentEvents: [],
    availableActions: ['cultivate', 'explore', 'gather', 'rest', 'use_item'],
    knownLocations: [
      { locationId: 'market', name: '坊市', allowedActions: ['explore'] },
      { locationId: 'herb_field', name: '药田', allowedActions: ['gather'] },
    ],
    resourceNodes: [],
    activeRequests: [],
  };
  return {
    ...base,
    ...overrides,
    self: { ...base.self, ...(overrides.self ?? {}) },
  };
}

function candidate(
  candidateId: string,
  planner: string,
  intentKind: string,
  targetRef?: string,
): AutonomyCandidateV3 {
  return {
    candidateId,
    planner,
    intentKind,
    targetRef,
    status: 'eligible',
    legacyOrder: 1,
    survivalUrgency: 0,
    survivalReasonCodes: [],
    needScore: 0,
    personaFit: 0,
    personaReasonCodes: [],
    commitmentUrgency: 0,
    relationshipReasons: [],
    memorySourceIds: [],
  };
}

describe('C017d bounded personal goal logic', () => {
  test('derives only the six server-observed goal families', () => {
    const ctx = context();
    const cases: Array<[AgentProposal, string, string]> = [
      [
        { type: 'rest', intent: '休息', source: 'agent', locationId: 'market' },
        'recovery',
        'body:disciple_goal',
      ],
      [
        {
          type: 'gather',
          intent: '采药',
          source: 'agent',
          params: { resourceNodeId: 'herb_1' },
        },
        'livelihood',
        'resource:herb_1',
      ],
      [
        {
          type: 'travel',
          targetId: 'herb_field',
          intent: '履行委托',
          source: 'agent',
          params: { requestId: 'request_1', expectedRevision: 2 },
        },
        'commitment',
        'request:request_1',
      ],
      [
        {
          type: 'gift',
          targetActorId: 'friend',
          intent: '维系关系',
          source: 'agent',
        },
        'relationship',
        'actor:friend',
      ],
      [
        { type: 'cultivate', intent: '修行', source: 'agent', locationId: 'market' },
        'cultivation',
        'cultivation:disciple_goal',
      ],
      [
        { type: 'flee', intent: '脱离威胁', source: 'agent', locationId: 'market' },
        'avoid_threat',
        'encounter:encounter_1',
      ],
    ];
    for (const [proposal, kind, sourceRef] of cases) {
      const withCombat =
        proposal.type === 'flee'
          ? context({
              combat: {
                activeEncounterId: 'encounter_1',
                opponentActorId: 'enemy',
                lootTargets: [],
              },
            })
          : ctx;
      const goal = personalGoalCandidateForProposal(withCombat, {
        candidate: candidate(`candidate:${proposal.type}`, 'runtime', proposal.type),
        proposal,
      });
      expect(goal).toMatchObject({ kind, sourceRef });
    }
    expect(
      personalGoalCandidateForProposal(ctx, {
        candidate: candidate('candidate:attack', 'lifestyle', 'attack'),
        proposal: {
          type: 'attack',
          targetActorId: 'enemy',
          intent: '一次性冲突',
          source: 'agent',
        },
      }),
    ).toBeNull();
  });

  test('keeps a request goal stable while the legal next action changes', () => {
    const request = {
      requestId: 'request_1',
      revision: 1,
      status: 'accepted' as const,
      type: 'explore_location',
      locationId: 'herb_field',
      summary: '查验药田',
    };
    const travelling = context({ activeRequests: [request] });
    const first = selectPersonaPreferredProposal(travelling, 1_000);
    expect(first?.proposal).toMatchObject({
      type: 'travel',
      targetId: 'herb_field',
      params: { requestId: 'request_1' },
    });
    expect(first?.personalGoalPlan.selected).toMatchObject({
      kind: 'commitment',
      goalKey: 'commitment:request:request_1',
    });

    const atDestination = context({
      self: { ...context().self, currentLocationId: 'herb_field' },
      availableActions: ['explore', 'gather'],
      activeRequests: [request],
      personalGoal: {
        contractVersion: 'taixu.personal-goal.v1',
        goalId: 'personal_goal:disciple_goal:1',
        actorId: 'disciple_goal',
        revision: 1,
        status: 'active',
        goalKey: 'commitment:request:request_1',
        kind: 'commitment',
        sourceRef: 'request:request_1',
        candidateId: first!.candidateId,
        intent: first!.proposal.intent,
        progressScore: 100,
        progressKey: 'request:accepted:0:0:market',
        progressRevision: 0,
        backlog: [],
        observationRevision: 'old',
        startedGameHour: 0,
        lastProgressGameHour: 0,
        deadlineGameHour: 24,
        hardDeadlineGameHour: 72,
        attemptCount: 1,
      },
    });
    const next = selectPersonaPreferredProposal(atDestination, 2_000);
    expect(next?.proposal).toMatchObject({
      type: 'explore',
      params: { requestId: 'request_1' },
    });
    expect(next?.personalGoalPlan.selected?.goalKey).toBe(
      'commitment:request:request_1',
    );
  });

  test('survival can preempt a persisted livelihood goal', () => {
    const ctx = context({
      self: {
        ...context().self,
        health: 3,
        fatigue: 85,
        inventory: [{ itemId: 'healing_pill', qty: 1 }],
      },
      personalGoal: {
        contractVersion: 'taixu.personal-goal.v1',
        goalId: 'personal_goal:disciple_goal:1',
        actorId: 'disciple_goal',
        revision: 1,
        status: 'active',
        goalKey: 'livelihood:resource:herb_1',
        kind: 'livelihood',
        sourceRef: 'resource:herb_1',
        candidateId: 'old',
        intent: '采药',
        progressScore: 0,
        progressKey: 'old',
        progressRevision: 0,
        backlog: [],
        observationRevision: 'old',
        startedGameHour: 0,
        lastProgressGameHour: 0,
        deadlineGameHour: 24,
        hardDeadlineGameHour: 72,
        attemptCount: 0,
      },
    });
    const selected = selectPersonaPreferredProposal(ctx, 1_000);
    expect(selected?.proposal.type).toBe('use_item');
    expect(selected?.personalGoalPlan.selected?.kind).toBe('recovery');
  });

  test('deduplicates and bounds the candidate backlog to three', () => {
    const ctx = context();
    const proposals = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      personalGoalCandidateForProposal(ctx, {
        candidate: candidate(`candidate:${id}`, 'gather', 'gather'),
        proposal: {
          type: 'gather',
          intent: `采集 ${id}`,
          source: 'agent',
          params: { resourceNodeId: id === 'e' ? 'd' : id },
        },
      }),
    ).filter((value): value is NonNullable<typeof value> => !!value);
    const backlog = boundedPersonalGoalBacklog(proposals);
    expect(backlog).toHaveLength(3);
    expect(backlog.map((entry) => entry.goalKey)).toEqual([
      'livelihood:resource:a',
      'livelihood:resource:b',
      'livelihood:resource:c',
    ]);
  });

  test('runtime planning returns explicit no-goal for one-shot unsupported actions', () => {
    const plan = buildPersonalGoalPlanForProposal(context(), 1_000, {
      type: 'attack',
      targetActorId: 'enemy',
      intent: '一次性冲突',
      source: 'agent',
    });
    expect(plan.selected).toBeUndefined();
    expect(plan.backlog.length).toBeLessThanOrEqual(3);
  });
});
