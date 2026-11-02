import type { AgentContext, AgentProposal } from './agentLogic';
import { normalizeFatigue, HEAVY_ACTION_FATIGUE_THRESHOLD } from './fatigueLogic';
import type {
  ActivePersonalGoal,
  PersonalGoalCandidate,
  PurposeGoalCadenceWindow,
} from './personalGoalContracts';
import {
  purposeBoundLifeIntentDigest,
  validatePurposeBoundLifeIntentV2,
  type PurposeBoundIntendedActivity,
  type PurposeBoundLifeIntentV2,
} from './purposeBoundLifeIntentContracts';
import { stableObservationDigest } from './lifeObservation';
import { purposeGoalInterruptionClass } from './purposeGoalReplacementLogic';

export {
  evaluatePurposeGoalReplacement,
  isHardObligationIntent,
  isMajorEventIntent,
  purposeGoalInterruptionClass,
} from './purposeGoalReplacementLogic';
export type {
  PurposeGoalInterruptionClass,
  PurposeGoalReplacementDecision,
} from './purposeGoalReplacementLogic';

export const PURPOSE_GOAL_CADENCE_VERSION = 'taixu.purpose-goal-cadence.v1' as const;
export const PURPOSE_GOAL_CADENCE_HISTORY_LIMIT = 32 as const;

export type ActivePurposeGoalResolution =
  | {
      ok: true;
      candidateId: string;
      proposal: AgentProposal;
    }
  | {
      ok: false;
      reasonCode:
        | 'purpose_goal_intent_missing'
        | 'purpose_goal_intent_digest_stale'
        | 'purpose_goal_source_missing'
        | 'purpose_goal_source_revision_stale'
        | 'purpose_goal_target_stale'
        | 'purpose_goal_activity_unavailable';
    };

const COMPLETED_COOLDOWN_HOURS: Record<PurposeBoundIntendedActivity, number> = {
  accept_request: 0,
  decline_request: 0,
  turn_in_request: 0,
  rest: 1,
  trade: 1,
  cultivate: 2,
  gather: 2,
  intentional_idle: 4,
  explore: 6,
  inspect: 6,
  talk: 12,
  gift: 12,
  request_teaching: 12,
  use_item: 1,
};

export function purposeGoalCadenceKey(intent: PurposeBoundLifeIntentV2) {
  return `purpose_cadence:${stableObservationDigest({
    contractVersion: PURPOSE_GOAL_CADENCE_VERSION,
    purposeKind: intent.purposeKind,
    sourceRef: intent.sourceRef,
    intendedActivity: intent.intendedActivity,
    completionIdentity: completionIdentity(intent),
  })}`;
}

export function purposeGoalCooldownHours(input: {
  intent: PurposeBoundLifeIntentV2;
  terminalStatus: 'completed' | 'cancelled' | 'failed' | 'expired';
  reasonCode: string;
}) {
  if (input.terminalStatus === 'completed') {
    return COMPLETED_COOLDOWN_HOURS[input.intent.intendedActivity];
  }
  if (
    input.reasonCode === 'higher_priority_survival' ||
    input.reasonCode === 'higher_priority_hard_obligation' ||
    input.reasonCode === 'higher_priority_major_event' ||
    input.reasonCode.includes('source_') ||
    input.reasonCode.includes('target_stale') ||
    input.reasonCode.includes('activity_unavailable')
  ) {
    return 0;
  }
  if (input.terminalStatus === 'expired') return 2;
  return 1;
}

