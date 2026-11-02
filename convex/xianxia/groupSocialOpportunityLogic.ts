import { stableObservationDigest } from './lifeObservation';
import {
  SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  SOCIAL_WARRANT_VERSION,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';

export type GroupSocialSourceKind =
  | 'shared_request'
  | 'shared_event'
  | 'resource_dispute'
  | 'duty_meeting';

export type GroupSocialParticipantRole =
  | 'decision_owner'
  | 'affected_party'
  | 'witness'
  | 'expert'
  | 'mediator';

export type GroupSocialActorFact = {
  actorId: string;
  role: string;
  mapId: string;
  locationId?: string;
  aliveAndCapable: boolean;
  busy: boolean;
  inventory?: Array<{ itemId: string; qty: number }>;
  neededItemIds?: string[];
};

export type GroupSocialRequestFact = {
  requestId: string;
  revision: number;
  status: 'accepted' | 'ready_to_turn_in';
  type: 'collect_item' | 'explore_location';
  issuerActorId: string;
  assigneeActorId: string;
  itemId?: string;
  locationId?: string;
};

export type GroupSocialEventFact = {
  eventId: string;
  eventType: string;
  createdAt: number;
  visibility: 'public' | 'local' | 'private' | 'witnessed' | 'rumor';
  actorIds: string[];
  targetActorIds: string[];
  witnessActorIds: string[];
  mapId: string;
  locationId?: string;
};

export type GroupSocialResourceFact = {
  resourceNodeId: string;
  itemId: string;
  revision: string;
  available: number;
};

export type GroupSocialOpportunity = {
  sourceKind: GroupSocialSourceKind;
  warrant: SocialWarrant;
  candidate: SocialOpportunityCandidate;
  participantRoles: Array<{ actorId: string; role: GroupSocialParticipantRole }>;
  observerActorIds: string[];
};

export type GroupSocialOpportunityInput = {
  now: number;
  nowGameHour: number;
  actorId: string;
  mapId: string;
  locationId?: string;
  location?: {
    allowedActions: string[];
    dangerLevel: number;
    capacity: number;
    occupiedCapacity: number;
  };
  actors: GroupSocialActorFact[];
  requests: GroupSocialRequestFact[];
  events: GroupSocialEventFact[];
  resources: GroupSocialResourceFact[];
  activeSourceRevisions?: string[];
};

const DECISION_OWNER_ROLES = new Set(['elder', 'steward', 'guard', 'merchant']);
const REQUEST_EXPERT_ROLES: Record<GroupSocialRequestFact['type'], ReadonlySet<string>> = {
  collect_item: new Set(['merchant', 'steward', 'elder']),
  explore_location: new Set(['guard', 'steward', 'elder']),
};
const GROUP_WARRANT_TTL_GAME_HOURS = 1;

export function deriveGroupSocialOpportunities(
  input: GroupSocialOpportunityInput,
): GroupSocialOpportunity[] {
  const actor = input.actors.find((entry) => entry.actorId === input.actorId);
  if (!actor || !availableAtMeeting(actor, input) || !meetingSupportsGroup(input)) return [];
  const active = new Set(input.activeSourceRevisions ?? []);
  const opportunities = [
    ...requestOpportunities(input, active),
    ...eventOpportunities(input, active),
    ...resourceOpportunities(input, active),
    ...dutyOpportunities(input, active),
  ];
  return dedupe(opportunities)
    .sort((left, right) =>
      sourcePriority(left.sourceKind) - sourcePriority(right.sourceKind) ||
      left.warrant.sourceRef.localeCompare(right.warrant.sourceRef),
    )
    .slice(0, 3);
}

function requestOpportunities(
  input: GroupSocialOpportunityInput,
  active: ReadonlySet<string>,
): GroupSocialOpportunity[] {
  const result: GroupSocialOpportunity[] = [];
  for (const request of [...input.requests].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
    if (![request.issuerActorId, request.assigneeActorId].includes(input.actorId)) continue;
    const direct = [request.issuerActorId, request.assigneeActorId]
      .map((actorId) => actorAtMeeting(input, actorId))
      .filter((entry): entry is GroupSocialActorFact => entry !== undefined);
    if (direct.length !== 2) continue;
    const experts = actorsAtMeeting(input)
      .filter((entry) =>
        !direct.some((directActor) => directActor.actorId === entry.actorId) &&
        REQUEST_EXPERT_ROLES[request.type].has(entry.role),
      )
      .sort(actorOrder)
      .slice(0, 2);
    if (experts.length === 0) continue;
    const participants = [...direct, ...experts].slice(0, 5);
    const roles = participants.map((entry) => ({
      actorId: entry.actorId,
      role: entry.actorId === request.issuerActorId
        ? ('decision_owner' as const)
        : entry.actorId === request.assigneeActorId
          ? ('affected_party' as const)
          : ('expert' as const),
    }));
    const sourceRef = `request:${request.requestId}`;
    const sourceRevision = `request:${request.revision}:${stableObservationDigest({
      status: request.status,
      type: request.type,
      issuerActorId: request.issuerActorId,
      assigneeActorId: request.assigneeActorId,
      itemId: request.itemId,
      locationId: request.locationId,
    })}`;
    const built = build(input, active, {
      sourceKind: 'shared_request',
      sourceRef,
      sourceRevision,
      topicRefs: [sourceRef],
      audience: 'participants',
      urgencyBand: 'important',
      participants: roles,
      observerActorIds: [],
      summary: `围绕共同委托 ${request.requestId} 召集相关成员商议`,
    });
    if (built) result.push(built);
  }
  return result;
}

function eventOpportunities(
  input: GroupSocialOpportunityInput,
  active: ReadonlySet<string>,
): GroupSocialOpportunity[] {
  const result: GroupSocialOpportunity[] = [];
  for (const event of [...input.events].sort((a, b) => b.createdAt - a.createdAt || a.eventId.localeCompare(b.eventId))) {
    // Session, invitation and outcome lifecycle events are bookkeeping for an
    // already-social action. Treating them as fresh shared incidents produces
    // a self-exciting loop: terminal → new group invite → terminal. Only an
    // external/common-world event may seed a new group warrant.
    if (event.visibility === 'private' || event.visibility === 'rumor' || isSocialLifecycleEvent(event.eventType)) continue;
    if (event.mapId !== input.mapId || event.locationId !== input.locationId) continue;
    const directIds = unique([
      ...event.actorIds,
      ...event.targetActorIds,
      ...event.witnessActorIds,
    ]);
    if (!directIds.includes(input.actorId)) continue;
    const present = directIds
      .map((actorId) => actorAtMeeting(input, actorId))
      .filter((entry): entry is GroupSocialActorFact => entry !== undefined);
    if (present.length < 3) continue;
    const selected = present.slice(0, 5);
    const roles = selected.map((entry, index) => ({
      actorId: entry.actorId,
      role: event.targetActorIds.includes(entry.actorId)
        ? ('affected_party' as const)
        : index === 0
          ? ('decision_owner' as const)
          : event.witnessActorIds.includes(entry.actorId)
            ? ('witness' as const)
            : DECISION_OWNER_ROLES.has(entry.role)
              ? ('mediator' as const)
            : ('affected_party' as const),
    }));
    ensureRequiredRoles(roles);
    const participantIds = new Set(roles.map((entry) => entry.actorId));
    const observers = event.visibility === 'public' || event.visibility === 'local'
      ? present
          .filter((entry) => !participantIds.has(entry.actorId) && event.witnessActorIds.includes(entry.actorId))
          .map((entry) => entry.actorId)
          .sort()
          .slice(0, 4)
      : [];
    const sourceRef = `event:${event.eventId}`;
    const sourceRevision = `event:${stableObservationDigest({
      eventType: event.eventType,
      createdAt: event.createdAt,
      visibility: event.visibility,
      actorIds: [...event.actorIds].sort(),
      targetActorIds: [...event.targetActorIds].sort(),
      witnessActorIds: [...event.witnessActorIds].sort(),
      mapId: event.mapId,
      locationId: event.locationId,
    })}`;
    const built = build(input, active, {
      sourceKind: 'shared_event',
      sourceRef,
      sourceRevision,
      topicRefs: [sourceRef],
      audience: observers.length > 0 ? 'local_public' : 'participants',
      urgencyBand: 'important',
      participants: roles,
      observerActorIds: observers,
      summary: `围绕共同事件 ${event.eventType} 召集相关成员商议`,
    });
    if (built) result.push(built);
  }
  return result;
}

function isSocialLifecycleEvent(eventType: string) {
  return /^(?:group_conversation_|group_social_|group_proposal_|group_vote_|group_commitment_|social_outcome_|social_invitation_|conversation_|action_)/u.test(eventType);
}

function resourceOpportunities(
  input: GroupSocialOpportunityInput,
  active: ReadonlySet<string>,
): GroupSocialOpportunity[] {
  const host = actorAtMeeting(input, input.actorId);
  if (!host || !DECISION_OWNER_ROLES.has(host.role)) return [];
  const result: GroupSocialOpportunity[] = [];
  for (const resource of [...input.resources].sort((a, b) => a.resourceNodeId.localeCompare(b.resourceNodeId))) {
    const claimants = actorsAtMeeting(input)
      .filter((entry) =>
        entry.actorId !== host.actorId &&
        inventoryQuantity(entry.inventory, resource.itemId) === 0 &&
        actorNeedsItem(input, entry, resource.itemId),
      )
      .sort(actorOrder)
      .slice(0, 4);
    if (claimants.length < 2 || resource.available >= claimants.length) continue;
    const roles = [
      { actorId: host.actorId, role: 'decision_owner' as const },
      ...claimants.map((entry) => ({ actorId: entry.actorId, role: 'affected_party' as const })),
    ];
    const sourceRef = `resource:${resource.resourceNodeId}`;
    const sourceRevision = `resource:${resource.revision}:${stableObservationDigest({
      itemId: resource.itemId,
      available: resource.available,
      claimantActorIds: claimants.map((entry) => entry.actorId),
    })}`;
    const built = build(input, active, {
      sourceKind: 'resource_dispute',
      sourceRef,
      sourceRevision,
      topicRefs: [sourceRef, `item:${resource.itemId}`],
      audience: 'participants',
      urgencyBand: 'important',
      participants: roles,
      observerActorIds: [],
      summary: `协调稀缺资源 ${resource.itemId} 的当前分配`,
    });
    if (built) result.push(built);
  }
  return result;
}

function dutyOpportunities(
  input: GroupSocialOpportunityInput,
  active: ReadonlySet<string>,
): GroupSocialOpportunity[] {
  const host = actorAtMeeting(input, input.actorId);
  if (!host || !DECISION_OWNER_ROLES.has(host.role)) return [];
  const hourOfDay = Math.floor(input.nowGameHour % 24);
  const band = hourOfDay >= 5 && hourOfDay <= 8 ? 'dawn' : undefined;
  if (!band) return [];
  const related = actorsAtMeeting(input)
    .filter((entry) => entry.actorId !== host.actorId && dutyCompatible(host.role, entry.role))
    .sort(actorOrder)
    .slice(0, 4);
  if (related.length < 2) return [];
  const day = Math.floor(input.nowGameHour / 24);
  const sourceRef = `duty_meeting:${input.mapId}:${input.locationId}:${day}:${band}`;
  const sourceRevision = `duty:${stableObservationDigest({
    sourceRef,
    hostRole: host.role,
    participantActorIds: related.map((entry) => entry.actorId),
  })}`;
  const built = build(input, active, {
    sourceKind: 'duty_meeting',
    sourceRef,
    sourceRevision,
    topicRefs: [sourceRef],
    audience: 'participants',
    urgencyBand: 'routine',
    participants: [
      { actorId: host.actorId, role: 'decision_owner' },
      ...related.map((entry) => ({
        actorId: entry.actorId,
        role: 'affected_party' as const,
      })),
    ],
    observerActorIds: [],
    summary: `召集同地职责成员进行 ${band} 交接`,
  });
  return built ? [built] : [];
}

function build(
  input: GroupSocialOpportunityInput,
  active: ReadonlySet<string>,
  source: {
    sourceKind: GroupSocialSourceKind;
    sourceRef: string;
    sourceRevision: string;
    topicRefs: string[];
    audience: 'participants' | 'local_public';
    urgencyBand: 'important' | 'routine';
    participants: Array<{ actorId: string; role: GroupSocialParticipantRole }>;
    observerActorIds: string[];
    summary: string;
  },
): GroupSocialOpportunity | undefined {
  const participants = normalizeRoles(source.participants);
  if (
    participants.length < 3 ||
    participants.length > 5 ||
    !participants.some((entry) => entry.actorId === input.actorId) ||
    !participants.some((entry) => entry.role === 'decision_owner') ||
    !participants.some((entry) => entry.role === 'affected_party') ||
    active.has(`${source.sourceRef}|${source.sourceRevision}`)
  ) return undefined;
  const participantIds = new Set(participants.map((entry) => entry.actorId));
  const observers = unique(source.observerActorIds)
    .filter((actorId) => !participantIds.has(actorId) && actorAtMeeting(input, actorId))
    .slice(0, 8);
  if (source.audience === 'participants' && observers.length > 0) return undefined;
  const requiredCapacity = participants.length + observers.length;
  if (!input.location || input.location.capacity - input.location.occupiedCapacity < requiredCapacity) {
    return undefined;
  }
  const targets = participants
    .map((entry) => entry.actorId)
    .filter((actorId) => actorId !== input.actorId)
    .sort();
  const identity = stableObservationDigest({
    actorId: input.actorId,
    sourceKind: source.sourceKind,
    sourceRef: source.sourceRef,
    sourceRevision: source.sourceRevision,
    participants,
    observers,
  }).slice('stable64:'.length);
  const warrant: SocialWarrant = {
    contractVersion: SOCIAL_WARRANT_VERSION,
    warrantId: `warrant:group:${identity}`,
    actorId: input.actorId,
    kind: 'collective_event',
    sourceRef: source.sourceRef,
    sourceRevision: source.sourceRevision,
    intendedOutcome: 'reach_group_decision',
    eligibleTargetActorIds: targets,
    topicRefs: unique(source.topicRefs),
    audience: source.audience,
    urgencyBand: source.urgencyBand,
    createdAt: input.nowGameHour,
    expiresAt: input.nowGameHour + GROUP_WARRANT_TTL_GAME_HOURS,
  };
  const candidate: SocialOpportunityCandidate = {
    contractVersion: SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
    candidateId: `candidate:group:${identity}`,
    warrantId: warrant.warrantId,
    mode: 'start_group_conversation',
    targetActorIds: targets,
    meetingLocationId: input.locationId!,
    intendedActivity: 'group_decide',
    summary: source.summary.slice(0, 120),
  };
  const warrantValidation = validateSocialWarrant(warrant);
  const candidateValidation = validateSocialOpportunityCandidate(candidate, warrant);
  if (!warrantValidation.ok || !candidateValidation.ok) return undefined;
  return {
    sourceKind: source.sourceKind,
    warrant: warrantValidation.warrant,
    candidate: candidateValidation.candidate,
    participantRoles: participants,
    observerActorIds: observers,
  };
}

function actorsAtMeeting(input: GroupSocialOpportunityInput) {
  return input.actors.filter((actor) => availableAtMeeting(actor, input)).sort(actorOrder);
}

function actorAtMeeting(input: GroupSocialOpportunityInput, actorId: string) {
  return input.actors.find((actor) => actor.actorId === actorId && availableAtMeeting(actor, input));
}

function availableAtMeeting(actor: GroupSocialActorFact, input: GroupSocialOpportunityInput) {
  return actor.aliveAndCapable && !actor.busy && actor.mapId === input.mapId &&
    actor.locationId !== undefined && actor.locationId === input.locationId;
}

function meetingSupportsGroup(input: GroupSocialOpportunityInput) {
  return Boolean(
    input.locationId &&
    input.location &&
    input.location.dangerLevel <= 1 &&
    input.location.allowedActions.includes('group_talk') &&
    input.location.allowedActions.includes('group_decide'),
  );
}

function ensureRequiredRoles(
  roles: Array<{ actorId: string; role: GroupSocialParticipantRole }>,
) {
  if (!roles.some((entry) => entry.role === 'decision_owner')) roles[0].role = 'decision_owner';
  if (!roles.some((entry) => entry.role === 'affected_party')) {
    roles[Math.min(1, roles.length - 1)].role = 'affected_party';
  }
}

function normalizeRoles(
  roles: Array<{ actorId: string; role: GroupSocialParticipantRole }>,
) {
  const seen = new Set<string>();
  return roles
    .filter((entry) => {
      if (seen.has(entry.actorId)) return false;
      seen.add(entry.actorId);
      return true;
    })
    .sort((left, right) => left.actorId.localeCompare(right.actorId));
}

function dutyCompatible(hostRole: string, participantRole: string) {
  if (hostRole === 'guard') return participantRole === 'guard' || participantRole === 'steward';
  if (hostRole === 'merchant') return participantRole === 'merchant' || participantRole === 'steward';
  return participantRole !== 'merchant' || hostRole === 'steward';
}

function inventoryQuantity(
  inventory: Array<{ itemId: string; qty: number }> | undefined,
  itemId: string,
) {
  return inventory?.find((item) => item.itemId === itemId)?.qty ?? 0;
}

function actorNeedsItem(
  input: GroupSocialOpportunityInput,
  actor: GroupSocialActorFact,
  itemId: string,
) {
  return (actor.neededItemIds ?? []).includes(itemId) || input.requests.some((request) =>
    request.assigneeActorId === actor.actorId && request.itemId === itemId &&
    (request.status === 'accepted' || request.status === 'ready_to_turn_in'));
}

function dedupe(opportunities: GroupSocialOpportunity[]) {
  const seen = new Set<string>();
  return opportunities.filter((opportunity) => {
    const key = `${opportunity.warrant.sourceRef}|${opportunity.warrant.sourceRevision}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function actorOrder(left: GroupSocialActorFact, right: GroupSocialActorFact) {
  return left.actorId.localeCompare(right.actorId);
}

function sourcePriority(kind: GroupSocialSourceKind) {
  return ['shared_request', 'shared_event', 'resource_dispute', 'duty_meeting'].indexOf(kind);
}
