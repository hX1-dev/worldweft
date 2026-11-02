export const GODOT_BRIDGE_CONTRACT_VERSION = 'godot_bridge_v1';
export const GODOT_MOVEMENT_PROTOCOL_VERSION = 1;
export const GODOT_ACTION_EXECUTION_PROTOCOL_VERSION = 1;
export const GODOT_BRIDGE_MAX_BODY_CHARS = 32_768;
export const GODOT_BRIDGE_HARDENING_VERSIONS = {
  spatialAdjudication: 1,
  viewerProjection: 1,
  tickLease: 1,
  memoryFanoutJob: 1,
  durableSchema: 1,
  movementProtocol: GODOT_MOVEMENT_PROTOCOL_VERSION,
  actionExecutionProtocol: GODOT_ACTION_EXECUTION_PROTOCOL_VERSION,
} as const;

export const GODOT_ACTION_TYPES = [
  'cultivate',
  'gather',
  'rest',
  'talk',
  'group_talk',
  'group_decide',
  'negotiate',
  'trade',
  'gift',
  'request_teaching',
  'accept_request',
  'decline_request',
  'turn_in_request',
  'spar',
  'attack',
  'flee',
  'loot',
  'explore',
  'inspect',
  'steal',
  'breakthrough',
  'use_item',
  'travel',
  'arrive',
] as const;

export type GodotActionType = (typeof GODOT_ACTION_TYPES)[number];
export type JsonObject = Record<string, unknown>;

export const GODOT_MOVEMENT_REPORT_STATUSES = [
  'accepted',
  'moving',
  'arrived',
  'blocked',
  'cancelled',
] as const;

