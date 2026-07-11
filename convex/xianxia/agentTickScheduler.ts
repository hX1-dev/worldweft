import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

const ALL_MAPS_SCOPE = '*';
const AGENT_TICK_SCAN_LIMIT = 128;

export type AgentTickReservation = {
  scope: string;
  actorIds: string[];
  eligibleCount: number;
  startAfterActorId?: string;
  nextAfterActorId?: string;
  wrapped: boolean;
  scannedCount?: number;
  eligibleCountExact?: boolean;
};

export function isGodotControlledActorId(actorId: string) {
  return actorId === 'godot_player' || actorId.startsWith('godot_smoke_');
}

export function selectBoundedRoundRobinActorIds(
  afterActorIds: string[],
  beginningActorIds: string[],
  requestedLimit: number,
) {
  const ordered = [];
  const seen = new Set<string>();
  for (const actorId of [...afterActorIds, ...beginningActorIds]) {
    if (seen.has(actorId) || isGodotControlledActorId(actorId)) continue;
    seen.add(actorId);
    ordered.push(actorId);
  }
  const limit = Math.min(ordered.length, Math.max(1, Math.floor(requestedLimit)));
  return ordered.slice(0, limit);
}

export function selectRoundRobinActorIds(
  actorIds: string[],
  afterActorId: string | undefined,
  requestedLimit: number,
): Omit<AgentTickReservation, 'scope'> {
  const eligible = [...new Set(actorIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (eligible.length === 0) {
    return {
      actorIds: [],
      eligibleCount: 0,
      startAfterActorId: afterActorId,
      nextAfterActorId: afterActorId,
      wrapped: false,
    };
  }

  const limit = Math.min(eligible.length, Math.max(1, Math.floor(requestedLimit)));
  let startIndex = 0;
  if (afterActorId) {
    const exactIndex = eligible.indexOf(afterActorId);
    if (exactIndex >= 0) {
      startIndex = (exactIndex + 1) % eligible.length;
    } else {
      const nextIndex = eligible.findIndex((actorId) => actorId > afterActorId);
      startIndex = nextIndex >= 0 ? nextIndex : 0;
    }
  }

  const selected = Array.from(
    { length: limit },
    (_, offset) => eligible[(startIndex + offset) % eligible.length],
  );
  return {
    actorIds: selected,
    eligibleCount: eligible.length,
    startAfterActorId: afterActorId,
    nextAfterActorId: selected.at(-1),
    wrapped: startIndex + limit > eligible.length,
  };
}

export const reserveAgentTickActors = internalMutation({
  args: {
    worldId: v.id('worlds'),
    limit: v.optional(v.number()),
    mapId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AgentTickReservation> => {
    const scope = args.mapId ?? ALL_MAPS_SCOPE;
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    const cursors = [...(config?.agentTickCursors ?? [])];
    const cursorIndex = cursors.findIndex((cursor) => cursor.scope === scope);
    const afterActorId = cursorIndex >= 0 ? cursors[cursorIndex].afterActorId : undefined;
    const afterProfiles = args.mapId
      ? await ctx.db
          .query('xianxiaProfiles')
          .withIndex('byMap', (q) =>
            afterActorId
              ? q
                  .eq('worldId', args.worldId)
                  .eq('mapId', args.mapId)
                  .gt('actorId', afterActorId)
              : q.eq('worldId', args.worldId).eq('mapId', args.mapId),
          )
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT)
      : await ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) =>
            afterActorId
              ? q.eq('worldId', args.worldId).gt('actorId', afterActorId)
              : q.eq('worldId', args.worldId),
          )
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT);
    const beginningProfiles = args.mapId
      ? await ctx.db
          .query('xianxiaProfiles')
          .withIndex('byMap', (q) =>
            q.eq('worldId', args.worldId).eq('mapId', args.mapId),
          )
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT)
      : await ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) => q.eq('worldId', args.worldId))
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT);
    const actorIds = selectBoundedRoundRobinActorIds(
      afterProfiles.map((profile) => profile.actorId),
      beginningProfiles.map((profile) => profile.actorId),
      Math.min(8, Math.max(1, Math.floor(args.limit ?? 4))),
    );
    const beginningEligible = beginningProfiles.filter(
      (profile) => !isGodotControlledActorId(profile.actorId),
    );
    const selected: Omit<AgentTickReservation, 'scope'> = {
      actorIds,
      eligibleCount: beginningEligible.length,
      startAfterActorId: afterActorId,
      nextAfterActorId: actorIds.at(-1) ?? afterActorId,
      wrapped:
        Boolean(afterActorId) &&
        actorIds.some((actorId) => actorId <= (afterActorId ?? actorId)),
      scannedCount: afterProfiles.length + beginningProfiles.length,
      eligibleCountExact: beginningProfiles.length < AGENT_TICK_SCAN_LIMIT,
    };

    if (selected.actorIds.length > 0 && selected.nextAfterActorId) {
      const cursor = {
        scope,
        afterActorId: selected.nextAfterActorId,
        updatedAt: Date.now(),
      };
      if (cursorIndex >= 0) cursors[cursorIndex] = cursor;
      else cursors.push(cursor);
      if (config) await ctx.db.patch(config._id, { agentTickCursors: cursors });
      else {
        await ctx.db.insert('xianxiaConfig', {
          worldId: args.worldId,
          autoTickEnabled: false,
          agentTickCursors: cursors,
        });
      }
    }

    return { scope, ...selected };
  },
});
