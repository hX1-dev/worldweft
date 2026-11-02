import type { AgentContext, AgentProposal } from './agentLogic';
import type { AutonomyCandidateV3 } from './autonomyDecisionContracts';
import { AGENT_REST_FATIGUE_THRESHOLD, HEAVY_ACTION_FATIGUE_THRESHOLD, REST_FATIGUE_RECOVERY, normalizeFatigue } from './fatigueLogic';
import { healingAmount } from './items';
import { stableObservationDigest } from './lifeObservation';
import { roleAllows } from './policy';
import {
  PURPOSE_BOUND_LIFE_INTENT_VERSION,
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundIntendedActivity,
  type PurposeBoundLifeIntentV2,
  type PurposeBoundLifePurpose,
} from './purposeBoundLifeIntentContracts';
import { homeZone } from './routineLogic';
import type { ActivePersonalGoal, PersonalGoalCandidate } from './personalGoalContracts';
import { purposePersonalGoalCandidateForProposal } from './purposeBoundPersonalGoalLogic';
import { purposeResourceOutlookSummary } from './purposeResourceOutlookLogic';
import {
  LEISURE_MIN_FATIGUE,
  HUMAN_MOOD_BASELINE,
  humanLifeEnabled,
  humanLivelihoodQuantity,
  isHumanLeisureSpot,
  humanMaintenanceDebtDays,
  humanMaintenancePlan,
  humanMaintenanceTargetIds,
  isHumanCultivationRestDue,
  isHumanDayOff,
  isHumanDutyDay,
  isHumanSleepTime,
  nextHumanWakeGameHour,
} from './humanLifeLogic';
import { HUMAN_AVOID_SUSPICION, HUMAN_AVOID_TROUBLE } from './humanSocietyLogic';
import { evaluatePurposeGoalCadence } from './purposeGoalCadenceLogic';
import { evaluatePurposeGoalReplacement } from './purposeGoalReplacementLogic';
import {
  buildSameLocationSocialOpportunityBundle,
  sameLocationSocialSourceDigest,
  type SameLocationSocialOpportunityEntry,
} from './sameLocationSocialOpportunityLogic';
import {
  projectAcceptedSocialInvitationIntent,
} from './socialInvitationGoalLogic';
import type { SocialConsequenceProjectionV1 } from './socialConsequenceProjectionContracts';
import {
  projectSharedPlanParticipantIntent,
  sharedPlanParticipantProposal,
} from './sharedPlanLogic';

export const PURPOSE_BOUND_LIFE_CANDIDATE_VERSION =
  'taixu.purpose-bound-life-candidate.v2' as const;
export const PURPOSE_BOUND_LIFE_CANDIDATE_LIMIT = 12 as const;
export const PURPOSE_BOUND_LIFE_MAX_DANGER_LEVEL = 2 as const;

export type PurposeBoundLifeCandidateV2 = {
  contractVersion: typeof PURPOSE_BOUND_LIFE_CANDIDATE_VERSION;
  candidateId: string;
  planner: string;
  legacyOrder: number;
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  proposal: AgentProposal;
  proposalDigest: string;
  personalGoalCandidate: PersonalGoalCandidate;
  socialOpportunity?: SameLocationSocialOpportunityEntry;
  socialConsequenceProjection?: SocialConsequenceProjectionV1;
};

export type PurposeBoundLifeCandidateBundleV2 = {
  contractVersion: typeof PURPOSE_BOUND_LIFE_CANDIDATE_VERSION;
  purposeFactsDigest: string;
  candidateSetDigest: string;
  candidates: PurposeBoundLifeCandidateV2[];
  intentionalIdle?: {
    sourceRef: string;
    sourceRevision: string;
    targetLocationId: string;
    reasonCode: 'on_watch' | 'awaiting_customer' | 'sleeping';
    untilGameHour?: number;
  };
  cadenceDeferred?: {
    cadenceKey: string;
    priorGoalId: string;
    nextEligibleGameHour: number;
  }[];
};

export type PurposeBoundLifeCandidateRevalidation =
  | {
      ok: true;
      candidate: PurposeBoundLifeCandidateV2;
      candidateSetDigest: string;
      purposeFactsDigest: string;
    }
  | {
      ok: false;
      reasonCode:
        | 'purpose_candidate_source_missing'
        | 'purpose_candidate_source_revision_stale'
        | 'purpose_candidate_target_stale'
        | 'purpose_candidate_activity_unavailable'
        | 'purpose_candidate_intent_digest_stale'
        | 'purpose_candidate_proposal_digest_stale'
        | 'purpose_candidate_not_found';
      candidateSetDigest: string;
      purposeFactsDigest: string;
    };

const PURPOSE_ORDER: Record<PurposeBoundLifePurpose, number> = {
  recovery: 0,
  obligation: 100,
  duty_return: 200,
  livelihood: 300,
  cultivation: 400,
  relationship: 500,
  exploration: 600,
};

const DIRECT_ACTIONS = new Set<PurposeBoundIntendedActivity>([
  'rest',
  'use_item',
  'cultivate',
  'gather',
  'trade',
  'accept_request',
  'decline_request',
  'turn_in_request',
  'talk',
  'gift',
  'request_teaching',
  'explore',
  'inspect',
]);