export function evaluatePurposeGoalCadence(input: {
  candidate: PersonalGoalCandidate;
  currentGameHour: number;
  windows: readonly PurposeGoalCadenceWindow[];
  activeGoal?: ActivePersonalGoal;
  fatigue?: number;
}) {
  const cadenceKey = input.candidate.purposeCadenceKey;
  if (!cadenceKey || !input.candidate.purposeIntent) {
    return { allowed: true as const, reasonCode: 'purpose_goal_cadence_not_applicable' as const };
  }
  if (input.activeGoal?.purposeCadenceKey === cadenceKey) {
    return { allowed: true as const, reasonCode: 'purpose_goal_continuation' as const };
  }
  const sameSnapshotFailure = [...input.windows]
    .filter(
      (window) =>
        window.cadenceKey === cadenceKey &&
        window.sourceRevision === input.candidate.purposeIntent?.sourceRevision &&
        window.terminalStatus === 'failed',
    )
    .sort(
      (left, right) =>
        right.terminalGameHour - left.terminalGameHour ||
        right.goalId.localeCompare(left.goalId),
    )[0];
  const urgentRecovery =
    input.candidate.purposeIntent.purposeKind === 'recovery' &&
    normalizeFatigue(input.fatigue) >= HEAVY_ACTION_FATIGUE_THRESHOLD;
  if (sameSnapshotFailure && !urgentRecovery) {
    return {
      allowed: false as const,
      reasonCode: 'purpose_goal_cadence_wait' as const,
      cadenceKey,
      priorGoalId: sameSnapshotFailure.goalId,
      // A failed goal may only be recreated from a changed authoritative
      // source revision. Use a finite sentinel so observation digests remain
      // valid while event-driven wakeups can still rebuild a fresh candidate.
      nextEligibleGameHour: Number.MAX_SAFE_INTEGER,
    };
  }
  const blocking = [...input.windows]
    .filter(
      (window) =>
        window.cadenceKey === cadenceKey &&
        window.nextEligibleGameHour > input.currentGameHour,
    )
    .sort(
      (left, right) =>
        right.nextEligibleGameHour - left.nextEligibleGameHour ||
        right.terminalGameHour - left.terminalGameHour,
    )[0];
  if (!blocking) {
    return { allowed: true as const, reasonCode: 'purpose_goal_cadence_ready' as const };
  }
  const interruption = purposeGoalInterruptionClass(input.candidate);
  if (interruption === 'survival' || interruption === 'hard_obligation' || interruption === 'major_event') {
    return { allowed: true as const, reasonCode: `purpose_goal_cadence_bypass_${interruption}` as const };
  }
  if (
    input.candidate.purposeIntent.purposeKind === 'recovery' &&
    normalizeFatigue(input.fatigue) >= HEAVY_ACTION_FATIGUE_THRESHOLD
  ) {
    return { allowed: true as const, reasonCode: 'purpose_goal_cadence_bypass_need' as const };
  }
  return {
    allowed: false as const,
    reasonCode: 'purpose_goal_cadence_wait' as const,
    cadenceKey,
    priorGoalId: blocking.goalId,
    nextEligibleGameHour: blocking.nextEligibleGameHour,
  };
}

export function resolveActivePurposeGoal(
  context: AgentContext,
  goal: ActivePersonalGoal,
): ActivePurposeGoalResolution {
  const intent = goal.purposeIntent;
  const digest = goal.purposeIntentDigest;
  if (!intent || !digest || !goal.purposeStage) {
    return { ok: false, reasonCode: 'purpose_goal_intent_missing' };
  }
  const validation = validatePurposeBoundLifeIntentV2(intent);
  if (!validation.ok || digest !== purposeBoundLifeIntentDigest(intent)) {
    return { ok: false, reasonCode: 'purpose_goal_intent_digest_stale' };
  }
  if (
    intent.targetLocationId &&
    !context.knownLocations?.some(
      (location) => location.locationId === intent.targetLocationId,
    )
  ) {
    return { ok: false, reasonCode: 'purpose_goal_target_stale' };
  }
  if (
    goal.purposeStage !== 'travel_pending' &&
    intent.targetLocationId &&
    context.self.currentLocationId !== intent.targetLocationId
  ) {
    return { ok: false, reasonCode: 'purpose_goal_target_stale' };
  }
  const expectedAction =
    goal.purposeStage === 'travel_pending' ? 'travel' : intent.intendedActivity;
  let sameSource = false;
  let sameSourceRevision = false;
  let sameTarget = false;
  for (const candidate of context.purposeBoundLifeCandidateBundle?.candidates ?? []) {
    const projected = projectedCandidate(candidate);
    const candidateIntent = projected?.purposeIntent;
    if (!candidateIntent) continue;
    if (candidateIntent.sourceRef !== intent.sourceRef) continue;
    sameSource = true;
    if (candidateIntent.sourceRevision !== intent.sourceRevision) continue;
    sameSourceRevision = true;
    if (candidateIntent.targetLocationId !== intent.targetLocationId) continue;
    sameTarget = true;
    if (
      projected?.purposeIntentDigest !== digest ||
      candidate.proposal.type !== expectedAction
    ) {
      continue;
    }
    return {
      ok: true,
      candidateId: candidate.candidateId,
      proposal: candidate.proposal,
    };
  }
  if (!sameSource) return { ok: false, reasonCode: 'purpose_goal_source_missing' };
  if (!sameSourceRevision) {
    return { ok: false, reasonCode: 'purpose_goal_source_revision_stale' };
  }
  if (!sameTarget) return { ok: false, reasonCode: 'purpose_goal_target_stale' };
  return { ok: false, reasonCode: 'purpose_goal_activity_unavailable' };
}

