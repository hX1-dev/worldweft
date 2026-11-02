import { stableObservationDigest } from './lifeObservation';
import {
  socialConsequenceProjectionSourceRef,
  validateSocialConsequenceProjection,
  type SocialConsequenceProjectionV1,
} from './socialConsequenceProjectionContracts';
import {
  SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
  SOCIAL_WARRANT_VERSION,
  revalidateSocialOpportunityCandidate,
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
  type SocialOpportunityActivity,
  type SocialOpportunityCandidate,
  type SocialOpportunityLatestFacts,
  type SocialRuntimeReasonCode,
  type SocialWarrant,
  type SocialWarrantAudience,
  type SocialWarrantKind,
  type SocialWarrantUrgency,
} from './socialWarrantContracts';

export const SAME_LOCATION_SOCIAL_SOURCE_VERSION =
  'taixu.same-location-social-source.v1' as const;
export const SAME_LOCATION_SOCIAL_TARGET_LIMIT = 3 as const;
export const SAME_LOCATION_SOCIAL_CANDIDATE_LIMIT = 12 as const;
export const RELATIONSHIP_MAINTENANCE_DEBT_DAYS = 7 as const;

export type SameLocationSocialSourceKind = Extract<
  SocialWarrantKind,
  | 'care_or_aid'
  | 'active_obligation'
  | 'knowledge_gap'
  | 'gratitude_or_repair'
  | 'conflict_resolution'
  | 'relationship_maintenance'
>;

export type SameLocationSocialSource = {
  contractVersion: typeof SAME_LOCATION_SOCIAL_SOURCE_VERSION;
  actorId: string;
  targetActorId: string;
  kind: SameLocationSocialSourceKind;
  sourceRef: string;
  sourceRevision: string;
  topicRefs: string[];
  audience: SocialWarrantAudience;
  urgencyBand: SocialWarrantUrgency;
  createdAt: number;
  expiresAt: number;
  locationId: string;
  targetLocationId: string;
  preferredActivity: Extract<SocialOpportunityActivity, 'talk' | 'gift' | 'teach'>;
  targetRelevant: boolean;
  targetAliveAndCapable: boolean;
  targetBusy: boolean;
  targetCanFulfillOutcome: boolean;
  disclosureAllowed: boolean;
  cooldownClear: boolean;
  sessionCapacityAvailable: boolean;
  maintenanceDebtGameDays?: number;
  socialConsequenceProjection?: SocialConsequenceProjectionV1;
};

export type SameLocationSocialOpportunityEntry = {
  source: SameLocationSocialSource;
  sourceDigest: string;
  warrant: SocialWarrant;
  warrantDigest: string;
  candidate: SocialOpportunityCandidate;
  candidateDigest: string;
  warrantCandidateDigest: string;
};

export type SameLocationSocialOpportunityRejection = {
  sourceKey: string;
  reasonCode: SocialRuntimeReasonCode;
};

export type SameLocationSocialOpportunityBundle = {
  contractVersion: typeof SAME_LOCATION_SOCIAL_SOURCE_VERSION;
  sourceSetDigest: string;
  targetActorIds: string[];
  entries: SameLocationSocialOpportunityEntry[];
  rejections: SameLocationSocialOpportunityRejection[];
};

