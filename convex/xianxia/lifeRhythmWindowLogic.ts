import { stableObservationDigest } from './lifeObservation';

export const LIFE_RHYTHM_WINDOW_VERSION = 'taixu.life-rhythm-window.v1' as const;
export const GAME_HOURS_PER_LIFE_RHYTHM_DAY = 24;
export const GAME_HOURS_PER_LIFE_RHYTHM_WEEK = 7 * GAME_HOURS_PER_LIFE_RHYTHM_DAY;
export const MAX_LIFE_RHYTHM_WINDOWS_PER_TICK = 8;

export const LIFE_RHYTHM_CADENCES = ['daily', 'weekly'] as const;
export type LifeRhythmCadence = (typeof LIFE_RHYTHM_CADENCES)[number];

export type LifeRhythmWindowTransition = {
  windowId: string;
  cadence: LifeRhythmCadence;
  periodIndex: number;
  windowStartGameHour: number;
  windowEndGameHour: number;
  clockStartedAt: number;
  status: 'closed';
  providerCalls: 0;
  createdWorldActions: 0;
  createdSocialCandidates: 0;
  windowDigest: string;
};

export type LifeRhythmWindowPlan = {
  contractVersion: typeof LIFE_RHYTHM_WINDOW_VERSION;
  totalGameHours: number;
  targetDayIndex: number;
  targetWeekIndex: number;
  previousAppliedDayIndex: number;
  previousAppliedWeekIndex: number;
  nextAppliedDayIndex: number;
  nextAppliedWeekIndex: number;
  transitions: LifeRhythmWindowTransition[];
  remainingWindows: number;
  caughtUp: boolean;
  planDigest: string;
};

/**
 * Turns the authoritative scene clock into bounded, durable review-window
 * occurrences. This plans time ownership only; it cannot create plans,
 * candidates, actions, memories, relationships, or provider work.
 */
export function planLifeRhythmWindows(input: {
  totalGameHours: number;
  clockStartedAt: number;
  appliedDayIndex: number;
  appliedWeekIndex: number;
  limit?: number;
}): LifeRhythmWindowPlan {
  const totalGameHours = assertNonNegativeSafeInteger(input.totalGameHours, 'life_rhythm_invalid_time');
  const clockStartedAt = assertNonNegativeSafeInteger(input.clockStartedAt, 'life_rhythm_invalid_time');
  const appliedDayIndex = assertNonNegativeSafeInteger(input.appliedDayIndex, 'life_rhythm_invalid_cursor');
  const appliedWeekIndex = assertNonNegativeSafeInteger(input.appliedWeekIndex, 'life_rhythm_invalid_cursor');
  const limit = input.limit ?? MAX_LIFE_RHYTHM_WINDOWS_PER_TICK;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIFE_RHYTHM_WINDOWS_PER_TICK) {
    throw new Error('life_rhythm_invalid_limit');
  }

  const targetDayIndex = Math.floor(totalGameHours / GAME_HOURS_PER_LIFE_RHYTHM_DAY);
  const targetWeekIndex = Math.floor(totalGameHours / GAME_HOURS_PER_LIFE_RHYTHM_WEEK);
  const due = [
    ...periodRange(appliedDayIndex, targetDayIndex).map((periodIndex) =>
      buildLifeRhythmWindow('daily', periodIndex, clockStartedAt)),
    ...periodRange(appliedWeekIndex, targetWeekIndex).map((periodIndex) =>
      buildLifeRhythmWindow('weekly', periodIndex, clockStartedAt)),
  ].sort(compareLifeRhythmWindows);
  const transitions = due.slice(0, limit);
  let nextAppliedDayIndex = appliedDayIndex;
  let nextAppliedWeekIndex = appliedWeekIndex;
  for (const transition of transitions) {
    if (transition.cadence === 'daily') nextAppliedDayIndex = transition.periodIndex;
    else nextAppliedWeekIndex = transition.periodIndex;
  }
  const remainingWindows = due.length - transitions.length;
  const semantic = {
    contractVersion: LIFE_RHYTHM_WINDOW_VERSION,
    totalGameHours,
    targetDayIndex,
    targetWeekIndex,
    previousAppliedDayIndex: appliedDayIndex,
    previousAppliedWeekIndex: appliedWeekIndex,
    nextAppliedDayIndex,
    nextAppliedWeekIndex,
    transitions,
    remainingWindows,
    caughtUp: remainingWindows === 0,
  };
  return { ...semantic, planDigest: stableObservationDigest(semantic) };
}

export function buildLifeRhythmWindow(
  cadence: LifeRhythmCadence,
  periodIndex: number,
  clockStartedAt: number,
): LifeRhythmWindowTransition {
  if (!LIFE_RHYTHM_CADENCES.includes(cadence)) throw new Error('life_rhythm_invalid_cadence');
  if (!Number.isSafeInteger(periodIndex) || periodIndex < 1) {
    throw new Error('life_rhythm_invalid_cursor');
  }
  assertNonNegativeSafeInteger(clockStartedAt, 'life_rhythm_invalid_time');
  const duration = cadence === 'daily'
    ? GAME_HOURS_PER_LIFE_RHYTHM_DAY
    : GAME_HOURS_PER_LIFE_RHYTHM_WEEK;
  const semantic = {
    windowId: `life-rhythm:${cadence}:${periodIndex}`,
    cadence,
    periodIndex,
    windowStartGameHour: (periodIndex - 1) * duration,
    windowEndGameHour: periodIndex * duration,
    clockStartedAt,
    status: 'closed' as const,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdSocialCandidates: 0 as const,
  };
  return { ...semantic, windowDigest: stableObservationDigest(semantic) };
}

export function sameLifeRhythmWindow(
  left: LifeRhythmWindowTransition,
  right: LifeRhythmWindowTransition,
) {
  return left.windowId === right.windowId && left.cadence === right.cadence &&
    left.periodIndex === right.periodIndex &&
    left.windowStartGameHour === right.windowStartGameHour &&
    left.windowEndGameHour === right.windowEndGameHour &&
    left.clockStartedAt === right.clockStartedAt && left.status === right.status &&
    left.providerCalls === right.providerCalls &&
    left.createdWorldActions === right.createdWorldActions &&
    left.createdSocialCandidates === right.createdSocialCandidates &&
    left.windowDigest === right.windowDigest;
}

function periodRange(appliedIndex: number, targetIndex: number) {
  if (targetIndex <= appliedIndex) return [];
  return Array.from({ length: targetIndex - appliedIndex }, (_, offset) => appliedIndex + offset + 1);
}

function compareLifeRhythmWindows(
  left: LifeRhythmWindowTransition,
  right: LifeRhythmWindowTransition,
) {
  return left.windowEndGameHour - right.windowEndGameHour ||
    cadenceOrder(left.cadence) - cadenceOrder(right.cadence) ||
    left.periodIndex - right.periodIndex;
}

function cadenceOrder(cadence: LifeRhythmCadence) {
  return cadence === 'daily' ? 0 : 1;
}

function assertNonNegativeSafeInteger(value: number, reasonCode: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(reasonCode);
  return value;
}
