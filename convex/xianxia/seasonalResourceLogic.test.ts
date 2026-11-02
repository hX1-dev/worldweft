import {
  LIFE_SEASONS,
  MS_PER_LIFE_SEASON,
  type LifeSeasonTransition,
} from './lifeCalendarLogic';
import {
  SEASONAL_RESOURCE_VERSION,
  VALLEY_DEW_HERB_RESOURCE_NODE_ID,
  planValleyDewHerbSeasonTransition,
  seasonalResourceEventActionId,
  type SeasonalResourceNodeState,
} from './seasonalResourceLogic';

const T0 = 1_000_000_000;

function transition(seasonIndex: number): LifeSeasonTransition {
  const toSeason = LIFE_SEASONS[seasonIndex % LIFE_SEASONS.length];
  return {
    eventActionId: `life-calendar:season:${seasonIndex}`,
    seasonIndex,
    year: Math.floor(seasonIndex / LIFE_SEASONS.length) + 1,
    fromSeason:
      LIFE_SEASONS[(seasonIndex - 1 + LIFE_SEASONS.length) % LIFE_SEASONS.length],
    toSeason,
    boundaryAt: T0 + seasonIndex * MS_PER_LIFE_SEASON,
  };
}

function node(
  overrides: Partial<SeasonalResourceNodeState> = {},
): SeasonalResourceNodeState {
  return {
    resourceNodeId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
    capacity: 3,
    stock: 0,
    refreshAmount: 1,
    refreshIntervalMs: 30_000,
    nextRefreshAt: T0 + 3 * MS_PER_LIFE_SEASON + 30_000,
    seasonalAppliedSeasonIndex: 2,
    ...overrides,
  };
}

describe('C019d seasonal finite herb contract', () => {
  test('enters winter dormancy without deleting stock or changing capacity', () => {
    const empty = planValleyDewHerbSeasonTransition(node(), transition(3));
    expect(empty).toMatchObject({
      contractVersion: SEASONAL_RESOURCE_VERSION,
      seasonalState: 'dormant',
      stockBefore: 0,
      stockAfter: 0,
      capacity: 3,
      replenished: 0,
      seasonalAppliedSeasonIndex: 3,
      seasonalRefreshBlockedUntil: T0 + 4 * MS_PER_LIFE_SEASON,
      nextRefreshAt: T0 + 4 * MS_PER_LIFE_SEASON,
    });

    const stocked = planValleyDewHerbSeasonTransition(
      node({ stock: 2, nextRefreshAt: undefined }),
      transition(3),
    );
    expect(stocked).toMatchObject({
      seasonalState: 'dormant',
      stockBefore: 2,
      stockAfter: 2,
      capacity: 3,
      replenished: 0,
    });
  });

  test('winter to spring releases exactly one due finite refresh', () => {
    const spring = planValleyDewHerbSeasonTransition(
      node({
        seasonalAppliedSeasonIndex: 3,
        nextRefreshAt: T0 + 4 * MS_PER_LIFE_SEASON,
        seasonalRefreshBlockedUntil: T0 + 4 * MS_PER_LIFE_SEASON,
      }),
      transition(4),
    );
    expect(spring).toMatchObject({
      seasonalState: 'growing',
      stockBefore: 0,
      stockAfter: 1,
      replenished: 1,
      seasonalAppliedSeasonIndex: 4,
      seasonalRefreshBlockedUntil: undefined,
    });
    expect(spring.stockAfter).toBeLessThanOrEqual(spring.capacity);
  });

  test('an overlapping pressure remains authoritative after spring begins', () => {
    const springBoundary = T0 + 4 * MS_PER_LIFE_SEASON;
    const pressureEnd = springBoundary + 60_000;
    const spring = planValleyDewHerbSeasonTransition(
      node({
        seasonalAppliedSeasonIndex: 3,
        nextRefreshAt: springBoundary,
        seasonalRefreshBlockedUntil: springBoundary,
        refreshBlockedUntil: pressureEnd,
        refreshBlockedByPressureId: 'pressure:1',
      }),
      transition(4),
    );
    expect(spring).toMatchObject({
      seasonalState: 'growing',
      stockAfter: 0,
      replenished: 0,
      refreshBlockedUntil: pressureEnd,
      refreshBlockedByPressureId: 'pressure:1',
      seasonalRefreshBlockedUntil: undefined,
      nextRefreshAt: pressureEnd,
    });
  });

  test('twenty ordered seasons stay bounded and have unique deterministic identities', () => {
    let state = node({
      stock: 0,
      nextRefreshAt: T0 + MS_PER_LIFE_SEASON,
      seasonalAppliedSeasonIndex: 0,
    });
    const ids: string[] = [];
    for (let seasonIndex = 1; seasonIndex <= 20; seasonIndex += 1) {
      const planned = planValleyDewHerbSeasonTransition(
        state,
        transition(seasonIndex),
      );
      ids.push(planned.eventActionId);
      expect(planned.stockAfter).toBeGreaterThanOrEqual(0);
      expect(planned.stockAfter).toBeLessThanOrEqual(planned.capacity);
      state = {
        resourceNodeId: planned.resourceNodeId,
        capacity: planned.capacity,
        stock: planned.stockAfter,
        refreshAmount: planned.refreshAmount,
        refreshIntervalMs: planned.refreshIntervalMs,
        nextRefreshAt: planned.nextRefreshAt,
        refreshBlockedUntil: planned.refreshBlockedUntil,
        refreshBlockedByPressureId: planned.refreshBlockedByPressureId,
        seasonalRefreshBlockedUntil: planned.seasonalRefreshBlockedUntil,
        seasonalAppliedSeasonIndex: planned.seasonalAppliedSeasonIndex,
      };
    }
    expect(new Set(ids).size).toBe(20);
    expect(ids[0]).toBe(
      seasonalResourceEventActionId(VALLEY_DEW_HERB_RESOURCE_NODE_ID, 1),
    );
    expect(ids.at(-1)).toBe(
      seasonalResourceEventActionId(VALLEY_DEW_HERB_RESOURCE_NODE_ID, 20),
    );
  });

  test('rejects wrong nodes, stale cursors and malformed effect identities', () => {
    expect(() =>
      planValleyDewHerbSeasonTransition(
        { ...node(), resourceNodeId: 'invented' },
        transition(3),
      ),
    ).toThrow('seasonal_resource_wrong_node');
    expect(() =>
      planValleyDewHerbSeasonTransition(
        node({ seasonalAppliedSeasonIndex: 3 }),
        transition(3),
      ),
    ).toThrow('seasonal_resource_stale_transition');
    expect(() => seasonalResourceEventActionId('', 1)).toThrow(
      'seasonal_resource_invalid_node',
    );
  });
});
