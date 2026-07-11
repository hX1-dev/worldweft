import { v } from 'convex/values';
import { internalMutation, mutation, query } from '../_generated/server';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { QINGLAN_TEST_AGENTS, type QinglanTestAgent } from '../../data/qinglanTestAgents';
import { QINGLAN_FANGSHI_ZONES } from './qinglanFangshiZones';
import {
  findQinglanNavigationPath,
  getQinglanTileNavigationInfo,
  isQinglanTileWalkable,
  moveQinglanTileToward,
  QINGLAN_NAVIGATION_SUMMARY,
  snapQinglanTileToWalkable,
} from './qinglanNavigation';
import {
  godotPlayerProfileSeed,
  qinglanResidentProfilePatch,
  qinglanResidentProfileSeed,
} from './qinglanProfiles';
import { assertLegacyXianxiaWriteAccess } from './access';

export const QINGLAN_MAP_ID = 'qinglan';
export const WORLD_MAP_ID = 'world';
export const QINGLAN_ENTRY_LOCATION_ID = 'market_west_gate';
export const WORLD_RETURN_LOCATION_ID = 'market';
export const DEFAULT_SURFACE_SESSION_ID = 'local-player';
const QINGLAN_TICK_MIN_MS = 1800;
const QINGLAN_MAX_STEP_SECONDS = 3.5;
const QINGLAN_DEFAULT_SPEED_TILES_PER_SECOND = 1.1;
const QINGLAN_SAFE_FALLBACK_TILE = { x: 43, y: 36 };
const GODOT_PLAYER_START_LOCATION_ID = 'market_medicine_shop';
const MAX_QINGLAN_SURFACE_LOCATIONS = 128;
const MAX_QINGLAN_SURFACE_RESIDENTS = 128;
type ResidentStatus =
  | 'idle'
  | 'moving'
  | 'walking'
  | 'thinking'
  | 'speaking'
  | 'talking'
  | 'trading'
  | 'resting'
  | 'patrolling'
  | 'watching'
  | 'arranging_herbs'
  | 'carrying'
  | 'waiting';

type TilePoint = { x: number; y: number };
export type LifeSpot = {
  spotId: string;
  label: string;
  locationId: string;
  tile: TilePoint;
  statuses: ResidentStatus[];
  intent: string;
};

export const QINGLAN_LIFE_SPOTS: LifeSpot[] = [
  {
    spotId: 'west_gate_watch',
    label: '坊市西门',
    locationId: 'market_west_gate',
    tile: { x: 8, y: 20 },
    statuses: ['watching', 'patrolling', 'thinking'],
    intent: '守在坊市西门，留意来往的修士。',
  },
  {
    spotId: 'west_gate_steps',
    label: '西门石阶',
    locationId: 'market_west_gate',
    tile: { x: 18, y: 20 },
    statuses: ['patrolling', 'watching'],
    intent: '沿西门石阶巡看，确认街口无异常。',
  },
  {
    spotId: 'medicine_counter',
    label: '灵药铺柜台',
    locationId: 'market_medicine_shop',
    tile: { x: 35, y: 30 },
    statuses: ['trading', 'arranging_herbs', 'talking'],
    intent: '在灵药铺柜台前照看草药与丹瓶。',
  },
  {
    spotId: 'medicine_shelves',
    label: '药铺货架',
    locationId: 'market_medicine_shop',
    tile: { x: 35, y: 31 },
    statuses: ['arranging_herbs', 'thinking'],
    intent: '整理药铺货架，清点今日的灵草。',
  },
  {
    spotId: 'main_stall_west',
    label: '西侧摊位',
    locationId: 'market_main_street',
    tile: { x: 43, y: 36 },
    statuses: ['trading', 'talking', 'watching'],
    intent: '在河街摊位间看货议价。',
  },
  {
    spotId: 'main_stall_east',
    label: '东侧摊位',
    locationId: 'market_main_street',
    tile: { x: 52, y: 38 },
    statuses: ['trading', 'talking'],
    intent: '穿过河街主市，打听今日行情。',
  },
  {
    spotId: 'quiet_corner',
    label: '桥边静处',
    locationId: 'market_main_street',
    tile: { x: 52, y: 40 },
    statuses: ['resting', 'thinking'],
    intent: '在桥边静处稍作调息，避开街市喧闹。',
  },
  {
    spotId: 'tea_table',
    label: '坊市茶摊',
    locationId: 'market_tea_stall',
    tile: { x: 56, y: 53 },
    statuses: ['resting', 'talking', 'thinking'],
    intent: '在茶摊旁歇脚，听人闲谈坊市传闻。',
  },
  {
    spotId: 'tea_bridge',
    label: '临河茶巷',
    locationId: 'market_tea_stall',
    tile: { x: 60, y: 54 },
    statuses: ['resting', 'watching'],
    intent: '走到临河小桥边，望一眼水路货船。',
  },
  {
    spotId: 'inn_door',
    label: '散修客栈门前',
    locationId: 'market_inn',
    tile: { x: 58, y: 28 },
    statuses: ['resting', 'talking', 'waiting'],
    intent: '在客栈门前暂歇，观察街上人流。',
  },
  {
    spotId: 'inn_courtyard',
    label: '客栈小院',
    locationId: 'market_inn',
    tile: { x: 62, y: 30 },
    statuses: ['resting', 'thinking'],
    intent: '在客栈小院里整理行囊。',
  },
  {
    spotId: 'dock_crates',
    label: '码头货箱',
    locationId: 'market_dock',
    tile: { x: 76, y: 55 },
    statuses: ['trading', 'carrying', 'waiting'],
    intent: '在码头货箱旁核对外来货物。',
  },
  {
    spotId: 'dock_boat',
    label: '货船栈桥',
    locationId: 'market_dock',
    tile: { x: 80, y: 52 },
    statuses: ['carrying', 'watching', 'waiting'],
    intent: '沿货船栈桥搬运货包，等待下一批货上岸。',
  },
  {
    spotId: 'dock_warehouse',
    label: '码头仓门',
    locationId: 'market_dock',
    tile: { x: 78, y: 51 },
    statuses: ['carrying', 'waiting'],
    intent: '在码头仓门前搬卸货箱。',
  },
  {
    spotId: 'east_road',
    label: '东坊路',
    locationId: 'market_east_road',
    tile: { x: 78, y: 33 },
    statuses: ['walking', 'waiting', 'watching'],
    intent: '从东坊路入市，寻找今晚落脚处。',
  },
];

