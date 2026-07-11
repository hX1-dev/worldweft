#!/usr/bin/env node

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api.js';
import {
  AgentSoakBudget,
  actorContextDelta,
  actorContextSnapshot,
  readAgentSoakConfig,
  relationshipEffects,
} from './agent_soak_policy.mjs';

const baseUrl = (process.env.GODOT_BRIDGE_URL ?? 'http://127.0.0.1:3211').replace(/\/$/, '');
const convexUrl = process.env.GODOT_CONVEX_URL ?? defaultConvexUrlForBridge(baseUrl);
const debugToken = process.env.GODOT_BRIDGE_DEBUG_TOKEN?.trim();
const contractVersion = 'godot_bridge_v1';
const mapId = process.env.GODOT_MAP_ID ?? 'qinglan';
const config = readAgentSoakConfig();
const iterations = config.ticks;
const tickLimit = config.tickLimit;
const delayMs = config.delayMs;
const contextActorLimit = config.contextActors;
const budget = new AgentSoakBudget(config);
const convexClient = new ConvexHttpClient(convexUrl);

if (!debugToken) {
  throw new Error('GODOT_BRIDGE_DEBUG_TOKEN is required for the agent soak check.');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function defaultConvexUrlForBridge(url) {
  try {
    const parsed = new URL(url);
    if (parsed.port === '3211') parsed.port = '3210';
    return parsed.origin;
  } catch {
    return 'http://127.0.0.1:3210';
  }
}

function asObject(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function asArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  return value;
}

async function requestJson(path, options = {}) {
  budget.assertRuntime(path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  let response;
  let body;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${debugToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      signal: controller.signal,
    });
    body = await boundedResponseText(response, path, config.maxResponseBytes);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${path} exceeded request timeout (${config.requestTimeoutMs}ms).`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  budget.observeResponse(path, body.bytes);
  budget.assertRuntime(path);
  let payload;
  try {
    payload = JSON.parse(body.text);
  } catch {
    throw new Error(`${path} did not return JSON: ${body.text.slice(0, 300)}`);
  }
  assert(payload?.contractVersion === contractVersion, `${path} contractVersion must match`);
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return asObject(payload, path);
}

async function boundedResponseText(response, label, maxBytes) {
  const advertisedBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(advertisedBytes) && advertisedBytes > maxBytes) {
    await response.body?.cancel();
    throw new Error(`${label} response exceeded byte budget (${advertisedBytes} > ${maxBytes}).`);
  }
  if (!response.body) return { text: '', bytes: 0 };

  const chunks = [];
  const reader = response.body.getReader();
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} response exceeded byte budget (${bytes} > ${maxBytes}).`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(combined), bytes };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryString(params) {
  return new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
  ).toString();
}

function residentSignature(resident) {
  const tile = resident?.tile ?? {};
  const targetTile = resident?.targetTile ?? {};
  const finalTargetTile = resident?.finalTargetTile ?? {};
  return JSON.stringify({
    actorId: resident?.actorId ?? '',
    x: Number(tile.x ?? 0).toFixed(3),
    y: Number(tile.y ?? 0).toFixed(3),
    targetX: Number(targetTile.x ?? 0).toFixed(3),
    targetY: Number(targetTile.y ?? 0).toFixed(3),
    finalX: Number(finalTargetTile.x ?? 0).toFixed(3),
    finalY: Number(finalTargetTile.y ?? 0).toFixed(3),
    status: resident?.status ?? '',
    activityLabel: resident?.activityLabel ?? '',
    intent: resident?.intent ?? '',
    locationId: resident?.locationId ?? '',
    waypointId: resident?.waypointId ?? '',
  });
}

function residentSignatureMap(residents) {
  return new Map(residents.map((resident) => [resident?.actorId, residentSignature(resident)]));
}

function signaturesChanged(before, residents) {
  return residents.some((resident) => before.get(resident?.actorId) !== residentSignature(resident));
}

function assertPresentationFields(value, label) {
  assert(typeof value?.bubbleText === 'string' && value.bubbleText.length > 0, `${label} must include bubbleText`);
  assert(
    ['dialogue', 'reaction', 'narration', 'warning'].includes(value?.bubbleKind),
    `${label} must include bubbleKind`,
  );
  assert(typeof value?.displayText === 'string' && value.displayText.length > 0, `${label} must include displayText`);
  assert(
    typeof value?.presentationSource === 'string' && value.presentationSource.length > 0,
    `${label} must include presentationSource`,
  );
  assert(
    typeof value?.durableSummary === 'string' && value.durableSummary.length > 0,
    `${label} must include durableSummary`,
  );
  if (typeof value?.summary === 'string' && value.summary.length > 0) {
    assert(value.durableSummary === value.summary, `${label} durableSummary must match summary`);
  }
  const policy = asObject(value?.presentationPolicy, `${label}.presentationPolicy`);
  assert(policy.durableSummaryLocked === true, `${label} must lock durable summary`);
  assert(policy.llmMayChangeFacts === false, `${label} must forbid fact changes`);
  assert(policy.llmMayChangeDurableState === false, `${label} must forbid durable state changes`);
  assertTraceChain(value, label);
}

