import type { AgentContext, AgentProposal } from './agentLogic';
import type {
  ActivePersonalGoal,
  PersonalGoalPlan,
  PurposeGoalFence,
  PurposeGoalStage,
} from './personalGoalContracts';
import {
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';
import { normalizeFatigue } from './fatigueLogic';

export const PURPOSE_GOAL_CHAIN_VERSION = 'taixu.purpose-goal-chain.v2' as const;

export type PurposeGoalContinuationFailure =
  | 'purpose_goal_intent_missing'
  | 'purpose_goal_intent_digest_stale'
  | 'purpose_goal_source_missing'
  | 'purpose_goal_source_revision_stale'
  | 'purpose_goal_target_stale'
  | 'purpose_goal_activity_unavailable';

export type PurposeGoalContinuation =
  | {
      ok: true;
      candidateId: string;
      proposal: AgentProposal;
    }
  | { ok: false; reasonCode: PurposeGoalContinuationFailure };

export function purposeGoalCausalFenceMatches(input: {
  fence: PurposeGoalFence;
  goal: {
    goalId: string;
    actorId: string;
    revision: number;
    status: string;
    purposeIntent?: PurposeBoundLifeIntentV2;
    purposeIntentDigest?: string;
    purposeStage?: PurposeGoalStage;
  };
  actorId: string;
  actionType: string;
  targetId?: string;
  targetActorId?: string;
  locationId?: string;
  params?: Record<string, unknown>;
}) {
  const { fence, goal } = input;
  if (!(
    goal.actorId === input.actorId &&
      goal.status === 'active' &&
      goal.goalId === fence.goalId &&
      goal.revision === fence.revision &&
      goal.purposeIntent &&
      goal.purposeStage &&
      goal.purposeIntentDigest === fence.intentDigest &&
      purposeBoundLifeIntentDigest(goal.purposeIntent) === fence.intentDigest &&
      purposeGoalExpectedAction(goal.purposeStage, goal.purposeIntent) ===
        input.actionType
  )) {
    return false;
  }
  const intent = goal.purposeIntent!;
  if (
    goal.purposeStage === 'travel_pending' &&
    input.targetId !== intent.targetLocationId
  ) {
    return false;
  }
  if (
    goal.purposeStage !== 'travel_pending' &&
    intent.targetLocationId &&
    input.locationId !== intent.targetLocationId
  ) {
    return false;
  }
  return purposeGoalActionMatchesSource(
    intent,
    input.targetActorId,
    input.params ?? {},
  );
}

export type PurposeGoalTerminalFacts = {
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  actionType: string;
  actionRecordId: string;
  terminalEventActionId?: string;
  terminalEventType?: string;
  actor: {
    health: number;
    fatigue?: number;
    cultivationXp: number;
    currentLocationId?: string;
    inventory: readonly { itemId: string; qty: number }[];
  };
  requestStatus?: string;
};

export type PurposeGoalTerminalEvaluation =
  | { ok: true }
  | {
      ok: false;
      reasonCode:
        | 'purpose_goal_intent_digest_stale'
        | 'purpose_goal_action_mismatch'
        | 'purpose_goal_terminal_event_missing'
        | 'purpose_goal_causal_fence_mismatch'
        | 'purpose_goal_completion_unsatisfied';
    };

export function evaluatePurposeGoalArrival(input: {
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  stage: PurposeGoalStage;
  actionType: string;
  actionRecordId: string;
  terminalEventActionId?: string;
  currentLocationId?: string;
}):
  | { ok: true; nextStage: 'activity_ready' }
  | {
      ok: false;
      reasonCode:
        | 'purpose_goal_intent_digest_stale'
        | 'purpose_goal_action_mismatch'
        | 'purpose_goal_terminal_event_missing'
        | 'purpose_goal_causal_fence_mismatch'
        | 'purpose_goal_arrival_mismatch';
    } {
  const validation = validatePurposeBoundLifeIntentV2(input.intent);
  if (
    !validation.ok ||
    purposeBoundLifeIntentDigest(input.intent) !== input.intentDigest
  ) {
    return { ok: false, reasonCode: 'purpose_goal_intent_digest_stale' };
  }
  if (input.stage !== 'travel_pending' || input.actionType !== 'travel') {
    return { ok: false, reasonCode: 'purpose_goal_action_mismatch' };
  }
  if (!input.terminalEventActionId) {
    return { ok: false, reasonCode: 'purpose_goal_terminal_event_missing' };
  }
  if (input.terminalEventActionId !== input.actionRecordId) {
    return { ok: false, reasonCode: 'purpose_goal_causal_fence_mismatch' };
  }
  if (
    !input.intent.targetLocationId ||
    input.currentLocationId !== input.intent.targetLocationId
  ) {
    return { ok: false, reasonCode: 'purpose_goal_arrival_mismatch' };
  }
  return { ok: true, nextStage: 'activity_ready' };
}

export function evaluatePurposeGoalIntentionalIdle(input: {
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  stage: PurposeGoalStage;
  actorId: string;
  currentLocationId?: string;
  sourceRef: string;
}) {
  const validation = validatePurposeBoundLifeIntentV2(input.intent);
  if (
    !validation.ok ||
    purposeBoundLifeIntentDigest(input.intent) !== input.intentDigest
  ) {
    return { ok: false as const, reasonCode: 'purpose_goal_intent_digest_stale' as const };
  }
  const condition = input.intent.completionCondition;
  if (
    input.stage !== 'activity_ready' ||
    input.intent.purposeKind !== 'duty_return' ||
    input.intent.intendedActivity !== 'intentional_idle' ||
    condition.kind !== 'duty_state_confirmed'
  ) {
    return { ok: false as const, reasonCode: 'purpose_goal_action_mismatch' as const };
  }
  if (
    input.intent.sourceRef !== input.sourceRef ||
    input.sourceRef !== `duty:${input.actorId}`
  ) {
    return { ok: false as const, reasonCode: 'purpose_goal_source_missing' as const };
  }
  if (
    input.currentLocationId !== input.intent.targetLocationId ||
    input.currentLocationId !== condition.locationId
  ) {
    return { ok: false as const, reasonCode: 'purpose_goal_target_stale' as const };
  }
  return { ok: true as const };
}

export function initialPurposeGoalStage(
  intent: PurposeBoundLifeIntentV2,
  currentLocationId: string | undefined,
): PurposeGoalStage {
  return intent.targetLocationId && intent.targetLocationId !== currentLocationId
    ? 'travel_pending'
    : 'activity_pending';
}

export function purposeGoalExpectedAction(
  stage: PurposeGoalStage,
  intent: PurposeBoundLifeIntentV2,
) {
  if (stage === 'travel_pending') return 'travel';
  if (stage === 'session_pending') return '__session_terminal__';
  return intent.intendedActivity;
}

export function evaluatePurposeGoalTerminal(
  facts: PurposeGoalTerminalFacts,
): PurposeGoalTerminalEvaluation {
  const validation = validatePurposeBoundLifeIntentV2(facts.intent);
  if (
    !validation.ok ||
    purposeBoundLifeIntentDigest(facts.intent) !== facts.intentDigest
  ) {
    return { ok: false, reasonCode: 'purpose_goal_intent_digest_stale' };
  }
  if (facts.actionType !== facts.intent.intendedActivity) {
    return { ok: false, reasonCode: 'purpose_goal_action_mismatch' };
  }
  if (!facts.terminalEventActionId || !facts.terminalEventType) {
    return { ok: false, reasonCode: 'purpose_goal_terminal_event_missing' };
  }
  if (facts.terminalEventActionId !== facts.actionRecordId) {
    return { ok: false, reasonCode: 'purpose_goal_causal_fence_mismatch' };
  }
  const condition = facts.intent.completionCondition;
  let satisfied = false;
  switch (condition.kind) {
    case 'body_metric_at_or_below':
      satisfied = normalizeFatigue(facts.actor.fatigue) <= condition.threshold;
      break;
    case 'body_metric_at_or_above':
      satisfied = facts.actor.health >= condition.threshold;
      break;
    case 'cultivation_xp_at_or_above':
      satisfied = facts.actor.cultivationXp >= condition.minimumXp;
      break;
    case 'inventory_quantity_at_or_above':
      satisfied =
        itemQuantity(facts.actor.inventory, condition.itemId) >= condition.quantity;
      break;
    case 'inventory_quantity_at_or_below':
      satisfied =
        itemQuantity(facts.actor.inventory, condition.itemId) <= condition.quantity;
      break;
    case 'request_status_equals':
      satisfied = facts.requestStatus === condition.status;
      break;
    case 'interaction_event_recorded':
      satisfied = facts.actionType === condition.interactionType;
      break;
    case 'social_session_terminal':
      // A talk action only opens the durable session. personalGoals.ts owns the
      // later session-terminal fence; the opening action must never satisfy it.
      satisfied = false;
      break;
    case 'exploration_fact_recorded':
      satisfied =
        (facts.actionType === 'explore' || facts.actionType === 'inspect') &&
        facts.terminalEventType !== 'action_rejected';
      break;
    case 'duty_state_confirmed':
      satisfied =
        facts.actor.currentLocationId === condition.locationId &&
        facts.intent.intendedActivity === 'intentional_idle';
      break;
  }
  return satisfied
    ? { ok: true }
    : { ok: false, reasonCode: 'purpose_goal_completion_unsatisfied' };
}

export function evaluateSocialSessionGoalTerminal(input: {
  intent: PurposeBoundLifeIntentV2;
  intentDigest: string;
  actorId: string;
  invitationId: string;
  invitationRevision: number;
  conversation: {
    conversationId: string;
    status: string;
    actorAId: string;
    actorBId: string;
    locationId: string;
  };
  terminalEvent?: {
    conversationId?: string;
    terminalStatus?: string;
  };
}):
  | { ok: true }
  | {
      ok: false;
      reasonCode:
        | 'purpose_goal_intent_digest_stale'
        | 'purpose_goal_causal_fence_mismatch'
        | 'purpose_goal_terminal_event_missing'
        | 'purpose_goal_completion_unsatisfied';
    } {
  const validation = validatePurposeBoundLifeIntentV2(input.intent);
  if (!validation.ok || purposeBoundLifeIntentDigest(input.intent) !== input.intentDigest) {
    return { ok: false, reasonCode: 'purpose_goal_intent_digest_stale' };
  }
  const condition = input.intent.completionCondition;
  if (
    condition.kind !== 'social_session_terminal' ||
    input.intent.sourceRef !== `invitation:${input.invitationId}` ||
    input.intent.sourceRevision !== condition.expectedRevision ||
    input.intent.sourceRevision !==
      `invitation:rev:${input.invitationRevision}:${condition.warrantDigest}` ||
    condition.subjectRef !== input.intent.sourceRef ||
    ![input.conversation.actorAId, input.conversation.actorBId].includes(
      condition.targetActorId,
    ) ||
    ![input.conversation.actorAId, input.conversation.actorBId].includes(
      input.actorId,
    ) ||
    input.conversation.locationId !== input.intent.targetLocationId
  ) {
    return { ok: false, reasonCode: 'purpose_goal_causal_fence_mismatch' };
  }
  if (!input.terminalEvent) {
    return { ok: false, reasonCode: 'purpose_goal_terminal_event_missing' };
  }
  if (
    input.terminalEvent.conversationId !== input.conversation.conversationId ||
    input.terminalEvent.terminalStatus !== condition.terminalStatus
  ) {
    return { ok: false, reasonCode: 'purpose_goal_causal_fence_mismatch' };
  }
  return input.conversation.status === condition.terminalStatus
    ? { ok: true }
    : { ok: false, reasonCode: 'purpose_goal_completion_unsatisfied' };
}

export function resolvePurposeGoalContinuation(
  context: AgentContext,
  goal: ActivePersonalGoal,
): PurposeGoalContinuation {
  const intent = goal.purposeIntent;
  const digest = goal.purposeIntentDigest;
  if (!intent || !digest || goal.purposeStage !== 'activity_ready') {
    return { ok: false, reasonCode: 'purpose_goal_intent_missing' };
  }
  const validation = validatePurposeBoundLifeIntentV2(intent);
  if (!validation.ok || digest !== purposeBoundLifeIntentDigest(intent)) {
    return { ok: false, reasonCode: 'purpose_goal_intent_digest_stale' };
  }
  if (
    intent.targetLocationId &&
    context.self.currentLocationId !== intent.targetLocationId
  ) {
    return { ok: false, reasonCode: 'purpose_goal_target_stale' };
  }
  const bundle = context.purposeBoundLifeCandidateBundle;
  if (!bundle) {
    return { ok: false, reasonCode: 'purpose_goal_activity_unavailable' };
  }
  let sameSource = false;
  let sameSourceRevision = false;
  for (const candidate of bundle.candidates) {
    const proposalIntent = purposeIntentFromProposal(candidate.proposal);
    if (!proposalIntent) continue;
    if (proposalIntent.sourceRef !== intent.sourceRef) continue;
    sameSource = true;
    if (proposalIntent.sourceRevision !== intent.sourceRevision) continue;
    sameSourceRevision = true;
    const proposalDigest = purposeBoundLifeIntentDigest(proposalIntent);
    if (proposalDigest !== digest) continue;
    if (
      candidate.proposal.type !== intent.intendedActivity ||
      candidate.proposal.locationId !== context.self.currentLocationId
    ) {
      continue;
    }
    return {
      ok: true,
      candidateId: candidate.candidateId,
      proposal: candidate.proposal,
    };
  }
  if (!sameSource) {
    return { ok: false, reasonCode: 'purpose_goal_source_missing' };
  }
  if (!sameSourceRevision) {
    return { ok: false, reasonCode: 'purpose_goal_source_revision_stale' };
  }
  return { ok: false, reasonCode: 'purpose_goal_activity_unavailable' };
}

/**
 * A successful continuation has already passed the authoritative source,
 * revision, target, digest, and action checks in resolvePurposeGoalContinuation.
 * Continue that exact goal rather than asking the generic planner to rediscover
 * a host-projected purpose candidate. The generic planner intentionally rejects
 * raw purpose params, and rediscovery here could lose an otherwise valid goal.
 *
 * This is a projection only: it creates neither a new goal nor a new action.
 * The goal mutation still checks the key and purpose digest before admission.
 */
export function personalGoalPlanForPurposeGoalContinuation(input: {
  goal: ActivePersonalGoal;
  continuation: Extract<PurposeGoalContinuation, { ok: true }>;
}): PersonalGoalPlan {
  const { goal, continuation } = input;
  const intent = goal.purposeIntent;
  const digest = goal.purposeIntentDigest;
  if (!intent || !digest || goal.purposeStage !== 'activity_ready') {
    throw new Error('purpose_goal_continuation_plan_invalid_goal');
  }
  const proposalIntent = purposeIntentFromProposal(continuation.proposal);
  if (
    !proposalIntent ||
    purposeBoundLifeIntentDigest(intent) !== digest ||
    purposeBoundLifeIntentDigest(proposalIntent) !== digest ||
    continuation.proposal.type !== intent.intendedActivity
  ) {
    throw new Error('purpose_goal_continuation_plan_stale');
  }
  return {
    selected: {
      candidateId: continuation.candidateId,
      goalKey: goal.goalKey,
      kind: goal.kind,
      sourceRef: goal.sourceRef,
      targetRef: goal.targetRef,
      intent: continuation.proposal.intent.slice(0, 240),
      progressScore: goal.progressScore,
      progressKey: goal.progressKey,
      purposeIntent: intent,
      purposeIntentDigest: digest,
      purposeCadenceKey: goal.purposeCadenceKey,
    },
    backlog: goal.backlog,
  };
}

export function purposeIntentFromProposal(proposal: AgentProposal) {
  const validation = validatePurposeBoundLifeIntentV2(
    proposal.params?.purposeBoundIntent,
  );
  if (!validation.ok) return undefined;
  return proposal.params?.purposeBoundIntentDigest === validation.digest
    ? validation.intent
    : undefined;
}

function itemQuantity(
  inventory: readonly { itemId: string; qty: number }[],
  itemId: string,
) {
  return inventory.find((item) => item.itemId === itemId)?.qty ?? 0;
}

function purposeGoalActionMatchesSource(
  intent: PurposeBoundLifeIntentV2,
  targetActorId: string | undefined,
  params: Record<string, unknown>,
) {
  const separator = intent.sourceRef.indexOf(':');
  const namespace = intent.sourceRef.slice(0, separator);
  const identifier = intent.sourceRef.slice(separator + 1);
  switch (namespace) {
    case 'resource':
      return stringParam(params.resourceNodeId) === identifier;
    case 'shop':
      return stringParam(params.shopId) === identifier;
    case 'request':
      return stringParam(params.requestId) === identifier;
    case 'actor':
    case 'relationship':
      return targetActorId === identifier;
    case 'belief':
    case 'event':
    case 'consequence': {
      const warrant = recordParam(params.socialWarrant);
      const candidate = recordParam(params.socialOpportunityCandidate);
      const rawEligibleTargets = warrant?.eligibleTargetActorIds;
      const rawCandidateTargets = candidate?.targetActorIds;
      const eligibleTargets = Array.isArray(rawEligibleTargets)
        ? rawEligibleTargets.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const candidateTargets = Array.isArray(rawCandidateTargets)
        ? rawCandidateTargets.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      const socialBindingMatches = (
        warrant?.sourceRef === intent.sourceRef &&
        warrant?.sourceRevision === intent.sourceRevision &&
        !!targetActorId &&
        eligibleTargets.includes(targetActorId) &&
        candidateTargets.includes(targetActorId)
      );
      if (namespace !== 'consequence') return socialBindingMatches;
      return socialBindingMatches &&
        stringParam(params.socialConsequenceId) === identifier &&
        !!stringParam(params.socialConsequenceSourceOutcomeId) &&
        !!stringParam(params.socialConsequenceProjectionDigest);
    }
    case 'world_event': {
      const refs = Array.isArray(params.referencedFactIds)
        ? params.referencedFactIds.filter(
            (value): value is string => typeof value === 'string',
          )
        : [];
      return refs.includes(identifier);
    }
    case 'invitation': {
      const revision = params.socialInvitationRevision;
      const warrantDigest = stringParam(params.socialWarrantDigest);
      const invitedTarget = stringParam(params.socialTargetActorId);
      return (
        stringParam(params.socialInvitationId) === identifier &&
        typeof revision === 'number' &&
        Number.isSafeInteger(revision) &&
        revision > 0 &&
        intent.sourceRevision === `invitation:rev:${revision}:${warrantDigest ?? ''}` &&
        !!invitedTarget &&
        (!targetActorId || targetActorId === invitedTarget)
      );
    }
    case 'shared_plan': {
      const revision = params.sharedPlanScheduleRevision;
      const scheduleDigest = stringParam(params.sharedPlanScheduleDigest);
      const participantActorId = stringParam(params.sharedPlanParticipantActorId);
      return (
        stringParam(params.sharedPlanId) === identifier &&
        !!participantActorId &&
        intent.completionCondition.subjectRef.startsWith(`inventory:${participantActorId}:`) &&
        typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0 &&
        intent.sourceRevision === `shared-plan:${revision}:${scheduleDigest ?? ''}` &&
        !!stringParam(params.resourceNodeId)
      );
    }
    case 'body':
    case 'cultivation':
    case 'inventory':
    case 'exploration':
    case 'rumor':
    case 'duty':
      return true;
    default:
      return false;
  }
}

function stringParam(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function recordParam(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
