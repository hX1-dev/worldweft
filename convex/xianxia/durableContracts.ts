import { type Infer, v } from 'convex/values';
import type { ActionResult } from './actionSchema';
import { eventVisibility } from './actionSchema';

const schemaVersion = v.optional(v.literal(1));

export const durableEffectsValidator = v.object({
  cultivationXp: v.optional(v.number()),
  mood: v.optional(v.number()),
  health: v.optional(v.number()),
  fatigue: v.optional(v.number()),
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
        sourceResourceNodeId: v.optional(v.string()),
      }),
    ),
  ),
  realmChange: v.optional(
    v.object({ realm: v.string(), realmStage: v.number(), cultivationXp: v.number() }),
  ),
  breakthroughProgress: v.optional(
    v.object({
      realmEnteredAt: v.optional(v.number()),
      recoveryUntil: v.optional(v.number()),
      clearRecovery: v.optional(v.boolean()),
    }),
  ),
  locationChange: v.optional(
    v.object({
      fromMapId: v.optional(v.string()),
      fromLocationId: v.optional(v.string()),
      toMapId: v.string(),
      toLocationId: v.string(),
      toTile: v.optional(v.object({ x: v.number(), y: v.number() })),
      intent: v.optional(v.string()),
    }),
  ),
});

export const durableEventFactsValidator = v.union(
  v.object({
    schemaVersion,
    resultCode: v.string(),
    source: v.optional(v.literal('godot')),
    migration: v.optional(v.string()),
    // C021b0e social outcome events carry their one-shot terminal reason next
    // to the receipt migration id. The outcome receipt remains authoritative;
    // this is only the event's auditable projection.
    reasonCode: v.optional(v.string()),
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
    requestId: v.optional(v.string()),
    requestStatus: v.optional(v.string()),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    requestRevision: v.optional(v.number()),
    actionExecutionId: v.optional(v.string()),
    sourceGameHour: v.optional(v.number()),
    source: v.optional(v.literal('godot')),
    deliveredItemId: v.optional(v.string()),
    deliveredQty: v.optional(v.number()),
    rewardSourceId: v.optional(v.string()),
    rewardCultivationXp: v.optional(v.number()),
    rewardItems: v.optional(v.array(v.object({ itemId: v.string(), qty: v.number() }))),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    kind: v.string(),
  }),
  v.object({
    schemaVersion,
    resultCode: v.union(
      v.literal('world_pressure_started'),
      v.literal('world_pressure_resolved'),
      v.literal('world_pressure_cancelled'),
    ),
    pressureId: v.string(),
    revision: v.number(),
    pressureKind: v.literal('herb_miasma'),
    pressureStatus: v.union(
      v.literal('active'),
      v.literal('resolved'),
      v.literal('cancelled'),
    ),
    severity: v.number(),
    affectedResourceNodeIds: v.array(v.string()),
    effectCodes: v.array(v.literal('resource_refresh_delayed')),
    startsAtGameHour: v.number(),
    endsAtGameHour: v.number(),
    sourceEventId: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('life_calendar_season_changed'),
    calendarVersion: v.literal('taixu.life_calendar.v1'),
    seasonIndex: v.number(),
    year: v.number(),
    fromSeason: v.union(
      v.literal('spring'),
      v.literal('summer'),
      v.literal('autumn'),
      v.literal('winter'),
    ),
    toSeason: v.union(
      v.literal('spring'),
      v.literal('summer'),
      v.literal('autumn'),
      v.literal('winter'),
    ),
    boundaryAt: v.number(),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('seasonal_resource_transition_applied'),
    seasonalResourceVersion: v.literal('taixu.seasonal_resource.v1'),
    seasonalRule: v.literal('valley_dew_herb_winter_dormancy'),
    resourceNodeId: v.string(),
    seasonIndex: v.number(),
    year: v.number(),
    fromSeason: v.union(
      v.literal('spring'),
      v.literal('summer'),
      v.literal('autumn'),
      v.literal('winter'),
    ),
    toSeason: v.union(
      v.literal('spring'),
      v.literal('summer'),
      v.literal('autumn'),
      v.literal('winter'),
    ),
    seasonalState: v.union(v.literal('growing'), v.literal('dormant')),
    boundaryAt: v.number(),
    capacity: v.number(),
    stockBefore: v.number(),
    stockAfter: v.number(),
    replenished: v.number(),
    nextRefreshAt: v.optional(v.number()),
    refreshBlockedUntil: v.optional(v.number()),
    seasonalRefreshBlockedUntil: v.optional(v.number()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('actor_died_of_old_age'),
    deathContractVersion: v.literal('taixu.actor_death.v1'),
    actorId: v.string(),
    realm: v.string(),
    lifespanYears: v.number(),
    lifeBornAt: v.number(),
    deceasedAt: v.number(),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('actor_migrated_into_world'),
    migrationVersion: v.literal('taixu.population_migration.v1'),
    migrationId: v.string(),
    poolId: v.literal('main_world_residents'),
    sourceId: v.literal('qinglan_outer_villages'),
    calendarYear: v.number(),
    sourceSlot: v.number(),
    actorId: v.string(),
    populationBefore: v.number(),
    populationAfter: v.number(),
    mapId: v.literal('world'),
    locationId: v.literal('mountain_gate'),
    initialAgeYears: v.number(),
    inventoryItemCount: v.literal(0),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    resourceNodeId: v.string(),
    itemId: v.string(),
    qty: v.number(),
    stockBefore: v.number(),
    stockAfter: v.number(),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    cultivationMode: v.union(
      v.literal('ambient'),
      v.literal('spirit_stone'),
      v.literal('qi_pill'),
    ),
    itemId: v.optional(v.string()),
    qty: v.optional(v.number()),
    spiritualEnergy: v.number(),
    cultivationXpGain: v.number(),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    itemId: v.string(),
    qty: v.number(),
    elapsedMs: v.number(),
    requiredDwellMs: v.number(),
    recoveryUntil: v.optional(v.number()),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    shopId: v.string(),
    direction: v.union(v.literal('buy'), v.literal('sell')),
    itemId: v.string(),
    qty: v.number(),
    unitPrice: v.number(),
    stockBefore: v.number(),
    stockAfter: v.number(),
    walletBefore: v.number(),
    walletAfter: v.number(),
    remittedSpiritStones: v.number(),
    restockSourceId: v.string(),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('shop_restocked'),
    shopId: v.string(),
    restockSourceId: v.string(),
    periods: v.number(),
    walletAdded: v.number(),
    stockAdded: v.array(v.object({ itemId: v.string(), qty: v.number() })),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    encounterId: v.string(),
    targetActorId: v.string(),
    damage: v.optional(v.number()),
    escaped: v.optional(v.boolean()),
    defeated: v.optional(v.boolean()),
    itemId: v.optional(v.string()),
    qty: v.optional(v.number()),
    lootProtectedUntil: v.optional(v.number()),
    guardActorIds: v.array(v.string()),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    kind: v.literal('gift'),
    actionExecutionId: v.string(),
    targetActorId: v.string(),
    itemId: v.string(),
    qty: v.literal(1),
    sourceGameDay: v.number(),
    distanceTiles: v.number(),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    kind: v.union(v.literal('direct_trade'), v.literal('shop_trade')),
    actionExecutionId: v.string(),
    targetActorId: v.string(),
    offeredItemId: v.string(),
    offeredQty: v.number(),
    requestedItemId: v.optional(v.string()),
    requestedQty: v.optional(v.number()),
    unitPrice: v.number(),
    totalPrice: v.number(),
    sourceGameHour: v.number(),
    sourceGameDay: v.number(),
    distanceTiles: v.number(),
    shopId: v.optional(v.string()),
    direction: v.optional(v.union(v.literal('buy'), v.literal('sell'))),
    itemId: v.optional(v.string()),
    qty: v.optional(v.number()),
    stockBefore: v.optional(v.number()),
    stockAfter: v.optional(v.number()),
    walletBefore: v.optional(v.number()),
    walletAfter: v.optional(v.number()),
    remittedSpiritStones: v.optional(v.number()),
    restockSourceId: v.optional(v.string()),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    kind: v.literal('teaching'),
    actionExecutionId: v.string(),
    targetActorId: v.string(),
    teachingTopic: v.literal('cultivation_fundamentals'),
    sourceGameDay: v.number(),
    distanceTiles: v.number(),
    cultivationXpGain: v.number(),
    source: v.optional(v.literal('godot')),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    turnNumber: v.number(),
    speechAct: v.string(),
    topicId: v.string(),
    addressedActorIds: v.array(v.string()),
    referencedFactIds: v.array(v.string()),
    referencedBeliefIds: v.array(v.string()),
    proposalId: v.optional(v.string()),
    claimId: v.optional(v.string()),
    subjectClaimId: v.optional(v.string()),
    evidenceEventId: v.optional(v.string()),
    evidenceVerdict: v.optional(v.string()),
    terminalStatus: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    groupConversationId: v.string(),
    turnId: v.string(),
    turnNumber: v.number(),
    speechAct: v.string(),
    topicId: v.string(),
    participantActorIds: v.array(v.string()),
    observerActorIds: v.array(v.string()),
    addressedActorIds: v.array(v.string()),
    referencedFactIds: v.array(v.string()),
    referencedBeliefIds: v.array(v.string()),
    claimId: v.optional(v.string()),
    subjectClaimId: v.optional(v.string()),
    evidenceEventId: v.optional(v.string()),
    evidenceVerdict: v.optional(v.string()),
    terminalStatus: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    negotiationId: v.string(),
    conversationId: v.string(),
    proposalId: v.string(),
    revision: v.number(),
    operation: v.string(),
    negotiationStatus: v.string(),
    proposalStatus: v.string(),
    kind: v.literal('herb_trade'),
    sellerActorId: v.string(),
    buyerActorId: v.string(),
    itemId: v.literal('spirit_herb'),
    itemQty: v.number(),
    paymentItemId: v.literal('spirit_stone'),
    paymentQty: v.number(),
    parentProposalId: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    negotiationId: v.string(),
    conversationId: v.string(),
    proposalId: v.string(),
    revision: v.number(),
    operation: v.string(),
    negotiationStatus: v.string(),
    proposalStatus: v.string(),
    kind: v.literal('event_compensation'),
    harmEventId: v.string(),
    encounterId: v.string(),
    payerActorId: v.string(),
    payeeActorId: v.string(),
    harmDamage: v.number(),
    paymentItemId: v.literal('spirit_stone'),
    paymentQty: v.number(),
    parentProposalId: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    negotiationId: v.string(),
    conversationId: v.string(),
    proposalId: v.string(),
    revision: v.number(),
    operation: v.string(),
    negotiationStatus: v.string(),
    proposalStatus: v.string(),
    kind: v.literal('request_deadline'),
    requestId: v.string(),
    issuerActorId: v.string(),
    assigneeActorId: v.string(),
    baseExpiresAtGameHour: v.number(),
    extensionGameHours: v.number(),
    requestExpiresAtAfter: v.optional(v.number()),
    parentProposalId: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    conversationId: v.string(),
    terminalStatus: v.string(),
    reasonCode: v.string(),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    groupConversationId: v.string(),
    terminalStatus: v.string(),
    reasonCode: v.string(),
    participantActorIds: v.array(v.string()),
    observerActorIds: v.array(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.string(),
    operation: v.string(),
    groupConversationId: v.string(),
    proposalId: v.string(),
    proposalStatus: v.string(),
    kind: v.literal('owned_herb_allocation'),
    proposerActorId: v.string(),
    donorActorId: v.string(),
    recipientActorId: v.string(),
    itemId: v.literal('spirit_herb'),
    itemQty: v.literal(1),
    quorum: v.number(),
    voteChoice: v.optional(v.string()),
    approvals: v.optional(v.number()),
    oppositions: v.optional(v.number()),
    abstentions: v.optional(v.number()),
    commitmentId: v.optional(v.string()),
    commitmentStatus: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    decisionBasis: v.optional(v.string()),
    relationshipBand: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    fixtureId: v.string(),
    source: v.literal('restricted_test_fixture'),
    resultCode: v.optional(v.string()),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('portal_arrived'),
    portalId: v.string(),
    sourceMovementCommandId: v.string(),
    fromMapId: v.string(),
    fromLocationId: v.string(),
    toMapId: v.string(),
    toLocationId: v.string(),
    toTile: v.object({ x: v.number(), y: v.number() }),
  }),
  v.object({
    schemaVersion,
    resultCode: v.literal('interaction_inspected'),
    interactionId: v.string(),
    interactionKind: v.string(),
    observationId: v.string(),
    observationRevision: v.number(),
    sourceMovementCommandId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    tile: v.object({ x: v.number(), y: v.number() }),
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
