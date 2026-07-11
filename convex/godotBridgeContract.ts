export const GODOT_BRIDGE_CONTRACT_VERSION = 'godot_bridge_v1';
export const GODOT_BRIDGE_MAX_BODY_CHARS = 32_768;
export const GODOT_BRIDGE_HARDENING_VERSIONS = {
  spatialAdjudication: 1,
  viewerProjection: 1,
  tickLease: 1,
  memoryFanoutJob: 1,
  durableSchema: 1,
} as const;

export const GODOT_ACTION_TYPES = [
  'cultivate',
  'talk',
  'trade',
  'gift',
  'request_teaching',
  'spar',
  'explore',
  'steal',
  'breakthrough',
  'travel',
  'arrive',
] as const;

export type GodotActionType = (typeof GODOT_ACTION_TYPES)[number];
export type JsonObject = Record<string, unknown>;

export class GodotBridgeContractError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly details?: JsonObject;

  constructor(status: number, errorCode: string, message: string, details?: JsonObject) {
    super(`godot_bridge_contract:${status}:${errorCode}: ${message}`);
    this.name = 'GodotBridgeContractError';
    this.status = status;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export type GodotBridgeFailure = {
  status: number;
  errorCode: string;
  message: string;
  details?: JsonObject;
};

const COMMON_ACTION_KEYS = new Set([
  'worldId',
  'actorId',
  'clientActionId',
  'type',
  'targetId',
  'targetActorId',
  'mapId',
  'locationId',
  'intent',
  'actorTile',
  'interactionRangeTiles',
  'source',
  'riskTolerance',
  'params',
  'metadata',
]);
const TARGET_ACTIONS = new Set(['talk', 'trade', 'gift', 'request_teaching', 'spar', 'steal']);
const LOCATION_ACTIONS = new Set(['arrive', 'explore', 'cultivate', 'breakthrough']);
const CLIENT_METADATA_KEYS = new Set(['clientEvent', 'test', 'purpose']);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseGodotJsonText(text: string): JsonObject {
  if (text.length > GODOT_BRIDGE_MAX_BODY_CHARS) {
    throw contractError(413, 'request_too_large', 'JSON request body is too large.');
  }
  if (!text.trim()) throw contractError(400, 'malformed_json', 'JSON request body is required.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw contractError(400, 'malformed_json', 'Request body is not valid JSON.');
  }
  if (!isObject(value)) {
    throw contractError(400, 'invalid_json_body', 'JSON request body must be an object.');
  }
  assertSafeJson(value);
  return value;
}

export async function readGodotJson(request: Request): Promise<JsonObject> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw contractError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  return parseGodotJsonText(await request.text());
}

export function validateGodotActionBody(
  body: JsonObject,
  options: { forcedType?: GodotActionType; extraKeys?: readonly string[] } = {},
) {
  assertOnlyKeys(body, new Set([...COMMON_ACTION_KEYS, ...(options.extraKeys ?? [])]));
  const type = options.forcedType ?? readActionType(body.type);
  const actorId = optionalId(body.actorId, 'actorId');
  const worldId = optionalId(body.worldId, 'worldId');
  const clientActionId = requiredClientActionId(body.clientActionId);
  const targetId = optionalId(body.targetId, 'targetId');
  const targetActorId = optionalId(body.targetActorId, 'targetActorId');
  const mapId = optionalId(body.mapId, 'mapId', 64);
  const locationId = optionalId(body.locationId, 'locationId');
  const intent = optionalText(body.intent, 'intent', 512);
  const actorTile = optionalTile(body.actorTile, 'actorTile');
  const interactionRangeTiles = optionalNumber(
    body.interactionRangeTiles,
    'interactionRangeTiles',
    1,
    12,
  );
  const riskTolerance = optionalNumber(body.riskTolerance, 'riskTolerance', 0, 1);
  const metadata = validateMetadata(body.metadata);
  const params = validateActionParams(type, body.params);

  if (TARGET_ACTIONS.has(type)) {
    if (!targetActorId) {
      throw contractError(400, 'missing_target_actor_id', `${type} requires targetActorId.`);
    }
    if (!locationId) throw contractError(400, 'missing_location_id', `${type} requires locationId.`);
    if (!actorTile) throw contractError(400, 'missing_actor_tile', `${type} requires actorTile.`);
  }
  if (LOCATION_ACTIONS.has(type)) {
    if (!locationId) throw contractError(400, 'missing_location_id', `${type} requires locationId.`);
    if (!actorTile) throw contractError(400, 'missing_actor_tile', `${type} requires actorTile.`);
  }
  if (type === 'travel' && !targetId) {
    throw contractError(400, 'missing_target_id', 'travel requires targetId.');
  }

  return compact({
    worldId,
    actorId,
    clientActionId,
    type,
    targetId,
    targetActorId,
    mapId,
    locationId,
    intent,
    actorTile,
    interactionRangeTiles,
    source: body.source,
    riskTolerance,
    params,
    metadata,
  });
}

