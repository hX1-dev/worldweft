import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { insertInput } from '../aiTown/insertInput';
import { appendWorldEvent } from './events';
import {
  toDurableActionResult,
  versionDurableEventFacts,
} from './durableContracts';
import {
  ACTION_EXECUTION_LEASE_MS,
  ACTIVE_ACTION_EXECUTION_STATUSES,
} from './actionExecutionContracts';
import {
  effectiveTravelTarget,
  hasArrived,
  locationAtPosition,
  pickAvailableTravelStandpoint,
  resolveTravelTarget,
  type LocationPoint,
} from './movementLogic';
import { createAiTownTravelPort } from './runtimeTravelPort';

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

async function resolveAvailableWorldTravelTargetFromAuthority(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  targetLocationId: string,
  playerId: string,
) {
  const { points } = await loadLocationPoints(
    ctx,
    worldId,
  );
  const semantic = resolveTravelTarget(
    points,
    targetLocationId,
  );
  if (!semantic.ok) return semantic;
  const [world, map] = await Promise.all([
    ctx.db.get(worldId),
    ctx.db
      .query('maps')
      .withIndex('worldId', (q) =>
        q.eq('worldId', worldId),
      )
      .unique(),
  ]);
  const actor = world?.players.find(
    (player) => player.id === playerId,
  );
  const location = points.find(
    (point) =>
      point.locationId === targetLocationId,
  );
  if (!world || !map || !actor || !location) {
    return {
      ok: false as const,
      reasonCode: 'travel_body_state_missing',
      reason:
        '无法读取身体、地图或地点状态，不能安全预约移动终点。',
    };
  }
  const destination = pickAvailableTravelStandpoint({
    location,
    actorPosition: actor.position,
    otherPositions: world.players
      .filter((player) => player.id !== playerId)
      .map((player) => player.position),
    map,
  });
  if (!destination) {
    return {
      ok: false as const,
      reasonCode: 'travel_target_occupied',
      reason: `「${targetLocationId}」当前没有未占用的合法站位。`,
    };
  }
  return {
    ok: true as const,
    locationId: targetLocationId,
    destination,
  };
}

const aiTownTravelPort = createAiTownTravelPort({
  resolve: ({
    ctx,
    worldId,
    targetLocationId,
    playerId,
  }: {
    ctx: MutationCtx;
    worldId: Id<'worlds'>;
    targetLocationId: string;
    playerId: string;
  }) => resolveAvailableWorldTravelTargetFromAuthority(
    ctx,
    worldId,
    targetLocationId,
    playerId,
  ),
});

// A4a adapter boundary: callers retain the existing movement authority and
// receive its exact result; the port adds no route state or terminal behavior.
export async function resolveAvailableWorldTravelTarget(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  targetLocationId: string,
  playerId: string,
) {
  return aiTownTravelPort.resolve({
    ctx,
    worldId,
    targetLocationId,
    playerId,
  });
}

export async function worldBodyEngineReady(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
): Promise<boolean> {
  const status = await ctx.db
    .query('worldStatus')
    .withIndex('worldId', (q) => q.eq('worldId', worldId))
    .unique();
  if (!status || status.status !== 'running') return false;
  const engine = await ctx.db.get(status.engineId);
  return engine?.running === true;
}

async function loadActiveWorldTravelExecutions(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
) {
  const rows: Doc<'actionExecutions'>[] = [];
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const matches = await ctx.db
      .query('actionExecutions')
      .withIndex('byMapStatus', (q) =>
        q
          .eq('worldId', worldId)
          .eq('mapId', 'world')
          .eq('status', status),
      )
      .collect();
    rows.push(
      ...matches.filter(
        (execution) => execution.actionType === 'travel',
      ),
    );
  }
  return rows;
}

