import type { AgentContext, AgentProposal } from './agentLogic';
import type { AutonomyCandidateV3 } from './autonomyDecisionContracts';
import type { ActivePersonalGoal } from './personalGoalContracts';
import { purposePersonalGoalCandidateForProposal } from './purposeBoundPersonalGoalLogic';
import {
  evaluatePurposeGoalArrival,
  evaluatePurposeGoalIntentionalIdle,
  evaluatePurposeGoalTerminal,
  initialPurposeGoalStage,
  personalGoalPlanForPurposeGoalContinuation,
  purposeGoalCausalFenceMatches,
  purposeGoalExpectedAction,
  resolvePurposeGoalContinuation,
} from './purposeBoundLifeGoalLogic';
import {
  PURPOSE_BOUND_LIFE_INTENT_VERSION,
  purposeBoundLifeIntentDigest,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';

const actorId = 'actor:purpose-chain';

function contextAt(
  locationId: string,
  candidates: { candidateId: string; proposal: AgentProposal }[] = [],
): AgentContext {
  return {
    purposeBoundLifeIntentV2: true,
    purposeBoundLifeCandidateBundle: {
      purposeFactsDigest: 'stable64:facts',
      candidates: candidates.map((entry, index) => ({
        planner: 'test',
        candidateId: entry.candidateId,
        legacyOrder: index,
        proposal: entry.proposal,
      })),
    },
    self: {
      actorId,
      name: '测试弟子',
      role: 'outer_disciple',
      realm: '炼气',
      realmStage: 1,
      cultivationXp: 4,
      mood: 0,
      health: 10,
      maxHealth: 10,
      fatigue: 65,
      spirit: 4,
      reputation: 0,
      currentLocationId: locationId,
      inventory: [{ itemId: 'spirit_herb', qty: 1 }],
    },
    others: [],
    recentEvents: [],
    availableActions: [
      'gather',
      'trade',
      'rest',
      'cultivate',
      'turn_in_request',
      'explore',
    ],
    knownLocations: [
      { locationId: 'home', name: '住处', allowedActions: ['rest'] },
      {
        locationId: 'destination',
        name: '目的地',
        allowedActions: [
          'gather',
          'trade',
          'rest',
          'cultivate',
          'turn_in_request',
          'explore',
        ],
      },
    ],
  };
}

const cases: { name: string; intent: PurposeBoundLifeIntentV2 }[] = [
  {
    name: 'gather',
    intent: {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'livelihood',
      sourceRef: 'resource:herb-node',
      sourceRevision: 'resource:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'gather',
      completionCondition: {
        kind: 'inventory_quantity_at_or_above',
        subjectRef: `inventory:${actorId}:spirit_herb`,
        itemId: 'spirit_herb',
        baselineQuantity: 0,
        quantity: 1,
      },
      interruptionPolicy: 'survival_or_invalidated',
    },
  },
  {
    name: 'trade',
    intent: {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'livelihood',
      sourceRef: 'shop:herb-shop',
      sourceRevision: 'shop:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'trade',
      completionCondition: {
        kind: 'inventory_quantity_at_or_below',
        subjectRef: `inventory:${actorId}:spirit_herb`,
        itemId: 'spirit_herb',
        baselineQuantity: 1,
        quantity: 0,
      },
      interruptionPolicy: 'survival_or_invalidated',
    },
  },
  {
    name: 'rest',
    intent: {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'recovery',
      sourceRef: `body:${actorId}`,
      sourceRevision: 'body:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'rest',
      completionCondition: {
        kind: 'body_metric_at_or_below',
        subjectRef: `body:${actorId}`,
        metric: 'fatigue',
        threshold: 45,
      },
      interruptionPolicy: 'hard_obligation_or_invalidated',
    },
  },
  {
    name: 'cultivate',
    intent: {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'cultivation',
      sourceRef: `cultivation:${actorId}`,
      sourceRevision: 'cultivation:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'cultivate',
      completionCondition: {
        kind: 'cultivation_xp_at_or_above',
        subjectRef: `cultivation:${actorId}`,
        baselineXp: 4,
        minimumXp: 5,
      },
      interruptionPolicy: 'survival_or_invalidated',
    },
  },
  {
    name: 'obligation',
    intent: {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'obligation',
      sourceRef: 'request:request-1',
      sourceRevision: 'request:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'turn_in_request',
      completionCondition: {
        kind: 'request_status_equals',
        subjectRef: 'request:request-1',
        expectedRevision: 'request:rev:1',
        status: 'completed',
      },
      interruptionPolicy: 'survival_or_invalidated',
    },
  },
  {
    name: 'explore',
    intent: {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'exploration',
      sourceRef: 'world_event:event-1',
      sourceRevision: 'event:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'explore',
      completionCondition: {
        kind: 'exploration_fact_recorded',
        subjectRef: 'world_event:event-1',
        expectedRevision: 'event:rev:1',
        factRef: 'world_fact:event-1:investigated',
      },
      interruptionPolicy: 'survival_or_invalidated',
    },
  },
];

function proposal(
  intent: PurposeBoundLifeIntentV2,
  type: AgentProposal['type'],
): AgentProposal {
  const digest = purposeBoundLifeIntentDigest(intent);
  return type === 'travel'
    ? {
        type,
        targetId: intent.targetLocationId,
        locationId: 'home',
        intent: `前往后执行 ${intent.intendedActivity}`,
        source: 'agent',
        params: { purposeBoundIntent: intent, purposeBoundIntentDigest: digest },
      }
    : {
        type,
        locationId: intent.targetLocationId,
        intent: `执行 ${intent.intendedActivity}`,
        source: 'agent',
        params: { purposeBoundIntent: intent, purposeBoundIntentDigest: digest },
      };
}

function autonomyCandidate(candidateId: string): AutonomyCandidateV3 {
  return {
    candidateId,
    planner: 'test',
    intentKind: 'purpose_test',
    status: 'eligible',
    legacyOrder: 0,
    survivalUrgency: 0,
    survivalReasonCodes: [],
    needScore: 1,
    personaFit: 1,
    personaReasonCodes: [],
    commitmentUrgency: 0,
    relationshipReasons: [],
    memorySourceIds: [],
  };
}

function activeGoal(intent: PurposeBoundLifeIntentV2): ActivePersonalGoal {
  const digest = purposeBoundLifeIntentDigest(intent);
  return {
    contractVersion: 'taixu.personal-goal.v1',
    goalId: 'goal:1',
    actorId,
    revision: 1,
    status: 'active',
    goalKey: `purpose_v2:${digest}`,
    kind: intent.purposeKind === 'recovery' ? 'recovery' : 'livelihood',
    sourceRef: intent.sourceRef,
    targetRef: intent.targetLocationId,
    candidateId: 'candidate:1',
    intent: '完成原定生活活动',
    progressScore: 0,
    progressKey: 'start',
    progressRevision: 1,
    backlog: [],
    observationRevision: 'observation:1',
    startedGameHour: 1,
    lastProgressGameHour: 1,
    deadlineGameHour: 25,
    hardDeadlineGameHour: 73,
    attemptCount: 1,
    purposeIntent: intent,
    purposeIntentDigest: digest,
    purposeStage: 'activity_ready',
  };
}

describe('C021q3 purpose goal travel to activity chain', () => {
  test.each(cases)(
    '$name keeps one goal key and reopens only the intended activity after arrival',
    ({ intent }) => {
      const candidate = autonomyCandidate('candidate:1');
      const travel = purposePersonalGoalCandidateForProposal(contextAt('home'), {
        candidate,
        proposal: proposal(intent, 'travel'),
      });
      const activityProposal = proposal(
        intent,
        intent.intendedActivity as AgentProposal['type'],
      );
      const activity = purposePersonalGoalCandidateForProposal(contextAt('destination'), {
        candidate,
        proposal: activityProposal,
      });
      expect(travel?.goalKey).toBe(activity?.goalKey);
      expect(travel?.purposeIntentDigest).toBe(
        purposeBoundLifeIntentDigest(intent),
      );
      expect(initialPurposeGoalStage(intent, 'home')).toBe('travel_pending');
      expect(purposeGoalExpectedAction('travel_pending', intent)).toBe('travel');
      expect(purposeGoalExpectedAction('activity_ready', intent)).toBe(
        intent.intendedActivity,
      );

      const continuation = resolvePurposeGoalContinuation(
        contextAt('destination', [
          { candidateId: 'candidate:1', proposal: activityProposal },
        ]),
        activeGoal(intent),
      );
      expect(continuation).toEqual({
        ok: true,
        candidateId: 'candidate:1',
        proposal: activityProposal,
      });
    },
  );

  test('retains the active purpose goal when a validated arrival opens its activity', () => {
    const intent = cases.find((entry) => entry.intent.intendedActivity === 'gather')!.intent;
    const digest = purposeBoundLifeIntentDigest(intent);
    const activityProposal = proposal(intent, 'gather');
    const goal = activeGoal(intent);
    const continuation = resolvePurposeGoalContinuation(
      contextAt('destination', [{ candidateId: 'candidate:activity', proposal: activityProposal }]),
      goal,
    );
    expect(continuation).toMatchObject({ ok: true, candidateId: 'candidate:activity' });
    if (!continuation.ok) throw new Error('continuation_missing');

    expect(personalGoalPlanForPurposeGoalContinuation({ goal, continuation })).toEqual({
      selected: expect.objectContaining({
        candidateId: 'candidate:activity',
        goalKey: goal.goalKey,
        purposeIntentDigest: digest,
        purposeIntent: intent,
      }),
      backlog: goal.backlog,
    });
  });

  test('duty return requires an arrived goal and a sourced intentional idle observation', () => {
    const intent: PurposeBoundLifeIntentV2 = {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'duty_return',
      sourceRef: `duty:${actorId}`,
      sourceRevision: 'duty:rev:1',
      targetLocationId: 'destination',
      intendedActivity: 'intentional_idle',
      completionCondition: {
        kind: 'duty_state_confirmed',
        subjectRef: `duty:${actorId}`,
        expectedRevision: 'duty:rev:1',
        locationId: 'destination',
        dutyState: 'cultivating',
      },
      interruptionPolicy: 'survival_or_invalidated',
    };
    const base = {
      intent,
      intentDigest: purposeBoundLifeIntentDigest(intent),
      actorId,
      sourceRef: `duty:${actorId}`,
    };
    expect(
      evaluatePurposeGoalIntentionalIdle({
        ...base,
        stage: 'activity_ready',
        currentLocationId: 'destination',
      }),
    ).toEqual({ ok: true });
    expect(
      evaluatePurposeGoalIntentionalIdle({
        ...base,
        stage: 'travel_pending',
        currentLocationId: 'destination',
      }),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_goal_action_mismatch' });
    expect(
      evaluatePurposeGoalIntentionalIdle({
        ...base,
        stage: 'activity_ready',
        currentLocationId: 'home',
      }),
    ).toMatchObject({ ok: false, reasonCode: 'purpose_goal_target_stale' });
  });

  test('rejects source revision drift instead of replacing the activity', () => {
    const original = cases[0].intent;
    const changed = { ...original, sourceRevision: 'resource:rev:2' };
    const result = resolvePurposeGoalContinuation(
      contextAt('destination', [
        { candidateId: 'candidate:1', proposal: proposal(changed, 'gather') },
      ]),
      activeGoal(original),
    );
    expect(result).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_source_revision_stale',
    });
  });

  test('rejects a changed destination and a different local action', () => {
    const intent = cases[3].intent;
    expect(
      resolvePurposeGoalContinuation(
        contextAt('home', []),
        activeGoal(intent),
      ),
    ).toEqual({ ok: false, reasonCode: 'purpose_goal_target_stale' });

    const wrong = proposal(intent, 'cultivate');
    wrong.type = 'rest';
    expect(
      resolvePurposeGoalContinuation(
        contextAt('destination', [{ candidateId: 'wrong', proposal: wrong }]),
        activeGoal(intent),
      ),
    ).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_activity_unavailable',
    });
  });

  test.each(cases)(
    '$name completes only from its own terminal event and authoritative post-state',
    ({ name, intent }) => {
      const actor = {
        health: 10,
        fatigue: name === 'rest' ? 45 : 65,
        cultivationXp: name === 'cultivate' ? 5 : 4,
        currentLocationId: 'destination',
        inventory: [
          {
            itemId: 'spirit_herb',
            qty: name === 'trade' ? 0 : 1,
          },
        ],
      };
      expect(
        evaluatePurposeGoalTerminal({
          intent,
          intentDigest: purposeBoundLifeIntentDigest(intent),
          actionType: intent.intendedActivity,
          actionRecordId: `action:${name}`,
          terminalEventActionId: `action:${name}`,
          terminalEventType:
            name === 'explore' ? 'exploration_found_rumor' : `${name}_completed`,
          actor,
          requestStatus: name === 'obligation' ? 'completed' : undefined,
        }),
      ).toEqual({ ok: true });
    },
  );

  test('does not complete on arrival, a foreign event, or an unchanged result', () => {
    const intent = cases[0].intent;
    const base = {
      intent,
      intentDigest: purposeBoundLifeIntentDigest(intent),
      actionType: 'gather',
      actionRecordId: 'action:gather',
      terminalEventActionId: 'action:gather',
      terminalEventType: 'gather_completed',
      actor: {
        health: 10,
        fatigue: 0,
        cultivationXp: 0,
        currentLocationId: 'destination',
        inventory: [] as { itemId: string; qty: number }[],
      },
    };
    expect(evaluatePurposeGoalTerminal(base)).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_completion_unsatisfied',
    });
    expect(
      evaluatePurposeGoalTerminal({
        ...base,
        terminalEventActionId: 'action:someone-else',
      }),
    ).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_causal_fence_mismatch',
    });
    expect(
      evaluatePurposeGoalTerminal({
        ...base,
        actionType: 'travel',
        terminalEventType: 'actor_arrived_location',
      }),
    ).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_action_mismatch',
    });
  });

  test('arrival advances exactly to activity_ready and cannot be replayed as completion', () => {
    const intent = cases[2].intent;
    const base = {
      intent,
      intentDigest: purposeBoundLifeIntentDigest(intent),
      actionType: 'travel',
      actionRecordId: 'action:travel',
      terminalEventActionId: 'action:travel',
      currentLocationId: 'destination',
    };
    expect(
      evaluatePurposeGoalArrival({ ...base, stage: 'travel_pending' }),
    ).toEqual({ ok: true, nextStage: 'activity_ready' });
    expect(
      evaluatePurposeGoalArrival({ ...base, stage: 'activity_ready' }),
    ).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_action_mismatch',
    });
    expect(
      evaluatePurposeGoalArrival({
        ...base,
        stage: 'travel_pending',
        terminalEventActionId: 'action:foreign',
      }),
    ).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_causal_fence_mismatch',
    });
  });

  test('the action fence binds actor, goal revision, digest, stage and action type', () => {
    const intent = cases[3].intent;
    const goal = activeGoal(intent);
    const fence = {
      goalId: goal.goalId,
      revision: goal.revision,
      intentDigest: goal.purposeIntentDigest!,
    };
    expect(
      purposeGoalCausalFenceMatches({
        fence,
        goal,
        actorId,
        actionType: 'cultivate',
        locationId: 'destination',
      }),
    ).toBe(true);
    for (const drift of [
      { actorId: 'actor:foreign' },
      { actionType: 'rest' },
      { locationId: 'home' },
      { fence: { ...fence, revision: 2 } },
      { fence: { ...fence, intentDigest: 'stable64:foreign' } },
      { goal: { ...goal, status: 'completed' } },
    ]) {
      expect(
        purposeGoalCausalFenceMatches({
          fence: drift.fence ?? fence,
          goal: drift.goal ?? goal,
          actorId: drift.actorId ?? actorId,
          actionType: drift.actionType ?? 'cultivate',
          locationId: drift.locationId ?? 'destination',
        }),
      ).toBe(false);
    }
  });

  test('the action fence binds event social intent to the exact warrant source and target', () => {
    const intent = {
      contractVersion: 'taixu.purpose-bound-life-intent.v2',
      purposeKind: 'relationship',
      sourceRef: 'event:event_helped_once',
      sourceRevision: 'event:stable64:helped',
      targetLocationId: 'destination',
      intendedActivity: 'gift',
      completionCondition: {
        kind: 'interaction_event_recorded',
        subjectRef: 'event:event_helped_once',
        afterEventRevision: 'event:stable64:helped',
        interactionType: 'gift',
      },
      interruptionPolicy: 'survival_or_invalidated',
    } as const;
    const goal = activeGoal(intent);
    const fence = {
      goalId: goal.goalId,
      revision: goal.revision,
      intentDigest: goal.purposeIntentDigest!,
    };
    const params = {
      socialWarrant: {
        sourceRef: intent.sourceRef,
        sourceRevision: intent.sourceRevision,
        eligibleTargetActorIds: ['actor:helper'],
      },
      socialOpportunityCandidate: { targetActorIds: ['actor:helper'] },
    };
    expect(purposeGoalCausalFenceMatches({
      fence, goal, actorId, actionType: 'gift', targetActorId: 'actor:helper',
      locationId: 'destination', params,
    })).toBe(true);
    expect(purposeGoalCausalFenceMatches({
      fence, goal, actorId, actionType: 'gift', targetActorId: 'actor:other',
      locationId: 'destination', params,
    })).toBe(false);
    expect(purposeGoalCausalFenceMatches({
      fence, goal, actorId, actionType: 'gift', targetActorId: 'actor:helper',
      locationId: 'destination', params: {
        ...params,
        socialWarrant: { ...params.socialWarrant, sourceRevision: 'event:stable64:drift' },
      },
    })).toBe(false);
  });

  test('the action fence binds a consequence projection and its durable lineage', () => {
    const intent = {
      contractVersion: 'taixu.purpose-bound-life-intent.v2',
      purposeKind: 'relationship',
      sourceRef: 'consequence:social_consequence:gratitude',
      sourceRevision: 'consequence_revision:stable64:0123456789abcdef',
      targetLocationId: 'destination',
      intendedActivity: 'talk',
      completionCondition: {
        kind: 'interaction_event_recorded',
        subjectRef: 'consequence:social_consequence:gratitude',
        afterEventRevision: 'consequence_revision:stable64:0123456789abcdef',
        interactionType: 'talk',
      },
      interruptionPolicy: 'survival_or_invalidated',
    } as const;
    const goal = activeGoal(intent);
    const fence = {
      goalId: goal.goalId,
      revision: goal.revision,
      intentDigest: goal.purposeIntentDigest!,
    };
    const params = {
      socialWarrant: {
        sourceRef: intent.sourceRef,
        sourceRevision: intent.sourceRevision,
        eligibleTargetActorIds: ['actor:helper'],
      },
      socialOpportunityCandidate: { targetActorIds: ['actor:helper'] },
      socialConsequenceId: 'social_consequence:gratitude',
      socialConsequenceSourceOutcomeId: 'social_outcome:aid',
      socialConsequenceProjectionDigest: 'stable64:fedcba9876543210',
    };
    const base = {
      fence, goal, actorId, actionType: 'talk', targetActorId: 'actor:helper',
      locationId: 'destination', params,
    };
    expect(purposeGoalCausalFenceMatches(base)).toBe(true);
    expect(purposeGoalCausalFenceMatches({
      ...base, params: { ...params, socialConsequenceId: 'social_consequence:other' },
    })).toBe(false);
    expect(purposeGoalCausalFenceMatches({
      ...base, params: { ...params, socialConsequenceProjectionDigest: '' },
    })).toBe(false);
    expect(purposeGoalCausalFenceMatches({
      ...base, params: { ...params, socialConsequenceSourceOutcomeId: '' },
    })).toBe(false);
  });

  test('the fence also binds destination and the source-specific action target', () => {
    const intent = cases[0].intent;
    const goal = {
      ...activeGoal(intent),
      purposeStage: 'travel_pending' as const,
    };
    const fence = {
      goalId: goal.goalId,
      revision: goal.revision,
      intentDigest: goal.purposeIntentDigest!,
    };
    const base = {
      fence,
      goal,
      actorId,
      actionType: 'travel',
      targetId: 'destination',
      locationId: 'home',
      params: { resourceNodeId: 'herb-node' },
    };
    expect(purposeGoalCausalFenceMatches(base)).toBe(true);
    expect(
      purposeGoalCausalFenceMatches({ ...base, targetId: 'other-place' }),
    ).toBe(false);
    expect(
      purposeGoalCausalFenceMatches({
        ...base,
        params: { resourceNodeId: 'other-node' },
      }),
    ).toBe(false);
  });
});
