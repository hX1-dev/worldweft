import { type Infer, v } from 'convex/values';
import { internalAction, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { ActionCtx, QueryCtx } from './_generated/server';
import { actionSource, actionType } from './xianxia/actionSchema';
import { godotPresentationPolishPreview, godotTraceChain } from './godotPresentation';
import {
  eventInvolvesActor,
  summarizeAgent,
  summarizeGodotActionTrace,
  summarizeGodotEvent,
  summarizeGodotResident,
  summarizePlayer,
  summarizeReplayTraceEntries,
} from './godotReadModel';
import { buildGodotCapabilityActions, defaultGodotRelationshipDims } from './godotCapabilities';
import {
  contractError,
  GODOT_ACTION_EXECUTION_PROTOCOL_VERSION,
  GODOT_MOVEMENT_PROTOCOL_VERSION,
} from './godotBridgeContract';
import {
  clampGodotPageLimit,
  godotActionRecordMapId,
  godotMapMatches,
  godotPageInfo,
} from './godotMapBoundary';
import { clampGodotRange, evaluateGodotSpatialState, godotLocationForTile } from './godotSpatial';
import {
  canGodotViewerReadEvent,
  canReadGodotActorPrivateState,
  godotReadProjection,
  type GodotViewerState,
} from './godotViewerPolicy';
import { isActorIncapacitated, lifeStateForHealth } from './xianxia/lifeStateLogic';
import { refreshResourceStock, resourceAccessAllowed } from './xianxia/resourceNodeLogic';
import { fatigueBand, normalizeFatigue } from './xianxia/fatigueLogic';
import { refreshShopState } from './xianxia/shopLogic';
import { readGameHour } from './xianxia/config';
import { evaluateGiftActionCooldown } from './xianxia/giftLogic';
import { evaluateTeachingActionCooldown } from './xianxia/teachingLogic';
import { requestRevision } from './xianxia/questLogic';
import { QINGLAN_VALLEY_GATE_DATA } from '../data/qinglanValleyGate.generated';
import { QINGLAN_VALLEY_GATE_MAP_ID } from './xianxia/valleyMovementContracts';

const mapTile = v.object({ x: v.number(), y: v.number() });

const godotActionArgs = {
  worldId: v.optional(v.id('worlds')),
  type: actionType,
  actorId: v.string(),
  targetId: v.optional(v.string()),
  targetActorId: v.optional(v.string()),
  mapId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  intent: v.optional(v.string()),
  actorTile: v.optional(mapTile),
  interactionRangeTiles: v.optional(v.number()),
  source: v.optional(actionSource),
  clientActionId: v.optional(v.string()),
  riskTolerance: v.optional(v.number()),
  params: v.optional(v.any()),
  metadata: v.optional(v.any()),
};
const godotActionValidator = v.object(godotActionArgs);
type GodotActionInput = Infer<typeof godotActionValidator>;

const godotCapabilitiesArgs = {
  worldId: v.optional(v.id('worlds')),
  actorId: v.string(),
  mapId: v.optional(v.string()),
  actorTile: v.optional(mapTile),
  targetActorId: v.optional(v.string()),
  locationId: v.optional(v.string()),
  interactionRangeTiles: v.optional(v.number()),
};

const godotReplayTraceArgs = {
  worldId: v.optional(v.id('worlds')),
  mapId: v.optional(v.string()),
  actorId: v.optional(v.string()),
  limit: v.optional(v.number()),
  cursor: v.optional(v.string()),
  viewerActorId: v.optional(v.string()),
  debugView: v.optional(v.boolean()),
};

type GodotSpatialArgs = {
  type: string;
  targetActorId?: string;
  actorTile?: { x: number; y: number };
  interactionRangeTiles?: number;
};

async function resolveWorldStatusForQuery(
  ctx: QueryCtx,
  worldId?: Id<'worlds'>,
): Promise<Doc<'worldStatus'>> {
  if (worldId) {
    const status = await ctx.db
      .query('worldStatus')
      .withIndex('worldId', (q) => q.eq('worldId', worldId))
      .first();
    if (!status) {
      throw new Error(`No worldStatus found for worldId ${worldId}`);
    }
    return status;
  }
  const status = await ctx.db
    .query('worldStatus')
    .filter((q) => q.eq(q.field('isDefault'), true))
    .first();
  if (!status) {
    throw new Error('No default worldStatus found. Run Convex init/dev first.');
  }
  return status;
}

type GodotPageMetadata = ReturnType<typeof godotPageInfo>;

type GodotWorldStateResult = {
  ok: true;
  worldId: Id<'worlds'>;
  mapId: string;
  readProjection: ReturnType<typeof godotReadProjection>;
  engineId: Doc<'worldStatus'>['engineId'];
  status: Doc<'worldStatus'>['status'];
  map: {
    width: number;
    height: number;
    tileDim: number;
    tileSetUrl: string;
  } | null;
  actors: {
    players: ReturnType<typeof summarizePlayer>[];
    agents: ReturnType<typeof summarizeAgent>[];
    residents: Array<ReturnType<typeof summarizeGodotResident> & { mapId: string }>;
  };
  recentEvents: ReturnType<typeof summarizeGodotEvent>[];
  pagination: {
    residents: GodotPageMetadata;
    recentEvents: GodotPageMetadata;
  };
};

type GodotRegionStateResult = {
  ok: true;
  worldId: Id<'worlds'>;
  mapId: string;
  readProjection: ReturnType<typeof godotReadProjection>;
  locations: Array<{
    locationId: string;
    name: string;
    kind: string;
    dangerLevel: number;
    spiritualEnergy: number;
    allowedActions: string[];
    bounds?: { x1: number; y1: number; x2: number; y2: number };
    entryPoints: Array<{ x: number; y: number }>;
  }>;
  residents: ReturnType<typeof summarizeGodotResident>[];
  recentEvents: ReturnType<typeof summarizeGodotEvent>[];
  pagination: {
    locations: GodotPageMetadata;
    residents: GodotPageMetadata;
    recentEvents: GodotPageMetadata;
  };
};

type GodotReplayTraceResult = {
  ok: true;
  worldId: Id<'worlds'>;
  mapId: string;
  readProjection: ReturnType<typeof godotReadProjection>;
  actorId?: string;
  limit: number;
  summary: ReturnType<typeof summarizeReplayTraceEntries>;
  entries: Array<Record<string, unknown>>;
  pagination: GodotPageMetadata & {
    scanned: number;
    filtered: number;
    scanPages: number;
  };
};

export const worldState = internalAction({
  args: {
    worldId: v.optional(v.id('worlds')),
    mapId: v.optional(v.string()),
    limit: v.optional(v.number()),
    residentsCursor: v.optional(v.string()),
    eventsCursor: v.optional(v.string()),
    viewerActorId: v.optional(v.string()),
    debugView: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<GodotWorldStateResult> => {
    const status = await ctx.runQuery(internal.godotMapPages.resolveWorld, {
      worldId: args.worldId,
    });
    const { world, worldMap } = await ctx.runQuery(internal.godotMapPages.worldBase, {
      worldId: status.worldId,
    });
    const mapId = args.mapId ?? 'qinglan';
    const limit = clampGodotPageLimit(args.limit, 12);
    const residentPage = await ctx.runQuery(internal.godotMapPages.residentsPage, {
      worldId: status.worldId,
      mapId,
      limit,
      cursor: args.residentsCursor,
    });
    const eventPage = await ctx.runQuery(internal.godotMapPages.eventsPage, {
      worldId: status.worldId,
      mapId,
      limit,
      cursor: args.eventsCursor,
    });
    const viewerState = await godotViewerStateForAction(
      ctx,
      status.worldId,
      mapId,
      args.viewerActorId,
      args.debugView,
    );
    const visibleEvents = eventPage.page.filter((event) =>
      canGodotViewerReadEvent(event, viewerState),
    );

    return {
      ok: true,
      worldId: status.worldId,
      mapId,
      readProjection: godotReadProjection(args.debugView),
      engineId: status.engineId,
      status: status.status,
      map: worldMap
        ? {
            width: worldMap.width,
            height: worldMap.height,
            tileDim: worldMap.tileDim,
            tileSetUrl: worldMap.tileSetUrl,
          }
        : null,
      actors: {
        players: world.players.map(summarizePlayer),
        agents: world.agents.map(summarizeAgent),
        residents: residentPage.page.map((resident) => ({
          ...summarizeGodotResident(resident),
          mapId: resident.mapId,
        })),
      },
      recentEvents: visibleEvents.map(summarizeGodotEvent),
      pagination: {
        residents: godotPageInfo({
          limit,
          returned: residentPage.page.length,
          isDone: residentPage.isDone,
          continueCursor: residentPage.continueCursor,
        }),
        recentEvents: godotPageInfo({
          limit,
          returned: visibleEvents.length,
          isDone: eventPage.isDone,
          continueCursor: eventPage.continueCursor,
        }),
      },
    };
  },
});

export const regionState = internalAction({
  args: {
    worldId: v.optional(v.id('worlds')),
    mapId: v.optional(v.string()),
    limit: v.optional(v.number()),
    locationsCursor: v.optional(v.string()),
    residentsCursor: v.optional(v.string()),
    eventsCursor: v.optional(v.string()),
    viewerActorId: v.optional(v.string()),
    debugView: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<GodotRegionStateResult> => {
    const status = await ctx.runQuery(internal.godotMapPages.resolveWorld, {
      worldId: args.worldId,
    });
    const mapId = args.mapId ?? 'qinglan';
    const limit = clampGodotPageLimit(args.limit, 20);
    const locationPage = await ctx.runQuery(internal.godotMapPages.locationsPage, {
      worldId: status.worldId,
      mapId,
      limit,
      cursor: args.locationsCursor,
    });
    const residentPage = await ctx.runQuery(internal.godotMapPages.residentsPage, {
      worldId: status.worldId,
      mapId,
      limit,
      cursor: args.residentsCursor,
    });
    const eventPage = await ctx.runQuery(internal.godotMapPages.eventsPage, {
      worldId: status.worldId,
      mapId,
      limit,
      cursor: args.eventsCursor,
    });
    const viewerState = await godotViewerStateForAction(
      ctx,
      status.worldId,
      mapId,
      args.viewerActorId,
      args.debugView,
    );
    const visibleEvents = eventPage.page.filter((event) =>
      canGodotViewerReadEvent(event, viewerState),
    );

    return {
      ok: true,
      worldId: status.worldId,
      mapId,
      readProjection: godotReadProjection(args.debugView),
      locations: locationPage.page.map((location) => ({
        locationId: location.locationId,
        name: location.name,
        kind: location.kind,
        dangerLevel: location.dangerLevel,
        spiritualEnergy: location.spiritualEnergy,
        allowedActions: location.allowedActions,
        bounds: location.bounds,
        entryPoints: location.entryPoints,
      })),
      residents: residentPage.page.map(summarizeGodotResident),
      recentEvents: visibleEvents.map(summarizeGodotEvent),
      pagination: {
        locations: godotPageInfo({
          limit,
          returned: locationPage.page.length,
          isDone: locationPage.isDone,
          continueCursor: locationPage.continueCursor,
        }),
        residents: godotPageInfo({
          limit,
          returned: residentPage.page.length,
          isDone: residentPage.isDone,
          continueCursor: residentPage.continueCursor,
        }),
        recentEvents: godotPageInfo({
          limit,
          returned: visibleEvents.length,
          isDone: eventPage.isDone,
          continueCursor: eventPage.continueCursor,
        }),
      },
    };
  },
});

export const actionRecord = internalQuery({
  args: {
    worldId: v.optional(v.id('worlds')),
    actionRecordId: v.id('actionRecords'),
    viewerActorId: v.optional(v.string()),
    debugView: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.actionRecordId);
    if (!record) {
      return { ok: false, error: `Action record ${args.actionRecordId} was not found.` };
    }
    if (args.worldId && record.worldId !== args.worldId) {
      return {
        ok: false,
        error: `Action record ${args.actionRecordId} does not belong to world ${args.worldId}.`,
      };
    }
    const event = await ctx.db
      .query('worldEvents')
      .withIndex('byAction', (q) => q.eq('worldId', record.worldId).eq('actionId', record._id))
      .order('desc')
      .first();
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byAction', (q) =>
        q.eq('worldId', record.worldId).eq('actionRecordId', record._id),
      )
      .order('desc')
      .first();
    if (
      !(await canGodotViewerReadActionRecord(
        ctx,
        record,
        event,
        args.viewerActorId,
        args.debugView,
      ))
    ) {
      return { ok: false, error: `Action record ${args.actionRecordId} was not found.` };
    }
    const metadata: unknown = record.metadata;
    return {
      ok: true,
      ...summarizeGodotActionTrace(record, event),
      metadata,
      execution: execution ? summarizeActionExecution(execution) : null,
    };
  },
});

export const presentationPreview = internalQuery({
  args: {
    worldId: v.optional(v.id('worlds')),
    actionRecordId: v.id('actionRecords'),
    mode: v.optional(v.string()),
    viewerActorId: v.optional(v.string()),
    debugView: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.actionRecordId);
    if (!record) {
      return { ok: false, error: `Action record ${args.actionRecordId} was not found.` };
    }
    if (args.worldId && record.worldId !== args.worldId) {
      return {
        ok: false,
        error: `Action record ${args.actionRecordId} does not belong to world ${args.worldId}.`,
      };
    }
    const event = await ctx.db
      .query('worldEvents')
      .withIndex('byAction', (q) => q.eq('worldId', record.worldId).eq('actionId', record._id))
      .order('desc')
      .first();
    if (
      !(await canGodotViewerReadActionRecord(
        ctx,
        record,
        event,
        args.viewerActorId,
        args.debugView,
      ))
    ) {
      return { ok: false, error: `Action record ${args.actionRecordId} was not found.` };
    }
    const trace = summarizeGodotActionTrace(record, event);
    const result = objectOrEmpty(record.result);
    return {
      ok: true,
      ...trace,
      polishPreview: godotPresentationPolishPreview({
        actionType: trace.actionType,
        eventType: trace.eventType,
        resultCode: trace.resultCode,
        status: trace.status,
        summary: trace.summary,
        effects: result.effects ?? event?.effects,
        mode: args.mode,
      }),
    };
  },
});

