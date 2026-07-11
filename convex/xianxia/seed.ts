import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { XIANXIA_CHARACTERS } from '../../data/xianxiaCharacters';
import { ZONES } from './zones';
import { assertLegacyXianxiaWriteAccess } from './access';

// 修仙世界种子。地点从语义地图单一真相源 zones.ts 派生（含真实 bounds 区域 + 可走入口）；
// 角色从 data/xianxiaCharacters.ts 派生（与 AI Town 对话角色同源）；actorId = 角色名。
// 幂等：已存在则只更新结构性字段（物品/地点/意图/persona），不重置修为等运行期数值。

const LOCATIONS: LocationSeed[] = ZONES.map((z) => ({
  locationId: z.zoneId,
  name: z.name,
  kind: z.kind,
  mapId: 'world',
  dangerLevel: z.dangerLevel,
  spiritualEnergy: z.spiritualEnergy,
  allowedActions: z.allowedActions,
  entryPoints: z.entryPoints,
  bounds: z.bounds,
  description: z.description,
}));

const PROFILES: ProfileSeed[] = XIANXIA_CHARACTERS.map((c) => ({
  actorId: c.name,
  name: c.name,
  role: c.role,
  realm: c.realm,
  realmStage: c.realmStage,
  spiritRoot: c.spiritRoot,
  innerTrait: c.innerTrait,
  outerTrait: c.outerTrait,
  cultivationXp: c.cultivationXp,
  mood: c.mood,
  health: c.health,
  spirit: c.spirit,
  reputation: c.reputation,
  inventory: c.inventory,
  mapId: 'world',
  currentLocationId: c.locationId,
  currentIntent: c.intent,
  persona: c.persona,
}));

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.seed.seedDemo');
    const worldId = await defaultWorldId(ctx);
    if (!worldId) throw new Error('未找到默认世界，请先运行 init / 启动 dev。');

    for (const loc of LOCATIONS) await upsertLocation(ctx, worldId, loc);
    for (const p of PROFILES) await upsertProfile(ctx, worldId, p);

    // 默认开启自动推进：修士自主行动，无需手动（UI 可关）。
    const cfg = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', worldId))
      .first();
    if (!cfg) {
      await ctx.db.insert('xianxiaConfig', {
        worldId,
        autoTickEnabled: true,
        clockStartedAt: Date.now(), // W3a 世界时钟起点
        autonomousGrowthEnabled: false, // G 默认关：寿命/死亡安全栏建好前不开，避免「只升不死」漂移
      });
    } else if (cfg.clockStartedAt === undefined) {
      await ctx.db.patch(cfg._id, { clockStartedAt: Date.now() }); // 回填旧世界
    }

    return { worldId, actors: PROFILES.map((p) => p.actorId) };
  },
});

type LocationSeed = {
  locationId: string;
  name: string;
  kind: string;
  mapId: string;
  dangerLevel: number;
  spiritualEnergy: number;
  allowedActions: string[];
  entryPoints: { x: number; y: number }[];
  bounds: { x1: number; y1: number; x2: number; y2: number };
  description: string;
};

async function upsertLocation(ctx: MutationCtx, worldId: Id<'worlds'>, loc: LocationSeed) {
  const existing = await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) => q.eq('worldId', worldId).eq('locationId', loc.locationId))
    .first();
  if (existing) await ctx.db.patch(existing._id, loc);
  else await ctx.db.insert('locations', { worldId, ...loc });
}

type ProfileSeed = {
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
  spirit: number;
  reputation: number;
  inventory: { itemId: string; qty: number }[];
  mapId: string;
  currentLocationId: string;
  currentIntent: string;
  persona: string;
};

async function upsertProfile(ctx: MutationCtx, worldId: Id<'worlds'>, p: ProfileSeed) {
  const existing = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', p.actorId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      spiritRoot: p.spiritRoot, // 静态天赋，回填安全（不动 realm/xp 等运行期值）
      innerTrait: p.innerTrait, // 性格双轴同为静态天赋，回填安全
      outerTrait: p.outerTrait,
      inventory: p.inventory,
      mapId: p.mapId,
      currentLocationId: p.currentLocationId,
      currentIntent: p.currentIntent,
      persona: p.persona,
    });
  } else {
    await ctx.db.insert('xianxiaProfiles', { worldId, ...p });
  }
}

async function defaultWorldId(ctx: MutationCtx): Promise<Id<'worlds'> | null> {
  const status = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  return status?.worldId ?? null;
}
