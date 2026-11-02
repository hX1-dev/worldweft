import {
  availableResourceStock,
  consumeResourceStock,
  refreshResourceStock,
  resourceAccessAllowed,
  type ResourceStockState,
} from './resourceNodeLogic';

const depleted = (overrides: Partial<ResourceStockState> = {}): ResourceStockState => ({
  capacity: 3,
  stock: 0,
  refreshAmount: 1,
  refreshIntervalMs: 30_000,
  nextRefreshAt: 40_000,
  ...overrides,
});

describe('resource node stock and refresh', () => {
  test('does not replenish before the next absolute refresh time', () => {
    expect(refreshResourceStock(depleted(), 39_999)).toMatchObject({
      stock: 0,
      nextRefreshAt: 40_000,
      replenished: 0,
    });
  });

  test('replenishes one charge per elapsed interval and advances the schedule', () => {
    expect(refreshResourceStock(depleted(), 70_000)).toEqual({
      capacity: 3,
      stock: 2,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: 100_000,
      replenished: 2,
    });
  });

  test('long offline time never replenishes above capacity', () => {
    expect(refreshResourceStock(depleted(), 1_000_000)).toMatchObject({
      stock: 3,
      nextRefreshAt: undefined,
      replenished: 3,
    });
  });

  test('a full node has no pending refresh and repeated reads are stable', () => {
    const first = refreshResourceStock(depleted({ stock: 3, nextRefreshAt: 1 }), 99_000);
    const second = refreshResourceStock(first, 120_000);
    expect(first).toMatchObject({ stock: 3, nextRefreshAt: undefined, replenished: 0 });
    expect(second).toMatchObject({ stock: 3, nextRefreshAt: undefined, replenished: 0 });
  });

  test('consuming from a full node starts the refresh clock once', () => {
    const consumed = consumeResourceStock(depleted({ stock: 3, nextRefreshAt: undefined }), 1, 10_000);
    expect(consumed).toEqual({
      capacity: 3,
      stock: 2,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: 40_000,
    });
    expect(consumeResourceStock(consumed!, 1, 11_000)?.nextRefreshAt).toBe(40_000);
  });

  test('cannot consume more stock than exists', () => {
    expect(consumeResourceStock(depleted({ stock: 1 }), 2, 20_000)).toBeNull();
  });

  test('active miasma preserves stock and delays only future refresh', () => {
    expect(
      refreshResourceStock(
        depleted({
          stock: 1,
          nextRefreshAt: 40_000,
          refreshBlockedUntil: 100_000,
          refreshBlockedByPressureId: 'pressure:1',
        }),
        70_000,
      ),
    ).toEqual({
      capacity: 3,
      stock: 1,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: 100_000,
      refreshBlockedUntil: 100_000,
      refreshBlockedByPressureId: 'pressure:1',
      replenished: 0,
    });
  });

  test('consumption during pressure cannot restart refresh before pressure ends', () => {
    expect(
      consumeResourceStock(
        depleted({
          stock: 3,
          nextRefreshAt: undefined,
          refreshBlockedUntil: 100_000,
          refreshBlockedByPressureId: 'pressure:1',
        }),
        1,
        20_000,
      ),
    ).toEqual({
      capacity: 3,
      stock: 2,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: 100_000,
      refreshBlockedUntil: 100_000,
      refreshBlockedByPressureId: 'pressure:1',
    });
  });

  test('pressure and seasonal blockers compose without clearing each other', () => {
    const both = refreshResourceStock(
      depleted({
        nextRefreshAt: 40_000,
        refreshBlockedUntil: 80_000,
        refreshBlockedByPressureId: 'pressure:1',
        seasonalRefreshBlockedUntil: 100_000,
      }),
      70_000,
    );
    expect(both).toMatchObject({
      stock: 0,
      nextRefreshAt: 100_000,
      refreshBlockedUntil: 80_000,
      refreshBlockedByPressureId: 'pressure:1',
      seasonalRefreshBlockedUntil: 100_000,
      replenished: 0,
    });

    const pressureExpired = refreshResourceStock(both, 90_000);
    expect(pressureExpired).toMatchObject({
      stock: 0,
      nextRefreshAt: 100_000,
      seasonalRefreshBlockedUntil: 100_000,
      replenished: 0,
    });
    expect(pressureExpired.refreshBlockedUntil).toBeUndefined();

    const bothExpired = refreshResourceStock(pressureExpired, 100_000);
    expect(bothExpired).toMatchObject({
      stock: 1,
      nextRefreshAt: 130_000,
      replenished: 1,
    });
    expect(bothExpired.seasonalRefreshBlockedUntil).toBeUndefined();
  });
});

describe('resource reservation and access', () => {
  test('active reservations reduce availability without changing stock', () => {
    expect(availableResourceStock(3, 2)).toBe(1);
    expect(availableResourceStock(1, 4)).toBe(0);
  });

  test('public nodes allow anyone while actor-owned nodes only allow their owner', () => {
    expect(resourceAccessAllowed({ accessRule: 'public' }, 'a')).toBe(true);
    expect(resourceAccessAllowed({ accessRule: 'actor', ownerActorId: 'a' }, 'a')).toBe(true);
    expect(resourceAccessAllowed({ accessRule: 'actor', ownerActorId: 'a' }, 'b')).toBe(false);
  });
});
