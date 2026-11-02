export const LIFE_CALENDAR_VERSION = 'taixu.life_calendar.v1' as const;

export const LIFE_YEARS_PER_REAL_DAY = 2.5;
export const SEASONS_PER_LIFE_YEAR = 4;
export const MS_PER_REAL_DAY = 24 * 60 * 60 * 1_000;
export const MS_PER_LIFE_YEAR = MS_PER_REAL_DAY / LIFE_YEARS_PER_REAL_DAY;
export const MS_PER_LIFE_SEASON = MS_PER_LIFE_YEAR / SEASONS_PER_LIFE_YEAR;
export const MAX_SEASON_TRANSITIONS_PER_TICK = 16;

export const LIFE_SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type LifeSeason = (typeof LIFE_SEASONS)[number];

export type LifeCalendar = {
  contractVersion: typeof LIFE_CALENDAR_VERSION;
  year: number;
  season: LifeSeason;
  seasonIndex: number;
  seasonOfYear: number;
  elapsedMs: number;
  elapsedLifeYears: number;
  seasonStartedAt: number;
  nextSeasonAt: number;
  seasonProgress: number;
};

export type LifeSeasonTransition = {
  eventActionId: string;
  seasonIndex: number;
  year: number;
  fromSeason: LifeSeason;
  toSeason: LifeSeason;
  boundaryAt: number;
};

export type LifeSeasonTransitionPlan = {
  targetSeasonIndex: number;
  appliedSeasonIndex: number;
  transitions: LifeSeasonTransition[];
  remainingTransitions: number;
  caughtUp: boolean;
};

export function lifeCalendarAt(nowMs: number, startedAtMs: number): LifeCalendar {
  assertFiniteTime(nowMs);
  assertFiniteTime(startedAtMs);
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  const seasonIndex = Math.floor(elapsedMs / MS_PER_LIFE_SEASON);
  const seasonOfYear = seasonIndex % SEASONS_PER_LIFE_YEAR;
  const elapsedInSeasonMs = elapsedMs - seasonIndex * MS_PER_LIFE_SEASON;

  return {
    contractVersion: LIFE_CALENDAR_VERSION,
    year: Math.floor(seasonIndex / SEASONS_PER_LIFE_YEAR) + 1,
    season: LIFE_SEASONS[seasonOfYear],
    seasonIndex,
    seasonOfYear,
    elapsedMs,
    elapsedLifeYears: elapsedMs / MS_PER_LIFE_YEAR,
    seasonStartedAt: startedAtMs + seasonIndex * MS_PER_LIFE_SEASON,
    nextSeasonAt: startedAtMs + (seasonIndex + 1) * MS_PER_LIFE_SEASON,
    seasonProgress: elapsedInSeasonMs / MS_PER_LIFE_SEASON,
  };
}

export function planLifeSeasonTransitions(args: {
  nowMs: number;
  startedAtMs: number;
  appliedSeasonIndex: number;
  maxTransitions?: number;
}): LifeSeasonTransitionPlan {
  const calendar = lifeCalendarAt(args.nowMs, args.startedAtMs);
  assertSeasonCursor(args.appliedSeasonIndex);
  const maxTransitions = args.maxTransitions ?? MAX_SEASON_TRANSITIONS_PER_TICK;
  if (!Number.isSafeInteger(maxTransitions) || maxTransitions < 1) {
    throw new Error('life_calendar_invalid_transition_limit');
  }

  const pendingTransitions = Math.max(0, calendar.seasonIndex - args.appliedSeasonIndex);
  const transitionCount = Math.min(pendingTransitions, maxTransitions);
  const transitions: LifeSeasonTransition[] = [];
  for (let offset = 1; offset <= transitionCount; offset += 1) {
    const seasonIndex = args.appliedSeasonIndex + offset;
    const seasonOfYear = seasonIndex % SEASONS_PER_LIFE_YEAR;
    transitions.push({
      eventActionId: lifeSeasonEventActionId(seasonIndex),
      seasonIndex,
      year: Math.floor(seasonIndex / SEASONS_PER_LIFE_YEAR) + 1,
      fromSeason: LIFE_SEASONS[(seasonIndex - 1) % SEASONS_PER_LIFE_YEAR],
      toSeason: LIFE_SEASONS[seasonOfYear],
      boundaryAt: args.startedAtMs + seasonIndex * MS_PER_LIFE_SEASON,
    });
  }

  const remainingTransitions = pendingTransitions - transitionCount;
  return {
    targetSeasonIndex: calendar.seasonIndex,
    appliedSeasonIndex: args.appliedSeasonIndex,
    transitions,
    remainingTransitions,
    caughtUp: remainingTransitions === 0,
  };
}

export function lifeSeasonEventActionId(seasonIndex: number): string {
  assertSeasonCursor(seasonIndex);
  return `life-calendar:season:${seasonIndex}`;
}

export function lifeSeasonLabel(season: LifeSeason): string {
  switch (season) {
    case 'spring':
      return '春';
    case 'summer':
      return '夏';
    case 'autumn':
      return '秋';
    case 'winter':
      return '冬';
  }
}

function assertFiniteTime(value: number): void {
  if (!Number.isFinite(value)) throw new Error('life_calendar_invalid_time');
}

function assertSeasonCursor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('life_calendar_invalid_cursor');
  }
}
