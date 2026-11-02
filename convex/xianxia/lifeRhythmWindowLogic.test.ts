import {
  GAME_HOURS_PER_LIFE_RHYTHM_WEEK,
  LIFE_RHYTHM_WINDOW_VERSION,
  MAX_LIFE_RHYTHM_WINDOWS_PER_TICK,
  buildLifeRhythmWindow,
  planLifeRhythmWindows,
  sameLifeRhythmWindow,
} from './lifeRhythmWindowLogic';

const CLOCK = 1_800_000_000_000;

describe('LWSE-3a authoritative life rhythm windows', () => {
  test('closes the first daily window only at the exact 24-hour boundary', () => {
    expect(plan({ totalGameHours: 23 }).transitions).toEqual([]);
    expect(plan({ totalGameHours: 24 }).transitions).toEqual([
      expect.objectContaining({
        windowId: 'life-rhythm:daily:1', cadence: 'daily', periodIndex: 1,
        windowStartGameHour: 0, windowEndGameHour: 24,
        providerCalls: 0, createdWorldActions: 0, createdSocialCandidates: 0,
      }),
    ]);
  });

  test('closes seven days and one week at hour 168 with daily before weekly on the tie', () => {
    expect(plan({ totalGameHours: GAME_HOURS_PER_LIFE_RHYTHM_WEEK - 1 })
      .transitions.some((window) => window.cadence === 'weekly')).toBe(false);
    const atBoundary = plan({ totalGameHours: GAME_HOURS_PER_LIFE_RHYTHM_WEEK });
    expect(atBoundary.transitions).toHaveLength(8);
    expect(atBoundary.transitions.map((window) => window.windowId)).toEqual([
      'life-rhythm:daily:1', 'life-rhythm:daily:2', 'life-rhythm:daily:3',
      'life-rhythm:daily:4', 'life-rhythm:daily:5', 'life-rhythm:daily:6',
      'life-rhythm:daily:7', 'life-rhythm:weekly:1',
    ]);
    expect(atBoundary.caughtUp).toBe(true);
  });

  test('bounds long offline catch-up and resumes from exact independent cursors', () => {
    const first = plan({ totalGameHours: 15 * 24 });
    expect(first.transitions).toHaveLength(MAX_LIFE_RHYTHM_WINDOWS_PER_TICK);
    expect(first.remainingWindows).toBe(9);
    expect(first.caughtUp).toBe(false);
    const second = plan({
      totalGameHours: 15 * 24,
      appliedDayIndex: first.nextAppliedDayIndex,
      appliedWeekIndex: first.nextAppliedWeekIndex,
    });
    expect(second.transitions).toHaveLength(8);
    expect(second.transitions[0].windowId).toBe('life-rhythm:daily:8');
    expect(second.remainingWindows).toBe(1);
    const third = plan({
      totalGameHours: 15 * 24,
      appliedDayIndex: second.nextAppliedDayIndex,
      appliedWeekIndex: second.nextAppliedWeekIndex,
    });
    expect(third.transitions.map((window) => window.windowId)).toEqual([
      'life-rhythm:daily:15',
    ]);
    expect(third.caughtUp).toBe(true);
  });

  test('replay and clock rewind are no-ops without deleting durable cursors', () => {
    for (const totalGameHours of [10 * 24, 2 * 24]) {
      expect(plan({ totalGameHours, appliedDayIndex: 10, appliedWeekIndex: 1 }))
        .toMatchObject({ transitions: [], remainingWindows: 0, caughtUp: true,
          nextAppliedDayIndex: 10, nextAppliedWeekIndex: 1 });
    }
  });

  test('derives stable occurrence identities and digests from cadence, period and clock anchor', () => {
    const daily = buildLifeRhythmWindow('daily', 3, CLOCK);
    expect(daily).toMatchObject({
      windowId: 'life-rhythm:daily:3', windowStartGameHour: 48, windowEndGameHour: 72,
      clockStartedAt: CLOCK, status: 'closed',
    });
    expect(buildLifeRhythmWindow('daily', 3, CLOCK)).toEqual(daily);
    expect(buildLifeRhythmWindow('daily', 3, CLOCK + 1).windowDigest).not.toBe(daily.windowDigest);
    expect(sameLifeRhythmWindow(daily, { ...daily })).toBe(true);
    expect(LIFE_RHYTHM_WINDOW_VERSION).toBe('taixu.life-rhythm-window.v1');
  });

  test('keeps the plan digest deterministic for the same authoritative state', () => {
    expect(plan({ totalGameHours: 400 }).planDigest).toBe(plan({ totalGameHours: 400 }).planDigest);
  });

  test.each([
    ['negative time', { totalGameHours: -1 }],
    ['fractional time', { totalGameHours: 1.5 }],
    ['unsafe time', { totalGameHours: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative daily cursor', { appliedDayIndex: -1 }],
    ['fractional weekly cursor', { appliedWeekIndex: 1.5 }],
    ['zero limit', { limit: 0 }],
    ['unbounded limit', { limit: MAX_LIFE_RHYTHM_WINDOWS_PER_TICK + 1 }],
  ])('fails closed for %s', (_label, patch) => {
    expect(() => plan(patch)).toThrow(/life_rhythm_/);
  });
});

function plan(patch: Partial<Parameters<typeof planLifeRhythmWindows>[0]> = {}) {
  return planLifeRhythmWindows({
    totalGameHours: 0,
    clockStartedAt: CLOCK,
    appliedDayIndex: 0,
    appliedWeekIndex: 0,
    ...patch,
  });
}