function assertTraceChain(value, label) {
  const chain = asObject(value?.traceChain, `${label}.traceChain`);
  assert(typeof chain.source === 'string' && chain.source.length > 0, `${label} traceChain must include source`);
  assert(
    ['action_record_linked', 'event_only', 'action_record_only', 'tick_only', 'unlinked'].includes(chain.linkStatus),
    `${label} traceChain must include linkStatus`,
  );
  assert(typeof chain.durable === 'boolean', `${label} traceChain must include durable boolean`);
  assert(typeof chain.tickOnly === 'boolean', `${label} traceChain must include tickOnly boolean`);
  const steps = asArray(chain.steps, `${label}.traceChain.steps`);
  assert(steps.length > 0, `${label} traceChain must include lifecycle steps`);
  if (value?.tickOnly === true) {
    assert(chain.linkStatus === 'tick_only', `${label} tickOnly traceChain must be tick_only`);
    assert(chain.durable === false, `${label} tickOnly traceChain must not be durable`);
    assert(steps.some((step) => step?.kind === 'tick_only'), `${label} tickOnly traceChain must include tick_only step`);
  }
  if (value?.actionRecordId && value?.worldEventId && value?.tickOnly !== true) {
    assert(chain.linkStatus === 'action_record_linked', `${label} linked traceChain must mark action_record_linked`);
    assert(
      steps.some((step) => step?.kind === 'action_record' || step?.kind === 'action_record_readback'),
      `${label} linked traceChain must include actionRecord step`,
    );
    assert(
      steps.some((step) => step?.kind === 'world_event' || step?.kind === 'region_event'),
      `${label} linked traceChain must include worldEvent step`,
    );
  }
}

function assertResidentRoutePreview(resident, label) {
  const route = asObject(resident?.routePreview, `${label}.routePreview`);
  assert(typeof route.routeId === 'string' && route.routeId.length > 0, `${label} routePreview must include routeId`);
  assert(typeof route.label === 'string' && route.label.length > 0, `${label} routePreview must include label`);
  assert(typeof route.waypointId === 'string' && route.waypointId.length > 0, `${label} routePreview must include waypointId`);
  assert(typeof route.waypointLabel === 'string' && route.waypointLabel.length > 0, `${label} routePreview must include waypointLabel`);
  assert(route.label === route.waypointLabel, `${label} routePreview label must match waypointLabel`);
  assert(typeof route.locationId === 'string' && route.locationId.length > 0, `${label} routePreview must include locationId`);
  assert(['connected', 'disconnected'].includes(route.status), `${label} routePreview must include status`);
  assert(typeof route.connected === 'boolean', `${label} routePreview must include connected`);
  assert(route.connected === (route.status === 'connected'), `${label} routePreview status and connected flag must agree`);
  assert(['resident_path', 'navigation_graph'].includes(route.source), `${label} routePreview must include source`);
  assertTile(route.currentTile, `${label}.routePreview.currentTile`);
  assertTile(route.targetTile, `${label}.routePreview.targetTile`);
  assertTile(route.finalTargetTile, `${label}.routePreview.finalTargetTile`);
  assertTile(route.nextTile, `${label}.routePreview.nextTile`);
  assert(typeof route.lengthTiles === 'number', `${label} routePreview must include lengthTiles`);
  assert(typeof route.remainingTiles === 'number', `${label} routePreview must include remainingTiles`);
  assert(typeof route.etaLabel === 'string' && route.etaLabel.length > 0, `${label} routePreview must include etaLabel`);
  assert(typeof route.progressLabel === 'string' && route.progressLabel.length > 0, `${label} routePreview must include progressLabel`);
  assert(typeof route.routeSummary === 'string' && route.routeSummary.length > 0, `${label} routePreview must include routeSummary`);
  assert(
    ['arrived', 'moving', 'scheduled', 'disconnected'].includes(route.movementState),
    `${label} routePreview must include movementState`,
  );
  const pathTiles = asArray(route.pathTiles, `${label}.routePreview.pathTiles`);
  assert(pathTiles.length >= 1, `${label} routePreview pathTiles must not be empty`);
  pathTiles.forEach((tile, index) => assertTile(tile, `${label}.routePreview.pathTiles[${index}]`));
  assert(route.pathStepCount === pathTiles.length, `${label} routePreview pathStepCount must match pathTiles`);
  assert(sameTile(route.currentTile, pathTiles[0]), `${label} routePreview currentTile must be first path tile`);
  assertRouteTextMatchesState(route, label);
  const schedulePreview = asObject(route.schedulePreview, `${label}.routePreview.schedulePreview`);
  assert(
    ['at_waypoint', 'en_route', 'scheduled', 'rerouting'].includes(schedulePreview.phase),
    `${label} schedulePreview must include phase`,
  );
  assert(schedulePhaseForRoute(route.movementState) === schedulePreview.phase, `${label} schedulePreview phase must match movementState`);
  assert(typeof schedulePreview.activityLabel === 'string' && schedulePreview.activityLabel.length > 0, `${label} schedulePreview must include activityLabel`);
  assert(typeof schedulePreview.destinationLabel === 'string' && schedulePreview.destinationLabel.length > 0, `${label} schedulePreview must include destinationLabel`);
  assert(schedulePreview.destinationLabel === route.waypointLabel, `${label} schedulePreview destinationLabel must match waypointLabel`);
  assert(typeof schedulePreview.destinationLocationId === 'string' && schedulePreview.destinationLocationId.length > 0, `${label} schedulePreview must include destinationLocationId`);
  assert(schedulePreview.destinationLocationId === route.locationId, `${label} schedulePreview destinationLocationId must match route locationId`);
  assert(typeof schedulePreview.summary === 'string' && schedulePreview.summary.length > 0, `${label} schedulePreview must include summary`);
  assert(typeof schedulePreview.intent === 'string' && schedulePreview.intent.length > 0, `${label} schedulePreview must include intent`);
  assert(typeof schedulePreview.nextActionAt === 'number', `${label} schedulePreview must include nextActionAt`);
  const scheduleRoute = asObject(route.scheduleRoute, `${label}.routePreview.scheduleRoute`);
  assert(['resident_route', 'role_route'].includes(scheduleRoute.source), `${label} scheduleRoute must include source`);
  assert(typeof scheduleRoute.routeId === 'string' && scheduleRoute.routeId.length > 0, `${label} scheduleRoute must include routeId`);
  assert(typeof scheduleRoute.routeCount === 'number' && scheduleRoute.routeCount >= 1, `${label} scheduleRoute must include routeCount`);
  assert(typeof scheduleRoute.currentIndex === 'number', `${label} scheduleRoute must include currentIndex`);
  assert(scheduleRoute.currentIndex >= 0 && scheduleRoute.currentIndex < scheduleRoute.routeCount, `${label} scheduleRoute currentIndex must be in range`);
  const currentStop = assertScheduleStop(scheduleRoute.currentStop, `${label}.scheduleRoute.currentStop`);
  const nextStop = assertScheduleStop(scheduleRoute.nextStop, `${label}.scheduleRoute.nextStop`);
  assert(currentStop.spotId === route.waypointId, `${label} scheduleRoute currentStop must match waypointId`);
  assert(currentStop.locationId === route.locationId, `${label} scheduleRoute currentStop must match route locationId`);
  assert(currentStop.offset === 0, `${label} scheduleRoute currentStop offset must be 0`);
  assert(nextStop.offset === 1, `${label} scheduleRoute nextStop offset must be 1`);
  const upcomingStops = asArray(scheduleRoute.upcomingStops, `${label}.scheduleRoute.upcomingStops`);
  assert(upcomingStops.length >= 1, `${label} scheduleRoute must include upcoming stops`);
  const checkedUpcomingStops = upcomingStops.map((stop, index) =>
    assertScheduleStop(stop, `${label}.scheduleRoute.upcomingStops[${index}]`),
  );
  assert(checkedUpcomingStops[0].spotId === nextStop.spotId, `${label} scheduleRoute first upcoming stop must be nextStop`);
  assert(
    checkedUpcomingStops.every((stop, index) => stop.offset === index + 1),
    `${label} scheduleRoute upcoming offsets must be sequential`,
  );
}