export const GODOT_ACTION_EXECUTION_REPORT_STATUSES = [
  'accepted',
  'acting',
  'completed',
  'interrupted',
  'blocked',
] as const;

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
const TARGET_ACTIONS = new Set([
  'talk',
  'negotiate',
  'trade',
  'gift',
  'request_teaching',
  'accept_request',
  'decline_request',
  'turn_in_request',
  'spar',
  'steal',
  'attack',
  'loot',
]);
const LOCATION_ACTIONS = new Set([
  'arrive',
  'explore',
  'cultivate',
  'gather',
  'rest',
  'inspect',
  'breakthrough',
]);
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

  if (type === 'use_item' && targetActorId) {
    throw contractError(400, 'use_item_self_only', 'use_item does not accept targetActorId.');
  }

  if (TARGET_ACTIONS.has(type)) {
    if (!targetActorId) {
      throw contractError(400, 'missing_target_actor_id', `${type} requires targetActorId.`);
    }
    if (!locationId) throw contractError(400, 'missing_location_id', `${type} requires locationId.`);
    if (!actorTile) throw contractError(400, 'missing_actor_tile', `${type} requires actorTile.`);
  }
  if (type === 'group_talk' || type === 'group_decide') {
    if (!locationId) throw contractError(400, 'missing_location_id', `${type} requires locationId.`);
    if (!actorTile) throw contractError(400, 'missing_actor_tile', `${type} requires actorTile.`);
  }
  if (LOCATION_ACTIONS.has(type)) {
    if (!locationId) throw contractError(400, 'missing_location_id', `${type} requires locationId.`);
    if (!actorTile) throw contractError(400, 'missing_actor_tile', `${type} requires actorTile.`);
  }
  if (
    type === 'travel' &&
    !targetId &&
    !(params && typeof params === 'object' && 'movementTarget' in params)
  ) {
    throw contractError(
      400,
      'missing_movement_target',
      'travel requires targetId or params.movementTarget.',
    );
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

export function validateGodotMovementReportBody(body: JsonObject) {
  assertOnlyKeys(
    body,
    new Set([
      'worldId',
      'commandId',
      'revision',
      'actorId',
      'status',
      'positionTiles',
      'reasonCode',
      'reportedAt',
    ]),
  );
  const revision = requiredNumber(body.revision, 'revision', 1, 1_000_000_000);
  if (!Number.isInteger(revision)) {
    throw contractError(400, 'invalid_integer', 'revision must be an integer.');
  }
  const status = body.status;
  if (
    typeof status !== 'string' ||
    !GODOT_MOVEMENT_REPORT_STATUSES.includes(
      status as (typeof GODOT_MOVEMENT_REPORT_STATUSES)[number],
    )
  ) {
    throw contractError(400, 'invalid_movement_status', 'Movement report status is unsupported.');
  }
  const positionTiles = optionalTile(body.positionTiles, 'positionTiles');
  if (!positionTiles) {
    throw contractError(400, 'missing_position', 'Movement reports require positionTiles.');
  }
  return compact({
    worldId: optionalId(body.worldId, 'worldId'),
    commandId: requiredId(body.commandId, 'commandId', 160),
    revision,
    actorId: requiredId(body.actorId, 'actorId', 160),
    status: status as (typeof GODOT_MOVEMENT_REPORT_STATUSES)[number],
    positionTiles,
    reasonCode: optionalText(body.reasonCode, 'reasonCode', 128),
    reportedAt: requiredNumber(body.reportedAt, 'reportedAt', 0, 9_000_000_000_000_000),
  });
}

export function validateGodotActionExecutionReportBody(body: JsonObject) {
  assertOnlyKeys(
    body,
    new Set([
      'worldId',
      'executionId',
      'revision',
      'actorId',
      'executorId',
      'status',
      'mapId',
      'positionTiles',
      'reasonCode',
      'reportedAt',
    ]),
  );
  const revision = requiredNumber(body.revision, 'revision', 1, 1_000_000_000);
  if (!Number.isInteger(revision)) {
    throw contractError(400, 'invalid_integer', 'revision must be an integer.');
  }
  const status = body.status;
  if (
    typeof status !== 'string' ||
    !GODOT_ACTION_EXECUTION_REPORT_STATUSES.includes(
      status as (typeof GODOT_ACTION_EXECUTION_REPORT_STATUSES)[number],
    )
  ) {
    throw contractError(
      400,
      'invalid_action_execution_status',
      'Action execution report status is unsupported.',
    );
  }
  const positionTiles = optionalTile(body.positionTiles, 'positionTiles');
  if (!positionTiles) {
    throw contractError(
      400,
      'missing_position',
      'Action execution reports require positionTiles.',
    );
  }
  const reasonCode = optionalText(body.reasonCode, 'reasonCode', 64);
  if (reasonCode && !/^[a-z][a-z0-9_]*$/.test(reasonCode)) {
    throw contractError(
      400,
      'invalid_reason_code',
      'reasonCode must use lower_snake_case.',
    );
  }
  return compact({
    worldId: optionalId(body.worldId, 'worldId'),
    executionId: requiredId(body.executionId, 'executionId', 160),
    revision,
    actorId: requiredId(body.actorId, 'actorId', 160),
    executorId: requiredId(body.executorId, 'executorId', 96),
    status: status as (typeof GODOT_ACTION_EXECUTION_REPORT_STATUSES)[number],
    mapId: requiredId(body.mapId, 'mapId', 64),
    positionTiles,
    reasonCode,
    reportedAt: requiredNumber(body.reportedAt, 'reportedAt', 0, 9_000_000_000_000_000),
  });
}

export function validateGodotMovementTarget(value: unknown) {
  const target = requiredObject(value, 'movementTarget');
  const kind = target.kind;
  if (kind === 'location') {
    assertOnlyKeys(target, new Set(['kind', 'locationId']), 'movementTarget');
    return { kind, locationId: requiredId(target.locationId, 'movementTarget.locationId') };
  }
  if (kind === 'zone') {
    assertOnlyKeys(target, new Set(['kind', 'zoneId']), 'movementTarget');
    return { kind, zoneId: requiredId(target.zoneId, 'movementTarget.zoneId') };
  }
  if (kind === 'actor') {
    assertOnlyKeys(
      target,
      new Set(['kind', 'actorId', 'preferredDistanceTiles']),
      'movementTarget',
    );
    return compact({
      kind,
      actorId: requiredId(target.actorId, 'movementTarget.actorId', 160),
      preferredDistanceTiles: optionalInteger(
        target.preferredDistanceTiles,
        'movementTarget.preferredDistanceTiles',
        1,
        2,
      ),
    });
  }
  if (kind === 'interactable') {
    assertOnlyKeys(target, new Set(['kind', 'interactionId']), 'movementTarget');
    return {
      kind,
      interactionId: requiredId(target.interactionId, 'movementTarget.interactionId'),
    };
  }
  if (kind === 'point') {
    assertOnlyKeys(target, new Set(['kind', 'tile']), 'movementTarget');
    const tile = optionalTile(target.tile, 'movementTarget.tile');
    if (!tile || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
      throw contractError(
        400,
        'invalid_point_target',
        'movementTarget.tile must contain integer x and y coordinates.',
      );
    }
    return { kind, tile };
  }
  throw contractError(400, 'invalid_movement_target', 'Movement target kind is unsupported.');
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
    talk: [
      'conversationId',
      'turnId',
      'expectedTurnNumber',
      'speechAct',
      'utteranceText',
      'addressedActorIds',
      'referencedFactIds',
      'referencedBeliefIds',
    ],
    group_talk: [
      'operation',
      'groupConversationId',
      'participantActorIds',
      'observerActorIds',
      'topicId',
      'turnId',
      'expectedTurnNumber',
      'speechAct',
      'utteranceText',
      'addressedActorIds',
      'referencedFactIds',
      'referencedBeliefIds',
    ],
    group_decide: [
      'operation',
      'groupConversationId',
      'recipientActorId',
      'proposalId',
      'choice',
      'commitmentId',
    ],
    negotiate: [
      'operation',
      'conversationId',
      'negotiationId',
      'expectedRevision',
      'turnId',
      'expectedTurnNumber',
      'utteranceText',
      'referencedFactIds',
      'referencedBeliefIds',
      'terms',
    ],
    use_item: ['itemId'],
    gift: ['itemId'],
    request_teaching: ['topic'],
    steal: ['itemId'],
    loot: ['itemId'],
    trade: ['offeredItemId', 'offeredQty', 'requestedItemId', 'requestedQty'],
    travel: ['movementTarget', 'decisionSource'],
    arrive: ['portalId'],
    gather: ['resourceNodeId'],
    inspect: ['interactionId'],
    cultivate: ['cultivationMode'],
    accept_request: ['requestId', 'expectedRevision'],
    decline_request: ['requestId', 'expectedRevision'],
    turn_in_request: ['requestId', 'expectedRevision'],
  };
  const allowed = new Set(keysByType[type] ?? []);
  assertOnlyKeys(params, allowed, 'params');
  if (type === 'talk') {
    const conversationId = optionalId(params.conversationId, 'params.conversationId', 160);
    if (!conversationId) return {};
    const speechAct = optionalText(params.speechAct, 'params.speechAct', 32);
    if (
      speechAct &&
      !['greet', 'ask', 'inform', 'request', 'respond', 'refuse', 'clarify', 'end_topic'].includes(
        speechAct,
      )
    ) {
      throw contractError(400, 'invalid_speech_act', 'params.speechAct is unsupported.');
    }
    return compact({
      conversationId,
      turnId: optionalId(params.turnId, 'params.turnId', 240),
      expectedTurnNumber: optionalInteger(
        params.expectedTurnNumber,
        'params.expectedTurnNumber',
        1,
        12,
      ),
      speechAct,
      utteranceText: optionalText(params.utteranceText, 'params.utteranceText', 600),
      addressedActorIds: optionalIdArray(
        params.addressedActorIds,
        'params.addressedActorIds',
        8,
      ),
      referencedFactIds: optionalIdArray(
        params.referencedFactIds,
        'params.referencedFactIds',
        8,
      ),
      referencedBeliefIds: optionalIdArray(
        params.referencedBeliefIds,
        'params.referencedBeliefIds',
        8,
      ),
    });
  }
  if (type === 'group_talk') {
    const operation = optionalText(params.operation, 'params.operation', 16);
    if (!operation || !['start', 'speak', 'leave'].includes(operation)) {
      throw contractError(400, 'invalid_group_operation', 'params.operation is unsupported.');
    }
    const groupConversationId = operation === 'start'
      ? undefined
      : requiredId(params.groupConversationId, 'params.groupConversationId', 240);
    if (operation === 'start') {
      const participantActorIds = optionalIdArray(
        params.participantActorIds,
        'params.participantActorIds',
        5,
      );
      if (!participantActorIds || participantActorIds.length < 3) {
        throw contractError(400, 'invalid_group_participants', 'group_talk start requires 3..5 participants.');
      }
      return compact({
        operation,
        participantActorIds,
        observerActorIds: optionalIdArray(params.observerActorIds, 'params.observerActorIds', 8) ?? [],
        topicId: optionalId(params.topicId, 'params.topicId', 80),
      });
    }
    if (operation === 'leave') return { operation, groupConversationId };
    const speechAct = optionalText(params.speechAct, 'params.speechAct', 32);
    if (!speechAct || !['greet', 'ask', 'inform', 'request', 'respond', 'refuse', 'clarify', 'end_topic'].includes(speechAct)) {
      throw contractError(400, 'invalid_speech_act', 'params.speechAct is unsupported.');
    }
    const expectedTurnNumber = optionalInteger(params.expectedTurnNumber, 'params.expectedTurnNumber', 2, 15);
    if (expectedTurnNumber === undefined) {
      throw contractError(400, 'missing_group_turn', 'params.expectedTurnNumber is required.');
    }
    return compact({
      operation,
      groupConversationId,
      turnId: requiredId(params.turnId, 'params.turnId', 240),
      expectedTurnNumber,
      speechAct,
      utteranceText: requiredId(params.utteranceText, 'params.utteranceText', 600),
      addressedActorIds: optionalIdArray(params.addressedActorIds, 'params.addressedActorIds', 5) ?? [],
      referencedFactIds: optionalIdArray(params.referencedFactIds, 'params.referencedFactIds', 8) ?? [],
      referencedBeliefIds: optionalIdArray(params.referencedBeliefIds, 'params.referencedBeliefIds', 8) ?? [],
    });
  }
  if (type === 'group_decide') {
    const operation = optionalText(params.operation, 'params.operation', 16);
    if (!operation || !['propose', 'vote', 'execute'].includes(operation)) {
      throw contractError(400, 'invalid_group_decision_operation', 'params.operation is unsupported.');
    }
    const groupConversationId = requiredId(params.groupConversationId, 'params.groupConversationId', 240);
    if (operation === 'propose') {
      return {
        operation,
        groupConversationId,
        recipientActorId: requiredId(params.recipientActorId, 'params.recipientActorId'),
      };
    }
    if (operation === 'vote') {
      const choice = optionalText(params.choice, 'params.choice', 16);
      if (!choice || !['approve', 'oppose', 'abstain'].includes(choice)) {
        throw contractError(400, 'invalid_group_vote', 'params.choice is unsupported.');
      }
      return {
        operation,
        groupConversationId,
        proposalId: requiredId(params.proposalId, 'params.proposalId', 240),
        choice,
      };
    }
    return {
      operation,
      groupConversationId,
      commitmentId: requiredId(params.commitmentId, 'params.commitmentId', 240),
    };
  }
  if (type === 'negotiate') {
    const operation = optionalText(params.operation, 'params.operation', 16);
    if (!operation || !['open', 'counter', 'accept', 'reject', 'withdraw'].includes(operation)) {
      throw contractError(400, 'invalid_negotiation_operation', 'params.operation is unsupported.');
    }
    const conversationId = requiredId(params.conversationId, 'params.conversationId', 160);
    const response = operation !== 'open';
    const negotiationId = response
      ? requiredId(params.negotiationId, 'params.negotiationId', 240)
      : undefined;
    const expectedRevision = response
      ? optionalInteger(params.expectedRevision, 'params.expectedRevision', 1, 6)
      : undefined;
    if (response && expectedRevision === undefined) {
      throw contractError(400, 'missing_negotiation_revision', 'params.expectedRevision is required.');
    }
    const terms = operation === 'open' || operation === 'counter'
      ? validateNegotiationTerms(params.terms)
      : undefined;
    const needsTurn = operation !== 'withdraw';
    const turnId = needsTurn ? requiredId(params.turnId, 'params.turnId', 240) : undefined;
    const expectedTurnNumber = needsTurn
      ? optionalInteger(params.expectedTurnNumber, 'params.expectedTurnNumber', 1, 12)
      : undefined;
    if (needsTurn && expectedTurnNumber === undefined) {
      throw contractError(400, 'missing_conversation_turn', 'params.expectedTurnNumber is required.');
    }
    const utteranceText = needsTurn
      ? optionalText(params.utteranceText, 'params.utteranceText', 600)
      : undefined;
    if (needsTurn && !utteranceText) {
      throw contractError(400, 'missing_negotiation_utterance', 'params.utteranceText is required.');
    }
    return compact({
      operation,
      conversationId,
      negotiationId,
      expectedRevision,
      turnId,
      expectedTurnNumber,
      utteranceText,
      referencedFactIds: optionalIdArray(params.referencedFactIds, 'params.referencedFactIds', 8),
      referencedBeliefIds: optionalIdArray(params.referencedBeliefIds, 'params.referencedBeliefIds', 8),
      terms,
    });
  }
  if (type === 'gift' || type === 'steal' || type === 'loot') {
    return { itemId: requiredId(params.itemId, 'params.itemId') };
  }
  if (type === 'use_item') {
    return { itemId: requiredId(params.itemId, 'params.itemId') };
  }
  if (type === 'request_teaching') {
    const topic = optionalText(params.topic, 'params.topic', 80);
    return topic ? { topic } : {};
  }
  if (type === 'accept_request' || type === 'decline_request' || type === 'turn_in_request') {
    const expectedRevision = optionalInteger(
      params.expectedRevision,
      'params.expectedRevision',
      1,
      Number.MAX_SAFE_INTEGER,
    );
    if (type === 'decline_request' && expectedRevision === undefined) {
      throw contractError(
        400,
        'request_revision_required',
        'params.expectedRevision is required for decline_request.',
      );
    }
    return compact({
      requestId: requiredId(params.requestId, 'params.requestId'),
      expectedRevision,
    });
  }
  if (type === 'gather') {
    return { resourceNodeId: requiredId(params.resourceNodeId, 'params.resourceNodeId') };
  }
  if (type === 'inspect') {
    return { interactionId: requiredId(params.interactionId, 'params.interactionId') };
  }
  if (type === 'cultivate') {
    const cultivationMode = optionalText(
      params.cultivationMode,
      'params.cultivationMode',
      32,
    );
    if (
      cultivationMode &&
      !['ambient', 'spirit_stone', 'qi_pill'].includes(cultivationMode)
    ) {
      throw contractError(
        400,
        'invalid_cultivation_mode',
        'params.cultivationMode is unsupported.',
      );
    }
    return cultivationMode ? { cultivationMode } : {};
  }
  if (type === 'trade') {
    return {
      offeredItemId: requiredId(params.offeredItemId, 'params.offeredItemId'),
      offeredQty: optionalInteger(params.offeredQty, 'params.offeredQty', 1, 99),
      requestedItemId: requiredId(params.requestedItemId, 'params.requestedItemId'),
      requestedQty: optionalInteger(params.requestedQty, 'params.requestedQty', 1, 99),
    };
  }
  if (type === 'travel') {
    const movementTarget =
      params.movementTarget === undefined
        ? undefined
        : validateGodotMovementTarget(params.movementTarget);
    const decisionSource = optionalText(params.decisionSource, 'params.decisionSource', 32);
    if (
      decisionSource &&
      !['llm', 'event', 'utility', 'test'].includes(decisionSource)
    ) {
      throw contractError(
        400,
        'invalid_decision_source',
        'params.decisionSource is unsupported.',
      );
    }
    return compact({ movementTarget, decisionSource });
  }
  if (type === 'arrive') {
    const portalId = optionalId(params.portalId, 'params.portalId');
    return portalId ? { portalId } : {};
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

function validateNegotiationTerms(value: unknown) {
  const terms = requiredObject(value, 'params.terms');
  if (terms.kind === 'request_deadline') return validateRequestDeadlineTerms(terms);
  if (terms.kind === 'event_compensation') return validateEventCompensationTerms(terms);
  return validateHerbTradeTerms(terms);
}

function validateEventCompensationTerms(value: unknown) {
  const terms = requiredObject(value, 'params.terms');
  assertOnlyKeys(
    terms,
    new Set([
      'kind',
      'harmEventId',
      'encounterId',
      'payerActorId',
      'payeeActorId',
      'harmDamage',
      'paymentItemId',
      'paymentQty',
    ]),
    'params.terms',
  );
  if (terms.kind !== 'event_compensation' || terms.paymentItemId !== 'spirit_stone') {
    throw contractError(
      400,
      'invalid_negotiation_terms',
      'Conflict compensation must be settled in spirit stones.',
    );
  }
  const payerActorId = requiredId(terms.payerActorId, 'params.terms.payerActorId');
  const payeeActorId = requiredId(terms.payeeActorId, 'params.terms.payeeActorId');
  if (payerActorId === payeeActorId) {
    throw contractError(400, 'invalid_negotiation_terms', 'Payer and payee must be different actors.');
  }
  const harmDamage = optionalInteger(terms.harmDamage, 'params.terms.harmDamage', 1, 100);
  const paymentQty = optionalInteger(terms.paymentQty, 'params.terms.paymentQty', 1, 24);
  if (harmDamage === undefined || paymentQty === undefined) {
    throw contractError(400, 'invalid_negotiation_terms', 'Harm and compensation quantities are required.');
  }
  return {
    kind: 'event_compensation',
    harmEventId: requiredId(terms.harmEventId, 'params.terms.harmEventId', 240),
    encounterId: requiredId(terms.encounterId, 'params.terms.encounterId', 160),
    payerActorId,
    payeeActorId,
    harmDamage,
    paymentItemId: 'spirit_stone',
    paymentQty,
  };
}

function validateHerbTradeTerms(value: unknown) {
  const terms = requiredObject(value, 'params.terms');
  assertOnlyKeys(
    terms,
    new Set(['kind', 'sellerActorId', 'buyerActorId', 'itemId', 'itemQty', 'paymentItemId', 'paymentQty']),
    'params.terms',
  );
  if (terms.kind !== 'herb_trade' || terms.itemId !== 'spirit_herb' || terms.paymentItemId !== 'spirit_stone') {
    throw contractError(400, 'invalid_negotiation_terms', 'Only spirit-herb trades settled in spirit stones are supported.');
  }
  const itemQty = optionalInteger(terms.itemQty, 'params.terms.itemQty', 1, 20);
  const paymentQty = optionalInteger(terms.paymentQty, 'params.terms.paymentQty', 1, 999);
  if (itemQty === undefined || paymentQty === undefined) {
    throw contractError(400, 'invalid_negotiation_terms', 'Trade quantities are required.');
  }
  const sellerActorId = requiredId(terms.sellerActorId, 'params.terms.sellerActorId');
  const buyerActorId = requiredId(terms.buyerActorId, 'params.terms.buyerActorId');
  if (sellerActorId === buyerActorId) {
    throw contractError(400, 'invalid_negotiation_terms', 'Buyer and seller must be different actors.');
  }
  return {
    kind: 'herb_trade',
    sellerActorId,
    buyerActorId,
    itemId: 'spirit_herb',
    itemQty,
    paymentItemId: 'spirit_stone',
    paymentQty,
  };
}

function validateRequestDeadlineTerms(value: unknown) {
  const terms = requiredObject(value, 'params.terms');
  assertOnlyKeys(
    terms,
    new Set([
      'kind',
      'requestId',
      'issuerActorId',
      'assigneeActorId',
      'baseExpiresAtGameHour',
      'extensionGameHours',
    ]),
    'params.terms',
  );
  const requestId = requiredId(terms.requestId, 'params.terms.requestId', 160);
  const issuerActorId = requiredId(terms.issuerActorId, 'params.terms.issuerActorId');
  const assigneeActorId = requiredId(terms.assigneeActorId, 'params.terms.assigneeActorId');
  if (issuerActorId === assigneeActorId) {
    throw contractError(
      400,
      'invalid_negotiation_terms',
      'Request issuer and assignee must be different actors.',
    );
  }
  const baseExpiresAtGameHour = optionalInteger(
    terms.baseExpiresAtGameHour,
    'params.terms.baseExpiresAtGameHour',
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const extensionGameHours = optionalInteger(
    terms.extensionGameHours,
    'params.terms.extensionGameHours',
    1,
    72,
  );
  if (baseExpiresAtGameHour === undefined || extensionGameHours === undefined) {
    throw contractError(400, 'invalid_negotiation_terms', 'Request deadline and extension are required.');
  }
  return {
    kind: 'request_deadline',
    requestId,
    issuerActorId,
    assigneeActorId,
    baseExpiresAtGameHour,
    extensionGameHours,
  };
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

function optionalIdArray(value: unknown, field: string, maxItems: number) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw contractError(400, 'invalid_array', `${field} must be an array.`);
  }
  if (value.length > maxItems) {
    throw contractError(400, 'array_too_large', `${field} exceeds ${maxItems} items.`);
  }
  return value.map((child, index) => requiredId(child, `${field}[${index}]`, 240));
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