export type SameLocationSocialDerivationInput = {
  nowGameHour: number;
  currentGameDay: number;
  // 维护情谊的门槛：多亲近才会想起对方、隔多少天没联系才去找。缺省 25 / 7 天，
  // 与原来一致；拟人生活 v1 下熟人隔一天就会聊上几句。
  maintenanceMinRelationship?: number;
  maintenanceDebtDays?: number;
  // 给了这个门槛，维护情谊时对足够亲近、又不在送礼间隔里的人改送东西（手头有可送之物时）。
  // 缺省不送，与原来一致。
  maintenanceGiftMinRelationship?: number;
  // 按亲近分档的"隔几天想去找"（从高到低取第一个够得上的档）；缺省用 maintenanceDebtDays。
  maintenanceDebtDaysByRelationship?: Array<{ minRelationship: number; debtDays: number }>;
  actor: {
    actorId: string;
    locationId: string;
    health: number;
    maxHealth: number;
    hasHealingItem: boolean;
    hasGiftableItem: boolean;
  };
  targets: Array<{
    actorId: string;
    role?: string;
    locationId: string;
    relationship: number;
    trust: number;
    suspicion: number;
    debt: number;
    fear: number;
    lastTouchedDay?: number;
    recentlyTalked: boolean;
    aliveAndCapable: boolean;
    busy: boolean;
    cooldownClear: boolean;
    sessionCapacityAvailable: boolean;
    giftCooldownClear?: boolean;
  }>;
  requests: Array<{
    requestId: string;
    revision: number;
    status: 'offered' | 'accepted' | 'ready_to_turn_in';
    issuerActorId: string;
  }>;
  beliefs: Array<{
    beliefId: string;
    revision: number;
    sourceActorId: string;
    kind: string;
    active: boolean;
    validity?: string;
    truthStatus?: string;
  }>;
  memories: Array<{
    sourceEventId: string;
    aboutActorIds: string[];
    eventActorIds?: string[];
    eventTargetActorIds?: string[];
    type: string;
    source?: string;
    distorted?: boolean;
    createdAt: number;
    expiresAt: number;
  }>;
};