export const RESIDENT_ROUTES: Record<string, string[]> = {
  'qinglan-guard-west': ['west_gate_watch', 'west_gate_steps', 'main_stall_west'],
  'qinglan-medicine-keeper': ['medicine_counter', 'medicine_shelves', 'main_stall_west'],
  'qinglan-liu-qiaoer': ['main_stall_west', 'main_stall_east', 'tea_table', 'medicine_counter'],
  'qinglan-lin-xiaoman': ['tea_table', 'tea_bridge', 'quiet_corner', 'main_stall_west'],
  'qinglan-elder-mu': ['quiet_corner', 'tea_table', 'inn_courtyard'],
  'qinglan-inn-guest': ['inn_door', 'inn_courtyard', 'tea_table', 'quiet_corner'],
  'qinglan-dock-trader': ['dock_crates', 'dock_boat', 'main_stall_east'],
  'qinglan-porter': ['dock_warehouse', 'dock_crates', 'dock_boat'],
  'qinglan-east-traveler': ['east_road', 'inn_door', 'main_stall_east'],
};

export const seedQinglanFangshi = mutation({
  args: { worldId: v.optional(v.id('worlds')) },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.qinglan.seedQinglanFangshi');
    const worldId = args.worldId ?? (await defaultWorldId(ctx));
    if (!worldId) throw new Error('未找到默认世界，请先运行 init / 启动 dev。');

    const ensured = await ensureQinglanSurfaceSeeded(ctx, worldId);

    return {
      worldId,
      mapId: QINGLAN_MAP_ID,
      locations: ensured.locations,
      residents: ensured.residents,
      profiles: ensured.profiles,
    };
  },
});

export const getQinglanSurface = query({
  args: {
    worldId: v.id('worlds'),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = args.sessionId ?? DEFAULT_SURFACE_SESSION_ID;
    const session = await getSession(ctx, args.worldId, sessionId);
    const dbLocations = await ctx.db
      .query('locations')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', QINGLAN_MAP_ID))
      .take(MAX_QINGLAN_SURFACE_LOCATIONS);
    const dbResidents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', QINGLAN_MAP_ID))
      .take(MAX_QINGLAN_SURFACE_RESIDENTS);

    const fallbackResidents = QINGLAN_TEST_AGENTS.map((agent) => toResidentSeed(agent));
    const residentRecords = dbResidents.length > 0 ? dbResidents : fallbackResidents;
    const renderableResidents = residentRecords.map(toRenderableResident);

    return {
      mapId: QINGLAN_MAP_ID,
      mapName: '青岚坊市',
      width: 96,
      height: 72,
      residentSource: dbResidents.length > 0 ? 'db' : 'fallback',
      locations:
        dbLocations.length > 0
          ? dbLocations
          : QINGLAN_FANGSHI_ZONES.map((zone) => toQinglanLocationPayload(zone)),
      residents: renderableResidents,
      navigation: {
        ...QINGLAN_NAVIGATION_SUMMARY,
        lifeSpots: buildQinglanLifeSpotPreviews(),
        residentDiagnostics: summarizeResidentNavigation(renderableResidents),
        routePreviews: buildQinglanRoutePreviews(),
      },
      session: session ?? defaultSession(args.worldId, sessionId),
      portals: [
        {
          portalId: 'world_to_qinglan',
          fromMapId: WORLD_MAP_ID,
          fromLocationId: WORLD_RETURN_LOCATION_ID,
          toMapId: QINGLAN_MAP_ID,
          toLocationId: QINGLAN_ENTRY_LOCATION_ID,
          label: '进入青岚坊市',
        },
        {
          portalId: 'qinglan_to_world',
          fromMapId: QINGLAN_MAP_ID,
          fromLocationId: QINGLAN_ENTRY_LOCATION_ID,
          toMapId: WORLD_MAP_ID,
          toLocationId: WORLD_RETURN_LOCATION_ID,
          label: '返回原世界',
        },
      ],
    };
  },
});

export const getSurfaceSession = query({
  args: {
    worldId: v.id('worlds'),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sessionId = args.sessionId ?? DEFAULT_SURFACE_SESSION_ID;
    return (
      (await getSession(ctx, args.worldId, sessionId)) ?? defaultSession(args.worldId, sessionId)
    );
  },
});

export const enterQinglan = mutation({
  args: {
    worldId: v.id('worlds'),
    sessionId: v.optional(v.string()),
    fromLocationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.qinglan.enterQinglan');
    const sessionId = args.sessionId ?? DEFAULT_SURFACE_SESSION_ID;
    return await upsertSurfaceSession(ctx, {
      worldId: args.worldId,
      sessionId,
      currentMapId: QINGLAN_MAP_ID,
      currentLocationId: QINGLAN_ENTRY_LOCATION_ID,
      originMapId: WORLD_MAP_ID,
      originLocationId: args.fromLocationId ?? WORLD_RETURN_LOCATION_ID,
      updatedAt: Date.now(),
    });
  },
});

