export const TRADE_PAIR_COOLDOWN_GAME_HOURS = 1;
export const TRADE_DAILY_LIMIT = 8;

export type TradeCooldownResult =
  | { ok: true }
  | {
      ok: false;
      resultCode: 'trade_hourly_cooldown' | 'trade_daily_limit';
      reason: string;
    };

/**
 * Only completed trade attempts enter this policy. Successful settlements and
 * interpersonal refusals count; invalid, blocked and interrupted executions do not.
 */
export function evaluateTradeActionCooldown(
  currentGameHour: number,
  completedAttemptGameHours: number[],
): TradeCooldownResult {
  const hour = Math.max(0, Math.floor(currentGameHour));
  const completed = completedAttemptGameHours
    .filter(Number.isFinite)
    .map((candidate) => Math.max(0, Math.floor(candidate)));
  if (
    completed.some(
      (candidate) =>
        candidate <= hour && hour - candidate < TRADE_PAIR_COOLDOWN_GAME_HOURS,
    )
  ) {
    return {
      ok: false,
      resultCode: 'trade_hourly_cooldown',
      reason: '刚刚已经与对方完成过一笔交易尝试，请至少间隔一个游戏小时。',
    };
  }
  const day = Math.floor(hour / 24);
  if (completed.filter((candidate) => Math.floor(candidate / 24) === day).length >= TRADE_DAILY_LIMIT) {
    return {
      ok: false,
      resultCode: 'trade_daily_limit',
      reason: `今日已经与对方完成 ${TRADE_DAILY_LIMIT} 次交易尝试，请明日再来。`,
    };
  }
  return { ok: true };
}

export function parseTradeQuantity(value: unknown, fallback = 1): number | null {
  const resolved = value === undefined ? fallback : Number(value);
  return Number.isInteger(resolved) && resolved >= 1 && resolved <= 99 ? resolved : null;
}

export function unreservedTradeQuantity(
  inventory: { itemId: string; qty: number }[] | undefined,
  itemId: string,
  reservedQuantity: number,
) {
  const owned = inventory?.find((item) => item.itemId === itemId)?.qty ?? 0;
  return Math.max(0, owned - Math.max(0, Math.floor(reservedQuantity)));
}
