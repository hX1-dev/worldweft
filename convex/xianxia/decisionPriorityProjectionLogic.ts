import type { AgentContext, AgentProposal } from './agentLogic';
import {
  DECISION_PRIORITY_PROJECTION_VERSION,
  decisionPriorityLaneRank,
  validateDecisionPriorityProjection,
  type DecisionPriorityCause,
  type DecisionPriorityLane,
  type DecisionPriorityProjectionV1,
  type DecisionPrioritySource,
} from './decisionPriorityContracts';
import { validatePurposeBoundLifeIntentV2 } from './purposeBoundLifeIntentContracts';
import {
  RESOURCE_CONTENDED_WHY_NOW_CODE,
  isContendedGatherForNewChoice,
} from './purposeResourceOutlookLogic';
import { RECENT_FAILURE_WHY_NOW_CODE, isRecentlyFailedTrip } from './humanLifeLogic';
import { validateSocialWarrant, type SocialWarrant } from './socialWarrantContracts';

export function projectDecisionCandidatePriority(input: {
  context: AgentContext;
  candidateId: string;
  planner: string;
  proposal: AgentProposal;
}): DecisionPriorityProjectionV1 {
  const { context, candidateId, planner, proposal } = input;
  const actorId = context.self.actorId;
  const params = proposal.params ?? {};
  const purpose = validatePurposeBoundLifeIntentV2(params.purposeBoundIntent);
  if (purpose.ok) {
    const active = context.personalGoal?.sourceRef === purpose.intent.sourceRef;
    const base = isContendedGatherForNewChoice(context, proposal)
      ? contendedGatherProjection(purpose.intent.purposeKind)
      : isRecentlyFailedTrip(context, proposal)
        ? {
            ...contendedGatherProjection(purpose.intent.purposeKind),
            whyNowCode: RECENT_FAILURE_WHY_NOW_CODE,
          }
        : purposeProjection(purpose.intent.purposeKind, active);
    return projection({
      actorId,
      candidateId,
      ...base,
      sources: [{
        sourceRef: purpose.intent.sourceRef,
        sourceRevision: purpose.intent.sourceRevision,
      }],
      expectedOutcomeCode: purpose.intent.completionCondition.kind,
    });
  }

  const socialWarrant = validatedWarrant(params.socialWarrant);
  if (socialWarrant) {
    const hard = socialWarrant.kind === 'active_obligation';
    return projection({
      actorId,
      candidateId,
      priorityLane: hard ? 'L2_hard_obligation' : socialLane(socialWarrant),
      causeKind: hard ? 'obligation' : socialCause(socialWarrant),
      sources: [sourceFromWarrant(socialWarrant)],
      whyNowCode: hard ? 'accepted_obligation_requires_contact' : `social_warrant:${socialWarrant.kind}`,
      urgencyBand: socialWarrant.urgencyBand === 'critical'
        ? 'critical'
        : socialWarrant.urgencyBand === 'important' ? 'important' : 'normal',
      costOfDelay: hard ? 90 : socialWarrant.urgencyBand === 'important' ? 70 : 35,
      goalContinuity: hard ? 90 : 35,
      switchingCost: hard ? 60 : 20,
      expectedOutcomeCode: socialWarrant.intendedOutcome,
    });
  }

  const groupSource = groupSourceFromParams(params);
  if (groupSource) {
    const active = groupSource.operation !== 'invite';
    const lane = active
      ? 'L3_active_intention'
      : groupSource.sourceKind === 'shared_request'
        ? 'L2_hard_obligation'
        : groupSource.sourceKind === 'duty_meeting'
          ? 'L5_routine'
          : 'L3_active_intention';
    return projection({
      actorId,
      candidateId,
      priorityLane: lane,
      causeKind: groupSource.sourceKind === 'shared_request' ? 'obligation' : 'group_event',
      sources: [{ sourceRef: groupSource.sourceRef, sourceRevision: groupSource.sourceRevision }],
      whyNowCode: active ? 'active_group_coordination' : `group_source:${groupSource.sourceKind}`,
      urgencyBand: lane === 'L2_hard_obligation' ? 'important' : lane === 'L5_routine' ? 'low' : 'important',
      costOfDelay: lane === 'L2_hard_obligation' ? 85 : lane === 'L5_routine' ? 15 : 70,
      goalContinuity: active ? 90 : 55,
      switchingCost: active ? 70 : 35,
      expectedOutcomeCode: 'reach_group_decision',
    });
  }

  const activeRequest = activeRequestFromProposal(context, params);
  if (activeRequest) {
    return projection({
      actorId,
      candidateId,
      priorityLane: 'L2_hard_obligation',
      causeKind: 'obligation',
      sources: [{
        sourceRef: `request:${activeRequest.requestId}`,
        sourceRevision: `request:${activeRequest.requestId}:rev:${activeRequest.revision ?? 1}`,
      }],
      whyNowCode: activeRequest.status === 'ready_to_turn_in'
        ? 'accepted_obligation_ready_to_turn_in'
        : 'accepted_obligation_active',
      urgencyBand: 'important',
      costOfDelay: 90,
      goalContinuity: 90,
      switchingCost: 60,
      expectedOutcomeCode: proposal.type,
    });
  }

  if (planner === 'survival' || planner === 'self_care' || planner === 'combat') {
    return projection({
      actorId,
      candidateId,
      priorityLane: 'L1_emergency',
      causeKind: 'survival',
      sources: [observationSource(context, candidateId)],
      whyNowCode: 'survival_envelope_active',
      urgencyBand: 'critical',
      costOfDelay: 100,
      goalContinuity: 100,
      switchingCost: 100,
      expectedOutcomeCode: proposal.type,
    });
  }

  const activeGoal = context.personalGoal;
  if (activeGoal && proposalMatchesActiveGoal(proposal, activeGoal.sourceRef)) {
    return projection({
      actorId,
      candidateId,
      priorityLane: 'L3_active_intention',
      causeKind: 'personal_goal',
      sources: [{ sourceRef: activeGoal.sourceRef, sourceRevision: `goal:rev:${activeGoal.revision}` }],
      whyNowCode: 'continue_active_personal_goal',
      urgencyBand: 'normal',
      costOfDelay: 55,
      goalContinuity: 100,
      switchingCost: 70,
      expectedOutcomeCode: activeGoal.progressKey,
    });
  }

  const lane: DecisionPriorityLane = planner === 'routine' ? 'L5_routine' : 'L4_meaningful_opportunity';
  return projection({
    actorId,
    candidateId,
    priorityLane: lane,
    causeKind: fallbackCause(planner, proposal),
    sources: [observationSource(context, candidateId)],
    whyNowCode: planner === 'gather' ? 'resource_available_without_pressing_need' : 'eligible_world_opportunity',
    urgencyBand: lane === 'L5_routine' ? 'low' : 'normal',
    costOfDelay: lane === 'L5_routine' ? 10 : 30,
    goalContinuity: 20,
    switchingCost: 10,
    expectedOutcomeCode: proposal.type,
  });
}

