import type { GuardDutyAssignmentOwnerRecord } from './guardDutyAssignmentContracts';
import { guardDutyAuthoritySnapshotFromOwnerRecord } from './guardDutyAssignmentLogic';
import {
  projectGuardDutyAuthorityReceipt,
  type GuardDutyAuthorityReceiptFailure,
} from './guardDutyAuthorityReceiptLogic';
import type { GuardDutyAuthorityPlanBinding } from './guardDutyAuthorityReceiptContracts';
import type { GuardHandoffParticipantAuthorityReceipt } from './guardHandoffParticipantAdmissionContracts';

export type GuardDutyAssignmentProjectionFailure =
  | GuardDutyAuthorityReceiptFailure
  | 'guard_duty_assignment_duplicate';

/**
 * Read-only bridge from one P9c owner record to the existing P9b projector.
 * It deliberately knows nothing about sharedPlans or P9a admission.
 */
export function projectGuardDutyAssignmentOwnerReceipt(input: {
  worldId: string;
  assignmentId: string;
  records: GuardDutyAssignmentOwnerRecord[];
  binding: GuardDutyAuthorityPlanBinding;
  nowGameHour: number;
}):
  | { ok: true; receipt: GuardHandoffParticipantAuthorityReceipt }
  | { ok: false; reasonCode: GuardDutyAssignmentProjectionFailure } {
  const matching = input.records.filter((record) =>
    record.worldId === input.worldId && record.assignmentId === input.assignmentId,
  );
  if (matching.length > 1) return { ok: false, reasonCode: 'guard_duty_assignment_duplicate' };
  return projectGuardDutyAuthorityReceipt({
    assignment: matching[0] ? guardDutyAuthoritySnapshotFromOwnerRecord(matching[0]) : undefined,
    binding: input.binding,
    nowGameHour: input.nowGameHour,
  });
}
