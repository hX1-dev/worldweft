type SemanticActionInput = {
  type: string;
  actorId: string;
  targetId?: string;
  targetActorId?: string;
  locationId?: string;
  intent?: string;
  source: string;
  riskTolerance?: number;
  params?: unknown;
  metadata?: unknown;
};

const AGENT_ACTION_CLIENT_ID_PREFIX = 'agent:turn:v2:';
const AGENT_ACTION_CLIENT_ID_DOMAIN = 'taixu.agent-action-client-id.v2';

/**
 * Builds the bounded idempotency key used when an Agent turn submits an action.
 *
 * Identity-bearing inputs must never be truncated: Pi NPC turn revisions and
 * long actor IDs often differ only near the end. The domain-separated digest
 * binds both complete strings while keeping the database key compact.
 */
export function agentActionClientId(decisionId: string, actorId: string) {
  // Preserve exact historical keys when the old implementation did not
  // truncate either component. This keeps in-flight and previously finalized
  // short-ID actions replayable across the v2 rollout.
  if (decisionId.length <= 96 && actorId.length <= 48) {
    return `agent:${decisionId}:${actorId}`;
  }
  const input = [
    AGENT_ACTION_CLIENT_ID_DOMAIN,
    `${decisionId.length}:${decisionId}`,
    `${actorId.length}:${actorId}`,
  ].join('\u0000');
  return `${AGENT_ACTION_CLIENT_ID_PREFIX}${stableDigest128(input)}`;
}

export function actionIdempotencyFingerprint(input: SemanticActionInput) {
  const metadata = objectOrEmpty(input.metadata);
  return stableJson({
    type: input.type,
    actorId: input.actorId,
    targetId: input.targetId,
    targetActorId: input.targetActorId,
    locationId: input.locationId,
    intent: input.intent,
    source: input.source,
    riskTolerance: input.riskTolerance,
    params: input.params,
    mapId: typeof metadata.mapId === 'string' ? metadata.mapId : undefined,
  });
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalValue(child);
    }
    return result;
  }
  return value;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A deterministic 128-bit non-cryptographic digest for internal identifiers.
 * Four independently seeded/mixed lanes make accidental collisions negligible
 * for bounded internal turn traffic without adding a runtime dependency.
 */
function stableDigest128(value: string) {
  let lane0 = 0x811c9dc5;
  let lane1 = 0x9e3779b9;
  let lane2 = 0x85ebca6b;
  let lane3 = 0xc2b2ae35;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    lane0 = Math.imul(lane0 ^ code, 0x01000193);
    lane1 = Math.imul(lane1 ^ code, 0x85ebca6b);
    lane2 = Math.imul(lane2 ^ code, 0xc2b2ae35);
    lane3 = Math.imul(lane3 ^ code, 0x27d4eb2f);
    lane0 ^= lane0 >>> 13;
    lane1 ^= lane1 >>> 15;
    lane2 ^= lane2 >>> 16;
    lane3 ^= lane3 >>> 17;
  }
  lane0 = avalanche32(lane0 ^ value.length);
  lane1 = avalanche32(lane1 ^ lane0);
  lane2 = avalanche32(lane2 ^ lane1);
  lane3 = avalanche32(lane3 ^ lane2);
  return [lane0, lane1, lane2, lane3]
    .map((lane) => (lane >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

function avalanche32(value: number) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}