export const returnToWorld = mutation({
  args: {
    worldId: v.id('worlds'),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.qinglan.returnToWorld');
    const sessionId = args.sessionId ?? DEFAULT_SURFACE_SESSION_ID;
    const session = await getSession(ctx, args.worldId, sessionId);
    return await upsertSurfaceSession(ctx, {
      worldId: args.worldId,
      sessionId,
      currentMapId: WORLD_MAP_ID,
      currentLocationId: session?.originLocationId ?? WORLD_RETURN_LOCATION_ID,
      originMapId: QINGLAN_MAP_ID,
      originLocationId: QINGLAN_ENTRY_LOCATION_ID,
      updatedAt: Date.now(),
    });
  },
});

const tickQinglanResidentsArgs = {
  worldId: v.id('worlds'),
  now: v.optional(v.number()),
};

async function tickQinglanResidentsHandler(
  ctx: MutationCtx,
  args: { worldId: Id<'worlds'>; now?: number },
) {
  const now = args.now ?? Date.now();
  let profilesSynced = await ensureGodotPlayerProfile(ctx, args.worldId);
  let residents = await ctx.db
    .query('qinglanResidents')
    .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', QINGLAN_MAP_ID))
    .take(MAX_QINGLAN_SURFACE_RESIDENTS);
  let seeded = 0;

  if (residents.length === 0) {
    const ensured = await ensureQinglanSurfaceSeeded(ctx, args.worldId);
    seeded = ensured.residents;
    residents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', QINGLAN_MAP_ID))
      .take(MAX_QINGLAN_SURFACE_RESIDENTS);
  }

  let updated = 0;
  let walking = 0;
  let resting = 0;
  for (const resident of residents) {
    const patch = nextResidentPatch(resident, now);
    if (patch) {
      await ctx.db.patch(resident._id, patch);
      updated++;
      if (patch.status === 'walking') walking++;
      else resting++;
    }
    profilesSynced += await syncQinglanResidentProfile(ctx, args.worldId, {
      ...resident,
      ...(patch ?? {}),
    });
  }

  return {
    mapId: QINGLAN_MAP_ID,
    checked: residents.length,
    seeded,
    updated,
    walking,
    resting,
    profilesSynced,
    truncated: residents.length === MAX_QINGLAN_SURFACE_RESIDENTS,
    now,
  };
}

export const tickQinglanResidentsInternal = internalMutation({
  args: tickQinglanResidentsArgs,
  handler: tickQinglanResidentsHandler,
});

export const tickQinglanResidents = mutation({
  args: tickQinglanResidentsArgs,
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.qinglan.tickQinglanResidents');
    return await tickQinglanResidentsHandler(ctx, args);
  },
});

function toResidentSeed(agent: QinglanTestAgent) {
  const status: ResidentStatus = agent.isMoving
    ? 'moving'
    : agent.isSpeaking
      ? 'speaking'
      : agent.isThinking
        ? 'thinking'
        : 'idle';
  const homeSpot = snapLifeSpotToNavigation(
    spotForTile(agent.tile) ?? defaultSpotForResident(agent.id, agent.role),
  );
  const currentLocationId = homeSpot.locationId;
  const displayTile = nearestQinglanWalkableTile(homeSpot.tile, agent.tile);
  const base = {
    residentId: agent.id,
    actorId: `qinglan:${agent.id}`,
    name: agent.name,
    role: agent.role,
    character: agent.character,
    mapId: QINGLAN_MAP_ID,
    currentLocationId,
    displayTile,
    targetTile: homeSpot.tile,
    finalTargetTile: homeSpot.tile,
    pathTiles: [],
    orientation: agent.orientation,
    status,
    activityLabel: activityLabelFor(status),
    waypointId: homeSpot.spotId,
    nextActionAt: Date.now() + holdMsFor(agent.id, homeSpot.spotId, Date.now()),
    currentIntent: intentFor(agent.role, currentLocationId),
    updatedAt: Date.now(),
  };
  return agent.emoji ? { ...base, emoji: agent.emoji } : base;
}

function toRenderableResident(resident: {
  residentId: string;
  actorId: string;
  name: string;
  role: string;
  character: string;
  mapId: string;
  currentLocationId: string;
  displayTile: { x: number; y: number };
  targetTile?: { x: number; y: number };
  orientation: number;
  status: string;
  emoji?: string;
  currentIntent?: string;
  activityLabel?: string;
  waypointId?: string;
  nextActionAt?: number;
  updatedAt: number;
}) {
  return {
    id: resident.residentId,
    residentId: resident.residentId,
    actorId: resident.actorId,
    name: resident.name,
    role: resident.role,
    character: resident.character,
    mapId: resident.mapId,
    currentLocationId: resident.currentLocationId,
    tile: resident.displayTile,
    targetTile: resident.targetTile,
    orientation: resident.orientation,
    status: resident.status,
    isMoving: resident.status === 'moving' || resident.status === 'walking',
    isThinking: resident.status === 'thinking',
    isSpeaking: resident.status === 'speaking' || resident.status === 'talking',
    emoji: resident.emoji,
    activityLabel: resident.activityLabel ?? activityLabelFor(resident.status as ResidentStatus),
    currentIntent: resident.currentIntent,
    waypointId: resident.waypointId,
    nextActionAt: resident.nextActionAt,
    updatedAt: resident.updatedAt,
  };
}

type ResidentPatch = {
  displayTile?: TilePoint;
  targetTile?: TilePoint;
  finalTargetTile?: TilePoint;
  pathTiles?: TilePoint[];
  orientation?: number;
  status?: ResidentStatus;
  emoji?: string;
  currentIntent?: string;
  activityLabel?: string;
  currentLocationId?: string;
  waypointId?: string;
  nextActionAt?: number;
  updatedAt?: number;
};