function assertScheduleStop(stopValue, label) {
  const stop = asObject(stopValue, label);
  assert(typeof stop.spotId === 'string' && stop.spotId.length > 0, `${label} must include spotId`);
  assert(typeof stop.label === 'string' && stop.label.length > 0, `${label} must include label`);
  assert(typeof stop.locationId === 'string' && stop.locationId.length > 0, `${label} must include locationId`);
  assertTile(stop.tile, `${label}.tile`);
  assert(typeof stop.intent === 'string' && stop.intent.length > 0, `${label} must include intent`);
  assert(typeof stop.offset === 'number', `${label} must include offset`);
  return stop;
}

function assertTile(tile, label) {
  assert(tile && typeof tile.x === 'number' && typeof tile.y === 'number', `${label} must include x/y`);
}

function sameTile(a, b) {
  return Math.abs(Number(a?.x ?? 0) - Number(b?.x ?? 0)) < 0.001 &&
    Math.abs(Number(a?.y ?? 0) - Number(b?.y ?? 0)) < 0.001;
}

function schedulePhaseForRoute(movementState) {
  if (movementState === 'arrived') return 'at_waypoint';
  if (movementState === 'moving') return 'en_route';
  if (movementState === 'disconnected') return 'rerouting';
  return 'scheduled';
}

function assertRouteTextMatchesState(route, label) {
  if (route.movementState === 'arrived') {
    assert(route.etaLabel === 'arrived', `${label} arrived route must use arrived etaLabel`);
    assert(route.progressLabel === 'at destination', `${label} arrived route must use at-destination progress`);
    assert(route.routeSummary.includes(route.waypointLabel), `${label} arrived route summary must include waypoint`);
    return;
  }
  if (route.movementState === 'disconnected') {
    assert(route.etaLabel === 'rerouting', `${label} disconnected route must use rerouting etaLabel`);
    assert(route.progressLabel === 'needs reroute', `${label} disconnected route must use needs-reroute progress`);
    assert(route.routeSummary.includes(route.waypointLabel), `${label} disconnected route summary must include waypoint`);
    return;
  }
  assert(route.progressLabel.includes('tiles remaining'), `${label} active route must include remaining-tile progress`);
  assert(route.routeSummary.includes(route.waypointLabel), `${label} active route summary must include waypoint`);
}

