import { v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { gameTimeAt, type GameTime } from './timeLogic';
import { assertLegacyXianxiaWriteAccess } from './access';

// 世界级配置（UI 重构）。「自动推进」开关 + W3a 世界时钟锚点。

export const getAutoTick = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args): Promise<boolean> => {
    return await readAutoTick(ctx, args.worldId);
  },
});

export const setAutoTick = mutation({
  args: { worldId: v.id('worlds'), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.config.setAutoTick');
    const existing = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { autoTickEnabled: args.enabled });
    else
      await ctx.db.insert('xianxiaConfig', {
        worldId: args.worldId,
        autoTickEnabled: args.enabled,
      });
    return { autoTickEnabled: args.enabled };
  },
});

// 共享读取：无配置行时默认关闭（保守，控成本）。
export async function readAutoTick(
  ctx: QueryCtx | MutationCtx,
  worldId: Id<'worlds'>,
): Promise<boolean> {
  const cfg = await ctx.db
    .query('xianxiaConfig')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .first();
  return cfg?.autoTickEnabled ?? false;
}

// G 自主成长开关。默认关闭——寿命/死亡安全栏（docs/世界逻辑/寿命-时间尺度.md）建好前不开，
// 否则放着跑会全员只升不死、漂向「全员化神」。
export const getAutonomousGrowth = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args): Promise<boolean> => {
    return await readAutonomousGrowth(ctx, args.worldId);
  },
});

export const setAutonomousGrowth = mutation({
  args: { worldId: v.id('worlds'), enabled: v.boolean() },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.config.setAutonomousGrowth');
    const existing = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (existing) await ctx.db.patch(existing._id, { autonomousGrowthEnabled: args.enabled });
    else
      await ctx.db.insert('xianxiaConfig', {
        worldId: args.worldId,
        autoTickEnabled: false,
        autonomousGrowthEnabled: args.enabled,
      });
    return { autonomousGrowthEnabled: args.enabled };
  },
});

export async function readAutonomousGrowth(
  ctx: QueryCtx | MutationCtx,
  worldId: Id<'worlds'>,
): Promise<boolean> {
  const cfg = await ctx.db
    .query('xianxiaConfig')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .first();
  return cfg?.autonomousGrowthEnabled ?? false;
}

// 世界时钟锚点（无则 null）。submitAction 据此算当前昼夜阶段，UI 据此显示时辰。
export async function readClockStartedAt(
  ctx: QueryCtx | MutationCtx,
  worldId: Id<'worlds'>,
): Promise<number | null> {
  const cfg = await ctx.db
    .query('xianxiaConfig')
    .withIndex('byWorld', (q) => q.eq('worldId', worldId))
    .first();
  return cfg?.clockStartedAt ?? null;
}

// 当前游戏小时（totalHours，W3b 过期统一以此为基准）。无时钟则按 0（游戏伊始，不过期）。
export async function readGameHour(
  ctx: QueryCtx | MutationCtx,
  worldId: Id<'worlds'>,
  nowMs: number,
): Promise<number> {
  const startedAt = await readClockStartedAt(ctx, worldId);
  return startedAt === null ? 0 : gameTimeAt(nowMs, startedAt).totalHours;
}

// 当前游戏时间（now 由调用方传入，Convex query 不能用 Date.now）。无时钟则 null。
export const getClock = query({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args): Promise<GameTime | null> => {
    const startedAt = await readClockStartedAt(ctx, args.worldId);
    return startedAt === null ? null : gameTimeAt(args.now, startedAt);
  },
});