export function highestDecisionPriorityLane<T extends { priorityProjection: DecisionPriorityProjectionV1 }>(
  options: readonly T[],
): T[] {
  if (options.length === 0) return [];
  const rank = Math.min(...options.map((option) =>
    decisionPriorityLaneRank(validateDecisionPriorityProjection(option.priorityProjection).priorityLane)));
  return options.filter((option) => decisionPriorityLaneRank(option.priorityProjection.priorityLane) === rank);
}

export function priorityScores(projection: DecisionPriorityProjectionV1): {
  needScore: number;
  commitmentUrgency: number;
} {
  switch (projection.priorityLane) {
    case 'L1_emergency': return { needScore: 100, commitmentUrgency: 0 };
    case 'L2_hard_obligation': return { needScore: 75, commitmentUrgency: 100 };
    case 'L3_active_intention': return { needScore: 70, commitmentUrgency: 70 };
    case 'L4_meaningful_opportunity': return { needScore: 40, commitmentUrgency: 0 };
    case 'L5_routine': return { needScore: 20, commitmentUrgency: 0 };
  }
}

function purposeProjection(
  purposeKind: string,
  active: boolean,
): Omit<DecisionPriorityProjectionV1, 'contractVersion' | 'actorId' | 'candidateId' | 'sources' | 'expectedOutcomeCode'> {
  if (purposeKind === 'recovery') return {
    priorityLane: 'L1_emergency', causeKind: 'survival', whyNowCode: 'body_recovery_required',
    urgencyBand: 'critical', costOfDelay: 100, goalContinuity: 100, switchingCost: 100,
  };
  if (purposeKind === 'obligation') return {
    priorityLane: 'L2_hard_obligation', causeKind: 'obligation', whyNowCode: 'accepted_obligation_active',
    urgencyBand: 'important', costOfDelay: 90, goalContinuity: 90, switchingCost: 60,
  };
  if (active) return {
    priorityLane: 'L3_active_intention', causeKind: 'personal_goal', whyNowCode: 'continue_active_personal_goal',
    urgencyBand: 'normal', costOfDelay: 60, goalContinuity: 100, switchingCost: 70,
  };
  if (purposeKind === 'duty_return') return {
    priorityLane: 'L5_routine', causeKind: 'routine', whyNowCode: 'routine_duty_return',
    urgencyBand: 'low', costOfDelay: 15, goalContinuity: 25, switchingCost: 10,
  };
  const causeKind: DecisionPriorityCause = purposeKind === 'livelihood'
    ? 'livelihood' : purposeKind === 'cultivation' ? 'cultivation'
      : purposeKind === 'relationship' ? 'relationship' : 'exploration';
  return {
    priorityLane: 'L4_meaningful_opportunity', causeKind,
    whyNowCode: purposeKind === 'livelihood' ? 'resource_available_without_pressing_need' : `eligible_${purposeKind}_opportunity`,
    urgencyBand: 'normal', costOfDelay: 30, goalContinuity: 30, switchingCost: 15,
  };
}

