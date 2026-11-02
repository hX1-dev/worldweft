import { stableObservationDigest } from './lifeObservation';

export const GUARD_HANDOFF_PARTICIPANT_AUTHORITY_RECEIPT_VERSION =
  'taixu.guard-handoff-participant-authority.v1' as const;
export const GUARD_HANDOFF_PARTICIPANT_ADMISSION_VERSION =
  'taixu.guard-handoff-participant-admission.v1' as const;

export type GuardHandoffAuthorityFact = {
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
};

// P9a only describes this receipt. No current resolver writes or consumes one.
export type GuardHandoffParticipantAuthorityReceipt = {
  contractVersion: typeof GUARD_HANDOFF_PARTICIPANT_AUTHORITY_RECEIPT_VERSION;
  receiptKind: 'guard_duty_home_authority';
  planId: string;
  planRevision: number;
  scheduleDigest: string;
  handoffFactsDigest: string;
  participantActorId: string;
  participantRole: 'outgoing' | 'incoming';
  role: string;
  homeZoneId: string;
  dutyState: string;
  mapId: string;
  currentLocationId: string;
  aliveAndCapable: boolean;
  busy: boolean;
  roleFact: GuardHandoffAuthorityFact;
  homeZoneFact: GuardHandoffAuthorityFact;
  dutyFact: GuardHandoffAuthorityFact;
  locationFact: GuardHandoffAuthorityFact;
  capabilityFact: GuardHandoffAuthorityFact;
  receiptDigest: string;
};

export type GuardHandoffParticipantAdmission = {
  contractVersion: typeof GUARD_HANDOFF_PARTICIPANT_ADMISSION_VERSION;
  planId: string;
  planRevision: number;
  scheduleDigest: string;
  handoffFactsDigest: string;
  participantActorId: string;
  participantRole: 'outgoing' | 'incoming';
  authorityReceiptDigest: string;
  admissionDigest: string;
};

export function guardHandoffAuthorityReceiptDigest(
  receipt: Omit<GuardHandoffParticipantAuthorityReceipt, 'receiptDigest'>,
) {
  return stableObservationDigest(receipt);
}

export function withGuardHandoffAuthorityReceiptDigest(
  receipt: Omit<GuardHandoffParticipantAuthorityReceipt, 'receiptDigest'>,
): GuardHandoffParticipantAuthorityReceipt {
  return { ...receipt, receiptDigest: guardHandoffAuthorityReceiptDigest(receipt) };
}

export function guardHandoffParticipantAdmissionDigest(
  admission: Omit<GuardHandoffParticipantAdmission, 'admissionDigest'>,
) {
  return stableObservationDigest(admission);
}

export function withGuardHandoffParticipantAdmissionDigest(
  admission: Omit<GuardHandoffParticipantAdmission, 'admissionDigest'>,
): GuardHandoffParticipantAdmission {
  return { ...admission, admissionDigest: guardHandoffParticipantAdmissionDigest(admission) };
}

export function isValidGuardHandoffParticipantAuthorityReceipt(
  receipt: GuardHandoffParticipantAuthorityReceipt,
) {
  const { receiptDigest: _receiptDigest, ...semantic } = receipt;
  return receipt.contractVersion === GUARD_HANDOFF_PARTICIPANT_AUTHORITY_RECEIPT_VERSION &&
    receipt.receiptKind === 'guard_duty_home_authority' &&
    receipt.receiptDigest === guardHandoffAuthorityReceiptDigest(semantic) &&
    Number.isSafeInteger(receipt.planRevision) && receipt.planRevision >= 1 &&
    validReceiptFields(receipt);
}

function validReceiptFields(receipt: GuardHandoffParticipantAuthorityReceipt) {
  return nonEmpty(receipt.planId) && nonEmpty(receipt.scheduleDigest) &&
    nonEmpty(receipt.handoffFactsDigest) && nonEmpty(receipt.participantActorId) &&
    nonEmpty(receipt.role) && nonEmpty(receipt.homeZoneId) && nonEmpty(receipt.dutyState) &&
    nonEmpty(receipt.mapId) && nonEmpty(receipt.currentLocationId) &&
    ['outgoing', 'incoming'].includes(receipt.participantRole) &&
    [receipt.roleFact, receipt.homeZoneFact, receipt.dutyFact, receipt.locationFact, receipt.capabilityFact]
      .every(validFact);
}

function validFact(fact: GuardHandoffAuthorityFact) {
  return nonEmpty(fact.sourceRef) && nonEmpty(fact.sourceRevision) && nonEmpty(fact.sourceDigest);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
