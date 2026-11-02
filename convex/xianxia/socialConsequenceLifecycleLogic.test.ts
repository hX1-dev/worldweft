import {
  MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK,
  planSocialConsequenceLifecycle,
  type SocialConsequenceLifecycleFact,
} from './socialConsequenceLifecycleLogic';

describe('LWSE-2c social consequence lifecycle', () => {
  test('keeps the owner active before expiry and invalidates it at the exact boundary', () => {
    expect(planSocialConsequenceLifecycle({
      gameHour: 71,
      consequences: [fact({ expiresGameHour: 72 })],
    }).transitions).toEqual([]);
    expect(planSocialConsequenceLifecycle({
      gameHour: 72,
      consequences: [fact({ expiresGameHour: 72 })],
    }).transitions).toEqual([{
      consequenceId: 'consequence:a',
      previousRevision: 1,
      revision: 2,
      previousProjectionBudget: 1,
      remainingProjectionBudget: 0,
      status: 'expired',
      terminalGameHour: 72,
      terminalReasonCode: 'social_consequence_expired',
    }]);
  });

  test('expires budget-zero evidence without pretending it was fulfilled', () => {
    const plan = planSocialConsequenceLifecycle({
      gameHour: 90,
      consequences: [fact({ remainingProjectionBudget: 0, expiresGameHour: 80 })],
    });
    expect(plan.transitions[0]).toMatchObject({
      status: 'expired', previousProjectionBudget: 0, remainingProjectionBudget: 0,
      terminalGameHour: 80,
    });
  });

  test('terminal owners and clock rewind are no-ops', () => {
    const expired = fact({
      status: 'expired', remainingProjectionBudget: 0, expiresGameHour: 72,
      terminalGameHour: 72, terminalReasonCode: 'social_consequence_expired',
    });
    expect(planSocialConsequenceLifecycle({ gameHour: 999, consequences: [expired] }))
      .toMatchObject({ transitions: [], remainingDue: 0, caughtUp: true });
    expect(planSocialConsequenceLifecycle({ gameHour: 12, consequences: [fact()] }).transitions)
      .toEqual([]);
  });

  test('uses deterministic expiry/id ordering independent of input order', () => {
    const input = [
      fact({ consequenceId: 'consequence:c', expiresGameHour: 5 }),
      fact({ consequenceId: 'consequence:b', expiresGameHour: 4 }),
      fact({ consequenceId: 'consequence:a', expiresGameHour: 4 }),
    ];
    const forward = planSocialConsequenceLifecycle({ gameHour: 5, consequences: input });
    const reverse = planSocialConsequenceLifecycle({ gameHour: 5, consequences: [...input].reverse() });
    expect(forward.transitions.map((entry) => entry.consequenceId))
      .toEqual(['consequence:a', 'consequence:b', 'consequence:c']);
    expect(reverse.transitionDigest).toBe(forward.transitionDigest);
  });

  test('processes at most 32 due rows and reports catch-up debt', () => {
    const consequences = Array.from({ length: 33 }, (_, index) => fact({
      consequenceId: `consequence:${String(index).padStart(2, '0')}`,
      expiresGameHour: 1,
    }));
    const plan = planSocialConsequenceLifecycle({ gameHour: 2, consequences });
    expect(plan.transitions).toHaveLength(MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK);
    expect(plan.remainingDue).toBe(1);
    expect(plan.caughtUp).toBe(false);
  });

  test.each([
    ['invalid game hour', { gameHour: -1, consequences: [fact()] }],
    ['duplicate identity', { gameHour: 72, consequences: [fact(), fact()] }],
    ['active terminal metadata', {
      gameHour: 72,
      consequences: [fact({ terminalGameHour: 72, terminalReasonCode: 'social_consequence_expired' })],
    }],
    ['expired missing terminal metadata', {
      gameHour: 72,
      consequences: [fact({ status: 'expired', remainingProjectionBudget: 0 })],
    }],
    ['expired wrong terminal time', {
      gameHour: 72,
      consequences: [fact({
        status: 'expired', remainingProjectionBudget: 0,
        terminalGameHour: 71, terminalReasonCode: 'social_consequence_expired',
      })],
    }],
  ])('fails closed for %s', (_label, input) => {
    expect(() => planSocialConsequenceLifecycle(input as Parameters<
      typeof planSocialConsequenceLifecycle
    >[0])).toThrow(/social_consequence_lifecycle_/);
  });
});

function fact(
  patch: Partial<SocialConsequenceLifecycleFact> = {},
): SocialConsequenceLifecycleFact {
  return {
    consequenceId: 'consequence:a',
    revision: 1,
    status: 'active',
    remainingProjectionBudget: 1,
    expiresGameHour: 72,
    ...patch,
  };
}
