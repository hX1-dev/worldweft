#!/usr/bin/env node

import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api.js';

const baseUrl = (process.env.GODOT_BRIDGE_URL ?? 'http://127.0.0.1:3211').replace(/\/$/, '');
const convexUrl = process.env.GODOT_CONVEX_URL ?? defaultConvexUrlForBridge(baseUrl);
const debugToken = process.env.GODOT_BRIDGE_DEBUG_TOKEN?.trim();
const playerToken = process.env.GODOT_BRIDGE_TOKEN?.trim();
const boundWorldId = process.env.GODOT_BRIDGE_WORLD_ID?.trim();
const mapId = process.env.GODOT_MAP_ID ?? 'qinglan';
const actorId = process.env.GODOT_ACTOR_ID ?? `godot_smoke_${Date.now().toString(36)}`;
const preferredTarget = process.env.GODOT_TARGET_ACTOR_ID ?? 'qinglan:qinglan-medicine-keeper';
const intent =
  process.env.GODOT_ACTION_INTENT ?? `Godot bridge smoke test at ${new Date().toISOString()}`;
const convexClient = new ConvexHttpClient(convexUrl);
let clientActionSequence = 0;
let mapIsolationFixture = null;
const contractVersion = 'godot_bridge_v1';

if (!debugToken || !playerToken || !boundWorldId) {
  throw new Error(
    'GODOT_BRIDGE_DEBUG_TOKEN, GODOT_BRIDGE_TOKEN, and GODOT_BRIDGE_WORLD_ID are required.',
  );
}

function newClientActionId(label) {
  clientActionSequence += 1;
  return `smoke:${actorId}:${label.replace(/[^a-z0-9_-]+/gi, '-')}:${clientActionSequence}`;
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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
  const { authToken = debugToken, ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      Accept: 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON: ${text.slice(0, 300)}`);
  }
  assert(payload?.contractVersion === contractVersion, `${path} contractVersion must match`);
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return asObject(payload, path);
}

async function requestJsonAllowError(path, options = {}) {
  const { authToken = debugToken, ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    headers: {
      Accept: 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON: ${text.slice(0, 300)}`);
  }
  assert(payload?.contractVersion === contractVersion, `${path} error contractVersion must match`);
  return { response, payload: asObject(payload, path) };
}

function pickLocation(locations, locationId) {
  return (
    locations.find((location) => location?.locationId === locationId) ??
    locations.find((location) => typeof location?.locationId === 'string')
  );
}

function pickLocationAllowing(locations, actionType) {
  return locations.find((location) => {
    const allowedActions = location?.allowedActions;
    return Array.isArray(allowedActions) && allowedActions.includes(actionType);
  });
}

function tilePayload(tile) {
  return {
    x: Number(tile?.x ?? 0),
    y: Number(tile?.y ?? 0),
  };
}

function firstEntryTile(location) {
  return tilePayload(location?.entryPoints?.[0]);
}

async function getOptionalProfile(worldId, profileActorId) {
  return await convexClient.query(api.xianxia.profiles.getProfile, {
    worldId,
    actorId: profileActorId,
  });
}

async function getProfile(worldId, profileActorId) {
  const profile = await getOptionalProfile(worldId, profileActorId);
  assert(profile, `profile ${profileActorId} must exist`);
  return profile;
}

function durableLocationSnapshot(profile) {
  return JSON.stringify({
    mapId: profile?.mapId ?? '',
    currentLocationId: profile?.currentLocationId ?? '',
    currentIntent: profile?.currentIntent ?? '',
  });
}

function assertLocationChangeEffect(effectsValue, payload, label) {
  const effects = asObject(effectsValue, `${label}.effects`);
  const change = asObject(effects.locationChange, `${label}.effects.locationChange`);
  assert(
    change.toMapId === payload.mapId,
    `${label} locationChange.toMapId must match payload mapId`,
  );
  assert(
    change.toLocationId === payload.locationId,
    `${label} locationChange.toLocationId must match payload locationId`,
  );
  assert(
    typeof change.intent === 'string' && change.intent.length > 0,
    `${label} locationChange must include intent`,
  );
  return change;
}

function capability(payload, type) {
  const actions = asArray(payload.actions, 'capabilities.actions');
  return actions.find((action) => action?.type === type);
}

function asCapabilityParams(action, label) {
  return asObject(action?.params ?? {}, `${label}.params`);
}

function capabilityOptions(action, label) {
  return asArray(action?.options ?? [], `${label}.options`);
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

function assertResidentPresenceFields(residents, label) {
  assert(residents.length > 0, `${label} must include residents`);
  for (const resident of residents) {
    assert(
      typeof resident?.actorId === 'string' && resident.actorId.length > 0,
      `${label} resident must include actorId`,
    );
    assert(
      typeof resident?.status === 'string' && resident.status.length > 0,
      `${label} ${resident?.actorId} must include status`,
    );
    assert(
      typeof resident?.activityLabel === 'string' && resident.activityLabel.length > 0,
      `${label} ${resident?.actorId} must include activityLabel`,
    );
    assert(
      typeof resident?.intent === 'string' && resident.intent.length > 0,
      `${label} ${resident?.actorId} must include intent`,
    );
    assert(
      typeof resident?.waypointId === 'string' && resident.waypointId.length > 0,
      `${label} ${resident?.actorId} must include waypointId`,
    );
    assert(
      typeof resident?.updatedAt === 'number',
      `${label} ${resident?.actorId} must include updatedAt`,
    );
    assert(
      resident?.targetTile &&
        typeof resident.targetTile.x === 'number' &&
        typeof resident.targetTile.y === 'number',
      `${label} ${resident?.actorId} must include targetTile`,
    );
    assert(
      resident?.finalTargetTile &&
        typeof resident.finalTargetTile.x === 'number' &&
        typeof resident.finalTargetTile.y === 'number',
      `${label} ${resident?.actorId} must include finalTargetTile`,
    );
    assertResidentRoutePreview(resident, `${label} ${resident?.actorId}`);
  }
  console.log(`ok ${label}: resident presence fields available`);
}

function assertResidentRoutePreview(resident, label) {
  const routePreview = asObject(resident?.routePreview, `${label}.routePreview`);
  assert(
    typeof routePreview.routeId === 'string' && routePreview.routeId.length > 0,
    `${label} routePreview must include routeId`,
  );
  assert(
    typeof routePreview.waypointId === 'string' && routePreview.waypointId.length > 0,
    `${label} routePreview must include waypointId`,
  );
  assert(
    typeof routePreview.waypointLabel === 'string' && routePreview.waypointLabel.length > 0,
    `${label} routePreview must include waypointLabel`,
  );
  assert(
    ['connected', 'disconnected'].includes(routePreview.status),
    `${label} routePreview must include status`,
  );
  assert(
    typeof routePreview.connected === 'boolean',
    `${label} routePreview must include connected`,
  );
  assert(
    typeof routePreview.lengthTiles === 'number',
    `${label} routePreview must include lengthTiles`,
  );
  assert(
    typeof routePreview.remainingTiles === 'number',
    `${label} routePreview must include remainingTiles`,
  );
  assert(
    typeof routePreview.etaSeconds === 'number',
    `${label} routePreview must include etaSeconds`,
  );
  assert(
    typeof routePreview.etaLabel === 'string' && routePreview.etaLabel.length > 0,
    `${label} routePreview must include etaLabel`,
  );
  assert(
    typeof routePreview.nextStepLabel === 'string' && routePreview.nextStepLabel.length > 0,
    `${label} routePreview must include nextStepLabel`,
  );
  assert(
    typeof routePreview.nextStepDistanceTiles === 'number',
    `${label} routePreview must include nextStepDistanceTiles`,
  );
  assert(
    typeof routePreview.progressLabel === 'string' && routePreview.progressLabel.length > 0,
    `${label} routePreview must include progressLabel`,
  );
  assert(
    typeof routePreview.routeSummary === 'string' && routePreview.routeSummary.length > 0,
    `${label} routePreview must include routeSummary`,
  );
  assert(
    ['arrived', 'moving', 'scheduled', 'disconnected'].includes(routePreview.movementState),
    `${label} routePreview must include movementState`,
  );
  assert(
    routePreview.remainingTiles <= routePreview.lengthTiles + 0.1,
    `${label} routePreview remainingTiles must fit route length`,
  );
  assert(
    ['resident_path', 'navigation_graph'].includes(routePreview.source),
    `${label} routePreview must include source`,
  );
  assert(
    routePreview.currentTile &&
      typeof routePreview.currentTile.x === 'number' &&
      typeof routePreview.currentTile.y === 'number',
    `${label} routePreview must include currentTile`,
  );
  assert(
    routePreview.nextTile &&
      typeof routePreview.nextTile.x === 'number' &&
      typeof routePreview.nextTile.y === 'number',
    `${label} routePreview must include nextTile`,
  );
  assert(
    routePreview.finalTargetTile &&
      typeof routePreview.finalTargetTile.x === 'number' &&
      typeof routePreview.finalTargetTile.y === 'number',
    `${label} routePreview must include finalTargetTile`,
  );
  const pathTiles = asArray(routePreview.pathTiles, `${label}.routePreview.pathTiles`);
  assert(pathTiles.length >= 1, `${label} routePreview pathTiles must not be empty`);
  assert(
    routePreview.pathStepCount === pathTiles.length,
    `${label} routePreview pathStepCount must match pathTiles`,
  );
  const schedulePreview = asObject(
    routePreview.schedulePreview,
    `${label}.routePreview.schedulePreview`,
  );
  assert(
    ['at_waypoint', 'en_route', 'scheduled', 'rerouting'].includes(schedulePreview.phase),
    `${label} schedulePreview must include phase`,
  );
  assert(
    typeof schedulePreview.activityLabel === 'string' && schedulePreview.activityLabel.length > 0,
    `${label} schedulePreview must include activityLabel`,
  );
  assert(
    typeof schedulePreview.destinationLabel === 'string' &&
      schedulePreview.destinationLabel.length > 0,
    `${label} schedulePreview must include destinationLabel`,
  );
  assert(
    typeof schedulePreview.destinationLocationId === 'string' &&
      schedulePreview.destinationLocationId === routePreview.locationId,
    `${label} schedulePreview destinationLocationId must match route location`,
  );
  assert(
    typeof schedulePreview.intent === 'string' && schedulePreview.intent.length > 0,
    `${label} schedulePreview must include intent`,
  );
  assert(
    typeof schedulePreview.summary === 'string' && schedulePreview.summary.length > 0,
    `${label} schedulePreview must include summary`,
  );
  if (schedulePreview.nextActionAt !== undefined) {
    assert(
      typeof schedulePreview.nextActionAt === 'number',
      `${label} schedulePreview nextActionAt must be numeric`,
    );
  }
  const scheduleRoute = asObject(routePreview.scheduleRoute, `${label}.routePreview.scheduleRoute`);
  assert(
    ['resident_route', 'role_route'].includes(scheduleRoute.source),
    `${label} scheduleRoute must include source`,
  );
  assert(
    typeof scheduleRoute.routeId === 'string' && scheduleRoute.routeId.length > 0,
    `${label} scheduleRoute must include routeId`,
  );
  assert(
    typeof scheduleRoute.routeCount === 'number' && scheduleRoute.routeCount >= 1,
    `${label} scheduleRoute must include routeCount`,
  );
  assert(
    typeof scheduleRoute.currentIndex === 'number' &&
      scheduleRoute.currentIndex >= 0 &&
      scheduleRoute.currentIndex < scheduleRoute.routeCount,
    `${label} scheduleRoute currentIndex must be inside routeCount`,
  );
  assertScheduleStop(scheduleRoute.currentStop, `${label}.scheduleRoute.currentStop`);
  assertScheduleStop(scheduleRoute.previousStop, `${label}.scheduleRoute.previousStop`);
  assertScheduleStop(scheduleRoute.nextStop, `${label}.scheduleRoute.nextStop`);
  const upcomingStops = asArray(
    scheduleRoute.upcomingStops,
    `${label}.scheduleRoute.upcomingStops`,
  );
  assert(upcomingStops.length >= 1, `${label} scheduleRoute must include upcoming stops`);
  for (const [index, stop] of upcomingStops.entries()) {
    assertScheduleStop(stop, `${label}.scheduleRoute.upcomingStops[${index}]`);
    assert(
      stop.offset === index + 1,
      `${label} scheduleRoute upcoming stop offset must match order`,
    );
  }
  assert(
    typeof scheduleRoute.loopLabel === 'string' && scheduleRoute.loopLabel.length > 0,
    `${label} scheduleRoute must include loopLabel`,
  );
  assert(
    typeof scheduleRoute.summary === 'string' && scheduleRoute.summary.length > 0,
    `${label} scheduleRoute must include summary`,
  );
}

function assertScheduleStop(stopValue, label) {
  const stop = asObject(stopValue, label);
  assert(typeof stop.spotId === 'string' && stop.spotId.length > 0, `${label} must include spotId`);
  assert(typeof stop.label === 'string' && stop.label.length > 0, `${label} must include label`);
  assert(
    typeof stop.locationId === 'string' && stop.locationId.length > 0,
    `${label} must include locationId`,
  );
  assert(
    stop.tile && typeof stop.tile.x === 'number' && typeof stop.tile.y === 'number',
    `${label} must include tile`,
  );
  assert(typeof stop.intent === 'string' && stop.intent.length > 0, `${label} must include intent`);
  assert(typeof stop.offset === 'number', `${label} must include offset`);
}

function assertPresentationFields(value, label) {
  assert(
    typeof value?.bubbleText === 'string' && value.bubbleText.length > 0,
    `${label} must include bubbleText`,
  );
  assert(
    ['dialogue', 'reaction', 'narration', 'warning'].includes(value.bubbleKind),
    `${label} must include bubbleKind`,
  );
  assert(
    typeof value?.displayText === 'string' && value.displayText.length > 0,
    `${label} must include displayText`,
  );
  assert(
    typeof value?.presentationSource === 'string' && value.presentationSource.length > 0,
    `${label} must include presentationSource`,
  );
  assert(
    typeof value?.durableSummary === 'string' && value.durableSummary.length > 0,
    `${label} must include durableSummary`,
  );
  if (typeof value?.summary === 'string' && value.summary.length > 0) {
    assert(
      value.durableSummary === value.summary,
      `${label} durableSummary must match rule summary`,
    );
  }
  const policy = asObject(value?.presentationPolicy, `${label}.presentationPolicy`);
  assert(
    policy.durableSummaryLocked === true,
    `${label} presentationPolicy must lock durable summary`,
  );
  assert(
    policy.llmMayPolishDisplayText === true,
    `${label} presentationPolicy must allow display polish only`,
  );
  assert(
    policy.llmMayChangeFacts === false,
    `${label} presentationPolicy must forbid fact changes`,
  );
  assert(
    policy.llmMayChangeDurableState === false,
    `${label} presentationPolicy must forbid durable state changes`,
  );
  assertTraceChain(value, label);
}

function assertTraceChain(value, label) {
  const chain = asObject(value?.traceChain, `${label}.traceChain`);
  assert(
    typeof chain.source === 'string' && chain.source.length > 0,
    `${label} traceChain must include source`,
  );
  assert(
    ['action_record_linked', 'event_only', 'action_record_only', 'tick_only', 'unlinked'].includes(
      chain.linkStatus,
    ),
    `${label} traceChain must include linkStatus`,
  );
  assert(
    typeof chain.label === 'string' && chain.label.length > 0,
    `${label} traceChain must include label`,
  );
  assert(typeof chain.durable === 'boolean', `${label} traceChain must include durable boolean`);
  assert(typeof chain.tickOnly === 'boolean', `${label} traceChain must include tickOnly boolean`);
  const steps = asArray(chain.steps, `${label}.traceChain.steps`);
  assert(steps.length > 0, `${label} traceChain must include lifecycle steps`);
  for (const [index, step] of steps.entries()) {
    assert(step && typeof step === 'object', `${label} traceChain step ${index} must be an object`);
    assert(
      typeof step.kind === 'string' && step.kind.length > 0,
      `${label} traceChain step ${index} must include kind`,
    );
    assert(
      typeof step.label === 'string' && step.label.length > 0,
      `${label} traceChain step ${index} must include label`,
    );
  }
  if (chain.tickOnly) {
    assert(
      chain.linkStatus === 'tick_only',
      `${label} tickOnly traceChain must use tick_only status`,
    );
    assert(chain.durable === false, `${label} tickOnly traceChain must not be durable`);
    assert(
      steps.some((step) => step.kind === 'tick_only'),
      `${label} tickOnly traceChain must include tick_only step`,
    );
  }
  if (chain.durable) {
    assert(
      typeof chain.worldEventId === 'string' && chain.worldEventId.length > 0,
      `${label} durable traceChain must include worldEventId`,
    );
  }
  if (value?.worldEventId) {
    assert(
      chain.worldEventId === value.worldEventId,
      `${label} traceChain worldEventId must match payload`,
    );
  }
  if (value?.actionRecordId) {
    assert(
      chain.actionRecordId === value.actionRecordId,
      `${label} traceChain actionRecordId must match payload`,
    );
  }
  if (value?.actionRecordId && value?.worldEventId && !chain.tickOnly) {
    assert(
      chain.linkStatus === 'action_record_linked',
      `${label} traceChain must mark linked action/event`,
    );
    assert(
      steps.some((step) => step.kind === 'action_record' || step.kind === 'action_record_readback'),
      `${label} linked traceChain must include actionRecord step`,
    );
    assert(
      steps.some((step) => step.kind === 'world_event' || step.kind === 'region_event'),
      `${label} linked traceChain must include worldEvent step`,
    );
  }
}

async function postActionAndAssertReadback(payload, label, expectedIdempotentReplay = false) {
  assert(payload.clientActionId, `${label} payload must include clientActionId`);
  const action = await requestJson('/godot/action', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert(action.ok === true, `${label} response must be ok`);
  assert(action.eventId, `${label} response must include eventId`);
  assert(action.actionRecordId, `${label} response must include actionRecordId`);
  assert(action.clientActionId === payload.clientActionId, `${label} must preserve clientActionId`);
  assert(
    action.idempotentReplay === expectedIdempotentReplay,
    `${label} idempotentReplay must be ${expectedIdempotentReplay}`,
  );
  assert(
    Array.isArray(action.actorIds),
    `${label} response must include actorIds for scene bubbles`,
  );
  assert(action.actorIds.includes(payload.actorId), `${label} actorIds must include acting actor`);
  assert(Array.isArray(action.targetActorIds), `${label} response must include targetActorIds`);
  if (payload.targetActorId) {
    assert(
      action.targetActorIds.includes(payload.targetActorId),
      `${label} targetActorIds must include target actor`,
    );
  }
  if (payload.locationId) {
    assert(action.locationId === payload.locationId, `${label} response must preserve locationId`);
  }
  assert(typeof action.resultCode === 'string', `${label} response must include resultCode`);
  assertPresentationFields(action, `${label} response`);
  if (payload.type === 'arrive' && action.result?.status === 'applied') {
    assertLocationChangeEffect(action.result.effects, payload, `${label} response`);
  }
  const settlementSummary = assertSettlementPreviewMatchesEffects(
    action,
    action.result?.effects,
    `${label} response`,
  );
  assert(
    action.result?.applied === true ||
      action.result?.status === 'applied' ||
      typeof action.result?.resultCode === 'string',
    `${label} result must be structured`,
  );
  const record = await assertActionRecordReadback(action, payload, label, payload.type);
  if (payload.type === 'arrive' && action.result?.status === 'applied') {
    assertLocationChangeEffect(record.effects, payload, `${label} actionRecord`);
  }
  if (settlementSummary) {
    assertSettlementPreviewMatchesSummary(record, settlementSummary, `${label} actionRecord`);
  }
  console.log(`ok ${label} write: event ${action.eventId}`);

  const after = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}`);
  const recentEvents = asArray(after.recentEvents, 'regionState.recentEvents');
  const matchingEvent = recentEvents.find((event) => event?.id === action.eventId);
  assert(matchingEvent, `recentEvents must include ${label} event ${action.eventId}`);
  assertPresentationFields(matchingEvent, `recentEvents ${label}`);
  assert(
    matchingEvent.worldEventId === action.eventId,
    `recentEvents must expose ${label} worldEventId`,
  );
  assert(
    matchingEvent.actionRecordId === action.actionRecordId,
    `recentEvents must expose ${label} actionRecordId`,
  );
  assert(
    matchingEvent.resultCode === action.resultCode,
    `recentEvents must expose ${label} resultCode`,
  );
  if (payload.type === 'arrive' && action.result?.status === 'applied') {
    assertLocationChangeEffect(matchingEvent.effects, payload, `recentEvents ${label}`);
  }
  if (settlementSummary) {
    assertSettlementPreviewMatchesSummary(
      matchingEvent,
      settlementSummary,
      `recentEvents ${label}`,
    );
  }
  console.log(`ok ${label} read-after-write: ${matchingEvent.summary}`);
  return action;
}

async function postLegacyAndAssertReadback(path, payload, label, expectedActionType) {
  assert(payload.clientActionId, `${label} payload must include clientActionId`);
  const action = await requestJson(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert(action.ok === true, `${label} response must be ok`);
  assert(action.legacy === true, `${label} response must be marked legacy`);
  assert(action.legacyEndpoint === path, `${label} response must include legacyEndpoint`);
  assert(action.eventId, `${label} response must include eventId`);
  assert(action.actionRecordId, `${label} response must include actionRecordId`);
  assert(action.clientActionId === payload.clientActionId, `${label} must preserve clientActionId`);
  assert(
    action.action?.type === expectedActionType,
    `${label} must adapt into ${expectedActionType}`,
  );
  assert(typeof action.resultCode === 'string', `${label} response must include resultCode`);
  assertPresentationFields(action, `${label} response`);
  await assertActionRecordReadback(action, payload, label, expectedActionType);
  console.log(`ok ${label} legacy write: event ${action.eventId}`);

  const after = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}`);
  const matchingEvent = asArray(after.recentEvents, 'regionState.recentEvents').find(
    (event) => event?.id === action.eventId,
  );
  assert(matchingEvent, `recentEvents must include ${label} event ${action.eventId}`);
  assertPresentationFields(matchingEvent, `recentEvents ${label}`);
  assert(
    matchingEvent.worldEventId === action.eventId,
    `recentEvents must expose ${label} worldEventId`,
  );
  assert(
    matchingEvent.actionRecordId === action.actionRecordId,
    `recentEvents must expose ${label} actionRecordId`,
  );
  assert(
    matchingEvent.resultCode === action.resultCode,
    `recentEvents must expose ${label} resultCode`,
  );
  console.log(`ok ${label} legacy read-after-write: ${matchingEvent.summary}`);
  return action;
}