function nextResidentPatch(resident: Doc<'qinglanResidents'>, now: number): ResidentPatch | null {
  const elapsedSinceUpdate = now - resident.updatedAt;
  if (elapsedSinceUpdate >= 0 && elapsedSinceUpdate < QINGLAN_TICK_MIN_MS) return null;

  if (!isQinglanTileWalkable(resident.displayTile)) {
    const snappedTile = snapQinglanTileToWalkable(resident.displayTile);
    if (snappedTile) {
      return {
        displayTile: snappedTile,
        targetTile: snappedTile,
        finalTargetTile: snappedTile,
        pathTiles: [],
        status: 'waiting',
        emoji: emojiForStatus('waiting'),
        activityLabel: activityLabelFor('waiting'),
        nextActionAt: now + 2500,
        updatedAt: now,
      };
    }
  }

  const target = resident.targetTile;
  const status = resident.status as ResidentStatus;
  if (target && isWalkingStatus(status)) {
    return advanceWalkingResident(resident, target, now);
  }

  if ((resident.nextActionAt ?? 0) > now) return null;

  const nextSpot = snapLifeSpotToNavigation(chooseNextSpot(resident, now));
  const route = routeToSpot(resident.displayTile, nextSpot);
  const nextTarget = route[0] ?? nextSpot.tile;
  const distanceToNext = distance(resident.displayTile, nextTarget);
  if (route.length === 0 && distanceToNext > 0.2) {
    return waitAfterBlockedMove(resident, nearestQinglanWalkableTile(resident.displayTile), now);
  }
  if (distanceToNext <= 0.2) {
    const holdStatus = chooseHoldStatus(resident, nextSpot, now);
    return {
      targetTile: nextSpot.tile,
      finalTargetTile: nextSpot.tile,
      pathTiles: [],
      status: holdStatus,
      emoji: emojiForStatus(holdStatus),
      currentIntent: nextSpot.intent,
      activityLabel: activityLabelFor(holdStatus),
      currentLocationId: nextSpot.locationId,
      waypointId: nextSpot.spotId,
      nextActionAt: now + holdMsFor(resident.residentId, nextSpot.spotId, now),
      updatedAt: now,
    };
  }

  const stepSeconds = Math.min(
    QINGLAN_MAX_STEP_SECONDS,
    Math.max(1.2, (now - resident.updatedAt) / 1000),
  );
  const moved = moveQinglanTileToward(
    resident.displayTile,
    nextTarget,
    speedForRole(resident.role) * stepSeconds,
  );
  if (moved.blocked) {
    return waitAfterBlockedMove(resident, moved.tile, now);
  }
  if (moved.arrived) {
    const nextPathTarget = route[1];
    if (nextPathTarget) {
      return {
        displayTile: nextTarget,
        targetTile: nextPathTarget,
        finalTargetTile: nextSpot.tile,
        pathTiles: route.slice(2),
        orientation: orientationToward(nextTarget, nextPathTarget),
        status: 'walking',
        emoji: '',
        currentIntent: `正往${nextSpot.label}走去。`,
        activityLabel: '行走中',
        waypointId: nextSpot.spotId,
        updatedAt: now,
      };
    }

    const holdStatus = chooseHoldStatus(resident, nextSpot, now);
    return {
      displayTile: nextSpot.tile,
      targetTile: nextSpot.tile,
      finalTargetTile: nextSpot.tile,
      pathTiles: [],
      orientation: orientationToward(resident.displayTile, nextSpot.tile),
      status: holdStatus,
      emoji: emojiForStatus(holdStatus),
      currentIntent: nextSpot.intent,
      activityLabel: activityLabelFor(holdStatus),
      currentLocationId: nextSpot.locationId,
      waypointId: nextSpot.spotId,
      nextActionAt: now + holdMsFor(resident.residentId, nextSpot.spotId, now),
      updatedAt: now,
    };
  }

  return {
    displayTile: moved.tile,
    targetTile: nextTarget,
    finalTargetTile: nextSpot.tile,
    pathTiles: route.slice(1),
    orientation: orientationToward(resident.displayTile, nextTarget),
    status: 'walking',
    emoji: '',
    currentIntent: `正往${nextSpot.label}走去。`,
    activityLabel: '行走中',
    waypointId: nextSpot.spotId,
    updatedAt: now,
  };
}

function advanceWalkingResident(
  resident: Doc<'qinglanResidents'>,
  target: TilePoint,
  now: number,
): ResidentPatch {
  target = nearestQinglanWalkableTile(target, resident.displayTile);
  const elapsedSeconds = Math.min(
    QINGLAN_MAX_STEP_SECONDS,
    Math.max(0.5, (now - resident.updatedAt) / 1000),
  );
  const moved = moveQinglanTileToward(
    resident.displayTile,
    target,
    speedForRole(resident.role) * elapsedSeconds,
  );
  if (moved.blocked) {
    return waitAfterBlockedMove(resident, moved.tile, now);
  }
  if (!moved.arrived) {
    return {
      displayTile: moved.tile,
      orientation: orientationToward(resident.displayTile, target),
      status: 'walking',
      activityLabel: '行走中',
      updatedAt: now,
    };
  }

  const remainingPath = resident.pathTiles ?? [];
  if (remainingPath.length > 0) {
    const nextTarget = nearestQinglanWalkableTile(remainingPath[0], target);
    return {
      displayTile: target,
      targetTile: nextTarget,
      finalTargetTile: resident.finalTargetTile,
      pathTiles: remainingPath.slice(1),
      orientation: orientationToward(target, nextTarget),
      status: 'walking',
      emoji: '',
      activityLabel: '行走中',
      updatedAt: now,
    };
  }

  const finalTarget = nearestQinglanWalkableTile(resident.finalTargetTile ?? target, target);
  const spot = snapLifeSpotToNavigation(
    spotForTile(finalTarget) ??
      spotForTile(target) ??
      spotById(resident.waypointId) ??
      defaultSpotForResident(resident.residentId, resident.role),
  );
  const holdStatus = chooseHoldStatus(resident, spot, now);
  return {
    displayTile: spot.tile,
    targetTile: spot.tile,
    finalTargetTile: spot.tile,
    pathTiles: [],
    orientation: orientationToward(resident.displayTile, spot.tile),
    status: holdStatus,
    emoji: emojiForStatus(holdStatus),
    currentIntent: spot.intent,
    activityLabel: activityLabelFor(holdStatus),
    currentLocationId: spot.locationId,
    waypointId: spot.spotId,
    nextActionAt: now + holdMsFor(resident.residentId, spot.spotId, now),
    updatedAt: now,
  };
}

