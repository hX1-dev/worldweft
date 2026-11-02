export type ResourceStockState = {
  capacity: number;
  stock: number;
  refreshAmount: number;
  refreshIntervalMs: number;
  nextRefreshAt?: number;
  refreshBlockedUntil?: number;
  refreshBlockedByPressureId?: string;
  seasonalRefreshBlockedUntil?: number;
};

export type RefreshedResourceStock = ResourceStockState & {
  replenished: number;
};

export type ResourceAccess = {
  accessRule: 'public' | 'actor';
  ownerActorId?: string;
};

export function refreshResourceStock(
  source: ResourceStockState,
  now: number,
): RefreshedResourceStock {
  const capacity = positiveInteger(source.capacity, 'capacity');
  const refreshAmount = positiveInteger(source.refreshAmount, 'refreshAmount');
  const refreshIntervalMs = positiveInteger(source.refreshIntervalMs, 'refreshIntervalMs');
  const stock = Math.max(0, Math.min(capacity, Math.floor(source.stock)));
  const refreshBlockedUntil = source.refreshBlockedUntil;
  const refreshBlockedByPressureId = source.refreshBlockedByPressureId;
  const seasonalRefreshBlockedUntil = source.seasonalRefreshBlockedUntil;
  const pressureBlocker =
    refreshBlockedUntil !== undefined && now < refreshBlockedUntil
      ? { refreshBlockedUntil, refreshBlockedByPressureId }
      : {};
  const seasonalBlocker =
    seasonalRefreshBlockedUntil !== undefined && now < seasonalRefreshBlockedUntil
      ? { seasonalRefreshBlockedUntil }
      : {};
  const effectiveBlockedUntil = Math.max(
    now,
    refreshBlockedUntil !== undefined && now < refreshBlockedUntil
      ? refreshBlockedUntil
      : now,
    seasonalRefreshBlockedUntil !== undefined && now < seasonalRefreshBlockedUntil
      ? seasonalRefreshBlockedUntil
      : now,
  );
  const blockers = { ...pressureBlocker, ...seasonalBlocker };
  if (stock >= capacity) {
    return {
      capacity,
      stock,
      refreshAmount,
      refreshIntervalMs,
      nextRefreshAt: undefined,
      ...blockers,
      replenished: 0,
    };
  }

  const nextRefreshAt = source.nextRefreshAt;
  if (effectiveBlockedUntil > now) {
    return {
      capacity,
      stock,
      refreshAmount,
      refreshIntervalMs,
      nextRefreshAt: Math.max(nextRefreshAt ?? effectiveBlockedUntil, effectiveBlockedUntil),
      ...blockers,
      replenished: 0,
    };
  }
  if (nextRefreshAt === undefined) {
    return {
      capacity,
      stock,
      refreshAmount,
      refreshIntervalMs,
      nextRefreshAt: now + refreshIntervalMs,
      ...blockers,
      replenished: 0,
    };
  }
  if (now < nextRefreshAt) {
    return {
      capacity,
      stock,
      refreshAmount,
      refreshIntervalMs,
      nextRefreshAt,
      ...blockers,
      replenished: 0,
    };
  }

  const elapsedIntervals = 1 + Math.floor((now - nextRefreshAt) / refreshIntervalMs);
  const replenished = Math.min(capacity - stock, elapsedIntervals * refreshAmount);
  const nextStock = stock + replenished;
  return {
    capacity,
    stock: nextStock,
    refreshAmount,
    refreshIntervalMs,
    nextRefreshAt:
      nextStock >= capacity ? undefined : nextRefreshAt + elapsedIntervals * refreshIntervalMs,
    ...blockers,
    replenished,
  };
}

export function consumeResourceStock(
  source: ResourceStockState,
  quantity: number,
  now: number,
): ResourceStockState | null {
  const qty = positiveInteger(quantity, 'quantity');
  const refreshed = refreshResourceStock(source, now);
  if (refreshed.stock < qty) return null;
  const stock = refreshed.stock - qty;
  const blocker = {
    ...(refreshed.refreshBlockedUntil !== undefined
      ? {
          refreshBlockedUntil: refreshed.refreshBlockedUntil,
          refreshBlockedByPressureId: refreshed.refreshBlockedByPressureId,
        }
      : {}),
    ...(refreshed.seasonalRefreshBlockedUntil !== undefined
      ? { seasonalRefreshBlockedUntil: refreshed.seasonalRefreshBlockedUntil }
      : {}),
  };
  const effectiveBlockedUntil = Math.max(
    refreshed.refreshBlockedUntil ?? Number.NEGATIVE_INFINITY,
    refreshed.seasonalRefreshBlockedUntil ?? Number.NEGATIVE_INFINITY,
  );
  return {
    capacity: refreshed.capacity,
    stock,
    refreshAmount: refreshed.refreshAmount,
    refreshIntervalMs: refreshed.refreshIntervalMs,
    nextRefreshAt:
      stock < refreshed.capacity
        ? Math.max(
            refreshed.nextRefreshAt ?? now + refreshed.refreshIntervalMs,
            effectiveBlockedUntil,
          )
        : undefined,
    ...blocker,
  };
}

export function availableResourceStock(stock: number, activeReservations: number) {
  return Math.max(0, Math.floor(stock) - Math.max(0, Math.floor(activeReservations)));
}

export function resourceAccessAllowed(access: ResourceAccess, actorId: string) {
  return access.accessRule === 'public' || access.ownerActorId === actorId;
}

function positiveInteger(value: number, field: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`resource_node_invariant: ${field} must be a positive integer.`);
  }
  return value;
}
