import type { ActionType } from './actionSchema';
import type { AgentContext, MovementTarget } from './agentLogic';

export const LIFE_OBSERVATION_VERSION = 'taixu.life_observation.v2' as const;

export const LIFE_OBSERVATION_LIMITS = {
  inventory: 32,
  nearbyActors: 24,
  relationships: 48,
  memories: 12,
  beliefs: 16,
  backgroundSummaries: 4,
  obligations: 24,
  targetRefs: 32,
  capabilities: 48,
  worldPressures: 4,
} as const;

type BoundName = keyof typeof LIFE_OBSERVATION_LIMITS;

export type ObservationBound = {
  limit: number;
  included: number;
  total: number;
  truncated: boolean;
};

export type LifeObservationMemorySource = {
  memoryId: string;
  actorId: string;
  sourceEventId: string;
  type: string;
  summary: string;
  source?: 'direct' | 'witness' | 'present' | 'rumor';
  distorted?: boolean;
  lifecycle?: 'active' | 'archived';
  salience: number;
  createdAt: number;
  expiresAt: number;
};

export type LifeObservationSummarySource = {
  summaryId: string;
  actorId: string;
  subjectActorId: string;
  summary: string;
  revision: number;
  updatedAt: number;
};

export type LifeObservationBeliefSource = {
  beliefId: string;
  actorId: string;
  kind: 'claim' | 'belief' | 'rumor';
  sourceActorId: string;
  sourceClaimId: string;
  subjectClaimId?: string;
  subjectActorIds?: string[];
  summary: string;
  confidence: number;
  active: boolean;
  revision?: number;
  validity?: 'active' | 'superseded' | 'invalidated';
  truthStatus?: 'unknown' | 'supported' | 'contradicted';
  evidenceEventId?: string;
  evidenceVerdict?: 'confirm' | 'refute' | 'uncertain';
  updatedAt: number;
};

export type LifeObservationExecutionSource = {
  executionId: string;
  revision: number;
  actionType: string;
  status: 'pending' | 'accepted' | 'acting';
  targetActorId?: string;
  requestId?: string;
  requestRevision?: number;
  locationId?: string;
  expiresAt: number;
};

export type LifeObservationMovementSource = {
  commandId: string;
  revision: number;
  status: 'pending' | 'accepted' | 'moving';
  requestedTarget: MovementTarget;
  resolvedLocationId?: string;
  intent: string;
  expiresAt: number;
  acceptedTile?: { x: number; y: number };
};

export type LifeObservationRelationshipSource = {
  actorId: string;
  affinity: number;
  trust: number;
  suspicion: number;
  debt: number;
  fear: number;
};

export type LifeObservationSource = {
  context: AgentContext;
  semanticTime: {
    gameHour: number;
    gameDay: number;
    phase?: 'dawn' | 'day' | 'dusk' | 'night';
  };
  mapId: string;
  currentTile?: { x: number; y: number };
  memories: LifeObservationMemorySource[];
  summaries: LifeObservationSummarySource[];
  beliefs: LifeObservationBeliefSource[];
  relationships: LifeObservationRelationshipSource[];
  activeExecution?: LifeObservationExecutionSource;
  activeMovement?: LifeObservationMovementSource;
};

export class LifeObservationContractError extends Error {
  constructor(readonly code:
    | 'observation_active_target_overflow'
    | 'observation_invalid_source_owner'
    | 'observation_invalid_summary_fact_reference'
    | 'observation_unsupported_version', message: string) {
    super(message);
    this.name = 'LifeObservationContractError';
  }
}

export type LifeObservationCapability = {
  actionType: ActionType;
  targetConstraint?: 'nearby_actor' | 'server_validated';
  targetActorId?: string;
  requestId?: string;
  requestRevision?: number;
  conversationId?: string;
  groupConversationId?: string;
  proposalId?: string;
  negotiationId?: string;
  expectedRevision?: number;
  locationId?: string;
};