function routeToSpot(from: TilePoint, spot: LifeSpot) {
  const start = nearestQinglanWalkableTile(from, spot.tile);
  const targetSpot = snapLifeSpotToNavigation(spot);
  return compactRoute(findQinglanNavigationPath(start, targetSpot.tile), start);
}

function snapLifeSpotToNavigation(spot: LifeSpot): LifeSpot {
  return { ...spot, tile: nearestQinglanWalkableTile(spot.tile) };
}

function waitAfterBlockedMove(
  resident: Doc<'qinglanResidents'>,
  safeTile: TilePoint,
  now: number,
): ResidentPatch {
  return {
    displayTile: safeTile,
    targetTile: safeTile,
    finalTargetTile: safeTile,
    pathTiles: [],
    orientation: resident.orientation,
    status: 'waiting',
    emoji: emojiForStatus('waiting'),
    currentIntent: '前路暂时被屋舍、树影或水岸挡住，正在重新辨路。',
    activityLabel: activityLabelFor('waiting'),
    nextActionAt: now + 2500,
    updatedAt: now,
  };
}

function nearestQinglanWalkableTile(
  tile: TilePoint,
  fallback: TilePoint = QINGLAN_SAFE_FALLBACK_TILE,
) {
  return (
    snapQinglanTileToWalkable(tile) ??
    snapQinglanTileToWalkable(fallback) ??
    QINGLAN_SAFE_FALLBACK_TILE
  );
}

function summarizeResidentNavigation(residents: ReturnType<typeof toRenderableResident>[]) {
  const invalidResidents = [];
  const invalidTargets = [];

  for (const resident of residents) {
    const tileInfo = getQinglanTileNavigationInfo(resident.tile);
    if (!tileInfo.walkable) {
      invalidResidents.push({
        residentId: resident.residentId,
        name: resident.name,
        tile: resident.tile,
        maskType: tileInfo.maskType ?? 'unclassified',
        snappedTile: tileInfo.snappedTile,
      });
    }

    if (resident.targetTile) {
      const targetInfo = getQinglanTileNavigationInfo(resident.targetTile);
      if (!targetInfo.walkable) {
        invalidTargets.push({
          residentId: resident.residentId,
          name: resident.name,
          targetTile: resident.targetTile,
          maskType: targetInfo.maskType ?? 'unclassified',
          snappedTile: targetInfo.snappedTile,
        });
      }
    }
  }

  return {
    total: residents.length,
    invalidResidentTiles: invalidResidents.length,
    invalidTargetTiles: invalidTargets.length,
    samples: [...invalidResidents, ...invalidTargets].slice(0, 5),
  };
}

function buildQinglanRoutePreviews() {
  const pairs = new Map<string, [string, string]>();

  for (const route of Object.values(RESIDENT_ROUTES)) {
    for (let i = 0; i < route.length - 1; i += 1) {
      const fromSpotId = route[i];
      const toSpotId = route[i + 1];
      const key = routePairKey(fromSpotId, toSpotId);
      if (!pairs.has(key)) pairs.set(key, [fromSpotId, toSpotId]);
    }
  }

  return [...pairs.values()]
    .map(([fromSpotId, toSpotId]) => {
      const fromSpot = spotById(fromSpotId);
      const toSpot = spotById(toSpotId);
      if (!fromSpot || !toSpot) return null;

      const from = snapLifeSpotToNavigation(fromSpot);
      const to = snapLifeSpotToNavigation(toSpot);
      const route = routeToSpot(from.tile, to);
      const connected = distance(from.tile, to.tile) <= 0.2 || route.length > 0;
      const pathTiles = connected ? [from.tile, ...route] : [from.tile, to.tile];
      return {
        routeId: routePairKey(fromSpotId, toSpotId),
        label: `${from.label} → ${to.label}`,
        fromSpotId,
        toSpotId,
        fromLabel: from.label,
        toLabel: to.label,
        connected,
        status: connected ? ('connected' as const) : ('disconnected' as const),
        pathTiles,
        endpoints: {
          from: from.tile,
          to: to.tile,
        },
        lengthTiles: routeLength(pathTiles),
      };
    })
    .filter((route): route is NonNullable<typeof route> => !!route)
    .sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
}

