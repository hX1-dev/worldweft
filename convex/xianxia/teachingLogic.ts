export const TEACHING_EXECUTION_TOPIC = 'cultivation_fundamentals' as const;
export type TeachingTopic = typeof TEACHING_EXECUTION_TOPIC;

export const TEACHING_GLOBAL_COOLDOWN_DAYS = 1;
export const TEACHING_PAIR_COOLDOWN_DAYS = 7;

export type TeachingUsage = {
  targetActorId: string;
  sourceGameDay: number;
};

export type TeachingCooldownResult =
  | { ok: true }
  | {
      ok: false;
      resultCode: 'teaching_daily_cooldown' | 'teaching_pair_cooldown';
      reason: string;
    };

export function parseTeachingTopic(value: unknown): TeachingTopic | null {
  if (value === undefined || value === null || value === '') return TEACHING_EXECUTION_TOPIC;
  return value === TEACHING_EXECUTION_TOPIC ? value : null;
}

export function evaluateTeachingActionCooldown(
  currentGameDay: number,
  targetActorId: string,
  usages: TeachingUsage[],
): TeachingCooldownResult {
  const completedDays = usages
    .filter((usage) => Number.isFinite(usage.sourceGameDay) && usage.sourceGameDay <= currentGameDay)
    .map((usage) => Math.floor(usage.sourceGameDay));
  if (completedDays.some((day) => currentGameDay - day < TEACHING_GLOBAL_COOLDOWN_DAYS)) {
    return {
      ok: false,
      resultCode: 'teaching_daily_cooldown',
      reason: '今日已经完成过一次求教，应留出时间消化所得。',
    };
  }
  if (
    usages.some(
      (usage) =>
        usage.targetActorId === targetActorId &&
        usage.sourceGameDay <= currentGameDay &&
        currentGameDay - usage.sourceGameDay < TEACHING_PAIR_COOLDOWN_DAYS,
    )
  ) {
    return {
      ok: false,
      resultCode: 'teaching_pair_cooldown',
      reason: '这位师者近日已经指点过你，应先自行体悟七日。',
    };
  }
  return { ok: true };
}