function assertResidentPresenceFields(residents, label) {
  assert(residents.length > 0, `${label} must include residents`);
  for (const resident of residents) {
    assert(typeof resident?.actorId === 'string' && resident.actorId.length > 0, `${label} resident must include actorId`);
    assert(typeof resident?.status === 'string' && resident.status.length > 0, `${label} ${resident?.actorId} must include status`);
    assert(typeof resident?.activityLabel === 'string' && resident.activityLabel.length > 0, `${label} ${resident?.actorId} must include activityLabel`);
    assert(typeof resident?.intent === 'string' && resident.intent.length > 0, `${label} ${resident?.actorId} must include intent`);
    assert(typeof resident?.waypointId === 'string' && resident.waypointId.length > 0, `${label} ${resident?.actorId} must include waypointId`);
    assert(typeof resident?.updatedAt === 'number', `${label} ${resident?.actorId} must include updatedAt`);
    assertResidentRoutePreview(resident, `${label} ${resident?.actorId}`);
  }
}

async function assertActionRecordReadback(worldId, event, label) {
  if (!event?.actionRecordId) return null;
  const query = queryString({
    worldId,
    actionRecordId: String(event.actionRecordId),
  });
  const record = await requestJson(`/godot/actionRecord?${query}`);
  assert(record.ok === true, `${label} actionRecord readback must be ok`);
  assert(record.actionRecordId === event.actionRecordId, `${label} actionRecordId must match tick event`);
  if (event.worldEventId) {
    assert(record.worldEventId === event.worldEventId, `${label} worldEventId must match tick event`);
  }
  assertPresentationFields(record, `${label} actionRecord`);
  return record;
}

async function assertReplayTrace(worldId, actorId, expectedActionRecordId) {
  const query = queryString({
    worldId,
    mapId,
    actorId,
    limit: '12',
  });
  const replay = await requestJson(`/godot/replay?${query}`);
  assert(replay.ok === true, 'replay trace must be ok');
  assert(replay.worldId === worldId, 'replay trace worldId must match');
  assert(replay.mapId === mapId, 'replay trace mapId must match');
  const entries = asArray(replay.entries, 'replay.entries');
  if (expectedActionRecordId) {
    assert(entries.length > 0, 'replay trace with an expected actionRecord must include entries');
  }
  const summary = asObject(replay.summary, 'replay.summary');
  assert(summary.entryCount === entries.length, 'replay summary entryCount must match entries');
  assert(typeof summary.linkedCount === 'number', 'replay summary must include linkedCount');
  assert(typeof summary.durableCount === 'number', 'replay summary must include durableCount');
  assert(typeof summary.generatedAt === 'number', 'replay summary must include generatedAt');
  for (const [index, entry] of entries.entries()) {
    assertPresentationFields(entry, `replay.entries[${index}]`);
  }
  if (expectedActionRecordId) {
    assert(
      entries.some((entry) => entry?.actionRecordId === expectedActionRecordId),
      `replay trace must include expected actionRecord ${expectedActionRecordId}`,
    );
  }
  return replay;
}

function assertRelationshipDims(value, label) {
  const dims = asObject(value, label);
  assert(typeof dims.affinity === 'number', `${label} must include numeric affinity`);
  assert(typeof dims.trust === 'number', `${label} must include numeric trust`);
  assert(typeof dims.suspicion === 'number', `${label} must include numeric suspicion`);
  assert(Array.isArray(dims.tags), `${label} must include tags array`);
}

function assertMemoryEntries(value, label) {
  const memories = asArray(value, label);
  for (const [index, memory] of memories.entries()) {
    assert(typeof memory?.id === 'string' && memory.id.length > 0, `${label}[${index}] must include id`);
    assert(typeof memory?.type === 'string' && memory.type.length > 0, `${label}[${index}] must include type`);
    assert(typeof memory?.summary === 'string' && memory.summary.length > 0, `${label}[${index}] must include summary`);
    assert(typeof memory?.salience === 'number', `${label}[${index}] must include salience`);
    assert(typeof memory?.createdAt === 'number', `${label}[${index}] must include createdAt`);
    assert(typeof memory?.expiresAt === 'number', `${label}[${index}] must include expiresAt`);
    assert(typeof memory?.sourceEventId === 'string' && memory.sourceEventId.length > 0, `${label}[${index}] must include sourceEventId`);
    assert(Array.isArray(memory?.aboutActorIds), `${label}[${index}] must include aboutActorIds`);
  }
  return memories.length;
}

