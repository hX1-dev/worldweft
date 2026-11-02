import type {
  ActivePersonalGoal,
  PersonalGoalCandidate,
} from './personalGoalContracts';
import type { PurposeBoundLifeIntentV2 } from './purposeBoundLifeIntentContracts';

export type PurposeGoalInterruptionClass =
  | 'ordinary'
  | 'survival'
  | 'hard_obligation'
  | 'major_event';

export type PurposeGoalReplacementDecision =
  | { kind: 'continue' }
  | {
      kind: 'replace';
      reasonCode:
        | 'higher_priority_survival'
        | 'higher_priority_hard_obligation'
        | 'higher_priority_major_event'
        | 'legacy_goal_reselected';
    }
  | { kind: 'retain'; reasonCode: 'purpose_goal_committed' };

export function purposeGoalInterruptionClass(
  candidate: PersonalGoalCandidate | undefined,
): PurposeGoalInterruptionClass {
  if (!candidate) return 'ordinary';
  if (candidate.kind === 'avoid_threat') return 'survival';
  if (!candidate.purposeIntent) {
    return candidate.kind === 'recovery' ? 'survival' : 'ordinary';
  }
  if (isHardObligationIntent(candidate.purposeIntent)) return 'hard_obligation';
  if (isMajorEventIntent(candidate.purposeIntent)) return 'major_event';
  return 'ordinary';
}

export function evaluatePurposeGoalReplacement(input: {
  active: ActivePersonalGoal;
  selected: PersonalGoalCandidate;
}): PurposeGoalReplacementDecision {
  if (input.active.goalKey === input.selected.goalKey) return { kind: 'continue' };
  if (!input.active.purposeIntent || !input.active.purposeIntentDigest) {
    return { kind: 'replace', reasonCode: 'legacy_goal_reselected' };
  }
  const interruption = purposeGoalInterruptionClass(input.selected);
  if (interruption === 'survival') {
    return { kind: 'replace', reasonCode: 'higher_priority_survival' };
  }
  if (interruption === 'major_event') {
    return { kind: 'replace', reasonCode: 'higher_priority_major_event' };
  }
  if (
    interruption === 'hard_obligation' &&
    input.active.purposeIntent.interruptionPolicy ===
      'hard_obligation_or_invalidated'
  ) {
    return { kind: 'replace', reasonCode: 'higher_priority_hard_obligation' };
  }
  return { kind: 'retain', reasonCode: 'purpose_goal_committed' };
}

export function isHardObligationIntent(intent: PurposeBoundLifeIntentV2) {
  return (
    intent.purposeKind === 'obligation' &&
    intent.sourceRef.startsWith('request:') &&
    !['accept_request', 'decline_request'].includes(intent.intendedActivity)
  );
}

export function isMajorEventIntent(intent: PurposeBoundLifeIntentV2) {
  return (
    intent.purposeKind === 'obligation' &&
    intent.sourceRef.startsWith('world_event:')
  );
}
