import {
  LIFE_SEASONS,
  MS_PER_LIFE_SEASON,
  type LifeSeason,
  type LifeSeasonTransition,
} from './lifeCalendarLogic';
import {
  refreshResourceStock,
  type ResourceStockState,
} from './resourceNodeLogic';

export const SEASONAL_RESOURCE_VERSION = 'taixu.seasonal_resource.v1' as const;
export const VALLEY_DEW_HERB_RESOURCE_NODE_ID = 'dew_herb_patch';
export const VALLEY_DEW_HERB_SEASONAL_RULE =
  'valley_dew_herb_winter_dormancy' as const;

export type SeasonalResourceState = 'growing' | 'dormant';

export type SeasonalResourceNodeState = ResourceStockState & {
  resourceNodeId: string;
  seasonalAppliedSeasonIndex?: number;
};

export type SeasonalResourceTransitionPlan = ResourceStockState & {
  contractVersion: typeof SEASONAL_RESOURCE_VERSION;
  rule: typeof VALLEY_DEW_HERB_SEASONAL_RULE;
  resourceNodeId: string;
  eventActionId: string;
  seasonIndex: number;
  year: number;
  fromSeason: LifeSeason;
  toSeason: LifeSeason;
  boundaryAt: number;
  seasonalState: SeasonalResourceState;
  seasonalAppliedSeasonIndex: number;
  stockBefore: number;
  stockAfter: number;
  replenished: number;
};

export function seasonalResourceEventActionId(
  resourceNodeId: string,
  seasonIndex: number,
): string {
  if (!resourceNodeId) throw new Error('seasonal_resource_invalid_node');
  if (!Number.isSafeInteger(seasonIndex) || seasonIndex < 0) {
    throw new Error('seasonal_resource_invalid_cursor');
  }
  return `seasonal-resource:${resourceNodeId}:season:${seasonIndex}`;
}

export function seasonalResourceStateForSeason(
  season: LifeSeason,
): SeasonalResourceState {
  return season === 'winter' ? 'dormant' : 'growing';
}

export function seasonForAppliedIndex(seasonIndex: number): LifeSeason {
  if (!Number.isSafeInteger(seasonIndex) || seasonIndex < 0) {
    throw new Error('seasonal_resource_invalid_cursor');
  }
  return LIFE_SEASONS[seasonIndex % LIFE_SEASONS.length];
}

export function planValleyDewHerbSeasonTransition(
  source: SeasonalResourceNodeState,
  transition: LifeSeasonTransition,
): SeasonalResourceTransitionPlan {
  if (source.resourceNodeId !== VALLEY_DEW_HERB_RESOURCE_NODE_ID) {
    throw new Error('seasonal_resource_wrong_node');
  }
  if (
    source.seasonalAppliedSeasonIndex !== undefined &&
    source.seasonalAppliedSeasonIndex >= transition.seasonIndex
  ) {
    throw new Error('seasonal_resource_stale_transition');
  }

  const refreshedAtBoundary = refreshResourceStock(source, transition.boundaryAt);
  const seasonalState = seasonalResourceStateForSeason(transition.toSeason);
  const seasonalRefreshBlockedUntil =
    seasonalState === 'dormant'
      ? transition.boundaryAt + MS_PER_LIFE_SEASON
      : undefined;
  const nextRefreshAt =
    refreshedAtBoundary.stock >= refreshedAtBoundary.capacity
      ? undefined
      : seasonalRefreshBlockedUntil !== undefined
        ? Math.max(
            refreshedAtBoundary.nextRefreshAt ??
              transition.boundaryAt + refreshedAtBoundary.refreshIntervalMs,
            seasonalRefreshBlockedUntil,
          )
        : refreshedAtBoundary.nextRefreshAt;

  return {
    contractVersion: SEASONAL_RESOURCE_VERSION,
    rule: VALLEY_DEW_HERB_SEASONAL_RULE,
    resourceNodeId: source.resourceNodeId,
    eventActionId: seasonalResourceEventActionId(
      source.resourceNodeId,
      transition.seasonIndex,
    ),
    seasonIndex: transition.seasonIndex,
    year: transition.year,
    fromSeason: transition.fromSeason,
    toSeason: transition.toSeason,
    boundaryAt: transition.boundaryAt,
    seasonalState,
    seasonalAppliedSeasonIndex: transition.seasonIndex,
    capacity: refreshedAtBoundary.capacity,
    stock: refreshedAtBoundary.stock,
    refreshAmount: refreshedAtBoundary.refreshAmount,
    refreshIntervalMs: refreshedAtBoundary.refreshIntervalMs,
    nextRefreshAt,
    refreshBlockedUntil: refreshedAtBoundary.refreshBlockedUntil,
    refreshBlockedByPressureId: refreshedAtBoundary.refreshBlockedByPressureId,
    seasonalRefreshBlockedUntil,
    stockBefore: Math.max(
      0,
      Math.min(source.capacity, Math.floor(source.stock)),
    ),
    stockAfter: refreshedAtBoundary.stock,
    replenished: refreshedAtBoundary.replenished,
  };
}