export function deriveSameLocationSocialSources(
  input: SameLocationSocialDerivationInput,
): SameLocationSocialSource[] {
  const now = Math.max(0, Math.floor(input.nowGameHour));
  const targets = [...input.targets]
    .filter(
      (target) =>
        target.actorId !== input.actor.actorId &&
        target.locationId === input.actor.locationId,
    )
    .sort((left, right) => compareText(left.actorId, right.actorId));
  const byActor = new Map(targets.map((target) => [target.actorId, target]));
  const sources: SameLocationSocialSource[] = [];
  const add = (
    target: (typeof targets)[number],
    fact: Omit<
      SameLocationSocialSource,
      | 'contractVersion'
      | 'actorId'
      | 'targetActorId'
      | 'locationId'
      | 'targetLocationId'
      | 'targetRelevant'
      | 'targetAliveAndCapable'
      | 'targetBusy'
      | 'targetCanFulfillOutcome'
      | 'disclosureAllowed'
      | 'cooldownClear'
      | 'sessionCapacityAvailable'
    > & { disclosureAllowed?: boolean; targetCanFulfillOutcome?: boolean },
  ) => {
    sources.push({
      contractVersion: SAME_LOCATION_SOCIAL_SOURCE_VERSION,
      actorId: input.actor.actorId,
      targetActorId: target.actorId,
      locationId: input.actor.locationId,
      targetLocationId: target.locationId,
      targetRelevant: true,
      targetAliveAndCapable: target.aliveAndCapable,
      targetBusy: target.busy,
      targetCanFulfillOutcome: fact.targetCanFulfillOutcome ?? true,
      disclosureAllowed: fact.disclosureAllowed ?? true,
      cooldownClear: target.cooldownClear,
      sessionCapacityAvailable: target.sessionCapacityAvailable,
      ...fact,
    });
  };

  if (input.actor.health > 0 && input.actor.health < input.actor.maxHealth && !input.actor.hasHealingItem) {
    for (const target of targets.filter(
      (entry) =>
        entry.relationship >= 25 ||
        entry.trust >= 15 ||
        ['elder', 'herbalist', 'merchant'].includes(entry.role ?? ''),
    )) {
      add(target, {
        kind: 'care_or_aid',
        sourceRef: `body:${input.actor.actorId}`,
        sourceRevision: `body:${stableObservationDigest({ health: input.actor.health, maxHealth: input.actor.maxHealth, hasHealingItem: false })}`,
        topicRefs: [`body:health:${input.actor.actorId}`],
        audience: 'private',
        urgencyBand: input.actor.health * 2 <= input.actor.maxHealth ? 'critical' : 'important',
        createdAt: now,
        expiresAt: now + 1,
        preferredActivity: 'talk',
      });
    }
  }

  for (const request of [...input.requests].sort((left, right) => compareText(left.requestId, right.requestId))) {
    const target = byActor.get(request.issuerActorId);
    if (!target) continue;
    add(target, {
      kind: 'active_obligation',
      sourceRef: `request:${request.requestId}`,
      sourceRevision: `request:rev:${request.revision}`,
      topicRefs: [`request:${request.requestId}`],
      audience: 'participants',
      urgencyBand: request.status === 'accepted' ? 'routine' : 'important',
      createdAt: now,
      expiresAt: now + 1,
      preferredActivity: 'talk',
    });
  }

  for (const belief of [...input.beliefs].sort((left, right) => compareText(left.beliefId, right.beliefId))) {
    const target = byActor.get(belief.sourceActorId);
    if (
      !target ||
      !belief.active ||
      (belief.validity !== undefined && belief.validity !== 'active') ||
      belief.truthStatus !== 'unknown' ||
      belief.kind === 'rumor'
    ) continue;
    add(target, {
      kind: 'knowledge_gap',
      sourceRef: `belief:${belief.beliefId}`,
      sourceRevision: `belief:rev:${belief.revision}`,
      topicRefs: [`belief:${belief.beliefId}`],
      audience: 'private',
      urgencyBand: 'routine',
      createdAt: now,
      expiresAt: now + 24,
      preferredActivity: 'teach',
    });
  }

  for (const target of targets) {
    const memory = [...input.memories]
      .filter(
        (entry) => {
          const sourceRolesKnown =
            entry.eventActorIds !== undefined && entry.eventTargetActorIds !== undefined;
          const targetHelpedActor =
            sourceRolesKnown &&
            entry.eventActorIds!.includes(target.actorId) &&
            entry.eventTargetActorIds!.includes(input.actor.actorId);
          const actorCausedTargetEvent =
            sourceRolesKnown &&
            entry.eventActorIds!.includes(input.actor.actorId) &&
            entry.eventTargetActorIds!.includes(target.actorId);
          const roleSupportsGratitudeOrRepair =
            !sourceRolesKnown ||
            (target.debt !== 0 && targetHelpedActor) ||
            (target.suspicion > 0 && actorCausedTargetEvent);
          return (
            entry.expiresAt > now &&
            entry.source !== 'rumor' &&
            entry.distorted !== true &&
            // Receipt-derived summaries and directionally incompatible source
            // events cannot excite a new social opportunity. Exact event roles
            // distinguish "target helped actor" from "actor helped target".
            !isDerivedSocialOutcomeMemory(entry.type) &&
            entry.aboutActorIds.includes(target.actorId) &&
            roleSupportsGratitudeOrRepair
          );
        },
      )
      .sort((left, right) => right.createdAt - left.createdAt || compareText(left.sourceEventId, right.sourceEventId))[0];
    if (memory && (target.debt !== 0 || target.suspicion > 0)) {
      add(target, {
        kind: 'gratitude_or_repair',
        sourceRef: `event:${memory.sourceEventId}`,
        sourceRevision: `event:${stableObservationDigest({ type: memory.type, createdAt: memory.createdAt })}`,
        topicRefs: [`event:${memory.sourceEventId}`],
        audience: memory.source === 'witness' ? 'local_public' : 'participants',
        urgencyBand: target.suspicion >= 25 ? 'important' : 'routine',
        createdAt: now,
        expiresAt: Math.max(now + 1, Math.floor(memory.expiresAt)),
        preferredActivity: input.actor.hasGiftableItem && target.debt > 0 ? 'gift' : 'talk',
      });
    }
    const debtDays =
      target.lastTouchedDay === undefined
        ? 0
        : Math.max(0, input.currentGameDay - target.lastTouchedDay);
    if (
      target.relationship >= (input.maintenanceMinRelationship ?? 25) &&
      !target.recentlyTalked &&
      debtDays >= maintenanceDebtDaysFor(input, target.relationship)
    ) {
      add(target, {
        kind: 'relationship_maintenance',
        sourceRef: `relationship:${target.actorId}`,
        sourceRevision: `relationship:${stableObservationDigest({
          relationship: target.relationship,
          trust: target.trust,
          suspicion: target.suspicion,
          debt: target.debt,
          fear: target.fear,
          lastTouchedDay: target.lastTouchedDay,
        })}`,
        topicRefs: [`relationship:maintenance:${target.actorId}`],
        audience: 'participants',
        urgencyBand: 'routine',
        createdAt: now,
        expiresAt: now + 24,
        preferredActivity:
          input.maintenanceGiftMinRelationship !== undefined &&
          target.relationship >= input.maintenanceGiftMinRelationship &&
          input.actor.hasGiftableItem &&
          target.giftCooldownClear !== false
            ? 'gift'
            : 'talk',
        maintenanceDebtGameDays: debtDays,
      });
    }
  }
  return canonicalSources(sources);
}