async function completeWorldTravel(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  fromLocationId: string | undefined,
  locationName: string,
  now: number,
) {
  if (!ACTIVE_ACTION_EXECUTION_STATUSES.has(execution.status)) {
    return execution.terminalEventId;
  }
  const targetLocationId = execution.locationId!;
  const reason = `${execution.actorId}抵达${locationName}。`;
  const result = {
    status: 'applied' as const,
    resultCode: 'travel_arrived',
    reason,
    effects: {
      locationChange: {
        fromMapId: 'world',
        fromLocationId,
        toMapId: 'world',
        toLocationId: targetLocationId,
        intent: execution.intent,
      },
    },
    eventType: 'actor_arrived_location',
    visibility: 'local' as const,
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: targetLocationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: reason,
    facts: versionDurableEventFacts({
      kind: 'world_travel',
      resultCode: result.resultCode,
    }),
    effects: result.effects,
    mapId: 'world',
  });
  await ctx.db.patch(execution.actionRecordId, {
    status: 'applied',
    result: toDurableActionResult(result),
  });
  await ctx.db.patch(execution._id, {
    status: 'completed',
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: result.resultCode,
    reasonCode: undefined,
    updatedAt: now,
  });
  return eventId;
}

async function blockWorldTravel(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
  reasonCode: string,
  reason: string,
) {
  return (await terminalizeWorldTravel(
    ctx,
    execution,
    now,
    'blocked',
    reasonCode,
    reason,
  )).eventId;
}