export function buildQinglanResidentRoutePreview(
  resident: Pick<
    Doc<'qinglanResidents'>,
    | 'residentId'
    | 'role'
    | 'displayTile'
    | 'targetTile'
    | 'finalTargetTile'
    | 'pathTiles'
    | 'waypointId'
    | 'status'
    | 'currentLocationId'
    | 'currentIntent'
    | 'activityLabel'
    | 'nextActionAt'
  >,
) {
  const from = nearestQinglanWalkableTile(resident.displayTile);
  const waypoint =
    spotById(resident.waypointId) ??
    spotForTile(resident.finalTargetTile ?? resident.targetTile ?? resident.displayTile) ??
    defaultSpotForResident(resident.residentId, resident.role);
  const targetSpot = snapLifeSpotToNavigation(waypoint);
  const storedPath = resident.pathTiles ?? [];
  const route =
    storedPath.length > 0
      ? compactRoute(
          storedPath.map((tile) => nearestQinglanWalkableTile(tile, from)),
          from,
        )
      : routeToSpot(from, targetSpot);
  const finalTile = nearestQinglanWalkableTile(
    resident.finalTargetTile ?? targetSpot.tile,
    targetSpot.tile,
  );
  const targetTile = nearestQinglanWalkableTile(
    resident.targetTile ?? route[0] ?? finalTile,
    finalTile,
  );
  const connected =
    distance(from, finalTile) <= 0.2 || route.length > 0 || distance(targetTile, finalTile) <= 0.2;
  const pathTiles = connected ? [from, ...route] : [from, targetTile, finalTile];
  const nextTile = route[0] ?? targetTile;
  const lengthTiles = routeLength(pathTiles);
  const remainingTiles = connected ? lengthTiles : 0;
  const nextStepDistanceTiles = roundTile(distance(from, nextTile));
  const speedTilesPerSecond = speedForRole(resident.role);
  const etaSeconds = connected ? Math.round((remainingTiles / speedTilesPerSecond) * 10) / 10 : 0;
  const movementState = !connected
    ? 'disconnected'
    : remainingTiles <= 0.2
      ? 'arrived'
      : isWalkingStatus(resident.status as ResidentStatus)
        ? 'moving'
        : 'scheduled';
  const activityLabel =
    resident.activityLabel ?? activityLabelFor(resident.status as ResidentStatus);
  const schedulePhase = schedulePhaseFor(movementState);
  const scheduleRoute = buildResidentScheduleRoutePreview(
    resident.residentId,
    resident.role,
    waypoint,
  );

  return {
    routeId: `${resident.residentId}:${waypoint.spotId}`,
    label: `${waypoint.label}`,
    waypointId: waypoint.spotId,
    waypointLabel: waypoint.label,
    locationId: waypoint.locationId,
    status: connected ? ('connected' as const) : ('disconnected' as const),
    connected,
    currentTile: from,
    targetTile,
    finalTargetTile: finalTile,
    pathTiles,
    nextTile,
    nextStepLabel: nextStepLabel(from, nextTile),
    nextStepDistanceTiles,
    lengthTiles,
    remainingTiles,
    etaSeconds,
    etaLabel: etaLabelFor(movementState, etaSeconds),
    pathStepCount: pathTiles.length,
    progressLabel: routeProgressLabel(movementState, remainingTiles),
    routeSummary: routePreviewSummary(
      movementState,
      waypoint.label,
      remainingTiles,
      etaSeconds,
      pathTiles.length,
    ),
    movementState,
    schedulePreview: {
      phase: schedulePhase,
      activityLabel,
      currentLocationId: resident.currentLocationId,
      destinationLocationId: waypoint.locationId,
      destinationLabel: waypoint.label,
      intent: resident.currentIntent ?? waypoint.intent,
      nextActionAt: resident.nextActionAt,
      summary: schedulePreviewSummary(activityLabel, schedulePhase, waypoint.label, etaSeconds),
    },
    scheduleRoute,
    source: storedPath.length > 0 ? ('resident_path' as const) : ('navigation_graph' as const),
  };
}

function schedulePhaseFor(movementState: string) {
  if (movementState === 'arrived') return 'at_waypoint';
  if (movementState === 'moving') return 'en_route';
  if (movementState === 'disconnected') return 'rerouting';
  return 'scheduled';
}

function schedulePreviewSummary(
  activityLabel: string,
  phase: string,
  destinationLabel: string,
  etaSeconds: number,
) {
  if (phase === 'at_waypoint') return `${activityLabel}于${destinationLabel}`;
  if (phase === 'en_route') return `${activityLabel}，正往${destinationLabel}，约${etaSeconds}秒`;
  if (phase === 'rerouting') return `${activityLabel}，正在重新辨路`;
  return `${activityLabel}，下一站${destinationLabel}`;
}

function etaLabelFor(movementState: string, etaSeconds: number) {
  if (movementState === 'arrived') return 'arrived';
  if (movementState === 'disconnected') return 'rerouting';
  if (etaSeconds <= 0.5) return '<1s';
  if (etaSeconds < 60) return `${Math.ceil(etaSeconds)}s`;
  return `${Math.ceil(etaSeconds / 60)}m`;
}

function routeProgressLabel(movementState: string, remainingTiles: number) {
  if (movementState === 'arrived') return 'at destination';
  if (movementState === 'disconnected') return 'needs reroute';
  return `${remainingTiles.toFixed(1)} tiles remaining`;
}

function routePreviewSummary(
  movementState: string,
  waypointLabel: string,
  remainingTiles: number,
  etaSeconds: number,
  pathStepCount: number,
) {
  if (movementState === 'arrived') return `At ${waypointLabel}.`;
  if (movementState === 'disconnected') return `Route to ${waypointLabel} needs reroute.`;
  return `Toward ${waypointLabel}: ${remainingTiles.toFixed(1)} tiles, ${etaLabelFor(
    movementState,
    etaSeconds,
  )}, ${pathStepCount} steps.`;
}