function maintenanceDebtDaysFor(input: SameLocationSocialDerivationInput, relationship: number) {
  const tier = [...(input.maintenanceDebtDaysByRelationship ?? [])]
    .sort((left, right) => right.minRelationship - left.minRelationship)
    .find((entry) => relationship >= entry.minRelationship);
  return tier?.debtDays ?? input.maintenanceDebtDays ?? RELATIONSHIP_MAINTENANCE_DEBT_DAYS;
}

function isDerivedSocialOutcomeMemory(type: string) {
  return /^social_outcome_(?:resolved|failed|closed)$/u.test(type);
}

type BuildInput = {
  now: number;
  actorId: string;
  locationId: string;
  actorAliveAndCapable: boolean;
  actorBusy: boolean;
  sources: readonly SameLocationSocialSource[];
  maintenanceDebtDays?: number;
};

const SOURCE_KEYS = new Set([
  'contractVersion',
  'actorId',
  'targetActorId',
  'kind',
  'sourceRef',
  'sourceRevision',
  'topicRefs',
  'audience',
  'urgencyBand',
  'createdAt',
  'expiresAt',
  'locationId',
  'targetLocationId',
  'preferredActivity',
  'targetRelevant',
  'targetAliveAndCapable',
  'targetBusy',
  'targetCanFulfillOutcome',
  'disclosureAllowed',
  'cooldownClear',
  'sessionCapacityAvailable',
  'maintenanceDebtGameDays',
  'socialConsequenceProjection',
]);

const OUTCOME_BY_KIND: Record<SameLocationSocialSourceKind, SocialWarrant['intendedOutcome']> = {
  care_or_aid: 'request_aid',
  active_obligation: 'respond_to_request',
  knowledge_gap: 'ask_or_verify',
  gratitude_or_repair: 'thank_apologize_or_repair',
  conflict_resolution: 'mediate_or_negotiate',
  relationship_maintenance: 'maintain_bond',
};

const URGENCY_ORDER: Record<SocialWarrantUrgency, number> = {
  critical: 0,
  important: 1,
  routine: 2,
};

const KIND_ORDER: Record<SameLocationSocialSourceKind, number> = {
  care_or_aid: 0,
  active_obligation: 1,
  knowledge_gap: 2,
  gratitude_or_repair: 3,
  conflict_resolution: 4,
  relationship_maintenance: 5,
};