async function assertActorContext(
  worldId,
  actorId,
  expectedActionRecordId,
  expectedWorldEventId,
  viewerActorId = 'godot_player',
) {
  const query = queryString({
    worldId,
    mapId,
    actorId,
    viewerActorId,
  });
  const context = await requestJson(`/godot/actorContext?${query}`);
  assert(context.ok === true, 'actorContext must be ok');
  assert(context.worldId === worldId, 'actorContext worldId must match');
  assert(context.actorId === actorId, 'actorContext actorId must match');
  assert(context.viewerActorId === viewerActorId, 'actorContext viewerActorId must match');
  assert(context.resident?.actorId === actorId, 'actorContext must include selected resident');
  assertResidentRoutePreview(context.resident, 'actorContext resident');
  assert(context.profile?.actorId === actorId, 'actorContext must include profile');
  assertRelationshipDims(context.relationship?.viewerToActor, 'actorContext.relationship.viewerToActor');
  assertRelationshipDims(context.relationship?.actorToViewer, 'actorContext.relationship.actorToViewer');
  assert(Array.isArray(context.recentEvents), 'actorContext must include recentEvents');
  assert(Array.isArray(context.recentActions), 'actorContext must include recentActions');
  const memoryCount = assertMemoryEntries(context.memories, 'actorContext.memories');
  if (context.recentEvents.length > 0) {
    assertPresentationFields(context.recentEvents[0], 'actorContext recentEvents[0]');
  }
  if (context.recentActions.length > 0) {
    assertPresentationFields(context.recentActions[0], 'actorContext recentActions[0]');
  }
  if (expectedActionRecordId) {
    assert(
      context.recentActions.some((action) => action?.actionRecordId === expectedActionRecordId),
      `actorContext recentActions must include expected actionRecord ${expectedActionRecordId}`,
    );
  }
  if (expectedWorldEventId) {
    assert(
      context.recentEvents.some((event) => event?.worldEventId === expectedWorldEventId),
      `actorContext recentEvents must include expected worldEvent ${expectedWorldEventId}`,
    );
  }
  return { context, memoryCount };
}

async function assertControlledSocialDelta(region) {
  const actorId = `godot_smoke_soak_${Date.now().toString(36)}`;
  const locations = asArray(region.locations, 'controlled soak region.locations');
  const sparLocations = new Set(
    locations
      .filter((location) => Array.isArray(location?.allowedActions) && location.allowedActions.includes('spar'))
      .map((location) => location.locationId),
  );
  const target = asArray(region.residents, 'controlled soak region.residents').find(
    (resident) => sparLocations.has(resident?.locationId),
  );
  assert(target?.actorId, 'controlled soak requires a resident at a spar-enabled location');
  assert(target?.locationId, 'controlled soak target must include locationId');
  assertTile(target?.tile, 'controlled soak target.tile');

  const fixture = await convexClient.mutation(api.godotTesting.primeGodotSoakActor, {
    actorId,
    mapId,
    locationId: target.locationId,
  });
  assert(fixture.worldId === region.worldId, 'controlled soak fixture must use the active world');
  try {
    const before = await assertActorContext(region.worldId, target.actorId, undefined, undefined, actorId);
    const action = await requestJson('/godot/action', {
      method: 'POST',
      body: JSON.stringify({
        worldId: region.worldId,
        actorId,
        clientActionId: `soak:${actorId}:spar:1`,
        type: 'spar',
        mapId,
        locationId: target.locationId,
        actorTile: target.tile,
        targetActorId: target.actorId,
        intent: 'Long-soak controlled social delta verification.',
        metadata: { test: 'godot-taixu-client/tools/check_agent_soak.mjs' },
      }),
    });
    assert(action.actionRecordId, 'controlled spar must include actionRecordId');
    assert(action.eventId, 'controlled spar must include eventId');
    assert(action.result?.status === 'applied', 'controlled spar must be applied by Convex rules');
    const record = await assertActionRecordReadback(
      region.worldId,
      {
        actionRecordId: action.actionRecordId,
        worldEventId: action.eventId,
      },
      'controlled soak spar',
    );
    const actionRelationshipEffects = relationshipEffects(action.result?.effects);
    const recordRelationshipEffects = relationshipEffects(record?.effects);
    assert(actionRelationshipEffects.length > 0, 'controlled spar must expose relationship effects');
    assert(
      JSON.stringify(actionRelationshipEffects) === JSON.stringify(recordRelationshipEffects),
      'controlled spar relationship effects must match actionRecord readback',
    );
    const after = await assertActorContext(
      region.worldId,
      target.actorId,
      action.actionRecordId,
      action.eventId,
      actorId,
    );
    const delta = actorContextDelta(
      actorContextSnapshot(before.context),
      actorContextSnapshot(after.context),
    );
    assert(delta.addedMemoryIds.length > 0, 'controlled spar must create event-backed memory');
    assert(
      delta.relationshipDimensionsChanged > 0,
      'controlled spar must persist a visible relationship dimension change',
    );
    console.log(
      `ok controlled social delta: ${delta.addedMemoryIds.length} memory, ${actionRelationshipEffects.length} relationship effect(s), trace ${action.actionRecordId}->${action.eventId}`,
    );
    return {
      addedMemoryCount: delta.addedMemoryIds.length,
      addedActionCount: delta.addedActionRecordIds.length,
      addedEventCount: delta.addedWorldEventIds.length,
      relationshipEffectCount: actionRelationshipEffects.length,
      relationshipDeltaMagnitude: actionRelationshipEffects.reduce(
        (sum, effect) => sum + Math.abs(effect.delta),
        0,
      ),
      relationshipDimensionsChanged: delta.relationshipDimensionsChanged,
      actionRecordReadbackCount: record ? 1 : 0,
    };
  } finally {
    const cleanup = await cleanupControlledSoakActor(actorId);
    assert(cleanup.durableTracePreserved === true, 'controlled soak cleanup must preserve trace');
    console.log(
      `ok controlled social cleanup: ${cleanup.pages} bounded page(s), profile ${cleanup.profilesDeleted}, relationships ${cleanup.relationshipsDeleted}, memories ${cleanup.memoriesDeleted}`,
    );
  }
}