export const actorContext = internalQuery({
  args: {
    worldId: v.optional(v.id('worlds')),
    mapId: v.optional(v.string()),
    actorId: v.string(),
    viewerActorId: v.optional(v.string()),
    debugView: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const status = await resolveWorldStatusForQuery(ctx, args.worldId);
    const mapId = args.mapId ?? 'qinglan';
    const viewerActorId = args.viewerActorId ?? 'godot_player';
    const debugView = args.debugView === true;
    const privateActorState = canReadGodotActorPrivateState(viewerActorId, args.actorId, debugView);
    const resident = await loadQinglanResidentByActor(ctx, status.worldId, mapId, args.actorId);
    const profile = await loadProfile(ctx, status.worldId, args.actorId);
    const profileOnMap = profile && godotMapMatches(profile.mapId, mapId) ? profile : null;
    const viewerToActor = await loadRelationshipDimsForQuery(
      ctx,
      status.worldId,
      viewerActorId,
      args.actorId,
    );
    const actorToViewer = privateActorState
      ? await loadRelationshipDimsForQuery(ctx, status.worldId, args.actorId, viewerActorId)
      : null;
    const eventCandidates = await ctx.db
      .query('worldEvents')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', mapId))
      .order('desc')
      .take(40);
    const viewerState = await godotViewerStateForQuery(
      ctx,
      status.worldId,
      mapId,
      viewerActorId,
      debugView,
    );
    const recentEvents = eventCandidates.filter((event) =>
      canGodotViewerReadEvent(event, viewerState),
    );
    const memoryOwnerActorId = privateActorState ? args.actorId : viewerActorId;
    const memoryCandidates = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', memoryOwnerActorId),
      )
      .order('desc')
      .take(20);
    const actionRecordCandidates = await ctx.db
      .query('actionRecords')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .order('desc')
      .take(20);
    const actorEvents = recentEvents.filter((event) => eventInvolvesActor(event, args.actorId));
    const memories = [];
    for (const memory of memoryCandidates) {
      const sourceEventId = ctx.db.normalizeId('worldEvents', memory.sourceEventId);
      if (!sourceEventId) continue;
      const sourceEvent = await ctx.db.get(sourceEventId);
      if (!sourceEvent || !godotMapMatches(sourceEvent.mapId, mapId)) continue;
      if (
        !privateActorState &&
        !memory.aboutActorIds.includes(args.actorId) &&
        !eventInvolvesActor(sourceEvent, args.actorId)
      ) {
        continue;
      }
      memories.push(memory);
      if (memories.length >= 5) break;
    }
    const eventBackedActions: Array<{
      record: Doc<'actionRecords'>;
      event: Doc<'worldEvents'>;
    }> = [];
    const seenActionIds = new Set<string>();
    for (const event of actorEvents) {
      if (!event.actionId || seenActionIds.has(event.actionId)) continue;
      const record = await ctx.db.get(event.actionId as Id<'actionRecords'>);
      if (!record) continue;
      seenActionIds.add(record._id);
      eventBackedActions.push({ record, event });
      if (eventBackedActions.length >= 6) break;
    }
    const fallbackActionTraces = actionRecordCandidates
      .filter(
        (record) =>
          !seenActionIds.has(record._id) &&
          godotActionRecordMapId(record) === mapId &&
          (privateActorState || record.actorId === viewerActorId),
      )
      .map((record) => ({ record, event: null }));
    const recentActionTraces = [...eventBackedActions, ...fallbackActionTraces].slice(0, 6);

    return {
      ok: true,
      worldId: status.worldId,
      mapId,
      readProjection: godotReadProjection(debugView),
      privateActorState,
      actorId: args.actorId,
      viewerActorId,
      resident: resident ? summarizeGodotResident(resident) : null,
      profile: profileOnMap
        ? {
            actorId: profileOnMap.actorId,
            name: profileOnMap.name,
            role: profileOnMap.role,
            realm: profileOnMap.realm,
            realmStage: profileOnMap.realmStage,
            reputation: profileOnMap.reputation,
            currentLocationId: profileOnMap.currentLocationId,
            currentIntent: profileOnMap.currentIntent,
            ...(privateActorState
              ? {
                  spiritRoot: profileOnMap.spiritRoot,
                  innerTrait: profileOnMap.innerTrait,
                  outerTrait: profileOnMap.outerTrait,
                  cultivationXp: profileOnMap.cultivationXp,
                  mood: profileOnMap.mood,
                  health: profileOnMap.health,
                  spirit: profileOnMap.spirit,
                  inventoryCount:
                    profileOnMap.inventory?.reduce((sum, item) => sum + item.qty, 0) ?? 0,
                }
              : {}),
          }
        : null,
      relationship: {
        viewerToActor,
        actorToViewer,
      },
      recentActions: recentActionTraces.map(({ record, event }) =>
        summarizeGodotActionTrace(record, event),
      ),
      recentEvents: actorEvents.slice(0, 6).map(summarizeGodotEvent),
      memories: memories.map((memory) => ({
        id: memory._id,
        type: memory.type,
        salience: memory.salience,
        createdAt: memory.createdAt,
        expiresAt: memory.expiresAt,
        aboutActorIds: memory.aboutActorIds,
        summary: memory.summary,
        sourceEventId: memory.sourceEventId,
      })),
      contextWindow: {
        policy: privateActorState ? 'exact_map' : 'viewer_safe_exact_map',
        legacyMaplessEvents: 'excluded',
        events: {
          scanned: eventCandidates.length,
          returned: Math.min(actorEvents.length, 6),
          limit: 40,
          truncated: eventCandidates.length === 40 || actorEvents.length > 6,
        },
        actions: {
          scanned: actionRecordCandidates.length,
          returned: recentActionTraces.length,
          limit: 20,
          truncated: actionRecordCandidates.length === 20 || recentActionTraces.length > 6,
        },
        memories: {
          scanned: memoryCandidates.length,
          returned: memories.length,
          limit: 20,
          truncated: memoryCandidates.length === 20,
        },
        replayContinuation: '/godot/replay',
      },
    };
  },
});

