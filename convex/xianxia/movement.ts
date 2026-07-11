import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { locationAtPosition, type LocationPoint } from './movementLogic';

const MAX_MOVEMENT_LOCATIONS = 128;
const MAX_PLAYER_DESCRIPTIONS = 512;

// 物理移动的「接线层」（Stage 2 · M1 §2.1）。纯换算在 movementLogic.ts，这里只读 AI Town
// 世界身体状态、写修仙语义状态——把两套状态对齐：
//   身体→语义：每次世界推进时，按小人坐标更新 xianxiaProfiles.currentLocationId + 写到达事件。
//   语义→身体：findPlayerIdByName 供 travel 动作解析出 playerId，再驱动 AI Town moveTo。
// 不改 AI Town 引擎，只在外围观察/驱动。

// actorId（= 角色名）→ AI Town playerId。世界里没有身体则返回 null。
export async function findPlayerIdByName(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  name: string,
): Promise<string | null> {
  const desc = await ctx.db
    .query('playerDescriptions')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .filter((q) => q.eq(q.field('name'), name))
    .first();
  return desc?.playerId ?? null;
}

export async function loadLocationPoints(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  mapId = 'world',
): Promise<{ points: LocationPoint[]; nameById: Map<string, string> }> {
  const locs = await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) => q.eq('worldId', worldId))
    .take(MAX_MOVEMENT_LOCATIONS);
  const mapLocs = locs.filter((l) => (l.mapId ?? 'world') === mapId);
  return {
    points: mapLocs.map((l) => ({
      locationId: l.locationId,
      entryPoints: l.entryPoints,
      bounds: l.bounds,
    })),
    nameById: new Map(mapLocs.map((l) => [l.locationId, l.name])),
  };
}

// 身体→语义观察者：读世界里每个小人的坐标，落到最近语义地点；
// 谁的 currentLocationId 变了，就更新并写一条 actor_arrived_location（visibility=local）。
// 每次世界推进（runAgentTick）开头调用一次，开销小、无 LLM。
export const syncLocations = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const now = Date.now();
    const world = await ctx.db.get(worldId);
    if (!world) return { synced: 0 };

    const descs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .take(MAX_PLAYER_DESCRIPTIONS);
    const nameByPlayer = new Map(descs.map((d) => [d.playerId, d.name]));
    const { points, nameById } = await loadLocationPoints(ctx, worldId);
    if (points.length === 0) return { synced: 0 };

    let synced = 0;
    let matched = 0;
    for (const p of world.players) {
      const name = nameByPlayer.get(p.id);
      if (!name) continue;
      matched++;
      // W4b-A：身体不在任何 zone 内 → newLoc=null（途中/无人区），不再假装停留在旧地点。
      const newLoc = locationAtPosition(p.position, points);
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', name))
        .first();
      if (!profile) continue;
      if ((profile.currentLocationId ?? null) === (newLoc ?? null)) continue; // 语义位置无变化

      const from = profile.currentLocationId;
      await ctx.db.patch(profile._id, { currentLocationId: newLoc ?? undefined, mapId: 'world' });
      if (newLoc) {
        await appendWorldEvent(ctx, {
          worldId,
          type: 'actor_arrived_location',
          createdAt: now,
          actorIds: [name],
          locationId: newLoc,
          visibility: 'local',
          summary: `${name}来到${nameById.get(newLoc) ?? newLoc}。`,
          facts: versionDurableEventFacts({ fromLocationId: from, toLocationId: newLoc }),
        });
      } else {
        await appendWorldEvent(ctx, {
          worldId,
          type: 'actor_left_location',
          createdAt: now,
          actorIds: [name],
          locationId: from,
          visibility: 'local',
          summary: `${name}离开${nameById.get(from ?? '') ?? from}，行于途中。`,
          facts: versionDurableEventFacts({ fromLocationId: from! }),
        });
      }
      synced++;
    }
    return { synced, players: world.players.length, matched };
  },
});
