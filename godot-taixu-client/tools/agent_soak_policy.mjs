const DEFAULTS = Object.freeze({
  ticks: 3,
  tickLimit: 4,
  delayMs: 1900,
  contextActors: 3,
  requestTimeoutMs: 45_000,
  maxRuntimeMs: 300_000,
  maxResponseBytes: 1_000_000,
  maxTotalResponseBytes: 32_000_000,
});

export function readAgentSoakConfig(env = process.env) {
  const ticks = boundedInt(env.GODOT_SOAK_TICKS, DEFAULTS.ticks, 1, 60);
  const delayMs = boundedInt(env.GODOT_SOAK_DELAY_MS, DEFAULTS.delayMs, 0, 10_000);
  const config = {
    ticks,
    tickLimit: boundedInt(env.GODOT_SOAK_TICK_LIMIT, DEFAULTS.tickLimit, 1, 8),
    delayMs,
    contextActors: boundedInt(
      env.GODOT_SOAK_CONTEXT_ACTORS,
      DEFAULTS.contextActors,
      1,
      12,
    ),
    requestTimeoutMs: boundedInt(
      env.GODOT_SOAK_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
      1_000,
      120_000,
    ),
    maxRuntimeMs: boundedInt(
      env.GODOT_SOAK_MAX_RUNTIME_MS,
      DEFAULTS.maxRuntimeMs,
      10_000,
      3_600_000,
    ),
    maxResponseBytes: boundedInt(
      env.GODOT_SOAK_MAX_RESPONSE_BYTES,
      DEFAULTS.maxResponseBytes,
      16_384,
      8_000_000,
    ),
    maxTotalResponseBytes: boundedInt(
      env.GODOT_SOAK_MAX_TOTAL_RESPONSE_BYTES,
      DEFAULTS.maxTotalResponseBytes,
      65_536,
      256_000_000,
    ),
    requireMemoryDelta: enabled(env.GODOT_SOAK_REQUIRE_MEMORY_DELTA),
    requireRelationshipDelta: enabled(env.GODOT_SOAK_REQUIRE_RELATIONSHIP_DELTA),
  };
  const delayFloorMs = Math.max(0, ticks - 1) * delayMs;
  if (config.maxRuntimeMs <= delayFloorMs) {
    throw new Error(
      `GODOT_SOAK_MAX_RUNTIME_MS (${config.maxRuntimeMs}) must exceed configured delay time (${delayFloorMs}).`,
    );
  }
  if (config.maxTotalResponseBytes < config.maxResponseBytes) {
    throw new Error(
      'GODOT_SOAK_MAX_TOTAL_RESPONSE_BYTES must be at least GODOT_SOAK_MAX_RESPONSE_BYTES.',
    );
  }
  return Object.freeze(config);
}

export class AgentSoakBudget {
  constructor(config, now = () => Date.now()) {
    this.config = config;
    this.now = now;
    this.startedAt = now();
    this.requestCount = 0;
    this.responseBytes = 0;
  }

  assertRuntime(label) {
    const elapsedMs = this.now() - this.startedAt;
    if (elapsedMs > this.config.maxRuntimeMs) {
      throw new Error(
        `${label} exceeded soak wall-clock budget (${elapsedMs}ms > ${this.config.maxRuntimeMs}ms).`,
      );
    }
    return elapsedMs;
  }

  observeResponse(label, bytes) {
    if (!Number.isInteger(bytes) || bytes < 0) {
      throw new Error(`${label} returned an invalid response byte count.`);
    }
    if (bytes > this.config.maxResponseBytes) {
      throw new Error(
        `${label} response exceeded byte budget (${bytes} > ${this.config.maxResponseBytes}).`,
      );
    }
    const nextTotal = this.responseBytes + bytes;
    if (nextTotal > this.config.maxTotalResponseBytes) {
      throw new Error(
        `${label} exceeded cumulative response budget (${nextTotal} > ${this.config.maxTotalResponseBytes}).`,
      );
    }
    this.requestCount += 1;
    this.responseBytes = nextTotal;
  }

  summary() {
    return {
      elapsedMs: this.assertRuntime('agent soak'),
      requestCount: this.requestCount,
      responseBytes: this.responseBytes,
      maxRuntimeMs: this.config.maxRuntimeMs,
      maxResponseBytes: this.config.maxResponseBytes,
      maxTotalResponseBytes: this.config.maxTotalResponseBytes,
    };
  }
}

export function actorContextSnapshot(context) {
  return {
    memoryIds: uniqueStrings((context?.memories ?? []).map((memory) => memory?.id)),
    actionRecordIds: uniqueStrings(
      (context?.recentActions ?? []).map((action) => action?.actionRecordId),
    ),
    worldEventIds: uniqueStrings(
      (context?.recentEvents ?? []).map((event) => event?.worldEventId),
    ),
    viewerToActor: relationshipSnapshot(context?.relationship?.viewerToActor),
    actorToViewer: relationshipSnapshot(context?.relationship?.actorToViewer),
  };
}

export function actorContextDelta(before, after) {
  return {
    addedMemoryIds: addedValues(before?.memoryIds, after?.memoryIds),
    addedActionRecordIds: addedValues(before?.actionRecordIds, after?.actionRecordIds),
    addedWorldEventIds: addedValues(before?.worldEventIds, after?.worldEventIds),
    relationshipDimensionsChanged:
      changedRelationshipDimensions(before?.viewerToActor, after?.viewerToActor) +
      changedRelationshipDimensions(before?.actorToViewer, after?.actorToViewer),
  };
}

export function relationshipEffects(value) {
  const effects = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  if (!Array.isArray(effects.relationships)) return [];
  return effects.relationships
    .filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof entry.targetActorId === 'string' &&
        entry.targetActorId.length > 0 &&
        typeof entry.delta === 'number' &&
        Number.isFinite(entry.delta),
    )
    .map((entry) => ({ targetActorId: entry.targetActorId, delta: entry.delta }));
}

function boundedInt(raw, fallback, min, max) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function enabled(raw) {
  return ['1', 'true', 'yes', 'on'].includes(String(raw ?? '').trim().toLowerCase());
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function addedValues(before = [], after = []) {
  const existing = new Set(before);
  return after.filter((value) => !existing.has(value));
}

function relationshipSnapshot(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    affinity: numericOrZero(source.affinity),
    trust: numericOrZero(source.trust),
    suspicion: numericOrZero(source.suspicion),
    debt: numericOrZero(source.debt),
    fear: numericOrZero(source.fear),
    tags: uniqueStrings(Array.isArray(source.tags) ? source.tags : []).sort(),
  };
}

function changedRelationshipDimensions(before = {}, after = {}) {
  return ['affinity', 'trust', 'suspicion', 'debt', 'fear', 'tags'].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  ).length;
}

function numericOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