export type LifeObservationV2 = {
  contractVersion: typeof LIFE_OBSERVATION_VERSION;
  actorId: string;
  semanticTime: {
    gameHour: number;
    gameDay: number;
    phase?: 'dawn' | 'day' | 'dusk' | 'night';
  };
  self: {
    identity: {
      name: string;
      role: string;
      realm: string;
      realmStage: number;
      innerTrait?: string;
      outerTrait?: string;
      persona?: string;
    };
    body: {
      health: number;
      maxHealth: number;
      fatigue: number;
      spirit: number;
      mood: number;
      incapacitated: boolean;
    };
    inventory: { itemId: string; qty: number }[];
    duties: Array<{
      kind: 'role' | 'request' | 'execution' | 'commitment' | 'goal';
      dutyId: string;
      status: string;
    }>;
  };
  place: {
    locationId?: string;
    name?: string;
    spiritualEnergy?: number;
    danger: {
      activeEncounterId?: string;
      opponentActorId?: string;
      opponentHealth?: number;
    };
  };
  nearbyActors: AgentContext['others'];
  worldPressures: NonNullable<AgentContext['worldPressures']>;
  purposeFacts?: {
    contractVersion: 'taixu.purpose-bound-life-candidate.v2';
    digest: string;
  };
  relationships: LifeObservationRelationshipSource[];
  memories: Array<{
    memoryId: string;
    sourceEventId: string;
    type: string;
    summary: string;
    source: 'direct' | 'witness' | 'present' | 'rumor';
    distorted: boolean;
    salience: number;
  }>;
  factEventIds: string[];
  backgroundSummaries: Array<{
    summaryId: string;
    subjectActorId: string;
    summary: string;
    revision: number;
    epistemicKind: 'non_fact_summary';
  }>;
  beliefs: Array<{
    beliefId: string;
    kind: 'claim' | 'belief' | 'rumor';
    sourceActorId: string;
    subjectClaimId: string;
    subjectActorIds: string[];
    summary: string;
    confidence: number;
    revision: number;
    validity: 'active';
    truthStatus: 'unknown' | 'supported' | 'contradicted';
    evidenceEventId?: string;
    evidenceVerdict?: 'confirm' | 'refute' | 'uncertain';
  }>;
  obligations: Array<{
    kind: 'execution' | 'movement' | 'request' | 'conversation' | 'group_initiation' | 'group_conversation' | 'negotiation' | 'group_proposal' | 'commitment' | 'personal_goal';
    obligationId: string;
    status: string;
    revision?: number;
    counterpartyActorIds: string[];
    expiresAt?: number;
  }>;
  targetRefs: Array<{
    actorId: string;
    reasons: string[];
    nearby: boolean;
  }>;
  capabilities: LifeObservationCapability[];
  executionScope: {
    mapId: string;
    currentTile?: { x: number; y: number };
    movement?: {
      commandId: string;
      revision: number;
      targetKind: MovementTarget['kind'];
      acceptedTile?: { x: number; y: number };
    };
  };
  bounds: Record<BoundName, ObservationBound>;
  semanticDigest: string;
  observationDigest: string;
  observationRevision: string;
};

// Compatibility name for existing planners while every newly built envelope
// now carries the explicit v2 contract.
export type LifeObservationV1 = LifeObservationV2;

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Observation contains a non-finite number.');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  throw new Error(`Observation contains unsupported value type: ${typeof value}`);
}

// Purpose-v2 construction hashes overlapping immutable projections (intent,
// proposal and candidate set). Keep a small FIFO of exact canonical strings so
// revalidation and long provider=0 soaks avoid repeating the character scan
// without changing any stable64 value or allowing unbounded memory growth.
const STABLE_OBSERVATION_DIGEST_CACHE_LIMIT = 2_048;
const stableObservationDigestCache = new Map<string, string>();

