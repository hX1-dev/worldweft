import type { AgentContext, AgentProposal } from './agentLogic';
import { selectPersonaPreferredProposal } from './autonomyDecisionTraceLogic';
import type {
  ActivePersonalGoal,
  PersonalGoalCandidate,
  PurposeGoalCadenceWindow,
} from './personalGoalContracts';
import {
  evaluatePurposeGoalCadence,
  evaluatePurposeGoalReplacement,
  isHardObligationIntent,
  isMajorEventIntent,
  purposeGoalCadenceKey,
  purposeGoalCooldownHours,
  purposeGoalRevalidationDeferredBySession,
  resolveActivePurposeGoal,
} from './purposeGoalCadenceLogic';
import {
  PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
  type PurposeBoundLifeCandidateV2,
} from './purposeBoundLifeCandidateLogic';
import {
  PURPOSE_BOUND_LIFE_INTENT_VERSION,
  purposeBoundLifeIntentDigest,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';

const actorId = 'actor:cadence';

function gatherIntent(
  overrides: Partial<PurposeBoundLifeIntentV2> = {},
): PurposeBoundLifeIntentV2 {
  return {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'livelihood',
    sourceRef: 'resource:herb_patch',
    sourceRevision: 'resource:rev:1',
    targetLocationId: 'herb_field',
    intendedActivity: 'gather',
    completionCondition: {
      kind: 'inventory_quantity_at_or_above',
      subjectRef: `inventory:${actorId}:spirit_herb`,
      itemId: 'spirit_herb',
      baselineQuantity: 0,
      quantity: 1,
    },
    interruptionPolicy: 'survival_or_invalidated',
    ...overrides,
  } as PurposeBoundLifeIntentV2;
}

function candidate(
  intent: PurposeBoundLifeIntentV2,
  overrides: Partial<PersonalGoalCandidate> = {},
): PersonalGoalCandidate {
  const digest = purposeBoundLifeIntentDigest(intent);
  return {
    candidateId: `candidate:${intent.intendedActivity}`,
    goalKey: `purpose_v2:${digest}`,
    kind:
      intent.purposeKind === 'recovery'
        ? 'recovery'
        : intent.purposeKind === 'cultivation'
          ? 'cultivation'
          : intent.purposeKind === 'obligation'
            ? 'commitment'
            : 'livelihood',
    sourceRef: intent.sourceRef,
    targetRef: intent.targetLocationId,
    intent: `完成 ${intent.intendedActivity}`,
    progressScore: 0,
    progressKey: 'fixture',
    purposeIntent: intent,
    purposeIntentDigest: digest,
    purposeCadenceKey: purposeGoalCadenceKey(intent),
    ...overrides,
  };
}

function activeGoal(
  selected: PersonalGoalCandidate,
  stage: ActivePersonalGoal['purposeStage'] = 'travel_pending',
): ActivePersonalGoal {
  return {
    contractVersion: 'taixu.personal-goal.v1',
    goalId: 'goal:active',
    actorId,
    revision: 2,
    status: 'active',
    goalKey: selected.goalKey,
    kind: selected.kind,
    sourceRef: selected.sourceRef,
    targetRef: selected.targetRef,
    candidateId: selected.candidateId,
    intent: selected.intent,
    progressScore: selected.progressScore,
    progressKey: selected.progressKey,
    progressRevision: 1,
    backlog: [],
    observationRevision: 'observation:1',
    startedGameHour: 10,
    lastProgressGameHour: 10,
    deadlineGameHour: 34,
    hardDeadlineGameHour: 82,
    attemptCount: 1,
    purposeIntent: selected.purposeIntent,
    purposeIntentDigest: selected.purposeIntentDigest,
    purposeCadenceKey: selected.purposeCadenceKey,
    purposeStage: stage,
  };
}

function proposal(intent: PurposeBoundLifeIntentV2, type: AgentProposal['type']) {
  const digest = purposeBoundLifeIntentDigest(intent);
  return {
    type,
    targetId: type === 'travel' ? intent.targetLocationId : undefined,
    locationId: type === 'travel' ? 'home' : intent.targetLocationId,
    intent: `执行 ${intent.intendedActivity}`,
    source: 'agent' as const,
    params: {
      purposeBoundIntent: intent,
      purposeBoundIntentDigest: digest,
    },
  } as AgentProposal;
}

function bundleCandidate(
  selected: PersonalGoalCandidate,
  actionType: AgentProposal['type'],
): PurposeBoundLifeCandidateV2 {
  const intent = selected.purposeIntent!;
  return {
    contractVersion: PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
    candidateId: selected.candidateId,
    planner: 'fixture',
    legacyOrder: 0,
    intent,
    intentDigest: selected.purposeIntentDigest!,
    proposal: proposal(intent, actionType),
    proposalDigest: 'stable64:proposal',
    personalGoalCandidate: selected,
  };
}

function context(
  locationId: string,
  candidates: PurposeBoundLifeCandidateV2[],
): AgentContext {
  return {
    purposeBoundLifeIntentV2: true,
    purposeBoundLifeCandidateBundle: {
      purposeFactsDigest: 'stable64:facts',
      candidates,
    },
    self: {
      actorId,
      name: '节奏测试弟子',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      cultivationXp: 0,
      mood: 0,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 2,
      reputation: 0,
      currentLocationId: locationId,
      inventory: [],
    },
    others: [],
    recentEvents: [],
    availableActions: ['travel', 'gather', 'rest', 'turn_in_request', 'explore'],
    knownLocations: [
      { locationId: 'home', name: '住处', allowedActions: ['rest'] },
      { locationId: 'herb_field', name: '药田', allowedActions: ['gather'] },
      { locationId: 'other_field', name: '后山', allowedActions: ['gather'] },
    ],
  };
}

function windowFor(
  selected: PersonalGoalCandidate,
  nextEligibleGameHour = 14,
): PurposeGoalCadenceWindow {
  return {
    goalId: 'goal:previous',
    cadenceKey: selected.purposeCadenceKey!,
    sourceRef: selected.sourceRef,
    sourceRevision: selected.purposeIntent!.sourceRevision,
    purposeKind: selected.purposeIntent!.purposeKind,
    intendedActivity: selected.purposeIntent!.intendedActivity,
    terminalStatus: 'completed',
    terminalReasonCode: 'purpose_goal_completed',
    terminalGameHour: 12,
    nextEligibleGameHour,
  };
}

describe('C021q4 purpose goal stickiness and natural cadence', () => {
  test('semantic cadence cannot be evaded by changing revision, baseline, or destination', () => {
    const base = gatherIntent();
    const changed = gatherIntent({
      sourceRevision: 'resource:rev:99',
      targetLocationId: 'other_field',
      completionCondition: {
        kind: 'inventory_quantity_at_or_above',
        subjectRef: `inventory:${actorId}:spirit_herb`,
        itemId: 'spirit_herb',
        baselineQuantity: 8,
        quantity: 9,
      },
    });
    expect(purposeGoalCadenceKey(changed)).toBe(purposeGoalCadenceKey(base));
    expect(
      purposeGoalCadenceKey(gatherIntent({ sourceRef: 'resource:other_patch' })),
    ).not.toBe(purposeGoalCadenceKey(base));
  });

  test('keeps an active goal against ordinary churn and permits only explicit interrupts', () => {
    const current = candidate(gatherIntent());
    const active = activeGoal(current);
    const ordinary = candidate(
      gatherIntent({ sourceRef: 'resource:other_patch', sourceRevision: 'resource:rev:2' }),
    );
    expect(evaluatePurposeGoalReplacement({ active, selected: ordinary })).toEqual({
      kind: 'retain',
      reasonCode: 'purpose_goal_committed',
    });

    const survival = candidate(gatherIntent(), {
      candidateId: 'candidate:survival',
      goalKey: 'survival:threat',
      kind: 'avoid_threat',
      sourceRef: 'encounter:wolf',
      purposeIntent: undefined,
      purposeIntentDigest: undefined,
      purposeCadenceKey: undefined,
    });
    expect(evaluatePurposeGoalReplacement({ active, selected: survival })).toEqual({
      kind: 'replace',
      reasonCode: 'higher_priority_survival',
    });

    const hardIntent = gatherIntent({
      purposeKind: 'obligation',
      sourceRef: 'request:escort',
      sourceRevision: 'request:rev:1',
      intendedActivity: 'turn_in_request',
      completionCondition: {
        kind: 'request_status_equals',
        subjectRef: 'request:escort',
        expectedRevision: 'request:rev:1',
        status: 'completed',
      },
    });
    expect(isHardObligationIntent(hardIntent)).toBe(true);
    expect(
      evaluatePurposeGoalReplacement({
        active: activeGoal(
          candidate(gatherIntent({ interruptionPolicy: 'hard_obligation_or_invalidated' })),
        ),
        selected: candidate(hardIntent),
      }),
    ).toEqual({ kind: 'replace', reasonCode: 'higher_priority_hard_obligation' });
    expect(evaluatePurposeGoalReplacement({ active, selected: candidate(hardIntent) })).toEqual({
      kind: 'retain',
      reasonCode: 'purpose_goal_committed',
    });

    const majorEvent = gatherIntent({
      purposeKind: 'obligation',
      sourceRef: 'world_event:miasma',
      sourceRevision: 'event:rev:1',
      intendedActivity: 'explore',
      completionCondition: {
        kind: 'exploration_fact_recorded',
        subjectRef: 'world_event:miasma',
        expectedRevision: 'event:rev:1',
        factRef: 'world_fact:miasma:investigated',
      },
    });
    expect(isMajorEventIntent(majorEvent)).toBe(true);
    expect(
      evaluatePurposeGoalReplacement({ active, selected: candidate(majorEvent) }),
    ).toEqual({ kind: 'replace', reasonCode: 'higher_priority_major_event' });
  });

  test('runtime selection continues the committed candidate even when ordinary rank order changes', () => {
    const committed = candidate(gatherIntent(), { candidateId: 'candidate:committed' });
    const distraction = candidate(
      gatherIntent({
        sourceRef: 'resource:other_patch',
        sourceRevision: 'resource:rev:2',
        targetLocationId: 'other_field',
      }),
      { candidateId: 'candidate:distraction' },
    );
    const ctx = context('home', [
      { ...bundleCandidate(distraction, 'travel'), legacyOrder: 0 },
      { ...bundleCandidate(committed, 'travel'), legacyOrder: 50 },
    ]);
    ctx.personalGoal = activeGoal(committed);
    const selected = selectPersonaPreferredProposal(ctx, 1_000);
    expect(selected?.proposal).toMatchObject({ type: 'travel', targetId: 'herb_field' });
    expect(selected?.personalGoalPlan.selected?.candidateId).toBe('candidate:committed');
  });

  test('blocks repeated purpose until the exact boundary without using random quotas', () => {
    const selected = candidate(gatherIntent());
    const windows = [windowFor(selected)];
    expect(
      evaluatePurposeGoalCadence({ candidate: selected, currentGameHour: 13.99, windows }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'purpose_goal_cadence_wait',
      nextEligibleGameHour: 14,
    });
    expect(
      evaluatePurposeGoalCadence({ candidate: selected, currentGameHour: 14, windows }),
    ).toEqual({ allowed: true, reasonCode: 'purpose_goal_cadence_ready' });
    expect(
      evaluatePurposeGoalCadence({
        candidate: selected,
        currentGameHour: 13,
        windows,
        activeGoal: activeGoal(selected),
      }),
    ).toEqual({ allowed: true, reasonCode: 'purpose_goal_continuation' });
    const otherSource = candidate(
      gatherIntent({ sourceRef: 'resource:other_patch', sourceRevision: 'resource:rev:2' }),
    );
    expect(
      evaluatePurposeGoalCadence({ candidate: otherSource, currentGameHour: 13, windows }),
    ).toEqual({ allowed: true, reasonCode: 'purpose_goal_cadence_ready' });
  });

  test('urgent physical need may bypass recovery cadence, while normal fatigue may not', () => {
    const restIntent: PurposeBoundLifeIntentV2 = {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'recovery',
      sourceRef: `body:${actorId}`,
      sourceRevision: 'body:rev:1',
      targetLocationId: 'home',
      intendedActivity: 'rest',
      completionCondition: {
        kind: 'body_metric_at_or_below',
        subjectRef: `body:${actorId}`,
        metric: 'fatigue',
        threshold: 45,
      },
      interruptionPolicy: 'hard_obligation_or_invalidated',
    };
    const rest = candidate(restIntent);
    const windows = [windowFor(rest, 15)];
    expect(
      evaluatePurposeGoalCadence({ candidate: rest, currentGameHour: 14, windows, fatigue: 79 }),
    ).toMatchObject({ allowed: false });
    expect(
      evaluatePurposeGoalCadence({ candidate: rest, currentGameHour: 14, windows, fatigue: 80 }),
    ).toEqual({ allowed: true, reasonCode: 'purpose_goal_cadence_bypass_need' });
  });

  test('does not recreate a failed goal from the identical authoritative snapshot', () => {
    const selected = candidate(gatherIntent());
    const failedWindow: PurposeGoalCadenceWindow = {
      ...windowFor(selected, 12),
      terminalStatus: 'failed',
      terminalReasonCode: 'target_not_nearby',
    };
    expect(
      evaluatePurposeGoalCadence({
        candidate: selected,
        currentGameHour: 100,
        windows: [failedWindow],
      }),
    ).toMatchObject({
      allowed: false,
      reasonCode: 'purpose_goal_cadence_wait',
      priorGoalId: 'goal:previous',
      nextEligibleGameHour: Number.MAX_SAFE_INTEGER,
    });

    const changed = candidate(gatherIntent({ sourceRevision: 'resource:rev:2' }));
    expect(
      evaluatePurposeGoalCadence({
        candidate: changed,
        currentGameHour: 100,
        windows: [failedWindow],
      }),
    ).toEqual({ allowed: true, reasonCode: 'purpose_goal_cadence_ready' });
  });

  test('revalidates the exact active source across travel and activity stages', () => {
    const selected = candidate(gatherIntent());
    const travel = bundleCandidate(selected, 'travel');
    expect(resolveActivePurposeGoal(context('home', [travel]), activeGoal(selected))).toEqual({
      ok: true,
      candidateId: selected.candidateId,
      proposal: travel.proposal,
    });
    const activity = bundleCandidate(selected, 'gather');
    expect(
      resolveActivePurposeGoal(
        context('herb_field', [activity]),
        activeGoal(selected, 'activity_ready'),
      ),
    ).toEqual({
      ok: true,
      candidateId: selected.candidateId,
      proposal: activity.proposal,
    });
    expect(resolveActivePurposeGoal(context('home', []), activeGoal(selected))).toEqual({
      ok: false,
      reasonCode: 'purpose_goal_source_missing',
    });
    const changed = candidate(gatherIntent({ sourceRevision: 'resource:rev:2' }));
    expect(
      resolveActivePurposeGoal(
        context('home', [bundleCandidate(changed, 'travel')]),
        activeGoal(selected),
      ),
    ).toEqual({ ok: false, reasonCode: 'purpose_goal_source_revision_stale' });
    const retargeted = candidate(gatherIntent({ targetLocationId: 'other_field' }));
    expect(
      resolveActivePurposeGoal(
        context('home', [bundleCandidate(retargeted, 'travel')]),
        activeGoal(selected),
      ),
    ).toEqual({ ok: false, reasonCode: 'purpose_goal_target_stale' });
    expect(
      resolveActivePurposeGoal(
        context('home', [bundleCandidate(selected, 'gather')]),
        activeGoal(selected),
      ),
    ).toEqual({ ok: false, reasonCode: 'purpose_goal_activity_unavailable' });
  });

  test('a bounded social session suspends revalidation without cancelling the life goal', () => {
    const ctx = context('home', []);
    ctx.activeConversation = {
      conversationId: 'conversation:1',
      topicId: 'topic:1',
      otherActorId: 'actor:visitor',
      otherActorName: '访客',
      currentSpeakerActorId: actorId,
      turnNumber: 1,
      maxTurns: 4,
      expiresAt: 2_000,
      recentTurns: [],
      visibleFacts: [],
      beliefs: [],
    };
    expect(purposeGoalRevalidationDeferredBySession(ctx)).toBe(true);
    ctx.activeConversation = undefined;
    expect(purposeGoalRevalidationDeferredBySession(ctx)).toBe(false);
  });

  test('cooldowns are deterministic and failures never create a long lockout', () => {
    const intent = gatherIntent();
    expect(
      purposeGoalCooldownHours({
        intent,
        terminalStatus: 'completed',
        reasonCode: 'purpose_goal_completed',
      }),
    ).toBe(2);
    expect(
      purposeGoalCooldownHours({
        intent,
        terminalStatus: 'failed',
        reasonCode: 'purpose_goal_source_revision_stale',
      }),
    ).toBe(0);
    expect(
      purposeGoalCooldownHours({
        intent,
        terminalStatus: 'failed',
        reasonCode: 'body_execution_failed',
      }),
    ).toBe(1);
  });
});
