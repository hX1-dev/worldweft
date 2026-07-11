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
