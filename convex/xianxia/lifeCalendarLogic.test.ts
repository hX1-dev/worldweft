import {
  LIFE_CALENDAR_VERSION,
  LIFE_SEASONS,
  LIFE_YEARS_PER_REAL_DAY,
  MAX_SEASON_TRANSITIONS_PER_TICK,
  MS_PER_LIFE_SEASON,
  MS_PER_LIFE_YEAR,
  lifeCalendarAt,
  lifeSeasonEventActionId,
  planLifeSeasonTransitions,
} from './lifeCalendarLogic';

const T0 = 1_000_000_000_000;

describe('C019a authoritative life calendar', () => {
  test('keeps the frozen 2.5 life-years per real day scale independent of scene time', () => {
    expect(MS_PER_LIFE_YEAR).toBe((24 * 60 * 60 * 1_000) / LIFE_YEARS_PER_REAL_DAY);
    expect(MS_PER_LIFE_SEASON).toBe(MS_PER_LIFE_YEAR / 4);
    expect(lifeCalendarAt(T0 + 24 * 60 * 60 * 1_000, T0).elapsedLifeYears).toBe(2.5);
  });

  test('starts in year one spring and clamps observations before the anchor', () => {
    expect(lifeCalendarAt(T0, T0)).toMatchObject({
      contractVersion: LIFE_CALENDAR_VERSION,
      year: 1,
      season: 'spring',
      seasonIndex: 0,
      seasonProgress: 0,
    });
    expect(lifeCalendarAt(T0 - 999_999, T0)).toMatchObject({
      year: 1,
      season: 'spring',
      seasonIndex: 0,
      elapsedMs: 0,
    });
  });

  test.each([
    [0, 'spring', 1],
    [1, 'summer', 1],
    [2, 'autumn', 1],
    [3, 'winter', 1],
    [4, 'spring', 2],
    [7, 'winter', 2],
  ] as const)('maps absolute season %i to %s of year %i', (seasonIndex, season, year) => {
    const calendar = lifeCalendarAt(T0 + seasonIndex * MS_PER_LIFE_SEASON, T0);
    expect(calendar).toMatchObject({ seasonIndex, season, year });
    expect(calendar.seasonStartedAt).toBe(T0 + seasonIndex * MS_PER_LIFE_SEASON);
    expect(calendar.nextSeasonAt).toBe(T0 + (seasonIndex + 1) * MS_PER_LIFE_SEASON);
  });

  test('keeps the last instant of a season inside that season', () => {
    const endOfSpring = lifeCalendarAt(T0 + MS_PER_LIFE_SEASON - 1, T0);
    expect(endOfSpring.season).toBe('spring');
    expect(endOfSpring.seasonProgress).toBeGreaterThan(0.999);
  });

  test('plans deterministic, non-repeating boundary identities', () => {
    const plan = planLifeSeasonTransitions({
      nowMs: T0 + 4 * MS_PER_LIFE_SEASON,
      startedAtMs: T0,
      appliedSeasonIndex: 0,
    });
    expect(plan.transitions.map((transition) => transition.eventActionId)).toEqual([
      'life-calendar:season:1',
      'life-calendar:season:2',
      'life-calendar:season:3',
      'life-calendar:season:4',
    ]);
    expect(plan.transitions.at(-1)).toMatchObject({
      year: 2,
      fromSeason: 'winter',
      toSeason: 'spring',
      boundaryAt: T0 + 4 * MS_PER_LIFE_SEASON,
    });
    expect(new Set(plan.transitions.map((transition) => transition.eventActionId)).size).toBe(4);
  });

  test('replay and clock rollback are no-ops', () => {
    for (const nowMs of [
      T0 + 5 * MS_PER_LIFE_SEASON,
      T0 + 2 * MS_PER_LIFE_SEASON,
    ]) {
      expect(
        planLifeSeasonTransitions({
          nowMs,
          startedAtMs: T0,
          appliedSeasonIndex: 5,
        }),
      ).toMatchObject({ transitions: [], remainingTransitions: 0, caughtUp: true });
    }
  });

  test('bounds long offline catch-up and exposes remaining work', () => {
    const first = planLifeSeasonTransitions({
      nowMs: T0 + 20 * MS_PER_LIFE_SEASON,
      startedAtMs: T0,
      appliedSeasonIndex: 0,
    });
    expect(first.transitions).toHaveLength(MAX_SEASON_TRANSITIONS_PER_TICK);
    expect(first.remainingTransitions).toBe(4);
    expect(first.caughtUp).toBe(false);

    const second = planLifeSeasonTransitions({
      nowMs: T0 + 20 * MS_PER_LIFE_SEASON,
      startedAtMs: T0,
      appliedSeasonIndex: first.transitions.at(-1)!.seasonIndex,
    });
    expect(second.transitions).toHaveLength(4);
    expect(second.transitions[0].eventActionId).toBe('life-calendar:season:17');
    expect(second.remainingTransitions).toBe(0);
    expect(second.caughtUp).toBe(true);
  });

  test('rejects non-finite time, invalid cursor and invalid limits', () => {
    expect(() => lifeCalendarAt(Number.NaN, T0)).toThrow('life_calendar_invalid_time');
    expect(() =>
      planLifeSeasonTransitions({
        nowMs: T0,
        startedAtMs: T0,
        appliedSeasonIndex: -1,
      }),
    ).toThrow('life_calendar_invalid_cursor');
    expect(() => lifeSeasonEventActionId(1.5)).toThrow('life_calendar_invalid_cursor');
    expect(() =>
      planLifeSeasonTransitions({
        nowMs: T0,
        startedAtMs: T0,
        appliedSeasonIndex: 0,
        maxTransitions: LIFE_SEASONS.length - 4,
      }),
    ).toThrow('life_calendar_invalid_transition_limit');
  });
});