async function cleanupControlledSoakActor(actorId) {
  const totals = {
    pages: 0,
    profilesDeleted: 0,
    relationshipsDeleted: 0,
    memoriesDeleted: 0,
    requestsDeleted: 0,
    durableTracePreserved: true,
  };
  let phase = 'profile';
  let cursor = null;
  for (let pageNumber = 1; pageNumber <= 1000; pageNumber += 1) {
    const result = await convexClient.mutation(api.godotTesting.cleanupGodotSmokeFixture, {
      actorId,
      phase,
      cursor,
      limit: 50,
    });
    assert(result.actorId === actorId, 'controlled soak cleanup actor must match');
    assert(result.phase === phase, 'controlled soak cleanup phase must match');
    assert(result.durableTracePreserved === true, 'controlled soak cleanup must preserve trace');
    totals.pages += 1;
    totals.profilesDeleted += result.profilesDeleted;
    totals.relationshipsDeleted += result.relationshipsDeleted;
    totals.memoriesDeleted += result.memoriesDeleted;
    totals.requestsDeleted += result.requestsDeleted;
    if (result.done === true) return totals;
    if (result.phaseDone === true) {
      assert(typeof result.nextPhase === 'string', 'completed cleanup phase must provide nextPhase');
      phase = result.nextPhase;
      cursor = null;
    } else if (result.repeatCursor === true) {
      cursor = result.continueCursor ?? null;
    } else {
      assert(
        typeof result.continueCursor === 'string' && result.continueCursor.length > 0,
        'open cleanup phase must provide continueCursor',
      );
      cursor = result.continueCursor;
    }
  }
  throw new Error(`controlled soak cleanup exceeded 1000 bounded pages for ${actorId}`);
}

function residentActorSet(region) {
  return new Set(asArray(region.residents, 'region.residents').map((resident) => resident?.actorId));
}

function residentActorForEvent(event, knownResidents) {
  const actorIds = [
    ...asArray(event.actorIds ?? [], 'tickEvent.actorIds'),
    ...asArray(event.targetActorIds ?? [], 'tickEvent.targetActorIds'),
  ];
  return actorIds.find((actorId) => knownResidents.has(actorId));
}

function residentActorsForEvent(event, knownResidents) {
  const actorIds = [
    ...asArray(event.actorIds ?? [], 'tickEvent.actorIds'),
    ...asArray(event.targetActorIds ?? [], 'tickEvent.targetActorIds'),
  ];
  return [...new Set(actorIds.filter((actorId) => knownResidents.has(actorId)))];
}

function assertTickScheduler(tick, tickResults, tickNumber) {
  const scheduler = asObject(tick?.scheduler, `tick ${tickNumber}.scheduler`);
  assert(scheduler.scope === mapId, `tick ${tickNumber} scheduler scope must match mapId`);
  assert(
    typeof scheduler.eligibleCount === 'number' && scheduler.eligibleCount >= 0,
    `tick ${tickNumber} scheduler must include eligibleCount`,
  );
  assert(typeof scheduler.wrapped === 'boolean', `tick ${tickNumber} scheduler must include wrapped`);
  const actorIds = asArray(scheduler.actorIds, `tick ${tickNumber}.scheduler.actorIds`);
  assert(actorIds.length === tick.ticked, `tick ${tickNumber} scheduler size must match ticked`);
  assert(new Set(actorIds).size === actorIds.length, `tick ${tickNumber} scheduler batch must be unique`);
  assert(
    actorIds.every(
      (actorId) => actorId !== 'godot_player' && !String(actorId).startsWith('godot_smoke_'),
    ),
    `tick ${tickNumber} scheduler must exclude Godot-controlled actors`,
  );
  assert(
    JSON.stringify(actorIds) === JSON.stringify(tickResults.map((result) => result?.actorId)),
    `tick ${tickNumber} scheduler order must match results`,
  );
  return scheduler;
}

console.log(
  `Checking Godot agent soak at ${baseUrl} for map ${mapId} (${iterations} tick(s), limit ${tickLimit}, runtime budget ${config.maxRuntimeMs}ms)`,
);

