import { describe, expect, it } from '@jest/globals';
import {
  evaluateGiftActionCooldown,
  GIFT_ROLLING_LIMIT,
  GIFT_ROLLING_WINDOW_DAYS,
  unreservedGiftQuantity,
} from './giftLogic';

describe('gift action cooldown', () => {
  it('allows a first directional attempt and blocks a second on the same game day', () => {
    expect(evaluateGiftActionCooldown(10, [])).toEqual({ ok: true });
    expect(evaluateGiftActionCooldown(10, [10])).toMatchObject({
      ok: false,
      resultCode: 'gift_daily_cooldown',
    });
  });

  it('blocks the third completed attempt in a rolling seven-day window', () => {
    expect(GIFT_ROLLING_LIMIT).toBe(2);
    expect(GIFT_ROLLING_WINDOW_DAYS).toBe(7);
    expect(evaluateGiftActionCooldown(10, [4, 8])).toMatchObject({
      ok: false,
      resultCode: 'gift_weekly_cooldown',
    });
    expect(evaluateGiftActionCooldown(11, [4, 8])).toEqual({ ok: true });
  });

  it('does not count future data and keeps opposite direction independent upstream', () => {
    expect(evaluateGiftActionCooldown(5, [6, 7])).toEqual({ ok: true });
  });
});

describe('gift inventory reservation', () => {
  it('only exposes quantities not reserved by active executions', () => {
    const inventory = [{ itemId: 'spirit_stone', qty: 2 }];
    expect(unreservedGiftQuantity(inventory, 'spirit_stone', 0)).toBe(2);
    expect(unreservedGiftQuantity(inventory, 'spirit_stone', 1)).toBe(1);
    expect(unreservedGiftQuantity(inventory, 'spirit_stone', 2)).toBe(0);
    expect(unreservedGiftQuantity(inventory, 'missing', 0)).toBe(0);
  });
});
