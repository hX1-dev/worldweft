import { itemDef } from './items';

export const CULTIVATION_MODES = ['ambient', 'spirit_stone', 'qi_pill'] as const;

export type CultivationMode = (typeof CULTIVATION_MODES)[number];
export type InventoryEntry = { itemId: string; qty: number };

export type CultivationResource = {
  itemId: 'spirit_stone' | 'qi_pill';
  quantity: 1;
  bonusXp: number;
};

export function parseCultivationMode(value: unknown): CultivationMode | null {
  if (value === undefined) return 'ambient';
  return typeof value === 'string' && CULTIVATION_MODES.includes(value as CultivationMode)
    ? (value as CultivationMode)
    : null;
}

export function clampCultivationEnergy(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, value));
}

export function inventoryQuantity(
  inventory: InventoryEntry[] | undefined,
  itemId: string,
): number {
  const entry = inventory?.find((item) => item.itemId === itemId);
  return entry && Number.isInteger(entry.qty) && entry.qty > 0 ? entry.qty : 0;
}

export function cultivationResourceForMode(
  mode: CultivationMode,
): CultivationResource | null {
  if (mode === 'ambient') return null;
  if (mode === 'spirit_stone') {
    return { itemId: 'spirit_stone', quantity: 1, bonusXp: 3 };
  }
  const pill = itemDef('qi_pill');
  const bonusXp =
    pill?.kind === 'pill' &&
    pill.effect === 'cultivation' &&
    typeof pill.value === 'number' &&
    Number.isFinite(pill.value) &&
    pill.value > 0
      ? Math.floor(pill.value)
      : 0;
  return { itemId: 'qi_pill', quantity: 1, bonusXp };
}

export function cultivationModeAvailable(
  mode: CultivationMode,
  inventory: InventoryEntry[] | undefined,
  reservedQuantity = 0,
): boolean {
  const resource = cultivationResourceForMode(mode);
  if (!resource) return true;
  return inventoryQuantity(inventory, resource.itemId) - Math.max(0, reservedQuantity) >= 1;
}

export function hasCultivationPendant(inventory: InventoryEntry[] | undefined): boolean {
  const pendant = itemDef('qi_pendant');
  return (
    pendant?.kind === 'minor_artifact' &&
    pendant.effect === 'cultivation_bonus' &&
    typeof pendant.value === 'number' &&
    pendant.value > 0 &&
    inventoryQuantity(inventory, pendant.id) > 0
  );
}

export function applyCultivationEnhancements(
  baseXp: number,
  mode: CultivationMode,
  hasPendant: boolean,
): number {
  const resourceBonus = cultivationResourceForMode(mode)?.bonusXp ?? 0;
  const enhanced = Math.max(0, Math.floor(baseXp)) + resourceBonus;
  if (!hasPendant || enhanced <= 0) return enhanced;
  const pendant = itemDef('qi_pendant');
  const rate =
    pendant?.effect === 'cultivation_bonus' &&
    typeof pendant.value === 'number' &&
    Number.isFinite(pendant.value) &&
    pendant.value > 0
      ? pendant.value
      : 0;
  if (rate <= 0) return enhanced;
  return enhanced + Math.max(1, Math.floor(enhanced * rate));
}

export function chooseAgentCultivationMode(args: {
  spiritualEnergy: number;
  inventory: InventoryEntry[] | undefined;
}): CultivationMode {
  return clampCultivationEnergy(args.spiritualEnergy) >= 5 &&
    inventoryQuantity(args.inventory, 'spirit_stone') >= 12
    ? 'spirit_stone'
    : 'ambient';
}

export function availableCultivationModes(
  inventory: InventoryEntry[] | undefined,
): CultivationMode[] {
  return CULTIVATION_MODES.filter((mode) => cultivationModeAvailable(mode, inventory));
}
