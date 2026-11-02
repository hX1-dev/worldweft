import {
  resolveActorMaxHealth,
  INCAPACITATED_RECOVERY_DELAY_MS,
  evaluateLifeActionGate,
  evaluateTargetLifeGate,
  lifeStateForHealth,
  needsIncapacitationRecoveryEnrollment,
  resolveHealthTransition,
} from './lifeStateLogic';

describe('resolveActorMaxHealth', () => {
  test('uses the world default for an injured legacy profile', () => {
    expect(resolveActorMaxHealth({ health: 8 })).toBe(10);
  });

  test('never resolves below durable or current health', () => {
    expect(resolveActorMaxHealth({ health: 8, maxHealth: 14 })).toBe(14);
    expect(resolveActorMaxHealth({ health: 12 })).toBe(12);
  });
});

describe('life state policy', () => {
  test('derives state from health as the single source of truth', () => {
    expect(lifeStateForHealth(10)).toBe('healthy');
    expect(lifeStateForHealth(8, 8)).toBe('healthy');
    expect(lifeStateForHealth(7, 8)).toBe('injured');
    expect(lifeStateForHealth(1)).toBe('injured');
    expect(lifeStateForHealth(0)).toBe('incapacitated');
    expect(lifeStateForHealth(-5)).toBe('incapacitated');
  });

  test('enrolls only legacy or incomplete zero-health profiles for recovery', () => {
    expect(needsIncapacitationRecoveryEnrollment({ health: 0 })).toBe(true);
    expect(
      needsIncapacitationRecoveryEnrollment({
        health: 0,
        incapacitatedAt: 1_000,
        recoveryEligibleAt: 2_000,
        recoveryToken: 'event-a',
      }),
    ).toBe(false);
    expect(
      needsIncapacitationRecoveryEnrollment({
        health: 0,
        incapacitatedAt: 1_000,
        recoveryToken: 'event-a',
      }),
    ).toBe(true);
    expect(needsIncapacitationRecoveryEnrollment({ health: 1 })).toBe(false);
    expect(
      needsIncapacitationRecoveryEnrollment({ health: 0, lifeStatus: 'deceased' }),
    ).toBe(false);
  });

  test('blocks every action and recovery after irreversible death', () => {
    expect(
      evaluateLifeActionGate({
        health: 10,
        lifeStatus: 'deceased',
        actionType: 'cultivate',
        source: 'agent',
        now: 1_000,
      }),
    ).toMatchObject({ ok: false, resultCode: 'actor_deceased' });
    expect(
      evaluateLifeActionGate({
        health: 0,
        lifeStatus: 'deceased',
        actionType: 'recover',
        source: 'system',
        now: 1_000,
      }),
    ).toMatchObject({ ok: false, resultCode: 'actor_deceased' });
  });

  test.each([
    'cultivate',
    'gather',
    'rest',
    'talk',
    'trade',
    'gift',
    'request_teaching',
    'spar',
    'explore',
    'steal',
    'breakthrough',
    'use_item',
    'travel',
    'arrive',
  ])('blocks ordinary action %s at zero health', (actionType) => {
    expect(
      evaluateLifeActionGate({ health: 0, actionType, source: 'human', now: 1_000 }),
    ).toMatchObject({ ok: false, resultCode: 'actor_incapacitated' });
  });

  test('requires a system source, matching token and elapsed recovery time', () => {
    const base = {
      health: 0,
      actionType: 'recover',
      now: 10_000,
      recoveryEligibleAt: 10_000,
      recoveryToken: 'incap-event',
      requestedRecoveryToken: 'incap-event',
    };
    expect(evaluateLifeActionGate({ ...base, source: 'human' })).toMatchObject({
      ok: false,
      resultCode: 'recovery_source_forbidden',
    });
    expect(
      evaluateLifeActionGate({
        ...base,
        source: 'system',
        requestedRecoveryToken: 'old-event',
      }),
    ).toMatchObject({ ok: false, resultCode: 'stale_recovery' });
    expect(
      evaluateLifeActionGate({
        ...base,
        source: 'system',
        now: base.recoveryEligibleAt - 1,
      }),
    ).toMatchObject({ ok: false, resultCode: 'recovery_not_ready' });
    expect(evaluateLifeActionGate({ ...base, source: 'system' })).toEqual({ ok: true });
  });

  test.each(['talk', 'trade', 'gift', 'request_teaching', 'spar', 'steal'])(
    'blocks incapacitated target participation for %s',
    (actionType) => {
      expect(evaluateTargetLifeGate({ health: 0, actionType, targetName: '柳巧儿' })).toMatchObject(
        {
          ok: false,
          resultCode: 'target_incapacitated',
        },
      );
    },
  );

  test('does not apply target participation rules to unrelated system actions', () => {
    expect(evaluateTargetLifeGate({ health: 0, actionType: 'recover' })).toEqual({
      ok: true,
    });
  });

  test('blocks a deceased interaction target before considering health', () => {
    expect(
      evaluateTargetLifeGate({
        health: 10,
        lifeStatus: 'deceased',
        actionType: 'talk',
        targetName: '故人',
      }),
    ).toMatchObject({ ok: false, resultCode: 'target_deceased' });
  });

  test('enters incapacitation once and does not reset it while already at zero', () => {
    const entered = resolveHealthTransition({
      currentHealth: 1,
      maxHealth: 8,
      delta: -3,
      now: 5_000,
      recoveryToken: 'event-a',
    });
    expect(entered).toMatchObject({
      previousHealth: 1,
      nextHealth: 0,
      enteredIncapacitation: true,
      recoveredFromIncapacitation: false,
      incapacitatedAt: 5_000,
      recoveryEligibleAt: 5_000 + INCAPACITATED_RECOVERY_DELAY_MS,
      recoveryToken: 'event-a',
    });

    expect(
      resolveHealthTransition({
        currentHealth: 0,
        maxHealth: 8,
        delta: -3,
        now: 9_000,
        recoveryToken: 'event-b',
      }),
    ).toMatchObject({
      previousHealth: 0,
      nextHealth: 0,
      enteredIncapacitation: false,
      recoveredFromIncapacitation: false,
      recoveryEligibleAt: undefined,
      recoveryToken: undefined,
    });
  });

  test('natural recovery only restores the minimum actionable health', () => {
    expect(
      resolveHealthTransition({
        currentHealth: 0,
        maxHealth: 8,
        delta: 1,
        now: 20_000,
        recoveryToken: 'event-a',
      }),
    ).toMatchObject({
      previousHealth: 0,
      nextHealth: 1,
      enteredIncapacitation: false,
      recoveredFromIncapacitation: true,
    });
  });
});
