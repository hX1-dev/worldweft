import type { GodotBridgeEnvironment } from '../godotBridgeAuth';
import { isLocalConvexDeployment } from '../godotBridgeAuth';

type AuthContext = {
  auth: {
    getUserIdentity(): Promise<{ tokenIdentifier: string } | null>;
  };
};

export type LegacyXianxiaAccessDecision =
  | { allowed: true; mode: 'local_debug' | 'admin_identity' }
  | { allowed: false; reason: string };

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

export function legacyXianxiaAccessDecision(
  env: GodotBridgeEnvironment,
  tokenIdentifier?: string,
): LegacyXianxiaAccessDecision {
  if (isLocalConvexDeployment(env) && enabled(env.XIANXIA_LOCAL_DEBUG_WRITES_ENABLED)) {
    return { allowed: true, mode: 'local_debug' };
  }

  const expectedAdmin = env.XIANXIA_ADMIN_TOKEN_IDENTIFIER?.trim();
  if (expectedAdmin && tokenIdentifier === expectedAdmin) {
    return { allowed: true, mode: 'admin_identity' };
  }

  return {
    allowed: false,
    reason:
      'Legacy xianxia write access requires an approved admin identity or explicit local debug mode.',
  };
}

export async function assertLegacyXianxiaWriteAccess(
  ctx: AuthContext,
  operation: string,
  env: GodotBridgeEnvironment = process.env,
) {
  const identity = await ctx.auth.getUserIdentity();
  const decision = legacyXianxiaAccessDecision(env, identity?.tokenIdentifier);
  if (decision.allowed === false) {
    throw new Error(`xianxia_write_forbidden: ${operation}: ${decision.reason}`);
  }
  return decision;
}

export function assertLocalGodotFixtureAccess(
  operation: string,
  env: GodotBridgeEnvironment = process.env,
) {
  if (!isLocalConvexDeployment(env) || !enabled(env.GODOT_BRIDGE_DEBUG_ENABLED)) {
    throw new Error(
      `godot_fixture_forbidden: ${operation} requires local Convex and GODOT_BRIDGE_DEBUG_ENABLED=true.`,
    );
  }
}
