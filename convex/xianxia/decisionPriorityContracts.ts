import { stableObservationDigest } from './lifeObservation';

export const DECISION_PRIORITY_PROJECTION_VERSION =
  'taixu.candidate-priority-projection.v1' as const;

export const DECISION_PRIORITY_LANES = [
  'L1_emergency',
  'L2_hard_obligation',
  'L3_active_intention',
  'L4_meaningful_opportunity',
  'L5_routine',
] as const;

export type DecisionPriorityLane = (typeof DECISION_PRIORITY_LANES)[number];
export type DecisionPriorityCause =
  | 'survival'
  | 'obligation'
  | 'livelihood'
  | 'group_event'
  | 'relationship'
  | 'personal_goal'
  | 'cultivation'
  | 'exploration'
  | 'routine';

export type DecisionPrioritySource = {
  sourceRef: string;
  sourceRevision: string;
};

export type DecisionPriorityProjectionV1 = {
  contractVersion: typeof DECISION_PRIORITY_PROJECTION_VERSION;
  actorId: string;
  candidateId: string;
  priorityLane: DecisionPriorityLane;
  causeKind: DecisionPriorityCause;
  sources: DecisionPrioritySource[];
  whyNowCode: string;
  urgencyBand: 'critical' | 'important' | 'normal' | 'low';
  costOfDelay: number;
  goalContinuity: number;
  switchingCost: number;
  expectedOutcomeCode: string;
};

export function decisionPriorityLaneRank(lane: DecisionPriorityLane): number {
  return DECISION_PRIORITY_LANES.indexOf(lane);
}

export function decisionPriorityProjectionDigest(
  projection: DecisionPriorityProjectionV1,
): string {
  return stableObservationDigest(projection);
}

export function validateDecisionPriorityProjection(
  value: unknown,
): DecisionPriorityProjectionV1 {
  if (!isRecord(value) || value.contractVersion !== DECISION_PRIORITY_PROJECTION_VERSION) {
    throw new Error('candidate_priority_projection_invalid');
  }
  if (
    !bounded(value.actorId, 192) ||
    !bounded(value.candidateId, 240) ||
    !DECISION_PRIORITY_LANES.includes(value.priorityLane as DecisionPriorityLane) ||
    !bounded(value.whyNowCode, 96) ||
    !bounded(value.expectedOutcomeCode, 96) ||
    !Array.isArray(value.sources) ||
    value.sources.length === 0 ||
    value.sources.length > 4
  ) {
    throw new Error('candidate_priority_projection_invalid');
  }
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !bounded(source.sourceRef, 256) ||
      !bounded(source.sourceRevision, 192)
    ) {
      throw new Error('candidate_priority_projection_source_missing');
    }
  }
  for (const field of ['costOfDelay', 'goalContinuity', 'switchingCost'] as const) {
    const score = value[field];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error('candidate_priority_projection_invalid');
    }
  }
  return value as DecisionPriorityProjectionV1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