export function purposeGoalRevalidationDeferredBySession(context: AgentContext) {
  return Boolean(context.activeConversation || context.activeGroupConversation);
}

export function purposeGoalInterruptionForProposal(input: {
  context: AgentContext;
  proposal: AgentProposal;
  selected?: PersonalGoalCandidate;
}):
  | {
      reasonCode:
        | 'higher_priority_survival'
        | 'higher_priority_hard_obligation'
        | 'higher_priority_major_event';
      sourceRef: string;
    }
  | undefined {
  const classified = purposeGoalInterruptionClass(input.selected);
  if (classified === 'hard_obligation' && input.selected) {
    return {
      reasonCode: 'higher_priority_hard_obligation',
      sourceRef: input.selected.sourceRef,
    };
  }
  if (classified === 'major_event' && input.selected) {
    return {
      reasonCode: 'higher_priority_major_event',
      sourceRef: input.selected.sourceRef,
    };
  }
  if (classified === 'survival' && input.selected) {
    return {
      reasonCode: 'higher_priority_survival',
      sourceRef: input.selected.sourceRef,
    };
  }
  if (
    (input.proposal.type === 'attack' || input.proposal.type === 'flee') &&
    input.context.combat?.activeEncounterId
  ) {
    return {
      reasonCode: 'higher_priority_survival',
      sourceRef: `encounter:${input.context.combat.activeEncounterId}`,
    };
  }
  if (
    input.proposal.type === 'use_item' &&
    input.context.self.health <= Math.max(1, input.context.self.maxHealth ?? 10) / 2
  ) {
    return {
      reasonCode: 'higher_priority_survival',
      sourceRef: `body:${input.context.self.actorId}`,
    };
  }
  return undefined;
}

function projectedCandidate(candidate: {
  proposal: AgentProposal;
  personalGoalCandidate?: PersonalGoalCandidate;
}) {
  if (candidate.personalGoalCandidate?.purposeIntent) {
    return candidate.personalGoalCandidate;
  }
  const rawIntent = candidate.proposal.params?.purposeBoundIntent;
  const validation = validatePurposeBoundLifeIntentV2(rawIntent);
  const rawDigest = candidate.proposal.params?.purposeBoundIntentDigest;
  if (!validation.ok || rawDigest !== validation.digest) return undefined;
  return {
    purposeIntent: validation.intent,
    purposeIntentDigest: validation.digest,
  };
}

function completionIdentity(intent: PurposeBoundLifeIntentV2) {
  const condition = intent.completionCondition;
  switch (condition.kind) {
    case 'body_metric_at_or_below':
    case 'body_metric_at_or_above':
      return { kind: condition.kind, metric: condition.metric };
    case 'cultivation_xp_at_or_above':
      return { kind: condition.kind };
    case 'inventory_quantity_at_or_above':
    case 'inventory_quantity_at_or_below':
      return { kind: condition.kind, itemId: condition.itemId };
    case 'request_status_equals':
      return { kind: condition.kind, status: condition.status };
    case 'interaction_event_recorded':
      return { kind: condition.kind, interactionType: condition.interactionType };
    case 'exploration_fact_recorded':
      return { kind: condition.kind, factRef: condition.factRef };
    case 'duty_state_confirmed':
      return { kind: condition.kind, dutyState: condition.dutyState };
  }
}