export function validateGodotCapabilitiesBody(body: JsonObject) {
  assertOnlyKeys(
    body,
    new Set([
      'worldId',
      'actorId',
      'mapId',
      'actorTile',
      'targetActorId',
      'locationId',
      'interactionRangeTiles',
      'source',
    ]),
  );
  return compact({
    worldId: optionalId(body.worldId, 'worldId'),
    actorId: optionalId(body.actorId, 'actorId'),
    mapId: optionalId(body.mapId, 'mapId', 64),
    actorTile: optionalTile(body.actorTile, 'actorTile'),
    targetActorId: optionalId(body.targetActorId, 'targetActorId'),
    locationId: optionalId(body.locationId, 'locationId'),
    interactionRangeTiles: optionalNumber(
      body.interactionRangeTiles,
      'interactionRangeTiles',
      1,
      12,
    ),
    source: body.source,
  });
}

export function validateGodotTickBody(body: JsonObject) {
  assertOnlyKeys(body, new Set(['worldId', 'actorId', 'mapId', 'limit', 'source', 'tickId']));
  return compact({
    worldId: optionalId(body.worldId, 'worldId'),
    actorId: optionalId(body.actorId, 'actorId'),
    mapId: optionalId(body.mapId, 'mapId', 64),
    limit: optionalInteger(body.limit, 'limit', 1, 8),
    tickId: optionalId(body.tickId, 'tickId', 160),
    source: body.source,
  });
}

export function parseGodotBridgeFailure(error: unknown): GodotBridgeFailure | undefined {
  if (error instanceof GodotBridgeContractError) {
    return {
      status: error.status,
      errorCode: error.errorCode,
      message: cleanContractMessage(error.message),
      details: error.details,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/godot_bridge_contract:(\d+):([a-z0-9_]+): ([^\n]*)/i);
  if (match) {
    return { status: Number(match[1]), errorCode: match[2], message: match[3].trim() };
  }
  if (message.includes('action_idempotency_conflict:')) {
    return {
      status: 409,
      errorCode: 'action_idempotency_conflict',
      message: suffix(message, 'action_idempotency_conflict:'),
    };
  }
  if (message.includes('action_idempotency_incomplete:')) {
    return {
      status: 503,
      errorCode: 'action_idempotency_incomplete',
      message: suffix(message, 'action_idempotency_incomplete:'),
    };
  }
  if (message.includes('ArgumentValidationError')) {
    return {
      status: 400,
      errorCode: 'invalid_request_value',
      message: 'A request value does not match the bridge contract.',
    };
  }
  if (message.includes('Failed to parse cursor')) {
    return {
      status: 400,
      errorCode: 'invalid_pagination_cursor',
      message: 'Pagination cursor is invalid or no longer usable.',
    };
  }
  return undefined;
}

export function contractError(
  status: number,
  errorCode: string,
  message: string,
  details?: JsonObject,
) {
  return new GodotBridgeContractError(status, errorCode, message, details);
}

function readActionType(value: unknown): GodotActionType {
  if (typeof value !== 'string' || !GODOT_ACTION_TYPES.includes(value as GodotActionType)) {
    throw contractError(400, 'unknown_action_type', 'Action type is missing or unsupported.');
  }
  return value as GodotActionType;
}

function validateActionParams(type: GodotActionType, value: unknown) {
  const params = value === undefined ? {} : requiredObject(value, 'params');
  const keysByType: Partial<Record<GodotActionType, readonly string[]>> = {
    gift: ['itemId'],
    steal: ['itemId'],
    trade: ['offeredItemId', 'offeredQty', 'requestedItemId', 'requestedQty'],
  };
  const allowed = new Set(keysByType[type] ?? []);
  assertOnlyKeys(params, allowed, 'params');
  if (type === 'gift' || type === 'steal') {
    return { itemId: requiredId(params.itemId, 'params.itemId') };
  }
  if (type === 'trade') {
    return {
      offeredItemId: requiredId(params.offeredItemId, 'params.offeredItemId'),
      offeredQty: optionalInteger(params.offeredQty, 'params.offeredQty', 1, 99),
      requestedItemId: requiredId(params.requestedItemId, 'params.requestedItemId'),
      requestedQty: optionalInteger(params.requestedQty, 'params.requestedQty', 1, 99),
    };
  }
  return {};
}

function validateMetadata(value: unknown) {
  if (value === undefined) return undefined;
  const metadata = requiredObject(value, 'metadata');
  assertOnlyKeys(metadata, CLIENT_METADATA_KEYS, 'metadata');
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(metadata)) {
    if (!['string', 'number', 'boolean'].includes(typeof child)) {
      throw contractError(400, 'invalid_metadata', `metadata.${key} must be scalar.`);
    }
    if (typeof child === 'string' && child.length > 256) {
      throw contractError(400, 'text_too_long', `metadata.${key} is too long.`);
    }
    if (typeof child === 'number' && !Number.isFinite(child)) {
      throw contractError(400, 'invalid_number', `metadata.${key} must be finite.`);
    }
    result[key] = child;
  }
  return result;
}

