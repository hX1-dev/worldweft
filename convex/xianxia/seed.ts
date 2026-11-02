import { mutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { XIANXIA_CHARACTERS } from '../../data/xianxiaCharacters';
import { ZONES } from './zones';
import { assertLegacyXianxiaWriteAccess } from './access';
import { existingProfileSeedPatch, type ProfileSeed } from './seedLogic';
import { MS_PER_GAME_HOUR } from './timeLogic';
import { existingShopSeedPatch } from './shopLogic';

// 修仙世界种子。地点从语义地图单一真相源 zones.ts 派生（含真实 bounds 区域 + 可走入口）；
// 角色从 data/xianxiaCharacters.ts 派生（与 AI Town 对话角色同源）；actorId = 角色名。
// 幂等：已存在则只更新静态/结构性字段，不重置修为、生命或运行期库存。

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
  maxHealth: c.health,
  spirit: c.spirit,
  reputation: c.reputation,
  inventory: c.inventory,
  mapId: 'world',
  currentLocationId: c.locationId,
  currentIntent: c.intent,
  persona: c.persona,
}));

const MARKET_SHOP = {
  shopId: 'market_liu_qiaoer_supply',
  name: '柳记补给摊',
  merchantActorId: '柳巧儿',
  mapId: 'world',
  locationId: 'market',
  restockSourceId: 'qinglan_sect_caravan',
  restockIntervalMs: 12 * MS_PER_GAME_HOUR,
  walletSpiritStones: 40,
  walletCapacity: 80,
  walletRestockAmount: 10,
  stock: [
    { itemId: 'spirit_herb', qty: 1, capacity: 6, restockAmount: 2 },
    { itemId: 'healing_pill', qty: 2, capacity: 4, restockAmount: 1 },
    { itemId: 'qi_pill', qty: 1, capacity: 3, restockAmount: 1 },
  ],
};

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.seed.seedDemo');
    const worldId = await defaultWorldId(ctx);
    if (!worldId) throw new Error('未找到默认世界，请先运行 init / 启动 dev。');

    for (const loc of LOCATIONS) await upsertLocation(ctx, worldId, loc);
    for (const p of PROFILES) await upsertProfile(ctx, worldId, p);
    await upsertShop(ctx, worldId, MARKET_SHOP, Date.now());

    // 默认开启自动推进：修士自主行动，无需手动（UI 可关）。
    const cfg = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', worldId))
      .first();
    if (!cfg) {
      const now = Date.now();
      await ctx.db.insert('xianxiaConfig', {
        worldId,
        autoTickEnabled: true,
        clockStartedAt: now, // W3a 世界时钟起点
        lifeCalendarStartedAt: now, // C019a 岁月历元年春；与昼夜场景钟语义解耦
        lifeCalendarAppliedSeasonIndex: 0,
        lifeCalendarAppliedAt: now,
        autonomousGrowthEnabled: false, // G 默认关：寿命/死亡安全栏建好前不开，避免「只升不死」漂移
      });
    } else {
      const now = Date.now();
      const patch: {
        clockStartedAt?: number;
        lifeCalendarStartedAt?: number;
        lifeCalendarAppliedSeasonIndex?: number;
        lifeCalendarAppliedAt?: number;
      } = {};
      if (cfg.clockStartedAt === undefined) patch.clockStartedAt = now;
      if (cfg.lifeCalendarStartedAt === undefined) patch.lifeCalendarStartedAt = now;
      if (cfg.lifeCalendarAppliedSeasonIndex === undefined) {
        patch.lifeCalendarAppliedSeasonIndex = 0;
      }
      if (cfg.lifeCalendarAppliedAt === undefined) patch.lifeCalendarAppliedAt = now;
      if (Object.keys(patch).length > 0) await ctx.db.patch(cfg._id, patch);
    }

    return { worldId, actors: PROFILES.map((p) => p.actorId), shops: [MARKET_SHOP.shopId] };
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

async function upsertProfile(ctx: MutationCtx, worldId: Id<'worlds'>, p: ProfileSeed) {
  const existing = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', p.actorId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, existingProfileSeedPatch(existing, p));
  } else {
    await ctx.db.insert('xianxiaProfiles', { worldId, ...p });
  }
}

async function upsertShop(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  shop: typeof MARKET_SHOP,
  now: number,
) {
  const existing = await ctx.db
    .query('shopInventories')
    .withIndex('byShop', (q) => q.eq('worldId', worldId).eq('shopId', shop.shopId))
    .first();
  if (existing) {
    // 重复 seed 只更新身份与补给规则；绝不补回已经卖出/买入的库存或资金。
    await ctx.db.patch(existing._id, existingShopSeedPatch(existing, shop));
    return;
  }
  await ctx.db.insert('shopInventories', {
    worldId,
    ...shop,
    nextRestockAt: now + shop.restockIntervalMs,
    updatedAt: now,
  });
}

async function defaultWorldId(ctx: MutationCtx): Promise<Id<'worlds'> | null> {
  const status = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  return status?.worldId ?? null;
}