export function buildPurposeBoundLifeCandidateBundle(
  context: AgentContext,
): PurposeBoundLifeCandidateBundleV2 {
  const purposeFactsDigest = purposeBoundLifeFactsDigest(context);
  if (
    context.purposeBoundLifeIntentV2 !== true ||
    context.stableLifeSemanticTravelV1 === true ||
    context.self.health <= 0 ||
    context.self.lifeStatus === 'deceased' ||
    context.activeExecution ||
    context.activeConversation ||
    context.activeGroupConversation
  ) {
    return {
      contractVersion: PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
      purposeFactsDigest,
      candidateSetDigest: purposeBoundLifeCandidateSetDigest([]),
      candidates: [],
      intentionalIdle:
        context.purposeBoundLifeIntentV2 === true
          ? purposeBoundIntentionalIdle(context)
          : undefined,
    };
  }

  const candidates: PurposeBoundLifeCandidateV2[] = [];
  // 拟人生活 v1：睡觉时间只顾身体和救急，其余的事留到天亮。
  const asleep = isHumanSleepTime(context);
  addRecoveryCandidates(context, candidates);
  if (asleep) {
    addSleepCandidate(context, candidates);
    addSameLocationSocialCandidates(context, candidates, { urgentOnly: true });
  } else {
    addObligationCandidates(context, candidates);
    addSharedPlanCandidates(context, candidates);
    addDutyReturnCandidate(context, candidates);
    addLivelihoodCandidates(context, candidates);
    addCultivationCandidates(context, candidates);
    addAcceptedSocialInvitationCandidates(context, candidates);
    addSameLocationSocialCandidates(context, candidates);
    addExplorationCandidates(context, candidates);
    addLeisureCandidate(context, candidates);
  }

  const cadenceDeferred: NonNullable<
    PurposeBoundLifeCandidateBundleV2['cadenceDeferred']
  > = [];
  const cadenceEligible = dedupeCandidates(candidates)
    .sort(compareCandidates)
    .filter((candidate) => {
      const cadence = evaluatePurposeGoalCadence({
        candidate: candidate.personalGoalCandidate,
        currentGameHour: context.currentGameHour ?? 0,
        windows: context.personalGoalCadences ?? [],
        activeGoal: context.personalGoal,
        fatigue: context.self.fatigue,
      });
      if (cadence.allowed) return true;
      cadenceDeferred.push({
        cadenceKey: cadence.cadenceKey,
        priorGoalId: cadence.priorGoalId,
        nextEligibleGameHour: cadence.nextEligibleGameHour,
      });
      return false;
    });
  // A committed purpose goal must not share Pi's bounded choice surface with
  // ordinary alternatives that the goal mutation would later reject anyway.
  // Keep the exact continuation and only those replacements the purpose-goal
  // policy explicitly allows (survival, major event, or configured obligation).
  // This leaves GM admission authoritative; it simply prevents a wasted model
  // turn from choosing an already-known committed conflict.
  const activeGoalEligible = cadenceEligible.filter((candidate) =>
    candidateMayReplaceActivePurposeGoal(context.personalGoal, candidate.personalGoalCandidate),
  );
  const bounded = activeGoalEligible.slice(0, PURPOSE_BOUND_LIFE_CANDIDATE_LIMIT);
  return {
    contractVersion: PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
    purposeFactsDigest,
    candidateSetDigest: purposeBoundLifeCandidateSetDigest(bounded),
    candidates: bounded,
    intentionalIdle: asleep ? sleepingIntentionalIdle(context) : purposeBoundIntentionalIdle(context),
    cadenceDeferred: cadenceDeferred.length > 0 ? cadenceDeferred : undefined,
  };
}

export function candidateMayReplaceActivePurposeGoal(
  activeGoal: ActivePersonalGoal | undefined,
  candidate: PersonalGoalCandidate,
) {
  if (!activeGoal?.purposeIntentDigest) return true;
  return evaluatePurposeGoalReplacement({ active: activeGoal, selected: candidate }).kind !== 'retain';
}

export function purposeBoundLifeCandidateSetDigest(
  candidates: readonly PurposeBoundLifeCandidateV2[],
) {
  return stableObservationDigest(
    [...candidates].sort(compareCandidates).map((candidate) => ({
      candidateId: candidate.candidateId,
      intentDigest: candidate.intentDigest,
      proposalDigest: candidate.proposalDigest,
    })),
  );
}

export function purposeBoundLifeFactsDigest(context: AgentContext) {
  return stableObservationDigest({
    contractVersion: PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
    enabled: context.purposeBoundLifeIntentV2 === true,
    currentGameHour: context.currentGameHour ?? 0,
    activePurposeCadenceKey: context.personalGoal?.purposeCadenceKey,
    cadenceWindows: [...(context.personalGoalCadences ?? [])]
      .map((window) => ({
        cadenceKey: window.cadenceKey,
        nextEligibleGameHour: window.nextEligibleGameHour,
      }))
      .sort(
        (left, right) =>
          left.cadenceKey.localeCompare(right.cadenceKey) ||
          left.nextEligibleGameHour - right.nextEligibleGameHour,
      ),
    self: {
      actorId: context.self.actorId,
      role: context.self.role,
      realm: context.self.realm,
      realmStage: context.self.realmStage,
      cultivationXp: context.self.cultivationXp,
      health: context.self.health,
      maxHealth: context.self.maxHealth,
      fatigue: normalizeFatigue(context.self.fatigue),
      spirit: context.self.spirit,
      currentLocationId: context.self.currentLocationId,
      inventory: normalizedInventory(context),
    },
    currentLocationSpiritualEnergy: context.currentLocationSpiritualEnergy ?? 0,
    cultivationModes: [...(context.cultivationModes ?? [])].sort(),
    knownLocations: [...(context.knownLocations ?? [])]
      .map((location) => ({
        locationId: location.locationId,
        allowedActions: [...location.allowedActions].sort(),
        dangerLevel: location.dangerLevel ?? 0,
        spiritualEnergy: location.spiritualEnergy ?? 0,
      }))
      .sort((left, right) => left.locationId.localeCompare(right.locationId)),
    resourceNodes: [...(context.purposeResourceNodes ?? [])].sort((left, right) =>
      left.resourceNodeId.localeCompare(right.resourceNodeId),
    ),
    shopOffers: [...(context.purposeShopOffers ?? [])].sort(comparePurposeShopOffers),
    requests: [...(context.activeRequests ?? [])]
      .map((request) => ({ ...request }))
      .sort((left, right) =>
        (left.requestId ?? '').localeCompare(right.requestId ?? ''),
      ),
    others: [...context.others]
      .map((other) => ({
        actorId: other.actorId,
        relationship: other.relationship,
        trust: other.trust ?? 0,
        suspicion: other.suspicion ?? 0,
        debt: other.debt ?? 0,
        fear: other.fear ?? 0,
      }))
      .sort((left, right) => left.actorId.localeCompare(right.actorId)),
    recentlyTalked: [...(context.recentlyTalked ?? [])].sort(),
    giftCooldownTargetActorIds: [...(context.giftCooldownTargetActorIds ?? [])].sort(),
    sameLocationSocialSources: [...(context.sameLocationSocialSources ?? [])]
      .map((source) => ({ digest: sameLocationSocialSourceDigest(source) }))
      .sort((left, right) => left.digest.localeCompare(right.digest)),
    acceptedSocialInvitations: [...(context.acceptedSocialInvitations ?? [])]
      .map((source) => ({
        invitationId: source.receipt.invitationId,
        revision: source.receipt.revision,
        receiptDigest: source.receiptDigest,
        targetLocationId: source.targetLocationId,
        sourceCurrent: source.sourceCurrent,
        targetAliveAndCapable: source.targetAliveAndCapable,
        targetBusy: source.targetBusy,
        targetStillAtMeeting: source.targetStillAtMeeting,
        capacityAvailable: source.capacityAvailable,
      }))
      .sort((left, right) => left.invitationId.localeCompare(right.invitationId)),
    acceptedSharedPlans: [...(context.acceptedSharedPlans ?? [])]
      .map((source) => ({
        planId: source.plan.planId,
        revision: source.plan.revision,
        scheduleRevision: source.plan.scheduleRevision,
        scheduleDigest: source.plan.scheduleDigest,
        status: source.plan.status,
        actorId: context.self.actorId,
        sourceCurrent: source.sourceCurrent,
        actorAliveAndCapable: source.actorAliveAndCapable,
        actorBusy: source.actorBusy,
        resourceAvailable: source.resourceAvailable,
        resourceAccess: source.resourceAccess,
      }))
      .sort((left, right) => left.planId.localeCompare(right.planId)),
    worldPressures: [...(context.worldPressures ?? [])]
      .map((pressure) => ({
        pressureId: pressure.pressureId,
        revision: pressure.revision,
        locationId: pressure.locationId,
        sourceEventId: pressure.sourceEventId,
        status: pressure.status,
      }))
      .sort((left, right) => left.pressureId.localeCompare(right.pressureId)),
  });
}