function requiredClientActionId(value: unknown) {
  if (value === undefined || value === null || value === '') {
    throw contractError(
      400,
      'missing_client_action_id',
      'Godot semantic actions require clientActionId.',
    );
  }
  const id = requiredId(value, 'clientActionId', 160);
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw contractError(
      400,
      'invalid_client_action_id',
      'clientActionId contains unsupported characters.',
    );
  }
  return id;
}

function optionalTile(value: unknown, field: string) {
  if (value === undefined) return undefined;
  const tile = requiredObject(value, field);
  assertOnlyKeys(tile, new Set(['x', 'y']), field);
  return {
    x: requiredNumber(tile.x, `${field}.x`, -1_000_000, 1_000_000),
    y: requiredNumber(tile.y, `${field}.y`, -1_000_000, 1_000_000),
  };
}

function optionalId(value: unknown, field: string, max = 128) {
  return value === undefined || value === null ? undefined : requiredId(value, field, max);
}

function requiredId(value: unknown, field: string, max = 128) {
  if (typeof value !== 'string' || !value.trim()) {
    throw contractError(400, 'invalid_string', `${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw contractError(400, 'text_too_long', `${field} exceeds ${max} characters.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw contractError(400, 'invalid_string', `${field} must be a string.`);
  }
  if (value.length > max) {
    throw contractError(400, 'text_too_long', `${field} exceeds ${max} characters.`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw contractError(400, 'invalid_number', `${field} must be a finite number from ${min} to ${max}.`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string, min: number, max: number) {
  return value === undefined ? undefined : requiredNumber(value, field, min, max);
}

function optionalInteger(value: unknown, field: string, min: number, max: number) {
  if (value === undefined) return undefined;
  const number = requiredNumber(value, field, min, max);
  if (!Number.isInteger(number)) {
    throw contractError(400, 'invalid_integer', `${field} must be an integer.`);
  }
  return number;
}

function requiredObject(value: unknown, field: string): JsonObject {
  if (!isObject(value)) {
    throw contractError(400, 'invalid_object', `${field} must be an object.`);
  }
  return value;
}

function assertOnlyKeys(value: JsonObject, allowed: Set<string>, field = 'request') {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw contractError(400, 'unknown_field', `${field}.${key} is not allowed.`, { field: key });
    }
  }
}

function assertSafeJson(value: unknown, depth = 0) {
  if (depth > 6) throw contractError(400, 'json_too_deep', 'JSON request nesting is too deep.');
  if (Array.isArray(value)) {
    if (value.length > 64) throw contractError(400, 'array_too_large', 'JSON array is too large.');
    value.forEach((child) => assertSafeJson(child, depth + 1));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw contractError(400, 'unsafe_object_key', `Object key ${key} is not allowed.`);
    }
    assertSafeJson(child, depth + 1);
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compact<T extends JsonObject>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as T;
}

function cleanContractMessage(message: string) {
  return message.replace(/^godot_bridge_contract:\d+:[a-z0-9_]+:\s*/i, '').split('\n', 1)[0];
}

function suffix(message: string, marker: string) {
  return message.split(marker, 2)[1]?.split('\n', 1)[0]?.trim() ?? 'Bridge request failed.';
}
