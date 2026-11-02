import { stableObservationDigest } from './lifeObservation';
import {
  GUARD_DUTY_AUTHORITY_ASSIGNMENT_VERSION,
  guardDutyAuthoritySourceRef,
  withGuardDutyAuthorityAssignmentDigest,
  type GuardDutyAuthorityAssignmentSnapshot,
} from './guardDutyAuthorityReceiptContracts';

export const GUARD_DUTY_ASSIGNMENT_OWNER_VERSION =
  'taixu.guard-duty-assignment-owner.v1' as const;

export type GuardDutyAssignmentAuthorization = {
  authorizationRef: string;
  authorizationRevision: string;
  authorizationDigest: string;
};

export type GuardDutyAssignmentCommand = {
  contractVersion: typeof GUARD_DUTY_ASSIGNMENT_OWNER_VERSION;
  worldId: string;
  assignmentId: string;
  assignmentRevision: number;
  actorId: string;
  role: string;
  homeZoneId: string;
  dutyState: string;
  mapId: string;
  currentLocationId: string;
  aliveAndCapable: boolean;
  busy: boolean;
  validFromGameHour: number;
  validUntilGameHour: number;
  authoritySourceRevision: string;
  authoritySourceDigest: string;
  authorization: GuardDutyAssignmentAuthorization;
  commandDigest: string;
};

export type GuardDutyAssignmentRevokeCommand = {
  contractVersion: typeof GUARD_DUTY_ASSIGNMENT_OWNER_VERSION;
  worldId: string;
  assignmentId: string;
  assignmentRevision: number;
  expectedAssignmentDigest: string;
  authoritySourceRevision: string;
  authoritySourceDigest: string;
  authorization: GuardDutyAssignmentAuthorization;
  commandDigest: string;
};

export type GuardDutyAssignmentOwnerRecord = GuardDutyAuthorityAssignmentSnapshot & {
  ownerContractVersion: typeof GUARD_DUTY_ASSIGNMENT_OWNER_VERSION;
  worldId: string;
  admissionCommandDigest: string;
  authorization: GuardDutyAssignmentAuthorization;
  revokedByCommandDigest?: string;
};

/** A future server-only pair-terminal owner supplies this already-loaded input. */
export type GuardHandoffAssignmentTransitionTerminal = {
  terminalRef: string;
  terminalDigest: string;
  outgoingAssignmentDigest: string;
  incomingAssignmentDigest: string;
};

export const GUARD_HANDOFF_ASSIGNMENT_TRANSITION_RECEIPT_VERSION =
  'taixu.guard-handoff-assignment-transition-receipt.v1' as const;

export type GuardHandoffAssignmentTransitionReceipt = {
  contractVersion: typeof GUARD_HANDOFF_ASSIGNMENT_TRANSITION_RECEIPT_VERSION;
  transitionKey: string;
  worldId: string;
  executionAdmissionId: string;
  dispatchDigest: string;
  planId: string;
  planRevision: number;
  planDigest: string;
  terminalRef: string;
  terminalDigest: string;
  outgoingAssignmentId: string;
  outgoingPreRevision: number;
  outgoingPreDigest: string;
  outgoingPostRevision: number;
  outgoingPostDigest: string;
  incomingAssignmentId: string;
  incomingPreRevision: number;
  incomingPreDigest: string;
  incomingPostRevision: number;
  incomingPostDigest: string;
  outcome: 'applied';
  reasonCode: 'guard_handoff_completed';
  receiptDigest: string;
};

export function withGuardDutyAssignmentCommandDigest(
  command: Omit<GuardDutyAssignmentCommand, 'commandDigest'>,
): GuardDutyAssignmentCommand {
  return { ...command, commandDigest: guardDutyAssignmentCommandDigest(command) };
}

export function withGuardDutyAssignmentRevokeCommandDigest(
  command: Omit<GuardDutyAssignmentRevokeCommand, 'commandDigest'>,
): GuardDutyAssignmentRevokeCommand {
  return { ...command, commandDigest: guardDutyAssignmentRevokeCommandDigest(command) };
}

export function guardDutyAssignmentCommandDigest(
  command: Omit<GuardDutyAssignmentCommand, 'commandDigest'>,
) {
  return stableObservationDigest(command);
}

export function guardDutyAssignmentRevokeCommandDigest(
  command: Omit<GuardDutyAssignmentRevokeCommand, 'commandDigest'>,
) {
  return stableObservationDigest(command);
}

export function guardHandoffAssignmentTransitionReceiptDigest(
  receipt: Omit<GuardHandoffAssignmentTransitionReceipt, 'receiptDigest'>,
) {
  return stableObservationDigest(receipt);
}

export function withGuardHandoffAssignmentTransitionReceiptDigest(
  receipt: Omit<GuardHandoffAssignmentTransitionReceipt, 'receiptDigest'>,
): GuardHandoffAssignmentTransitionReceipt {
  return { ...receipt, receiptDigest: guardHandoffAssignmentTransitionReceiptDigest(receipt) };
}