export function revalidatePurposeBoundLifeCandidate(input: {
  actorId: string;
  candidateId: string;
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  proposalDigest: string;
  freshContext: AgentContext;
}): PurposeBoundLifeCandidateRevalidation {
  const fresh = buildPurposeBoundLifeCandidateBundle(input.freshContext);
  const failure = (
    reasonCode: Extract<PurposeBoundLifeCandidateRevalidation, { ok: false }>['reasonCode'],
  ): PurposeBoundLifeCandidateRevalidation => ({
    ok: false,
    reasonCode,
    candidateSetDigest: fresh.candidateSetDigest,
    purposeFactsDigest: fresh.purposeFactsDigest,
  });
  if (input.freshContext.self.actorId !== input.actorId) {
    return failure('purpose_candidate_source_missing');
  }
  const intentValidation = validatePurposeBoundLifeIntentV2(input.intent);
  if (!intentValidation.ok || input.intentDigest !== purposeBoundLifeIntentDigest(input.intent)) {
    return failure('purpose_candidate_intent_digest_stale');
  }
  if (
    input.intent.targetLocationId &&
    !knownLocation(input.freshContext, input.intent.targetLocationId)
  ) {
    return failure('purpose_candidate_target_stale');
  }
  const candidate = fresh.candidates.find(
    (entry) => entry.candidateId === input.candidateId,
  );
  if (!candidate) {
    if (
      input.intent.targetLocationId &&
      !knownLocation(input.freshContext, input.intent.targetLocationId)
    ) {
      return failure('purpose_candidate_target_stale');
    }
    const latestSocialSource = (input.freshContext.sameLocationSocialSources ?? []).find(
      (source) => source.sourceRef === input.intent.sourceRef,
    );
    const latestInvitationSource = (input.freshContext.acceptedSocialInvitations ?? []).find(
      (source) => `invitation:${source.receipt.invitationId}` === input.intent.sourceRef,
    );
    if (
      latestSocialSource &&
      latestSocialSource.sourceRevision !== input.intent.sourceRevision
    ) {
      return failure('purpose_candidate_source_revision_stale');
    }
    if (latestInvitationSource) {
      const projected = projectAcceptedSocialInvitationIntent(latestInvitationSource);
      if (
        !projected.ok ||
        projected.projection.intent.sourceRevision !== input.intent.sourceRevision
      ) {
        return failure('purpose_candidate_source_revision_stale');
      }
    }
    if (!sourceStillPresent(input.freshContext, input.intent.sourceRef)) {
      return failure('purpose_candidate_source_missing');
    }
    return failure('purpose_candidate_activity_unavailable');
  }
  if (candidate.intent.sourceRevision !== input.intent.sourceRevision) {
    return failure('purpose_candidate_source_revision_stale');
  }
  if (candidate.intentDigest !== input.intentDigest) {
    return failure('purpose_candidate_intent_digest_stale');
  }
  if (candidate.proposalDigest !== input.proposalDigest) {
    return failure('purpose_candidate_proposal_digest_stale');
  }
  return {
    ok: true,
    candidate,
    candidateSetDigest: fresh.candidateSetDigest,
    purposeFactsDigest: fresh.purposeFactsDigest,
  };
}

function addRecoveryCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  const fatigue = normalizeFatigue(context.self.fatigue);
  if (fatigue < AGENT_REST_FATIGUE_THRESHOLD || !roleAllows(context.self.role, 'rest')) return;
  const destination = preferredLocation(context, 'rest');
  if (!destination) return;
  const sourceRef = `body:${context.self.actorId}`;
  const sourceRevision = revision('body', {
    health: context.self.health,
    maxHealth: context.self.maxHealth ?? 10,
    fatigue,
  });
  const intent: PurposeBoundLifeIntentV2 = {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'recovery',
    sourceRef,
    sourceRevision,
    targetLocationId: destination.locationId,
    intendedActivity: 'rest',
    completionCondition: {
      kind: 'body_metric_at_or_below',
      subjectRef: sourceRef,
      metric: 'fatigue',
      threshold: Math.max(0, fatigue - REST_FATIGUE_RECOVERY),
    },
    interruptionPolicy: 'hard_obligation_or_invalidated',
  };
  addCandidate(context, candidates, {
    planner: 'rest',
    variant: `fatigue:${destination.locationId}`,
    intent,
    summary:
      destination.locationId === context.self.currentLocationId
        ? `疲劳已达 ${fatigue}，在${destination.name}完成一次休息`
        : `疲劳已达 ${fatigue}，前往${destination.name}完成一次休息`,
  });
}

// 到了睡觉的钟点：回家（或最近能歇的地方）歇下。人已在家、乏也消尽，就由
// sleepingIntentionalIdle 表达睡着，不再另起一次休息。
function addSleepCandidate(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  const fatigue = normalizeFatigue(context.self.fatigue);
  if (fatigue >= AGENT_REST_FATIGUE_THRESHOLD) return;
  if (!roleAllows(context.self.role, 'rest')) return;
  const destination = sleepLocation(context);
  if (!destination) return;
  if (fatigue === 0 && destination.locationId === context.self.currentLocationId) return;
  const sourceRef = `body:${context.self.actorId}`;
  const intent: PurposeBoundLifeIntentV2 = {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'recovery',
    sourceRef,
    sourceRevision: revision('body', {
      health: context.self.health,
      maxHealth: context.self.maxHealth ?? 10,
      fatigue,
      sleep: true,
    }),
    targetLocationId: destination.locationId,
    intendedActivity: 'rest',
    completionCondition: {
      kind: 'body_metric_at_or_below',
      subjectRef: sourceRef,
      metric: 'fatigue',
      threshold: Math.max(0, fatigue - REST_FATIGUE_RECOVERY),
    },
    interruptionPolicy: 'hard_obligation_or_invalidated',
  };
  addCandidate(context, candidates, {
    planner: 'rest',
    variant: `sleep:${destination.locationId}`,
    intent,
    summary:
      destination.locationId === context.self.currentLocationId
        ? `夜深了，在${destination.name}歇下`
        : `夜深了，回${destination.name}歇下`,
  });
}

