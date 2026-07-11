import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { handleReplicateWebhook } from './music';
import { godotEventPresentation, godotTraceChain } from './godotPresentation';
import {
  authenticateGodotBridgeRequest,
  bindGodotBridgeRequest,
  godotBridgeCorsHeaders,
  godotBridgeSecuritySummary,
  readGodotBridgeSecurityConfig,
  type GodotBridgePrincipal,
  type GodotBridgeScope,
} from './godotBridgeAuth';
import {
  GODOT_BRIDGE_CONTRACT_VERSION,
  GODOT_BRIDGE_HARDENING_VERSIONS,
  contractError,
  parseGodotBridgeFailure,
  readGodotJson,
  validateGodotActionBody,
  validateGodotCapabilitiesBody,
  validateGodotTickBody,
  type GodotActionType,
} from './godotBridgeContract';

const http = httpRouter();

function jsonResponse(request: Request, body: unknown, status = 200) {
  const config = readGodotBridgeSecurityConfig();
  const cors = godotBridgeCorsHeaders(request.headers.get('Origin'), config);
  const versionedBody =
    body && typeof body === 'object' && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), contractVersion: GODOT_BRIDGE_CONTRACT_VERSION }
      : body;
  return new Response(JSON.stringify(versionedBody), {
    status,
    headers: {
      ...cors.headers,
      'Content-Type': 'application/json',
    },
  });
}

function errorResponse(
  request: Request,
  status: number,
  errorCode: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return jsonResponse(
    request,
    { ok: false, error: message, errorCode, details: details ?? undefined },
    status,
  );
}

function corsFailure(request: Request) {
  const config = readGodotBridgeSecurityConfig();
  const cors = godotBridgeCorsHeaders(request.headers.get('Origin'), config);
  return cors.allowed
    ? undefined
    : errorResponse(
        request,
        403,
        'bridge_origin_forbidden',
        'The request origin is not allowed by the Godot bridge.',
      );
}

function optionsResponse(request: Request) {
  const denied = corsFailure(request);
  if (denied) return denied;
  const config = readGodotBridgeSecurityConfig();
  const cors = godotBridgeCorsHeaders(request.headers.get('Origin'), config);
  return new Response(null, { status: 204, headers: cors.headers });
}

type AuthorizedBridgeRequest = {
  ok: true;
  principal: GodotBridgePrincipal;
};

type RejectedBridgeRequest = {
  ok: false;
  response: Response;
};

function authorizeBridgeRequest(
  request: Request,
  scope: GodotBridgeScope,
): AuthorizedBridgeRequest | RejectedBridgeRequest {
  const denied = corsFailure(request);
  if (denied) return { ok: false, response: denied };
  const config = readGodotBridgeSecurityConfig();
  const result = authenticateGodotBridgeRequest(
    request.headers.get('Authorization'),
    scope,
    config,
  );
  if (result.ok === false) {
    return {
      ok: false,
      response: errorResponse(request, result.status, result.errorCode, result.message),
    };
  }
  return { ok: true, principal: result.principal };
}

function bindBridgeRequest(
  request: Request,
  principal: GodotBridgePrincipal,
  requested: { worldId?: string; actorId?: string; source?: unknown },
) {
  const result = bindGodotBridgeRequest(principal, requested);
  if (result.ok === false) {
    return {
      ...result,
      response: errorResponse(request, result.status, result.errorCode, result.message),
    };
  }
  return result;
}

function readWorldId(url: URL): Id<'worlds'> | undefined {
  return readQueryText(url, 'worldId') as Id<'worlds'> | undefined;
}

function readMapId(url: URL): string | undefined {
  return readQueryText(url, 'mapId', 64);
}

function readActionRecordId(url: URL): Id<'actionRecords'> | undefined {
  return readQueryText(url, 'actionRecordId', 64) as Id<'actionRecords'> | undefined;
}

function readRequiredParam(url: URL, key: string): string | undefined {
  return readQueryText(url, key);
}

function readCursor(url: URL, key: string): string | undefined {
  return readQueryText(url, key, 2048);
}