async function terminalizeWorldTravel(
  ctx: MutationCtx,
  execution: Doc<'actionExecutions'>,
  now: number,
  kind: 'blocked' | 'cancelled',
  reasonCode: string,
  reason: string,
): Promise<{
  eventId: Id<'worldEvents'> | undefined;
  stopInputId?: Id<'inputs'>;
}> {
  if (!ACTIVE_ACTION_EXECUTION_STATUSES.has(execution.status)) {
    return { eventId: execution.terminalEventId };
  }
  const result = {
    status: kind === 'blocked' ? 'rejected' as const : 'interrupted' as const,
    resultCode: reasonCode,
    reason,
    effects: {},
    eventType:
      kind === 'blocked'
        ? 'action_execution_blocked' as const
        : 'action_execution_interrupted' as const,
    visibility: 'local' as const,
  };
  const eventId = await appendWorldEvent(ctx, {
    worldId: execution.worldId,
    type: result.eventType,
    createdAt: now,
    actorIds: [execution.actorId],
    locationId: execution.locationId,
    actionId: execution.actionRecordId,
    visibility: result.visibility,
    summary: reason,
    facts: versionDurableEventFacts({
      resultCode: reasonCode,
    }),
    effects: {},
    mapId: execution.mapId,
  });
  await ctx.db.patch(execution.actionRecordId, {
    status: result.status,
    result: toDurableActionResult(result),
  });
  await ctx.db.patch(execution._id, {
    status: kind === 'blocked' ? 'blocked' : 'interrupted',
    terminalAt: now,
    terminalEventId: eventId,
    resultCode: reasonCode,
    reasonCode,
    updatedAt: now,
  });
  const playerId = await findPlayerIdByName(
    ctx,
    execution.worldId,
    execution.actorId,
  );
  if (!playerId) {
    throw new Error('world_travel_player_missing');
  }
  const stopInputId = await insertInput(ctx, execution.worldId, 'moveTo', {
    playerId,
    destination: null,
  });
  return { eventId, stopInputId };
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
    const activeTravels = await loadActiveWorldTravelExecutions(
      ctx,
      worldId,
    );
    const travelByActor = new Map(
      activeTravels.map((execution) => [
        execution.actorId,
        execution,
      ]),
    );
    const bodyEngineReady = await worldBodyEngineReady(ctx, worldId);

    const descs = await ctx.db
      .query('playerDescriptions')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .take(MAX_PLAYER_DESCRIPTIONS);
    const nameByPlayer = new Map(descs.map((d) => [d.playerId, d.name]));
    const { points, nameById } = await loadLocationPoints(ctx, worldId);
    if (points.length === 0) {
      if (!bodyEngineReady) {
        for (const execution of activeTravels) {
          await blockWorldTravel(
            ctx,
            execution,
            now,
            'body_engine_stopped',
            `${execution.actorId}的身体引擎未运行，移动无法继续。`,
          );
        }
      }
      return {
        synced: 0,
        blocked: bodyEngineReady ? 0 : activeTravels.length,
      };
    }

    let synced = 0;
    let matched = 0;
    const completedExecutionIds = new Set<string>();
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
      const from = profile.currentLocationId;
      const travel = travelByActor.get(name);
      const executorDestination =
        p.pathfinding?.destination;
      const semanticEntry = travel?.locationId
        ? points
            .find(
              (point) =>
                point.locationId === travel.locationId,
            )
            ?.entryPoints[0]
        : undefined;
      const travelDestination = effectiveTravelTarget({
        executorTarget: executorDestination,
        persistedTarget: travel?.targetTile,
        semanticEntry,
      });
      const reachedTravelTarget =
        !!travel &&
        !!travelDestination &&
        !p.pathfinding &&
        hasArrived(
          p.position,
          travelDestination,
          0.25,
        );
      if (
        (profile.currentLocationId ?? null) !==
        (newLoc ?? null)
      ) {
        await ctx.db.patch(profile._id, {
          currentLocationId: newLoc ?? undefined,
          mapId: 'world',
        });
        synced++;
      }
      if (reachedTravelTarget) {
        await completeWorldTravel(
          ctx,
          travel,
          from,
          nameById.get(travel.locationId!) ??
            travel.locationId!,
          now,
        );
        completedExecutionIds.add(String(travel._id));
      } else {
        const bodyMoved =
          !!travel &&
          (!travel.lastTile ||
            Math.hypot(
              p.position.x - travel.lastTile.x,
              p.position.y - travel.lastTile.y,
            ) >= 0.05);
        const executorTargetChanged =
          !!travel &&
          !!executorDestination &&
          (!travel.targetTile ||
            Math.hypot(
              executorDestination.x -
                travel.targetTile.x,
              executorDestination.y -
                travel.targetTile.y,
            ) > 0.001);
        if (
          travel &&
          bodyEngineReady &&
          (bodyMoved || executorTargetChanged) &&
          travel.expiresAt > now &&
          travel.hardDeadlineAt > now
        ) {
          await ctx.db.patch(travel._id, {
            status: 'acting',
            acceptedAt: travel.acceptedAt ?? now,
            startedAt: travel.startedAt ?? now,
            lastHeartbeatAt: now,
            lastMapId: 'world',
            lastTile: {
              x: p.position.x,
              y: p.position.y,
            },
            targetTile:
              executorDestination ??
              travel.targetTile ??
              semanticEntry,
            expiresAt: Math.min(
              travel.hardDeadlineAt,
              now + ACTION_EXECUTION_LEASE_MS,
            ),
            updatedAt: now,
          });
        }
      }
      if (
        !reachedTravelTarget &&
        (profile.currentLocationId ?? null) !==
          (newLoc ?? null) &&
        newLoc
      ) {
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
      } else if (
        !reachedTravelTarget &&
        (profile.currentLocationId ?? null) !==
          (newLoc ?? null)
      ) {
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
    }
    let blocked = 0;
    if (!bodyEngineReady) {
      for (const execution of activeTravels) {
        if (completedExecutionIds.has(String(execution._id))) {
          continue;
        }
        await blockWorldTravel(
          ctx,
          execution,
          now,
          'body_engine_stopped',
          `${execution.actorId}的身体引擎已经停止，移动未抵达目标。`,
        );
        blocked++;
      }
    }
    return {
      synced,
      players: world.players.length,
      matched,
      completed: completedExecutionIds.size,
      blocked,
    };
  },
});
