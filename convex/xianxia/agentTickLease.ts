import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { appendRecentAgentTick, decideAgentTickLease } from './agentTickLeasePolicy';

export const acquireAgentTickLease = internalMutation({
  args: {
    worldId: v.id('worlds'),
    tickId: v.string(),
    mapId: v.optional(v.string()),
    owner: v.string(),
    requestedAt: v.number(),
    now: v.number(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    const decision = decideAgentTickLease({
      lease: config?.agentTickLease,
      recentTicks: config?.recentAgentTicks,
      tickId: args.tickId,
      requestedAt: args.requestedAt,
      now: args.now,
    });
    if (!decision.acquired) return decision;

    const lease = {
      tickId: args.tickId,
      mapId: args.mapId,
      owner: args.owner,
      acquiredAt: args.now,
      expiresAt: args.now + args.ttlMs,
    };
    if (config) await ctx.db.patch(config._id, { agentTickLease: lease });
    else {
      await ctx.db.insert('xianxiaConfig', {
        worldId: args.worldId,
        autoTickEnabled: false,
        agentTickLease: lease,
      });
    }
    return { ...decision, lease };
  },
});

export const releaseAgentTickLease = internalMutation({
  args: {
    worldId: v.id('worlds'),
    tickId: v.string(),
    mapId: v.optional(v.string()),
    status: v.union(v.literal('completed'), v.literal('failed')),
    finishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (!config || config.agentTickLease?.tickId !== args.tickId) {
      return { released: false, reason: 'lease_owner_mismatch' };
    }
    await ctx.db.patch(config._id, {
      agentTickLease: undefined,
      recentAgentTicks: appendRecentAgentTick(config.recentAgentTicks, {
        tickId: args.tickId,
        mapId: args.mapId,
        status: args.status,
        finishedAt: args.finishedAt,
      }),
    });
    return { released: true, status: args.status };
  },
});