export function buildSameLocationSocialOpportunityBundle(
  input: BuildInput,
): SameLocationSocialOpportunityBundle {
  if (!validIdentifier(input.actorId) || !validIdentifier(input.locationId)) {
    throw new Error('same_location_social_invalid_actor_or_location');
  }
  if (!Number.isFinite(input.now) || input.now < 0) {
    throw new Error('same_location_social_invalid_now');
  }
  const normalizedInput = { ...input, now: Math.floor(input.now) };
  const sources = canonicalSources(input.sources);
  const rejections: SameLocationSocialOpportunityRejection[] = [];
  const eligible = sources.filter((source) => {
    const reasonCode = dynamicRejection(normalizedInput, source);
    if (!reasonCode) return true;
    rejections.push({ sourceKey: sourceIdentity(source), reasonCode });
    return false;
  });
  const targetActorIds = [...new Set(eligible.map((source) => source.targetActorId))].slice(
    0,
    SAME_LOCATION_SOCIAL_TARGET_LIMIT,
  );
  const allowedTargets = new Set(targetActorIds);
  const entries = eligible
    .filter((source) => allowedTargets.has(source.targetActorId))
    .slice(0, SAME_LOCATION_SOCIAL_CANDIDATE_LIMIT)
    .map(entryForSource);
  return {
    contractVersion: SAME_LOCATION_SOCIAL_SOURCE_VERSION,
    sourceSetDigest: stableObservationDigest(sources.map(normalizedSource)),
    targetActorIds,
    entries,
    rejections,
  };
}

export function revalidateSameLocationSocialOpportunityEntry(input: {
  entry: SameLocationSocialOpportunityEntry;
  now: number;
  actorAliveAndCapable: boolean;
  actorBusy: boolean;
  latestSource?: SameLocationSocialSource;
}): SocialRuntimeReasonCode | undefined {
  const latest = input.latestSource;
  if (!latest) return 'social_warrant_missing';
  validateSource(latest);
  const sourceMatches =
    latest.sourceRef === input.entry.warrant.sourceRef &&
    latest.sourceRevision === input.entry.warrant.sourceRevision &&
    latest.actorId === input.entry.warrant.actorId;
  const facts: SocialOpportunityLatestFacts = {
    now: Math.floor(input.now),
    source: sourceMatches
      ? { sourceRef: latest.sourceRef, sourceRevision: latest.sourceRevision }
      : undefined,
    actorAliveAndCapable: input.actorAliveAndCapable,
    actorBusy: input.actorBusy,
    targetFacts: [
      {
        actorId: latest.targetActorId,
        relevant: latest.targetRelevant,
        aliveAndCapable: latest.targetAliveAndCapable,
        busy: latest.targetBusy,
        // The target remains a known, source-bound actor even after leaving the
        // meeting place. `moved` must therefore win over generic unavailable.
        visibleOrKnownReachable: true,
        declined: false,
        moved: latest.targetLocationId !== input.entry.source.locationId,
        canFulfillOutcome: latest.targetCanFulfillOutcome,
      },
    ],
    disclosureAllowed: latest.disclosureAllowed,
    cooldownClear: latest.cooldownClear,
    sessionCapacityAvailable: latest.sessionCapacityAvailable,
    meetingLocationValid: latest.locationId === input.entry.source.locationId,
    invitationState: 'not_required',
    sharedTopicRefs: [...latest.topicRefs],
  };
  return revalidateSocialOpportunityCandidate(
    input.entry.warrant,
    input.entry.candidate,
    facts,
  );
}

export function sameLocationSocialSourceDigest(source: SameLocationSocialSource) {
  validateSource(source);
  return stableObservationDigest(normalizedSource(source));
}

function canonicalSources(input: readonly SameLocationSocialSource[]) {
  const identities = new Map<string, { digest: string; source: SameLocationSocialSource }>();
  for (const raw of input) {
    validateSource(raw);
    const source = normalizedSource(raw);
    const key = sourceIdentity(source);
    const digest = stableObservationDigest(source);
    const prior = identities.get(key);
    if (prior && prior.digest !== digest) {
      throw new Error(`same_location_social_source_conflict:${key}`);
    }
    if (!prior) identities.set(key, { digest, source });
  }
  return [...identities.values()]
    .map((entry) => entry.source)
    .sort(compareSources);
}

