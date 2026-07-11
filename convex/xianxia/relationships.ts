import { v } from 'convex/values';
import { query } from '../_generated/server';

// 关系查询（M4）。展示某角色对他人的关系值（-100 敌对 / 0 陌生 / 100 生死之交）。

export const listRelationships = query({
  args: { worldId: v.id('worlds'), fromActorId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('relationships')
      .withIndex('from', (q) => q.eq('worldId', args.worldId).eq('fromActorId', args.fromActorId))
      .collect();
  },
});
