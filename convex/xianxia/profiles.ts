import { v } from 'convex/values';
import { query } from '../_generated/server';

// 修仙角色状态查询（M2）。前端角色档案与调试都用它（蓝图 §16 完成标准：能查修仙状态）。

export const getProfile = query({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .first();
  },
});

export const listProfiles = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId))
      .collect();
  },
});
