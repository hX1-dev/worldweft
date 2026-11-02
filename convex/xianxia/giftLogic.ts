export const GIFT_DAILY_LIMIT = 1;
export const GIFT_ROLLING_WINDOW_DAYS = 7;
export const GIFT_ROLLING_LIMIT = 2;

export type GiftCooldownResult =
  | { ok: true }
  | { ok: false; resultCode: 'gift_daily_cooldown' | 'gift_weekly_cooldown'; reason: string };

/**
 * Completed gift attempts are directional: actor -> target. Both an accepted gift
 * and an interpersonal refusal count, while invalid/interrupted executions never
 * create a usage row and therefore never enter this function.
 */
export function evaluateGiftActionCooldown(
  currentGameDay: number,
  completedAttemptGameDays: number[],
): GiftCooldownResult {
  const normalizedDay = Math.max(0, Math.floor(currentGameDay));
  const completed = completedAttemptGameDays
    .filter(Number.isFinite)
    .map((day) => Math.max(0, Math.floor(day)));
  if (completed.filter((day) => day === normalizedDay).length >= GIFT_DAILY_LIMIT) {
    return {
      ok: false,
      resultCode: 'gift_daily_cooldown',
      reason: '今日已经向对方完成过一次赠礼尝试，请改日再表达心意。',
    };
  }
  const windowStart = normalizedDay - (GIFT_ROLLING_WINDOW_DAYS - 1);
  const rollingCount = completed.filter(
    (day) => day >= windowStart && day <= normalizedDay,
  ).length;
  if (rollingCount >= GIFT_ROLLING_LIMIT) {
    return {
      ok: false,
      resultCode: 'gift_weekly_cooldown',
      reason: '近七日已经向对方赠礼两次，请给彼此一些从容相处的时间。',
    };
  }
  return { ok: true };
}

export function unreservedGiftQuantity(
  inventory: { itemId: string; qty: number }[] | undefined,
  itemId: string,
  reservedQuantity: number,
) {
  const owned = inventory?.find((item) => item.itemId === itemId)?.qty ?? 0;
  return Math.max(0, owned - Math.max(0, Math.floor(reservedQuantity)));
}
