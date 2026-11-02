import {
  ACTOR_INCAPACITATED_SKIP_REASON,
  ownedHealingItemId,
  planCombatIntent,
  planGroupConversationTurnIntent,
  planGroupDecisionIntent,
  planSelfCareIntent,
  planStrategicIntent,
  planSurvivalEnvelope,
  survivalEnvelopeInput,
  type AgentContext,
  type AgentProposal,
  type PurposeResourceOutlook,
} from './agentLogic';
import {
  AUTONOMY_CANDIDATE_LIMIT,
  AUTONOMY_DECISION_CONTRACT_VERSION,
  autonomyCandidateProjectionDigest,
  type AutonomyCandidateV3,
  type AutonomyDecisionSource,
  type AutonomyDecisionTrace,
  type AutonomyDecisionTraceV3,
} from './autonomyDecisionContracts';
import { healingAmount } from './items';
import { isActorIncapacitated } from './lifeStateLogic';
import { AGENT_REST_FATIGUE_THRESHOLD, normalizeFatigue } from './fatigueLogic';
import { planNegotiation } from './negotiationAgentLogic';
import { findConversationNeed, planRoutineIntent } from './routineLogic';
import { evaluateSurvivalEnvelope, survivalUrgencyForAction } from './survivalEnvelopeLogic';
import {
  PERSONA_EXCEPTION_FIT_THRESHOLD,
  buildPersonaPolicy,
  evaluatePersonaCandidate,
  personaCandidateRank,
  type PersonaCandidateDescriptor,
} from './personaPolicyLogic';
import { boundedPersonalGoalBacklog, personalGoalCandidateForKernel } from './personalGoalLogic';
import type { PersonalGoalCandidate, PersonalGoalPlan } from './personalGoalContracts';
import { actionIdempotencyFingerprint } from './actionIdempotency';
import { stableObservationDigest } from './lifeObservation';
import { evaluatePurposeGoalReplacement } from './purposeGoalReplacementLogic';
import {
  RESOURCE_CONTENDED_NEED_SCORE,
  isContendedGatherForNewChoice,
  purposeResourceOutlookForProposal,
} from './purposeResourceOutlookLogic';
import {
  LEISURE_NEED_SCORE,
  humanDayFocusAdjustment,
  humanSocialAdjustment,
  isRecentlyFailedTrip,
} from './humanLifeLogic';
import {
  assertTaixuSelfDecisionFresh,
  personaPolicyForTaixuSelf,
  type TaixuSelfCoreV1,
} from './taixuSelfCoreLogic';
import type { PersonaSelfBindingV1 } from './personaPolicyLogic';
import {
  decisionPriorityProjectionDigest,
  type DecisionPriorityProjectionV1,
} from './decisionPriorityContracts';
import {
  highestDecisionPriorityLane,
  priorityScores,
  projectDecisionCandidatePriority,
} from './decisionPriorityProjectionLogic';
import { socialConsequenceProjectionFromProposalParams } from './socialConsequenceProjectionContracts';

type CandidateEntry = {
  candidate: AutonomyCandidateV3;
  proposal?: AgentProposal;
  requestId?: string;
  personalGoalCandidate?: PersonalGoalCandidate;
  priorityProjection?: DecisionPriorityProjectionV1;
};

type BuildTraceInput = {
  context: AgentContext;
  now: number;
  selectedProposal?: AgentProposal;
  decisionSource: AutonomyDecisionSource;
  idleReasonCode?: string;
  exceptionReason?: string;
  exceptionSourceIds?: string[];
};

export type PersonaPreferredProposal = {
  proposal: AgentProposal;
  candidateId: string;
  personaFit: number;
  rank: number;
  personalGoalPlan: PersonalGoalPlan;
  exceptionReason?: string;
  exceptionSourceIds: string[];
};

export const PI_NPC_ELIGIBLE_CANDIDATE_LIMIT = 12 as const;
export const PI_NPC_SEMANTIC_TRAVEL_CANDIDATE_LIMIT = 3 as const;
export const PI_NPC_SEMANTIC_TRAVEL_MAX_DANGER_LEVEL = 2 as const;

const PI_NPC_SEMANTIC_TRAVEL_AFFORDANCES = [
  'cultivate',
  'gather',
  'rest',
  'talk',
  'trade',
  'explore',
] as const;

type PiNpcSemanticTravelAffordance = (typeof PI_NPC_SEMANTIC_TRAVEL_AFFORDANCES)[number];

export type PiNpcEligibleCandidateView = {
  candidateId: string;
  planner: string;
  intentKind: string;
  targetRef?: string;
  intent: string;
  survivalUrgency: number;
  survivalReasonCodes: string[];
  needScore: number;
  personaFit: number;
  personaReasonCodes: string[];
  commitmentUrgency: number;
  relationshipReasons: string[];
  memorySourceIds: string[];
  consequenceId?: string;
  sourceOutcomeId?: string;
  consequenceProjectionDigest?: string;
  priorityProjection?: DecisionPriorityProjectionV1;
  resourceOutlook?: PurposeResourceOutlook;
};

export type PiNpcEligibleCandidateOption = {
  candidate: AutonomyCandidateV3;
  providerView: PiNpcEligibleCandidateView;
  proposal: AgentProposal;
  proposalFingerprint: string;
  priorityProjection?: DecisionPriorityProjectionV1;
  priorityProjectionDigest?: string;
};

export type PiNpcEligibleCandidateBundle = {
  observationRevision: string;
  candidateSetDigest: string;
  candidates: PiNpcEligibleCandidateView[];
  options: PiNpcEligibleCandidateOption[];
};

export type PiNpcCandidateRevalidation =
  | {
      ok: true;
      option: PiNpcEligibleCandidateOption;
      validatedObservationRevision: string;
      candidateSetDigest: string;
    }
  | {
      ok: false;
      reasonCode:
        | 'stale_or_invalid_candidate'
        | 'self_core_stale'
        | 'candidate_projection_stale'
        | 'priority_lane_changed'
        | 'reason_factor_not_in_context';
      validatedObservationRevision?: string;
      candidateSetDigest?: string;
    };

const ORDER = {
  global: 0,
  survival: 50,
  combat: 100,
  groupDecision: 200,
  groupConversation: 220,
  conversation: 240,
  selfCare: 300,
  rest: 400,
  gather: 500,
  shop: 600,
  worldPressure: 700,
  quest: 800,
  routine: 900,
  runtime: 1000,
} as const;

export function buildAutonomyDecisionTrace(input: BuildTraceInput): AutonomyDecisionTraceV3 {
  const observationRevision = input.context.lifeObservation?.observationRevision;
  if (!observationRevision) {
    throw new Error('autonomy_trace_observation_revision_missing');
  }
  let entries = collectAutonomyCandidateEntries(input.context, input.now);
  let chosenCandidateId: string | undefined;
  let exceptionReason = input.exceptionReason;
  if (input.selectedProposal) {
    const fingerprint = proposalFingerprint(input.selectedProposal);
    const matched = entries.find(
      (entry) =>
        entry.candidate.status === 'eligible' &&
        entry.proposal &&
        proposalFingerprint(entry.proposal) === fingerprint,
    );
    if (matched) {
      chosenCandidateId = matched.candidate.candidateId;
    } else {
      const runtime = eligibleEntry(
        'runtime',
        `selected:${input.decisionSource}`,
        input.selectedProposal,
        ORDER.runtime,
      );
      entries.push(runtime);
      chosenCandidateId = runtime.candidate.candidateId;
      exceptionReason ??= 'selected_proposal_outside_shadow_planners';
    }
  }

  entries = dedupeEntries(annotateCandidatePolicies(input.context, entries)).sort(compareEntries);
  let exceptionSourceIds = uniqueSorted(input.exceptionSourceIds ?? []);
  const chosenEntry = chosenCandidateId
    ? entries.find((entry) => entry.candidate.candidateId === chosenCandidateId)
    : undefined;
  if (chosenEntry && chosenEntry.candidate.personaFit <= PERSONA_EXCEPTION_FIT_THRESHOLD) {
    const derived = derivePersonaException(input.context, chosenEntry);
    if (!derived && exceptionSourceIds.length === 0) {
      throw new Error('persona_exception_source_missing');
    }
    exceptionReason = input.exceptionReason ?? derived?.reasonCode ?? exceptionReason;
    exceptionSourceIds = uniqueSorted([...exceptionSourceIds, ...(derived?.sourceIds ?? [])]);
  }
  const total = entries.length;
  let included = entries.slice(0, AUTONOMY_CANDIDATE_LIMIT);
  if (
    chosenCandidateId &&
    !included.some((entry) => entry.candidate.candidateId === chosenCandidateId)
  ) {
    const chosen = entries.find((entry) => entry.candidate.candidateId === chosenCandidateId);
    if (chosen)
      included = [...included.slice(0, AUTONOMY_CANDIDATE_LIMIT - 1), chosen].sort(compareEntries);
  }
  const candidates = included.map((entry) => entry.candidate);
  if (
    chosenCandidateId &&
    !candidates.some((candidate) => candidate.candidateId === chosenCandidateId)
  ) {
    throw new Error('autonomy_trace_chosen_candidate_missing');
  }
  const survivalEnvelope = evaluateSurvivalEnvelope(survivalEnvelopeInput(input.context));
  const personaPolicy = personaPolicyForContext(input.context);
  return {
    contractVersion: AUTONOMY_DECISION_CONTRACT_VERSION,
    decisionId: autonomyDecisionId(input.context.self.actorId, observationRevision),
    actorId: input.context.self.actorId,
    observationRevision,
    candidates,
    chosenCandidateId,
    decisionSource: input.decisionSource,
    outcome: chosenCandidateId ? 'chosen' : 'idle',
    idleReasonCode: chosenCandidateId
      ? undefined
      : (input.idleReasonCode ?? 'no_meaningful_action'),
    exceptionReason,
    exceptionSourceIds,
    survivalEnvelope: {
      state: survivalEnvelope.state,
      urgency: survivalEnvelope.urgency,
      reasonCodes: survivalEnvelope.reasonCodes,
      decisionKind: survivalEnvelope.decision.kind,
    },
    personaPolicy,
    bounds: {
      limit: AUTONOMY_CANDIDATE_LIMIT,
      included: candidates.length,
      total,
      truncated: total > candidates.length,
    },
    createdAt: input.now,
  };
}

export function collectAutonomyCandidates(
  context: AgentContext,
  now: number,
): AutonomyCandidateV3[] {
  return collectAutonomyCandidateEntries(context, now)
    .sort(compareEntries)
    .slice(0, AUTONOMY_CANDIDATE_LIMIT)
    .map((entry) => entry.candidate);
}