export function stableObservationDigest(value: unknown): string {
  const text = canonicalJson(value);
  const cached = stableObservationDigestCache.get(text);
  if (cached !== undefined) return cached;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
    right = (right ^ (right >>> 13)) >>> 0;
  }
  const digest = `stable64:${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
  if (stableObservationDigestCache.size >= STABLE_OBSERVATION_DIGEST_CACHE_LIMIT) {
    const oldest = stableObservationDigestCache.keys().next();
    if (!oldest.done) stableObservationDigestCache.delete(oldest.value);
  }
  stableObservationDigestCache.set(text, digest);
  return digest;
}

function bounded<T>(items: T[], name: BoundName, bounds: Record<BoundName, ObservationBound>): T[] {
  const limit = LIFE_OBSERVATION_LIMITS[name];
  const result = items.slice(0, limit);
  bounds[name] = {
    limit,
    included: result.length,
    total: items.length,
    truncated: items.length > limit,
  };
  return result;
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))].sort();
}

function capabilityKey(capability: LifeObservationCapability): string {
  return canonicalJson(capability);
}

function buildCapabilities(source: LifeObservationSource): LifeObservationCapability[] {
  const { context } = source;
  if (context.self.health <= 0 || source.activeExecution) return [];
  const capabilities: LifeObservationCapability[] = [];
  const nearbyIds = new Set(context.others.map((actor) => actor.actorId));
  const requestActions = new Set<ActionType>(['accept_request', 'decline_request', 'turn_in_request']);
  for (const actionType of [...context.availableActions].sort()) {
    if (requestActions.has(actionType)) {
      for (const request of context.activeRequests ?? []) {
        if (!request.requestId || !request.issuerActorId || !nearbyIds.has(request.issuerActorId)) continue;
        const matches =
          (request.status === 'offered' && (actionType === 'accept_request' || actionType === 'decline_request')) ||
          (request.status === 'ready_to_turn_in' && actionType === 'turn_in_request');
        if (!matches) continue;
        capabilities.push({
          actionType,
          targetActorId: request.issuerActorId,
          requestId: request.requestId,
          requestRevision: request.revision,
          locationId: context.self.currentLocationId,
        });
      }
      continue;
    }
    if (actionType === 'talk' && context.activeConversation) {
      capabilities.push({
        actionType,
        targetActorId: context.activeConversation.otherActorId,
        conversationId: context.activeConversation.conversationId,
        locationId: context.self.currentLocationId,
      });
      continue;
    }
    if ((actionType === 'group_talk' || actionType === 'group_decide') && context.activeGroupConversation) {
      capabilities.push({
        actionType,
        groupConversationId: context.activeGroupConversation.groupConversationId,
        proposalId: context.activeGroupDecision?.openProposal?.proposalId,
        locationId: context.self.currentLocationId,
      });
      continue;
    }
    if (actionType === 'negotiate' && context.activeNegotiation) {
      const negotiation = context.activeNegotiation;
      capabilities.push({
        actionType,
        targetActorId:
          negotiation.proposerActorId === context.self.actorId
            ? negotiation.recipientActorId
            : negotiation.proposerActorId,
        conversationId: context.activeConversation?.conversationId,
        negotiationId: negotiation.negotiationId,
        proposalId: negotiation.proposalId,
        expectedRevision: negotiation.revision,
        locationId: context.self.currentLocationId,
      });
      continue;
    }
    capabilities.push({
      actionType,
      targetConstraint: ['gift', 'trade', 'request_teaching', 'spar', 'attack', 'steal'].includes(actionType)
        ? 'nearby_actor'
        : 'server_validated',
      locationId: context.self.currentLocationId,
    });
  }
  return [...new Map(capabilities.map((capability) => [capabilityKey(capability), capability])).values()]
    .sort((left, right) => capabilityKey(left).localeCompare(capabilityKey(right)));
}

function semanticProjection(observation: Omit<LifeObservationV1, 'semanticDigest' | 'observationDigest' | 'observationRevision'>) {
  return {
    contractVersion: observation.contractVersion,
    actorId: observation.actorId,
    semanticTime: observation.semanticTime,
    self: {
      identity: {
        role: observation.self.identity.role,
        realm: observation.self.identity.realm,
        realmStage: observation.self.identity.realmStage,
        innerTrait: observation.self.identity.innerTrait,
        outerTrait: observation.self.identity.outerTrait,
        persona: observation.self.identity.persona,
      },
      body: observation.self.body,
      inventory: observation.self.inventory,
      duties: observation.self.duties,
    },
    place: {
      locationId: observation.place.locationId,
      spiritualEnergy: observation.place.spiritualEnergy,
      danger: observation.place.danger,
    },
    nearbyActors: observation.nearbyActors.map(({ name: _name, ...actor }) => actor),
    worldPressures: observation.worldPressures,
    purposeFacts: observation.purposeFacts,
    relationships: observation.relationships,
    memories: observation.memories,
    factEventIds: observation.factEventIds,
    backgroundSummaries: observation.backgroundSummaries,
    beliefs: observation.beliefs,
    obligations: observation.obligations,
    targetRefs: observation.targetRefs,
    capabilities: observation.capabilities,
    bounds: observation.bounds,
  };
}

export function buildLifeObservation(source: LifeObservationSource): LifeObservationV1 {
  const { context } = source;
  const actorId = context.self.actorId;
  for (const owned of [...source.memories, ...source.summaries, ...source.beliefs]) {
    if (owned.actorId !== actorId) {
      throw new LifeObservationContractError(
        'observation_invalid_source_owner',
        `Observation for ${actorId} received private source owned by ${owned.actorId}.`,
      );
    }
  }
  const bounds = {} as Record<BoundName, ObservationBound>;
  const inventory = bounded(
    [...context.self.inventory]
      .filter((item) => item.qty > 0)
      .sort((left, right) => left.itemId.localeCompare(right.itemId)),
    'inventory',
    bounds,
  );
  const nearbyActors = bounded(
    [...new Map(context.others.map((actor) => [actor.actorId, actor])).values()]
      .sort((left, right) => left.actorId.localeCompare(right.actorId)),
    'nearbyActors',
    bounds,
  );
  const nearbyIds = new Set(nearbyActors.map((actor) => actor.actorId));

  const targetReasons = new Map<string, Set<string>>();
  const addTarget = (targetActorId: string | undefined, reason: string) => {
    if (!targetActorId || targetActorId === actorId) return;
    const reasons = targetReasons.get(targetActorId) ?? new Set<string>();
    reasons.add(reason);
    targetReasons.set(targetActorId, reasons);
  };
  addTarget(source.activeExecution?.targetActorId, 'active_execution_target');
  if (source.activeMovement?.requestedTarget.kind === 'actor') {
    addTarget(source.activeMovement.requestedTarget.actorId, 'active_movement_target');
  }
  for (const request of context.activeRequests ?? []) addTarget(request.issuerActorId, 'active_request_issuer');
  addTarget(context.activeConversation?.otherActorId, 'active_conversation_participant');
  for (const participant of context.activeGroupConversation?.participantActorIds ?? []) {
    addTarget(participant, 'active_group_participant');
  }
  for (const observer of context.activeGroupConversation?.observerActorIds ?? []) {
    addTarget(observer, 'active_group_observer');
  }
  addTarget(context.activeNegotiation?.proposerActorId, 'active_negotiation_party');
  addTarget(context.activeNegotiation?.recipientActorId, 'active_negotiation_party');
  const groupProposal = context.activeGroupDecision?.openProposal;
  addTarget(groupProposal?.proposerActorId, 'active_group_proposal_party');
  addTarget(groupProposal?.donorActorId, 'active_group_proposal_party');
  addTarget(groupProposal?.recipientActorId, 'active_group_proposal_party');
  const commitment = context.activeGroupDecision?.pendingCommitment;
  addTarget(commitment?.donorActorId, 'active_commitment_party');
  addTarget(commitment?.recipientActorId, 'active_commitment_party');
  addTarget(context.combat?.opponentActorId, 'active_combat_opponent');
  if (context.personalGoal?.targetRef?.startsWith('actor:')) {
    addTarget(
      context.personalGoal.targetRef.slice('actor:'.length),
      'active_personal_goal_target',
    );
  }
  if (context.personalGoal?.sourceRef.startsWith('actor:')) {
    addTarget(
      context.personalGoal.sourceRef.slice('actor:'.length),
      'active_personal_goal_source',
    );
  }

  const capabilities = buildCapabilities(source);
  for (const capability of capabilities) addTarget(capability.targetActorId, 'bound_capability_target');
  const targetRefs = [...targetReasons.entries()]
    .map(([targetActorId, reasons]) => ({
      actorId: targetActorId,
      reasons: [...reasons].sort(),
      nearby: nearbyIds.has(targetActorId),
    }))
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
  if (targetRefs.length > LIFE_OBSERVATION_LIMITS.targetRefs) {
    throw new LifeObservationContractError(
      'observation_active_target_overflow',
      `Observation has ${targetRefs.length} exact active targets; limit is ${LIFE_OBSERVATION_LIMITS.targetRefs}.`,
    );
  }
  bounds.targetRefs = {
    limit: LIFE_OBSERVATION_LIMITS.targetRefs,
    included: targetRefs.length,
    total: targetRefs.length,
    truncated: false,
  };

  const relationships = bounded(
    [...new Map(source.relationships.map((relationship) => [relationship.actorId, relationship])).values()]
      .filter((relationship) => nearbyIds.has(relationship.actorId) || targetReasons.has(relationship.actorId))
      .sort((left, right) => left.actorId.localeCompare(right.actorId)),
    'relationships',
    bounds,
  );
  const memories = bounded(
    source.memories
      .filter((memory) => memory.lifecycle !== 'archived' && memory.expiresAt > source.semanticTime.gameHour)
      .sort((left, right) => right.createdAt - left.createdAt || left.memoryId.localeCompare(right.memoryId))
      .map((memory) => ({
        memoryId: memory.memoryId,
        sourceEventId: memory.sourceEventId,
        type: memory.type,
        summary: memory.summary,
        source: memory.source ?? 'direct' as const,
        distorted: memory.distorted ?? false,
        salience: memory.salience,
      })),
    'memories',
    bounds,
  );
  const worldPressures = bounded(
    [...(context.worldPressures ?? [])],
    'worldPressures',
    bounds,
  );
  const factEventIds = uniqueSorted([
    ...memories
      .filter((memory) => memory.source !== 'rumor' && !memory.distorted)
      .map((memory) => memory.sourceEventId),
    ...worldPressures.map((pressure) => pressure.sourceEventId),
  ]);
  const backgroundSummaries = bounded(
    [...source.summaries]
      .sort((left, right) => right.updatedAt - left.updatedAt || left.summaryId.localeCompare(right.summaryId))
      .map((summary) => ({
        summaryId: summary.summaryId,
        subjectActorId: summary.subjectActorId,
        summary: summary.summary,
        revision: summary.revision,
        epistemicKind: 'non_fact_summary' as const,
      })),
    'backgroundSummaries',
    bounds,
  );
  const beliefs = bounded(
    source.beliefs
      .filter((belief) => belief.active && (!belief.validity || belief.validity === 'active'))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.beliefId.localeCompare(right.beliefId))
      .map((belief) => ({
        beliefId: belief.beliefId,
        kind: belief.kind,
        sourceActorId: belief.sourceActorId,
        subjectClaimId: belief.subjectClaimId ?? belief.sourceClaimId,
        subjectActorIds: uniqueSorted(belief.subjectActorIds ?? []),
        summary: belief.summary,
        confidence: belief.confidence,
        revision: belief.revision ?? 1,
        validity: 'active' as const,
        truthStatus: belief.truthStatus ?? 'unknown' as const,
        evidenceEventId: belief.evidenceEventId,
        evidenceVerdict: belief.evidenceVerdict,
      })),
    'beliefs',
    bounds,
  );

  const obligations: LifeObservationV1['obligations'] = [];
  if (source.activeExecution) {
    obligations.push({
      kind: 'execution',
      obligationId: source.activeExecution.executionId,
      status: source.activeExecution.status,
      revision: source.activeExecution.revision,
      counterpartyActorIds: uniqueSorted([source.activeExecution.targetActorId]),
      expiresAt: source.activeExecution.expiresAt,
    });
  }
  if (source.activeMovement) {
    obligations.push({
      kind: 'movement',
      obligationId: source.activeMovement.commandId,
      status: source.activeMovement.status,
      revision: source.activeMovement.revision,
      counterpartyActorIds: source.activeMovement.requestedTarget.kind === 'actor'
        ? [source.activeMovement.requestedTarget.actorId]
        : [],
      expiresAt: source.activeMovement.expiresAt,
    });
  }
  for (const request of context.activeRequests ?? []) {
    if (!request.requestId) continue;
    obligations.push({
      kind: 'request',
      obligationId: request.requestId,
      status: request.status ?? 'active',
      revision: request.revision,
      counterpartyActorIds: uniqueSorted([request.issuerActorId]),
    });
  }
  if (context.activeConversation) {
    obligations.push({
      kind: 'conversation',
      obligationId: context.activeConversation.conversationId,
      status: 'active',
      counterpartyActorIds: [context.activeConversation.otherActorId],
      expiresAt: context.activeConversation.expiresAt,
    });
  }
  if (context.activeGroupConversation) {
    obligations.push({
      kind: 'group_conversation',
      obligationId: context.activeGroupConversation.groupConversationId,
      status: context.activeGroupConversation.expired ? 'expired' : 'active',
      counterpartyActorIds: uniqueSorted([
        ...context.activeGroupConversation.participantActorIds,
        ...context.activeGroupConversation.observerActorIds,
      ]).filter((targetActorId) => targetActorId !== actorId),
      expiresAt: context.activeGroupConversation.expiresAt,
    });
  }
  for (const group of context.groupSocialCoordination ?? []) {
    obligations.push({
      kind: 'group_initiation',
      obligationId: group.receipt.initiationId,
      status: group.receipt.status,
      revision: group.receipt.revision,
      counterpartyActorIds: uniqueSorted(group.receipt.participantActorIds)
        .filter((targetActorId) => targetActorId !== actorId),
      expiresAt: group.receipt.expiresAt,
    });
  }
  if (context.activeNegotiation) {
    obligations.push({
      kind: 'negotiation',
      obligationId: context.activeNegotiation.negotiationId,
      status: 'active',
      revision: context.activeNegotiation.revision,
      counterpartyActorIds: uniqueSorted([
        context.activeNegotiation.proposerActorId,
        context.activeNegotiation.recipientActorId,
      ]).filter((targetActorId) => targetActorId !== actorId),
    });
  }
  if (groupProposal) {
    obligations.push({
      kind: 'group_proposal',
      obligationId: groupProposal.proposalId,
      status: groupProposal.hasVoted ? 'voted' : 'open',
      counterpartyActorIds: uniqueSorted([
        groupProposal.proposerActorId,
        groupProposal.donorActorId,
        groupProposal.recipientActorId,
      ]).filter((targetActorId) => targetActorId !== actorId),
    });
  }
  if (commitment) {
    obligations.push({
      kind: 'commitment',
      obligationId: commitment.commitmentId,
      status: 'pending',
      counterpartyActorIds: uniqueSorted([commitment.donorActorId, commitment.recipientActorId])
        .filter((targetActorId) => targetActorId !== actorId),
    });
  }
  if (context.personalGoal) {
    obligations.push({
      kind: 'personal_goal',
      obligationId: context.personalGoal.goalId,
      status: context.personalGoal.status,
      revision: context.personalGoal.revision,
      counterpartyActorIds: uniqueSorted([
        context.personalGoal.targetRef?.startsWith('actor:')
          ? context.personalGoal.targetRef.slice('actor:'.length)
          : undefined,
        context.personalGoal.sourceRef.startsWith('actor:')
          ? context.personalGoal.sourceRef.slice('actor:'.length)
          : undefined,
      ]),
    });
  }
  const boundedObligations = bounded(
    obligations.sort((left, right) => `${left.kind}:${left.obligationId}`.localeCompare(`${right.kind}:${right.obligationId}`)),
    'obligations',
    bounds,
  );
  const boundedCapabilities = bounded(capabilities, 'capabilities', bounds);
  const duties: LifeObservationV1['self']['duties'] = [
    { kind: 'role' as const, dutyId: context.self.role, status: 'standing' },
    ...(context.activeRequests ?? []).flatMap((request) => request.requestId
      ? [{ kind: 'request' as const, dutyId: request.requestId, status: request.status ?? 'active' }]
      : []),
    ...(source.activeExecution
      ? [{ kind: 'execution' as const, dutyId: source.activeExecution.executionId, status: source.activeExecution.status }]
      : []),
    ...(commitment && (commitment.donorActorId === actorId || commitment.recipientActorId === actorId)
      ? [{ kind: 'commitment' as const, dutyId: commitment.commitmentId, status: 'pending' }]
      : []),
    ...(context.personalGoal
      ? [{
          kind: 'goal' as const,
          dutyId: context.personalGoal.goalId,
          status: context.personalGoal.kind,
        }]
      : []),
  ].sort((left, right) => `${left.kind}:${left.dutyId}`.localeCompare(`${right.kind}:${right.dutyId}`));

  const base: Omit<LifeObservationV1, 'semanticDigest' | 'observationDigest' | 'observationRevision'> = {
    contractVersion: LIFE_OBSERVATION_VERSION,
    actorId,
    semanticTime: source.semanticTime,
    self: {
      identity: {
        name: context.self.name,
        role: context.self.role,
        realm: context.self.realm,
        realmStage: context.self.realmStage,
        innerTrait: context.self.innerTrait,
        outerTrait: context.self.outerTrait,
        persona: context.self.persona,
      },
      body: {
        health: context.self.health,
        maxHealth: Math.max(1, context.self.maxHealth ?? 10),
        fatigue: context.self.fatigue ?? 0,
        spirit: context.self.spirit,
        mood: context.self.mood,
        incapacitated: context.self.health <= 0,
      },
      inventory,
      duties,
    },
    place: {
      locationId: context.self.currentLocationId,
      name: context.currentLocationName,
      spiritualEnergy: context.currentLocationSpiritualEnergy,
      danger: {
        activeEncounterId: context.combat?.activeEncounterId,
        opponentActorId: context.combat?.opponentActorId,
        opponentHealth: context.combat?.opponentHealth,
      },
    },
    nearbyActors,
    worldPressures,
    purposeFacts: context.purposeFactsDigest
      ? {
          contractVersion: 'taixu.purpose-bound-life-candidate.v2',
          digest: context.purposeFactsDigest,
        }
      : undefined,
    relationships,
    memories,
    factEventIds,
    backgroundSummaries,
    beliefs,
    obligations: boundedObligations,
    targetRefs,
    capabilities: boundedCapabilities,
    executionScope: {
      mapId: source.mapId,
      currentTile: source.currentTile,
      movement: source.activeMovement
        ? {
            commandId: source.activeMovement.commandId,
            revision: source.activeMovement.revision,
            targetKind: source.activeMovement.requestedTarget.kind,
            acceptedTile: source.activeMovement.acceptedTile,
          }
        : undefined,
    },
    bounds,
  };
  const semanticDigest = stableObservationDigest(semanticProjection(base));
  const observationDigest = stableObservationDigest(base);
  return {
    ...base,
    semanticDigest,
    observationDigest,
    observationRevision: `${LIFE_OBSERVATION_VERSION}:${observationDigest}`,
  };
}
