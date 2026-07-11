export const GODOT_BRIDGE_SMOKE_ACTOR_PREFIX = 'godot_smoke_';

export type GodotBridgeScope = 'world:read' | 'action:write' | 'tick:debug';

export type GodotBridgeEnvironment = Record<string, string | undefined>;

type GodotBridgeCredentialKind = 'player' | 'debug';

type GodotBridgeCredential = {
  kind: GodotBridgeCredentialKind;
  token: string;
  worldId: string;
  primaryActorId: string;
  allowSmokeActors: boolean;
  scopes: readonly GodotBridgeScope[];
};

export type GodotBridgeSecurityConfig = {
  configured: boolean;
  debugEnabled: boolean;
  playerConfigured: boolean;
  worldId?: string;
  allowedOrigins: readonly string[];
  credentials: readonly GodotBridgeCredential[];
  errors: readonly string[];
};

export type GodotBridgePrincipal = {
  credentialKind: GodotBridgeCredentialKind;
  worldId: string;
  primaryActorId: string;
  allowSmokeActors: boolean;
  scopes: readonly GodotBridgeScope[];
};

export type GodotBridgeAuthFailure = {
  ok: false;
  status: 401 | 403 | 503;
  errorCode: string;
  message: string;
};

export type GodotBridgeAuthResult =
  | { ok: true; principal: GodotBridgePrincipal }
  | GodotBridgeAuthFailure;

export type GodotBridgeBindingResult =
  | {
      ok: true;
      worldId: string;
      actorId: string;
      source: 'human';
    }
  | GodotBridgeAuthFailure;

const MIN_TOKEN_LENGTH = 32;
const READ_ACTION_SCOPES = ['world:read', 'action:write'] as const;
const DEBUG_SCOPES = ['world:read', 'action:write', 'tick:debug'] as const;

function readTrimmed(env: GodotBridgeEnvironment, key: string) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function parseEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

function normalizedOrigin(value: string) {
  if (value === '*') return undefined;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return undefined;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
    if (parsed.pathname !== '/' && parsed.pathname !== '') return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function parseAllowedOrigins(raw: string | undefined, errors: string[]) {
  if (!raw?.trim()) return [];
  const origins = new Set<string>();
  for (const entry of raw.split(',')) {
    const candidate = entry.trim();
    if (!candidate) continue;
    const origin = normalizedOrigin(candidate);
    if (!origin) {
      errors.push(`Invalid GODOT_BRIDGE_ALLOWED_ORIGINS entry: ${candidate}`);
      continue;
    }
    origins.add(origin);
  }
  return [...origins];
}

function validateToken(name: string, token: string | undefined, errors: string[]) {
  if (!token) return false;
  if (token.length < MIN_TOKEN_LENGTH || /\s/.test(token)) {
    errors.push(`${name} must contain at least ${MIN_TOKEN_LENGTH} non-whitespace characters.`);
    return false;
  }
  return true;
}

export function readGodotBridgeSecurityConfig(
  env: GodotBridgeEnvironment = process.env,
): GodotBridgeSecurityConfig {
  const errors: string[] = [];
  const worldId = readTrimmed(env, 'GODOT_BRIDGE_WORLD_ID');
  const primaryActorId = readTrimmed(env, 'GODOT_BRIDGE_ACTOR_ID') ?? 'godot_player';
  const playerToken = readTrimmed(env, 'GODOT_BRIDGE_TOKEN');
  const debugToken = readTrimmed(env, 'GODOT_BRIDGE_DEBUG_TOKEN');
  const debugEnabled = parseEnabled(env.GODOT_BRIDGE_DEBUG_ENABLED);
  const allowedOrigins = parseAllowedOrigins(env.GODOT_BRIDGE_ALLOWED_ORIGINS, errors);
  const credentials: GodotBridgeCredential[] = [];

  if (!worldId) errors.push('GODOT_BRIDGE_WORLD_ID is required.');
  if (!playerToken && !(debugEnabled && debugToken)) {
    errors.push('At least one Godot bridge credential is required.');
  }

  if (validateToken('GODOT_BRIDGE_TOKEN', playerToken, errors) && worldId) {
    credentials.push({
      kind: 'player',
      token: playerToken!,
      worldId,
      primaryActorId,
      allowSmokeActors: false,
      scopes: READ_ACTION_SCOPES,
    });
  }

  if (debugEnabled) {
    if (!debugToken) {
      errors.push('GODOT_BRIDGE_DEBUG_TOKEN is required when debug access is enabled.');
    } else if (validateToken('GODOT_BRIDGE_DEBUG_TOKEN', debugToken, errors) && worldId) {
      if (playerToken && fixedTimeEqual(debugToken, playerToken)) {
        errors.push('Player and debug bridge tokens must be different.');
      } else {
        credentials.push({
          kind: 'debug',
          token: debugToken,
          worldId,
          primaryActorId,
          allowSmokeActors: true,
          scopes: DEBUG_SCOPES,
        });
      }
    }
  }

  return {
    configured: errors.length === 0 && credentials.length > 0,
    debugEnabled,
    playerConfigured: credentials.some((credential) => credential.kind === 'player'),
    worldId,
    allowedOrigins,
    credentials,
    errors,
  };
}

function bearerToken(authorization: string | null | undefined) {
  const match = authorization?.match(/^Bearer[ \t]+([^\s]+)$/i);
  return match?.[1];
}

export function fixedTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length, 1);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function authenticateGodotBridgeRequest(
  authorization: string | null | undefined,
  requiredScope: GodotBridgeScope,
  config: GodotBridgeSecurityConfig,
): GodotBridgeAuthResult {
  if (!config.configured) {
    return {
      ok: false,
      status: 503,
      errorCode: 'bridge_auth_misconfigured',
      message: 'Godot bridge authentication is not configured.',
    };
  }

  const token = bearerToken(authorization);
  if (!token) {
    return {
      ok: false,
      status: 401,
      errorCode: 'bridge_auth_required',
      message: 'A valid Godot bridge bearer credential is required.',
    };
  }

  const credential = config.credentials.find((candidate) => fixedTimeEqual(candidate.token, token));
  if (!credential) {
    return {
      ok: false,
      status: 401,
      errorCode: 'bridge_auth_invalid',
      message: 'A valid Godot bridge bearer credential is required.',
    };
  }
  if (!credential.scopes.includes(requiredScope)) {
    return {
      ok: false,
      status: 403,
      errorCode: 'bridge_scope_forbidden',
      message: `The bridge credential does not grant ${requiredScope}.`,
    };
  }

  return {
    ok: true,
    principal: {
      credentialKind: credential.kind,
      worldId: credential.worldId,
      primaryActorId: credential.primaryActorId,
      allowSmokeActors: credential.allowSmokeActors,
      scopes: credential.scopes,
    },
  };
}