export const capabilities = internalQuery({
  args: godotCapabilitiesArgs,
  handler: async (ctx, args) => {
    const status = await resolveWorldStatusForQuery(ctx, args.worldId);
    const mapId = args.mapId ?? 'qinglan';
    const range = clampGodotRange(args.interactionRangeTiles);
    const locations = await ctx.db
      .query('locations')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', mapId))
      .take(40);
    const targetResident = args.targetActorId
      ? await loadQinglanResidentByActor(ctx, status.worldId, mapId, args.targetActorId)
      : null;
    const explicitLocation = args.locationId
      ? locations.find((location) => location.locationId === args.locationId)
      : null;
    const currentLocation =
      explicitLocation ??
      (args.actorTile ? godotLocationForTile(args.actorTile, locations, Math.max(range, 4)) : null);
    const actorProfile = await loadProfile(ctx, status.worldId, args.actorId);
    const targetProfile = targetResident
      ? await loadProfile(ctx, status.worldId, targetResident.actorId)
      : null;
    const shopDoc = targetResident
      ? await ctx.db
          .query('shopInventories')
          .withIndex('byMerchant', (q) =>
            q
              .eq('worldId', status.worldId)
              .eq('merchantActorId', targetResident.actorId),
          )
          .first()
      : null;
    const shop =
      shopDoc &&
      shopDoc.mapId === mapId &&
      (!currentLocation || shopDoc.locationId === currentLocation.locationId)
        ? refreshShopState(shopDoc, Date.now()).shop
        : null;
    const targetView = targetResident
      ? await loadRelationshipDimsForQuery(
          ctx,
          status.worldId,
          targetResident.actorId,
          args.actorId,
        )
      : defaultGodotRelationshipDims();
    const actorViewOfTarget = targetResident
      ? await loadRelationshipDimsForQuery(
          ctx,
          status.worldId,
          args.actorId,
          targetResident.actorId,
        )
      : defaultGodotRelationshipDims();
    const now = Date.now();
    const latestExecution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    const activeExecution =
      latestExecution &&
      ['pending', 'accepted', 'acting'].includes(latestExecution.status) &&
      latestExecution.expiresAt > now &&
      latestExecution.hardDeadlineAt > now
        ? latestExecution
        : null;
    let teacherBusy = false;
    if (targetResident) {
      const targetOwnExecution = await ctx.db
        .query('actionExecutions')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', targetResident.actorId),
        )
        .order('desc')
        .first();
      teacherBusy = !!(
        targetOwnExecution &&
        ['pending', 'accepted', 'acting'].includes(targetOwnExecution.status) &&
        targetOwnExecution.expiresAt > now &&
        targetOwnExecution.hardDeadlineAt > now
      );
      if (!teacherBusy) {
        for (const executionStatus of ['pending', 'accepted', 'acting'] as const) {
          const lessons = await ctx.db
            .query('actionExecutions')
            .withIndex('byTargetStatus', (q) =>
              q
                .eq('worldId', status.worldId)
                .eq('targetActorId', targetResident.actorId)
                .eq('status', executionStatus),
            )
            .take(64);
          if (
            lessons.some(
              (lesson) =>
                lesson.actionType === 'request_teaching' &&
                lesson.expiresAt > now &&
                lesson.hardDeadlineAt > now,
            )
          ) {
            teacherBusy = true;
            break;
          }
        }
      }
    }
    let activeCombatEncounter = await ctx.db
      .query('combatEncounters')
      .withIndex('byAttackerStatus', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('attackerActorId', args.actorId)
          .eq('status', 'active'),
      )
      .order('desc')
      .first();
    if (!activeCombatEncounter) {
      activeCombatEncounter = await ctx.db
        .query('combatEncounters')
        .withIndex('byDefenderStatus', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('defenderActorId', args.actorId)
            .eq('status', 'active'),
        )
        .order('desc')
        .first();
    }
    let lootEncounter = null;
    if (targetProfile && currentLocation && isActorIncapacitated(targetProfile.health)) {
      for (const encounterStatus of ['attacker_defeated', 'defender_defeated'] as const) {
        const rows = await ctx.db
          .query('combatEncounters')
          .withIndex('byLocationStatus', (q) =>
            q
              .eq('worldId', status.worldId)
              .eq('mapId', mapId)
              .eq('locationId', currentLocation.locationId)
              .eq('status', encounterStatus),
          )
          .order('desc')
          .take(20);
        lootEncounter = rows.find((row) => row.defeatedActorId === targetProfile.actorId) ?? null;
        if (lootEncounter) break;
      }
    }
    const reservedTargetItems = new Map<string, number>();
    if (targetProfile) {
      for (const executionStatus of ['pending', 'accepted', 'acting'] as const) {
        const reservations = await ctx.db
          .query('actionExecutions')
          .withIndex('byTargetStatus', (q) =>
            q
              .eq('worldId', status.worldId)
              .eq('targetActorId', targetProfile.actorId)
              .eq('status', executionStatus),
          )
          .take(64);
        for (const reservation of reservations) {
          if (
            reservation.expiresAt <= now ||
            reservation.hardDeadlineAt <= now ||
            !reservation.reservedTargetItemId
          ) continue;
          reservedTargetItems.set(
            reservation.reservedTargetItemId,
            (reservedTargetItems.get(reservation.reservedTargetItemId) ?? 0) +
              (reservation.reservedTargetItemQuantity ?? 0),
          );
        }
      }
    }
    const reservedActorItems = new Map<string, number>();
    for (const executionStatus of ['pending', 'accepted', 'acting'] as const) {
      const ownReservations = await ctx.db
        .query('actionExecutions')
        .withIndex('byActorStatus', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('actorId', args.actorId)
            .eq('status', executionStatus),
        )
        .take(64);
      for (const reservation of ownReservations) {
        if (
          reservation.expiresAt <= now ||
          reservation.hardDeadlineAt <= now ||
          !reservation.reservedItemId
        ) continue;
        reservedActorItems.set(
          reservation.reservedItemId,
          (reservedActorItems.get(reservation.reservedItemId) ?? 0) +
            (reservation.reservedItemQuantity ?? 0),
        );
      }
      const targetedReservations = await ctx.db
        .query('actionExecutions')
        .withIndex('byTargetStatus', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('targetActorId', args.actorId)
            .eq('status', executionStatus),
        )
        .take(64);
      for (const reservation of targetedReservations) {
        if (
          reservation.expiresAt <= now ||
          reservation.hardDeadlineAt <= now ||
          !reservation.reservedTargetItemId
        ) continue;
        reservedActorItems.set(
          reservation.reservedTargetItemId,
          (reservedActorItems.get(reservation.reservedTargetItemId) ?? 0) +
            (reservation.reservedTargetItemQuantity ?? 0),
        );
      }
    }
    let giftCooldown: { resultCode: string; reason: string } | null = null;
    let teachingCooldown: { resultCode: string; reason: string } | null = null;
    if (targetResident) {
      const usages = await ctx.db
        .query('socialActionUsages')
        .withIndex('byActorTargetTypeDay', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('actorId', args.actorId)
            .eq('targetActorId', targetResident.actorId)
            .eq('actionType', 'gift'),
        )
        .collect();
      const gameDay = Math.floor((await readGameHour(ctx, status.worldId, now)) / 24);
      const cooldown = evaluateGiftActionCooldown(
        gameDay,
        usages.map((usage) => usage.sourceGameDay),
      );
      if (!cooldown.ok) giftCooldown = cooldown;
      const teachingUsages = await ctx.db
        .query('socialActionUsages')
        .withIndex('byActorTargetTypeDay', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', args.actorId),
        )
        .collect();
      const teachingGate = evaluateTeachingActionCooldown(
        gameDay,
        targetResident.actorId,
        teachingUsages
          .filter((usage) => usage.actionType === 'request_teaching')
          .map((usage) => ({
            targetActorId: usage.targetActorId,
            sourceGameDay: usage.sourceGameDay,
          })),
      );
      if (!teachingGate.ok) teachingCooldown = teachingGate;
    }
    const combat = {
      activeEncounterId: activeCombatEncounter?.encounterId,
      opponentActorId: activeCombatEncounter
        ? activeCombatEncounter.attackerActorId === args.actorId
          ? activeCombatEncounter.defenderActorId
          : activeCombatEncounter.attackerActorId
        : undefined,
      lootEncounterId: lootEncounter?.encounterId,
      lootOwnerActorId: lootEncounter?.lootOwnerActorId,
      lootProtectedUntil: lootEncounter?.lootProtectedUntil,
      lootPriorityAllowed:
        !!lootEncounter &&
        (!lootEncounter.lootOwnerActorId ||
          lootEncounter.lootOwnerActorId === args.actorId ||
          (lootEncounter.lootProtectedUntil ?? 0) <= now),
      lootOptions: (targetProfile?.inventory ?? [])
        .map((item) => ({
          itemId: item.itemId,
          qty: Math.max(0, item.qty - (reservedTargetItems.get(item.itemId) ?? 0)),
        }))
        .filter((item) => item.qty > 0),
    };
    const activeRequests = (
      await Promise.all(
        (['offered', 'accepted', 'ready_to_turn_in'] as const).map((requestStatus) =>
          ctx.db
            .query('requests')
            .withIndex('byAssignee', (q) =>
              q
                .eq('worldId', status.worldId)
                .eq('assigneeActorId', args.actorId)
                .eq('status', requestStatus),
            )
            .take(20),
        ),
      )
    ).flat();
    const selectedRequest =
      activeRequests
        .filter((request) => request.issuerActorId === args.targetActorId)
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
    const resourceNodeDocs = currentLocation
      ? await ctx.db
          .query('resourceNodes')
          .withIndex('byLocation', (q) =>
            q
              .eq('worldId', status.worldId)
              .eq('mapId', mapId)
              .eq('locationId', currentLocation.locationId),
          )
          .take(24)
      : [];
    const reservedByNode = new Map<string, number>();
    for (const executionStatus of ['pending', 'accepted', 'acting'] as const) {
      const activeAtMap = await ctx.db
        .query('actionExecutions')
        .withIndex('byMapStatus', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('mapId', mapId)
            .eq('status', executionStatus),
        )
        .take(64);
      for (const execution of activeAtMap) {
        if (
          !execution.resourceNodeId ||
          execution.expiresAt <= now ||
          execution.hardDeadlineAt <= now
        ) {
          continue;
        }
        reservedByNode.set(
          execution.resourceNodeId,
          (reservedByNode.get(execution.resourceNodeId) ?? 0) +
            (execution.reservedQuantity ?? 0),
        );
      }
    }
    const resourceNodes = resourceNodeDocs.map((node) => {
      const refreshed = refreshResourceStock(node, now);
      return {
        resourceNodeId: node.resourceNodeId,
        name: node.name,
        itemId: node.itemId,
        tile: node.tile,
        stock: refreshed.stock,
        available: Math.max(
          0,
          refreshed.stock - (reservedByNode.get(node.resourceNodeId) ?? 0),
        ),
        accessible: !!actorProfile && resourceAccessAllowed(node, actorProfile.actorId),
      };
    });
    const latestMovement =
      mapId === QINGLAN_VALLEY_GATE_MAP_ID
        ? await ctx.db
            .query('movementCommands')
            .withIndex('byActorRevision', (q) =>
              q.eq('worldId', status.worldId).eq('actorId', args.actorId),
            )
            .order('desc')
            .first()
        : null;
    const arrivedInteractionId =
      latestMovement?.status === 'arrived' &&
      latestMovement.requestedTarget.kind === 'interactable'
        ? latestMovement.requestedTarget.interactionId
        : undefined;
    const inspectTargets =
      mapId === QINGLAN_VALLEY_GATE_MAP_ID && currentLocation
        ? QINGLAN_VALLEY_GATE_DATA.interactions.flatMap((interaction) => {
            if (
              interaction.locationId !== currentLocation.locationId ||
              !(interaction.actions as readonly string[]).includes('inspect') ||
              !('inspection' in interaction)
            ) {
              return [];
            }
            return [{
              interactionId: interaction.id,
              name: interaction.name,
              tile: interaction.tile,
              observationId: interaction.inspection.observationId,
              observationRevision: interaction.inspection.revision,
            }];
          })
        : [];
    const baseActions = buildGodotCapabilityActions({
      actorTile: args.actorTile,
      range,
      targetResident,
      currentLocation,
      actorProfile,
      targetProfile,
      shop,
      targetView,
      actorViewOfTarget,
      resourceNodes,
      inspectTargets,
      arrivedInteractionId,
      combat,
      request: selectedRequest
        ? {
            requestId: String(selectedRequest._id),
            revision: requestRevision(selectedRequest),
            status: selectedRequest.status,
            type: selectedRequest.type,
            summary: selectedRequest.summary,
          }
        : null,
      giftCooldown,
      teachingCooldown,
      teacherBusy,
      reservedActorItems: Object.fromEntries(reservedActorItems),
    });
    const actions = activeExecution
      ? baseActions.map((action) => ({
          ...action,
          enabled: false,
          reason: `Action execution ${activeExecution.actionType} is still ${activeExecution.status}.`,
        }))
      : baseActions;

    return {
      ok: true,
      movementProtocolVersion: GODOT_MOVEMENT_PROTOCOL_VERSION,
      actionExecutionProtocolVersion: GODOT_ACTION_EXECUTION_PROTOCOL_VERSION,
      worldId: status.worldId,
      mapId,
      actorId: args.actorId,
      actorTile: args.actorTile,
      interactionRangeTiles: range,
      actorState: actorProfile
        ? {
            health: actorProfile.health,
            maxHealth: actorProfile.maxHealth ?? 10,
            lifeState: lifeStateForHealth(actorProfile.health, actorProfile.maxHealth ?? 10),
            fatigue: normalizeFatigue(actorProfile.fatigue),
            fatigueBand: fatigueBand(actorProfile.fatigue),
          }
        : null,
      activeExecution: activeExecution ? summarizeActionExecution(activeExecution) : null,
      combat,
      request: selectedRequest
        ? {
            requestId: String(selectedRequest._id),
            revision: requestRevision(selectedRequest),
            status: selectedRequest.status,
            type: selectedRequest.type,
            summary: selectedRequest.summary,
          }
        : null,
      target: targetResident
        ? {
            actorId: targetResident.actorId,
            name: targetResident.name,
            role: targetResident.role,
            tile: targetResident.displayTile,
            locationId: targetResident.currentLocationId,
          }
        : null,
      shop: shop
        ? {
            shopId: shop.shopId,
            name: shop.name,
            walletSpiritStones: shop.walletSpiritStones,
            walletCapacity: shop.walletCapacity,
            restockSourceId: shop.restockSourceId,
            nextRestockAt: shop.nextRestockAt,
            stock: shop.stock,
          }
        : null,
      currentLocation: currentLocation ? summarizeLocation(currentLocation) : null,
      actions,
    };
  },
});

