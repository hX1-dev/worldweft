import {
  assertPurposeBehaviorReleaseReady,
  createPurposeBehaviorReleaseAudit,
  type PurposeActionSelectedObservation,
  type PurposeGoalCreatedObservation,
} from './purposeBehaviorReleaseAuditLogic';

const actorId = 'actor:audited';

function goal(
  sequence: number,
  goalId = 'goal:gather',
  overrides: Partial<PurposeGoalCreatedObservation> = {},
): PurposeGoalCreatedObservation {
  return {
    sequence,
    gameHour: sequence / 10,
    actorId,
    goalId,
    cadenceKey: 'cadence:resource:herb_patch:gather',
    purposeIntentDigest: 'stable64:intent-gather',
    sourceRef: 'resource:herb_patch',
    sourceRevision: 'resource:rev:1',
    sourceStateDigest: 'stable64:source-before',
    targetLocationId: 'herb_field',
    intendedActivity: 'gather',
    completionConditionDigest: 'stable64:completion-gather',
    ...overrides,
  };
}

function travel(
  sequence: number,
  goalId = 'goal:gather',
  overrides: Partial<PurposeActionSelectedObservation> = {},
): PurposeActionSelectedObservation {
  return {
    sequence,
    gameHour: sequence / 10,
    actorId,
    actionId: `action:travel:${sequence}`,
    actionType: 'travel',
    goalId,
    purposeIntentDigest: 'stable64:intent-gather',
    sourceRef: 'resource:herb_patch',
    sourceRevision: 'resource:rev:1',
    intendedActivity: 'gather',
    fromLocationId: 'mountain_gate',
    targetLocationId: 'herb_field',
    ...overrides,
  };
}

function recordCompletedGatherChain() {
  const audit = createPurposeBehaviorReleaseAudit();
  audit.recordGoalCreated(goal(1));
  audit.recordActionSelected(travel(2));
  audit.recordActionTerminal({
    sequence: 3,
    gameHour: 0.3,
    actorId,
    actionId: 'action:travel:2',
    status: 'arrived',
    finalLocationId: 'herb_field',
  });
  audit.recordActionSelected({
    sequence: 4,
    gameHour: 0.4,
    actorId,
    actionId: 'action:gather:4',
    actionType: 'gather',
    goalId: 'goal:gather',
    sourceRef: 'resource:herb_patch',
    sourceRevision: 'resource:rev:1',
  });
  audit.recordActionTerminal({
    sequence: 5,
    gameHour: 0.5,
    actorId,
    actionId: 'action:gather:4',
    status: 'completed',
    finalLocationId: 'herb_field',
  });
  audit.recordCausalChange({
    sequence: 6,
    gameHour: 0.6,
    actorId,
    kind: 'resource',
    sourceEventId: 'event:gather:4',
    sourceRef: 'resource:herb_patch',
    beforeDigest: 'stable64:stock-2-bag-0',
    afterDigest: 'stable64:stock-1-bag-1',
  });
  audit.recordGoalTerminal({
    sequence: 7,
    gameHour: 0.7,
    actorId,
    goalId: 'goal:gather',
    status: 'completed',
    reasonCode: 'purpose_goal_completed',
  });
  return audit;
}

