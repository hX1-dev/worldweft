// Seed 的纯逻辑边界：重复播种只回填静态/缺失字段，绝不重置运行期库存。
export type ProfileSeed = {
  actorId: string;
  name: string;
  role: string;
  realm: string;
  realmStage: number;
  spiritRoot: string;
  innerTrait: string;
  outerTrait: string;
  cultivationXp: number;
  mood: number;
  health: number;
  maxHealth: number;
  spirit: number;
  reputation: number;
  inventory: { itemId: string; qty: number }[];
  mapId: string;
  currentLocationId: string;
  currentIntent: string;
  persona: string;
};

export function existingProfileSeedPatch(
  existing: {
    health?: number;
    maxHealth?: number;
    inventory?: { itemId: string; qty: number }[];
  },
  seed: ProfileSeed,
) {
  return {
    spiritRoot: seed.spiritRoot,
    innerTrait: seed.innerTrait,
    outerTrait: seed.outerTrait,
    // Legacy profiles may predate maxHealth while already carrying health
    // above today's seed baseline. Never create health > maxHealth during the
    // backfill, otherwise the next health delta would silently discard HP.
    ...(existing.maxHealth === undefined
      ? { maxHealth: Math.max(seed.maxHealth, existing.health ?? seed.health) }
      : {}),
    ...(existing.inventory === undefined ? { inventory: seed.inventory } : {}),
    mapId: seed.mapId,
    currentLocationId: seed.currentLocationId,
    currentIntent: seed.currentIntent,
    persona: seed.persona,
  };
}