function buildResidentScheduleRoutePreview(residentId: string, role: string, waypoint: LifeSpot) {
  const residentRoute = RESIDENT_ROUTES[residentId];
  const source = residentRoute ? 'resident_route' : 'role_route';
  const route = (residentRoute ?? routeForRole(role))
    .map(spotById)
    .filter((spot): spot is LifeSpot => !!spot);
  let spots = route.length > 0 ? route : [waypoint];
  let currentIndex = spots.findIndex((spot) => spot.spotId === waypoint.spotId);
  if (currentIndex < 0) {
    spots = [waypoint, ...spots];
    currentIndex = 0;
  }
  const previousSpot = spots[(currentIndex - 1 + spots.length) % spots.length];
  const currentSpot = spots[currentIndex] ?? waypoint;
  const nextSpot = spots[(currentIndex + 1) % spots.length] ?? waypoint;
  const upcomingStops = [];
  const upcomingCount = Math.min(3, spots.length);
  for (let offset = 1; offset <= upcomingCount; offset += 1) {
    const spot = spots[(currentIndex + offset) % spots.length];
    upcomingStops.push(scheduleStopPreview(spot, offset));
  }

  return {
    source,
    routeId: `${residentId}:${spots.map((spot) => spot.spotId).join('>')}`,
    routeCount: spots.length,
    currentIndex,
    currentStop: scheduleStopPreview(currentSpot, 0),
    previousStop: scheduleStopPreview(previousSpot, -1),
    nextStop: scheduleStopPreview(nextSpot, 1),
    upcomingStops,
    loopLabel: `${currentSpot.label} -> ${nextSpot.label}`,
    summary: `${currentSpot.label}之后多半去${nextSpot.label}`,
  };
}

function scheduleStopPreview(spot: LifeSpot, offset: number) {
  return {
    spotId: spot.spotId,
    label: spot.label,
    locationId: spot.locationId,
    tile: nearestQinglanWalkableTile(spot.tile),
    intent: spot.intent,
    offset,
  };
}

function buildQinglanLifeSpotPreviews() {
  return QINGLAN_LIFE_SPOTS.map((spot) => {
    const info = getQinglanTileNavigationInfo(spot.tile);
    const snappedTile = nearestQinglanWalkableTile(spot.tile);
    return {
      spotId: spot.spotId,
      label: spot.label,
      locationId: spot.locationId,
      sourceTile: spot.tile,
      tile: snappedTile,
      snapped: distance(spot.tile, snappedTile) > 0.2 || !info.walkable,
      maskType: info.maskType ?? 'unclassified',
      intent: spot.intent,
    };
  });
}

function routePairKey(fromSpotId: string, toSpotId: string) {
  return [fromSpotId, toSpotId].sort().join('__');
}

function routeLength(points: TilePoint[]) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distance(points[i - 1], points[i]);
  }
  return Math.round(total * 10) / 10;
}

function compactRoute(points: TilePoint[], from: TilePoint) {
  const route: TilePoint[] = [];
  let previous = from;
  for (const point of points) {
    if (distance(previous, point) <= 0.35) continue;
    route.push(point);
    previous = point;
  }
  return route;
}

function chooseNextSpot(resident: Doc<'qinglanResidents'>, now: number): LifeSpot {
  const route = (RESIDENT_ROUTES[resident.residentId] ?? routeForRole(resident.role))
    .map(spotById)
    .filter((spot): spot is LifeSpot => !!spot);
  const spots = route.length > 0 ? route : QINGLAN_LIFE_SPOTS;
  let index =
    hashString(`${resident.residentId}:${resident.waypointId ?? ''}:${Math.floor(now / 9000)}`) %
    spots.length;
  if (spots.length > 1 && spots[index].spotId === resident.waypointId) {
    index = (index + 1) % spots.length;
  }
  return spots[index];
}

function chooseHoldStatus(
  resident: Pick<Doc<'qinglanResidents'>, 'residentId'>,
  spot: LifeSpot,
  now: number,
): ResidentStatus {
  return spot.statuses[
    hashString(`${resident.residentId}:${spot.spotId}:status:${Math.floor(now / 7000)}`) %
      spot.statuses.length
  ];
}

function routeForRole(role: string) {
  if (role === 'guard') return ['west_gate_watch', 'west_gate_steps'];
  if (role === 'merchant') return ['main_stall_west', 'main_stall_east', 'medicine_counter'];
  if (role === 'porter') return ['dock_warehouse', 'dock_crates', 'dock_boat'];
  if (role === 'outer_disciple') return ['tea_table', 'quiet_corner', 'main_stall_west'];
  if (role === 'elder') return ['quiet_corner', 'tea_table', 'inn_courtyard'];
  if (role === 'wandering_cultivator') return ['inn_door', 'tea_table', 'quiet_corner'];
  if (role === 'traveler') return ['east_road', 'inn_door', 'main_stall_east'];
  return ['main_stall_west', 'tea_table'];
}

function defaultSpotForResident(residentId: string, role: string) {
  const route = RESIDENT_ROUTES[residentId] ?? routeForRole(role);
  return spotById(route[0]) ?? QINGLAN_LIFE_SPOTS[0];
}

function spotById(spotId: string | undefined) {
  return spotId ? QINGLAN_LIFE_SPOTS.find((spot) => spot.spotId === spotId) : undefined;
}

function spotForTile(tile: TilePoint) {
  return QINGLAN_LIFE_SPOTS.find((spot) => distance(spot.tile, tile) <= 0.25);
}

function isWalkingStatus(status: ResidentStatus) {
  return status === 'walking' || status === 'moving';
}

function distance(a: TilePoint, b: TilePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orientationToward(from: TilePoint, to: TilePoint) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 180;
  return dy >= 0 ? 90 : 270;
}

function nextStepLabel(from: TilePoint, to: TilePoint) {
  if (distance(from, to) <= 0.2) return 'at waypoint';
  const orientation = orientationToward(from, to);
  if (orientation === 0) return 'east';
  if (orientation === 180) return 'west';
  if (orientation === 90) return 'south';
  return 'north';
}

function speedForRole(role: string) {
  if (role === 'porter') return 1.25;
  if (role === 'guard') return 1.0;
  if (role === 'traveler') return 1.2;
  return QINGLAN_DEFAULT_SPEED_TILES_PER_SECOND;
}

function holdMsFor(residentId: string, spotId: string, now: number) {
  return 5000 + (hashString(`${residentId}:${spotId}:hold:${Math.floor(now / 11000)}`) % 9000);
}