// 拟人生活 v1：身上有些乏时，可以出去走走，到人来人往又能歇脚的地方坐坐（修炼日除外）；
// 轮休、交际或歇息的日子，不乏也会出门走走（只去别处，不在原地"出门"）。
// 社交的日子偏去坊市（能遇到掌柜、能送东西），其余偏去歇脚亭。
function addLeisureCandidate(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  if (!humanLifeEnabled(context) || !roleAllows(context.self.role, 'rest')) return;
  // 当值、闭关修炼的日子不出门，累了就在家歇。
  if (isHumanDutyDay(context) || context.humanDay?.focus === 'cultivation') return;
  const fatigue = normalizeFatigue(context.self.fatigue);
  if (fatigue >= AGENT_REST_FATIGUE_THRESHOLD) return;
  const freeDay =
    isHumanDayOff(context) ||
    context.humanDay?.focus === 'social' ||
    context.humanDay?.focus === 'idle';
  const outingOnly = fatigue < LEISURE_MIN_FATIGUE;
  // 不乏时出门是为了散心：心境平常（不高于 5）才出门，散过心就不再出门。
  if (outingOnly && (!freeDay || context.self.mood > HUMAN_MOOD_BASELINE)) return;
  const home = homeZone(context.self.role);
  let spots = [...(context.knownLocations ?? [])].filter(
    (location) => safeLocation(location) && isHumanLeisureSpot(location, home),
  );
  if (outingOnly) {
    // 已在歇脚处：只把正在进行的这一趟走完，不另起一趟。
    const here = spots.find((location) => location.locationId === context.self.currentLocationId);
    const continuing =
      context.personalGoal?.purposeIntent?.intendedActivity === 'rest' &&
      context.personalGoal.purposeIntent.targetLocationId === here?.locationId;
    if (here) {
      if (!continuing) return;
      spots = [here];
    }
  }
  if (spots.length === 0) return;
  const preferGift = context.humanDay?.focus === 'social';
  const destination = [...spots].sort(
    (left, right) =>
      Number(right.allowedActions.includes('gift') === preferGift) -
        Number(left.allowedActions.includes('gift') === preferGift) ||
      left.locationId.localeCompare(right.locationId),
  )[0];
  const sourceRef = `body:${context.self.actorId}`;
  const intent: PurposeBoundLifeIntentV2 = {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'recovery',
    sourceRef,
    sourceRevision: revision('body', {
      health: context.self.health,
      maxHealth: context.self.maxHealth ?? 10,
      fatigue,
      mood: context.self.mood,
      leisure: destination.locationId,
    }),
    targetLocationId: destination.locationId,
    intendedActivity: 'rest',
    completionCondition: {
      kind: 'body_metric_at_or_below',
      subjectRef: sourceRef,
      metric: 'fatigue',
      threshold: Math.max(0, fatigue - REST_FATIGUE_RECOVERY),
    },
    interruptionPolicy: 'survival_or_invalidated',
  };
  addCandidate(context, candidates, {
    planner: 'leisure',
    variant: `leisure:${destination.locationId}`,
    intent,
    summary:
      destination.locationId === context.self.currentLocationId
        ? `在${destination.name}坐坐，歇歇脚`
        : `出去走走，到${destination.name}歇歇脚`,
  });
}

function sleepLocation(context: AgentContext) {
  const home = homeZone(context.self.role);
  const homeLocation = home ? locationById(context, home) : undefined;
  if (homeLocation?.allowedActions.includes('rest')) return homeLocation;
  return preferredLocation(context, 'rest');
}

function sleepingIntentionalIdle(
  context: AgentContext,
): PurposeBoundLifeCandidateBundleV2['intentionalIdle'] {
  const locationId = context.self.currentLocationId;
  if (!locationId) return undefined;
  const sourceRef = `body:${context.self.actorId}`;
  return {
    sourceRef,
    sourceRevision: revision('body', { sleeping: true, locationId }),
    targetLocationId: locationId,
    reasonCode: 'sleeping',
    untilGameHour: nextHumanWakeGameHour(context),
  };
}

function addCultivationCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  if (
    !roleAllows(context.self.role, 'cultivate') ||
    normalizeFatigue(context.self.fatigue) >= HEAVY_ACTION_FATIGUE_THRESHOLD ||
    // 拟人生活 v1：不是修炼日，修完一次要隔得更久。
    isHumanCultivationRestDue(context)
  ) {
    return;
  }
  const here = context.self.currentLocationId;
  const locations = [...(context.knownLocations ?? [])]
    .filter(
      (location) =>
        safeLocation(location) && location.allowedActions.includes('cultivate'),
    )
    .sort(
      (left, right) =>
        (right.spiritualEnergy ?? 0) - (left.spiritualEnergy ?? 0) ||
        left.locationId.localeCompare(right.locationId),
    );
  const local = locations.find((location) => location.locationId === here);
  // 拟人生活 v1：当值的日子不离岗去别处修炼。
  const remote = isHumanDutyDay(context)
    ? undefined
    : locations.find(
        (location) =>
          location.locationId !== here &&
          (location.spiritualEnergy ?? 0) > (context.currentLocationSpiritualEnergy ?? 0),
      );
  const sourceRef = `cultivation:${context.self.actorId}`;
  const sourceRevision = revision('cultivation', {
    realm: context.self.realm,
    realmStage: context.self.realmStage,
    cultivationXp: context.self.cultivationXp,
    spirit: context.self.spirit,
    fatigue: normalizeFatigue(context.self.fatigue),
  });
  for (const destination of [local, remote].filter(
    (location): location is NonNullable<typeof location> => location !== undefined,
  )) {
    const intent: PurposeBoundLifeIntentV2 = {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'cultivation',
      sourceRef,
      sourceRevision,
      targetLocationId: destination.locationId,
      intendedActivity: 'cultivate',
      completionCondition: {
        kind: 'cultivation_xp_at_or_above',
        subjectRef: sourceRef,
        baselineXp: context.self.cultivationXp,
        minimumXp: context.self.cultivationXp + 1,
      },
      interruptionPolicy: 'survival_or_invalidated',
    };
    addCandidate(context, candidates, {
      planner: 'lifestyle',
      variant: `cultivate:${destination.locationId}`,
      intent,
      summary:
        destination.locationId === here
          ? `在${destination.name}完成一次有进益的修行`
          : `前往灵气更盛的${destination.name}完成一次有进益的修行`,
    });
  }
}

function addLivelihoodCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  const inventory = new Map(normalizedInventory(context).map((item) => [item.itemId, item.qty]));
  // 拟人生活 v1：留着送人的灵草不算进谋生的行囊。
  const forLivelihood = (itemId: string) =>
    humanLivelihoodQuantity(context, itemId, inventory.get(itemId) ?? 0);
  if (roleAllows(context.self.role, 'gather')) {
    for (const node of [...(context.purposeResourceNodes ?? [])]
      .filter((entry) => entry.available > 0 && forLivelihood(entry.itemId) === 0)
      .sort((left, right) => left.resourceNodeId.localeCompare(right.resourceNodeId))) {
      const baseline = inventory.get(node.itemId) ?? 0;
      const intent: PurposeBoundLifeIntentV2 = {
        contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
        purposeKind: 'livelihood',
        sourceRef: `resource:${node.resourceNodeId}`,
        sourceRevision: node.sourceRevision,
        targetLocationId: node.locationId,
        intendedActivity: 'gather',
        completionCondition: {
          kind: 'inventory_quantity_at_or_above',
          subjectRef: `inventory:${context.self.actorId}:${node.itemId}`,
          itemId: node.itemId,
          baselineQuantity: baseline,
          quantity: baseline + 1,
        },
        interruptionPolicy: 'survival_or_invalidated',
      };
      addCandidate(context, candidates, {
        planner: 'gather',
        variant: `node:${node.resourceNodeId}`,
        intent,
        summary:
          (node.locationId === context.self.currentLocationId
            ? `行囊缺少${node.itemId}，从${node.name}采集一份`
            : `行囊缺少${node.itemId}，前往${node.name}采集一份`) +
          (node.outlook ? purposeResourceOutlookSummary(node.outlook) : ''),
        directParams: { resourceNodeId: node.resourceNodeId },
        futureParams: { resourceNodeId: node.resourceNodeId },
      });
    }
  }
  if (roleAllows(context.self.role, 'trade')) {
    for (const offer of [...(context.purposeShopOffers ?? [])]
      .filter(
        (entry) =>
          entry.direction === 'sell' &&
          entry.itemId !== 'spirit_stone' &&
          forLivelihood(entry.itemId) >= entry.qty,
      )
      .sort(comparePurposeShopOffers)) {
      const baseline = inventory.get(offer.itemId) ?? 0;
      const intent: PurposeBoundLifeIntentV2 = {
        contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
        purposeKind: 'livelihood',
        sourceRef: `shop:${offer.shopId}`,
        sourceRevision: offer.sourceRevision,
        targetLocationId: offer.locationId,
        intendedActivity: 'trade',
        completionCondition: {
          kind: 'inventory_quantity_at_or_below',
          subjectRef: `inventory:${context.self.actorId}:${offer.itemId}`,
          itemId: offer.itemId,
          baselineQuantity: baseline,
          quantity: baseline - offer.qty,
        },
        interruptionPolicy: 'survival_or_invalidated',
      };
      const tradeParams = {
        shopId: offer.shopId,
        quoteRevision: offer.sourceRevision,
        offeredItemId: offer.itemId,
        offeredQty: offer.qty,
        requestedItemId: 'spirit_stone',
        requestedQty: offer.totalPrice,
        plannedTargetActorId: offer.targetActorId,
      };
      addCandidate(context, candidates, {
        planner: 'shop',
        variant: `sell:${offer.shopId}:${offer.itemId}`,
        intent,
        summary:
          offer.locationId === context.self.currentLocationId
            ? `按${offer.shopName}最新报价出售一份${offer.itemId}`
            : `前往${offer.shopName}，按最新报价出售一份${offer.itemId}`,
        directTargetActorId: offer.targetActorId,
        directParams: tradeParams,
        futureParams: tradeParams,
      });
    }
  }
}

function addObligationCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  const nearby = new Set(context.others.map((actor) => actor.actorId));
  const inventory = new Map(normalizedInventory(context).map((item) => [item.itemId, item.qty]));
  for (const request of [...(context.activeRequests ?? [])].sort((left, right) =>
    (left.requestId ?? '').localeCompare(right.requestId ?? ''),
  )) {
    if (!request.requestId) continue;
    const sourceRef = `request:${request.requestId}`;
    const sourceRevision = `request:rev:${request.revision ?? 1}`;
    const base = {
      requestId: request.requestId,
      expectedRevision: request.revision ?? 1,
    };
    if (
      request.status === 'offered' &&
      request.issuerActorId &&
      nearby.has(request.issuerActorId)
    ) {
      for (const activity of ['accept_request', 'decline_request'] as const) {
        if (!context.availableActions.includes(activity)) continue;
        const status = activity === 'accept_request' ? 'accepted' : 'declined';
        const intent: PurposeBoundLifeIntentV2 = {
          contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
          purposeKind: 'obligation',
          sourceRef,
          sourceRevision,
          targetLocationId: context.self.currentLocationId,
          intendedActivity: activity,
          completionCondition: {
            kind: 'request_status_equals',
            subjectRef: sourceRef,
            expectedRevision: sourceRevision,
            status,
          },
          interruptionPolicy: 'survival_or_invalidated',
        };
        addCandidate(context, candidates, {
          planner: 'quest',
          variant: `${activity}:${request.requestId}`,
          intent,
          summary:
            activity === 'accept_request'
              ? `当面接受委托：${request.summary}`
              : `当面婉拒委托：${request.summary}`,
          directTargetActorId: request.issuerActorId,
          directParams: base,
        });
      }
      continue;
    }
    if (request.status === 'ready_to_turn_in' && request.issuerActorId) {
      const targetLocationId = request.issuerLocationId;
      if (!targetLocationId) continue;
      const intent = obligationIntent({
        sourceRef,
        sourceRevision,
        targetLocationId,
        activity: 'turn_in_request',
      });
      addCandidate(context, candidates, {
        planner: 'quest',
        variant: `turn_in:${request.requestId}`,
        intent,
        summary:
          targetLocationId === context.self.currentLocationId
            ? `向委托人交付：${request.summary}`
            : `前往委托人所在地点交付：${request.summary}`,
        directTargetActorId: request.issuerActorId,
        directParams: base,
        futureParams: { ...base, plannedTargetActorId: request.issuerActorId },
      });
      continue;
    }
    if (request.status !== 'accepted') continue;
    if (request.type === 'collect_item' && request.itemId) {
      const owned = inventory.get(request.itemId) ?? 0;
      if (owned >= (request.qty ?? 1)) continue;
      const node = [...(context.purposeResourceNodes ?? [])]
        .filter((entry) => entry.itemId === request.itemId && entry.available > 0)
        .sort((left, right) => left.resourceNodeId.localeCompare(right.resourceNodeId))[0];
      if (!node) continue;
      const intent = obligationIntent({
        sourceRef,
        sourceRevision,
        targetLocationId: node.locationId,
        activity: 'gather',
      });
      addCandidate(context, candidates, {
        planner: 'quest',
        variant: `gather:${request.requestId}:${node.resourceNodeId}`,
        intent,
        summary:
          `为委托采集${request.itemId}：${request.summary}` +
          (node.outlook ? purposeResourceOutlookSummary(node.outlook) : ''),
        directParams: { ...base, resourceNodeId: node.resourceNodeId },
        futureParams: { ...base, resourceNodeId: node.resourceNodeId },
      });
      continue;
    }
    if (request.type === 'explore_location' && request.locationId) {
      const intent = obligationIntent({
        sourceRef,
        sourceRevision,
        targetLocationId: request.locationId,
        activity: 'explore',
      });
      addCandidate(context, candidates, {
        planner: 'quest',
        variant: `explore:${request.requestId}`,
        intent,
        summary: `按委托调查${request.locationId}：${request.summary}`,
        directParams: base,
        futureParams: base,
      });
    }
  }
}

function addSameLocationSocialCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
  options: { urgentOnly?: boolean } = {},
) {
  const here = context.self.currentLocationId;
  if (!here) return;
  let sources = context.sameLocationSocialSources ?? [];
  const human = humanLifeEnabled(context);
  const plan = humanMaintenancePlan(context.humanDay?.focus);
  if (human) {
    // 拟人生活 v1：维护情谊只惦记在场的人里最亲近的几个（今天的心思定几个），
    // 越亲近隔得越短；心里有怨（或知道对方对自己有怨）的人不去找；
    // 觉得很爱惹事的人，除非是挚友，也不去找。
    const closeness = new Map(context.others.map((other) => [other.actorId, other.relationship]));
    const tense = new Set(
      context.others
        .filter(
          (other) =>
            (other.suspicion ?? 0) >= HUMAN_AVOID_SUSPICION ||
            ((other.impression?.trouble ?? 0) >= HUMAN_AVOID_TROUBLE && other.relationship < 40),
        )
        .map((other) => other.actorId),
    );
    const due = sources.filter(
      (source) =>
        source.kind === 'relationship_maintenance' &&
        !tense.has(source.targetActorId) &&
        (source.maintenanceDebtGameDays ?? 0) >=
          humanMaintenanceDebtDays(
            context.humanDay?.focus,
            closeness.get(source.targetActorId) ?? 0,
          ),
    );
    const keep = humanMaintenanceTargetIds(
      context,
      due.map((source) => ({
        targetActorId: source.targetActorId,
        debtDays: source.maintenanceDebtGameDays ?? 0,
      })),
    );
    sources = sources.filter(
      (source) => source.kind !== 'relationship_maintenance' || keep.has(source.targetActorId),
    );
  }
  const bundle = buildSameLocationSocialOpportunityBundle({
    now: context.currentGameHour ?? 0,
    actorId: context.self.actorId,
    locationId: here,
    actorAliveAndCapable: context.self.health > 0 && context.self.lifeStatus !== 'deceased',
    actorBusy: Boolean(context.activeExecution || context.activeConversation || context.activeGroupConversation),
    sources,
    ...(human ? { maintenanceDebtDays: plan.minDebtDays } : {}),
  });
  for (const entry of bundle.entries) {
    const source = entry.source;
    if (options.urgentOnly && source.kind !== 'care_or_aid') continue;
    const activity =
      source.preferredActivity === 'teach' ? ('request_teaching' as const) : source.preferredActivity;
    const purposeKind: PurposeBoundLifePurpose =
      source.kind === 'care_or_aid'
        ? 'recovery'
        : source.kind === 'active_obligation'
          ? 'obligation'
          : 'relationship';
    let params: Record<string, unknown> | undefined;
    if (activity === 'gift') {
      const gift = normalizedInventory(context).find(
        (item) => item.itemId !== 'spirit_stone' && healingAmount(item.itemId) === null,
      );
      if (!gift) continue;
      params = { itemId: gift.itemId };
    }
    const intent = socialInteractionIntent({
      purposeKind,
      sourceRef: source.sourceRef,
      sourceRevision: source.sourceRevision,
      targetLocationId: here,
      activity,
    });
    addCandidate(context, candidates, {
      planner: source.kind === 'active_obligation' ? 'quest' : 'social_warrant',
      variant: `${source.kind}:${entry.candidate.candidateId}:${activity}`,
      intent,
      summary: entry.candidate.summary,
      directTargetActorId: source.targetActorId,
      directParams: params,
      socialOpportunity: entry,
    });
  }
}

function addAcceptedSocialInvitationCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  for (const source of [...(context.acceptedSocialInvitations ?? [])].sort((left, right) =>
    left.receipt.invitationId.localeCompare(right.receipt.invitationId),
  )) {
    if (source.receipt.actorId !== context.self.actorId) continue;
    const projected = projectAcceptedSocialInvitationIntent(source);
    if (!projected.ok) continue;
    const { projection } = projected;
    addCandidate(context, candidates, {
      planner: 'social_invitation',
      variant: `accepted:${source.receipt.invitationId}:${source.receipt.revision}`,
      intent: projection.intent,
      summary: source.candidate.summary,
      directTargetActorId: projection.targetActorId,
      directParams: projection.params,
      futureParams: projection.params,
    });
  }
}

function addSharedPlanCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  for (const source of [...(context.acceptedSharedPlans ?? [])].sort((left, right) =>
    left.plan.planId.localeCompare(right.plan.planId),
  )) {
    const projected = projectSharedPlanParticipantIntent({
      ...source,
      actorId: context.self.actorId,
    });
    if (!projected.ok) continue;
    const proposal = sharedPlanParticipantProposal({
      plan: source.plan,
      actorId: context.self.actorId,
      currentLocationId: context.self.currentLocationId,
      projection: projected,
    });
    addCandidate(context, candidates, {
      planner: 'shared_plan',
      variant: `${source.plan.planId}:${source.plan.scheduleRevision}:${context.self.actorId}`,
      intent: projected.intent,
      summary: proposal.intent,
      directTargetActorId: source.plan.kind === 'shared_study'
        ? source.plan.teacherActorId
        : undefined,
      directParams: projected.proposalParams,
      futureParams: projected.proposalParams,
    });
  }
}

function addExplorationCandidates(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  if (!roleAllows(context.self.role, 'explore')) return;
  for (const pressure of [...(context.worldPressures ?? [])].sort((left, right) =>
    left.pressureId.localeCompare(right.pressureId),
  )) {
    if (pressure.status !== 'active') continue;
    const sourceRef = `world_event:${pressure.sourceEventId}`;
    const sourceRevision = `world_event:pressure:${pressure.revision}`;
    const intent: PurposeBoundLifeIntentV2 = {
      contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
      purposeKind: 'exploration',
      sourceRef,
      sourceRevision,
      targetLocationId: pressure.locationId,
      intendedActivity: 'explore',
      completionCondition: {
        kind: 'exploration_fact_recorded',
        subjectRef: sourceRef,
        expectedRevision: sourceRevision,
        factRef: `world_fact:pressure:${pressure.pressureId}:investigated`,
      },
      interruptionPolicy: 'survival_or_invalidated',
    };
    addCandidate(context, candidates, {
      planner: 'world_pressure',
      variant: `investigate:${pressure.pressureId}`,
      intent,
      summary:
        pressure.locationId === context.self.currentLocationId
          ? `调查${pressure.pressureId}的来源与影响`
          : `前往${pressure.locationId}调查${pressure.pressureId}的来源与影响`,
      directParams: {
        worldPressureId: pressure.pressureId,
        referencedFactIds: [pressure.sourceEventId],
        worldPressureResponse: 'investigate',
      },
      futureParams: {
        worldPressureId: pressure.pressureId,
        referencedFactIds: [pressure.sourceEventId],
        worldPressureResponse: 'investigate',
      },
    });
  }
}