export function buildPiNpcEligibleCandidateBundle(
  context: AgentContext,
  now: number,
): PiNpcEligibleCandidateBundle {
  const observationRevision = context.lifeObservation?.observationRevision;
  if (!observationRevision) {
    throw new Error('pi_npc_observation_revision_missing');
  }
  const options = piNpcPolicyBoundedOptions(
    context,
    collectAllPiNpcEligibleCandidateOptions(context, now),
    context.decisionPriorityProjectionV1 === true,
  );
  const candidates = options.map((option) => option.providerView);
  return {
    observationRevision,
    candidateSetDigest: piNpcCandidateSetDigest(options),
    candidates,
    options,
  };
}

export function collectPiNpcEligibleCandidateOptions(
  context: AgentContext,
  now: number,
): PiNpcEligibleCandidateOption[] {
  return piNpcPolicyBoundedOptions(
    context,
    collectAllPiNpcEligibleCandidateOptions(context, now),
    context.decisionPriorityProjectionV1 === true,
  );
}

export function revalidatePiNpcEligibleCandidate(input: {
  actorId: string;
  candidateId: string;
  proposalFingerprint: string;
  priorityProjectionDigest?: string;
  expectedCandidateSetDigest?: string;
  selfBinding?: PersonaSelfBindingV1;
  reasonFactorIds?: readonly string[];
  allowedReasonFactorIds?: readonly string[];
  freshContext: AgentContext;
  now: number;
}): PiNpcCandidateRevalidation {
  const validatedObservationRevision = input.freshContext.lifeObservation?.observationRevision;
  if (!validatedObservationRevision || input.freshContext.self.actorId !== input.actorId) {
    return { ok: false, reasonCode: 'stale_or_invalid_candidate' };
  }
  if (input.selfBinding) {
    try {
      assertTaixuSelfDecisionFresh(input.selfBinding, input.freshContext.stableSelfCore);
    } catch {
      return {
        ok: false,
        reasonCode: 'self_core_stale',
        validatedObservationRevision,
      };
    }
  }
  const freshOptions = collectAllPiNpcEligibleCandidateOptions(input.freshContext, input.now);
  const rawOption = freshOptions.find(
    (candidate) => candidate.candidate.candidateId === input.candidateId,
  );
  const policyOptions = piNpcPolicyBoundedOptions(
    input.freshContext,
    freshOptions,
    input.freshContext.decisionPriorityProjectionV1 === true,
  );
  const option = policyOptions.find(
    (candidate) => candidate.candidate.candidateId === input.candidateId,
  );
  const candidateSetDigest = piNpcCandidateSetDigest(policyOptions);
  const canonicalCandidateSetDigest = piNpcCanonicalCandidateSetDigest(policyOptions);
  if (
    !rawOption || rawOption.proposalFingerprint !== input.proposalFingerprint
  ) {
    return {
      ok: false,
      reasonCode: 'stale_or_invalid_candidate',
      validatedObservationRevision,
      candidateSetDigest,
    };
  }
  if (
    (input.priorityProjectionDigest !== undefined &&
      rawOption.priorityProjectionDigest !== input.priorityProjectionDigest) ||
    (input.expectedCandidateSetDigest !== undefined &&
      input.expectedCandidateSetDigest !== canonicalCandidateSetDigest)
  ) {
    return {
      ok: false,
      reasonCode: 'candidate_projection_stale',
      validatedObservationRevision,
      candidateSetDigest,
    };
  }
  if (!option) {
    return {
      ok: false,
      reasonCode:
        input.priorityProjectionDigest !== undefined ||
        input.expectedCandidateSetDigest !== undefined ||
        input.selfBinding !== undefined ||
        input.reasonFactorIds !== undefined
          ? 'priority_lane_changed'
          : 'stale_or_invalid_candidate',
      validatedObservationRevision,
      candidateSetDigest,
    };
  }
  const allowedFactors = new Set(reasonFactorsForOption(option));
  if ((input.reasonFactorIds ?? []).some((factor) => !allowedFactors.has(factor))) {
    return {
      ok: false,
      reasonCode: 'reason_factor_not_in_context',
      validatedObservationRevision,
      candidateSetDigest,
    };
  }
  return {
    ok: true,
    option,
    validatedObservationRevision,
    candidateSetDigest,
  };
}

function reasonFactorsForOption(option: PiNpcEligibleCandidateOption): string[] {
  const projection = option.priorityProjection;
  if (!projection) return [];
  const scoreBand = (value: number) => value >= 70 ? 'high' : value >= 35 ? 'medium' : 'low';
  return [
    `cause:${projection.causeKind}`,
    `why_now:${projection.whyNowCode}`,
    `urgency:${projection.urgencyBand}`,
    `delay:${scoreBand(projection.costOfDelay)}`,
    `continuity:${scoreBand(projection.goalContinuity)}`,
    `outcome:${projection.expectedOutcomeCode}`,
    ...option.candidate.personaReasonCodes.slice(0, 2).map((code) => `persona:${code}`),
  ];
}

function piNpcPolicyBoundedOptions(
  context: AgentContext,
  options: PiNpcEligibleCandidateOption[],
  priorityProjectionV1: boolean,
) {
  if (priorityProjectionV1) {
    const projected = options.map((option) => {
      if (!option.priorityProjection) {
        throw new Error('candidate_priority_projection_invalid');
      }
      return { ...option, priorityProjection: option.priorityProjection };
    });
    const highest = highestDecisionPriorityLane(projected);
    const safeHighest = highest.filter((option) =>
      !hasServerConfirmedBottomLineConflict(context, option));
    if (safeHighest.length === 0) return [];
    const safeProjected = projected.filter((option) =>
      !hasServerConfirmedBottomLineConflict(context, option));
    const bounded = firmIntentionBoundedOptions(context, safeProjected, safeHighest);
    return bounded.slice(0, PI_NPC_ELIGIBLE_CANDIDATE_LIMIT);
  }
  const mandatorySurvival = options.filter(
    (option) =>
      option.candidate.planner === 'survival' &&
      !(option.candidate.intentKind === 'attack' && option.candidate.survivalUrgency === 85),
  );
  if (mandatorySurvival.length > 0) {
    return mandatorySurvival.slice(0, PI_NPC_ELIGIBLE_CANDIDATE_LIMIT);
  }
  // Accepted/ready requests and executable group commitments are already
  // server-verified obligations. The model may choose among simultaneous hard
  // commitments, but it cannot ignore all of them in favor of a routine.
  const mandatory = options.filter((option) => option.candidate.commitmentUrgency >= 90);
  return (mandatory.length > 0 ? mandatory : options).slice(0, PI_NPC_ELIGIBLE_CANDIDATE_LIMIT);
}