function activityLabelFor(status: string) {
  const labels: Record<string, string> = {
    idle: '闲立',
    moving: '行走中',
    walking: '行走中',
    thinking: '思量',
    speaking: '交谈',
    talking: '闲谈',
    trading: '交易',
    resting: '歇脚',
    patrolling: '巡街',
    watching: '守望',
    arranging_herbs: '理药',
    carrying: '搬货',
    waiting: '等候',
  };
  return labels[status] ?? '停留';
}

function emojiForStatus(status: ResidentStatus) {
  const emojis: Partial<Record<ResidentStatus, string>> = {
    thinking: '💭',
    speaking: '💬',
    talking: '💬',
    trading: '💰',
    resting: '🍵',
    watching: '👁️',
    arranging_herbs: '🌿',
    carrying: '📦',
    waiting: '…',
  };
  return emojis[status] ?? '';
}

function roundTile(value: number) {
  return Math.round(value * 100) / 100;
}

function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function intentFor(role: string, locationId: string) {
  if (role === 'guard') return '守望坊市入口，留意生面孔。';
  if (role === 'merchant') return '照看摊铺货物，顺便打听今日行情。';
  if (role === 'porter') return '在码头搬运货箱，等下一艘货船靠岸。';
  if (role === 'outer_disciple') return '替宗门跑腿，在茶摊旁等人。';
  if (role === 'elder') return '在茶摊清静处暂歇，偶尔点拨后辈。';
  if (role === 'wandering_cultivator') return '暂歇客栈，观察坊市里的机会。';
  if (role === 'traveler') return '从东坊路入城，准备寻一处落脚。';
  return `停留在${locationId}附近。`;
}

function toQinglanLocationPayload(zone: (typeof QINGLAN_FANGSHI_ZONES)[number]) {
  return {
    locationId: zone.zoneId,
    name: zone.name,
    kind: zone.kind,
    mapId: QINGLAN_MAP_ID,
    dangerLevel: zone.dangerLevel,
    spiritualEnergy: zone.spiritualEnergy,
    allowedActions: zone.allowedActions,
    entryPoints: zone.entryPoints.map((entryPoint) =>
      nearestQinglanWalkableTile(entryPoint, QINGLAN_SAFE_FALLBACK_TILE),
    ),
    bounds: zone.bounds,
    description: zone.description,
  };
}

async function upsertLocation(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  loc: {
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
  },
) {
  const existing = await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) => q.eq('worldId', worldId).eq('locationId', loc.locationId))
    .first();
  if (existing) await ctx.db.patch(existing._id, loc);
  else await ctx.db.insert('locations', { worldId, ...loc });
}

async function upsertResident(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  resident: ReturnType<typeof toResidentSeed>,
) {
  const existing = await ctx.db
    .query('qinglanResidents')
    .withIndex('byResident', (q) => q.eq('worldId', worldId).eq('residentId', resident.residentId))
    .first();
  if (existing) await ctx.db.patch(existing._id, resident);
  else await ctx.db.insert('qinglanResidents', { worldId, ...resident });
}

async function ensureQinglanSurfaceSeeded(ctx: MutationCtx, worldId: Id<'worlds'>) {
  for (const zone of QINGLAN_FANGSHI_ZONES) {
    await upsertLocation(ctx, worldId, toQinglanLocationPayload(zone));
  }

  const residents = QINGLAN_TEST_AGENTS.map(toResidentSeed);
  let profiles = await ensureGodotPlayerProfile(ctx, worldId);
  for (const resident of residents) {
    await upsertResident(ctx, worldId, resident);
    profiles += await syncQinglanResidentProfile(ctx, worldId, resident);
  }

  return {
    locations: QINGLAN_FANGSHI_ZONES.length,
    residents: residents.length,
    profiles,
  };
}

async function ensureGodotPlayerProfile(ctx: MutationCtx, worldId: Id<'worlds'>) {
  const existing = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', 'godot_player'))
    .first();
  if (existing) return 0;
  await ctx.db.insert('xianxiaProfiles', {
    worldId,
    ...godotPlayerProfileSeed(QINGLAN_MAP_ID, GODOT_PLAYER_START_LOCATION_ID),
  });
  return 1;
}

async function syncQinglanResidentProfile(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  resident: Pick<
    Doc<'qinglanResidents'>,
    'actorId' | 'name' | 'role' | 'mapId' | 'currentLocationId' | 'currentIntent'
  >,
) {
  const existing = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', resident.actorId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, qinglanResidentProfilePatch(existing, resident));
  } else {
    await ctx.db.insert('xianxiaProfiles', {
      worldId,
      ...qinglanResidentProfileSeed(resident),
    });
  }
  return 1;
}

async function getSession(ctx: QueryCtx | MutationCtx, worldId: Id<'worlds'>, sessionId: string) {
  return await ctx.db
    .query('surfaceSessions')
    .withIndex('bySession', (q) => q.eq('worldId', worldId).eq('sessionId', sessionId))
    .first();
}

function defaultSession(worldId: Id<'worlds'>, sessionId: string) {
  return {
    worldId,
    sessionId,
    currentMapId: WORLD_MAP_ID,
    currentLocationId: WORLD_RETURN_LOCATION_ID,
    updatedAt: 0,
  };
}

async function upsertSurfaceSession(
  ctx: MutationCtx,
  session: {
    worldId: Id<'worlds'>;
    sessionId: string;
    currentMapId: string;
    currentLocationId: string;
    originMapId: string;
    originLocationId: string;
    updatedAt: number;
  },
) {
  const existing = await getSession(ctx, session.worldId, session.sessionId);
  if (existing) {
    await ctx.db.patch(existing._id, session);
    return { ...existing, ...session };
  }
  const _id = await ctx.db.insert('surfaceSessions', session);
  return { _id, ...session };
}

async function defaultWorldId(ctx: MutationCtx): Promise<Id<'worlds'> | null> {
  const status = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  return status?.worldId ?? null;
}
