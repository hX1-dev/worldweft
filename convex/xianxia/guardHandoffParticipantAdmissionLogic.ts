import type { GuardHandoffPlan } from './guardHandoffContracts';
import { isValidGuardHandoffPlan } from './guardHandoffLogic';
import {
  isValidGuardHandoffParticipantAuthorityReceipt,
  withGuardHandoffParticipantAdmissionDigest,
  type GuardHandoffParticipantAdmission,
  type GuardHandoffParticipantAuthorityReceipt,
} from './guardHandoffParticipantAdmissionContracts';

export type GuardHandoffParticipantAdmissionFailure =
  | 'guard_handoff_plan_invalid'
  | 'guard_handoff_participant_missing'
  | 'guard_handoff_authority_receipt_missing'
  | 'guard_handoff_authority_receipt_invalid'
  | 'guard_handoff_authority_stale'
  | 'guard_handoff_participant_ineligible';

export function admitGuardHandoffParticipant(input: {
  plan: GuardHandoffPlan;
  participantActorId: string;
  authorityReceipt?: GuardHandoffParticipantAuthorityReceipt;
}):
  | { ok: true; admission: GuardHandoffParticipantAdmission }
  | { ok: false; reasonCode: GuardHandoffParticipantAdmissionFailure } {
  const { plan, participantActorId, authorityReceipt } = input;
  if (!isValidGuardHandoffPlan(plan) || plan.status !== 'scheduled' ||
    !plan.scheduleRevision || !plan.scheduleDigest) {
    return failure('guard_handoff_plan_invalid');
  }
  const participant = plan.participants.find((entry) => entry.actorId === participantActorId);
  if (!participant) return failure('guard_handoff_participant_missing');
  if (!authorityReceipt) return failure('guard_handoff_authority_receipt_missing');
  if (!isValidGuardHandoffParticipantAuthorityReceipt(authorityReceipt)) {
    return failure('guard_handoff_authority_receipt_invalid');
  }
  if (
    authorityReceipt.planId !== plan.planId ||
    authorityReceipt.planRevision !== plan.revision ||
    authorityReceipt.scheduleDigest !== plan.scheduleDigest ||
    authorityReceipt.handoffFactsDigest !== plan.handoffFactsDigest ||
    authorityReceipt.participantActorId !== participant.actorId ||
    authorityReceipt.participantRole !== participant.role
  ) return failure('guard_handoff_authority_stale');
  if (
    authorityReceipt.role !== 'guard' || authorityReceipt.dutyState !== 'on_watch' ||
    !authorityReceipt.aliveAndCapable || authorityReceipt.busy ||
    authorityReceipt.homeZoneId !== plan.handoffFacts.handoffLocationId ||
    authorityReceipt.currentLocationId !== plan.handoffFacts.handoffLocationId ||
    authorityReceipt.mapId !== plan.handoffFacts.handoffMapId
  ) return failure('guard_handoff_participant_ineligible');
  return {
    ok: true,
    admission: withGuardHandoffParticipantAdmissionDigest({
      contractVersion: 'taixu.guard-handoff-participant-admission.v1',
      planId: plan.planId,
      planRevision: plan.revision,
      scheduleDigest: plan.scheduleDigest,
      handoffFactsDigest: plan.handoffFactsDigest,
      participantActorId: participant.actorId,
      participantRole: participant.role,
      authorityReceiptDigest: authorityReceipt.receiptDigest,
    }),
  };
}

function failure(reasonCode: GuardHandoffParticipantAdmissionFailure) {
  return { ok: false as const, reasonCode };
}
