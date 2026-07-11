import { v } from 'convex/values';
import { internalQuery } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

async function resolveWorldStatus(
  ctx: QueryCtx,
  worldId?: Id<'worlds'>,
): Promise<Doc<'worldStatus'>> {
  if (worldId) {
    const status = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .first();
    if (!status) throw new Error(`No worldStatus found for worldId ${worldId}`);
    return status;
  }
  const status = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!status) throw new Error('No default worldStatus found. Run Convex init/dev first.');
  return status;
}

export const resolveWorld = internalQuery({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    const status = await resolveWorldStatus(ctx, args.worldId);
    return {
      worldId: status.worldId,
      engineId: status.engineId,
      status: status.status,
    };
  },
});

export const worldBase = internalQuery({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    const world = await ctx.db.get(args.worldId);
    if (!world) throw new Error(`World document not found for ${args.worldId}`);
    const worldMap = await ctx.db
      .query('maps')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .first();
    return { world, worldMap };
  },
});

const pageArgs = {
  worldId: v.id('worlds'),
  mapId: v.string(),
  limit: v.number(),
  cursor: v.optional(v.string()),
};

export const locationsPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) =>
    await ctx.db
      .query('locations')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', args.mapId))
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit }),
});

export const residentsPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) =>
    await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', args.mapId))
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit }),
});

export const eventsPage = internalQuery({
  args: pageArgs,
  handler: async (ctx, args) =>
    await ctx.db
      .query('worldEvents')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', args.mapId))
      .order('desc')
      .paginate({ cursor: args.cursor ?? null, numItems: args.limit }),
});

export const actionRecordById = internalQuery({
  args: { actionRecordId: v.string() },
  handler: async (ctx, args) => {
    const actionRecordId = ctx.db.normalizeId('actionRecords', args.actionRecordId);
    return actionRecordId ? await ctx.db.get(actionRecordId) : null;
  },
});

export const viewerReadState = internalQuery({
  args: { worldId: v.id('worlds'), viewerActorId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.viewerActorId) {
      return { viewerActorId: undefined, mapId: undefined, locationId: undefined, knownEventIds: [] };
    }
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.viewerActorId!),
      )
      .first();
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.viewerActorId!),
      )
      .order('desc')
      .take(100);
    return {
      viewerActorId: args.viewerActorId,
      mapId: profile?.mapId,
      locationId: profile?.currentLocationId,
      knownEventIds: [...new Set(memories.map((memory) => memory.sourceEventId))],
    };
  },
});