function hasServerConfirmedBottomLineConflict(
  context: AgentContext,
  option: PiNpcEligibleCandidateOption,
) {
  const raw = option.proposal.params?.serverBottomLineConflictCodes;
  if (!Array.isArray(raw) || raw.length === 0) return false;
  const declared = new Set(
    raw.filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  if (declared.size === 0) return false;
  // Only a server-built proposal may carry this field. Binding it to the
  // current stable Self prevents a stale or foreign persona code from hiding
  // an otherwise legal option.
  return (context.stableSelfCore?.values.bottomLines ?? []).some(
    (bottomLine) => declared.has(bottomLine),
  );
}

function firmIntentionBoundedOptions(
  context: AgentContext,
  all: Array<PiNpcEligibleCandidateOption & {
    priorityProjection: DecisionPriorityProjectionV1;
  }>,
  highest: Array<PiNpcEligibleCandidateOption & {
    priorityProjection: DecisionPriorityProjectionV1;
  }>,
) {
  const active = context.personalGoal;
  if (!active?.purposeIntent || !active.purposeIntentDigest) return highest;
  const continuation = all.filter((option) =>
    option.priorityProjection.causeKind === 'personal_goal' &&
    option.priorityProjection.whyNowCode === 'continue_active_personal_goal' &&
    option.priorityProjection.sources.some((source) => source.sourceRef === active.sourceRef));
  // No legal continuation means the latest authoritative facts invalidated or
  // completed the intention. Do not pin a stale goal.
  if (continuation.length === 0) return highest;
  const lane = highest[0]?.priorityProjection.priorityLane;
  if (lane === 'L1_emergency') return highest;
  if (lane === 'L2_hard_obligation') {
    return active.purposeIntent.interruptionPolicy === 'hard_obligation_or_invalidated'
      ? highest
      : continuation;
  }
  if (lane === 'L3_active_intention') {
    const explicitMajorEvent = highest.filter(
      (option) => option.priorityProjection.causeKind === 'group_event',
    );
    return uniqueOptions([...continuation, ...explicitMajorEvent]);
  }
  return continuation;
}

function uniqueOptions(options: PiNpcEligibleCandidateOption[]) {
  const seen = new Set<string>();
  return options.filter((option) => {
    const candidateId = option.candidate.candidateId;
    if (seen.has(candidateId)) return false;
    seen.add(candidateId);
    return true;
  });
}

export function piNpcProposalFingerprint(actorId: string, proposal: AgentProposal) {
  const canonical = actionIdempotencyFingerprint({
    actorId,
    type: proposal.type,
    targetId: proposal.targetId,
    targetActorId: proposal.targetActorId,
    locationId: proposal.locationId,
    intent: proposal.intent,
    source: proposal.source,
    params: proposal.params,
  });
  // The idempotency representation intentionally retains complete params, but
  // a Pi receipt has a bounded digest field. SocialWarrant snapshots are
  // legitimate and can be larger than that field, so bind the full canonical
  // representation into a short deterministic identity for Pi only. Short
  // historical fingerprints remain byte-for-byte compatible.
  return Array.from(canonical).length <= 512
    ? canonical
    : `pi-npc-proposal:${stableObservationDigest(canonical)}`;
}

export function assertPiNpcCandidateFingerprintsUnique(
  candidates: readonly {
    candidateId: string;
    proposalFingerprint: string;
  }[],
) {
  const fingerprints = new Map<string, string>();
  for (const candidate of candidates) {
    const existing = fingerprints.get(candidate.candidateId);
    if (existing !== undefined && existing !== candidate.proposalFingerprint) {
      throw new Error('pi_npc_candidate_id_collision');
    }
    fingerprints.set(candidate.candidateId, candidate.proposalFingerprint);
  }
}

function collectAllPiNpcEligibleCandidateOptions(
  context: AgentContext,
  now: number,
): PiNpcEligibleCandidateOption[] {
  const actorId = context.self.actorId;
  const raw = collectAutonomyCandidateEntries(context, now, false)
    .filter(
      (
        entry,
      ): entry is CandidateEntry & {
        proposal: AgentProposal;
      } => entry.candidate.status === 'eligible' && entry.proposal !== undefined,
    )
    .sort((left, right) => comparePersonaRankWithResultHabit(context, left, right))
    .map((entry) => {
      const proposalFingerprint = piNpcProposalFingerprint(actorId, entry.proposal);
      return {
        candidate: entry.candidate,
        providerView: piNpcProviderCandidateView(
          entry.candidate,
          entry.proposal,
          entry.priorityProjection,
          purposeResourceOutlookForProposal(context, entry.proposal),
        ),
        proposal: entry.proposal,
        proposalFingerprint,
        ...(entry.priorityProjection
          ? {
              priorityProjection: entry.priorityProjection,
              priorityProjectionDigest: decisionPriorityProjectionDigest(entry.priorityProjection),
            }
          : {}),
      };
    });
  assertPiNpcCandidateFingerprintsUnique(
    raw.map((option) => ({
      candidateId: option.candidate.candidateId,
      proposalFingerprint: option.proposalFingerprint,
    })),
  );
  const byCandidateId = new Map<string, PiNpcEligibleCandidateOption>();
  for (const option of raw) {
    if (!byCandidateId.has(option.candidate.candidateId)) {
      byCandidateId.set(option.candidate.candidateId, option);
    }
  }
  return [...byCandidateId.values()];
}

function piNpcProviderCandidateView(
  candidate: AutonomyCandidateV3,
  proposal: AgentProposal,
  priorityProjection?: DecisionPriorityProjectionV1,
  resourceOutlook?: PurposeResourceOutlook,
): PiNpcEligibleCandidateView {
  return {
    candidateId: candidate.candidateId,
    planner: candidate.planner,
    intentKind: candidate.intentKind,
    targetRef: candidate.targetRef,
    intent: proposal.intent,
    survivalUrgency: candidate.survivalUrgency,
    survivalReasonCodes: [...candidate.survivalReasonCodes],
    needScore: candidate.needScore,
    personaFit: candidate.personaFit,
    personaReasonCodes: [...candidate.personaReasonCodes],
    commitmentUrgency: candidate.commitmentUrgency,
    relationshipReasons: [...candidate.relationshipReasons],
    memorySourceIds: [...candidate.memorySourceIds],
    ...(candidate.consequenceId && candidate.sourceOutcomeId && candidate.consequenceProjectionDigest
      ? {
          consequenceId: candidate.consequenceId,
          sourceOutcomeId: candidate.sourceOutcomeId,
          consequenceProjectionDigest: candidate.consequenceProjectionDigest,
        }
      : {}),
    ...(priorityProjection ? { priorityProjection } : {}),
    ...(resourceOutlook ? { resourceOutlook: { ...resourceOutlook } } : {}),
  };
}

export function piNpcCandidateSetDigest(options: readonly PiNpcEligibleCandidateOption[]) {
  return stableObservationDigest(
    options.map((option) => ({
      candidate: option.providerView,
      proposalFingerprint: option.proposalFingerprint,
    })),
  );
}

export function piNpcCanonicalCandidateSetDigest(
  options: readonly PiNpcEligibleCandidateOption[],
) {
  return stableObservationDigest(
    [...options]
      .sort((left, right) =>
        left.candidate.candidateId.localeCompare(right.candidate.candidateId) ||
        left.proposalFingerprint.localeCompare(right.proposalFingerprint))
      .map((option) => ({
        candidate: option.providerView,
        proposalFingerprint: option.proposalFingerprint,
      })),
  );
}

export function selectPersonaPreferredProposal(
  context: AgentContext,
  now: number,
): PersonaPreferredProposal | null {
  const entries = collectAutonomyCandidateEntries(context, now).filter(
    (entry) => entry.proposal && entry.candidate.status === 'eligible',
  );
  if (entries.length === 0) return null;
  const survivalPlan = planSurvivalEnvelope(context);
  if (
    survivalPlan.kind === 'act' &&
    !(
      survivalPlan.envelope.state === 'danger' &&
      survivalPlan.envelope.urgency === 85 &&
      survivalPlan.envelope.decision.kind === 'attack'
    )
  ) {
    const preferredFingerprint = proposalFingerprint(survivalPlan.proposal);
    const mandatory = entries.find(
      (entry) =>
        entry.candidate.planner === 'survival' &&
        entry.proposal &&
        (proposalFingerprint(entry.proposal) === preferredFingerprint ||
          (context.purposeBoundLifeIntentV2 === true &&
            entry.personalGoalCandidate?.purposeIntent?.purposeKind === 'recovery')),
    );
    if (mandatory?.proposal) {
      const derived =
        mandatory.candidate.personaFit <= PERSONA_EXCEPTION_FIT_THRESHOLD
          ? derivePersonaException(context, mandatory)
          : undefined;
      return {
        proposal: mandatory.proposal,
        candidateId: mandatory.candidate.candidateId,
        personaFit: mandatory.candidate.personaFit,
        rank: personaEntryRank(mandatory),
        personalGoalPlan: personalGoalPlanForEntry(context, mandatory, entries),
        exceptionReason: derived?.reasonCode,
        exceptionSourceIds: derived?.sourceIds ?? [],
      };
    }
  }
  // Rules never start a trip projected to find nothing left, nor (with human
  // life on) one that came up empty too recently, even as the last option:
  // waiting is better than a known-empty walk. The candidate stays in the
  // eligible set, so a model can still choose it on its own reading.
  const choosable = entries.filter(
    (entry) =>
      !isContendedGatherForNewChoice(context, entry.proposal) &&
      !isRecentlyFailedTrip(context, entry.proposal),
  );
  if (context.personalGoal) {
    const interrupting = choosable
      .filter((entry) => {
        if (!entry.proposal) return false;
        const candidate = personalGoalCandidateForEntry(context, entry);
        if (!candidate) return false;
        const decision = evaluatePurposeGoalReplacement({
          active: context.personalGoal!,
          selected: candidate,
        });
        return (
          decision.kind === 'replace' &&
          decision.reasonCode !== 'legacy_goal_reselected'
        );
      })
      .sort(comparePersonaRank)[0];
    if (interrupting?.proposal) {
      const derived =
        interrupting.candidate.personaFit <= PERSONA_EXCEPTION_FIT_THRESHOLD
          ? derivePersonaException(context, interrupting)
          : undefined;
      return {
        proposal: interrupting.proposal,
        candidateId: interrupting.candidate.candidateId,
        personaFit: interrupting.candidate.personaFit,
        rank: personaEntryRank(interrupting),
        personalGoalPlan: personalGoalPlanForEntry(context, interrupting, entries),
        exceptionReason: derived?.reasonCode,
        exceptionSourceIds: derived?.sourceIds ?? [],
      };
    }
    const continuing = entries
      .filter((entry) => {
        if (!entry.proposal) return false;
        return (
          personalGoalCandidateForEntry(context, entry)?.goalKey ===
          context.personalGoal?.goalKey
        );
      })
      .sort(comparePersonaRank)[0];
    if (continuing?.proposal) {
      const derived =
        continuing.candidate.personaFit <= PERSONA_EXCEPTION_FIT_THRESHOLD
          ? derivePersonaException(context, continuing)
          : undefined;
      return {
        proposal: continuing.proposal,
        candidateId: continuing.candidate.candidateId,
        personaFit: continuing.candidate.personaFit,
        rank: personaEntryRank(continuing),
        personalGoalPlan: personalGoalPlanForEntry(context, continuing, entries),
        exceptionReason: derived?.reasonCode,
        exceptionSourceIds: derived?.sourceIds ?? [],
      };
    }
  }
  entries.sort(comparePersonaRank);
  const selected = entries.find((entry) => choosable.includes(entry));
  if (!selected?.proposal) return null;
  const derived =
    selected.candidate.personaFit <= PERSONA_EXCEPTION_FIT_THRESHOLD
      ? derivePersonaException(context, selected)
      : undefined;
  if (selected.candidate.personaFit <= PERSONA_EXCEPTION_FIT_THRESHOLD && !derived) {
    return null;
  }
  return {
    proposal: selected.proposal,
    candidateId: selected.candidate.candidateId,
    personaFit: selected.candidate.personaFit,
    rank: personaEntryRank(selected),
    personalGoalPlan: personalGoalPlanForEntry(context, selected, entries),
    exceptionReason: derived?.reasonCode,
    exceptionSourceIds: derived?.sourceIds ?? [],
  };
}

export function buildPersonalGoalPlanForProposal(
  context: AgentContext,
  now: number,
  proposal: AgentProposal,
): PersonalGoalPlan {
  const entries = collectAutonomyCandidateEntries(context, now).filter(
    (entry) => entry.proposal && entry.candidate.status === 'eligible',
  );
  const fingerprint = proposalFingerprint(proposal);
  const matched = entries.find(
    (entry) => entry.proposal && proposalFingerprint(entry.proposal) === fingerprint,
  );
  if (matched) return personalGoalPlanForEntry(context, matched, entries);
  const runtimeCandidate: AutonomyCandidateV3 = {
    candidateId: candidateId('runtime', 'selected', proposal.type, proposalTargetRef(proposal)),
    planner: 'runtime',
    intentKind: proposal.type,
    targetRef: proposalTargetRef(proposal),
    status: 'eligible',
    legacyOrder: ORDER.runtime,
    survivalUrgency: 0,
    survivalReasonCodes: [],
    needScore: 0,
    personaFit: 0,
    personaReasonCodes: [],
    commitmentUrgency: 0,
    relationshipReasons: [],
    memorySourceIds: [],
  };
  const selected = personalGoalCandidateForKernel(context, {
    candidate: runtimeCandidate,
    proposal,
  });
  const rankedCandidates = entries.sort(comparePersonaRank).flatMap((entry) => {
    if (!entry.proposal) return [];
    const candidate = personalGoalCandidateForEntry(context, entry);
    return candidate ? [candidate] : [];
  });
  return {
    selected: selected ?? undefined,
    backlog: boundedPersonalGoalBacklog(rankedCandidates, selected?.goalKey),
  };
}

function personalGoalPlanForEntry(
  context: AgentContext,
  selectedEntry: CandidateEntry,
  entries: CandidateEntry[],
): PersonalGoalPlan {
  const selected = selectedEntry.proposal
    ? personalGoalCandidateForEntry(context, selectedEntry)
    : null;
  const candidates = [...entries]
    .filter((entry) => entry.proposal && entry.candidate.status === 'eligible')
    .sort(comparePersonaRank)
    .flatMap((entry) => {
      if (!entry.proposal) return [];
      const candidate = personalGoalCandidateForEntry(context, entry);
      return candidate ? [candidate] : [];
    });
  return {
    selected: selected ?? undefined,
    backlog: boundedPersonalGoalBacklog(candidates, selected?.goalKey),
  };
}

function personalGoalCandidateForEntry(
  context: AgentContext,
  entry: CandidateEntry,
) {
  if (!entry.proposal) return null;
  return personalGoalCandidateForKernel(
    context,
    { candidate: entry.candidate, proposal: entry.proposal },
    entry.personalGoalCandidate,
  );
}

export function autonomyDecisionId(actorId: string, observationRevision: string) {
  return `autonomy:${actorId}:${observationRevision}`;
}

export function autonomousAgentLlmEnabled(value: string | undefined) {
  return value === '1';
}

export function autonomyTraceSemanticFingerprint(trace: AutonomyDecisionTrace) {
  const { createdAt: _createdAt, ...semantic } = trace;
  return stableStringify(semantic);
}

export function evaluateAutonomyTraceReplay(
  existing: AutonomyDecisionTrace | null,
  incoming: AutonomyDecisionTrace,
  activeSelf?: TaixuSelfCoreV1,
): 'new' | 'replay' | 'conflict' {
  if ('personaPolicy' in incoming && incoming.personaPolicy.selfBinding) {
    if (!activeSelf) throw new Error('self_stale_decision');
    assertTaixuSelfDecisionFresh(incoming.personaPolicy.selfBinding, activeSelf);
  }
  if (!existing) return 'new';
  return existing.decisionId === incoming.decisionId &&
    existing.actorId === incoming.actorId &&
    existing.observationRevision === incoming.observationRevision &&
    autonomyTraceSemanticFingerprint(existing) === autonomyTraceSemanticFingerprint(incoming)
    ? 'replay'
    : 'conflict';
}

function collectAutonomyCandidateEntries(
  context: AgentContext,
  _now: number,
  dedupe = true,
): CandidateEntry[] {
  if (isActorIncapacitated(context.self.health)) {
    return [blockedEntry('global', 'life', ACTOR_INCAPACITATED_SKIP_REASON, ORDER.global)];
  }
  if (context.activeExecution) {
    return [
      blockedEntry(
        'global',
        'execution_gate',
        'action_execution_active',
        ORDER.global,
        `execution:${context.activeExecution.executionId}`,
      ),
    ];
  }
  const purposeBound = context.purposeBoundLifeIntentV2 === true;
  const entries = [
    ...survivalEntries(context),
    ...combatEntries(context),
    ...groupEntries(context),
    ...conversationEntries(context),
    ...selfCareEntries(context),
    ...(purposeBound
      ? [
          ...purposeBoundLifeEntries(context),
          ...worldPressureEntries(context, false),
        ]
      : [
          ...restEntries(context),
          ...gatherEntries(context),
          ...shopEntries(context),
          ...worldPressureEntries(context),
          ...questEntries(context),
          ...routineEntries(context),
          ...freeLifeEntries(context),
        ]),
  ];
  const annotated = annotateCandidatePolicies(context, entries);
  return dedupe ? dedupeEntries(annotated) : annotated;
}

function purposeBoundLifeEntries(context: AgentContext): CandidateEntry[] {
  const bundle = context.purposeBoundLifeCandidateBundle;
  if (!bundle) {
    return [
      blockedEntry(
        'routine',
        'purpose_candidate_bundle_missing',
        'purpose_candidate_bundle_missing',
        ORDER.routine,
        `actor:${context.self.actorId}`,
      ),
    ];
  }
  const entries: CandidateEntry[] = bundle.candidates.map((candidate) => ({
    ...eligibleEntry(
      candidate.planner,
      candidate.candidateId,
      candidate.proposal,
      ORDER.routine + candidate.legacyOrder,
    ),
    personalGoalCandidate: candidate.personalGoalCandidate,
  }));
  if (bundle.intentionalIdle) {
    entries.push(
      blockedEntry(
        'routine',
        `intentional_idle:${bundle.intentionalIdle.reasonCode}`,
        bundle.intentionalIdle.reasonCode,
        ORDER.routine,
        bundle.intentionalIdle.sourceRef,
      ),
    );
  }
  return entries;
}

function worldPressureEntries(
  context: AgentContext,
  includeInvestigate = true,
): CandidateEntry[] {
  const entries: CandidateEntry[] = [];
  const here = context.self.currentLocationId;
  const pressures = [...(context.worldPressures ?? [])].sort(
    (left, right) =>
      right.severity - left.severity ||
      left.endsAtGameHour - right.endsAtGameHour ||
      left.pressureId.localeCompare(right.pressureId),
  );
  for (const [index, pressure] of pressures.entries()) {
    const baseParams = {
      worldPressureId: pressure.pressureId,
      referencedFactIds: [pressure.sourceEventId],
    };
    const order = ORDER.worldPressure + index * 10;
    if (here === pressure.locationId) {
      const safeLocation = (context.knownLocations ?? [])
        .filter(
          (location) => location.locationId !== pressure.locationId && location.locationId !== here,
        )
        .sort(
          (left, right) =>
            Number(right.allowedActions.includes('rest')) -
              Number(left.allowedActions.includes('rest')) ||
            left.locationId.localeCompare(right.locationId),
        )[0];
      if (safeLocation) {
        entries.push(
          eligibleEntry(
            'world_pressure',
            `withdraw:${pressure.pressureId}`,
            {
              type: 'travel',
              targetId: safeLocation.locationId,
              locationId: here,
              params: {
                ...baseParams,
                worldPressureResponse: 'withdraw',
              },
              intent: `察觉药瘴后暂离${pressure.locationId}，前往${safeLocation.name}避险`,
              source: 'agent',
            },
            order,
          ),
        );
      }
      if (includeInvestigate && context.availableActions.includes('explore')) {
        entries.push(
          eligibleEntry(
            'world_pressure',
            `investigate:${pressure.pressureId}`,
            {
              type: 'explore',
              locationId: here,
              params: {
                ...baseParams,
                worldPressureResponse: 'investigate',
              },
              intent: `保持边界，在${pressure.locationId}调查药瘴来源与影响`,
              source: 'agent',
            },
            order + 1,
          ),
        );
      }
      const aidTarget = [...context.others]
        .filter((other) => other.relationship >= 0)
        .sort(
          (left, right) =>
            right.relationship - left.relationship || left.actorId.localeCompare(right.actorId),
        )[0];
      const aidItem = [...context.self.inventory]
        .filter((item) => item.qty > 0 && item.itemId !== 'spirit_stone')
        .sort((left, right) => left.itemId.localeCompare(right.itemId))[0];
      if (
        aidTarget &&
        aidItem &&
        context.availableActions.includes('gift') &&
        !context.giftCooldownTargetActorIds?.includes(aidTarget.actorId)
      ) {
        entries.push(
          eligibleEntry(
            'world_pressure',
            `aid:${pressure.pressureId}:${aidTarget.actorId}`,
            {
              type: 'gift',
              targetActorId: aidTarget.actorId,
              locationId: here,
              params: {
                ...baseParams,
                worldPressureResponse: 'aid',
                itemId: aidItem.itemId,
              },
              intent: `药瘴当前，拿出${aidItem.itemId}援助${aidTarget.name}`,
              source: 'agent',
            },
            order + 2,
          ),
        );
      }
      const authority = [...context.others]
        .filter((other) => ['guard', 'steward'].some((role) => other.role?.includes(role)))
        .sort((left, right) => left.actorId.localeCompare(right.actorId))[0];
      if (authority && context.availableActions.includes('talk')) {
        entries.push(
          eligibleEntry(
            'world_pressure',
            `report:${pressure.pressureId}:${authority.actorId}`,
            {
              type: 'talk',
              targetActorId: authority.actorId,
              locationId: here,
              params: {
                ...baseParams,
                worldPressureResponse: 'report',
                speechAct: 'inform',
              },
              intent: `把${pressure.locationId}的药瘴事实报告给${authority.name}`,
              source: 'agent',
            },
            order + 3,
          ),
        );
      }
    } else {
      const offer = (context.shopOffers ?? [])
        .filter((candidate) => candidate.direction === 'sell' && candidate.itemId === 'spirit_herb')
        .sort((left, right) => left.shopId.localeCompare(right.shopId))[0];
      if (offer && context.availableActions.includes('trade')) {
        entries.push(
          eligibleEntry(
            'world_pressure',
            `profit:${pressure.pressureId}:${offer.shopId}`,
            {
              type: 'trade',
              targetActorId: offer.targetActorId,
              locationId: here,
              params: {
                ...baseParams,
                worldPressureResponse: 'profit',
                offeredItemId: offer.itemId,
                offeredQty: offer.qty,
                requestedItemId: 'spirit_stone',
                requestedQty: offer.totalPrice,
              },
              intent: `药瘴令灵草恢复延迟，趁真实买价出售存货换取灵石`,
              source: 'agent',
            },
            order + 4,
          ),
        );
      }
    }
  }
  return entries;
}

function survivalEntries(context: AgentContext): CandidateEntry[] {
  const plan = planSurvivalEnvelope(context);
  if (plan.kind === 'act') {
    const purposeRecovery = context.purposeBoundLifeCandidateBundle?.candidates.find(
      (candidate) =>
        candidate.personalGoalCandidate?.purposeIntent?.purposeKind === 'recovery' &&
        candidate.proposal.type === plan.proposal.type &&
        candidate.proposal.targetId === plan.proposal.targetId &&
        candidate.proposal.locationId === plan.proposal.locationId,
    );
    if (context.purposeBoundLifeIntentV2 === true && purposeRecovery) {
      return [
        {
          ...eligibleEntry(
            'survival',
            `purpose:${purposeRecovery.candidateId}`,
            purposeRecovery.proposal,
            ORDER.survival,
          ),
          personalGoalCandidate: purposeRecovery.personalGoalCandidate,
        },
      ];
    }
    return [eligibleEntry('survival', plan.envelope.decision.kind, plan.proposal, ORDER.survival)];
  }
  if (plan.kind === 'wait') {
    return [blockedEntry('survival', plan.envelope.state, plan.reasonCode, ORDER.survival)];
  }
  return [blockedEntry('survival', 'stable', 'survival_stable', ORDER.survival)];
}

function annotateSurvivalCandidates(context: AgentContext, entries: CandidateEntry[]) {
  const survivalInput = survivalEnvelopeInput(context);
  return entries.map((entry) => {
    if (!entry.proposal) return entry;
    const assessment = survivalUrgencyForAction(survivalInput, entry.proposal.type);
    return {
      ...entry,
      candidate: {
        ...entry.candidate,
        survivalUrgency: assessment.urgency,
        survivalReasonCodes: assessment.reasonCodes,
      },
    };
  });
}

function annotateCandidatePolicies(context: AgentContext, entries: CandidateEntry[]) {
  const policy = personaPolicyForContext(context);
  return annotateSurvivalCandidates(context, entries).map((entry) => {
    const metadata = candidateMetadata(context, entry);
    const assessment = evaluatePersonaCandidate(policy, metadata.personaDescriptor);
    const priorityProjection =
      context.decisionPriorityProjectionV1 === true && entry.proposal
        ? projectDecisionCandidatePriority({
            context,
            candidateId: entry.candidate.candidateId,
            planner: entry.candidate.planner,
            proposal: entry.proposal,
          })
        : undefined;
    const projectedScores = priorityProjection ? priorityScores(priorityProjection) : undefined;
    return {
      ...entry,
      ...(priorityProjection ? { priorityProjection } : {}),
      candidate: {
        ...entry.candidate,
        needScore: projectedScores?.needScore ?? metadata.needScore,
        personaFit: assessment.personaFit,
        personaReasonCodes: assessment.reasonCodes,
        commitmentUrgency: projectedScores?.commitmentUrgency ?? metadata.commitmentUrgency,
        relationshipReasons: metadata.relationshipReasons,
        memorySourceIds: metadata.memorySourceIds,
      },
    };
  });
}

function personaPolicyForContext(context: AgentContext) {
  const stableSelfCore = context.stableSelfCore;
  return stableSelfCore
    ? personaPolicyForTaixuSelf(stableSelfCore, context.self.actorId)
    : buildPersonaPolicy(context.self.innerTrait, context.self.outerTrait);
}

function combatEntries(context: AgentContext): CandidateEntry[] {
  const combat = context.combat;
  if (!combat) return [blockedEntry('combat', 'combat', 'combat_inactive', ORDER.combat)];
  const entries: CandidateEntry[] = [];
  if (combat.activeEncounterId && combat.opponentActorId) {
    if (context.availableActions.includes('flee')) {
      entries.push(
        eligibleEntry(
          'combat',
          'flee',
          {
            type: 'flee',
            locationId: context.self.currentLocationId,
            intent:
              context.self.health <= 3
                ? `气血只余 ${context.self.health}，尝试脱离与${combat.opponentName ?? '对手'}的冲突`
                : `不愿继续无谓交锋，尝试脱离与${combat.opponentName ?? '对手'}的冲突`,
            source: 'agent',
          },
          ORDER.combat,
        ),
      );
    } else if (context.self.health <= 3) {
      entries.push(
        blockedEntry(
          'combat',
          'flee',
          'combat_flee_unavailable',
          ORDER.combat,
          `actor:${combat.opponentActorId}`,
        ),
      );
    }
    if (context.availableActions.includes('attack')) {
      entries.push(
        eligibleEntry(
          'combat',
          'attack',
          {
            type: 'attack',
            targetActorId: combat.opponentActorId,
            locationId: context.self.currentLocationId,
            intent: `仍在冲突中，继续压制${combat.opponentName ?? '对手'}`,
            source: 'agent',
          },
          ORDER.combat + 1,
        ),
      );
    }
  }
  for (const loot of combat.lootTargets) {
    for (const item of loot.items) {
      if (!loot.priorityAllowed || item.qty <= 0) continue;
      if (!context.availableActions.includes('loot')) {
        entries.push(
          blockedEntry(
            'combat',
            'loot',
            'combat_loot_unavailable',
            ORDER.combat + 2,
            `actor:${loot.actorId}:item:${item.itemId}`,
          ),
        );
        continue;
      }
      entries.push(
        eligibleEntry(
          'combat',
          `loot:${loot.actorId}:${item.itemId}`,
          {
            type: 'loot',
            targetActorId: loot.actorId,
            locationId: context.self.currentLocationId,
            intent: `从已被击倒的${loot.name}处取走一件${item.itemId}`,
            params: { itemId: item.itemId },
            source: 'agent',
          },
          ORDER.combat + 2,
        ),
      );
    }
  }
  const legacy = planCombatIntent(context);
  if (
    legacy &&
    !entries.some(
      (entry) =>
        entry.proposal && proposalFingerprint(entry.proposal) === proposalFingerprint(legacy),
    )
  ) {
    entries.push(eligibleEntry('combat', 'legacy', legacy, ORDER.combat));
  }
  return entries.length > 0
    ? entries
    : [blockedEntry('combat', 'combat', 'combat_no_legal_action', ORDER.combat)];
}

function groupEntries(context: AgentContext): CandidateEntry[] {
  const session = context.activeGroupConversation;
  if (!session) {
    const unifiedGroupCandidates = (context.purposeBoundLifeCandidateBundle?.candidates ?? []).some(
      (candidate) => candidate.planner === 'group_coordination' && candidate.proposal.type === 'group_talk',
    );
    const coordination = (unifiedGroupCandidates ? [] : context.groupSocialCoordinationProposals ?? []).map((proposal, index) => {
      const params = proposal.params ?? {};
      const operation = typeof params.operation === 'string' ? params.operation : 'coordinate';
      const reference = typeof params.initiationId === 'string'
        ? params.initiationId
        : typeof params.candidateId === 'string'
          ? params.candidateId
          : String(index);
      const response = typeof params.response === 'string' ? `:${params.response}` : '';
      return eligibleEntry(
        'group',
        `coordination:${operation}${response}:${reference}`,
        proposal,
        ORDER.groupDecision - 1 + index,
      );
    });
    if (coordination.length > 0) return coordination;
    return [
      blockedEntry('group', 'decision', 'group_session_inactive', ORDER.groupDecision),
      blockedEntry('group', 'conversation', 'group_session_inactive', ORDER.groupConversation),
    ];
  }
  const decision = planGroupDecisionIntent(context);
  const conversation = planGroupConversationTurnIntent(context);
  const entries: CandidateEntry[] = [
    decision
      ? eligibleEntry('group', 'decision', decision, ORDER.groupDecision)
      : blockedEntry(
          'group',
          'decision',
          context.activeGroupDecision?.mediationExhausted
            ? 'group_mediation_exhausted'
            : 'group_floor_or_vote_wait',
          ORDER.groupDecision,
          `group:${session.groupConversationId}`,
        ),
    conversation
      ? eligibleEntry('group', 'conversation', conversation, ORDER.groupConversation)
      : blockedEntry(
          'group',
          'conversation',
          'group_floor_or_vote_wait',
          ORDER.groupConversation,
          `group:${session.groupConversationId}`,
        ),
  ];
  return entries;
}

function conversationEntries(context: AgentContext): CandidateEntry[] {
  const session = context.activeConversation;
  if (!session) {
    return [blockedEntry('conversation', 'turn', 'conversation_inactive', ORDER.conversation)];
  }
  const negotiation = planNegotiation(context);
  if (negotiation) {
    return [eligibleEntry('conversation', 'negotiation', negotiation, ORDER.conversation)];
  }
  return [
    delegatedEntry(
      'conversation',
      'model_turn',
      ORDER.conversation,
      `conversation:${session.conversationId}`,
    ),
  ];
}

function selfCareEntries(context: AgentContext): CandidateEntry[] {
  if (!context.availableActions.includes('use_item')) {
    return [blockedEntry('self_care', 'use_item', 'self_care_action_unavailable', ORDER.selfCare)];
  }
  const maxHealth = Math.max(1, context.self.maxHealth ?? 10);
  if (context.self.health >= maxHealth || context.self.health / maxHealth > 0.5) {
    return [blockedEntry('self_care', 'use_item', 'self_care_not_needed', ORDER.selfCare)];
  }
  const items = context.self.inventory
    .filter((item) => item.qty > 0 && healingAmount(item.itemId) !== null)
    .sort((left, right) => left.itemId.localeCompare(right.itemId));
  if (items.length === 0 || !ownedHealingItemId(context.self)) {
    return [blockedEntry('self_care', 'use_item', 'healing_item_unavailable', ORDER.selfCare)];
  }
  const legacy = planSelfCareIntent(context);
  return items.map((item, index) =>
    eligibleEntry(
      'self_care',
      `use_item:${item.itemId}`,
      {
        type: 'use_item',
        params: { itemId: item.itemId },
        intent:
          legacy?.params?.itemId === item.itemId ? legacy.intent : '伤势已重，先服用疗伤物稳定气血',
        source: 'agent',
      },
      ORDER.selfCare + index,
    ),
  );
}

function restEntries(context: AgentContext): CandidateEntry[] {
  const fatigue = normalizeFatigue(context.self.fatigue);
  if (fatigue < AGENT_REST_FATIGUE_THRESHOLD) {
    return [blockedEntry('rest', 'rest', 'rest_not_needed', ORDER.rest)];
  }
  const locations = (context.knownLocations ?? [])
    .filter((location) => location.allowedActions.includes('rest'))
    .sort((left, right) => left.locationId.localeCompare(right.locationId));
  if (locations.length === 0) {
    return [blockedEntry('rest', 'rest', 'rest_location_unavailable', ORDER.rest)];
  }
  return locations.map((location, index) => {
    if (context.self.currentLocationId !== location.locationId) {
      return eligibleEntry(
        'rest',
        `travel:${location.locationId}`,
        {
          type: 'travel',
          targetId: location.locationId,
          locationId: context.self.currentLocationId,
          intent: `疲劳已达 ${fatigue}，前往${location.name}休息`,
          source: 'agent',
        },
        ORDER.rest + index,
      );
    }
    if (!context.availableActions.includes('rest')) {
      return blockedEntry(
        'rest',
        `rest:${location.locationId}`,
        'rest_action_unavailable',
        ORDER.rest + index,
        `location:${location.locationId}`,
      );
    }
    return eligibleEntry(
      'rest',
      `rest:${location.locationId}`,
      {
        type: 'rest',
        locationId: location.locationId,
        intent: `疲劳已达 ${fatigue}，在${location.name}安静休息`,
        source: 'agent',
      },
      ORDER.rest + index,
    );
  });
}

function gatherEntries(context: AgentContext): CandidateEntry[] {
  if (!context.availableActions.includes('gather')) {
    return [blockedEntry('gather', 'gather', 'gather_action_unavailable', ORDER.gather)];
  }
  const nodes = (context.resourceNodes ?? [])
    .filter((node) => node.available > 0)
    .sort((left, right) => left.resourceNodeId.localeCompare(right.resourceNodeId));
  if (nodes.length === 0) {
    const seasonallyDormant = (context.resourceNodes ?? []).some(
      (node) => node.seasonalState === 'dormant' && node.available <= 0,
    );
    return [
      blockedEntry(
        'gather',
        'gather',
        seasonallyDormant ? 'resource_season_dormant' : 'resource_node_unavailable',
        ORDER.gather,
      ),
    ];
  }
  return nodes.map((node, index) => {
    const owned = context.self.inventory.find((item) => item.itemId === node.itemId)?.qty ?? 0;
    return owned >= 1
      ? blockedEntry(
          'gather',
          `gather:${node.resourceNodeId}`,
          'resource_already_owned',
          ORDER.gather + index,
          `resource:${node.resourceNodeId}`,
        )
      : eligibleEntry(
          'gather',
          `gather:${node.resourceNodeId}`,
          {
            type: 'gather',
            locationId: context.self.currentLocationId,
            params: { resourceNodeId: node.resourceNodeId },
            intent: `行囊中尚无${node.itemId}，从${node.name}采集一份`,
            source: 'agent',
          },
          ORDER.gather + index,
        );
  });
}

function shopEntries(context: AgentContext): CandidateEntry[] {
  if (!context.availableActions.includes('trade')) {
    return [blockedEntry('shop', 'trade', 'trade_action_unavailable', ORDER.shop)];
  }
  const offers = (context.shopOffers ?? [])
    .filter((offer) => offer.direction === 'sell' && offer.itemId === 'spirit_herb')
    .sort((left, right) => left.shopId.localeCompare(right.shopId));
  if (offers.length === 0) {
    return [blockedEntry('shop', 'trade', 'shop_offer_unavailable', ORDER.shop)];
  }
  return offers.map((offer, index) =>
    eligibleEntry(
      'shop',
      `sell:${offer.shopId}:${offer.itemId}`,
      {
        type: 'trade',
        targetActorId: offer.targetActorId,
        locationId: context.self.currentLocationId,
        params: {
          offeredItemId: offer.itemId,
          offeredQty: offer.qty,
          requestedItemId: 'spirit_stone',
          requestedQty: offer.totalPrice,
        },
        intent: `将采得的${offer.itemId}卖给${offer.shopName}，换取 ${offer.totalPrice} 枚灵石`,
        source: 'agent',
      },
      ORDER.shop + index,
    ),
  );
}

function questEntries(context: AgentContext): CandidateEntry[] {
  const requests = context.activeRequests ?? [];
  if (requests.length === 0) {
    return [blockedEntry('quest', 'quest', 'quest_inactive', ORDER.quest)];
  }
  return requests
    .map((request, index) => {
      const targetRef = request.requestId
        ? `request:${request.requestId}`
        : `request:index:${index}`;
      if (request.status === 'offered') {
        if (!request.requestId || !request.issuerActorId) {
          return blockedEntry(
            'quest',
            `request:${request.requestId ?? index}`,
            'quest_offer_source_missing',
            ORDER.quest + index,
            targetRef,
          );
        }
        const issuerNearby = context.others.some(
          (other) => other.actorId === request.issuerActorId,
        );
        if (!issuerNearby) {
          return blockedEntry(
            'quest',
            `request:${request.requestId}`,
            'quest_offer_issuer_not_nearby',
            ORDER.quest + index,
            targetRef,
          );
        }
        const entries: CandidateEntry[] = [];
        if (context.availableActions.includes('accept_request')) {
          entries.push(
            eligibleEntry(
              'quest',
              `accept:${request.requestId}`,
              {
                type: 'accept_request',
                targetActorId: request.issuerActorId,
                locationId: context.self.currentLocationId,
                params: {
                  requestId: request.requestId,
                  expectedRevision: request.revision ?? 1,
                },
                intent: `权衡自身能力与性情后接受委托：${request.summary}`,
                source: 'agent',
              },
              ORDER.quest + index,
            ),
          );
        }
        if (context.availableActions.includes('decline_request')) {
          entries.push(
            eligibleEntry(
              'quest',
              `decline:${request.requestId}`,
              {
                type: 'decline_request',
                targetActorId: request.issuerActorId,
                locationId: context.self.currentLocationId,
                params: {
                  requestId: request.requestId,
                  expectedRevision: request.revision ?? 1,
                },
                intent: `权衡自身能力与性情后婉拒委托：${request.summary}`,
                source: 'agent',
              },
              ORDER.quest + index + 0.1,
            ),
          );
        }
        return entries.length > 0
          ? entries
          : blockedEntry(
              'quest',
              `request:${request.requestId}`,
              'quest_response_action_unavailable',
              ORDER.quest + index,
              targetRef,
            );
      }
      const proposal = planStrategicIntent({ ...context, activeRequests: [request] });
      return proposal
        ? {
            ...eligibleEntry(
              'quest',
              `request:${request.requestId ?? index}`,
              proposal,
              ORDER.quest + index,
            ),
            requestId: request.requestId,
          }
        : blockedEntry(
            'quest',
            `request:${request.requestId ?? index}`,
            'quest_no_legal_progress',
            ORDER.quest + index,
            targetRef,
          );
    })
    .flat();
}

function routineEntries(context: AgentContext): CandidateEntry[] {
  const entries: CandidateEntry[] = [];
  const recently = new Set(context.recentlyTalked ?? []);
  const nearby = new Set(context.others.map((other) => other.actorId));
  const cooledTargets = new Set<string>();
  for (const request of context.activeRequests ?? []) {
    if (
      request.issuerActorId &&
      nearby.has(request.issuerActorId) &&
      recently.has(request.issuerActorId)
    ) {
      cooledTargets.add(request.issuerActorId);
    }
  }
  for (const other of context.others) {
    if (other.relationship >= 25 && recently.has(other.actorId)) cooledTargets.add(other.actorId);
  }
  for (const actorId of [...cooledTargets].sort()) {
    entries.push(
      blockedEntry(
        'routine',
        `conversation:${actorId}`,
        'conversation_cooldown_active',
        ORDER.routine,
        `actor:${actorId}`,
      ),
    );
  }

  const nearbyActorIds = new Set(context.others.map((other) => other.actorId));
  const canAnswerRequest =
    context.availableActions.includes('accept_request') ||
    context.availableActions.includes('decline_request');
  const hasActionableOfferedRequest = (context.activeRequests ?? []).some(
    (request) =>
      request.status === 'offered' &&
      Boolean(request.issuerActorId) &&
      nearbyActorIds.has(request.issuerActorId!) &&
      canAnswerRequest,
  );
  if (hasActionableOfferedRequest) {
    entries.push(
      blockedEntry('routine', 'routine', 'quest_requires_explicit_choice', ORDER.routine + 1),
    );
    return entries;
  }
  const routine = planRoutineIntent(context);
  if (routine.kind === 'act') {
    entries.push(eligibleEntry('routine', 'routine', routine.proposal, ORDER.routine + 1));
  } else if (routine.kind === 'defer') {
    entries.push(delegatedEntry('routine', 'free_action', ORDER.routine + 1));
  } else {
    entries.push(blockedEntry('routine', 'routine', routine.reason, ORDER.routine + 1));
  }
  const need = findConversationNeed(context);
  if (need && !context.availableActions.includes('talk')) {
    entries.push(
      blockedEntry(
        'routine',
        `conversation:${need.targetActorId}`,
        'routine_talk_action_unavailable',
        ORDER.routine,
        `actor:${need.targetActorId}`,
      ),
    );
  }
  return entries;
}

function freeLifeEntries(context: AgentContext): CandidateEntry[] {
  if (context.activeConversation || context.activeGroupConversation) return [];
  const entries: CandidateEntry[] = [];
  const claimedTravelDestinations = new Set<string>();
  const routine = planRoutineIntent(context);
  if (routine.kind === 'act' && routine.proposal.type === 'travel' && routine.proposal.targetId) {
    claimedTravelDestinations.add(routine.proposal.targetId);
  }
  const here = context.self.currentLocationId;
  // Local lifestyle actions are meaningless without a server-resolved
  // location. Emitting one here creates a rejected ActionRecord instead of an
  // honest idle state.
  if (!here) return entries;
  const ownedHerbs = context.self.inventory.find((item) => item.itemId === 'spirit_herb')?.qty ?? 0;
  const knownMarket = (context.knownLocations ?? [])
    .filter((location) => location.allowedActions.includes('trade'))
    .sort((left, right) => left.locationId.localeCompare(right.locationId))[0];
  // A livelihood goal must be able to cross semantic locations without a
  // fixture assigning the next action. The Agent only selects a known market;
  // movement and the later quote remain server-authoritative.
  if (ownedHerbs > 0 && knownMarket && knownMarket.locationId !== here) {
    claimedTravelDestinations.add(knownMarket.locationId);
    entries.push(
      eligibleEntry(
        'livelihood',
        `sell_spirit_herb:${knownMarket.locationId}`,
        {
          type: 'travel',
          targetId: knownMarket.locationId,
          locationId: here,
          params: { livelihoodKind: 'sell_spirit_herb' },
          intent: `行囊中有灵草，前往${knownMarket.name}寻找真实买家`,
          source: 'agent',
        },
        ORDER.routine + 9,
      ),
    );
  }
  const semanticDestinations = context.stableLifeSemanticTravelV1
    ? (context.knownLocations ?? [])
        .flatMap((location) => {
          if (
            location.locationId === here ||
            claimedTravelDestinations.has(location.locationId) ||
            (location.dangerLevel ?? 0) > PI_NPC_SEMANTIC_TRAVEL_MAX_DANGER_LEVEL
          ) {
            return [];
          }
          const affordance = PI_NPC_SEMANTIC_TRAVEL_AFFORDANCES.find((action) =>
            location.allowedActions.includes(action),
          );
          return affordance ? [{ location, affordance }] : [];
        })
        .sort(
          (left, right) =>
            PI_NPC_SEMANTIC_TRAVEL_AFFORDANCES.indexOf(left.affordance) -
              PI_NPC_SEMANTIC_TRAVEL_AFFORDANCES.indexOf(right.affordance) ||
            left.location.locationId.localeCompare(right.location.locationId),
        )
        .slice(0, PI_NPC_SEMANTIC_TRAVEL_CANDIDATE_LIMIT)
    : [];
  for (const [index, destination] of semanticDestinations.entries()) {
    entries.push(
      eligibleEntry(
        'lifestyle',
        `semantic_travel:${destination.location.locationId}:${destination.affordance}`,
        {
          type: 'travel',
          targetId: destination.location.locationId,
          locationId: here,
          params: {
            lifestyleKind: 'semantic_travel',
            destinationAffordance: destination.affordance,
          },
          intent: semanticTravelIntent(destination.location.name, destination.affordance),
          source: 'agent',
        },
        ORDER.routine + 14 + index,
      ),
    );
  }
  if (context.availableActions.includes('cultivate')) {
    entries.push(
      eligibleEntry(
        'lifestyle',
        'cultivate',
        {
          type: 'cultivate',
          locationId: here,
          intent: '依自身性情安排今日修行',
          source: 'agent',
        },
        ORDER.routine + 10,
      ),
    );
  }
  if (context.availableActions.includes('explore')) {
    entries.push(
      eligibleEntry(
        'lifestyle',
        'explore',
        {
          type: 'explore',
          locationId: here,
          intent: '依自身性情观察周遭并寻找新的见闻',
          source: 'agent',
        },
        ORDER.routine + 11,
      ),
    );
  }
  const friend = [...context.others]
    .filter((other) => other.relationship >= 25)
    .sort(
      (left, right) =>
        right.relationship - left.relationship || left.actorId.localeCompare(right.actorId),
    )[0];
  if (
    friend &&
    context.availableActions.includes('gift') &&
    !context.recentlyTalked?.includes(friend.actorId) &&
    !context.giftCooldownTargetActorIds?.includes(friend.actorId)
  ) {
    const giftItem = [...context.self.inventory]
      .filter(
        (item) =>
          item.qty > 0 && item.itemId !== 'spirit_stone' && healingAmount(item.itemId) === null,
      )
      .sort((left, right) => left.itemId.localeCompare(right.itemId))[0];
    if (giftItem) {
      entries.push(
        eligibleEntry(
          'lifestyle',
          `gift:${friend.actorId}:${giftItem.itemId}`,
          {
            type: 'gift',
            targetActorId: friend.actorId,
            locationId: here,
            params: { itemId: giftItem.itemId },
            intent: `念及与${friend.name}的交情，赠予一份${giftItem.itemId}`,
            source: 'agent',
          },
          ORDER.routine + 12,
        ),
      );
    }
  }
  if (context.availableActions.includes('attack') && !context.combat?.activeEncounterId) {
    const hostile = [...context.others]
      .filter((other) => other.relationship <= -25 || (other.suspicion ?? 0) >= 40)
      .sort(
        (left, right) =>
          left.relationship - right.relationship || left.actorId.localeCompare(right.actorId),
      )[0];
    if (hostile) {
      entries.push(
        eligibleEntry(
          'lifestyle',
          `attack:${hostile.actorId}`,
          {
            type: 'attack',
            targetActorId: hostile.actorId,
            locationId: here,
            intent: `与${hostile.name}积怨已深，决定发起有限冲突`,
            source: 'agent',
          },
          ORDER.routine + 13,
        ),
      );
    }
  }
  return entries;
}

function semanticTravelIntent(locationName: string, affordance: PiNpcSemanticTravelAffordance) {
  const activity: Record<PiNpcSemanticTravelAffordance, string> = {
    cultivate: '安排日常修行',
    gather: '查看可采资源与环境',
    rest: '歇脚并调整行程',
    talk: '看看是否有人值得交谈',
    trade: '了解当前交易与补给',
    explore: '观察周遭并增长见闻',
  };
  return `前往${locationName}，${activity[affordance]}`;
}

function eligibleEntry(
  planner: string,
  variant: string,
  proposal: AgentProposal,
  legacyOrder: number,
): CandidateEntry {
  const targetRef = proposalTargetRef(proposal);
  const projectedCandidateId = candidateId(planner, variant, proposal.type, targetRef);
  const sourceProjection = socialCandidateProjectionSource(proposal);
  const consequenceProjection = socialConsequenceProjectionFromProposalParams(proposal.params);
  return {
    candidate: {
      candidateId: projectedCandidateId,
      planner,
      intentKind: proposal.type,
      targetRef,
      status: 'eligible',
      legacyOrder,
      survivalUrgency: 0,
      survivalReasonCodes: [],
      needScore: 0,
      personaFit: 0,
      personaReasonCodes: [],
      commitmentUrgency: 0,
      relationshipReasons: [],
      memorySourceIds: [],
      ...(sourceProjection
        ? {
            projectedFromCandidateId: sourceProjection.projectedFromCandidateId,
            candidateProjectionDigest: autonomyCandidateProjectionDigest({
              ...sourceProjection,
              projectedCandidateId,
            }),
          }
        : {}),
      ...(consequenceProjection
        ? {
            consequenceId: consequenceProjection.consequenceId,
            sourceOutcomeId: consequenceProjection.sourceOutcomeId,
            consequenceProjectionDigest: consequenceProjection.projectionDigest,
          }
        : {}),
    },
    proposal,
  };
}

function socialCandidateProjectionSource(proposal: AgentProposal) {
  const params = proposal.params ?? {};
  const projectedFromCandidateId = params.socialOpportunityCandidateId;
  const sourceCandidateDigest = params.socialOpportunityCandidateDigest;
  const warrantCandidateDigest = params.socialWarrantCandidateDigest;
  if (
    typeof projectedFromCandidateId !== 'string' ||
    typeof sourceCandidateDigest !== 'string' ||
    typeof warrantCandidateDigest !== 'string'
  ) {
    return undefined;
  }
  return {
    projectedFromCandidateId,
    sourceCandidateDigest,
    warrantCandidateDigest,
  };
}

function blockedEntry(
  planner: string,
  variant: string,
  blockedReasonCode: string,
  legacyOrder: number,
  targetRef?: string,
): CandidateEntry {
  return {
    candidate: {
      candidateId: candidateId(planner, variant, 'blocked', targetRef),
      planner,
      intentKind: variant,
      targetRef,
      status: 'blocked',
      blockedReasonCode,
      legacyOrder,
      survivalUrgency: blockedReasonCode === ACTOR_INCAPACITATED_SKIP_REASON ? 100 : 0,
      survivalReasonCodes:
        blockedReasonCode === ACTOR_INCAPACITATED_SKIP_REASON ? ['survival_incapacitated'] : [],
      needScore: 0,
      personaFit: 0,
      personaReasonCodes: [],
      commitmentUrgency: 0,
      relationshipReasons: [],
      memorySourceIds: [],
    },
  };
}

function delegatedEntry(
  planner: string,
  variant: string,
  legacyOrder: number,
  targetRef?: string,
): CandidateEntry {
  return {
    candidate: {
      candidateId: candidateId(planner, variant, 'delegated', targetRef),
      planner,
      intentKind: variant,
      targetRef,
      status: 'delegated',
      legacyOrder,
      survivalUrgency: 0,
      survivalReasonCodes: [],
      needScore: 0,
      personaFit: 0,
      personaReasonCodes: [],
      commitmentUrgency: 0,
      relationshipReasons: [],
      memorySourceIds: [],
    },
  };
}

function proposalTargetRef(proposal: AgentProposal): string | undefined {
  if (proposal.targetActorId) return `actor:${proposal.targetActorId}`;
  if (proposal.targetId) return `location:${proposal.targetId}`;
  const params = proposal.params ?? {};
  if (typeof params.resourceNodeId === 'string') return `resource:${params.resourceNodeId}`;
  if (typeof params.requestId === 'string') return `request:${params.requestId}`;
  if (typeof params.groupConversationId === 'string') return `group:${params.groupConversationId}`;
  if (typeof params.conversationId === 'string') return `conversation:${params.conversationId}`;
  if (typeof params.interactionId === 'string') return `interaction:${params.interactionId}`;
  if (proposal.locationId) return `location:${proposal.locationId}`;
  return undefined;
}

function candidateId(planner: string, variant: string, intentKind: string, targetRef?: string) {
  return [planner, variant, intentKind, targetRef]
    .filter((part): part is string => Boolean(part))
    .map((part) => encodeURIComponent(part))
    .join(':')
    .slice(0, 240);
}

function proposalFingerprint(proposal: AgentProposal) {
  const params = { ...(proposal.params ?? {}) };
  // Cultivation mode is a deterministic rules-layer enrichment applied after
  // the legacy planner has selected "cultivate"; it must not turn the same
  // high-level candidate into a synthetic runtime choice.
  if (proposal.type === 'cultivate') delete params.cultivationMode;
  return stableStringify({
    type: proposal.type,
    targetActorId: proposal.targetActorId,
    targetId: proposal.targetId,
    locationId: proposal.locationId,
    params,
  });
}

function candidateMetadata(
  context: AgentContext,
  entry: CandidateEntry,
): {
  needScore: number;
  commitmentUrgency: number;
  personaDescriptor: PersonaCandidateDescriptor;
  relationshipReasons: string[];
  memorySourceIds: string[];
} {
  const proposal = entry.proposal;
  if (!proposal) {
    return {
      needScore: 0,
      commitmentUrgency: 0,
      personaDescriptor: { actionType: entry.candidate.intentKind },
      relationshipReasons: [],
      memorySourceIds: [],
    };
  }
  const params = proposal.params ?? {};
  const requestId = typeof params.requestId === 'string' ? params.requestId : entry.requestId;
  const effectiveRequestId = requestId ?? entry.requestId;
  const request = effectiveRequestId
    ? context.activeRequests?.find((candidate) => candidate.requestId === effectiveRequestId)
    : undefined;
  const groupOperation = typeof params.operation === 'string' ? params.operation : undefined;
  const groupChoice = typeof params.choice === 'string' ? params.choice : undefined;
  const isActiveCombat = Boolean(context.combat?.activeEncounterId);
  const pressureResponse =
    typeof params.worldPressureResponse === 'string' ? params.worldPressureResponse : undefined;
  // A contended gather is not urgent now, even for an accepted request: there
  // is nothing to gather until the people already on the way are served. A
  // trip that came up empty too recently is treated the same way.
  const contendedGather =
    isContendedGatherForNewChoice(context, proposal) || isRecentlyFailedTrip(context, proposal);
  const commitmentUrgency = contendedGather
    ? 0
    : request?.status === 'ready_to_turn_in'
      ? 100
      : request?.status === 'accepted'
        ? 90
        : groupOperation === 'execute'
          ? 95
          : entry.candidate.planner === 'conversation'
            ? 45
            : entry.candidate.planner === 'group'
              ? 55
              : 0;
  const baseNeedScore = contendedGather
    ? RESOURCE_CONTENDED_NEED_SCORE
    : entry.candidate.planner === 'world_pressure'
      ? pressureResponse === 'withdraw'
        ? 70
        : pressureResponse === 'aid'
          ? 60
          : pressureResponse === 'investigate'
            ? 58
            : pressureResponse === 'report'
              ? 55
              : pressureResponse === 'profit'
                ? 70
                : 0
      : entry.candidate.planner === 'survival'
        ? Math.max(90, entry.candidate.survivalUrgency)
        : entry.candidate.planner === 'self_care'
          ? 90
          : entry.candidate.planner === 'rest'
            ? 70
            : entry.candidate.planner === 'combat'
              ? isActiveCombat
                ? 85
                : 25
              : entry.candidate.planner === 'group'
                ? groupOperation === 'execute'
                  ? 95
                  : 70
                : entry.candidate.planner === 'conversation'
                  ? 65
                  : entry.candidate.planner === 'quest'
                    ? request?.status === 'ready_to_turn_in'
                      ? 95
                      : request?.status === 'accepted'
                        ? 85
                        : 55
                    : entry.candidate.planner === 'shop'
                      ? params.requestedItemId === 'spirit_stone'
                        ? 65
                        : 50
                      : entry.candidate.planner === 'gather'
                        ? 45
                        : entry.candidate.planner === 'lifestyle'
                          ? proposal.type === 'cultivate'
                            ? 42
                            : proposal.type === 'gift'
                              ? 38
                              : proposal.type === 'explore'
                                ? 36
                                : 25
                          : proposal.type === 'travel'
                            ? 60
                            : proposal.type === 'talk'
                              ? 40
                              : proposal.type === 'cultivate'
                                ? 42
                                : 30;
  // Human life: going out to unwind has its own base need, what this person
  // has set their mind on today shifts every need a little, and closer people
  // are sought out first.
  const needScore = contendedGather
    ? baseNeedScore
    : Math.max(
        0,
        (entry.candidate.planner === 'leisure' ? LEISURE_NEED_SCORE : baseNeedScore) +
          humanDayFocusAdjustment(context, proposal, entry.candidate.planner) +
          humanSocialAdjustment(context, proposal),
      );
  const relationshipReasons = relationshipReasonCodes(context, proposal);
  const referencedFactIds = Array.isArray(params.referencedFactIds)
    ? params.referencedFactIds.filter((value): value is string => typeof value === 'string')
    : [];
  const knownEventIds = new Set([
    ...(context.lifeObservation?.factEventIds ?? []),
    ...(context.lifeObservation?.memories?.map((memory) => memory.sourceEventId) ?? []),
    ...(context.worldPressures?.map((pressure) => pressure.sourceEventId) ?? []),
  ]);
  const memorySourceIds = uniqueSorted(
    referencedFactIds.filter((eventId) => knownEventIds.has(eventId)),
  );
  const actionType = proposal.type;
  const pressure =
    typeof params.worldPressureId === 'string'
      ? context.worldPressures?.find((candidate) => candidate.pressureId === params.worldPressureId)
      : undefined;
  const personaDescriptor: PersonaCandidateDescriptor = {
    actionType,
    risk:
      pressureResponse === 'withdraw'
        ? 5
        : pressureResponse === 'investigate'
          ? (pressure?.severity ?? 60)
          : pressureResponse === 'aid'
            ? (pressure?.severity ?? 60)
            : actionType === 'attack' || actionType === 'steal'
              ? 80
              : actionType === 'breakthrough'
                ? 75
                : actionType === 'loot'
                  ? 50
                  : actionType === 'spar'
                    ? 35
                    : actionType === 'explore'
                      ? 20
                      : actionType === 'flee'
                        ? 5
                        : 0,
    helping:
      pressureResponse === 'aid'
        ? 100
        : actionType === 'accept_request' || actionType === 'gift'
          ? 100
          : request?.status === 'accepted' || request?.status === 'ready_to_turn_in'
            ? 70
            : groupChoice === 'approve'
              ? 75
              : actionType === 'request_teaching'
                ? 40
                : 0,
    commitment:
      request?.status === 'accepted' || request?.status === 'ready_to_turn_in'
        ? 100
        : groupOperation === 'execute'
          ? 100
          : entry.candidate.planner === 'conversation' || entry.candidate.planner === 'group'
            ? 45
            : 0,
    conflict:
      actionType === 'attack'
        ? 100
        : actionType === 'steal'
          ? 90
          : actionType === 'loot'
            ? 60
            : actionType === 'spar'
              ? 40
              : groupChoice === 'oppose'
                ? 35
                : 0,
    social:
      pressureResponse === 'report'
        ? 100
        : actionType === 'talk' ||
            actionType === 'group_talk' ||
            actionType === 'invite_social' ||
            actionType === 'respond_social_invitation'
          ? 100
          : actionType === 'gift' || actionType === 'negotiate'
            ? 80
            : [
                  'accept_request',
                  'decline_request',
                  'turn_in_request',
                  'group_decide',
                  'request_teaching',
                ].includes(actionType)
              ? 60
              : 0,
    cultivation:
      actionType === 'cultivate' || actionType === 'breakthrough'
        ? 100
        : actionType === 'request_teaching'
          ? 70
          : 0,
    persistence:
      request?.status === 'accepted' || request?.status === 'ready_to_turn_in'
        ? 100
        : groupOperation === 'execute'
          ? 100
          : isActiveCombat && (actionType === 'attack' || actionType === 'flee')
            ? 75
        : entry.candidate.planner === 'conversation' || entry.candidate.planner === 'group'
              ? 60
              : 0,
    evidence:
      pressureResponse === 'investigate' || pressureResponse === 'report'
        ? 100
        : params.speechAct === 'clarify' || typeof params.knowledgeReasonCode === 'string'
          ? 100
          : 0,
    resourceDirection:
      pressureResponse === 'profit'
        ? 'gain'
        : actionType === 'gift'
          ? 'spend'
          : actionType === 'trade' && params.requestedItemId === 'spirit_stone'
            ? 'gain'
            : actionType === 'trade' || actionType === 'cultivate'
              ? 'spend'
              : 'neutral',
    disposition:
      pressureResponse === 'withdraw'
        ? 'avoid'
        : pressureResponse
          ? 'approach'
          : actionType === 'flee'
            ? 'avoid'
            : actionType === 'accept_request'
              ? 'accept'
              : actionType === 'decline_request'
                ? 'decline'
                : request?.status === 'accepted' ||
                    request?.status === 'ready_to_turn_in' ||
                    groupOperation === 'execute' ||
                    (isActiveCombat && actionType === 'attack')
                  ? 'continue'
                  : 'approach',
  };
  return {
    needScore,
    commitmentUrgency,
    personaDescriptor,
    relationshipReasons,
    memorySourceIds,
  };
}

function relationshipReasonCodes(context: AgentContext, proposal: AgentProposal) {
  if (!proposal.targetActorId) return [];
  const relationship = context.others.find((other) => other.actorId === proposal.targetActorId);
  if (!relationship) return [];
  return [
    relationship.relationship >= 25
      ? 'relationship_affinity_important'
      : relationship.relationship <= -25
        ? 'relationship_affinity_hostile'
        : 'relationship_affinity_neutral',
    ...(relationship.trust !== undefined && relationship.trust >= 5
      ? ['relationship_trusted']
      : []),
    ...(relationship.debt !== undefined && relationship.debt >= 5
      ? ['relationship_debt_owed']
      : []),
    ...(relationship.suspicion !== undefined && relationship.suspicion >= 20
      ? ['relationship_suspicious']
      : []),
    ...(relationship.fear !== undefined && relationship.fear >= 20 ? ['relationship_feared'] : []),
  ];
}

function derivePersonaException(
  context: AgentContext,
  entry: CandidateEntry,
): { reasonCode: string; sourceIds: string[] } | null {
  const proposal = entry.proposal;
  if (!proposal) return null;
  if (entry.candidate.survivalUrgency >= 75) {
    const sourceId = context.combat?.activeEncounterId
      ? `encounter:${context.combat.activeEncounterId}`
      : `body:${context.lifeObservation?.observationRevision ?? context.self.actorId}`;
    return { reasonCode: 'survival_emergency', sourceIds: [sourceId] };
  }
  const params = proposal.params ?? {};
  const requestId = typeof params.requestId === 'string' ? params.requestId : entry.requestId;
  const request = requestId
    ? context.activeRequests?.find((candidate) => candidate.requestId === requestId)
    : undefined;
  if (requestId && (request?.status === 'accepted' || request?.status === 'ready_to_turn_in')) {
    return {
      reasonCode: 'strong_commitment',
      sourceIds: [`request:${requestId}`],
    };
  }
  const commitmentId = typeof params.commitmentId === 'string' ? params.commitmentId : undefined;
  if (commitmentId) {
    return {
      reasonCode: 'strong_commitment',
      sourceIds: [`commitment:${commitmentId}`],
    };
  }
  if (proposal.targetActorId) {
    const relationship = context.others.find((other) => other.actorId === proposal.targetActorId);
    if (
      relationship &&
      (Math.abs(relationship.relationship) >= 25 ||
        (relationship.trust ?? 0) >= 10 ||
        (relationship.debt ?? 0) >= 10 ||
        (relationship.suspicion ?? 0) >= 40)
    ) {
      return {
        reasonCode: 'important_relationship',
        sourceIds: [`relationship:${proposal.targetActorId}`],
      };
    }
  }
  if (entry.candidate.memorySourceIds.length > 0) {
    return {
      reasonCode: 'major_source_event',
      sourceIds: entry.candidate.memorySourceIds.map((eventId) => `event:${eventId}`),
    };
  }
  return null;
}

function personaEntryRank(entry: CandidateEntry) {
  return personaCandidateRank({
    needScore: entry.candidate.needScore,
    commitmentUrgency: entry.candidate.commitmentUrgency,
    personaFit: entry.candidate.personaFit,
  });
}

function comparePersonaRank(left: CandidateEntry, right: CandidateEntry) {
  return (
    personaEntryRank(right) - personaEntryRank(left) ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
}

function comparePersonaRankWithResultHabit(
  context: AgentContext,
  left: CandidateEntry,
  right: CandidateEntry,
) {
  const rankDelta = personaEntryRank(right) - personaEntryRank(left);
  if (rankDelta !== 0) return rankDelta;
  const strengthFor = (candidateId: string) =>
    context.resultHabitPreferences?.find((habit) => habit.candidateId === candidateId)
      ?.strength ?? 0;
  return (
    strengthFor(right.candidate.candidateId) - strengthFor(left.candidate.candidateId) ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function compareEntries(left: CandidateEntry, right: CandidateEntry) {
  return (
    left.candidate.legacyOrder - right.candidate.legacyOrder ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dedupeEntries(entries: CandidateEntry[]) {
  const byId = new Map<string, CandidateEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.candidate.candidateId)) byId.set(entry.candidate.candidateId, entry);
  }
  return [...byId.values()];
}