async function assertActionRecordReadback(action, payload, label, expectedActionType) {
  const query = new URLSearchParams({
    actionRecordId: String(action.actionRecordId),
    worldId: String(action.worldId),
  });
  const record = await requestJson(`/godot/actionRecord?${query.toString()}`);
  assert(record.ok === true, `${label} actionRecord readback must be ok`);
  assert(record.actionRecordId === action.actionRecordId, `${label} actionRecord id must match`);
  assert(
    record.worldEventId === action.eventId,
    `${label} actionRecord must link back to worldEvent`,
  );
  assert(record.worldId === action.worldId, `${label} actionRecord worldId must match`);
  assert(record.actorId === payload.actorId, `${label} actionRecord actorId must match`);
  assert(
    record.clientActionId === payload.clientActionId,
    `${label} actionRecord clientActionId must match`,
  );
  assert(
    record.type === expectedActionType,
    `${label} actionRecord type must be ${expectedActionType}`,
  );
  assert(
    record.status === action.result?.status,
    `${label} actionRecord status must match action result`,
  );
  assert(record.resultCode === action.resultCode, `${label} actionRecord resultCode must match`);
  const durableVersions = {
    result: record.resultSchemaVersion,
    eventFacts: record.eventFactsSchemaVersion,
    metadata: record.metadataSchemaVersion,
    metadataReadback: record.metadata?.schemaVersion,
  };
  assert(
    Object.values(durableVersions).every((version) => version === 1),
    `${label} durable schema versions must all be 1: ${JSON.stringify(durableVersions)}`,
  );
  assertPresentationFields(record, `${label} actionRecord`);
  await assertPresentationPolishPreview(record, action, label);
  if (payload.targetActorId) {
    assert(
      record.targetActorId === payload.targetActorId,
      `${label} actionRecord targetActorId must match`,
    );
  }
  if (payload.locationId) {
    assert(record.locationId === payload.locationId, `${label} actionRecord locationId must match`);
  }
  console.log(`ok ${label} actionRecord readback: ${record.type}/${record.resultCode}`);
  return record;
}

async function assertPresentationPolishPreview(record, action, label) {
  const query = new URLSearchParams({
    actionRecordId: String(action.actionRecordId),
    worldId: String(action.worldId),
    mode: 'llm_polish',
  });
  const preview = await requestJson(`/godot/presentationPreview?${query.toString()}`);
  assert(preview.ok === true, `${label} presentationPreview must be ok`);
  assert(
    preview.actionRecordId === action.actionRecordId,
    `${label} presentationPreview actionRecordId must match`,
  );
  assert(
    preview.worldEventId === action.eventId,
    `${label} presentationPreview worldEventId must match`,
  );
  assert(
    preview.summary === record.summary,
    `${label} presentationPreview summary must remain rule summary`,
  );
  assert(
    preview.durableSummary === record.durableSummary,
    `${label} presentationPreview durableSummary must match actionRecord`,
  );
  assertPresentationFields(preview, `${label} presentationPreview`);
  const polish = asObject(preview.polishPreview, `${label}.presentationPreview.polishPreview`);
  assert(
    polish.adapter === 'godot_safe_polish_v1',
    `${label} polishPreview must expose safe adapter`,
  );
  assert(polish.requestedMode === 'llm_polish', `${label} polishPreview must echo llm_polish mode`);
  assert(
    polish.status === 'llm_not_configured',
    `${label} polishPreview must remain disabled without adapter`,
  );
  assert(polish.applied === false, `${label} polishPreview must not apply text`);
  assert(polish.factsLocked === true, `${label} polishPreview must lock facts`);
  assert(
    polish.durableSummary === record.durableSummary,
    `${label} polishPreview durableSummary must match actionRecord`,
  );
  assert(
    polish.candidateBubbleText === preview.bubbleText,
    `${label} polishPreview candidateBubbleText must come from rule template`,
  );
  assert(
    polish.candidateDisplayText === preview.displayText,
    `${label} polishPreview candidateDisplayText must come from rule template`,
  );
  assert(
    polish.candidateSource === 'rule_template',
    `${label} polishPreview candidateSource must be rule_template`,
  );
  const inputSnapshot = asObject(polish.inputSnapshot, `${label}.polishPreview.inputSnapshot`);
  assert(
    inputSnapshot.durableSummary === record.durableSummary,
    `${label} polishPreview inputSnapshot must preserve durable summary`,
  );
  assert(
    typeof inputSnapshot.durableSummaryHash === 'string' &&
      inputSnapshot.durableSummaryHash.startsWith('fnv1a32:'),
    `${label} polishPreview inputSnapshot must include durable summary hash`,
  );
  const allowedOutputFields = asArray(
    polish.allowedOutputFields,
    `${label}.polishPreview.allowedOutputFields`,
  );
  assert(
    allowedOutputFields.includes('bubbleText'),
    `${label} polishPreview must allow bubbleText output`,
  );
  assert(
    allowedOutputFields.includes('displayText'),
    `${label} polishPreview must allow displayText output`,
  );
  assert(
    allowedOutputFields.includes('bubbleKind'),
    `${label} polishPreview must allow bubbleKind output`,
  );
  assert(
    !allowedOutputFields.includes('durableSummary'),
    `${label} polishPreview must not allow durableSummary output`,
  );
  const lockedFields = asArray(polish.lockedFields, `${label}.polishPreview.lockedFields`);
  assert(
    lockedFields.includes('durableSummary'),
    `${label} polishPreview must lock durableSummary`,
  );
  assert(lockedFields.includes('worldState'), `${label} polishPreview must lock worldState`);
  const forbiddenEffects = asArray(
    polish.forbiddenEffects,
    `${label}.polishPreview.forbiddenEffects`,
  );
  for (const forbidden of [
    'write_worldEvents',
    'write_actionRecords',
    'write_relationships',
    'write_memories',
    'create_facts',
  ]) {
    assert(forbiddenEffects.includes(forbidden), `${label} polishPreview must forbid ${forbidden}`);
  }
  const guardrails = asArray(polish.guardrails, `${label}.polishPreview.guardrails`);
  assert(guardrails.length >= 4, `${label} polishPreview must include guardrails`);
  assert(
    guardrails.every(
      (guardrail) => guardrail?.enforced === true && typeof guardrail?.id === 'string',
    ),
    `${label} polishPreview guardrails must be enforced and identified`,
  );
  const validation = asObject(polish.validation, `${label}.polishPreview.validation`);
  assert(validation.previewOnly === true, `${label} polishPreview validation must be preview-only`);
  assert(
    validation.writesDurableState === false,
    `${label} polishPreview validation must forbid durable writes`,
  );
  assert(validation.factsLocked === true, `${label} polishPreview validation must lock facts`);
  assert(
    validation.durableSummaryHash === inputSnapshot.durableSummaryHash,
    `${label} polishPreview validation hash must match input snapshot`,
  );
  assert(
    validation.candidateBubbleTextWithinLimit === true,
    `${label} polishPreview bubble text must fit limit`,
  );
  assert(
    validation.candidateDisplayTextWithinLimit === true,
    `${label} polishPreview display text must fit limit`,
  );
  assert(
    validation.candidateBubbleKindAllowed === true,
    `${label} polishPreview bubble kind must be allowed`,
  );
  const policy = asObject(polish.presentationPolicy, `${label}.polishPreview.presentationPolicy`);
  assert(policy.durableSummaryLocked === true, `${label} polishPreview must lock durable summary`);
  assert(
    policy.llmMayPolishDisplayText === true,
    `${label} polishPreview may only polish display text`,
  );
  assert(policy.llmMayChangeFacts === false, `${label} polishPreview must forbid fact changes`);
  assert(
    policy.llmMayChangeDurableState === false,
    `${label} polishPreview must forbid durable changes`,
  );
  console.log(`ok ${label} presentationPreview: ${polish.status}`);
  return preview;
}

