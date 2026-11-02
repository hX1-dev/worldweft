import { stableObservationDigest } from './lifeObservation';
import {
  withGuardHandoffAuthorityReceiptDigest,
  type GuardHandoffAuthorityFact,
  type GuardHandoffParticipantAuthorityReceipt,
} from './guardHandoffParticipantAdmissionContracts';
import {
  isValidGuardDutyAuthorityAssignment,
  isValidGuardDutyAuthorityPlanBinding,
  type GuardDutyAuthorityAssignmentSnapshot,
  type GuardDutyAuthorityPlanBinding,
} from './guardDutyAuthorityReceiptContracts';

export type GuardDutyAuthorityReceiptFailure =
  | 'guard_duty_assignment_missing'
  | 'guard_duty_assignment_invalid'
  | 'guard_duty_assignment_inactive'
  | 'guard_duty_assignment_not_current'
  | 'guard_duty_assignment_actor_mismatch'
  | 'guard_duty_assignment_ineligible'
  | 'guard_duty_plan_binding_invalid';

export function projectGuardDutyAuthorityReceipt(input: {
  assignment?: GuardDutyAuthorityAssignmentSnapshot;
  binding: GuardDutyAuthorityPlanBinding;
  nowGameHour: number;
}):
  | { ok: true; receipt: GuardHandoffParticipantAuthorityReceipt }
  | { ok: false; reasonCode: GuardDutyAuthorityReceiptFailure } {
  const { assignment, binding, nowGameHour } = input;
  if (!assignment) return failure('guard_duty_assignment_missing');
  if (!isValidGuardDutyAuthorityAssignment(assignment)) return failure('guard_duty_assignment_invalid');
  if (!isValidGuardDutyAuthorityPlanBinding(binding) || !Number.isSafeInteger(nowGameHour) || nowGameHour < 0) {
    return failure('guard_duty_plan_binding_invalid');
  }
  if (assignment.status !== 'active') return failure('guard_duty_assignment_inactive');
  if (nowGameHour < assignment.validFromGameHour || nowGameHour >= assignment.validUntilGameHour) {
    return failure('guard_duty_assignment_not_current');
  }
  if (assignment.actorId !== binding.participantActorId) return failure('guard_duty_assignment_actor_mismatch');
  if (!assignmentEligibleForBinding(assignment, binding)) return failure('guard_duty_assignment_ineligible');
  return {
    ok: true,
    receipt: withGuardHandoffAuthorityReceiptDigest({
      contractVersion: 'taixu.guard-handoff-participant-authority.v1',
      receiptKind: 'guard_duty_home_authority',
      planId: binding.planId,
      planRevision: binding.planRevision,
      scheduleDigest: binding.scheduleDigest,
      handoffFactsDigest: binding.handoffFactsDigest,
      participantActorId: binding.participantActorId,
      participantRole: binding.participantRole,
      role: assignment.role,
      homeZoneId: assignment.homeZoneId,
      dutyState: assignment.dutyState,
      mapId: assignment.mapId,
      currentLocationId: assignment.currentLocationId,
      aliveAndCapable: assignment.aliveAndCapable,
      busy: assignment.busy,
      roleFact: assignmentFact(assignment, 'role'),
      homeZoneFact: assignmentFact(assignment, 'home_zone'),
      dutyFact: assignmentFact(assignment, 'duty'),
      locationFact: assignmentFact(assignment, 'location'),
      capabilityFact: assignmentFact(assignment, 'capability'),
    }),
  };
}

export function isGuardDutyAuthorityReceiptCurrent(input: {
  assignment?: GuardDutyAuthorityAssignmentSnapshot;
  binding: GuardDutyAuthorityPlanBinding;
  nowGameHour: number;
  receipt: GuardHandoffParticipantAuthorityReceipt;
}) {
  const projected = projectGuardDutyAuthorityReceipt(input);
  return projected.ok && projected.receipt.receiptDigest === input.receipt.receiptDigest;
}

function assignmentEligibleForBinding(
  assignment: GuardDutyAuthorityAssignmentSnapshot,
  binding: GuardDutyAuthorityPlanBinding,
) {
  return assignment.role === 'guard' && assignment.dutyState === 'on_watch' &&
    assignment.homeZoneId === binding.handoffLocationId &&
    assignment.currentLocationId === binding.handoffLocationId &&
    assignment.mapId === binding.handoffMapId && assignment.aliveAndCapable && !assignment.busy;
}

function assignmentFact(
  assignment: GuardDutyAuthorityAssignmentSnapshot,
  factKind: 'role' | 'home_zone' | 'duty' | 'location' | 'capability',
): GuardHandoffAuthorityFact {
  return {
    sourceRef: assignment.authoritySourceRef,
    sourceRevision: `${assignment.authoritySourceRevision}:${factKind}`,
    sourceDigest: stableObservationDigest({
      assignmentId: assignment.assignmentId,
      assignmentRevision: assignment.assignmentRevision,
      assignmentDigest: assignment.assignmentDigest,
      factKind,
      authoritySourceDigest: assignment.authoritySourceDigest,
    }),
  };
}

function failure(reasonCode: GuardDutyAuthorityReceiptFailure) {
  return { ok: false as const, reasonCode };
}