const health = await requestJson('/godot');
assert(health.ok === true, '/godot health must be ok');
assert(
  health.routes?.tick === 'POST /godot/tick (debug credential only)',
  '/godot must advertise debug-only POST /godot/tick',
);
assert(health.routes?.actorContext === 'GET /godot/actorContext?actorId=...', '/godot must advertise actorContext');
assert(health.routes?.replay === 'GET /godot/replay?mapId=qinglan', '/godot must advertise replay');
assert(health.routes?.actionRecord === 'GET /godot/actionRecord?actionRecordId=...', '/godot must advertise actionRecord');
console.log('ok health route');

let region = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}`);
assert(region.ok === true, 'initial regionState must be ok');
assert(region.worldId, 'initial regionState must include worldId');
assert(region.mapId === mapId, 'initial regionState mapId must match');
let residents = asArray(region.residents, 'initial regionState.residents');
assertResidentPresenceFields(residents, 'initial regionState');
let previousSignatures = residentSignatureMap(residents);
let residentChangeCount = 0;
let qinglanUpdatedTotal = 0;
let durableTickEvent = null;
let durableTickActorId = '';
let tickOnlyCount = 0;
let actionRecordReadbackCount = 0;
let actorContextReadbackCount = 0;
let memoryReadbackCount = 0;
let addedMemoryCount = 0;
let addedActionCount = 0;
let addedEventCount = 0;
let relationshipEffectCount = 0;
let relationshipDeltaMagnitude = 0;
let relationshipDimensionsChanged = 0;
let schedulerEligibleCount = null;
const durableEventsByActor = new Map();
const scheduledActorIds = new Set();
const baselineContexts = new Map();
const initialContextActorIds = residents
  .map((resident) => resident?.actorId)
  .filter(Boolean)
  .slice(0, contextActorLimit);

for (const actorId of initialContextActorIds) {
  const { context, memoryCount } = await assertActorContext(region.worldId, actorId);
  baselineContexts.set(actorId, actorContextSnapshot(context));
  actorContextReadbackCount += 1;
  memoryReadbackCount += memoryCount;
}
console.log(`ok baseline actorContext: ${baselineContexts.size} resident(s)`);

for (let index = 0; index < iterations; index += 1) {
  const tickNumber = index + 1;
  const tick = await requestJson('/godot/tick', {
    method: 'POST',
    body: JSON.stringify({
      worldId: region.worldId,
      mapId,
      limit: tickLimit,
    }),
  });
  assert(tick.ok === true, `tick ${tickNumber} response must be ok`);
  assert(tick.worldId === region.worldId, `tick ${tickNumber} worldId must match`);
  assert(typeof tick.qinglan?.checked === 'number', `tick ${tickNumber} must include qinglan.checked`);
  assert(typeof tick.qinglan?.updated === 'number', `tick ${tickNumber} must include qinglan.updated`);
  assert(typeof tick.tick?.ticked === 'number', `tick ${tickNumber} must include tick.ticked`);
  const tickResults = asArray(tick.tick?.results, `tick ${tickNumber}.results`);
  assert(
    tickResults.every((result) => {
      const resultActorId = String(result?.actorId ?? '');
      return resultActorId !== 'godot_player' && !resultActorId.startsWith('godot_smoke_');
    }),
    `tick ${tickNumber} must not select Godot-controlled actors`,
  );
  const scheduler = assertTickScheduler(tick.tick, tickResults, tickNumber);
  if (schedulerEligibleCount === null) schedulerEligibleCount = scheduler.eligibleCount;
  for (const actorId of scheduler.actorIds) scheduledActorIds.add(actorId);
  const tickEvents = asArray(tick.tickEvents, `tick ${tickNumber}.tickEvents`);
  assert(tickEvents.length > 0, `tick ${tickNumber} must include tickEvents`);
  const knownResidents = residentActorSet(region);
  for (const [eventIndex, event] of tickEvents.entries()) {
    assertPresentationFields(event, `tick ${tickNumber}.tickEvents[${eventIndex}]`);
    if (event.tickOnly === true) {
      tickOnlyCount += 1;
      continue;
    }
    if (event.actionRecordId) {
      const record = await assertActionRecordReadback(region.worldId, event, `tick ${tickNumber}.tickEvents[${eventIndex}]`);
      actionRecordReadbackCount += record ? 1 : 0;
      const eventRelationshipEffects = relationshipEffects(event.effects);
      const recordRelationshipEffects = relationshipEffects(record?.effects);
      assert(
        JSON.stringify(recordRelationshipEffects) === JSON.stringify(eventRelationshipEffects),
        `tick ${tickNumber}.tickEvents[${eventIndex}] relationship effects must match actionRecord readback`,
      );
      relationshipEffectCount += eventRelationshipEffects.length;
      relationshipDeltaMagnitude += eventRelationshipEffects.reduce(
        (sum, effect) => sum + Math.abs(effect.delta),
        0,
      );
      for (const actorId of residentActorsForEvent(event, knownResidents)) {
        durableEventsByActor.set(actorId, {
          actionRecordId: event.actionRecordId,
          worldEventId: event.worldEventId,
        });
      }
      if (!durableTickEvent) {
        durableTickEvent = event;
        durableTickActorId = residentActorForEvent(event, knownResidents) ?? '';
      }
    }
  }

  const after = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}&worldId=${encodeURIComponent(region.worldId)}`);
  assert(after.ok === true, `post-tick ${tickNumber} regionState must be ok`);
  residents = asArray(after.residents, `post-tick ${tickNumber}.residents`);
  assertResidentPresenceFields(residents, `post-tick ${tickNumber} regionState`);
  if (signaturesChanged(previousSignatures, residents)) {
    residentChangeCount += 1;
  }
  previousSignatures = residentSignatureMap(residents);
  qinglanUpdatedTotal += Number(tick.qinglan.updated ?? 0);
  region = after;
  console.log(
    `ok tick ${tickNumber}: ${tick.tick.ticked} agent(s), ${tick.qinglan.updated} resident update(s), ${tickEvents.length} tick event(s)`,
  );

  if (index < iterations - 1 && delayMs > 0) {
    await sleep(delayMs);
  }
}