export const prepareAction = internalQuery({
  args: godotActionArgs,
  handler: async (ctx, args) => {
    const status = await resolveWorldStatusForQuery(ctx, args.worldId);
    let mapId = args.mapId ?? 'qinglan';
    if (args.clientActionId) {
      const existing = await ctx.db
        .query('actionRecords')
        .withIndex('byClientAction', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('actorId', args.actorId)
            .eq('clientActionId', args.clientActionId),
        )
        .first();
      if (existing) {
        const existingMetadata = objectOrEmpty(existing.metadata);
        mapId = args.mapId ?? readString(existingMetadata.mapId) ?? mapId;
        return {
          ok: true,
          worldId: status.worldId,
          mapId,
          idempotentReplayCandidate: true,
          prepared: { actionRecordId: existing._id },
          envelope: godotActionEnvelope({
            args,
            worldId: status.worldId,
            mapId,
            locationId: args.locationId ?? existing.locationId ?? defaultLocationForMap(mapId),
          }),
        };
      }
    }
    const actorProfile = await loadProfile(ctx, status.worldId, args.actorId);
    if (!actorProfile) {
      throw contractError(
        409,
        'actor_not_initialized',
        `Actor profile ${args.actorId} is not initialized. Seed the world or use an approved fixture before submitting actions.`,
      );
    }
    const targetResident = args.targetActorId
      ? await loadQinglanResidentByActor(ctx, status.worldId, mapId, args.targetActorId)
      : null;
    const targetProfile = args.targetActorId
      ? await loadProfile(ctx, status.worldId, args.targetActorId)
      : null;
    if (args.targetActorId && !targetProfile) {
      throw contractError(
        409,
        'target_not_initialized',
        `Target profile ${args.targetActorId} is not initialized. Seed or synchronize the Convex-owned resident profile first.`,
      );
    }
    const locationId =
      args.locationId ?? actorProfile.currentLocationId ?? defaultLocationForMap(mapId);
    const location = await loadLocation(ctx, status.worldId, locationId);

    validateGodotSpatialIntent({
      args,
      mapId,
      actorProfile,
      targetResident,
      location,
      locationId,
    });
    return {
      ok: true,
      worldId: status.worldId,
      mapId,
      prepared: {
        actorProfileId: actorProfile._id,
        targetProfileId: targetProfile?._id,
        targetResidentId: targetResident?.residentId,
      },
      envelope: godotActionEnvelope({ args, worldId: status.worldId, mapId, locationId }),
    };
  },
});

