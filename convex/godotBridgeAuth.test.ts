import {
  authenticateGodotBridgeRequest,
  bindGodotBridgeRequest,
  fixedTimeEqual,
  godotBridgeCorsHeaders,
  godotBridgeSecuritySummary,
  isLocalConvexDeployment,
  readGodotBridgeSecurityConfig,
} from './godotBridgeAuth';

const PLAYER_TOKEN = 'player-token-with-at-least-thirty-two-characters';
const DEBUG_TOKEN = 'debug-token-with-at-least-thirty-two-characters';

function configuredEnvironment() {
  return {
    GODOT_BRIDGE_WORLD_ID: 'world-bound-1',
    GODOT_BRIDGE_ACTOR_ID: 'godot_player',
    GODOT_BRIDGE_TOKEN: PLAYER_TOKEN,
    GODOT_BRIDGE_DEBUG_ENABLED: 'true',
    GODOT_BRIDGE_DEBUG_TOKEN: DEBUG_TOKEN,
    GODOT_BRIDGE_ALLOWED_ORIGINS: 'https://game.example, http://127.0.0.1:8080',
  };
}

describe('godotBridgeAuth', () => {
  test('fails closed when credentials or world binding are missing or weak', () => {
    const missing = readGodotBridgeSecurityConfig({});
    expect(missing.configured).toBe(false);
    expect(authenticateGodotBridgeRequest(undefined, 'world:read', missing)).toMatchObject({
      ok: false,
      status: 503,
      errorCode: 'bridge_auth_misconfigured',
    });

    const weak = readGodotBridgeSecurityConfig({
      GODOT_BRIDGE_WORLD_ID: 'world-bound-1',
      GODOT_BRIDGE_TOKEN: 'short',
    });
    expect(weak.configured).toBe(false);
    expect(weak.errors.join(' ')).toContain('at least 32');
  });

  test('binds player credentials to one actor/world and derives human source', () => {
    const config = readGodotBridgeSecurityConfig(configuredEnvironment());
    const authenticated = authenticateGodotBridgeRequest(
      `Bearer ${PLAYER_TOKEN}`,
      'action:write',
      config,
    );
    expect(authenticated.ok).toBe(true);
    if (!authenticated.ok) return;

    expect(bindGodotBridgeRequest(authenticated.principal, {})).toEqual({
      ok: true,
      worldId: 'world-bound-1',
      actorId: 'godot_player',
      source: 'human',
    });
    expect(
      bindGodotBridgeRequest(authenticated.principal, { actorId: 'someone_else' }),
    ).toMatchObject({ ok: false, status: 403, errorCode: 'bridge_actor_forbidden' });
    expect(
      bindGodotBridgeRequest(authenticated.principal, { worldId: 'other-world' }),
    ).toMatchObject({ ok: false, status: 403, errorCode: 'bridge_world_forbidden' });
    expect(bindGodotBridgeRequest(authenticated.principal, { source: 'agent' })).toMatchObject({
      ok: false,
      status: 403,
      errorCode: 'bridge_source_forbidden',
    });
  });

  test('keeps debug tick and smoke actors on a separate explicit credential', () => {
    const config = readGodotBridgeSecurityConfig(configuredEnvironment());
    expect(
      authenticateGodotBridgeRequest(`Bearer ${PLAYER_TOKEN}`, 'tick:debug', config),
    ).toMatchObject({ ok: false, status: 403, errorCode: 'bridge_scope_forbidden' });

    const debug = authenticateGodotBridgeRequest(`Bearer ${DEBUG_TOKEN}`, 'tick:debug', config);
    expect(debug.ok).toBe(true);
    if (!debug.ok) return;
    expect(
      bindGodotBridgeRequest(debug.principal, { actorId: 'godot_smoke_contract' }),
    ).toMatchObject({ ok: true, actorId: 'godot_smoke_contract' });
    expect(bindGodotBridgeRequest(debug.principal, { actorId: 'npc_admin' })).toMatchObject({
      ok: false,
      errorCode: 'bridge_actor_forbidden',
    });
  });

  test('returns indistinguishable 401 responses for missing and invalid bearer credentials', () => {
    const config = readGodotBridgeSecurityConfig(configuredEnvironment());
    expect(authenticateGodotBridgeRequest(undefined, 'world:read', config)).toMatchObject({
      ok: false,
      status: 401,
      errorCode: 'bridge_auth_required',
    });
    expect(
      authenticateGodotBridgeRequest(
        'Bearer definitely-wrong-token-value-000000',
        'world:read',
        config,
      ),
    ).toMatchObject({ ok: false, status: 401, errorCode: 'bridge_auth_invalid' });
    expect(fixedTimeEqual(PLAYER_TOKEN, PLAYER_TOKEN)).toBe(true);
    expect(fixedTimeEqual(PLAYER_TOKEN, DEBUG_TOKEN)).toBe(false);
  });

  test('allows native requests and exact configured origins while denying wildcard or foreign origins', () => {
    const config = readGodotBridgeSecurityConfig(configuredEnvironment());
    expect(godotBridgeCorsHeaders(undefined, config)).toMatchObject({ allowed: true });
    expect(godotBridgeCorsHeaders('https://game.example', config)).toMatchObject({
      allowed: true,
      headers: { 'Access-Control-Allow-Origin': 'https://game.example' },
    });
    expect(godotBridgeCorsHeaders('https://evil.example', config)).toMatchObject({
      allowed: false,
    });

    const wildcard = readGodotBridgeSecurityConfig({
      ...configuredEnvironment(),
      GODOT_BRIDGE_ALLOWED_ORIGINS: '*',
    });
    expect(wildcard.configured).toBe(false);
    expect(wildcard.errors.join(' ')).toContain('Invalid GODOT_BRIDGE_ALLOWED_ORIGINS');
  });

  test('reports only non-secret capability flags and detects local Convex URLs', () => {
    const config = readGodotBridgeSecurityConfig(configuredEnvironment());
    expect(godotBridgeSecuritySummary(config)).toEqual({
      authentication: 'bearer_bound_actor_world',
      configured: true,
      playerCredentialConfigured: true,
      debugTickEnabled: true,
      allowedOriginCount: 2,
      nativeClientAllowed: true,
    });
    expect(JSON.stringify(godotBridgeSecuritySummary(config))).not.toContain(PLAYER_TOKEN);
    expect(isLocalConvexDeployment({ CONVEX_CLOUD_URL: 'http://127.0.0.1:3210' })).toBe(true);
    expect(isLocalConvexDeployment({ CONVEX_SITE_URL: 'https://prod.example' })).toBe(false);
  });
});