assert(
  durableTickEvent?.actionRecordId,
  'agent soak must produce at least one durable tick event with an actionRecordId',
);
assert(actionRecordReadbackCount >= 1, 'agent soak must read back at least one tick actionRecord');
const schedulerCoverageTarget = Math.min(
  Number(schedulerEligibleCount ?? 0),
  iterations * tickLimit,
);
assert(
  scheduledActorIds.size >= schedulerCoverageTarget,
  `agent soak scheduler must cover ${schedulerCoverageTarget} actor(s), got ${scheduledActorIds.size}`,
);
if (qinglanUpdatedTotal > 0) {
  assert(residentChangeCount >= 1, 'Qinglan resident updates must be visible in regionState after repeated ticks');
}

if (!durableTickActorId) {
  const latestResidents = asArray(region.residents, 'final regionState.residents');
  durableTickActorId = latestResidents[0]?.actorId ?? '';
}
assert(durableTickActorId, 'agent soak must have a resident actor for actorContext/replay readback');
const latestResidents = asArray(region.residents, 'final regionState.residents');
const contextActorIds = [
  durableTickActorId,
  ...durableEventsByActor.keys(),
  ...initialContextActorIds,
  ...latestResidents.map((resident) => resident?.actorId).filter(Boolean),
]
  .filter((actorId, index, list) => actorId && list.indexOf(actorId) === index)
  .slice(0, contextActorLimit);

for (const actorId of contextActorIds) {
  const expected = durableEventsByActor.get(actorId);
  const { context, memoryCount } = await assertActorContext(
    region.worldId,
    actorId,
    expected?.actionRecordId,
    expected?.worldEventId,
  );
  await assertReplayTrace(region.worldId, actorId, expected?.actionRecordId);
  const baseline = baselineContexts.get(actorId);
  if (baseline) {
    const delta = actorContextDelta(baseline, actorContextSnapshot(context));
    addedMemoryCount += delta.addedMemoryIds.length;
    addedActionCount += delta.addedActionRecordIds.length;
    addedEventCount += delta.addedWorldEventIds.length;
    relationshipDimensionsChanged += delta.relationshipDimensionsChanged;
  }
  actorContextReadbackCount += 1;
  memoryReadbackCount += memoryCount;
}

if (config.requireMemoryDelta || config.requireRelationshipDelta) {
  const controlledDelta = await assertControlledSocialDelta(region);
  addedMemoryCount += controlledDelta.addedMemoryCount;
  addedActionCount += controlledDelta.addedActionCount;
  addedEventCount += controlledDelta.addedEventCount;
  relationshipEffectCount += controlledDelta.relationshipEffectCount;
  relationshipDeltaMagnitude += controlledDelta.relationshipDeltaMagnitude;
  relationshipDimensionsChanged += controlledDelta.relationshipDimensionsChanged;
  actionRecordReadbackCount += controlledDelta.actionRecordReadbackCount;
}

if (config.requireMemoryDelta) {
  assert(addedMemoryCount > 0, 'long agent soak requires at least one new actor-context memory id');
}
if (config.requireRelationshipDelta) {
  assert(
    relationshipEffectCount > 0,
    'long agent soak requires at least one structured rules.effects.relationships delta',
  );
}
const artifactSummary = budget.summary();

console.log(
  `Godot agent soak check passed: ${iterations} tick(s), ${scheduledActorIds.size}/${schedulerEligibleCount ?? 0} scheduled actor(s), ${actionRecordReadbackCount} actionRecord readback(s), ${tickOnlyCount} tickOnly observation(s), ${actorContextReadbackCount} actorContext readback(s), ${memoryReadbackCount} memory row(s), ${addedMemoryCount} new memory id(s), ${addedActionCount} new context action(s), ${addedEventCount} new context event(s), ${relationshipEffectCount} relationship effect(s) (magnitude ${relationshipDeltaMagnitude}, visible dimension changes ${relationshipDimensionsChanged}), ${residentChangeCount} visible resident-change pass(es), ${artifactSummary.requestCount} HTTP response(s) / ${artifactSummary.responseBytes} byte(s) in ${artifactSummary.elapsedMs}ms.`,
);
