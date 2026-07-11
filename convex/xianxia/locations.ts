import { v } from 'convex/values';
import { query } from '../_generated/server';

// 语义地点查询（M4）。前端动作面板用它选发生地、显示当前地点。

export const listLocations = query({
  args: { worldId: v.id('worlds'), mapId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const mapId = args.mapId ?? 'world';
    const locations = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) => q.eq('worldId', args.worldId))
      .collect();
    return locations.filter((location) => (location.mapId ?? 'world') === mapId);
  },
});