export function isValidGuardHandoffAssignmentTransitionReceipt(
  receipt: GuardHandoffAssignmentTransitionReceipt,
) {
  const { receiptDigest: _receiptDigest, ...semantic } = receipt;
  return receipt.contractVersion === GUARD_HANDOFF_ASSIGNMENT_TRANSITION_RECEIPT_VERSION &&
    receipt.receiptDigest === guardHandoffAssignmentTransitionReceiptDigest(semantic) &&
    nonEmpty(receipt.transitionKey) && nonEmpty(receipt.worldId) &&
    nonEmpty(receipt.executionAdmissionId) && nonEmpty(receipt.dispatchDigest) &&
    nonEmpty(receipt.planId) && Number.isSafeInteger(receipt.planRevision) && receipt.planRevision >= 1 &&
    nonEmpty(receipt.planDigest) && nonEmpty(receipt.terminalRef) && nonEmpty(receipt.terminalDigest) &&
    nonEmpty(receipt.outgoingAssignmentId) && nonEmpty(receipt.outgoingPreDigest) &&
    nonEmpty(receipt.outgoingPostDigest) && nonEmpty(receipt.incomingAssignmentId) &&
    nonEmpty(receipt.incomingPreDigest) && nonEmpty(receipt.incomingPostDigest) &&
    Number.isSafeInteger(receipt.outgoingPreRevision) && receipt.outgoingPreRevision >= 1 &&
    Number.isSafeInteger(receipt.outgoingPostRevision) &&
    receipt.outgoingPostRevision === receipt.outgoingPreRevision + 1 &&
    Number.isSafeInteger(receipt.incomingPreRevision) && receipt.incomingPreRevision >= 1 &&
    receipt.incomingPostRevision === receipt.incomingPreRevision &&
    receipt.outcome === 'applied' && receipt.reasonCode === 'guard_handoff_completed';
}

export function isValidGuardDutyAssignmentCommand(command: GuardDutyAssignmentCommand) {
  const { commandDigest: _commandDigest, ...semantic } = command;
  return command.contractVersion === GUARD_DUTY_ASSIGNMENT_OWNER_VERSION &&
    command.commandDigest === guardDutyAssignmentCommandDigest(semantic) &&
    nonEmpty(command.worldId) && nonEmpty(command.assignmentId) &&
    Number.isSafeInteger(command.assignmentRevision) && command.assignmentRevision >= 1 &&
    nonEmpty(command.actorId) && nonEmpty(command.role) && nonEmpty(command.homeZoneId) &&
    nonEmpty(command.dutyState) && nonEmpty(command.mapId) && nonEmpty(command.currentLocationId) &&
    Number.isSafeInteger(command.validFromGameHour) && command.validFromGameHour >= 0 &&
    Number.isSafeInteger(command.validUntilGameHour) && command.validUntilGameHour > command.validFromGameHour &&
    nonEmpty(command.authoritySourceRevision) && nonEmpty(command.authoritySourceDigest) &&
    isValidAuthorization(command.authorization);
}

export function isValidGuardDutyAssignmentRevokeCommand(command: GuardDutyAssignmentRevokeCommand) {
  const { commandDigest: _commandDigest, ...semantic } = command;
  return command.contractVersion === GUARD_DUTY_ASSIGNMENT_OWNER_VERSION &&
    command.commandDigest === guardDutyAssignmentRevokeCommandDigest(semantic) &&
    nonEmpty(command.worldId) && nonEmpty(command.assignmentId) &&
    Number.isSafeInteger(command.assignmentRevision) && command.assignmentRevision >= 1 &&
    nonEmpty(command.expectedAssignmentDigest) && nonEmpty(command.authoritySourceRevision) &&
    nonEmpty(command.authoritySourceDigest) && isValidAuthorization(command.authorization);
}

export function assignmentRecordFromCommand(command: GuardDutyAssignmentCommand): GuardDutyAssignmentOwnerRecord {
  return {
    ownerContractVersion: GUARD_DUTY_ASSIGNMENT_OWNER_VERSION,
    worldId: command.worldId,
    admissionCommandDigest: command.commandDigest,
    authorization: command.authorization,
    ...withGuardDutyAuthorityAssignmentDigest({
      contractVersion: GUARD_DUTY_AUTHORITY_ASSIGNMENT_VERSION,
      assignmentId: command.assignmentId,
      assignmentRevision: command.assignmentRevision,
      actorId: command.actorId,
      status: 'active',
      role: command.role,
      homeZoneId: command.homeZoneId,
      dutyState: command.dutyState,
      mapId: command.mapId,
      currentLocationId: command.currentLocationId,
      aliveAndCapable: command.aliveAndCapable,
      busy: command.busy,
      validFromGameHour: command.validFromGameHour,
      validUntilGameHour: command.validUntilGameHour,
      authoritySourceRef: guardDutyAuthoritySourceRef(command.assignmentId, command.assignmentRevision),
      authoritySourceRevision: command.authoritySourceRevision,
      authoritySourceDigest: command.authoritySourceDigest,
    }),
  };
}

function isValidAuthorization(authorization: GuardDutyAssignmentAuthorization) {
  return nonEmpty(authorization.authorizationRef) && nonEmpty(authorization.authorizationRevision) &&
    nonEmpty(authorization.authorizationDigest);
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