function readNumberParam(
  url: URL,
  key: string,
  options: { integer?: boolean; min?: number; max?: number } = {},
): number | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length === 0) return undefined;
  if (values.length > 1) {
    throw contractError(400, 'duplicate_query_parameter', `${key} may appear only once.`);
  }
  const value = values[0];
  if (value.trim() === '') {
    throw contractError(400, 'invalid_query_number', `${key} cannot be empty.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw contractError(400, 'invalid_query_number', `${key} must be a finite number.`);
  }
  if (options.integer && !Number.isInteger(parsed)) {
    throw contractError(400, 'invalid_query_integer', `${key} must be an integer.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw contractError(400, 'invalid_query_range', `${key} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw contractError(400, 'invalid_query_range', `${key} must be at most ${options.max}.`);
  }
  return parsed;
}

function readQueryText(url: URL, key: string, max = 128) {
  const values = url.searchParams.getAll(key);
  if (values.length === 0) return undefined;
  if (values.length > 1) {
    throw contractError(400, 'duplicate_query_parameter', `${key} may appear only once.`);
  }
  const value = values[0].trim();
  if (!value) throw contractError(400, 'invalid_query_string', `${key} cannot be empty.`);
  if (value.length > max) {
    throw contractError(400, 'query_value_too_long', `${key} exceeds ${max} characters.`);
  }
  return value;
}

function assertQueryKeys(url: URL, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  for (const key of url.searchParams.keys()) {
    if (!allowedSet.has(key)) {
      throw contractError(400, 'unknown_query_parameter', `${key} is not allowed.`);
    }
  }
}

function assertNoQueryParameters(request: Request) {
  assertQueryKeys(new URL(request.url), []);
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}


async function runPreparedGodotAction(
  ctx: ActionCtx,
  body: Record<string, unknown>,
  overrides: {
    type?: GodotActionType;
    intent?: string;
    actorTile?: { x: number; y: number };
    metadata?: Record<string, unknown>;
    legacyEndpoint?: string;
  } = {},
) {
  const metadata = {
    ...objectOrEmpty(body.metadata),
    ...(overrides.metadata ?? {}),
  };
  const prepared = await ctx.runQuery(internal.godot.prepareAction, {
    worldId: typeof body.worldId === 'string' ? (body.worldId as Id<'worlds'>) : undefined,
    actorId: String(body.actorId ?? 'godot_player'),
    type: overrides.type ?? (body.type as GodotActionType),
    targetId: readOptionalString(body.targetId),
    targetActorId: readOptionalString(body.targetActorId),
    mapId: readOptionalString(body.mapId),
    locationId: readOptionalString(body.locationId),
    intent: overrides.intent ?? readOptionalString(body.intent),
    actorTile:
      overrides.actorTile ??
      (body.actorTile as { x: number; y: number } | undefined),
    interactionRangeTiles:
      typeof body.interactionRangeTiles === 'number' ? body.interactionRangeTiles : undefined,
    source: 'human',
    clientActionId: readOptionalString(body.clientActionId),
    riskTolerance: typeof body.riskTolerance === 'number' ? body.riskTolerance : undefined,
    params: body.params,
    metadata,
  });
  const result = await ctx.runAction(internal.xianxia.gm.actInternal, prepared.envelope);
  const presentation = godotEventPresentation({
    actionType: prepared.envelope.type,
    eventType: result.eventType,
    resultCode: result.resultCode,
    status: result.status,
    summary: result.reason,
    effects: result.effects,
  });
  return {
    ok: true,
    legacy: overrides.legacyEndpoint ? true : undefined,
    legacyEndpoint: overrides.legacyEndpoint,
    worldId: prepared.worldId,
    mapId: prepared.mapId,
    prepared: prepared.prepared,
    action: prepared.envelope,
    result,
    summary: result.reason,
    actorIds: [prepared.envelope.actorId],
    targetActorIds: prepared.envelope.targetActorId ? [prepared.envelope.targetActorId] : [],
    locationId: prepared.envelope.locationId,
    resultCode: result.resultCode,
    clientActionId: result.clientActionId,
    idempotentReplay: result.idempotentReplay === true,
    eventType: result.eventType,
    traceChain: godotTraceChain({
      source: 'action',
      actionType: prepared.envelope.type,
      worldEventId: result.eventId,
      actionRecordId: result.actionRecordId,
      resultCode: result.resultCode,
    }),
    ...presentation,
    eventId: result.eventId,
    actionRecordId: result.actionRecordId,
  };
}

function extractTickResultEvents(
  tickResult: unknown,
  mapId: string,
  fallbackCreatedAt: number,
): Record<string, unknown>[] {
  const tick = objectOrEmpty(tickResult);
  const results = Array.isArray(tick.results) ? tick.results : [];
  const events: Record<string, unknown>[] = [];
  const lease = objectOrEmpty(tick.lease);
  if (lease.acquired === false) {
    const resultCode = readOptionalString(lease.reason) ?? 'tick_lease_busy';
    const tickId = readOptionalString(lease.tickId) ?? `tick:${fallbackCreatedAt}:lease`;
    const summary = `世界推进未执行：${resultCode}`;
    const presentation = godotEventPresentation({
      actionType: 'tick',
      eventType: 'tick_lease_observation',
      resultCode,
      status: 'skipped',
      summary,
    });
    events.push({
      id: tickId,
      tickOnly: true,
      type: 'tick_lease_observation',
      actionType: 'tick',
      createdAt: fallbackCreatedAt,
      actorIds: [],
      targetActorIds: [],
      mapId,
      resultCode,
      status: 'skipped',
      traceChain: godotTraceChain({
        source: 'tick',
        actionType: 'tick',
        worldEventId: tickId,
        resultCode,
        tickOnly: true,
      }),
      summary,
      ...presentation,
    });
  }
  for (const rawEntry of results) {
    const entry = objectOrEmpty(rawEntry);
    const result = objectOrEmpty(entry.result);
    const eventId = readOptionalString(result.eventId);
    const proposal = objectOrEmpty(entry.proposal);
    const actorId = readOptionalString(entry.actorId);
    if (!eventId) {
      const skipped = readOptionalString(entry.skipped);
      if (!skipped || !actorId) continue;
      const summary = `${actorId}暂不行动：${skipped}`;
      const presentation = godotEventPresentation({
        actionType: 'tick',
        eventType: 'agent_skipped',
        resultCode: 'agent_skipped',
        status: 'skipped',
        summary,
      });
      events.push({
        id: `tick:${fallbackCreatedAt}:${actorId}`,
        tickOnly: true,
        type: 'agent_skipped',
        actionType: 'tick',
        createdAt: fallbackCreatedAt,
        actorIds: [actorId],
        targetActorIds: [],
        mapId,
        resultCode: 'agent_skipped',
        status: 'skipped',
        skipped,
        traceChain: godotTraceChain({
          source: 'tick',
          actionType: 'tick',
          worldEventId: `tick:${fallbackCreatedAt}:${actorId}`,
          resultCode: 'agent_skipped',
          tickOnly: true,
        }),
        summary,
        ...presentation,
      });
      continue;
    }

    const targetActorId = readOptionalString(proposal.targetActorId);
    const resultCode = readOptionalString(result.resultCode);
    const status = readOptionalString(result.status);
    const summary = readOptionalString(result.reason) ?? readOptionalString(result.summary) ?? '';
    const eventType = readOptionalString(result.eventType) ?? readOptionalString(proposal.type);
    const actionType = readOptionalString(proposal.type);
    const presentation = godotEventPresentation({
      actionType,
      eventType,
      resultCode,
      status,
      summary,
      effects: result.effects,
    });

    events.push({
      id: eventId,
      worldEventId: eventId,
      actionRecordId: readOptionalString(result.actionRecordId),
      type: eventType,
      actionType,
      createdAt: fallbackCreatedAt,
      actorIds: actorId ? [actorId] : [],
      targetActorIds: targetActorId ? [targetActorId] : [],
      locationId: readOptionalString(proposal.locationId),
      mapId,
      resultCode,
      status,
      traceChain: godotTraceChain({
        source: 'tick',
        actionType,
        worldEventId: eventId,
        actionRecordId: readOptionalString(result.actionRecordId),
        resultCode,
      }),
      summary,
      ...presentation,
    });
  }
  return events;
}

function collectTickEvents(
  recentEvents: unknown[],
  resultEvents: Record<string, unknown>[],
  tickStartedAt: number,
) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const rawEvent of recentEvents) {
    const event = objectOrEmpty(rawEvent);
    const id = readOptionalString(event.worldEventId) ?? readOptionalString(event.id);
    const createdAt = typeof event.createdAt === 'number' ? event.createdAt : 0;
    if (!id || createdAt < tickStartedAt) continue;
    byId.set(id, event);
  }
  for (const event of resultEvents) {
    const id = readOptionalString(event.worldEventId) ?? readOptionalString(event.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, event);
  }
  return [...byId.values()].slice(0, 8);
}

function bridgeErrorResponse(request: Request, error: unknown) {
  const failure = parseGodotBridgeFailure(error);
  if (failure) {
    return errorResponse(
      request,
      failure.status,
      failure.errorCode,
      failure.message,
      failure.details,
    );
  }
  console.error('Unexpected Godot bridge error:', error);
  return errorResponse(request, 500, 'bridge_internal_error', 'Unexpected bridge error.');
}

const godotWorldState = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    const url = new URL(request.url);
    assertQueryKeys(url, ['worldId', 'mapId', 'limit', 'residentsCursor', 'eventsCursor']);
    const binding = bindBridgeRequest(request, auth.principal, { worldId: readWorldId(url) });
    if (binding.ok === false) return binding.response;
    const result = await ctx.runAction(internal.godot.worldState, {
      worldId: binding.worldId as Id<'worlds'>,
      mapId: readMapId(url),
      limit: readNumberParam(url, 'limit', { integer: true, min: 1, max: 50 }),
      residentsCursor: readCursor(url, 'residentsCursor'),
      eventsCursor: readCursor(url, 'eventsCursor'),
      viewerActorId: auth.principal.primaryActorId,
      debugView: auth.principal.credentialKind === 'debug',
    });
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotHealth = httpAction(async (_ctx, request) => {
  const denied = corsFailure(request);
  if (denied) return denied;
  try {
    assertNoQueryParameters(request);
    const config = readGodotBridgeSecurityConfig();
    return jsonResponse(request, {
      ok: true,
      service: 'xianxia-godot-convex-bridge',
      hardeningVersions: GODOT_BRIDGE_HARDENING_VERSIONS,
      security: godotBridgeSecuritySummary(config),
      routes: {
        worldState: '/godot/worldState?mapId=qinglan',
        regionState: '/godot/regionState?mapId=qinglan',
        action: 'POST /godot/action',
        actionRecord: 'GET /godot/actionRecord?actionRecordId=...',
        presentationPreview: 'GET /godot/presentationPreview?actionRecordId=...&mode=llm_polish',
        actorContext: 'GET /godot/actorContext?actorId=...',
        replay: 'GET /godot/replay?mapId=qinglan',
        capabilities: 'POST /godot/capabilities',
        tick: 'POST /godot/tick (debug credential only)',
        arrive: 'POST /godot/arrive',
        interact: 'POST /godot/interact',
      },
    });
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotRegionState = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    const url = new URL(request.url);
    assertQueryKeys(url, [
      'worldId',
      'mapId',
      'limit',
      'locationsCursor',
      'residentsCursor',
      'eventsCursor',
    ]);
    const binding = bindBridgeRequest(request, auth.principal, { worldId: readWorldId(url) });
    if (binding.ok === false) return binding.response;
    const result = await ctx.runAction(internal.godot.regionState, {
      worldId: binding.worldId as Id<'worlds'>,
      mapId: readMapId(url),
      limit: readNumberParam(url, 'limit', { integer: true, min: 1, max: 50 }),
      locationsCursor: readCursor(url, 'locationsCursor'),
      residentsCursor: readCursor(url, 'residentsCursor'),
      eventsCursor: readCursor(url, 'eventsCursor'),
      viewerActorId: auth.principal.primaryActorId,
      debugView: auth.principal.credentialKind === 'debug',
    });
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotActionRecord = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    const url = new URL(request.url);
    assertQueryKeys(url, ['worldId', 'actionRecordId']);
    const binding = bindBridgeRequest(request, auth.principal, { worldId: readWorldId(url) });
    if (binding.ok === false) return binding.response;
    const actionRecordId = readActionRecordId(url);
    if (!actionRecordId) {
      return errorResponse(request, 400, 'missing_action_record_id', 'Missing actionRecordId.');
    }
    const result = await ctx.runQuery(internal.godot.actionRecord, {
      worldId: binding.worldId as Id<'worlds'>,
      actionRecordId,
      viewerActorId: auth.principal.primaryActorId,
      debugView: auth.principal.credentialKind === 'debug',
    });
    return jsonResponse(request, result, result.ok ? 200 : 404);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotPresentationPreview = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    const url = new URL(request.url);
    assertQueryKeys(url, ['worldId', 'actionRecordId', 'mode']);
    const binding = bindBridgeRequest(request, auth.principal, { worldId: readWorldId(url) });
    if (binding.ok === false) return binding.response;
    const actionRecordId = readActionRecordId(url);
    if (!actionRecordId) {
      return errorResponse(request, 400, 'missing_action_record_id', 'Missing actionRecordId.');
    }
    const result = await ctx.runQuery(internal.godot.presentationPreview, {
      worldId: binding.worldId as Id<'worlds'>,
      actionRecordId,
      mode: readRequiredParam(url, 'mode'),
      viewerActorId: auth.principal.primaryActorId,
      debugView: auth.principal.credentialKind === 'debug',
    });
    return jsonResponse(request, result, result.ok ? 200 : 404);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotActorContext = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    const url = new URL(request.url);
    assertQueryKeys(url, ['worldId', 'mapId', 'actorId', 'viewerActorId']);
    const actorId = readRequiredParam(url, 'actorId');
    if (!actorId) return errorResponse(request, 400, 'missing_actor_id', 'Missing actorId.');
    const binding = bindBridgeRequest(request, auth.principal, {
      worldId: readWorldId(url),
      actorId: readRequiredParam(url, 'viewerActorId'),
    });
    if (binding.ok === false) return binding.response;
    const result = await ctx.runQuery(internal.godot.actorContext, {
      worldId: binding.worldId as Id<'worlds'>,
      mapId: readMapId(url),
      actorId,
      viewerActorId: binding.actorId,
      debugView: auth.principal.credentialKind === 'debug',
    });
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotReplay = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    const url = new URL(request.url);
    assertQueryKeys(url, ['worldId', 'mapId', 'actorId', 'limit', 'cursor']);
    const binding = bindBridgeRequest(request, auth.principal, { worldId: readWorldId(url) });
    if (binding.ok === false) return binding.response;
    const result = await ctx.runAction(internal.godot.replayTrace, {
      worldId: binding.worldId as Id<'worlds'>,
      mapId: readMapId(url),
      actorId: readRequiredParam(url, 'actorId'),
      limit: readNumberParam(url, 'limit', { integer: true, min: 1, max: 50 }),
      cursor: readCursor(url, 'cursor'),
      viewerActorId: auth.principal.primaryActorId,
      debugView: auth.principal.credentialKind === 'debug',
    });
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotArrive = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'action:write');
  if (auth.ok === false) return auth.response;
  try {
    assertNoQueryParameters(request);
    const rawBody = await readGodotJson(request);
    const binding = bindBridgeRequest(request, auth.principal, {
      worldId: readOptionalString(rawBody.worldId),
      actorId: readOptionalString(rawBody.actorId),
      source: rawBody.source,
    });
    if (binding.ok === false) return binding.response;
    const body = validateGodotActionBody(
      { ...rawBody, actorTile: rawBody.actorTile ?? rawBody.tile },
      { forcedType: 'arrive', extraKeys: ['tile', 'locationName'] },
    );
    const result = await runPreparedGodotAction(
      ctx,
      {
        ...body,
        worldId: binding.worldId,
        actorId: binding.actorId,
        source: binding.source,
        locationId: body.locationId,
      },
      {
        type: 'arrive',
        intent:
          readOptionalString(body.intent) ??
          `抵达${String(body.locationId ?? '当前地点')}`,
        actorTile: body.actorTile as { x: number; y: number },
        metadata: {
          legacyEndpoint: '/godot/arrive',
        },
        legacyEndpoint: '/godot/arrive',
      },
    );
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotInteract = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'action:write');
  if (auth.ok === false) return auth.response;
  try {
    assertNoQueryParameters(request);
    const rawBody = await readGodotJson(request);
    const binding = bindBridgeRequest(request, auth.principal, {
      worldId: readOptionalString(rawBody.worldId),
      actorId: readOptionalString(rawBody.actorId),
      source: rawBody.source,
    });
    if (binding.ok === false) return binding.response;
    const body = validateGodotActionBody(rawBody, { forcedType: 'talk' });
    const result = await runPreparedGodotAction(
      ctx,
      {
        ...body,
        worldId: binding.worldId,
        actorId: binding.actorId,
        source: binding.source,
        targetActorId: body.targetActorId,
        intent: readOptionalString(body.intent) ?? '打个招呼，确认对方是否注意到自己',
      },
      {
        type: 'talk',
        metadata: { legacyEndpoint: '/godot/interact' },
        legacyEndpoint: '/godot/interact',
      },
    );
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotAction = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'action:write');
  if (auth.ok === false) return auth.response;
  try {
    assertNoQueryParameters(request);
    const rawBody = await readGodotJson(request);
    const binding = bindBridgeRequest(request, auth.principal, {
      worldId: readOptionalString(rawBody.worldId),
      actorId: readOptionalString(rawBody.actorId),
      source: rawBody.source,
    });
    if (binding.ok === false) return binding.response;
    const body = validateGodotActionBody(rawBody);
    const result = await runPreparedGodotAction(ctx, {
      ...body,
      worldId: binding.worldId,
      actorId: binding.actorId,
      source: binding.source,
    });
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotCapabilities = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'world:read');
  if (auth.ok === false) return auth.response;
  try {
    assertNoQueryParameters(request);
    const rawBody = await readGodotJson(request);
    const binding = bindBridgeRequest(request, auth.principal, {
      worldId: readOptionalString(rawBody.worldId),
      actorId: readOptionalString(rawBody.actorId),
      source: rawBody.source,
    });
    if (binding.ok === false) return binding.response;
    const body = validateGodotCapabilitiesBody(rawBody);
    const result = await ctx.runQuery(internal.godot.capabilities, {
      worldId: binding.worldId as Id<'worlds'>,
      actorId: binding.actorId,
      mapId: body.mapId,
      actorTile: body.actorTile,
      targetActorId: body.targetActorId,
      locationId: body.locationId,
      interactionRangeTiles: body.interactionRangeTiles,
    });
    return jsonResponse(request, result);
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

const godotTick = httpAction(async (ctx, request) => {
  const auth = authorizeBridgeRequest(request, 'tick:debug');
  if (auth.ok === false) return auth.response;
  try {
    assertNoQueryParameters(request);
    const rawBody = await readGodotJson(request);
    const binding = bindBridgeRequest(request, auth.principal, {
      worldId: readOptionalString(rawBody.worldId),
      actorId: readOptionalString(rawBody.actorId),
      source: rawBody.source,
    });
    if (binding.ok === false) return binding.response;
    const body = validateGodotTickBody(rawBody);
    const worldId = binding.worldId as Id<'worlds'>;
    const mapId = body.mapId ?? 'qinglan';
    const tickStartedAt = Date.now();
    const limit = body.limit ?? 2;
    const result = await ctx.runAction(internal.xianxia.agent.runAgentTickInternal, {
      worldId,
      limit,
      mapId,
      tickId: body.tickId,
      owner: 'godot_debug',
      requestedAt: tickStartedAt,
    });
    const qinglan = result.qinglan;
    const region = await ctx.runAction(internal.godot.regionState, {
      worldId,
      mapId,
      viewerActorId: binding.actorId,
      debugView: true,
    });
    const recentEvents = region.recentEvents.slice(0, 8);
    const tickEvents = collectTickEvents(
      recentEvents,
      extractTickResultEvents(result, mapId, Date.now()),
      tickStartedAt,
    );
    return jsonResponse(request, {
      ok: true,
      worldId,
      mapId,
      limit,
      qinglan,
      tick: result,
      tickEvents,
      recentEvents,
    });
  } catch (error) {
    return bridgeErrorResponse(request, error);
  }
});

http.route({
  path: '/replicate_webhook',
  method: 'POST',
  handler: handleReplicateWebhook,
});

http.route({ path: '/', method: 'GET', handler: godotHealth });
http.route({ path: '/godot', method: 'GET', handler: godotHealth });

for (const path of [
  '/godot/worldState',
  '/godot/regionState',
  '/godot/actionRecord',
  '/godot/presentationPreview',
  '/godot/actorContext',
  '/godot/replay',
  '/godot/action',
  '/godot/capabilities',
  '/godot/tick',
  '/godot/arrive',
  '/godot/interact',
]) {
  http.route({
    path,
    method: 'OPTIONS',
    handler: httpAction(async (_ctx, request) => optionsResponse(request)),
  });
}
http.route({ path: '/godot/worldState', method: 'GET', handler: godotWorldState });
http.route({ path: '/godot/regionState', method: 'GET', handler: godotRegionState });
http.route({ path: '/godot/actionRecord', method: 'GET', handler: godotActionRecord });
http.route({
  path: '/godot/presentationPreview',
  method: 'GET',
  handler: godotPresentationPreview,
});
http.route({ path: '/godot/actorContext', method: 'GET', handler: godotActorContext });
http.route({ path: '/godot/replay', method: 'GET', handler: godotReplay });
http.route({ path: '/godot/action', method: 'POST', handler: godotAction });
http.route({ path: '/godot/capabilities', method: 'POST', handler: godotCapabilities });
http.route({ path: '/godot/tick', method: 'POST', handler: godotTick });
http.route({ path: '/godot/arrive', method: 'POST', handler: godotArrive });
http.route({ path: '/godot/interact', method: 'POST', handler: godotInteract });
export default http;