function addDutyReturnCandidate(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
) {
  const targetLocationId = homeZone(context.self.role);
  if (!targetLocationId || targetLocationId === context.self.currentLocationId) return;
  const dutyState = dutyStateForRole(context.self.role);
  if (!dutyState || !knownLocation(context, targetLocationId)) return;
  // 拟人生活 v1：弟子的"本分"就是回去修炼，想修炼时自然会回去，不必一出门就被拉回；
  // 守卫、掌柜轮休的日子也不回岗。
  if (humanLifeEnabled(context) && (dutyState === 'cultivating' || isHumanDayOff(context))) return;
  const sourceRef = `duty:${context.self.actorId}`;
  const sourceRevision = revision('duty', {
    role: context.self.role,
    targetLocationId,
    dutyState,
  });
  const intent: PurposeBoundLifeIntentV2 = {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'duty_return',
    sourceRef,
    sourceRevision,
    targetLocationId,
    intendedActivity: 'intentional_idle',
    completionCondition: {
      kind: 'duty_state_confirmed',
      subjectRef: sourceRef,
      expectedRevision: sourceRevision,
      locationId: targetLocationId,
      dutyState,
    },
    interruptionPolicy: 'survival_or_invalidated',
  };
  addCandidate(context, candidates, {
    planner: 'routine',
    variant: `duty:${targetLocationId}`,
    intent,
    summary: `回到${targetLocationId}履行${dutyState}职责`,
  });
}

function purposeBoundIntentionalIdle(
  context: AgentContext,
): PurposeBoundLifeCandidateBundleV2['intentionalIdle'] {
  const targetLocationId = homeZone(context.self.role);
  const reasonCode =
    context.self.role === 'guard'
      ? ('on_watch' as const)
      : context.self.role === 'merchant'
        ? ('awaiting_customer' as const)
        : undefined;
  if (!targetLocationId || !reasonCode || context.self.currentLocationId !== targetLocationId) {
    return undefined;
  }
  const sourceRef = `duty:${context.self.actorId}`;
  return {
    sourceRef,
    sourceRevision: revision('duty', {
      role: context.self.role,
      targetLocationId,
      dutyState: reasonCode,
    }),
    targetLocationId,
    reasonCode,
  };
}

function addCandidate(
  context: AgentContext,
  candidates: PurposeBoundLifeCandidateV2[],
  input: {
    planner: string;
    variant: string;
    intent: PurposeBoundLifeIntentV2;
    summary: string;
    directTargetActorId?: string;
    directParams?: Record<string, unknown>;
    futureParams?: Record<string, unknown>;
    socialOpportunity?: SameLocationSocialOpportunityEntry;
  },
) {
  const validation = validatePurposeBoundLifeIntentV2(input.intent);
  if (!validation.ok) {
    throw new Error(`purpose_candidate_invalid_intent:${validation.reasonCode}`);
  }
  const targetLocationId = input.intent.targetLocationId;
  if (targetLocationId && !knownLocation(context, targetLocationId)) return;
  const isRemote =
    targetLocationId !== undefined &&
    targetLocationId !== context.self.currentLocationId;
  if (isRemote) {
    const location = locationById(context, targetLocationId);
    if (!location || !safeLocation(location)) return;
    if (
      input.intent.intendedActivity !== 'intentional_idle' &&
      (!roleAllows(context.self.role, input.intent.intendedActivity) ||
        !location.allowedActions.includes(input.intent.intendedActivity))
    ) {
      return;
    }
  } else if (
    input.intent.intendedActivity !== 'intentional_idle' &&
    (!DIRECT_ACTIONS.has(input.intent.intendedActivity) ||
      !context.availableActions.includes(input.intent.intendedActivity))
  ) {
    return;
  }
  if (!isRemote && input.intent.intendedActivity === 'intentional_idle') return;
  const intentDigest = purposeBoundLifeIntentDigest(input.intent);
  const purposeParams = {
    ...(isRemote ? input.futureParams : input.directParams),
    purposeBoundIntent: input.intent,
    purposeBoundIntentDigest: intentDigest,
    ...(input.socialOpportunity
      ? {
          socialWarrant: input.socialOpportunity.warrant,
          socialWarrantDigest: input.socialOpportunity.warrantDigest,
          socialOpportunityCandidate: input.socialOpportunity.candidate,
          socialOpportunityCandidateId: input.socialOpportunity.candidate.candidateId,
          socialOpportunityCandidateDigest: input.socialOpportunity.candidateDigest,
          socialWarrantCandidateDigest: input.socialOpportunity.warrantCandidateDigest,
          ...(input.socialOpportunity.source.socialConsequenceProjection
            ? {
                socialConsequenceId:
                  input.socialOpportunity.source.socialConsequenceProjection.consequenceId,
                socialConsequenceSourceOutcomeId:
                  input.socialOpportunity.source.socialConsequenceProjection.sourceOutcomeId,
                socialConsequenceProjectionDigest:
                  input.socialOpportunity.source.socialConsequenceProjection.projectionDigest,
              }
            : {}),
        }
      : {}),
  };
  const proposal: AgentProposal = isRemote
    ? {
        type: 'travel',
        targetId: targetLocationId,
        locationId: context.self.currentLocationId,
        params: purposeParams,
        intent: input.summary,
        source: 'agent',
      }
    : {
        type: input.intent.intendedActivity as AgentProposal['type'],
        targetActorId: input.directTargetActorId,
        locationId: context.self.currentLocationId,
        params: purposeParams,
        intent: input.summary,
        source: 'agent',
      };
  const candidateId = encodedCandidateId(input.intent, input.variant);
  const autonomyCandidate: AutonomyCandidateV3 = {
    candidateId,
    planner: input.planner,
    intentKind: proposal.type,
    targetRef: targetLocationId,
    status: 'eligible',
    legacyOrder: PURPOSE_ORDER[input.intent.purposeKind],
    survivalUrgency: 0,
    survivalReasonCodes: [],
    needScore: 0,
    personaFit: 0,
    personaReasonCodes: [],
    commitmentUrgency: 0,
    relationshipReasons: [],
    memorySourceIds: [],
  };
  const personalGoalCandidate = purposePersonalGoalCandidateForProposal(context, {
    candidate: autonomyCandidate,
    proposal,
  });
  if (!personalGoalCandidate) {
    throw new Error('purpose_candidate_personal_goal_projection_missing');
  }
  candidates.push({
    contractVersion: PURPOSE_BOUND_LIFE_CANDIDATE_VERSION,
    candidateId,
    planner: input.planner,
    legacyOrder: PURPOSE_ORDER[input.intent.purposeKind],
    intent: input.intent,
    intentDigest,
    proposal,
    proposalDigest: stableObservationDigest(proposal),
    personalGoalCandidate,
    socialOpportunity: input.socialOpportunity,
    socialConsequenceProjection:
      input.socialOpportunity?.source.socialConsequenceProjection,
  });
}