function actorAllowed(principal: GodotBridgePrincipal, actorId: string) {
  return (
    actorId === principal.primaryActorId ||
    (principal.allowSmokeActors && actorId.startsWith(GODOT_BRIDGE_SMOKE_ACTOR_PREFIX))
  );
}

export function bindGodotBridgeRequest(
  principal: GodotBridgePrincipal,
  requested: {
    worldId?: string;
    actorId?: string;
    source?: unknown;
  },
): GodotBridgeBindingResult {
  if (requested.worldId && requested.worldId !== principal.worldId) {
    return {
      ok: false,
      status: 403,
      errorCode: 'bridge_world_forbidden',
      message: 'The bridge credential is not valid for the requested world.',
    };
  }

  const actorId = requested.actorId ?? principal.primaryActorId;
  if (!actorAllowed(principal, actorId)) {
    return {
      ok: false,
      status: 403,
      errorCode: 'bridge_actor_forbidden',
      message: 'The bridge credential is not valid for the requested actor.',
    };
  }
  if (requested.source !== undefined && requested.source !== 'human') {
    return {
      ok: false,
      status: 403,
      errorCode: 'bridge_source_forbidden',
      message: 'Player bridge requests cannot choose an action source.',
    };
  }

  return {
    ok: true,
    worldId: principal.worldId,
    actorId,
    source: 'human',
  };
}

export function godotBridgeCorsHeaders(
  origin: string | null | undefined,
  config: GodotBridgeSecurityConfig,
) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
  if (!origin) return { allowed: true, headers };
  const normalized = normalizedOrigin(origin);
  if (!normalized || !config.allowedOrigins.includes(normalized)) {
    return { allowed: false, headers };
  }
  headers['Access-Control-Allow-Origin'] = normalized;
  return { allowed: true, headers };
}

export function godotBridgeSecuritySummary(config: GodotBridgeSecurityConfig) {
  return {
    authentication: 'bearer_bound_actor_world',
    configured: config.configured,
    playerCredentialConfigured: config.playerConfigured,
    debugTickEnabled:
      config.configured &&
      config.credentials.some((credential) => credential.scopes.includes('tick:debug')),
    allowedOriginCount: config.allowedOrigins.length,
    nativeClientAllowed: true,
  } as const;
}

export function isLocalConvexDeployment(env: GodotBridgeEnvironment = process.env) {
  const candidates = [env.CONVEX_CLOUD_URL, env.CONVEX_SITE_URL].filter((value): value is string =>
    Boolean(value),
  );
  return candidates.some((value) => {
    try {
      const hostname = new URL(value).hostname;
      return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    } catch {
      return false;
    }
  });
}