async function assertActorContextReadback(worldId, targetActorId, viewerActorId, label) {
  const query = new URLSearchParams({
    worldId: String(worldId),
    mapId,
    actorId: targetActorId,
    viewerActorId,
  });
  const context = await requestJson(`/godot/actorContext?${query.toString()}`);
  assert(context.ok === true, `${label} actorContext must be ok`);
  assert(context.worldId === worldId, `${label} actorContext worldId must match`);
  assert(context.actorId === targetActorId, `${label} actorContext actorId must match`);
  assert(context.viewerActorId === viewerActorId, `${label} actorContext viewerActorId must match`);
  assert(
    context.resident?.actorId === targetActorId,
    `${label} actorContext must include resident`,
  );
  assertResidentRoutePreview(context.resident, `${label} actorContext resident`);
  assert(
    context.profile?.actorId === targetActorId,
    `${label} actorContext must include initialized profile`,
  );
  assert(
    typeof context.profile.realm === 'string',
    `${label} actorContext profile must include realm`,
  );
  assert(
    typeof context.profile.realmStage === 'number',
    `${label} actorContext profile must include realmStage`,
  );
  assert(
    typeof context.profile.reputation === 'number',
    `${label} actorContext profile must include reputation`,
  );
  assert(
    context.relationship && typeof context.relationship === 'object',
    `${label} actorContext must include relationship`,
  );
  assert(
    typeof context.relationship.viewerToActor?.affinity === 'number',
    `${label} actorContext viewerToActor must include affinity`,
  );
  assert(
    typeof context.relationship.actorToViewer?.affinity === 'number',
    `${label} actorContext actorToViewer must include affinity`,
  );
  assert(Array.isArray(context.recentEvents), `${label} actorContext must include recentEvents`);
  assert(
    context.recentEvents.length > 0,
    `${label} actorContext must include at least one recent event`,
  );
  assertPresentationFields(context.recentEvents[0], `${label} actorContext recent event`);
  assert(Array.isArray(context.recentActions), `${label} actorContext must include recentActions`);
  const matchingAction = context.recentActions.find(
    (action) => action?.actorId === viewerActorId && action?.targetActorId === targetActorId,
  );
  assert(
    matchingAction,
    `${label} actorContext recentActions must include viewer -> target action`,
  );
  assert(
    matchingAction.actionRecordId,
    `${label} actorContext recent action must include actionRecordId`,
  );
  assert(
    matchingAction.worldEventId,
    `${label} actorContext recent action must include worldEventId`,
  );
  assert(
    context.recentEvents.some((event) => event?.worldEventId === matchingAction.worldEventId),
    `${label} actorContext recent action must link to a recent event`,
  );
  assert(
    typeof matchingAction.resultCode === 'string',
    `${label} actorContext recent action must include resultCode`,
  );
  assertPresentationFields(matchingAction, `${label} actorContext recent action`);
  assert(Array.isArray(context.memories), `${label} actorContext must include memories`);
  console.log(
    `ok ${label} actorContext: ${context.profile.realm} ${context.profile.realmStage}, ${context.recentEvents.length} event(s)`,
  );
  return context;
}

async function assertGiftSocialReadback(worldId, targetActorId, viewerActorId, giftAction, label) {
  assert(
    giftAction.resultCode === 'gift_accepted',
    `${label} gift must be accepted to prove social effects`,
  );
  const context = await assertActorContextReadback(worldId, targetActorId, viewerActorId, label);
  const relationship = asObject(context.relationship, `${label}.relationship`);
  const actorToViewer = asObject(relationship.actorToViewer, `${label}.relationship.actorToViewer`);
  assert(actorToViewer.affinity > 0, `${label} must show target -> viewer affinity after gift`);
  assert(actorToViewer.trust > 0, `${label} must show target -> viewer trust after gift`);

  const matchingTrace = context.recentActions.find(
    (action) =>
      action?.actionRecordId === giftAction.actionRecordId &&
      action?.worldEventId === giftAction.eventId &&
      action?.resultCode === giftAction.resultCode,
  );
  assert(matchingTrace, `${label} actorContext recentActions must include this gift action trace`);

  const memories = asArray(context.memories, `${label}.memories`);
  const giftMemory = memories.find(
    (memory) => memory?.sourceEventId === giftAction.eventId && memory?.type === 'gift_given',
  );
  assert(giftMemory, `${label} actorContext memories must include the gift source event`);
  const aboutActorIds = asArray(giftMemory.aboutActorIds, `${label}.giftMemory.aboutActorIds`);
  assert(
    aboutActorIds.includes(viewerActorId),
    `${label} gift memory must point back to the viewer actor`,
  );
  assert(
    typeof giftMemory.summary === 'string' && giftMemory.summary.length > 0,
    `${label} gift memory must include summary`,
  );
  console.log(
    `ok ${label} social readback: affinity ${actorToViewer.affinity}, trust ${actorToViewer.trust}, memory ${giftMemory.sourceEventId}`,
  );
  return context;
}