function obligationIntent(input: {
  sourceRef: string;
  sourceRevision: string;
  targetLocationId: string;
  activity: 'gather' | 'explore' | 'turn_in_request';
}): PurposeBoundLifeIntentV2 {
  return {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: 'obligation',
    sourceRef: input.sourceRef,
    sourceRevision: input.sourceRevision,
    targetLocationId: input.targetLocationId,
    intendedActivity: input.activity,
    completionCondition: {
      kind: 'request_status_equals',
      subjectRef: input.sourceRef,
      expectedRevision: input.sourceRevision,
      status: input.activity === 'gather' ? 'ready_to_turn_in' : 'completed',
    },
    interruptionPolicy: 'survival_or_invalidated',
  };
}

function socialInteractionIntent(input: {
  purposeKind: Extract<PurposeBoundLifePurpose, 'recovery' | 'obligation' | 'relationship'>;
  sourceRef: string;
  sourceRevision: string;
  targetLocationId: string;
  activity: 'talk' | 'gift' | 'request_teaching';
}): PurposeBoundLifeIntentV2 {
  return {
    contractVersion: PURPOSE_BOUND_LIFE_INTENT_VERSION,
    purposeKind: input.purposeKind,
    sourceRef: input.sourceRef,
    sourceRevision: input.sourceRevision,
    targetLocationId: input.targetLocationId,
    intendedActivity: input.activity,
    completionCondition: {
      kind: 'interaction_event_recorded',
      subjectRef: input.sourceRef,
      afterEventRevision: input.sourceRevision,
      interactionType: input.activity,
    },
    interruptionPolicy: 'survival_or_invalidated',
  };
}

function preferredLocation(context: AgentContext, activity: string) {
  const locations = [...(context.knownLocations ?? [])]
    .filter(
      (location) =>
        location.allowedActions.includes(activity) && safeLocation(location),
    )
    .sort(
      (left, right) =>
        Number(right.locationId === context.self.currentLocationId) -
          Number(left.locationId === context.self.currentLocationId) ||
        (left.dangerLevel ?? 0) - (right.dangerLevel ?? 0) ||
        left.locationId.localeCompare(right.locationId),
    );
  return locations[0];
}

function safeLocation(location: { dangerLevel?: number }) {
  return (location.dangerLevel ?? 0) <= PURPOSE_BOUND_LIFE_MAX_DANGER_LEVEL;
}

function knownLocation(context: AgentContext, locationId: string) {
  return Boolean(locationById(context, locationId));
}

function locationById(context: AgentContext, locationId: string) {
  return (context.knownLocations ?? []).find(
    (location) => location.locationId === locationId,
  );
}

function normalizedInventory(context: AgentContext) {
  return [...context.self.inventory]
    .filter((item) => item.qty > 0)
    .map((item) => ({ itemId: item.itemId, qty: item.qty }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
}

function revision(namespace: string, value: unknown) {
  return `${namespace}:${stableObservationDigest(value)}`;
}

function encodedCandidateId(intent: PurposeBoundLifeIntentV2, variant: string) {
  const digest = stableObservationDigest({
    purposeKind: intent.purposeKind,
    sourceRef: intent.sourceRef,
    intendedActivity: intent.intendedActivity,
    targetLocationId: intent.targetLocationId,
    variant,
  });
  return `purpose_v2:${digest.slice('stable64:'.length)}`;
}

function sourceStillPresent(context: AgentContext, sourceRef: string) {
  const separator = sourceRef.indexOf(':');
  const namespace = separator > 0 ? sourceRef.slice(0, separator) : '';
  const identifier = separator > 0 ? sourceRef.slice(separator + 1) : '';
  switch (namespace) {
    case 'body':
    case 'cultivation':
    case 'duty':
      return identifier === context.self.actorId;
    case 'resource':
      return (context.purposeResourceNodes ?? []).some(
        (node) => node.resourceNodeId === identifier && node.available > 0,
      );
    case 'shop':
      return (context.purposeShopOffers ?? []).some(
        (offer) => offer.shopId === identifier,
      );
    case 'request':
      return (context.activeRequests ?? []).some(
        (request) => request.requestId === identifier,
      );
    case 'actor':
    case 'relationship':
      return context.others.some((actor) => actor.actorId === identifier);
    case 'belief':
    case 'event':
      return (context.sameLocationSocialSources ?? []).some(
        (source) => source.sourceRef === sourceRef,
      );
    case 'invitation':
      return (context.acceptedSocialInvitations ?? []).some(
        (source) =>
          `invitation:${source.receipt.invitationId}` === sourceRef &&
          source.receipt.status === 'accepted',
      );
    case 'shared_plan':
      return (context.acceptedSharedPlans ?? []).some(
        (source) =>
          source.plan.planId === identifier &&
          ['scheduled', 'active'].includes(source.plan.status) &&
          source.sourceCurrent,
      );
    case 'world_event':
      return (context.worldPressures ?? []).some(
        (pressure) => pressure.sourceEventId === identifier && pressure.status === 'active',
      );
    default:
      return false;
  }
}

function dutyStateForRole(role: string) {
  if (role === 'guard') return 'on_watch' as const;
  if (role === 'merchant') return 'awaiting_customer' as const;
  if (role === 'herbalist') return 'tending_resources' as const;
  if (
    role === 'elder' ||
    role === 'steward' ||
    role.endsWith('disciple')
  ) {
    return 'cultivating' as const;
  }
  return undefined;
}

function dedupeCandidates(candidates: PurposeBoundLifeCandidateV2[]) {
  const byId = new Map<string, PurposeBoundLifeCandidateV2>();
  for (const candidate of candidates) {
    const existing = byId.get(candidate.candidateId);
    if (
      existing &&
      (existing.intentDigest !== candidate.intentDigest ||
        existing.proposalDigest !== candidate.proposalDigest)
    ) {
      throw new Error('purpose_candidate_id_collision');
    }
    byId.set(candidate.candidateId, candidate);
  }
  return [...byId.values()];
}

function compareCandidates(
  left: PurposeBoundLifeCandidateV2,
  right: PurposeBoundLifeCandidateV2,
) {
  return (
    left.legacyOrder - right.legacyOrder ||
    left.intent.sourceRef.localeCompare(right.intent.sourceRef) ||
    left.intent.intendedActivity.localeCompare(right.intent.intendedActivity) ||
    (left.intent.targetLocationId ?? '').localeCompare(
      right.intent.targetLocationId ?? '',
    ) ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function comparePurposeShopOffers(
  left: NonNullable<AgentContext['purposeShopOffers']>[number],
  right: NonNullable<AgentContext['purposeShopOffers']>[number],
) {
  return (
    left.shopId.localeCompare(right.shopId) ||
    left.direction.localeCompare(right.direction) ||
    left.itemId.localeCompare(right.itemId) ||
    left.totalPrice - right.totalPrice
  );
}