function godotActionEnvelope(args: {
  args: GodotActionInput;
  worldId: Id<'worlds'>;
  mapId: string;
  locationId: string;
}) {
  const metadata = objectOrEmpty(args.args.metadata);
  const params: unknown = args.args.params;
  return {
    worldId: args.worldId,
    type: args.args.type,
    actorId: args.args.actorId,
    targetId: args.args.targetId,
    targetActorId: args.args.targetActorId,
    locationId: args.locationId,
    intent: args.args.intent,
    source: args.args.source ?? 'human',
    clientActionId: args.args.clientActionId,
    riskTolerance: args.args.riskTolerance,
    params,
    metadata: {
      ...metadata,
      client: 'godot',
      mapId: args.mapId,
      actorTile: args.args.actorTile,
      interactionRangeTiles: args.args.interactionRangeTiles,
      preparedAt: Date.now(),
    },
  };
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function defaultLocationForMap(mapId: string) {
  return mapId === 'qinglan' ? 'market_main_street' : 'mountain_gate';
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function loadProfile(ctx: QueryCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
}

async function loadLocation(ctx: QueryCtx, worldId: Id<'worlds'>, locationId: string) {
  return await ctx.db
    .query('locations')
    .withIndex('byLocationId', (q) => q.eq('worldId', worldId).eq('locationId', locationId))
    .first();
}

function validateGodotSpatialIntent(args: {
  args: GodotSpatialArgs;
  mapId: string;
  actorProfile: Doc<'xianxiaProfiles'>;
  targetResident: Doc<'qinglanResidents'> | null;
  location: Doc<'locations'> | null;
  locationId: string;
}) {
  const spatialIssue = evaluateGodotSpatialState({
    type: args.args.type,
    actorId: args.actorProfile.actorId,
    targetActorId: args.args.targetActorId,
    mapId: args.mapId,
    locationId: args.locationId,
    actorTile: args.args.actorTile,
    interactionRangeTiles: args.args.interactionRangeTiles,
    actorProfile: args.actorProfile,
    targetResident: args.targetResident,
    location: args.location,
  });
  if (spatialIssue) {
    throw contractError(spatialIssue.status, spatialIssue.resultCode, spatialIssue.reason);
  }
}

function summarizeLocation(location: Doc<'locations'>) {
  return {
    locationId: location.locationId,
    name: location.name,
    kind: location.kind,
    allowedActions: location.allowedActions,
    bounds: location.bounds,
    entryPoints: location.entryPoints,
  };
}

export const replayTrace = internalAction({
  args: godotReplayTraceArgs,
  handler: async (ctx, args): Promise<GodotReplayTraceResult> => {
    const status = await ctx.runQuery(internal.godotMapPages.resolveWorld, {
      worldId: args.worldId,
    });
    const mapId = args.mapId ?? 'qinglan';
    const limit = clampGodotPageLimit(args.limit, 12);
    const events: Doc<'worldEvents'>[] = [];
    let cursor = args.cursor;
    let isDone = false;
    let continueCursor = args.cursor ?? '';
    let scanned = 0;
    let scanPages = 0;
    const viewerState = await godotViewerStateForAction(
      ctx,
      status.worldId,
      mapId,
      args.viewerActorId,
      args.debugView,
    );
    const maxScanPages = args.actorId || args.debugView !== true ? 10 : 1;
    while (!isDone && events.length < limit && scanPages < maxScanPages) {
      const page = await ctx.runQuery(internal.godotMapPages.eventsPage, {
        worldId: status.worldId,
        mapId,
        limit: Math.max(1, limit - events.length),
        cursor,
      });
      scanned += page.page.length;
      scanPages += 1;
      for (const event of page.page) {
        if (!canGodotViewerReadEvent(event, viewerState)) continue;
        if (!args.actorId || eventInvolvesActor(event, args.actorId)) events.push(event);
      }
      isDone = page.isDone;
      continueCursor = page.continueCursor;
      cursor = page.continueCursor;
    }

    const entries: Array<Record<string, unknown>> = [];
    for (const event of events) {
      const eventSummary = summarizeGodotEvent(event);
      if (!event.actionId) {
        entries.push({
          ...eventSummary,
          source: 'replay_event',
          kind: 'event',
          traceChain: godotTraceChain({
            source: 'replay_event',
            actionType: event.type,
            worldEventId: event._id,
            resultCode: eventSummary.resultCode,
          }),
        });
        continue;
      }
      const record = await ctx.runQuery(internal.godotMapPages.actionRecordById, {
        actionRecordId: event.actionId,
      });
      if (!record) {
        entries.push({
          ...eventSummary,
          source: 'replay_event',
          kind: 'event',
          traceChain: godotTraceChain({
            source: 'replay_event',
            actionType: event.type,
            worldEventId: event._id,
            actionRecordId: event.actionId,
            resultCode: eventSummary.resultCode,
          }),
        });
        continue;
      }
      entries.push({
        ...summarizeGodotActionTrace(record, event),
        source: 'replay_action',
        kind: 'action',
        traceChain: godotTraceChain({
          source: 'replay_action',
          actionType: record.type,
          worldEventId: event._id,
          actionRecordId: record._id,
          resultCode:
            typeof objectOrEmpty(record.result).resultCode === 'string'
              ? (objectOrEmpty(record.result).resultCode as string)
              : undefined,
        }),
      });
    }

    return {
      ok: true,
      worldId: status.worldId,
      mapId,
      readProjection: godotReadProjection(args.debugView),
      actorId: args.actorId,
      limit,
      summary: summarizeReplayTraceEntries(entries),
      entries,
      pagination: {
        ...godotPageInfo({
          limit,
          returned: entries.length,
          isDone,
          continueCursor,
        }),
        scanned,
        filtered: scanned - entries.length,
        scanPages,
      },
    };
  },
});

async function godotViewerStateForAction(
  ctx: ActionCtx,
  worldId: Id<'worlds'>,
  mapId: string,
  viewerActorId: string | undefined,
  debugView: boolean | undefined,
): Promise<GodotViewerState> {
  if (debugView === true) return { viewerActorId, debugView: true };
  const state = await ctx.runQuery(internal.godotMapPages.viewerReadState, {
    worldId,
    viewerActorId,
  });
  return {
    viewerActorId,
    viewerLocationId: state.mapId === mapId ? state.locationId : undefined,
    knownEventIds: new Set(state.knownEventIds),
    debugView: false,
  };
}

async function godotViewerStateForQuery(
  ctx: QueryCtx,
  worldId: Id<'worlds'>,
  mapId: string,
  viewerActorId: string | undefined,
  debugView: boolean | undefined,
): Promise<GodotViewerState> {
  if (debugView === true) return { viewerActorId, debugView: true };
  if (!viewerActorId) return { debugView: false };
  const profile = await loadProfile(ctx, worldId, viewerActorId);
  const memories = await ctx.db
    .query('shortMemories')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', viewerActorId))
    .order('desc')
    .take(100);
  return {
    viewerActorId,
    viewerLocationId: profile?.mapId === mapId ? profile.currentLocationId : undefined,
    knownEventIds: new Set(memories.map((memory) => memory.sourceEventId)),
    debugView: false,
  };
}

async function canGodotViewerReadActionRecord(
  ctx: QueryCtx,
  record: Doc<'actionRecords'>,
  event: Doc<'worldEvents'> | null,
  viewerActorId: string | undefined,
  debugView: boolean | undefined,
) {
  if (debugView === true || record.actorId === viewerActorId) return true;
  if (!event) return false;
  const viewerState = await godotViewerStateForQuery(
    ctx,
    record.worldId,
    event.mapId ?? 'world',
    viewerActorId,
    debugView,
  );
  return canGodotViewerReadEvent(event, viewerState);
}

function summarizeActionExecution(execution: Doc<'actionExecutions'>) {
  return {
    protocolVersion: GODOT_ACTION_EXECUTION_PROTOCOL_VERSION,
    executionId: execution._id,
    actionRecordId: execution.actionRecordId,
    revision: execution.revision,
    actorId: execution.actorId,
    actionType: execution.actionType,
    status: execution.status,
    leaseOwner: execution.leaseOwner,
    mapId: execution.mapId,
    locationId: execution.locationId,
    resourceNodeId: execution.resourceNodeId,
    reservedQuantity: execution.reservedQuantity,
    cultivationMode: execution.cultivationMode,
    reservedItemId: execution.reservedItemId,
    reservedItemQuantity: execution.reservedItemQuantity,
    intent: execution.intent,
    durationMs: execution.durationMs,
    issuedAt: execution.issuedAt,
    expiresAt: execution.expiresAt,
    hardDeadlineAt: execution.hardDeadlineAt,
    acceptedAt: execution.acceptedAt,
    startedAt: execution.startedAt,
    lastHeartbeatAt: execution.lastHeartbeatAt,
    terminalAt: execution.terminalAt,
    resultCode: execution.resultCode,
    reasonCode: execution.reasonCode,
  };
}

async function loadRelationshipDimsForQuery(
  ctx: QueryCtx,
  worldId: Id<'worlds'>,
  from: string,
  to: string,
) {
  const rel = await ctx.db
    .query('relationships')
    .withIndex('pair', (q) => q.eq('worldId', worldId).eq('fromActorId', from).eq('toActorId', to))
    .first();
  return {
    affinity: rel?.value ?? 0,
    trust: rel?.trust ?? 0,
    suspicion: rel?.suspicion ?? 0,
    tags: rel?.tags ?? [],
  };
}

async function loadQinglanResidentByActor(
  ctx: QueryCtx,
  worldId: Id<'worlds'>,
  mapId: string,
  actorId: string,
) {
  return await ctx.db
    .query('qinglanResidents')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .filter((q) => q.eq(q.field('mapId'), mapId))
    .first();
}
