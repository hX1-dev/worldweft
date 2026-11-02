import { stableObservationDigest } from './lifeObservation';

export const GUARD_DUTY_AUTHORITY_ASSIGNMENT_VERSION =
  'taixu.guard-duty-assignment.v1' as const;

export type GuardDutyAuthorityPlanBinding = {
  planId: string;
  planRevision: number;
  scheduleDigest: string;
  handoffFactsDigest: string;
  participantActorId: string;
  participantRole: 'outgoing' | 'incoming';
  handoffMapId: string;
  handoffLocationId: string;
};

export type GuardDutyAuthorityAssignmentSnapshot = {
  contractVersion: typeof GUARD_DUTY_AUTHORITY_ASSIGNMENT_VERSION;
  assignmentId: string;
  assignmentRevision: number;
  actorId: string;
  status: 'active' | 'revoked';
  role: string;
  homeZoneId: string;
  dutyState: string;
  mapId: string;
  currentLocationId: string;
  aliveAndCapable: boolean;
  busy: boolean;
  validFromGameHour: number;
  validUntilGameHour: number;
  authoritySourceRef: string;
  authoritySourceRevision: string;
  authoritySourceDigest: string;
  assignmentDigest: string;
};

export function guardDutyAuthoritySourceRef(assignmentId: string, assignmentRevision: number) {
  return `guard_duty_assignment:${assignmentId}:${assignmentRevision}`;
}

export function guardDutyAuthorityAssignmentDigest(
  assignment: Omit<GuardDutyAuthorityAssignmentSnapshot, 'assignmentDigest'>,
) {
  return stableObservationDigest(assignment);
}

export function withGuardDutyAuthorityAssignmentDigest(
  assignment: Omit<GuardDutyAuthorityAssignmentSnapshot, 'assignmentDigest'>,
): GuardDutyAuthorityAssignmentSnapshot {
  return { ...assignment, assignmentDigest: guardDutyAuthorityAssignmentDigest(assignment) };
}

export function isValidGuardDutyAuthorityPlanBinding(binding: GuardDutyAuthorityPlanBinding) {
  return nonEmpty(binding.planId) && Number.isSafeInteger(binding.planRevision) && binding.planRevision >= 1 &&
    nonEmpty(binding.scheduleDigest) && nonEmpty(binding.handoffFactsDigest) &&
    nonEmpty(binding.participantActorId) && ['outgoing', 'incoming'].includes(binding.participantRole) &&
    nonEmpty(binding.handoffMapId) && nonEmpty(binding.handoffLocationId);
}

export function isValidGuardDutyAuthorityAssignment(
  assignment: GuardDutyAuthorityAssignmentSnapshot,
) {
  const { assignmentDigest: _assignmentDigest, ...semantic } = assignment;
  return assignment.contractVersion === GUARD_DUTY_AUTHORITY_ASSIGNMENT_VERSION &&
    assignment.assignmentDigest === guardDutyAuthorityAssignmentDigest(semantic) &&
    nonEmpty(assignment.assignmentId) && Number.isSafeInteger(assignment.assignmentRevision) &&
    assignment.assignmentRevision >= 1 && nonEmpty(assignment.actorId) &&
    ['active', 'revoked'].includes(assignment.status) && nonEmpty(assignment.role) &&
    nonEmpty(assignment.homeZoneId) && nonEmpty(assignment.dutyState) && nonEmpty(assignment.mapId) &&
    nonEmpty(assignment.currentLocationId) &&
    Number.isSafeInteger(assignment.validFromGameHour) && assignment.validFromGameHour >= 0 &&
    Number.isSafeInteger(assignment.validUntilGameHour) &&
    assignment.validUntilGameHour > assignment.validFromGameHour &&
    assignment.authoritySourceRef === guardDutyAuthoritySourceRef(
      assignment.assignmentId,
      assignment.assignmentRevision,
    ) && nonEmpty(assignment.authoritySourceRevision) && nonEmpty(assignment.authoritySourceDigest);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