async function assertReplayTraceReadback(worldId, targetActorId, viewerActorId, label) {
  const query = new URLSearchParams({
    worldId: String(worldId),
    mapId,
    actorId: targetActorId,
    limit: '8',
  });
  const replay = await requestJson(`/godot/replay?${query.toString()}`);
  assert(replay.ok === true, `${label} replay trace must be ok`);
  assert(replay.worldId === worldId, `${label} replay trace worldId must match`);
  assert(replay.mapId === mapId, `${label} replay trace mapId must match`);
  assert(replay.actorId === targetActorId, `${label} replay trace actorId must match`);
  const entries = asArray(replay.entries, `${label}.replay.entries`);
  assert(entries.length > 0, `${label} replay trace must include entries`);
  assertReplaySummary(replay.summary, entries, `${label}.replay.summary`);
  const matchingAction = entries.find(
    (entry) => entry?.actorId === viewerActorId && entry?.targetActorId === targetActorId,
  );
  assert(matchingAction, `${label} replay trace must include viewer -> target action`);
  assert(matchingAction.kind === 'action', `${label} replay matching entry must be an action`);
  assert(
    matchingAction.source === 'replay_action',
    `${label} replay matching entry must use replay_action source`,
  );
  assert(matchingAction.actionRecordId, `${label} replay action must include actionRecordId`);
  assert(matchingAction.worldEventId, `${label} replay action must include worldEventId`);
  assert(
    typeof matchingAction.resultCode === 'string',
    `${label} replay action must include resultCode`,
  );
  assertPresentationFields(matchingAction, `${label} replay action`);
  console.log(
    `ok ${label} replay trace: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
  );
  return replay;
}

function assertReplaySummary(summaryValue, entries, label) {
  const summary = asObject(summaryValue, label);
  assert(summary.entryCount === entries.length, `${label} entryCount must match entries`);
  assert(typeof summary.actionCount === 'number', `${label} must include actionCount`);
  assert(typeof summary.eventCount === 'number', `${label} must include eventCount`);
  assert(
    summary.actionCount + summary.eventCount === entries.length,
    `${label} action/event counts must add up`,
  );
  assert(typeof summary.linkedCount === 'number', `${label} must include linkedCount`);
  assert(typeof summary.eventOnlyCount === 'number', `${label} must include eventOnlyCount`);
  assert(
    typeof summary.actionRecordOnlyCount === 'number',
    `${label} must include actionRecordOnlyCount`,
  );
  assert(typeof summary.tickOnlyCount === 'number', `${label} must include tickOnlyCount`);
  assert(typeof summary.durableCount === 'number', `${label} must include durableCount`);
  assert(summary.linkedCount >= 1, `${label} must include at least one linked action/event`);
  assert(
    summary.durableCount >= summary.linkedCount,
    `${label} durableCount must cover linked entries`,
  );
  assert(typeof summary.oldestCreatedAt === 'number', `${label} must include oldestCreatedAt`);
  assert(typeof summary.newestCreatedAt === 'number', `${label} must include newestCreatedAt`);
  assert(
    summary.oldestCreatedAt <= summary.newestCreatedAt,
    `${label} oldestCreatedAt must be <= newestCreatedAt`,
  );
  assert(typeof summary.generatedAt === 'number', `${label} must include generatedAt`);
  assert(
    summary.generatedAt >= summary.newestCreatedAt,
    `${label} generatedAt must be at or after newestCreatedAt`,
  );
  assert(typeof summary.timeWindowMs === 'number', `${label} must include timeWindowMs`);
  assert(
    summary.timeWindowMs === summary.newestCreatedAt - summary.oldestCreatedAt,
    `${label} timeWindowMs must match oldest/newest span`,
  );
  assert(
    typeof summary.timeWindowLabel === 'string' && summary.timeWindowLabel.length > 0,
    `${label} must include timeWindowLabel`,
  );
  const actionTypes = asArray(summary.actionTypes, `${label}.actionTypes`);
  const resultCodes = asArray(summary.resultCodes, `${label}.resultCodes`);
  const linkStatuses = asArray(summary.linkStatuses, `${label}.linkStatuses`);
  const sources = asArray(summary.sources, `${label}.sources`);
  assert(actionTypes.length > 0, `${label} must include actionTypes`);
  assert(resultCodes.length > 0, `${label} must include resultCodes`);
  assert(linkStatuses.length > 0, `${label} must include linkStatuses`);
  assert(sources.length > 0, `${label} must include sources`);
  assert(
    actionTypes.some(
      (entry) => typeof entry?.type === 'string' && typeof entry?.count === 'number',
    ),
    `${label} actionTypes must include typed counts`,
  );
  assert(
    resultCodes.some(
      (entry) => typeof entry?.resultCode === 'string' && typeof entry?.count === 'number',
    ),
    `${label} resultCodes must include result code counts`,
  );
  assert(
    linkStatuses.some(
      (entry) => typeof entry?.linkStatus === 'string' && typeof entry?.count === 'number',
    ),
    `${label} linkStatuses must include status counts`,
  );
  assert(
    sources.some((entry) => typeof entry?.source === 'string' && typeof entry?.count === 'number'),
    `${label} sources must include source counts`,
  );
  assert(
    summary.topActionType === actionTypes[0].type,
    `${label} topActionType must match sorted actionTypes`,
  );
  assert(
    summary.topResultCode === resultCodes[0].resultCode,
    `${label} topResultCode must match sorted resultCodes`,
  );
  assert(
    summary.topLinkStatus === linkStatuses[0].linkStatus,
    `${label} topLinkStatus must match sorted linkStatuses`,
  );
  assert(summary.topSource === sources[0].source, `${label} topSource must match sorted sources`);
}

async function postCapabilities(payload) {
  const result = await requestJson('/godot/capabilities', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert(result.ok === true, 'capabilities response must be ok');
  assert(result.worldId === payload.worldId, 'capabilities response must preserve worldId');
  assert(Array.isArray(result.actions), 'capabilities response must include actions');
  return result;
}

async function pickTalkableTarget(worldId, residents) {
  const orderedResidents = [
    ...residents.filter((resident) => resident?.actorId === preferredTarget),
    ...residents.filter((resident) => resident?.actorId !== preferredTarget),
  ];

  for (const resident of orderedResidents) {
    if (!resident?.actorId || !resident?.tile) continue;
    await ensureSmokeActorAtLocation(
      worldId,
      {
        locationId: resident.locationId,
        name: resident.locationId,
        entryPoints: [tilePayload(resident.tile)],
      },
      `formal move while selecting talk target ${resident.actorId}`,
    );
    const result = await postCapabilities({
      worldId,
      actorId,
      mapId,
      targetActorId: resident.actorId,
      locationId: resident.locationId,
      actorTile: tilePayload(resident.tile),
      interactionRangeTiles: 5,
    });
    const talk = capability(result, 'talk');
    const gift = capability(result, 'gift');
    if (talk?.enabled === true && gift?.enabled === true) {
      console.log(`ok capabilities positive: talk/gift enabled for ${resident.actorId}`);
      return { target: resident, capabilities: result };
    }
  }

  throw new Error('must find a target resident with enabled talk and gift capabilities');
}

async function pickSparTarget(worldId, residents) {
  for (const resident of residents) {
    if (!resident?.actorId || !resident?.tile) continue;
    await ensureSmokeActorAtLocation(
      worldId,
      {
        locationId: resident.locationId,
        name: resident.locationId,
        entryPoints: [tilePayload(resident.tile)],
      },
      `formal move while selecting spar target ${resident.actorId}`,
    );
    const result = await postCapabilities({
      worldId,
      actorId,
      mapId,
      targetActorId: resident.actorId,
      locationId: resident.locationId,
      actorTile: tilePayload(resident.tile),
      interactionRangeTiles: 5,
    });
    const spar = capability(result, 'spar');
    if (spar?.enabled === true) {
      assertRiskPreview(spar, 'spar capability', [
        'spar_draw',
        'spar_actor_win',
        'spar_actor_lose',
      ]);
      console.log(`ok capabilities positive: spar enabled for ${resident.actorId}`);
      return { target: resident, spar };
    }
  }

  throw new Error('must find a target resident with enabled spar capability');
}

async function pickTeachingTarget(worldId, residents, preferredTeachingTarget) {
  const orderedResidents = [
    ...residents.filter((resident) => resident?.actorId === preferredTeachingTarget),
    ...residents.filter((resident) => resident?.actorId !== preferredTeachingTarget),
  ];
  for (const resident of orderedResidents) {
    if (!resident?.actorId || !resident?.tile) continue;
    const locationCandidates = [resident.locationId].filter(Boolean);
    for (const locationId of locationCandidates) {
      await ensureSmokeActorAtLocation(
        worldId,
        {
          locationId,
          name: locationId,
          entryPoints: [tilePayload(resident.tile)],
        },
        `formal move while selecting teaching target ${resident.actorId}`,
      );
      const result = await postCapabilities({
        worldId,
        actorId,
        mapId,
        targetActorId: resident.actorId,
        locationId,
        actorTile: tilePayload(resident.tile),
        interactionRangeTiles: 5,
      });
      const teaching = capability(result, 'request_teaching');
      if (teaching?.enabled === true) {
        assertTeachingCapability(teaching);
        console.log(`ok capabilities positive: request_teaching enabled for ${resident.actorId}`);
        return { target: resident, teaching, locationId };
      }
    }
  }

  throw new Error('must find a target resident with enabled request_teaching capability');
}

async function pickTradeTarget(worldId, residents) {
  const orderedResidents = [
    ...residents.filter((resident) => resident?.actorId === preferredTarget),
    ...residents.filter((resident) => resident?.actorId !== preferredTarget),
  ];

  for (const resident of orderedResidents) {
    if (!resident?.actorId || !resident?.tile) continue;
    await ensureSmokeActorAtLocation(
      worldId,
      {
        locationId: resident.locationId,
        name: resident.locationId,
        entryPoints: [tilePayload(resident.tile)],
      },
      `formal move while selecting trade target ${resident.actorId}`,
    );
    const result = await postCapabilities({
      worldId,
      actorId,
      mapId,
      targetActorId: resident.actorId,
      locationId: resident.locationId,
      actorTile: tilePayload(resident.tile),
      interactionRangeTiles: 5,
    });
    const trade = capability(result, 'trade');
    const gift = capability(result, 'gift');
    if (
      trade?.enabled === true &&
      gift?.enabled === true &&
      capabilityOptions(trade, 'trade').length > 0
    ) {
      console.log(`ok capabilities positive: trade enabled for ${resident.actorId}`);
      return { target: resident, trade, gift };
    }
  }

  throw new Error('must find a target resident with enabled trade capability');
}

function assertTeachingCapability(teaching) {
  assert(teaching, 'capabilities must include request_teaching');
  assert(teaching.category === 'target', 'request_teaching capability must be target-scoped');
  assert(teaching.enabled === true, 'request_teaching capability must be enabled');
  assert(typeof teaching.actorRealm === 'string', 'request_teaching must include actorRealm');
  assert(
    typeof teaching.actorRealmStage === 'number',
    'request_teaching must include actorRealmStage',
  );
  assert(typeof teaching.targetRealm === 'string', 'request_teaching must include targetRealm');
  assert(
    typeof teaching.targetRealmStage === 'number',
    'request_teaching must include targetRealmStage',
  );
  assert(
    typeof teaching.actorRelationship === 'number',
    'request_teaching must include actorRelationship',
  );
  assert(
    typeof teaching.requiredRelationship === 'number',
    'request_teaching must include requiredRelationship',
  );
  assert(
    typeof teaching.actorReputation === 'number',
    'request_teaching must include actorReputation',
  );
  assert(
    typeof teaching.minimumReputation === 'number',
    'request_teaching must include minimumReputation',
  );
  assert(
    teaching.actorRelationship >= teaching.requiredRelationship,
    'enabled request_teaching must satisfy relationship requirement',
  );
  assert(
    teaching.actorReputation >= teaching.minimumReputation,
    'enabled request_teaching must satisfy reputation requirement',
  );
  assertRiskPreview(teaching, 'request_teaching capability', [
    'teaching_granted',
    'teaching_refused',
  ]);
}

async function postCapabilitiesAndAssert(worldId, target, arrivalLocation) {
  const nearTalk = await postCapabilities({
    worldId,
    actorId,
    mapId,
    targetActorId: target.actorId,
    locationId: target.locationId,
    actorTile: tilePayload(target.tile),
    interactionRangeTiles: 5,
  });
  const talk = capability(nearTalk, 'talk');
  assert(talk, 'capabilities must include talk');
  assert(talk.enabled === true, 'near target talk capability must be enabled');
  assert(talk.category === 'target', 'talk capability must be target-scoped');
  assert(typeof talk.distanceTiles === 'number', 'talk capability must include distanceTiles');
  assert(
    typeof talk.intent === 'string' && talk.intent.length > 0,
    'talk capability must include intent',
  );
  const gift = capability(nearTalk, 'gift');
  assert(gift, 'capabilities must include gift');
  assert(gift.enabled === true, 'near target gift capability must be enabled');
  assert(gift.category === 'target', 'gift capability must be target-scoped');
  assert(
    asCapabilityParams(gift, 'gift').itemId === 'spirit_stone',
    'gift must include default itemId',
  );
  const giftOptions = capabilityOptions(gift, 'gift');
  assert(giftOptions.length > 0, 'gift must include at least one option');
  assertInventoryDeltaPreview(giftOptions[0], 'gift.options[0]');
  assertConfirmationPreview(giftOptions[0], 'gift.options[0]', 'gift');
  assert(
    giftOptions[0].inventoryDeltaPreview.deltas.some(
      (delta) =>
        delta.owner === 'actor' &&
        delta.itemId === asCapabilityParams(gift, 'gift').itemId &&
        delta.delta === -1,
    ),
    'gift preview must show actor giving one item',
  );
  assert(
    giftOptions[0].inventoryDeltaPreview.deltas.some(
      (delta) =>
        delta.owner === 'target' &&
        delta.itemId === asCapabilityParams(gift, 'gift').itemId &&
        delta.delta === 1,
    ),
    'gift preview must show target receiving one item',
  );

  const nearLocation = await postCapabilities({
    worldId,
    actorId,
    mapId,
    locationId: arrivalLocation.locationId,
    actorTile: firstEntryTile(arrivalLocation),
    interactionRangeTiles: 5,
  });
  const arrive = capability(nearLocation, 'arrive');
  const explore = capability(nearLocation, 'explore');
  assert(arrive, 'capabilities must include arrive');
  assert(arrive.enabled === true, 'near location arrive capability must be enabled');
  assert(arrive.visible === false, 'arrive capability should be hidden from the manual menu');
  assert(explore, 'capabilities must include explore');
  assert(typeof explore.enabled === 'boolean', 'explore capability must expose enabled boolean');

  const farTalk = await postCapabilities({
    worldId,
    actorId,
    mapId,
    targetActorId: target.actorId,
    locationId: target.locationId,
    actorTile: { x: 0, y: 0 },
    interactionRangeTiles: 1,
  });
  const far = capability(farTalk, 'talk');
  assert(far, 'far capabilities must include talk');
  assert(far.enabled === false, 'far target talk capability must be disabled');
  assert(String(far.reason ?? '').length > 0, 'disabled far talk must include reason');
  console.log('ok capabilities negative: out-of-range talk disabled');
  return { nearTalk, nearLocation, gift };
}

function assertTradeCapability(trade) {
  assert(trade, 'capabilities must include trade');
  assert(trade.category === 'target', 'trade capability must be target-scoped');
  assert(trade.enabled === true, 'near target trade capability must be enabled');
  assert(
    asCapabilityParams(trade, 'trade').offeredItemId === 'spirit_stone',
    'trade params must offer spirit_stone',
  );
  const tradeOptions = capabilityOptions(trade, 'trade');
  assert(tradeOptions.length > 0, 'trade must include at least one option');
  const firstTradeOption = asObject(tradeOptions[0], 'trade.options[0]');
  const multiTradeOption = tradeOptions.find((option) => Number(option?.requestedQty ?? 1) > 1);
  assert(multiTradeOption, 'trade options must include at least one multi-quantity option');
  assert(firstTradeOption.priceSpiritStones > 0, 'trade option must include priceSpiritStones');
  assert(
    firstTradeOption.unitPriceSpiritStones > 0,
    'trade option must include unitPriceSpiritStones',
  );
  assert(firstTradeOption.requestedQty >= 1, 'trade option must include requestedQty');
  assert(
    firstTradeOption.offeredQty === firstTradeOption.priceSpiritStones,
    'trade option offeredQty must match total price',
  );
  assert(
    firstTradeOption.priceSpiritStones ===
      firstTradeOption.unitPriceSpiritStones * firstTradeOption.requestedQty,
    'trade option total price must match unit price times requestedQty',
  );
  assert(
    firstTradeOption.buyerSpiritStones >= firstTradeOption.priceSpiritStones,
    'trade option must include buyerSpiritStones',
  );
  assert(
    firstTradeOption.requestedQtyAvailable > 0,
    'trade option must include requestedQtyAvailable',
  );
  assertTradeQuantityChoices(firstTradeOption, 'trade.options[0]');
  const quote = asObject(firstTradeOption.quote, 'trade.options[0].quote');
  assert(quote.basePrice > 0, 'trade quote must include basePrice');
  assert(
    quote.finalPrice === firstTradeOption.priceSpiritStones,
    'trade quote finalPrice must match option price',
  );
  assert(
    quote.requestedQty === firstTradeOption.requestedQty,
    'trade quote must include requestedQty',
  );
  assert(
    typeof quote.relationshipMultiplier === 'number',
    'trade quote must include relationshipMultiplier',
  );
  assert(
    typeof quote.suspicionMultiplier === 'number',
    'trade quote must include suspicionMultiplier',
  );
  assert(typeof quote.regularMultiplier === 'number', 'trade quote must include regularMultiplier');
  assert(
    asObject(firstTradeOption.params, 'trade.options[0].params').requestedItemId,
    'trade option must include requestedItemId',
  );
  assertExchangeTerms(firstTradeOption, 'trade.options[0]');
  assertInventoryDeltaPreview(firstTradeOption, 'trade.options[0]');
  assertConfirmationPreview(firstTradeOption, 'trade.options[0]', 'trade');
  const tradeDeltas = firstTradeOption.inventoryDeltaPreview.deltas;
  assert(
    tradeDeltas.some(
      (delta) =>
        delta.owner === 'actor' &&
        delta.itemId === 'spirit_stone' &&
        delta.delta === -firstTradeOption.priceSpiritStones,
    ),
    'trade preview must show actor spirit stone cost',
  );
  assert(
    tradeDeltas.some(
      (delta) =>
        delta.owner === 'actor' &&
        delta.itemId === firstTradeOption.requestedItemId &&
        delta.delta === 1,
    ),
    'trade preview must show actor receiving requested item',
  );
  assert(
    tradeDeltas.some(
      (delta) =>
        delta.owner === 'target' &&
        delta.itemId === firstTradeOption.requestedItemId &&
        delta.delta === -1,
    ),
    'trade preview must show seller stock decrease',
  );
  const multi = asObject(multiTradeOption, 'trade.options[multi]');
  assert(multi.requestedQty > 1, 'multi trade option must request more than one item');
  assert(
    multi.priceSpiritStones === multi.unitPriceSpiritStones * multi.requestedQty,
    'multi trade option total price must scale by requestedQty',
  );
  assert(
    asObject(multi.params, 'trade.options[multi].params').requestedQty === multi.requestedQty,
    'multi trade option params must include requestedQty',
  );
  assert(
    asObject(multi.params, 'trade.options[multi].params').offeredQty === multi.priceSpiritStones,
    'multi trade option params must include offeredQty',
  );
  assertTradeQuantityChoices(multi, 'trade.options[multi]');
  assertExchangeTerms(multi, 'trade.options[multi]');
  assertInventoryDeltaPreview(multi, 'trade.options[multi]');
  assertConfirmationPreview(multi, 'trade.options[multi]', 'trade');
  return { firstTradeOption, multiTradeOption: multi };
}

function assertTradeQuantityChoices(option, label) {
  const choices = asArray(option?.quantityChoices, `${label}.quantityChoices`);
  assert(
    choices.length >= 1,
    `${label} quantityChoices must include at least the current quantity`,
  );
  assert(
    option.quantityChoiceCount === choices.length,
    `${label} quantityChoiceCount must match quantityChoices`,
  );
  assert(
    option.quantityChoiceIndex >= 0 && option.quantityChoiceIndex < choices.length,
    `${label} quantityChoiceIndex must point into quantityChoices`,
  );
  const requestedQty = Number(option.requestedQty ?? 0);
  const matchingChoice = choices.find(
    (choice) => Number(choice?.requestedQty ?? 0) === requestedQty,
  );
  assert(matchingChoice, `${label} quantityChoices must include the selected requestedQty`);
  assert(
    matchingChoice.totalPriceSpiritStones === option.priceSpiritStones,
    `${label} selected quantity choice total price must match option price`,
  );
  assert(
    matchingChoice.unitPriceSpiritStones === option.unitPriceSpiritStones,
    `${label} quantity choice unit price must match option unit price`,
  );
  assert(
    matchingChoice.offeredQty === option.offeredQty,
    `${label} selected quantity choice offeredQty must match option offeredQty`,
  );
  const maxChoice = Math.max(...choices.map((choice) => Number(choice?.requestedQty ?? 0)));
  assert(
    option.maxSelectableQty === maxChoice,
    `${label} maxSelectableQty must match quantity choices`,
  );
  assert(
    typeof matchingChoice.label === 'string' && matchingChoice.label.length > 0,
    `${label} quantity choice must include label`,
  );
}

function assertExchangeTerms(source, label) {
  const terms = asArray(source?.exchangeTerms, `${label}.exchangeTerms`);
  assert(terms.length >= 2, `${label} exchangeTerms must include both sides`);
  for (const term of terms) {
    assert(['actor', 'target'].includes(term?.from), `${label} exchange term must include from`);
    assert(['actor', 'target'].includes(term?.to), `${label} exchange term must include to`);
    assert(term.from !== term.to, `${label} exchange term must move between sides`);
    assert(
      typeof term?.itemId === 'string' && term.itemId.length > 0,
      `${label} exchange term must include itemId`,
    );
    assert(
      typeof term?.itemName === 'string' && term.itemName.length > 0,
      `${label} exchange term must include itemName`,
    );
    assert(
      typeof term?.qty === 'number' && term.qty > 0,
      `${label} exchange term must include qty`,
    );
  }
}

function assertInventoryDeltaPreview(source, label) {
  const preview = asObject(source?.inventoryDeltaPreview, `${label}.inventoryDeltaPreview`);
  const deltas = asArray(preview.deltas, `${label}.inventoryDeltaPreview.deltas`);
  assert(deltas.length > 0, `${label} inventory delta preview must include deltas`);
  for (const delta of deltas) {
    assert(
      ['actor', 'target'].includes(delta?.owner),
      `${label} inventory delta must include owner`,
    );
    assert(
      typeof delta?.itemId === 'string' && delta.itemId.length > 0,
      `${label} inventory delta must include itemId`,
    );
    assert(
      typeof delta?.itemName === 'string' && delta.itemName.length > 0,
      `${label} inventory delta must include itemName`,
    );
    assert(typeof delta?.before === 'number', `${label} inventory delta must include before`);
    assert(typeof delta?.after === 'number', `${label} inventory delta must include after`);
    assert(typeof delta?.delta === 'number', `${label} inventory delta must include delta`);
    assert(
      delta.after === Math.max(0, delta.before + delta.delta),
      `${label} inventory delta after must match before + delta`,
    );
  }
}

function assertConfirmationPreview(source, label, expectedActionType) {
  const preview = asObject(source?.confirmationPreview, `${label}.confirmationPreview`);
  assert(
    preview.actionType === expectedActionType,
    `${label} confirmationPreview actionType must match`,
  );
  assert(
    preview.presentationSource === 'rule_template',
    `${label} confirmationPreview must use rule_template`,
  );
  assert(preview.previewOnly === true, `${label} confirmationPreview must be preview-only`);
  assert(
    typeof preview.summary === 'string' && preview.summary.length > 0,
    `${label} confirmationPreview must include summary`,
  );
  assert(
    typeof preview.primaryLine === 'string' && preview.primaryLine.length > 0,
    `${label} confirmationPreview must include primaryLine`,
  );
  assert(
    typeof preview.inventoryLine === 'string' && preview.inventoryLine.length > 0,
    `${label} confirmationPreview must include inventoryLine`,
  );
  if (expectedActionType === 'trade') {
    assert(
      typeof preview.balanceLine === 'string' && preview.balanceLine.length > 0,
      `${label} confirmationPreview must include balanceLine`,
    );
    assert(
      typeof preview.termsLine === 'string' && preview.termsLine.length > 0,
      `${label} confirmationPreview must include termsLine`,
    );
  }
  const notes = asArray(
    preview.durableEffectNotes,
    `${label}.confirmationPreview.durableEffectNotes`,
  );
  assert(
    notes.includes('actionRecords row'),
    `${label} confirmationPreview must mention actionRecords row`,
  );
  assert(
    notes.includes('worldEvents row'),
    `${label} confirmationPreview must mention worldEvents row`,
  );
  const policy = asObject(preview.policy, `${label}.confirmationPreview.policy`);
  assert(
    policy.convexAuthored === true,
    `${label} confirmationPreview policy must be Convex-authored`,
  );
  assert(
    policy.godotMayDisplayOnly === true,
    `${label} confirmationPreview policy must be display-only for Godot`,
  );
  assert(
    policy.durableStateUnchanged === true,
    `${label} confirmationPreview must not change durable state`,
  );
  assert(
    policy.submitPath === 'POST /godot/action',
    `${label} confirmationPreview must keep the formal action path`,
  );
}

function assertSettlementPreviewMatchesEffects(source, effects, label) {
  const itemTransfers = Array.isArray(effects?.items) ? effects.items : [];
  if (itemTransfers.length === 0) {
    return '';
  }
  const preview = asObject(source?.settlementPreview, `${label}.settlementPreview`);
  assert(
    preview.presentationSource === 'rule_template',
    `${label} settlementPreview must use rule_template`,
  );
  assert(
    preview.previewOnly === false,
    `${label} settlementPreview must not be preview-only after action resolution`,
  );
  assert(
    preview.durableSource === 'rules.effects.items',
    `${label} settlementPreview must identify durable effects source`,
  );
  assert(
    typeof preview.summary === 'string' && preview.summary.length > 0,
    `${label} settlementPreview must include summary`,
  );
  const transfers = asArray(preview.transfers, `${label}.settlementPreview.transfers`);
  assert(
    transfers.length === itemTransfers.length,
    `${label} settlementPreview transfer count must match result effects`,
  );
  for (const effect of itemTransfers) {
    const match = transfers.find(
      (transfer) =>
        transfer?.from === effect?.from &&
        transfer?.to === effect?.to &&
        transfer?.itemId === effect?.itemId &&
        transfer?.qty === effect?.qty,
    );
    assert(match, `${label} settlementPreview must mirror ${effect?.itemId} x${effect?.qty}`);
    assert(
      typeof match.itemName === 'string' && match.itemName.length > 0,
      `${label} settlement transfer must include itemName`,
    );
    assert(
      typeof match.line === 'string' && match.line.length > 0,
      `${label} settlement transfer must include line`,
    );
  }
  const policy = asObject(preview.policy, `${label}.settlementPreview.policy`);
  assert(
    policy.convexAuthored === true,
    `${label} settlementPreview policy must be Convex-authored`,
  );
  assert(
    policy.godotMayDisplayOnly === true,
    `${label} settlementPreview policy must be display-only`,
  );
  assert(
    policy.durableStateAlreadyResolved === true,
    `${label} settlementPreview must report resolved durable state`,
  );
  assert(
    policy.durableSummaryLocked === true,
    `${label} settlementPreview must lock durable summary`,
  );
  return preview.summary;
}

function assertSettlementPreviewMatchesSummary(source, expectedSummary, label) {
  const preview = asObject(source?.settlementPreview, `${label}.settlementPreview`);
  assert(
    preview.summary === expectedSummary,
    `${label} settlementPreview summary must match action response`,
  );
  assert(
    preview.durableSource === 'rules.effects.items',
    `${label} settlementPreview durableSource must match`,
  );
}

function assertRiskPreview(source, label, expectedCodes = []) {
  const preview = asObject(source?.riskPreview, `${label}.riskPreview`);
  assert(
    ['low', 'medium', 'high'].includes(preview.level),
    `${label} riskPreview must include a known level`,
  );
  assert(
    typeof preview.summary === 'string' && preview.summary.length > 0,
    `${label} riskPreview must include summary`,
  );
  assert(
    preview.presentationSource === 'rule_template',
    `${label} riskPreview must identify rule_template source`,
  );
  const details = asArray(preview.details, `${label}.riskPreview.details`);
  const possibleResultCodes = asArray(
    preview.possibleResultCodes,
    `${label}.riskPreview.possibleResultCodes`,
  );
  const ruleGates = asArray(preview.ruleGates, `${label}.riskPreview.ruleGates`);
  const durableEffects = asArray(preview.durableEffects, `${label}.riskPreview.durableEffects`);
  assert(details.length > 0, `${label} riskPreview must include details`);
  assert(possibleResultCodes.length > 0, `${label} riskPreview must include possible result codes`);
  assert(ruleGates.length > 0, `${label} riskPreview must include rule gates`);
  assert(durableEffects.length > 0, `${label} riskPreview must include durable effects`);
  for (const code of expectedCodes) {
    assert(
      possibleResultCodes.includes(code),
      `${label} riskPreview must include possible result code ${code}`,
    );
  }
}

async function postOutOfRangeTalkAndAssert(payload) {
  const actorBefore = await getProfile(payload.worldId, payload.actorId);
  const targetBefore = await getProfile(payload.worldId, payload.targetActorId);
  const { response, payload: body } = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      actorTile: { x: 0, y: 0 },
      interactionRangeTiles: 1,
      intent: 'This should be rejected as out of range',
    }),
  });
  assert(response.status === 409, 'out-of-range talk must return 409');
  assert(body.ok === false, 'out-of-range talk body must be ok=false');
  assert(
    body.errorCode === 'target_out_of_range',
    `out-of-range talk error code (got ${body.errorCode}: ${body.error})`,
  );
  assert(
    String(body.error ?? '').includes('Godot interaction range'),
    'out-of-range talk must mention Godot interaction range',
  );
  const actorAfter = await getProfile(payload.worldId, payload.actorId);
  const targetAfter = await getProfile(payload.worldId, payload.targetActorId);
  assert(
    durableLocationSnapshot(actorAfter) === durableLocationSnapshot(actorBefore),
    'out-of-range talk must not mutate actor durable location/intent',
  );
  assert(
    durableLocationSnapshot(targetAfter) === durableLocationSnapshot(targetBefore),
    'out-of-range talk must not mutate target durable location/intent',
  );
  console.log('ok out-of-range talk rejected');
}

async function postMissingActorTileAndAssert(payload) {
  const actorBefore = await getProfile(payload.worldId, payload.actorId);
  const targetBefore = await getProfile(payload.worldId, payload.targetActorId);
  const body = { ...payload };
  delete body.actorTile;
  const { response, payload: result } = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  assert(response.status === 400, 'target action without actorTile must return 400');
  assert(result.ok === false, 'missing-actorTile body must be ok=false');
  assert(result.errorCode === 'missing_actor_tile', 'missing-actorTile error code');
  assert(
    String(result.error ?? '').includes('requires actorTile'),
    'missing-actorTile rejection must identify the spatial evidence requirement',
  );
  const actorAfter = await getProfile(payload.worldId, payload.actorId);
  const targetAfter = await getProfile(payload.worldId, payload.targetActorId);
  assert(
    durableLocationSnapshot(actorAfter) === durableLocationSnapshot(actorBefore),
    'missing-actorTile rejection must not mutate actor durable location/intent',
  );
  assert(
    durableLocationSnapshot(targetAfter) === durableLocationSnapshot(targetBefore),
    'missing-actorTile rejection must not mutate target durable location/intent',
  );
  console.log('ok missing actorTile rejected without durable writes');
}

async function ensureQinglanProfiles(worldId) {
  const result = await convexClient.mutation(api.xianxia.qinglan.seedQinglanFangshi, { worldId });
  assert(result.worldId === worldId, 'Qinglan seed must preserve worldId');
  assert(result.profiles >= result.residents, 'Qinglan seed must synchronize resident profiles');
  console.log(`ok Qinglan profile lifecycle: ${result.profiles} profile(s) synchronized`);
}

async function moveSmokeActorToLocation(worldId, location, label) {
  assert(location?.locationId, `${label} requires a known Convex location`);
  const before = await getProfile(worldId, actorId);
  const payload = {
    worldId,
    actorId,
    clientActionId: newClientActionId(`arrive-${label}`),
    type: 'arrive',
    mapId,
    locationId: location.locationId,
    actorTile: firstEntryTile(location),
    intent: `Formal smoke movement to ${location.name ?? location.locationId}`,
    metadata: {
      test: 'godot-taixu-client/tools/check_bridge.mjs',
      purpose: 'semantic_location_hardening',
    },
  };
  const action = await postActionAndAssertReadback(payload, label);
  assert(action.result?.status === 'applied', `${label} arrive must be applied`);
  const change = assertLocationChangeEffect(action.result.effects, payload, label);
  assert(
    change.fromLocationId === before.currentLocationId,
    `${label} locationChange must record the prior location`,
  );
  const after = await getProfile(worldId, actorId);
  assert(after.mapId === mapId, `${label} must update actor map inside the action transaction`);
  assert(
    after.currentLocationId === location.locationId,
    `${label} must update actor semantic location inside the action transaction`,
  );
  assert(
    after.currentIntent === payload.intent,
    `${label} must update actor intent from the applied effect`,
  );
  console.log(
    `ok ${label} durable profile: ${change.fromLocationId ?? '?'} -> ${change.toLocationId}`,
  );
  return action;
}

async function ensureSmokeActorAtLocation(worldId, location, label) {
  assert(location?.locationId, `${label} requires a known Convex location`);
  const profile = await getProfile(worldId, actorId);
  if (profile.mapId === mapId && profile.currentLocationId === location.locationId) {
    console.log(`ok ${label}: actor already at ${location.locationId}`);
    return null;
  }
  return await moveSmokeActorToLocation(worldId, location, label);
}

async function postTickAndAssert(worldId) {
  const beforeTick = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}`);
  const beforeResidents = new Map(
    asArray(beforeTick.residents, 'preTick.residents').map((resident) => [
      resident?.actorId,
      residentSignature(resident),
    ]),
  );
  const payload = {
    worldId,
    mapId,
    limit: Number(process.env.GODOT_TICK_LIMIT ?? 4),
  };
  const response = await requestJson('/godot/tick', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert(response.ok === true, 'tick response must be ok');
  assert(response.worldId === worldId, 'tick response must preserve worldId');
  assert(
    typeof response.qinglan?.checked === 'number',
    'tick response must include qinglan.checked',
  );
  assert(
    typeof response.qinglan?.updated === 'number',
    'tick response must include qinglan.updated',
  );
  assert(typeof response.tick?.ticked === 'number', 'tick response must include tick.ticked');
  assert(Array.isArray(response.tick?.results), 'tick response must include tick.results');
  assert(response.tick?.lease?.acquired === true, 'normal debug tick must acquire the world lease');
  assert(
    typeof response.tick?.lease?.tickId === 'string' && response.tick.lease.tickId.length > 0,
    'normal debug tick must expose its tickId',
  );
  const scheduler = asObject(response.tick?.scheduler, 'tick.scheduler');
  const schedulerActorIds = asArray(scheduler.actorIds, 'tick.scheduler.actorIds');
  assert(scheduler.scope === mapId, 'tick scheduler scope must match requested map');
  assert(typeof scheduler.eligibleCount === 'number', 'tick scheduler must include eligibleCount');
  assert(typeof scheduler.wrapped === 'boolean', 'tick scheduler must include wrapped');
  assert(
    schedulerActorIds.length === response.tick.ticked,
    'tick scheduler actorIds must match ticked count',
  );
  assert(
    JSON.stringify(schedulerActorIds) ===
      JSON.stringify(response.tick.results.map((result) => result?.actorId)),
    'tick scheduler order must match tick results',
  );
  assert(
    response.tick.results.every((result) => {
      const resultActorId = String(result?.actorId ?? '');
      return resultActorId !== 'godot_player' && !resultActorId.startsWith('godot_smoke_');
    }),
    'debug tick must not select Godot-controlled player or godot_smoke_* fixture actors',
  );
  if (mapIsolationFixture) {
    assert(
      response.tick.results.every(
        (result) => result?.actorId !== mapIsolationFixture.profileActorId,
      ),
      'qinglan debug tick must not select another map profile',
    );
  }
  const tickEvents = asArray(response.tickEvents, 'tick.tickEvents');
  assert(
    tickEvents.length > 0,
    'tick response must include events produced or traced by this tick',
  );
  const presentedTickEvent = tickEvents.find(
    (event) =>
      typeof event?.displayText === 'string' &&
      event.displayText.length > 0 &&
      typeof event?.presentationSource === 'string',
  );
  assert(presentedTickEvent, 'tickEvents must include displayText and presentationSource');
  assertPresentationFields(presentedTickEvent, 'tickEvents presentation');
  assert(
    tickEvents.every((event) => event?.mapId === mapId),
    'tickEvents must stay on the requested map',
  );
  const actionBackedTickEvent = tickEvents.find(
    (event) => typeof event?.actionRecordId === 'string',
  );
  if (actionBackedTickEvent) {
    const tickRecordQuery = new URLSearchParams({
      actionRecordId: String(actionBackedTickEvent.actionRecordId),
      worldId: String(worldId),
    });
    const tickRecord = await requestJson(`/godot/actionRecord?${tickRecordQuery.toString()}`);
    assert(tickRecord.ok === true, 'tick actionRecord readback must be ok');
    assert(
      tickRecord.worldEventId === actionBackedTickEvent.worldEventId,
      'tick actionRecord must link back to tick worldEvent',
    );
  } else {
    assert(
      tickEvents.some((event) => event?.tickOnly === true),
      'tickEvents without actionRecordId must be explicitly marked tickOnly',
    );
  }
  const tickRecentEvents = asArray(response.recentEvents, 'tick.recentEvents');
  assert(tickRecentEvents.length > 0, 'tick response must include post-tick recentEvents');
  assert(
    tickRecentEvents.every((event) => event?.mapId === mapId),
    'tick recentEvents must stay on the requested map',
  );
  const after = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}`);
  assert(after.ok === true, 'regionState after tick must be ok');
  const afterResidents = asArray(after.residents, 'postTick.residents');
  assertResidentPresenceFields(afterResidents, 'post-tick region read');
  const changedResident = afterResidents.some(
    (resident) => beforeResidents.get(resident?.actorId) !== residentSignature(resident),
  );
  if (response.qinglan.updated > 0) {
    assert(
      changedResident,
      'tick reported resident updates but regionState residents did not visibly change',
    );
  }
  console.log(
    `ok debug tick: ${response.tick.ticked} actor(s), ${response.qinglan.updated} resident update(s), ${tickEvents.length} traced tick event(s)`,
  );
  return response;
}

async function assertOverlappingTickLease(worldId) {
  const base = `smoke-tick-lease:${actorId}:${Date.now()}`;
  const payloads = [`${base}:a`, `${base}:b`].map((tickId) => ({
    worldId,
    mapId,
    limit: 1,
    tickId,
  }));
  const responses = await Promise.all(
    payloads.map((payload) =>
      requestJson('/godot/tick', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    ),
  );
  const acquired = responses.filter((response) => response.tick?.lease?.acquired === true);
  const busy = responses.filter((response) => response.tick?.lease?.acquired === false);
  assert(acquired.length === 1, 'exactly one overlapping tick must acquire the world lease');
  assert(busy.length === 1, 'exactly one overlapping tick must return lease-busy');
  assert(
    ['tick_lease_busy', 'tick_already_active'].includes(busy[0].tick?.lease?.reason),
    'overlapping tick must return an explicit busy reason',
  );
  assert(
    asArray(busy[0].tickEvents, 'busy tickEvents').some(
      (event) => event?.tickOnly === true && event?.resultCode === busy[0].tick?.lease?.reason,
    ),
    'lease-busy response must include an explicit tickOnly observation',
  );

  const completedTickId = acquired[0].tick.lease.tickId;
  const replay = await requestJson('/godot/tick', {
    method: 'POST',
    body: JSON.stringify({ worldId, mapId, limit: 1, tickId: completedTickId }),
  });
  assert(replay.tick?.lease?.acquired === false, 'completed tickId retry must not advance again');
  assert(
    replay.tick?.lease?.reason === 'tick_already_completed',
    'completed tickId retry must expose tick_already_completed',
  );
  console.log('ok tick lease: overlap serialized and completed tickId replay skipped');
}

async function postLocationCapabilities(worldId, location) {
  return await postCapabilities({
    worldId,
    actorId,
    mapId,
    locationId: location.locationId,
    actorTile: firstEntryTile(location),
    interactionRangeTiles: 5,
  });
}

async function assertBreakthroughDisabled(worldId, location) {
  const result = await postLocationCapabilities(worldId, location);
  const breakthrough = capability(result, 'breakthrough');
  assert(breakthrough, 'capabilities must include breakthrough');
  assert(
    breakthrough.enabled === false,
    'breakthrough should start disabled for a fresh smoke actor',
  );
  assert(
    String(breakthrough.reason ?? '').length > 0,
    'disabled breakthrough must include a reason',
  );
  assert(
    typeof breakthrough.breakthroughThreshold === 'number',
    'breakthrough capability must include breakthroughThreshold',
  );
  assert(typeof breakthrough.realm === 'string', 'breakthrough capability must include realm');
  assert(
    typeof breakthrough.realmStage === 'number',
    'breakthrough capability must include realmStage',
  );
  assert(
    typeof breakthrough.cultivationXp === 'number',
    'breakthrough capability must include cultivationXp',
  );
  assertRiskPreview(breakthrough, 'disabled breakthrough capability');
  console.log(`ok capabilities negative: breakthrough disabled (${breakthrough.reason})`);
}

async function primeTeachingCandidate() {
  const result = await convexClient.mutation(api.godotTesting.primeGodotTeachingCandidate, {
    actorId,
    mapId,
  });
  assert(result.actorId === actorId, 'teaching fixture must prime the smoke actor');
  assert(result.targetActorId, 'teaching fixture must return targetActorId');
  assert(result.locationId, 'teaching fixture must return locationId');
  console.log(
    `ok fixture: primed ${actorId} for teaching with ${result.targetActorId} at ${result.locationId}`,
  );
  return result;
}

async function primeTradeCandidate() {
  const result = await convexClient.mutation(api.godotTesting.primeGodotTradeCandidate, {
    actorId,
    mapId,
  });
  assert(result.actorId === actorId, 'trade fixture must prime the smoke actor');
  assert(result.targetActorId, 'trade fixture must return targetActorId');
  assert(result.locationId, 'trade fixture must return locationId');
  assert(result.actorSpiritStones >= 24, 'trade fixture must fund the smoke actor');
  assert(result.targetStock >= 2, 'trade fixture must stock at least two requested items');
  console.log(
    `ok fixture: primed ${actorId} for trade with ${result.targetActorId} at ${result.locationId}`,
  );
  return result;
}

async function primeBreakthroughCandidate(worldId, location) {
  const result = await convexClient.mutation(api.godotTesting.primeGodotBreakthroughCandidate, {
    actorId,
    mapId,
    locationId: location.locationId,
  });
  assert(result.worldId === worldId, 'breakthrough fixture must use the same worldId');
  assert(result.actorId === actorId, 'breakthrough fixture must prime the smoke actor');
  assert(
    result.locationId === location.locationId,
    'breakthrough fixture must use the breakthrough location',
  );
  console.log(
    `ok fixture: primed ${actorId} for breakthrough at ${location.locationId} (${result.realm} ${result.realmStage})`,
  );
  return result;
}

async function cleanupSmokeFixture() {
  const totals = await cleanupSmokeActor(actorId);
  console.log(
    `ok fixture cleanup: ${totals.pages} bounded page(s), profile ${totals.profilesDeleted}, relationships ${totals.relationshipsDeleted}, memories ${totals.memoriesDeleted}, requests ${totals.requestsDeleted}`,
  );
  return totals;
}

async function cleanupSmokeActor(smokeActorId) {
  const totals = {
    actorId: smokeActorId,
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
      actorId: smokeActorId,
      phase,
      cursor,
      limit: 50,
    });
    assert(result.actorId === smokeActorId, 'cleanup fixture must clean the smoke actor');
    assert(result.phase === phase, 'cleanup fixture must preserve requested phase');
    assert(result.durableTracePreserved === true, 'cleanup fixture must preserve durable traces');
    assert(Number.isInteger(result.scanned), 'cleanup fixture must report scanned rows');
    totals.pages += 1;
    for (const key of [
      'profilesDeleted',
      'relationshipsDeleted',
      'memoriesDeleted',
      'requestsDeleted',
    ]) {
      assert(Number.isInteger(result[key]), `cleanup fixture must report ${key}`);
      totals[key] += result[key];
    }
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
  throw new Error(`cleanup fixture exceeded 1000 bounded pages for ${smokeActorId}`);
}

async function primeMapIsolationFixture() {
  const result = await convexClient.mutation(api.godotTesting.primeGodotMapIsolationFixture, {
    actorId,
  });
  assert(result.actorId === actorId, 'map isolation fixture must use the smoke actor');
  assert(result.otherMapId, 'map isolation fixture must return another mapId');
  assert(result.qinglanEventId, 'map isolation fixture must return a qinglan event');
  assert(result.otherMapEventId, 'map isolation fixture must return an other-map event');
  assert(result.maplessEventId, 'map isolation fixture must return a mapless event');
  console.log(`ok fixture: primed exact-map boundary against ${result.otherMapId}`);
  return result;
}

async function cleanupMapIsolationFixture() {
  const result = await convexClient.mutation(api.godotTesting.cleanupGodotMapIsolationFixture, {
    actorId,
  });
  assert(result.actorId === actorId, 'map isolation cleanup must use the smoke actor');
  assert(result.eventsDeleted === 3, 'map isolation cleanup must delete all fixture events');
  assert(result.memoriesDeleted === 3, 'map isolation cleanup must delete all fixture memories');
  assert(result.residentDeleted === 1, 'map isolation cleanup must delete its resident');
  assert(result.locationDeleted === 1, 'map isolation cleanup must delete its location');
  assert(result.profileDeleted === 1, 'map isolation cleanup must delete its profile');
  console.log('ok fixture cleanup: removed all multi-map isolation rows');
  return result;
}

function assertPageInfo(value, label) {
  const page = asObject(value, label);
  assert(Number.isInteger(page.limit), `${label}.limit must be an integer`);
  assert(Number.isInteger(page.returned), `${label}.returned must be an integer`);
  assert(typeof page.isDone === 'boolean', `${label}.isDone must be boolean`);
  assert(typeof page.truncated === 'boolean', `${label}.truncated must be boolean`);
  if (page.isDone) assert(page.continueCursor === null, `${label} done page must clear cursor`);
  else {
    assert(
      typeof page.continueCursor === 'string' && page.continueCursor.length > 0,
      `${label} open page must include cursor`,
    );
  }
  return page;
}

async function assertMapIsolation(worldId, fixture) {
  const qinglan = await requestJson(
    `/godot/regionState?${new URLSearchParams({ worldId: String(worldId), mapId }).toString()}`,
  );
  const qinglanLocations = asArray(qinglan.locations, 'map isolation qinglan locations');
  const qinglanResidents = asArray(qinglan.residents, 'map isolation qinglan residents');
  const qinglanEvents = asArray(qinglan.recentEvents, 'map isolation qinglan events');
  assert(
    !qinglanLocations.some((location) => location?.locationId === fixture.locationId),
    'qinglan region must exclude another map location',
  );
  assert(
    !qinglanResidents.some((resident) => resident?.actorId === fixture.residentActorId),
    'qinglan region must exclude another map resident',
  );
  assert(
    qinglanEvents.every((event) => event?.mapId === mapId),
    'qinglan region must return only exact-map events',
  );
  assert(
    qinglanEvents.some((event) => event?.worldEventId === fixture.qinglanEventId),
    'qinglan region must include its fixture event',
  );
  assert(
    !qinglanEvents.some(
      (event) =>
        event?.worldEventId === fixture.otherMapEventId ||
        event?.worldEventId === fixture.maplessEventId,
    ),
    'qinglan region must exclude other-map and mapless events',
  );
  assertPageInfo(qinglan.pagination?.locations, 'qinglan pagination.locations');
  assertPageInfo(qinglan.pagination?.residents, 'qinglan pagination.residents');
  assertPageInfo(qinglan.pagination?.recentEvents, 'qinglan pagination.recentEvents');

  const other = await requestJson(
    `/godot/regionState?${new URLSearchParams({
      worldId: String(worldId),
      mapId: fixture.otherMapId,
    }).toString()}`,
  );
  assert(
    asArray(other.locations, 'map isolation other locations').some(
      (location) => location?.locationId === fixture.locationId,
    ),
    'other map region must include its location',
  );
  assert(
    asArray(other.residents, 'map isolation other residents').some(
      (resident) => resident?.actorId === fixture.residentActorId,
    ),
    'other map region must include its resident',
  );
  const otherEvents = asArray(other.recentEvents, 'map isolation other events');
  assert(
    otherEvents.length > 0 && otherEvents.every((event) => event?.mapId === fixture.otherMapId),
    'other map region must return only exact-map events',
  );
  assert(
    otherEvents.some((event) => event?.worldEventId === fixture.otherMapEventId),
    'other map region must include its event',
  );

  const qinglanWorld = await requestJson(
    `/godot/worldState?${new URLSearchParams({ worldId: String(worldId), mapId }).toString()}`,
  );
  assert(
    asArray(qinglanWorld.recentEvents, 'map isolation world events').every(
      (event) => event?.mapId === mapId,
    ),
    'worldState recentEvents must obey exact map ownership',
  );
  assert(
    !asArray(qinglanWorld.actors?.residents, 'map isolation world residents').some(
      (resident) => resident?.actorId === fixture.residentActorId,
    ),
    'worldState residents must exclude another map',
  );
  assertPageInfo(qinglanWorld.pagination?.residents, 'world pagination.residents');
  assertPageInfo(qinglanWorld.pagination?.recentEvents, 'world pagination.recentEvents');

  const qinglanContext = await requestJson(
    `/godot/actorContext?${new URLSearchParams({
      worldId: String(worldId),
      mapId,
      actorId,
      viewerActorId: actorId,
    }).toString()}`,
  );
  assert(qinglanContext.profile?.mapId === undefined, 'profile projection must not expose raw map');
  assert(qinglanContext.profile?.actorId === actorId, 'qinglan actorContext must include actor profile');
  assert(
    asArray(qinglanContext.recentEvents, 'map isolation qinglan context events').every(
      (event) => event?.mapId === mapId,
    ),
    'actorContext events must stay on the requested map',
  );
  const qinglanMemories = asArray(
    qinglanContext.memories,
    'map isolation qinglan context memories',
  );
  assert(
    qinglanMemories.some((memory) => memory?.sourceEventId === fixture.qinglanEventId),
    'qinglan actorContext must include memory sourced from its map',
  );
  assert(
    !qinglanMemories.some(
      (memory) =>
        memory?.sourceEventId === fixture.otherMapEventId ||
        memory?.sourceEventId === fixture.maplessEventId,
    ),
    'actorContext must exclude memories sourced from other-map or mapless events',
  );
  assert(
    qinglanContext.contextWindow?.policy === 'exact_map',
    'actorContext must disclose exact-map window policy',
  );

  const otherContext = await requestJson(
    `/godot/actorContext?${new URLSearchParams({
      worldId: String(worldId),
      mapId: fixture.otherMapId,
      actorId,
      viewerActorId: actorId,
    }).toString()}`,
  );
  assert(otherContext.profile === null, 'other-map actorContext must hide qinglan actor profile');
  assert(
    asArray(otherContext.recentEvents, 'map isolation other context events').every(
      (event) => event?.mapId === fixture.otherMapId,
    ),
    'other-map actorContext events must stay on the requested map',
  );
  assert(
    asArray(otherContext.memories, 'map isolation other context memories').some(
      (memory) => memory?.sourceEventId === fixture.otherMapEventId,
    ),
    'other-map actorContext must include its source-bound memory',
  );

  for (const [label, requestedMapId, expectedEventId] of [
    ['qinglan', mapId, fixture.qinglanEventId],
    ['other', fixture.otherMapId, fixture.otherMapEventId],
  ]) {
    const replay = await requestJson(
      `/godot/replay?${new URLSearchParams({
        worldId: String(worldId),
        mapId: requestedMapId,
        actorId,
        limit: '50',
      }).toString()}`,
    );
    const entries = asArray(replay.entries, `map isolation ${label} replay`);
    assert(
      entries.every((entry) => entry?.mapId === requestedMapId),
      `${label} replay must contain only exact-map entries`,
    );
    assert(
      entries.some((entry) => entry?.worldEventId === expectedEventId),
      `${label} replay must include its fixture event`,
    );
    assertPageInfo(replay.pagination, `map isolation ${label} replay pagination`);
  }

  const firstPage = await requestJson(
    `/godot/regionState?${new URLSearchParams({
      worldId: String(worldId),
      mapId,
      limit: '1',
    }).toString()}`,
  );
  const firstLocationPage = assertPageInfo(
    firstPage.pagination?.locations,
    'map isolation first location page',
  );
  assert(firstLocationPage.isDone === false, 'qinglan location page size 1 must have continuation');
  const secondPage = await requestJson(
    `/godot/regionState?${new URLSearchParams({
      worldId: String(worldId),
      mapId,
      limit: '1',
      locationsCursor: firstLocationPage.continueCursor,
    }).toString()}`,
  );
  const firstLocationId = asArray(firstPage.locations, 'first location page')[0]?.locationId;
  const secondLocationId = asArray(secondPage.locations, 'second location page')[0]?.locationId;
  assert(firstLocationId && secondLocationId, 'location continuation pages must contain rows');
  assert(firstLocationId !== secondLocationId, 'location continuation must not repeat page one');
  console.log('ok exact-map isolation: region/world/context/replay/tick inputs and cursors');
}

async function assertPlayerSafeProjection(worldId, targetActorId) {
  const region = await requestJson(
    `/godot/regionState?${new URLSearchParams({ worldId: String(worldId), mapId }).toString()}`,
    { authToken: playerToken },
  );
  assert(region.readProjection === 'player', 'player region must disclose player projection');

  const context = await requestJson(
    `/godot/actorContext?${new URLSearchParams({
      worldId: String(worldId),
      mapId,
      actorId: targetActorId,
    }).toString()}`,
    { authToken: playerToken },
  );
  assert(context.readProjection === 'player', 'player actorContext must use player projection');
  assert(context.privateActorState === false, 'player actorContext must not expose NPC private state');
  assert(
    context.relationship?.actorToViewer === null,
    'player actorContext must hide target-to-viewer relationship state',
  );
  for (const key of ['health', 'spirit', 'inventoryCount', 'cultivationXp', 'innerTrait']) {
    assert(
      !Object.prototype.hasOwnProperty.call(context.profile ?? {}, key),
      `player actorContext profile must hide ${key}`,
    );
  }
  assert(
    context.contextWindow?.policy === 'viewer_safe_exact_map',
    'player actorContext must disclose viewer-safe exact-map policy',
  );

  const replay = await requestJson(
    `/godot/replay?${new URLSearchParams({
      worldId: String(worldId),
      mapId,
      actorId: targetActorId,
      limit: '12',
    }).toString()}`,
    { authToken: playerToken },
  );
  assert(replay.readProjection === 'player', 'player replay must disclose player projection');
  console.log('ok player-safe projection: region/context/replay hide NPC private state');
}

async function assertBreakthroughEnabled(worldId, location) {
  const result = await postLocationCapabilities(worldId, location);
  const breakthrough = capability(result, 'breakthrough');
  assert(breakthrough, 'capabilities must include breakthrough after fixture');
  assert(
    breakthrough.enabled === true,
    'breakthrough must be enabled for a primed realm-gate actor',
  );
  assert(breakthrough.realmGate === true, 'breakthrough capability must identify a realm gate');
  assert(
    Number(breakthrough.cultivationXp ?? 0) >= Number(breakthrough.breakthroughThreshold ?? 1),
    'breakthrough capability must expose enough cultivationXp',
  );
  assertRiskPreview(breakthrough, 'enabled breakthrough capability', [
    'breakthrough_success',
    'breakthrough_failed',
    'breakthrough_deviation',
  ]);
  console.log('ok capabilities positive: breakthrough enabled at realm gate');
  return breakthrough;
}

async function assertAuthenticationGuards() {
  const replayPath = `/godot/replay?${new URLSearchParams({
    worldId: boundWorldId,
    mapId,
    actorId,
    limit: '8',
  }).toString()}`;
  const profileBefore = await getOptionalProfile(boundWorldId, actorId);
  const replayBefore = await requestJson(replayPath);
  const entriesBefore = asArray(replayBefore.entries, 'auth replay before').map((entry) =>
    String(entry?.actionRecordId ?? entry?.worldEventId ?? entry?.id ?? ''),
  );

  const missing = await requestJsonAllowError(`/godot/regionState?mapId=${mapId}`, {
    authToken: null,
  });
  assert(missing.response.status === 401, 'missing bridge credential must return 401');
  assert(missing.payload.errorCode === 'bridge_auth_required', 'missing credential error code');

  const invalid = await requestJsonAllowError(`/godot/regionState?mapId=${mapId}`, {
    authToken: 'definitely-invalid-bridge-token-000000000',
  });
  assert(invalid.response.status === 401, 'invalid bridge credential must return 401');
  assert(invalid.payload.errorCode === 'bridge_auth_invalid', 'invalid credential error code');

  const wrongWorld = await requestJsonAllowError(
    `/godot/regionState?mapId=${mapId}&worldId=wrong-world-binding`,
  );
  assert(wrongWorld.response.status === 403, 'wrong world binding must return 403');
  assert(wrongWorld.payload.errorCode === 'bridge_world_forbidden', 'wrong world error code');

  const wrongActor = await requestJsonAllowError('/godot/capabilities', {
    method: 'POST',
    body: JSON.stringify({ worldId: boundWorldId, actorId: 'npc_admin', mapId }),
  });
  assert(wrongActor.response.status === 403, 'wrong actor binding must return 403');
  assert(wrongActor.payload.errorCode === 'bridge_actor_forbidden', 'wrong actor error code');

  const forgedSource = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      clientActionId: newClientActionId('forged-source'),
      source: 'agent',
      type: 'talk',
      mapId,
    }),
  });
  assert(forgedSource.response.status === 403, 'forged action source must return 403');
  assert(forgedSource.payload.errorCode === 'bridge_source_forbidden', 'forged source error code');

  const playerTick = await requestJsonAllowError('/godot/tick', {
    authToken: playerToken,
    method: 'POST',
    body: JSON.stringify({ worldId: boundWorldId, mapId, limit: 1 }),
  });
  assert(playerTick.response.status === 403, 'player credential must not call debug tick');
  assert(playerTick.payload.errorCode === 'bridge_scope_forbidden', 'player tick error code');

  const foreignOrigin = await requestJsonAllowError(`/godot/regionState?mapId=${mapId}`, {
    headers: { Origin: 'https://forbidden.example' },
  });
  assert(foreignOrigin.response.status === 403, 'foreign browser origin must return 403');
  assert(foreignOrigin.payload.errorCode === 'bridge_origin_forbidden', 'origin error code');

  const missingClientActionId = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      type: 'talk',
      mapId,
    }),
  });
  assert(missingClientActionId.response.status === 400, 'missing clientActionId must return 400');
  assert(
    missingClientActionId.payload.errorCode === 'missing_client_action_id',
    'missing clientActionId error code',
  );

  const malformedJson = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: '{bad json',
  });
  assert(malformedJson.response.status === 400, 'malformed JSON must return 400');
  assert(malformedJson.payload.errorCode === 'malformed_json', 'malformed JSON error code');

  const unknownAction = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      clientActionId: newClientActionId('unknown-action'),
      type: 'dance',
      mapId,
    }),
  });
  assert(unknownAction.response.status === 400, 'unknown action must return 400');
  assert(unknownAction.payload.errorCode === 'unknown_action_type', 'unknown action error code');

  const invalidTile = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      clientActionId: newClientActionId('invalid-tile'),
      type: 'talk',
      targetActorId: 'qinglan:anyone',
      locationId: 'market_main_street',
      mapId,
      actorTile: { x: 'not-a-number', y: 2 },
      params: {},
    }),
  });
  assert(invalidTile.response.status === 400, 'invalid tile must return 400');
  assert(invalidTile.payload.errorCode === 'invalid_number', 'invalid tile error code');

  const unsafeMetadata = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      clientActionId: newClientActionId('unsafe-metadata'),
      type: 'talk',
      targetActorId: 'qinglan:anyone',
      locationId: 'market_main_street',
      mapId,
      actorTile: { x: 1, y: 2 },
      params: {},
      metadata: { durableState: 'invented' },
    }),
  });
  assert(unsafeMetadata.response.status === 400, 'unsafe metadata must return 400');
  assert(unsafeMetadata.payload.errorCode === 'unknown_field', 'unsafe metadata error code');

  const oversizedIntent = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      clientActionId: newClientActionId('oversized-intent'),
      type: 'talk',
      targetActorId: 'qinglan:anyone',
      locationId: 'market_main_street',
      mapId,
      actorTile: { x: 1, y: 2 },
      intent: 'x'.repeat(513),
      params: {},
    }),
  });
  assert(oversizedIntent.response.status === 400, 'oversized intent must return 400');
  assert(oversizedIntent.payload.errorCode === 'text_too_long', 'oversized intent error code');

  const forgedFacts = await requestJsonAllowError('/godot/action', {
    method: 'POST',
    body: JSON.stringify({
      worldId: boundWorldId,
      actorId,
      clientActionId: newClientActionId('forged-facts'),
      type: 'talk',
      targetActorId: 'qinglan:anyone',
      locationId: 'market_main_street',
      mapId,
      actorTile: { x: 1, y: 2 },
      params: {},
      facts: { resultCode: 'invented_success' },
    }),
  });
  assert(forgedFacts.response.status === 400, 'forged facts must return 400');
  assert(forgedFacts.payload.errorCode === 'unknown_field', 'forged facts error code');

  const invalidTick = await requestJsonAllowError('/godot/tick', {
    method: 'POST',
    body: JSON.stringify({ worldId: boundWorldId, mapId, limit: 1.5 }),
  });
  assert(invalidTick.response.status === 400, 'fractional tick limit must return 400');
  assert(invalidTick.payload.errorCode === 'invalid_integer', 'fractional tick error code');

  const invalidReplayLimit = await requestJsonAllowError(
    `/godot/replay?mapId=${mapId}&limit=not-a-number`,
  );
  assert(invalidReplayLimit.response.status === 400, 'invalid replay limit must return 400');
  assert(
    invalidReplayLimit.payload.errorCode === 'invalid_query_number',
    'invalid replay limit error code',
  );
  const invalidPaginationCursor = await requestJsonAllowError(
    `/godot/regionState?mapId=${mapId}&locationsCursor=not-a-convex-cursor`,
  );
  assert(
    invalidPaginationCursor.response.status === 400,
    'invalid pagination cursor must return 400',
  );
  assert(
    invalidPaginationCursor.payload.errorCode === 'invalid_pagination_cursor',
    'invalid pagination cursor error code',
  );

  const unknownQuery = await requestJsonAllowError(
    `/godot/regionState?mapId=${mapId}&inventedFact=true`,
  );
  assert(unknownQuery.response.status === 400, 'unknown query parameter must return 400');
  assert(
    unknownQuery.payload.errorCode === 'unknown_query_parameter',
    'unknown query parameter error code',
  );

  const duplicateQuery = await requestJsonAllowError(
    `/godot/regionState?mapId=${mapId}&mapId=${mapId}`,
  );
  assert(duplicateQuery.response.status === 400, 'duplicate query parameter must return 400');
  assert(
    duplicateQuery.payload.errorCode === 'duplicate_query_parameter',
    'duplicate query parameter error code',
  );

  const postQuery = await requestJsonAllowError('/godot/action?unexpected=true', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert(postQuery.response.status === 400, 'POST query parameter must return 400');
  assert(
    postQuery.payload.errorCode === 'unknown_query_parameter',
    'POST query parameter error code',
  );

  const invalidActionRecordId = await requestJsonAllowError(
    `/godot/actionRecord?actionRecordId=not-a-convex-id`,
  );
  assert(invalidActionRecordId.response.status === 400, 'invalid actionRecordId must return 400');
  assert(
    invalidActionRecordId.payload.errorCode === 'invalid_request_value',
    'invalid actionRecordId error code',
  );

  const profileAfter = await getOptionalProfile(boundWorldId, actorId);
  const replayAfter = await requestJson(replayPath);
  const entriesAfter = asArray(replayAfter.entries, 'auth replay after').map((entry) =>
    String(entry?.actionRecordId ?? entry?.worldEventId ?? entry?.id ?? ''),
  );
  assert(
    JSON.stringify(profileAfter) === JSON.stringify(profileBefore),
    'rejected auth requests must not change the actor profile',
  );
  assert(
    JSON.stringify(entriesAfter) === JSON.stringify(entriesBefore),
    'rejected auth requests must not create action/event replay entries',
  );
  console.log('ok auth/contract guards: credentials, bindings, malformed input, and unsafe fields fail closed');
}

console.log(`Checking Godot bridge at ${baseUrl} for map ${mapId}`);

const health = await requestJson('/godot', { authToken: null });
assert(health.ok === true, '/godot health must be ok');
assert(health.security?.configured === true, '/godot security must be configured');
assert(health.security?.debugTickEnabled === true, '/godot debug credential must be enabled');
assert(
  JSON.stringify(health.hardeningVersions) ===
    JSON.stringify({
      spatialAdjudication: 1,
      viewerProjection: 1,
      tickLease: 1,
      memoryFanoutJob: 1,
      durableSchema: 1,
    }),
  '/godot runtime must advertise the current hardening versions',
);
assert(health.routes?.action === 'POST /godot/action', '/godot must advertise POST /godot/action');
assert(
  health.routes?.capabilities === 'POST /godot/capabilities',
  '/godot must advertise POST /godot/capabilities',
);
assert(
  health.routes?.tick === 'POST /godot/tick (debug credential only)',
  '/godot must advertise debug-only POST /godot/tick',
);
assert(
  health.routes?.presentationPreview ===
    'GET /godot/presentationPreview?actionRecordId=...&mode=llm_polish',
  '/godot must advertise GET /godot/presentationPreview',
);
assert(
  health.routes?.actorContext === 'GET /godot/actorContext?actorId=...',
  '/godot must advertise GET /godot/actorContext',
);
assert(
  health.routes?.replay === 'GET /godot/replay?mapId=qinglan',
  '/godot must advertise GET /godot/replay',
);
console.log('ok health route');

await assertAuthenticationGuards();

let bridgeCheckPassed = false;
try {
const teachingFixture = await primeTeachingCandidate();
const tradeFixture = await primeTradeCandidate();
await ensureQinglanProfiles(teachingFixture.worldId);
mapIsolationFixture = await primeMapIsolationFixture();
assert(
  mapIsolationFixture.worldId === teachingFixture.worldId,
  'map isolation fixture must use the bridge world',
);
await assertMapIsolation(teachingFixture.worldId, mapIsolationFixture);
await assertPlayerSafeProjection(teachingFixture.worldId, preferredTarget);
const before = await requestJson(`/godot/regionState?mapId=${encodeURIComponent(mapId)}`);
assert(before.ok === true, 'regionState must be ok');
assert(before.worldId, 'regionState must include worldId');
assert(before.worldId === teachingFixture.worldId, 'regionState must use teaching fixture worldId');
assert(before.worldId === tradeFixture.worldId, 'regionState must use trade fixture worldId');
const residents = asArray(before.residents, 'regionState.residents');
const locations = asArray(before.locations, 'regionState.locations');
assert(residents.length > 0, 'regionState must include at least one resident');
assert(locations.length > 0, 'regionState must include at least one location');
assertResidentPresenceFields(residents, 'region read');
const { target } = await pickTalkableTarget(before.worldId, residents);
assert(target, 'must find a target resident');
const { target: sparTarget, spar } = await pickSparTarget(before.worldId, residents);
assert(sparTarget, 'must find a spar target resident');
const {
  target: teachingTarget,
  teaching,
  locationId: teachingLocationId,
} = await pickTeachingTarget(before.worldId, residents, teachingFixture.targetActorId);
assert(teachingTarget, 'must find a teaching target resident');
const { target: tradeTarget, trade } = await pickTradeTarget(before.worldId, residents);
assert(tradeTarget, 'must find a trade target resident');
const { multiTradeOption } = assertTradeCapability(trade);
const arrivalLocation = pickLocation(locations, target.locationId);
assert(arrivalLocation, 'must find an arrival location');
const cultivateLocation = pickLocationAllowing(locations, 'cultivate');
assert(cultivateLocation, 'must find a cultivate-enabled location');
const breakthroughLocation = pickLocationAllowing(locations, 'breakthrough');
assert(breakthroughLocation, 'must find a breakthrough-enabled location');
console.log(`ok region read: ${residents.length} residents, ${locations.length} locations`);

const actorAwayLocation = locations.find(
  (location) => location?.locationId && location.locationId !== arrivalLocation.locationId,
);
assert(actorAwayLocation, 'must find a different location for actor-presence capability check');
await moveSmokeActorToLocation(
  before.worldId,
  actorAwayLocation,
  'formal move before actor-presence capability negative',
);
const preArrivalCapabilities = await postCapabilities({
  worldId: before.worldId,
  actorId,
  mapId,
  targetActorId: target.actorId,
  locationId: arrivalLocation.locationId,
  actorTile: tilePayload(target.tile),
  interactionRangeTiles: 5,
});
assert(
  capability(preArrivalCapabilities, 'talk')?.enabled === false &&
    capability(preArrivalCapabilities, 'talk')?.reason ===
      'Actor must formally arrive at the current location.',
  'capabilities must not enable target actions from physical proximity without formal arrival',
);
console.log('ok capabilities negative: actor must formally arrive before target action');
await moveSmokeActorToLocation(
  before.worldId,
  arrivalLocation,
  'formal move before target capabilities',
);
const capabilityFixtures = await postCapabilitiesAndAssert(before.worldId, target, arrivalLocation);

const talkPayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('talk'),
  type: 'talk',
  targetActorId: target.actorId,
  mapId: before.mapId ?? mapId,
  locationId: target.locationId,
  actorTile: tilePayload(target.tile),
  interactionRangeTiles: 5,
  intent,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

await postOutOfRangeTalkAndAssert(talkPayload);
await postMissingActorTileAndAssert(talkPayload);
const talkAction = await postActionAndAssertReadback(talkPayload, 'talk action');
const retriedTalkAction = await postActionAndAssertReadback(
  talkPayload,
  'talk action timeout-style retry',
  true,
);
assert(
  retriedTalkAction.actionRecordId === talkAction.actionRecordId &&
    retriedTalkAction.eventId === talkAction.eventId,
  'same clientActionId must return the original talk lifecycle',
);
const replayBeforeConflict = await requestJson(
  `/godot/replay?${new URLSearchParams({
    worldId: String(before.worldId),
    mapId,
    actorId,
    limit: '20',
  }).toString()}`,
);
const conflictingTalkKey = await requestJsonAllowError('/godot/action', {
  method: 'POST',
  body: JSON.stringify({ ...talkPayload, type: 'gift', params: { itemId: 'spirit_stone' } }),
});
assert(conflictingTalkKey.response.status === 409, 'reused key with changed semantics must return 409');
assert(
  conflictingTalkKey.payload.errorCode === 'action_idempotency_conflict',
  'changed semantics must expose idempotency conflict',
);
const replayAfterConflict = await requestJson(
  `/godot/replay?${new URLSearchParams({
    worldId: String(before.worldId),
    mapId,
    actorId,
    limit: '20',
  }).toString()}`,
);
assert(
  JSON.stringify(replayAfterConflict.entries) === JSON.stringify(replayBeforeConflict.entries),
  'idempotency conflict must not create another replay lifecycle',
);
const secondTalkAction = await postActionAndAssertReadback(
  { ...talkPayload, clientActionId: newClientActionId('talk-new-command') },
  'talk action with new clientActionId',
);
assert(
  secondTalkAction.actionRecordId !== talkAction.actionRecordId &&
    secondTalkAction.eventId !== talkAction.eventId,
  'new clientActionId must create a new talk lifecycle',
);
const concurrentTalkPayload = {
  ...talkPayload,
  clientActionId: newClientActionId('talk-concurrent-retry'),
};
const concurrentTalkResults = await Promise.all(
  [0, 1].map(() =>
    requestJson('/godot/action', {
      method: 'POST',
      body: JSON.stringify(concurrentTalkPayload),
    }),
  ),
);
assert(
  concurrentTalkResults[0].actionRecordId === concurrentTalkResults[1].actionRecordId &&
    concurrentTalkResults[0].eventId === concurrentTalkResults[1].eventId,
  'concurrent same-key requests must converge on one lifecycle',
);
assert(
  concurrentTalkResults.filter((result) => result.idempotentReplay === true).length === 1,
  'one concurrent same-key request must be reported as an idempotent replay',
);
await assertActionRecordReadback(
  concurrentTalkResults[0],
  concurrentTalkPayload,
  'concurrent talk retry',
  'talk',
);
console.log('ok concurrent same-key talk requests converged on one lifecycle');
await assertActorContextReadback(before.worldId, target.actorId, actorId, 'target after talk');
await assertReplayTraceReadback(before.worldId, target.actorId, actorId, 'target after talk');

const giftPayload = {
  ...talkPayload,
  clientActionId: newClientActionId('gift'),
  type: 'gift',
  intent: capabilityFixtures.gift.intent,
  params: asCapabilityParams(capabilityFixtures.gift, 'gift'),
};

const giftAction = await postActionAndAssertReadback(giftPayload, 'gift action');
const profileAfterGift = await getProfile(before.worldId, actorId);
const contextAfterGift = await assertGiftSocialReadback(
  before.worldId,
  target.actorId,
  actorId,
  giftAction,
  'target after gift',
);
const retriedGiftAction = await postActionAndAssertReadback(
  giftPayload,
  'gift action timeout-style retry',
  true,
);
assert(
  retriedGiftAction.actionRecordId === giftAction.actionRecordId &&
    retriedGiftAction.eventId === giftAction.eventId,
  'same gift clientActionId must return the original lifecycle',
);
const profileAfterGiftRetry = await getProfile(before.worldId, actorId);
assert(
  JSON.stringify(profileAfterGiftRetry) === JSON.stringify(profileAfterGift),
  'idempotent gift retry must not apply inventory/profile effects twice',
);
const contextAfterGiftRetry = await assertActorContextReadback(
  before.worldId,
  target.actorId,
  actorId,
  'target after idempotent gift retry',
);
assert(
  contextAfterGiftRetry.recentActions.filter(
    (action) => action?.actionRecordId === giftAction.actionRecordId,
  ).length === 1,
  'idempotent gift retry must expose one action trace',
);
assert(
  contextAfterGiftRetry.memories.filter(
    (memory) => memory?.sourceEventId === giftAction.eventId && memory?.type === 'gift_given',
  ).length ===
    contextAfterGift.memories.filter(
      (memory) => memory?.sourceEventId === giftAction.eventId && memory?.type === 'gift_given',
    ).length,
  'idempotent gift retry must not create another memory',
);
assert(
  JSON.stringify(contextAfterGiftRetry.relationship.actorToViewer) ===
    JSON.stringify(contextAfterGift.relationship.actorToViewer),
  'idempotent gift retry must not apply relationship effects twice',
);
console.log('ok idempotent gift retry preserved inventory, relationship, memory, and trace effects');

const tradePayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('trade'),
  type: 'trade',
  targetActorId: tradeTarget.actorId,
  mapId: before.mapId ?? mapId,
  locationId: tradeTarget.locationId,
  actorTile: tilePayload(tradeTarget.tile),
  interactionRangeTiles: 5,
  intent: trade.intent,
  params: asObject(multiTradeOption.params, 'trade.options[multi].params'),
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

await postActionAndAssertReadback(tradePayload, 'trade action');

const tradeBackGiftPayload = {
  ...tradePayload,
  clientActionId: newClientActionId('trade-replenishment-gift'),
  type: 'gift',
  intent: 'Return traded item after bridge smoke test',
  params: {
    itemId: String(
      asObject(multiTradeOption.params, 'trade.options[multi].params').requestedItemId,
    ),
  },
};

for (let i = 0; i < Number(multiTradeOption.requestedQty ?? 1); i += 1) {
  await postActionAndAssertReadback(
    { ...tradeBackGiftPayload, clientActionId: newClientActionId(`trade-replenishment-${i + 1}`) },
    `trade replenishment gift ${i + 1}`,
  );
}

const sparPayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('spar'),
  type: 'spar',
  targetActorId: sparTarget.actorId,
  mapId: before.mapId ?? mapId,
  locationId: sparTarget.locationId,
  actorTile: tilePayload(sparTarget.tile),
  interactionRangeTiles: 5,
  intent: spar.intent ?? `Spar smoke test with ${sparTarget.name ?? sparTarget.actorId}`,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

await moveSmokeActorToLocation(
  before.worldId,
  pickLocation(locations, sparTarget.locationId),
  'formal move before spar',
);
await postActionAndAssertReadback(sparPayload, 'spar action');

const teachingPayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('request-teaching'),
  type: 'request_teaching',
  targetActorId: teachingTarget.actorId,
  mapId: before.mapId ?? mapId,
  locationId: teachingLocationId ?? teachingTarget.locationId,
  actorTile: tilePayload(teachingTarget.tile),
  interactionRangeTiles: 5,
  intent:
    teaching.intent ??
    `Request teaching smoke test from ${teachingTarget.name ?? teachingTarget.actorId}`,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

await moveSmokeActorToLocation(
  before.worldId,
  pickLocation(locations, teachingLocationId ?? teachingTarget.locationId),
  'formal move before request_teaching',
);
const teachingAction = await postActionAndAssertReadback(
  teachingPayload,
  'request_teaching action',
);
assert(
  teachingAction.result?.resultCode !== 'master_not_qualified',
  'request_teaching capability must not enable an unqualified master',
);
assert(
  teachingAction.result?.resultCode !== 'target_not_present',
  'request_teaching capability must not enable a target outside the current location',
);

const cultivatePayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('cultivate'),
  type: 'cultivate',
  mapId: before.mapId ?? mapId,
  locationId: cultivateLocation.locationId,
  actorTile: firstEntryTile(cultivateLocation),
  intent: `Cultivate smoke test at ${cultivateLocation.name ?? cultivateLocation.locationId}`,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

await postActionAndAssertReadback(cultivatePayload, 'cultivate action');
await assertBreakthroughDisabled(before.worldId, breakthroughLocation);
await primeBreakthroughCandidate(before.worldId, breakthroughLocation);
const breakthrough = await assertBreakthroughEnabled(before.worldId, breakthroughLocation);

const breakthroughPayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('breakthrough'),
  type: 'breakthrough',
  mapId: before.mapId ?? mapId,
  locationId: breakthroughLocation.locationId,
  actorTile: firstEntryTile(breakthroughLocation),
  intent:
    breakthrough.intent ??
    `Breakthrough smoke test at ${breakthroughLocation.name ?? breakthroughLocation.locationId}`,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

const breakthroughAction = await postActionAndAssertReadback(
  breakthroughPayload,
  'breakthrough action',
);
assert(
  breakthroughAction.result?.resultCode !== 'insufficient_cultivation',
  'breakthrough capability must not enable an actor with insufficient cultivation',
);

const arrivePayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('arrive'),
  type: 'arrive',
  mapId: before.mapId ?? mapId,
  locationId: arrivalLocation.locationId,
  actorTile: firstEntryTile(arrivalLocation),
  intent: `Arrive smoke test at ${arrivalLocation.name ?? arrivalLocation.locationId}`,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

await postActionAndAssertReadback(arrivePayload, 'arrive action');

await postLegacyAndAssertReadback(
  '/godot/arrive',
  {
    worldId: before.worldId,
    actorId,
    clientActionId: newClientActionId('legacy-arrive'),
    mapId: before.mapId ?? mapId,
    locationId: arrivalLocation.locationId,
    tile: firstEntryTile(arrivalLocation),
    intent: `Legacy arrive compatibility smoke test at ${arrivalLocation.name ?? arrivalLocation.locationId}`,
    metadata: {
      test: 'godot-taixu-client/tools/check_bridge.mjs',
    },
  },
  'legacy arrive endpoint',
  'arrive',
);

await postLegacyAndAssertReadback(
  '/godot/interact',
  {
    worldId: before.worldId,
    actorId,
    clientActionId: newClientActionId('legacy-interact'),
    mapId: before.mapId ?? mapId,
    targetActorId: target.actorId,
    locationId: target.locationId,
    actorTile: tilePayload(target.tile),
    intent: 'Legacy interact compatibility smoke test',
    metadata: {
      test: 'godot-taixu-client/tools/check_bridge.mjs',
    },
  },
  'legacy interact endpoint',
  'talk',
);

const explorePayload = {
  worldId: before.worldId,
  actorId,
  clientActionId: newClientActionId('explore'),
  type: 'explore',
  mapId: before.mapId ?? mapId,
  locationId: arrivalLocation.locationId,
  actorTile: firstEntryTile(arrivalLocation),
  intent: `Explore smoke test at ${arrivalLocation.name ?? arrivalLocation.locationId}`,
  metadata: {
    test: 'godot-taixu-client/tools/check_bridge.mjs',
  },
};

const profileBeforeRejectedExplore = await getProfile(before.worldId, actorId);
await postActionAndAssertReadback(explorePayload, 'explore action');
const profileAfterRejectedExplore = await getProfile(before.worldId, actorId);
assert(
  durableLocationSnapshot(profileAfterRejectedExplore) ===
    durableLocationSnapshot(profileBeforeRejectedExplore),
  'rejected explore must leave durable actor location/intent unchanged',
);
console.log('ok rejected explore preserved durable profile location/intent');

await postTickAndAssert(before.worldId);
await assertOverlappingTickLease(before.worldId);
bridgeCheckPassed = true;
} finally {
  const cleanupErrors = [];
  if (mapIsolationFixture) {
    try {
      await cleanupMapIsolationFixture();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    await cleanupSmokeFixture();
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Bridge fixture cleanup failed');
}

if (bridgeCheckPassed) console.log('Godot bridge closed-loop check passed.');
