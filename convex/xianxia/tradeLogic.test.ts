import {
  TRADE_DAILY_LIMIT,
  evaluateTradeActionCooldown,
  parseTradeQuantity,
  unreservedTradeQuantity,
} from './tradeLogic';

describe('C016e3b trade cooldown', () => {
  it('requires one full game hour between completed attempts', () => {
    expect(evaluateTradeActionCooldown(100, [100])).toMatchObject({
      ok: false,
      resultCode: 'trade_hourly_cooldown',
    });
    expect(evaluateTradeActionCooldown(101, [100])).toEqual({ ok: true });
  });

  it('caps a directed pair at eight completed attempts per game day', () => {
    const sameDay = Array.from({ length: TRADE_DAILY_LIMIT }, (_, index) => 24 * 9 + index);
    expect(evaluateTradeActionCooldown(24 * 9 + 20, sameDay)).toMatchObject({
      ok: false,
      resultCode: 'trade_daily_limit',
    });
    expect(evaluateTradeActionCooldown(24 * 10, sameDay)).toEqual({ ok: true });
  });

  it('does not let future or malformed usage rows block the present', () => {
    expect(evaluateTradeActionCooldown(50, [Number.NaN, 51])).toEqual({ ok: true });
  });
});

describe('C016e3b quantities and reservations', () => {
  it('accepts only exact 1..99 quantities and defaults omitted quantities to one', () => {
    expect(parseTradeQuantity(undefined)).toBe(1);
    expect(parseTradeQuantity('2')).toBe(2);
    expect(parseTradeQuantity(0)).toBeNull();
    expect(parseTradeQuantity(1.5)).toBeNull();
    expect(parseTradeQuantity(100)).toBeNull();
  });

  it('subtracts active reservations from an actor inventory', () => {
    expect(unreservedTradeQuantity([{ itemId: 'spirit_herb', qty: 3 }], 'spirit_herb', 2)).toBe(1);
  });
});
