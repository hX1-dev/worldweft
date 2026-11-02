export const BREAKTHROUGH_MATERIAL_ITEM_ID = 'spirit_stone' as const;
export const BREAKTHROUGH_RECOVERY_GAME_HOURS = 4;

const REAL_DAY_MS = 24 * 60 * 60 * 1_000;

const REALM_MIN_DWELL_DAYS: Record<string, number> = {
  qi_refining: 12,
  foundation_building: 20,
  golden_core: 36,
  nascent_soul: 68,
};

const REALM_MATERIAL_QUANTITY: Record<string, number> = {
  qi_refining: 4,
  foundation_building: 8,
  golden_core: 16,
  nascent_soul: 32,
};

export type BreakthroughProgressState = {
  ok: boolean;
  resultCode?:
    | 'breakthrough_time_unmet'
    | 'breakthrough_recovery_active'
    | 'breakthrough_material_unavailable';
  reason?: string;
  realmEnteredAt: number;
  elapsedMs: number;
  requiredDwellMs: number;
  readyAt: number;
  recoveryUntil?: number;
  materialItemId: typeof BREAKTHROUGH_MATERIAL_ITEM_ID;
  materialQuantity: number;
  materialOwned: number;
  materialReserved: number;
  materialAvailable: number;
};

export function breakthroughMinimumDwellMs(realm: string): number | null {
  const days = REALM_MIN_DWELL_DAYS[realm];
  return days === undefined ? null : days * REAL_DAY_MS;
}

export function breakthroughMaterialQuantity(realm: string): number | null {
  return REALM_MATERIAL_QUANTITY[realm] ?? null;
}

export function evaluateBreakthroughProgress(args: {
  realm: string;
  realmEnteredAt?: number;
  profileCreatedAt: number;
  breakthroughRecoveryUntil?: number;
  inventory?: readonly { itemId: string; qty: number }[];
  materialReserved?: number;
  now: number;
}): BreakthroughProgressState {
  const requiredDwellMs = breakthroughMinimumDwellMs(args.realm) ?? Number.POSITIVE_INFINITY;
  const materialQuantity = breakthroughMaterialQuantity(args.realm) ?? Number.POSITIVE_INFINITY;
  const realmEnteredAt = validTimestamp(args.realmEnteredAt)
    ? args.realmEnteredAt!
    : args.profileCreatedAt;
  const elapsedMs = Math.max(0, args.now - realmEnteredAt);
  const readyAt = realmEnteredAt + requiredDwellMs;
  const materialOwned = inventoryQuantity(args.inventory, BREAKTHROUGH_MATERIAL_ITEM_ID);
  const materialReserved = Math.max(0, Math.floor(args.materialReserved ?? 0));
  const materialAvailable = Math.max(0, materialOwned - materialReserved);
  const base = {
    realmEnteredAt,
    elapsedMs,
    requiredDwellMs,
    readyAt,
    recoveryUntil: args.breakthroughRecoveryUntil,
    materialItemId: BREAKTHROUGH_MATERIAL_ITEM_ID,
    materialQuantity,
    materialOwned,
    materialReserved,
    materialAvailable,
  };

  if (!Number.isFinite(requiredDwellMs) || elapsedMs < requiredDwellMs) {
    return {
      ...base,
      ok: false,
      resultCode: 'breakthrough_time_unmet',
      reason: Number.isFinite(readyAt)
        ? `当前境界岁月积累不足，最早可在 ${new Date(readyAt).toISOString()} 尝试突破。`
        : '当前境界没有可用的下一境界岁月墙。',
    };
  }
  if (
    validTimestamp(args.breakthroughRecoveryUntil) &&
    args.breakthroughRecoveryUntil! > args.now
  ) {
    return {
      ...base,
      ok: false,
      resultCode: 'breakthrough_recovery_active',
      reason: `上次冲关的气息尚未平复，需等到 ${new Date(args.breakthroughRecoveryUntil!).toISOString()}。`,
    };
  }
  if (!Number.isFinite(materialQuantity) || materialAvailable < materialQuantity) {
    return {
      ...base,
      ok: false,
      resultCode: 'breakthrough_material_unavailable',
      reason: `突破需要 ${materialQuantity} 枚灵石，当前可用 ${materialAvailable} 枚。`,
    };
  }
  return { ...base, ok: true };
}

function validTimestamp(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function inventoryQuantity(
  inventory: readonly { itemId: string; qty: number }[] | undefined,
  itemId: string,
) {
  return Math.max(
    0,
    Math.floor(inventory?.find((entry) => entry.itemId === itemId)?.qty ?? 0),
  );
}