function validateSource(source: SameLocationSocialSource) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('same_location_social_source_not_object');
  }
  if (source.contractVersion !== SAME_LOCATION_SOCIAL_SOURCE_VERSION) {
    throw new Error('same_location_social_source_unsupported_version');
  }
  if (Object.keys(source).some((key) => !SOURCE_KEYS.has(key))) {
    throw new Error('same_location_social_source_unknown_field');
  }
  const warrant = warrantForSource(normalizedSourceUnchecked(source));
  const validated = validateSocialWarrant(warrant);
  if (!validated.ok) throw new Error(`same_location_social_source_invalid:${validated.reasonCode}`);
  if (!validIdentifier(source.locationId) || !validIdentifier(source.targetLocationId)) {
    throw new Error('same_location_social_source_location_invalid');
  }
  if (!['talk', 'gift', 'teach'].includes(source.preferredActivity)) {
    throw new Error('same_location_social_source_activity_invalid');
  }
  for (const value of [
    source.targetRelevant,
    source.targetAliveAndCapable,
    source.targetBusy,
    source.targetCanFulfillOutcome,
    source.disclosureAllowed,
    source.cooldownClear,
    source.sessionCapacityAvailable,
  ]) {
    if (typeof value !== 'boolean') throw new Error('same_location_social_source_state_invalid');
  }
  if (
    source.maintenanceDebtGameDays !== undefined &&
    (!Number.isSafeInteger(source.maintenanceDebtGameDays) || source.maintenanceDebtGameDays < 0)
  ) {
    throw new Error('same_location_social_source_maintenance_debt_invalid');
  }
  if (source.socialConsequenceProjection) {
    if (
      !validateSocialConsequenceProjection(source.socialConsequenceProjection) ||
      source.kind !== (
        source.socialConsequenceProjection.kind === 'grievance_created'
          ? 'conflict_resolution'
          : 'gratitude_or_repair'
      ) ||
      source.sourceRef !== socialConsequenceProjectionSourceRef(
        source.socialConsequenceProjection.consequenceId,
      ) ||
      source.sourceRevision !== source.socialConsequenceProjection.sourceRevision
    ) {
      throw new Error('same_location_social_source_consequence_projection_invalid');
    }
  }
}

function dynamicRejection(
  input: BuildInput,
  source: SameLocationSocialSource,
): SocialRuntimeReasonCode | undefined {
  if (source.actorId !== input.actorId) return 'social_warrant_missing';
  if (input.now < source.createdAt || input.now >= source.expiresAt) return 'social_source_stale';
  if (source.locationId !== input.locationId) return 'social_meeting_location_invalid';
  if (!input.actorAliveAndCapable || input.actorBusy) return 'social_target_unavailable';
  if (source.targetLocationId !== input.locationId) return 'social_target_moved';
  if (!source.targetAliveAndCapable) return 'social_target_unavailable';
  if (source.targetBusy) return 'social_target_busy';
  if (!source.targetRelevant || !source.targetCanFulfillOutcome) return 'social_target_irrelevant';
  if (!source.disclosureAllowed) return 'social_disclosure_forbidden';
  if (!source.cooldownClear) return 'social_cooldown_active';
  if (!source.sessionCapacityAvailable) return 'social_session_capacity_full';
  if (
    source.kind === 'relationship_maintenance' &&
    (source.maintenanceDebtGameDays ?? 0) < (input.maintenanceDebtDays ?? RELATIONSHIP_MAINTENANCE_DEBT_DAYS)
  ) {
    return 'social_target_irrelevant';
  }
  return undefined;
}