function recordRoundTrip(options: { effectiveChange: boolean; emptyChange?: boolean }) {
  const audit = createPurposeBehaviorReleaseAudit();
  audit.recordGoalCreated(goal(1));
  audit.recordActionSelected(travel(2));
  audit.recordActionTerminal({
    sequence: 3,
    gameHour: 1,
    actorId,
    actionId: 'action:travel:2',
    status: 'arrived',
    finalLocationId: 'herb_field',
  });
  audit.recordActionSelected({
    sequence: 4,
    gameHour: 2,
    actorId,
    actionId: 'action:gather:4',
    actionType: 'gather',
    goalId: 'goal:gather',
  });
  audit.recordActionTerminal({
    sequence: 5,
    gameHour: 3,
    actorId,
    actionId: 'action:gather:4',
    status: 'completed',
  });
  let sequence = 6;
  if (options.effectiveChange || options.emptyChange) {
    audit.recordCausalChange({
      sequence,
      gameHour: 3.1,
      actorId,
      kind: 'resource',
      sourceEventId: 'event:gather',
      sourceRef: 'resource:herb_patch',
      beforeDigest: 'stable64:before',
      afterDigest: options.effectiveChange ? 'stable64:after' : 'stable64:before',
    });
    sequence += 1;
  }
  audit.recordGoalTerminal({
    sequence,
    gameHour: 3.2,
    actorId,
    goalId: 'goal:gather',
    status: 'completed',
    reasonCode: 'purpose_goal_completed',
  });
  sequence += 1;
  audit.recordGoalCreated(
    goal(sequence, 'goal:return', {
      gameHour: 4,
      cadenceKey: 'cadence:duty:return',
      purposeIntentDigest: 'stable64:intent-return',
      sourceRef: 'duty:outer_disciple',
      sourceRevision: 'duty:rev:1',
      sourceStateDigest: 'stable64:duty-away',
      targetLocationId: 'mountain_gate',
      intendedActivity: 'rest',
      completionConditionDigest: 'stable64:completion-return',
    }),
  );
  sequence += 1;
  audit.recordActionSelected(
    travel(sequence, 'goal:return', {
      gameHour: 4.1,
      actionId: 'action:return',
      purposeIntentDigest: 'stable64:intent-return',
      sourceRef: 'duty:outer_disciple',
      sourceRevision: 'duty:rev:1',
      intendedActivity: 'rest',
      fromLocationId: 'herb_field',
      targetLocationId: 'mountain_gate',
    }),
  );
  sequence += 1;
  audit.recordActionTerminal({
    sequence,
    gameHour: 5,
    actorId,
    actionId: 'action:return',
    status: 'arrived',
    finalLocationId: 'mountain_gate',
  });
  sequence += 1;
  audit.recordActionSelected({
    sequence,
    gameHour: 5.1,
    actorId,
    actionId: 'action:rest:return',
    actionType: 'rest',
    goalId: 'goal:return',
  });
  sequence += 1;
  audit.recordActionTerminal({
    sequence,
    gameHour: 6,
    actorId,
    actionId: 'action:rest:return',
    status: 'completed',
  });
  sequence += 1;
  audit.recordGoalTerminal({
    sequence,
    gameHour: 6.1,
    actorId,
    goalId: 'goal:return',
    status: 'completed',
    reasonCode: 'purpose_goal_completed',
  });
  return audit.finish();
}

