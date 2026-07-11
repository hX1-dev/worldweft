import { type Infer, v } from 'convex/values';
import type { ActionResult } from './actionSchema';
import { eventVisibility } from './actionSchema';

const schemaVersion = v.optional(v.literal(1));

export const durableEffectsValidator = v.object({
  cultivationXp: v.optional(v.number()),
  mood: v.optional(v.number()),
  health: v.optional(v.number()),
  spirit: v.optional(v.number()),
  reputation: v.optional(v.number()),
  relationships: v.optional(
    v.array(v.object({ targetActorId: v.string(), delta: v.number() })),
  ),
  items: v.optional(
    v.array(
      v.object({
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        itemId: v.string(),
        qty: v.number(),
      }),
    ),
  ),
  realmChange: v.optional(
    v.object({ realm: v.string(), realmStage: v.number(), cultivationXp: v.number() }),
  ),
  locationChange: v.optional(
    v.object({
      fromMapId: v.optional(v.string()),
      fromLocationId: v.optional(v.string()),
      toMapId: v.string(),
      toLocationId: v.string(),
      intent: v.optional(v.string()),
    }),
  ),
});

export const durableEventFactsValidator = v.union(
  v.object({
    schemaVersion,
    resultCode: v.string(),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    fromLocationId: v.optional(v.string()),
    toLocationId: v.string(),
  }),
  v.object({
    schemaVersion,
    fromLocationId: v.string(),
  }),
  v.object({
    schemaVersion,
    purpose: v.string(),
    phase: v.string(),
    gameDay: v.number(),
    lines: v.array(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    requestType: v.string(),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    kind: v.string(),
  }),
  v.object({
    schemaVersion,
    fixtureId: v.string(),
    source: v.literal('restricted_test_fixture'),
  }),
  // Read compatibility for legacy standalone bridge events. No current write
  // path emits this shape; adapters now resolve through actionRecords.
  v.object({
    schemaVersion,
    intent: v.string(),
    mapId: v.string(),
    source: v.literal('godot'),
  }),
  v.object({
    schemaVersion,
    mapId: v.string(),
    tile: v.object({ x: v.number(), y: v.number() }),
    source: v.literal('godot'),
  }),
);

export const durableActionResultValidator = v.object({
  schemaVersion,
  status: v.union(v.literal('applied'), v.literal('rejected'), v.literal('interrupted')),
  resultCode: v.string(),
  reason: v.string(),
  effects: durableEffectsValidator,
  eventType: v.string(),
  visibility: eventVisibility,
  debug: v.optional(v.object({ seed: v.string(), roll: v.number() })),
});

export const durableActionMetadataValidator = v.object({
  schemaVersion,
  client: v.optional(v.literal('godot')),
  mapId: v.optional(v.string()),
  actorTile: v.optional(v.object({ x: v.number(), y: v.number() })),
  interactionRangeTiles: v.optional(v.number()),
  preparedAt: v.optional(v.number()),
  legacyEndpoint: v.optional(v.string()),
  // Read compatibility for action rows produced by the retired arrive adapter.
  // normalizeDurableActionMetadata intentionally does not emit this field.
  legacyTile: v.optional(v.object({ x: v.number(), y: v.number() })),
  test: v.optional(v.string()),
  purpose: v.optional(v.string()),
});

export type DurableEventFacts = Infer<typeof durableEventFactsValidator>;
export type DurableActionMetadata = Infer<typeof durableActionMetadataValidator>;
export type DurableActionResult = Infer<typeof durableActionResultValidator>;

export function versionDurableEventFacts(
  facts: Omit<DurableEventFacts, 'schemaVersion'>,
): DurableEventFacts {
  return { schemaVersion: 1, ...facts } as DurableEventFacts;
}

export function toDurableActionResult(
  result: ActionResult,
  debug?: { seed: string; roll: number },
): DurableActionResult {
  return { schemaVersion: 1, ...result, debug };
}

export function normalizeDurableActionMetadata(value: unknown): DurableActionMetadata {
  const raw = objectOrEmpty(value);
  const metadata: DurableActionMetadata = { schemaVersion: 1 };
  if (raw.client === 'godot') metadata.client = 'godot';
  if (typeof raw.mapId === 'string') metadata.mapId = raw.mapId;
  const actorTile = objectOrEmpty(raw.actorTile);
  if (isFiniteNumber(actorTile.x) && isFiniteNumber(actorTile.y)) {
    metadata.actorTile = { x: actorTile.x, y: actorTile.y };
  }
  if (isFiniteNumber(raw.interactionRangeTiles)) {
    metadata.interactionRangeTiles = raw.interactionRangeTiles;
  }
  if (isFiniteNumber(raw.preparedAt)) metadata.preparedAt = raw.preparedAt;
  if (typeof raw.legacyEndpoint === 'string') metadata.legacyEndpoint = raw.legacyEndpoint;
  if (typeof raw.test === 'string') metadata.test = raw.test;
  if (typeof raw.purpose === 'string') metadata.purpose = raw.purpose;
  return metadata;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