function entryForSource(source: SameLocationSocialSource): SameLocationSocialOpportunityEntry {
  const sourceDigest = stableObservationDigest(normalizedSource(source));
  const warrant = warrantForSource(source);
  const warrantValidation = validateSocialWarrant(warrant);
  if (!warrantValidation.ok) {
    throw new Error(`same_location_social_warrant_invalid:${warrantValidation.reasonCode}`);
  }
  const candidate: SocialOpportunityCandidate = {
    contractVersion: SOCIAL_OPPORTUNITY_CANDIDATE_VERSION,
    candidateId: `social_opportunity:${sourceDigest.slice('stable64:'.length)}`,
    warrantId: warrant.warrantId,
    mode: 'start_direct_conversation',
    targetActorIds: [source.targetActorId],
    intendedActivity: source.preferredActivity,
    summary: summaryForSource(source),
  };
  const candidateValidation = validateSocialOpportunityCandidate(candidate, warrant);
  if (!candidateValidation.ok) {
    throw new Error(`same_location_social_candidate_invalid:${candidateValidation.reasonCode}`);
  }
  return {
    source,
    sourceDigest,
    warrant,
    warrantDigest: socialWarrantDigest(warrant),
    candidate,
    candidateDigest: socialOpportunityCandidateDigest(candidate),
    warrantCandidateDigest: socialWarrantCandidateDigest(warrant, candidate),
  };
}

function warrantForSource(source: SameLocationSocialSource): SocialWarrant {
  const baseDigest = stableObservationDigest({
    actorId: source.actorId,
    targetActorId: source.targetActorId,
    kind: source.kind,
    sourceRef: source.sourceRef,
    sourceRevision: source.sourceRevision,
  });
  return {
    contractVersion: SOCIAL_WARRANT_VERSION,
    warrantId: `social_warrant:${baseDigest.slice('stable64:'.length)}`,
    actorId: source.actorId,
    kind: source.kind,
    sourceRef: source.sourceRef,
    sourceRevision: source.sourceRevision,
    intendedOutcome: OUTCOME_BY_KIND[source.kind],
    eligibleTargetActorIds: [source.targetActorId],
    topicRefs: [...source.topicRefs].sort(compareText),
    audience: source.audience,
    urgencyBand: source.urgencyBand,
    createdAt: source.createdAt,
    expiresAt: source.expiresAt,
  };
}

function normalizedSource(source: SameLocationSocialSource): SameLocationSocialSource {
  validateSourceShallow(source);
  return normalizedSourceUnchecked(source);
}

function normalizedSourceUnchecked(source: SameLocationSocialSource): SameLocationSocialSource {
  return { ...source, topicRefs: [...source.topicRefs].sort(compareText) };
}

function validateSourceShallow(source: SameLocationSocialSource) {
  if (!Array.isArray(source.topicRefs)) throw new Error('same_location_social_source_topic_invalid');
}

function compareSources(left: SameLocationSocialSource, right: SameLocationSocialSource) {
  return (
    URGENCY_ORDER[left.urgencyBand] - URGENCY_ORDER[right.urgencyBand] ||
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    compareText(left.sourceRef, right.sourceRef) ||
    compareText(left.targetActorId, right.targetActorId) ||
    compareText(left.sourceRevision, right.sourceRevision)
  );
}

function sourceIdentity(source: SameLocationSocialSource) {
  return `${source.actorId}|${source.kind}|${source.sourceRef}|${source.targetActorId}`;
}

function summaryForSource(source: SameLocationSocialSource) {
  const prefix: Record<SameLocationSocialSourceKind, string> = {
    care_or_aid: '因身体需要向对方求助',
    active_obligation: '就当前委托与对方沟通',
    knowledge_gap: '向对方求证未知之事',
    gratitude_or_repair: '就共同经历向对方致谢或修复关系',
    conflict_resolution: '就具名伤害向对方要求赔偿或请求调解',
    relationship_maintenance: '因久未联系与对方维护情谊',
  };
  return `${prefix[source.kind]}（${source.targetActorId}）`.slice(0, 120);
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/\s|[\u0000-\u001f\u007f]/u.test(value)
  );
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