describe('C021q5 purpose behavior release audit', () => {
  test('passes a fully sourced goal, arrived body, exact activity and real terminal chain', () => {
    const result = recordCompletedGatherChain().finish();
    expect(result).toMatchObject({
      observationOnly: true,
      releaseStatus: 'pass',
      goals: { created: 1, terminal: 1, activeAtEnd: 0 },
      actions: { selected: 2, terminal: 2, pendingAtEnd: 0 },
      travels: { selected: 1, arrived: 1 },
      followThrough: {
        expected: 1,
        completed: 1,
        explainedTerminal: 0,
        pendingAtEnd: 0,
        unresolved: 0,
      },
    });
    expect(Object.values(result.violations).every((count) => count === 0)).toBe(true);
    expect(assertPurposeBehaviorReleaseReady(result)).toBe(result);
  });

  test.each([
    ['missing goal', 'goal:gather', { goalId: undefined }],
    ['wrong source revision', 'goal:gather', { sourceRevision: 'resource:rev:2' }],
    ['wrong intent', 'goal:gather', { purposeIntentDigest: 'stable64:other' }],
    ['wrong target', 'goal:gather', { targetLocationId: 'market' }],
    ['wrong activity', 'goal:gather', { intendedActivity: 'rest' as const }],
  ])('rejects ungrounded travel: %s', (_name, actionGoalId, overrides) => {
    const audit = createPurposeBehaviorReleaseAudit();
    audit.recordGoalCreated(goal(1));
    audit.recordActionSelected(travel(2, actionGoalId, overrides));
    const result = audit.finish();
    expect(result.releaseStatus).toBe('fail');
    expect(result.violations.ungrounded_travel).toBe(1);
    expect(() => assertPurposeBehaviorReleaseReady(result)).toThrow(
      /purpose_behavior_release_gate_failed:.*ungrounded_travel/,
    );
  });

  test('reports missing source and completion contracts independently', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    audit.recordGoalCreated(
      goal(1, 'goal:malformed', {
        sourceRef: undefined,
        sourceRevision: undefined,
        intendedActivity: undefined,
        completionConditionDigest: undefined,
      }),
    );
    const result = audit.finish();
    expect(result.violations).toMatchObject({
      purpose_source_missing: 1,
      completion_condition_missing: 1,
    });
  });

  test('requires exact same-goal activity and treats a sourced terminal as explained', () => {
    const wrong = createPurposeBehaviorReleaseAudit();
    wrong.recordGoalCreated(goal(1));
    wrong.recordActionSelected(travel(2));
    wrong.recordActionTerminal({
      sequence: 3,
      gameHour: 0.3,
      actorId,
      actionId: 'action:travel:2',
      status: 'arrived',
      finalLocationId: 'herb_field',
    });
    wrong.recordActionSelected({
      sequence: 4,
      gameHour: 0.4,
      actorId,
      actionId: 'action:wrong',
      actionType: 'rest',
      goalId: 'goal:gather',
    });
    wrong.recordActionTerminal({
      sequence: 5,
      gameHour: 0.5,
      actorId,
      actionId: 'action:wrong',
      status: 'completed',
    });
    expect(wrong.finish().violations.arrival_without_follow_through).toBe(1);

    const explained = createPurposeBehaviorReleaseAudit();
    explained.recordGoalCreated(goal(1));
    explained.recordActionSelected(travel(2));
    explained.recordActionTerminal({
      sequence: 3,
      gameHour: 0.3,
      actorId,
      actionId: 'action:travel:2',
      status: 'arrived',
      finalLocationId: 'herb_field',
    });
    explained.recordGoalTerminal({
      sequence: 4,
      gameHour: 0.4,
      actorId,
      goalId: 'goal:gather',
      status: 'failed',
      reasonCode: 'purpose_goal_source_revision_stale',
    });
    const explainedResult = explained.finish();
    expect(explainedResult.releaseStatus).toBe('pass');
    expect(explainedResult.followThrough.explainedTerminal).toBe(1);
    expect(explainedResult.violations.arrival_without_follow_through).toBe(0);
  });

  test('accepts an exact blocked activity reason without inventing completion', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    audit.recordGoalCreated(goal(1));
    audit.recordActionSelected(travel(2));
    audit.recordActionTerminal({
      sequence: 3,
      gameHour: 0.3,
      actorId,
      actionId: 'action:travel:2',
      status: 'arrived',
      finalLocationId: 'herb_field',
    });
    audit.recordActionSelected({
      sequence: 4,
      gameHour: 0.4,
      actorId,
      actionId: 'action:gather:blocked',
      actionType: 'gather',
      goalId: 'goal:gather',
    });
    audit.recordActionTerminal({
      sequence: 5,
      gameHour: 0.5,
      actorId,
      actionId: 'action:gather:blocked',
      status: 'blocked',
      reasonCode: 'resource_depleted',
    });
    audit.recordGoalTerminal({
      sequence: 6,
      gameHour: 0.6,
      actorId,
      goalId: 'goal:gather',
      status: 'failed',
      reasonCode: 'resource_depleted',
    });
    const result = audit.finish();
    expect(result.releaseStatus).toBe('pass');
    expect(result.followThrough).toMatchObject({ completed: 0, explainedTerminal: 1 });
  });

  test('does not let an arbitrary action or empty digest change explain A-B-A', () => {
    const noChange = recordRoundTrip({ effectiveChange: false });
    expect(noChange.roundTrips).toEqual({
      detected: 1,
      explainedByCausalChange: 0,
      unexplained: 1,
    });
    expect(noChange.violations.unexplained_round_trip).toBe(1);

    const emptyChange = recordRoundTrip({ effectiveChange: false, emptyChange: true });
    expect(emptyChange.causalChanges).toMatchObject({ recorded: 1, effective: 0 });
    expect(emptyChange.violations.unexplained_round_trip).toBe(1);

    const changed = recordRoundTrip({ effectiveChange: true });
    expect(changed.releaseStatus).toBe('pass');
    expect(changed.roundTrips).toEqual({
      detected: 1,
      explainedByCausalChange: 1,
      unexplained: 0,
    });
  });

  test('credits a sourced change that invalidates the outbound purpose while the body is in transit', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    audit.recordGoalCreated(goal(1));
    audit.recordActionSelected(travel(2));
    audit.recordCausalChange({
      sequence: 3,
      gameHour: 0.3,
      actorId,
      kind: 'resource',
      sourceEventId: 'event:resource-invalidated-in-transit',
      sourceRef: 'resource:herb_patch',
      beforeDigest: 'stable64:available',
      afterDigest: 'stable64:depleted',
    });
    audit.recordActionTerminal({
      sequence: 4,
      gameHour: 0.4,
      actorId,
      actionId: 'action:travel:2',
      status: 'arrived',
      finalLocationId: 'herb_field',
    });
    audit.recordGoalTerminal({
      sequence: 5,
      gameHour: 0.5,
      actorId,
      goalId: 'goal:gather',
      status: 'failed',
      reasonCode: 'purpose_goal_source_revision_stale',
    });
    audit.recordGoalCreated(
      goal(6, 'goal:return', {
        cadenceKey: 'cadence:return',
        purposeIntentDigest: 'stable64:return',
        sourceRef: `duty:${actorId}`,
        sourceRevision: 'duty:rev:1',
        sourceStateDigest: 'stable64:return-away',
        targetLocationId: 'mountain_gate',
        intendedActivity: 'intentional_idle',
        completionConditionDigest: 'stable64:return-condition',
      }),
    );
    audit.recordActionSelected(
      travel(7, 'goal:return', {
        actionId: 'action:return:7',
        purposeIntentDigest: 'stable64:return',
        sourceRef: `duty:${actorId}`,
        sourceRevision: 'duty:rev:1',
        intendedActivity: 'intentional_idle',
        fromLocationId: 'herb_field',
        targetLocationId: 'mountain_gate',
      }),
    );
    audit.recordActionTerminal({
      sequence: 8,
      gameHour: 0.8,
      actorId,
      actionId: 'action:return:7',
      status: 'arrived',
      finalLocationId: 'mountain_gate',
    });
    audit.recordIntentionalIdle({
      sequence: 9,
      gameHour: 0.9,
      actorId,
      goalId: 'goal:return',
      sourceRef: `duty:${actorId}`,
      reasonCode: 'on_watch',
    });
    audit.recordGoalTerminal({
      sequence: 10,
      gameHour: 1,
      actorId,
      goalId: 'goal:return',
      status: 'completed',
      reasonCode: 'purpose_goal_duty_state_confirmed',
    });
    const result = audit.finish();
    expect(result.releaseStatus).toBe('pass');
    expect(result.roundTrips).toEqual({
      detected: 1,
      explainedByCausalChange: 1,
      unexplained: 0,
    });
  });

  test('counts A-B-A-B as one completed round trip plus a fresh outbound leg', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    let sequence = 0;
    const completeLeg = (
      goalId: string,
      fromLocationId: string,
      targetLocationId: string,
      sourceRevision: string,
    ) => {
      sequence += 1;
      audit.recordGoalCreated(
        goal(sequence, goalId, {
          cadenceKey: `cadence:${goalId}`,
          purposeIntentDigest: `stable64:${goalId}`,
          sourceRevision,
          sourceStateDigest: `stable64:state:${goalId}`,
          targetLocationId,
        }),
      );
      sequence += 1;
      const actionId = `action:${goalId}`;
      audit.recordActionSelected(
        travel(sequence, goalId, {
          actionId,
          purposeIntentDigest: `stable64:${goalId}`,
          sourceRevision,
          fromLocationId,
          targetLocationId,
        }),
      );
      sequence += 1;
      audit.recordActionTerminal({
        sequence,
        gameHour: sequence / 10,
        actorId,
        actionId,
        status: 'arrived',
        finalLocationId: targetLocationId,
      });
      sequence += 1;
      audit.recordGoalTerminal({
        sequence,
        gameHour: sequence / 10,
        actorId,
        goalId,
        status: 'failed',
        reasonCode: 'purpose_goal_source_revision_stale',
      });
    };

    completeLeg('goal:ab:1', 'A', 'B', 'resource:rev:1');
    sequence += 1;
    audit.recordCausalChange({
      sequence,
      gameHour: sequence / 10,
      actorId,
      kind: 'resource',
      sourceEventId: 'event:between-a-b-a',
      sourceRef: 'resource:herb_patch',
      beforeDigest: 'stable64:before',
      afterDigest: 'stable64:after',
    });
    completeLeg('goal:ba:1', 'B', 'A', 'resource:rev:2');
    completeLeg('goal:ab:2', 'A', 'B', 'resource:rev:3');

    const result = audit.finish();
    expect(result.roundTrips).toEqual({
      detected: 1,
      explainedByCausalChange: 1,
      unexplained: 0,
    });
    expect(result.releaseStatus).toBe('pass');
  });

  test('rejects duplicate semantic goals only when the authoritative source snapshot is unchanged', () => {
    const duplicate = createPurposeBehaviorReleaseAudit();
    duplicate.recordGoalCreated(goal(1, 'goal:1'));
    duplicate.recordGoalTerminal({
      sequence: 2,
      gameHour: 0.2,
      actorId,
      goalId: 'goal:1',
      status: 'completed',
      reasonCode: 'purpose_goal_completed',
    });
    duplicate.recordGoalCreated(goal(3, 'goal:2'));
    expect(duplicate.finish().violations.duplicate_goal_without_source_change).toBe(1);

    const changed = createPurposeBehaviorReleaseAudit();
    changed.recordGoalCreated(goal(1, 'goal:1'));
    changed.recordGoalTerminal({
      sequence: 2,
      gameHour: 0.2,
      actorId,
      goalId: 'goal:1',
      status: 'completed',
      reasonCode: 'purpose_goal_completed',
    });
    changed.recordGoalCreated(
      goal(3, 'goal:2', {
        sourceRevision: 'resource:rev:2',
        sourceStateDigest: 'stable64:source-after',
      }),
    );
    expect(changed.finish().violations.duplicate_goal_without_source_change).toBe(0);
  });

  test('rejects any new action bound to a terminal goal', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    audit.recordGoalCreated(goal(1));
    audit.recordGoalTerminal({
      sequence: 2,
      gameHour: 0.2,
      actorId,
      goalId: 'goal:gather',
      status: 'completed',
      reasonCode: 'purpose_goal_completed',
    });
    audit.recordActionSelected({
      sequence: 3,
      gameHour: 0.3,
      actorId,
      actionId: 'action:after-terminal',
      actionType: 'gather',
      goalId: 'goal:gather',
    });
    expect(audit.finish().violations.terminal_goal_continued).toBe(1);
  });

  test('keeps intentional idle legal and never gates on action proportions', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    let sequence = 0;
    for (let index = 0; index < 50; index += 1) {
      sequence += 1;
      audit.recordActionSelected({
        sequence,
        gameHour: sequence / 10,
        actorId,
        actionId: `action:cultivate:${index}`,
        actionType: 'cultivate',
      });
      sequence += 1;
      audit.recordActionTerminal({
        sequence,
        gameHour: sequence / 10,
        actorId,
        actionId: `action:cultivate:${index}`,
        status: 'completed',
      });
    }
    sequence += 1;
    audit.recordIntentionalIdle({
      sequence,
      gameHour: sequence / 10,
      actorId,
      reasonCode: 'on_watch',
    });
    const result = audit.finish();
    expect(result.releaseStatus).toBe('pass');
    expect(result.actions.byType).toEqual({ cultivate: 50 });
    expect(result.intentionalIdle).toEqual({ total: 1, byReason: { on_watch: 1 } });
  });

  test('lets a sourced duty arrival finish through the next intentional idle observation', () => {
    const audit = createPurposeBehaviorReleaseAudit();
    audit.recordGoalCreated(
      goal(1, 'goal:duty', {
        cadenceKey: 'cadence:duty',
        purposeIntentDigest: 'stable64:intent-duty',
        sourceRef: `duty:${actorId}`,
        sourceRevision: 'duty:rev:1',
        sourceStateDigest: 'stable64:duty-away',
        targetLocationId: 'mountain_gate',
        intendedActivity: 'intentional_idle',
        completionConditionDigest: 'stable64:duty-confirmed',
      }),
    );
    audit.recordActionSelected(
      travel(2, 'goal:duty', {
        actionId: 'action:duty:return',
        purposeIntentDigest: 'stable64:intent-duty',
        sourceRef: `duty:${actorId}`,
        sourceRevision: 'duty:rev:1',
        intendedActivity: 'intentional_idle',
        fromLocationId: 'market',
        targetLocationId: 'mountain_gate',
      }),
    );
    audit.recordActionTerminal({
      sequence: 3,
      gameHour: 0.3,
      actorId,
      actionId: 'action:duty:return',
      status: 'arrived',
      finalLocationId: 'mountain_gate',
    });
    audit.recordIntentionalIdle({
      sequence: 4,
      gameHour: 0.4,
      actorId,
      goalId: 'goal:duty',
      sourceRef: `duty:${actorId}`,
      reasonCode: 'on_watch',
    });
    audit.recordGoalTerminal({
      sequence: 5,
      gameHour: 0.5,
      actorId,
      goalId: 'goal:duty',
      status: 'completed',
      reasonCode: 'purpose_goal_duty_state_confirmed',
    });
    const result = audit.finish();
    expect(result.releaseStatus).toBe('pass');
    expect(result.followThrough).toMatchObject({ expected: 1, completed: 1, unresolved: 0 });
    expect(result.intentionalIdle).toEqual({ total: 1, byReason: { on_watch: 1 } });
  });

  test('fails closed on duplicate terminals and regressed event order', () => {
    const duplicate = createPurposeBehaviorReleaseAudit();
    duplicate.recordActionSelected({
      sequence: 1,
      gameHour: 1,
      actorId,
      actionId: 'action:one-shot',
      actionType: 'cultivate',
    });
    duplicate.recordActionTerminal({
      sequence: 2,
      gameHour: 2,
      actorId,
      actionId: 'action:one-shot',
      status: 'completed',
    });
    duplicate.recordActionTerminal({
      sequence: 3,
      gameHour: 3,
      actorId,
      actionId: 'action:one-shot',
      status: 'completed',
    });
    expect(duplicate.finish().violations.audit_integrity_violation).toBe(1);

    const regressed = createPurposeBehaviorReleaseAudit();
    regressed.recordIntentionalIdle({
      sequence: 2,
      gameHour: 2,
      actorId,
      reasonCode: 'on_watch',
    });
    regressed.recordIntentionalIdle({
      sequence: 1,
      gameHour: 1,
      actorId,
      reasonCode: 'on_watch',
    });
    expect(regressed.finish().violations.audit_integrity_violation).toBe(1);
  });

  test('is byte-stable under an exact replay and immutable after finish', () => {
    const firstAudit = recordCompletedGatherChain();
    const secondAudit = recordCompletedGatherChain();
    const first = firstAudit.finish();
    expect(secondAudit.finish()).toEqual(first);
    expect(first.traceDigest).toMatch(/^stable64:[0-9a-f]{16}$/);
    expect(firstAudit.finish()).toBe(first);
    expect(() =>
      firstAudit.recordIntentionalIdle({
        sequence: 8,
        gameHour: 0.8,
        actorId,
        reasonCode: 'on_watch',
      }),
    ).toThrow('purpose_behavior_release_audit_already_finalized');
  });
});