// Nothing is projected to be left on arrival, so the trip waits behind routine
// life even when it serves an accepted request.
function contendedGatherProjection(
  purposeKind: string,
): Omit<DecisionPriorityProjectionV1, 'contractVersion' | 'actorId' | 'candidateId' | 'sources' | 'expectedOutcomeCode'> {
  return {
    priorityLane: 'L5_routine',
    causeKind: purposeKind === 'obligation' ? 'obligation' : 'livelihood',
    whyNowCode: RESOURCE_CONTENDED_WHY_NOW_CODE,
    urgencyBand: 'low', costOfDelay: 5, goalContinuity: 20, switchingCost: 10,
  };
}

function validatedWarrant(input: unknown): SocialWarrant | undefined {
  const result = validateSocialWarrant(input);
  return result.ok ? result.warrant : undefined;
}

function sourceFromWarrant(warrant: SocialWarrant): DecisionPrioritySource {
  return { sourceRef: warrant.sourceRef, sourceRevision: warrant.sourceRevision };
}

function socialLane(warrant: SocialWarrant): DecisionPriorityLane {
  return warrant.urgencyBand === 'critical' ? 'L1_emergency' : 'L4_meaningful_opportunity';
}

function socialCause(warrant: SocialWarrant): DecisionPriorityCause {
  return warrant.kind === 'care_or_aid' ? 'survival' : 'relationship';
}

function groupSourceFromParams(params: Record<string, unknown>) {
  const sourceKind = params.groupSourceKind;
  const sourceRef = params.groupSourceRef;
  const sourceRevision = params.groupSourceRevision;
  const operation = typeof params.operation === 'string' ? params.operation : 'invite';
  if (
    !['shared_request', 'shared_event', 'resource_dispute', 'duty_meeting', 'active_initiation'].includes(String(sourceKind)) ||
    typeof sourceRef !== 'string' || !sourceRef ||
    typeof sourceRevision !== 'string' || !sourceRevision
  ) return undefined;
  return { sourceKind: String(sourceKind), sourceRef, sourceRevision, operation };
}

function activeRequestFromProposal(
  context: AgentContext,
  params: Record<string, unknown>,
) {
  const requestId = params.requestId;
  if (typeof requestId !== 'string' || !requestId) return undefined;
  return context.activeRequests?.find((request) =>
    request.requestId === requestId &&
    (request.status === 'accepted' || request.status === 'ready_to_turn_in'));
}

function observationSource(context: AgentContext, candidateId: string): DecisionPrioritySource {
  const revision = context.lifeObservation?.observationRevision;
  if (!revision) throw new Error('candidate_priority_projection_source_missing');
  return { sourceRef: `candidate:${candidateId}`, sourceRevision: revision };
}

function proposalMatchesActiveGoal(proposal: AgentProposal, sourceRef: string): boolean {
  const params = proposal.params ?? {};
  return params.sourceRef === sourceRef || params.requestId === sourceRef.replace(/^request:/, '');
}

function fallbackCause(planner: string, proposal: AgentProposal): DecisionPriorityCause {
  if (planner === 'gather' || planner === 'shop') return 'livelihood';
  if (planner === 'conversation' || planner === 'social_warrant' || proposal.type === 'talk') return 'relationship';
  if (proposal.type === 'cultivate') return 'cultivation';
  if (proposal.type === 'explore') return 'exploration';
  return planner === 'routine' ? 'routine' : 'personal_goal';
}

function projection(
  input: Omit<DecisionPriorityProjectionV1, 'contractVersion'>,
): DecisionPriorityProjectionV1 {
  return validateDecisionPriorityProjection({
    contractVersion: DECISION_PRIORITY_PROJECTION_VERSION,
    ...input,
  });
}
