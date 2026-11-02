import {
  assignmentRecordFromCommand,
  GUARD_DUTY_ASSIGNMENT_OWNER_VERSION,
  GUARD_HANDOFF_ASSIGNMENT_TRANSITION_RECEIPT_VERSION,
  isValidGuardDutyAssignmentCommand,
  isValidGuardHandoffAssignmentTransitionReceipt,
  isValidGuardDutyAssignmentRevokeCommand,
  withGuardDutyAssignmentRevokeCommandDigest,
  withGuardHandoffAssignmentTransitionReceiptDigest,
  type GuardHandoffAssignmentTransitionReceipt,
  type GuardHandoffAssignmentTransitionTerminal,
  type GuardDutyAssignmentCommand,
  type GuardDutyAssignmentOwnerRecord,
  type GuardDutyAssignmentRevokeCommand,
} from './guardDutyAssignmentContracts';
import {
  guardDutyAuthoritySourceRef,
  isValidGuardDutyAuthorityAssignment,
  withGuardDutyAuthorityAssignmentDigest,
} from './guardDutyAuthorityReceiptContracts';
import type { GuardHandoffExecutionAdmissionRecord } from './guardHandoffExecutionAdmissionLogic';
import {
  guardPlanFromShared,
  isValidSharedGuardHandoffPlan,
  type SharedGuardHandoffPlanReceipt,
} from './sharedPlanLogic';
import { stableObservationDigest } from './lifeObservation';

export type GuardDutyAssignmentFailure =
  | 'guard_duty_assignment_command_invalid'
  | 'guard_duty_assignment_world_mismatch'
  | 'guard_duty_assignment_existing_invalid'
  | 'guard_duty_assignment_identity_conflict'
  | 'guard_duty_assignment_actor_conflict'
  | 'guard_duty_assignment_revoked'
  | 'guard_duty_assignment_not_found'
  | 'guard_duty_assignment_revoke_invalid'
  | 'guard_duty_assignment_revoke_mismatch';

export type GuardHandoffAssignmentTransitionFailure =
  | 'guard_handoff_assignment_transition_admission_invalid'
  | 'guard_handoff_assignment_transition_terminal_invalid'
  | 'guard_handoff_assignment_transition_plan_invalid'
  | 'guard_handoff_assignment_transition_source_drift'
  | 'guard_handoff_assignment_transition_assignment_invalid'
  | 'guard_handoff_assignment_transition_assignment_drift'
  | 'guard_handoff_assignment_transition_assignment_not_active'
  | 'guard_handoff_assignment_transition_receipt_duplicate'
  | 'guard_handoff_assignment_transition_receipt_invalid'
  | 'guard_handoff_assignment_transition_receipt_conflict'
  | 'guard_handoff_assignment_transition_revoke_failed';

export function admitGuardDutyAssignment(input: {
  worldId: string;
  command?: GuardDutyAssignmentCommand;
  existing: GuardDutyAssignmentOwnerRecord[];
}):
  | { ok: true; status: 'created' | 'replayed'; record: GuardDutyAssignmentOwnerRecord }
  | { ok: false; reasonCode: GuardDutyAssignmentFailure } {
  const { worldId, command, existing } = input;
  if (!command || !isValidGuardDutyAssignmentCommand(command)) return failure('guard_duty_assignment_command_invalid');
  if (command.worldId !== worldId) return failure('guard_duty_assignment_world_mismatch');
  if (existing.some((record) => !isValidOwnerRecord(record))) return failure('guard_duty_assignment_existing_invalid');
  const sameIdentity = existing.find((record) => record.assignmentId === command.assignmentId);
  if (sameIdentity) {
    if (sameIdentity.admissionCommandDigest !== command.commandDigest) {
      return failure('guard_duty_assignment_identity_conflict');
    }
    return sameIdentity.status === 'active'
      ? { ok: true, status: 'replayed', record: sameIdentity }
      : failure('guard_duty_assignment_revoked');
  }
  if (existing.some((record) => record.worldId === worldId && record.actorId === command.actorId && record.status === 'active')) {
    return failure('guard_duty_assignment_actor_conflict');
  }
  return { ok: true, status: 'created', record: assignmentRecordFromCommand(command) };
}

export function revokeGuardDutyAssignment(input: {
  worldId: string;
  record?: GuardDutyAssignmentOwnerRecord;
  command?: GuardDutyAssignmentRevokeCommand;
}):
  | { ok: true; status: 'revoked' | 'replayed'; record: GuardDutyAssignmentOwnerRecord }
  | { ok: false; reasonCode: GuardDutyAssignmentFailure } {
  const { worldId, record, command } = input;
  if (!command || !isValidGuardDutyAssignmentRevokeCommand(command)) {
    return failure('guard_duty_assignment_revoke_invalid');
  }
  if (command.worldId !== worldId) return failure('guard_duty_assignment_world_mismatch');
  if (!record) return failure('guard_duty_assignment_not_found');
  if (!isValidOwnerRecord(record)) return failure('guard_duty_assignment_existing_invalid');
  if (record.assignmentId !== command.assignmentId || record.assignmentRevision !== command.assignmentRevision) {
    return failure('guard_duty_assignment_revoke_mismatch');
  }
  if (record.status === 'revoked') {
    return record.revokedByCommandDigest === command.commandDigest
      ? { ok: true, status: 'replayed', record }
      : failure('guard_duty_assignment_revoke_mismatch');
  }
  if (record.assignmentDigest !== command.expectedAssignmentDigest) {
    return failure('guard_duty_assignment_revoke_mismatch');
  }
  const { assignmentDigest: _assignmentDigest, ...semantic } = guardDutyAuthoritySnapshotFromOwnerRecord(record);
  const revoked = {
    ...record,
    authorization: command.authorization,
    revokedByCommandDigest: command.commandDigest,
    ...withGuardDutyAuthorityAssignmentDigest({
      ...semantic,
      status: 'revoked' as const,
      authoritySourceRevision: command.authoritySourceRevision,
      authoritySourceDigest: command.authoritySourceDigest,
    }),
  };
  return { ok: true, status: 'revoked', record: revoked };
}

function isValidOwnerRecord(record: GuardDutyAssignmentOwnerRecord) {
  return record.ownerContractVersion === 'taixu.guard-duty-assignment-owner.v1' &&
    typeof record.worldId === 'string' && record.worldId.length > 0 &&
    typeof record.admissionCommandDigest === 'string' && record.admissionCommandDigest.length > 0 &&
    typeof record.authorization.authorizationRef === 'string' && record.authorization.authorizationRef.length > 0 &&
    typeof record.authorization.authorizationRevision === 'string' && record.authorization.authorizationRevision.length > 0 &&
    typeof record.authorization.authorizationDigest === 'string' && record.authorization.authorizationDigest.length > 0 &&
    isValidGuardDutyAuthorityAssignment(guardDutyAuthoritySnapshotFromOwnerRecord(record));
}

export function guardDutyAuthoritySnapshotFromOwnerRecord(record: GuardDutyAssignmentOwnerRecord) {
  return {
    contractVersion: record.contractVersion,
    assignmentId: record.assignmentId,
    assignmentRevision: record.assignmentRevision,
    actorId: record.actorId,
    status: record.status,
    role: record.role,
    homeZoneId: record.homeZoneId,
    dutyState: record.dutyState,
    mapId: record.mapId,
    currentLocationId: record.currentLocationId,
    aliveAndCapable: record.aliveAndCapable,
    busy: record.busy,
    validFromGameHour: record.validFromGameHour,
    validUntilGameHour: record.validUntilGameHour,
    authoritySourceRef: record.authoritySourceRef,
    authoritySourceRevision: record.authoritySourceRevision,
    authoritySourceDigest: record.authoritySourceDigest,
    assignmentDigest: record.assignmentDigest,
  };
}

/**
 * P9l's transaction payload builder. A future server-only pair-terminal
 * mutation must patch `outgoing` and insert `receipt` in the same transaction.
 * This helper has no mutation entry point and no runtime caller.
 */
export function transitionGuardHandoffDutyAssignments(
  input: {
    worldId: string;
    admission?: GuardHandoffExecutionAdmissionRecord;
    plan?: SharedGuardHandoffPlanReceipt;
    terminal?: GuardHandoffAssignmentTransitionTerminal;
    outgoing?: GuardDutyAssignmentOwnerRecord;
    incoming?: GuardDutyAssignmentOwnerRecord;
    existingReceipts: GuardHandoffAssignmentTransitionReceipt[];
  },
  dependencies: { revoke: typeof revokeGuardDutyAssignment } = { revoke: revokeGuardDutyAssignment },
):
  | {
    ok: true;
    status: 'applied' | 'replayed';
    outgoing: GuardDutyAssignmentOwnerRecord;
    incoming: GuardDutyAssignmentOwnerRecord;
    receipt: GuardHandoffAssignmentTransitionReceipt;
  }
  | { ok: false; reasonCode: GuardHandoffAssignmentTransitionFailure } {
  const { admission, plan, terminal, outgoing, incoming } = input;
  if (!admission || !isValidAdmission(admission) || admission.worldId !== input.worldId) {
    return transitionFailure('guard_handoff_assignment_transition_admission_invalid');
  }
  if (!terminal || !isValidTerminal(terminal)) {
    return transitionFailure('guard_handoff_assignment_transition_terminal_invalid');
  }
  if (!plan || !isValidSharedGuardHandoffPlan(plan) || plan.status !== 'scheduled') {
    return transitionFailure('guard_handoff_assignment_transition_plan_invalid');
  }
  if (!admissionMatchesPlan(admission, plan)) {
    return transitionFailure('guard_handoff_assignment_transition_source_drift');
  }
  if (!outgoing || !incoming || !isValidOwnerRecord(outgoing) || !isValidOwnerRecord(incoming)) {
    return transitionFailure('guard_handoff_assignment_transition_assignment_invalid');
  }
  if (!assignmentsMatchAdmission(input.worldId, admission, plan, outgoing, incoming)) {
    return transitionFailure('guard_handoff_assignment_transition_assignment_drift');
  }

  const transitionKey = `${admission.executionAdmissionId}:${admission.dispatchDigest}`;
  const matchingReceipts = input.existingReceipts.filter((receipt) =>
    receipt.worldId === input.worldId && receipt.executionAdmissionId === admission.executionAdmissionId &&
    receipt.dispatchDigest === admission.dispatchDigest);
  if (matchingReceipts.length > 1) {
    return transitionFailure('guard_handoff_assignment_transition_receipt_duplicate');
  }
  if (matchingReceipts.length === 1) {
    const receipt = matchingReceipts[0];
    if (!isValidGuardHandoffAssignmentTransitionReceipt(receipt)) {
      return transitionFailure('guard_handoff_assignment_transition_receipt_invalid');
    }
    if (!receiptMatchesReplay(receipt, transitionKey, admission, plan, terminal, outgoing, incoming)) {
      return transitionFailure('guard_handoff_assignment_transition_receipt_conflict');
    }
    return { ok: true, status: 'replayed', outgoing, incoming, receipt };
  }

  if (outgoing.status !== 'active' || incoming.status !== 'active') {
    return transitionFailure('guard_handoff_assignment_transition_assignment_not_active');
  }
  if (
    outgoing.assignmentDigest !== terminal.outgoingAssignmentDigest ||
    incoming.assignmentDigest !== terminal.incomingAssignmentDigest
  ) {
    return transitionFailure('guard_handoff_assignment_transition_assignment_drift');
  }

  const revokeCommand = withGuardDutyAssignmentRevokeCommandDigest({
    contractVersion: GUARD_DUTY_ASSIGNMENT_OWNER_VERSION,
    worldId: input.worldId,
    assignmentId: outgoing.assignmentId,
    assignmentRevision: outgoing.assignmentRevision,
    expectedAssignmentDigest: outgoing.assignmentDigest,
    authoritySourceRevision: `guard_handoff_completed:${admission.executionAdmissionId}`,
    authoritySourceDigest: stableObservationDigest({
      transitionKey,
      terminalRef: terminal.terminalRef,
      terminalDigest: terminal.terminalDigest,
    }),
    authorization: outgoing.authorization,
  });
  const revoked = dependencies.revoke({ worldId: input.worldId, record: outgoing, command: revokeCommand });
  if (!revoked.ok || revoked.status !== 'revoked') {
    return transitionFailure('guard_handoff_assignment_transition_revoke_failed');
  }
  const { assignmentDigest: _ignoredDigest, ...revokedSemantic } =
    guardDutyAuthoritySnapshotFromOwnerRecord(revoked.record);
  const transitionedOutgoing: GuardDutyAssignmentOwnerRecord = {
    ...revoked.record,
    ...withGuardDutyAuthorityAssignmentDigest({
      ...revokedSemantic,
      assignmentRevision: outgoing.assignmentRevision + 1,
      authoritySourceRef: guardDutyAuthoritySourceRef(
        outgoing.assignmentId,
        outgoing.assignmentRevision + 1,
      ),
    }),
  };
  const receipt = withGuardHandoffAssignmentTransitionReceiptDigest({
    contractVersion: GUARD_HANDOFF_ASSIGNMENT_TRANSITION_RECEIPT_VERSION,
    transitionKey,
    worldId: input.worldId,
    executionAdmissionId: admission.executionAdmissionId,
    dispatchDigest: admission.dispatchDigest,
    planId: admission.planId,
    planRevision: admission.planRevision,
    planDigest: admission.planDigest,
    terminalRef: terminal.terminalRef,
    terminalDigest: terminal.terminalDigest,
    outgoingAssignmentId: outgoing.assignmentId,
    outgoingPreRevision: outgoing.assignmentRevision,
    outgoingPreDigest: outgoing.assignmentDigest,
    outgoingPostRevision: transitionedOutgoing.assignmentRevision,
    outgoingPostDigest: transitionedOutgoing.assignmentDigest,
    incomingAssignmentId: incoming.assignmentId,
    incomingPreRevision: incoming.assignmentRevision,
    incomingPreDigest: incoming.assignmentDigest,
    incomingPostRevision: incoming.assignmentRevision,
    incomingPostDigest: incoming.assignmentDigest,
    outcome: 'applied',
    reasonCode: 'guard_handoff_completed',
  });
  return { ok: true, status: 'applied', outgoing: transitionedOutgoing, incoming, receipt };
}

function isValidAdmission(admission: GuardHandoffExecutionAdmissionRecord) {
  return admission.contractVersion === 'taixu.guard-handoff-execution-admission.v1' &&
    admission.status === 'admitted' && admission.providerCalls === 0 && admission.createdWorldActions === 0 &&
    Number.isSafeInteger(admission.planRevision) && admission.planRevision >= 1 &&
    Number.isSafeInteger(admission.scheduleRevision) && admission.scheduleRevision >= 1 &&
    [
      admission.executionAdmissionId, admission.worldId, admission.planId, admission.planDigest,
      admission.scheduleDigest, admission.handoffFactsDigest, admission.sourceRef,
      admission.sourceRevision, admission.sourceDigest, admission.handoffMapId,
      admission.handoffLocationId, admission.outgoingActorId, admission.incomingActorId,
      admission.outgoingAssignmentId, admission.incomingAssignmentId,
      admission.outgoingAdmissionDigest, admission.incomingAdmissionDigest, admission.dispatchDigest,
    ].every((value) => value.length > 0) &&
    admission.outgoingActorId !== admission.incomingActorId &&
    admission.outgoingAssignmentId !== admission.incomingAssignmentId;
}

function isValidTerminal(terminal: GuardHandoffAssignmentTransitionTerminal) {
  return [
    terminal.terminalRef,
    terminal.terminalDigest,
    terminal.outgoingAssignmentDigest,
    terminal.incomingAssignmentDigest,
  ].every((value) => value.length > 0);
}

function admissionMatchesPlan(
  admission: GuardHandoffExecutionAdmissionRecord,
  plan: SharedGuardHandoffPlanReceipt,
) {
  const guardPlan = guardPlanFromShared(plan);
  return admission.planId === plan.planId && admission.planRevision === plan.revision &&
    admission.planDigest === plan.planDigest && admission.scheduleRevision === plan.scheduleRevision &&
    admission.scheduleDigest === plan.scheduleDigest &&
    admission.handoffFactsDigest === plan.handoffFactsDigest &&
    admission.sourceRef === plan.sourceRef && admission.sourceRevision === plan.sourceRevision &&
    admission.sourceDigest === plan.sourceDigest && admission.handoffMapId === plan.mapId &&
    admission.handoffLocationId === plan.locationId &&
    admission.outgoingActorId === guardPlan.handoffFacts.outgoingActorId &&
    admission.incomingActorId === guardPlan.handoffFacts.incomingActorId;
}

function assignmentsMatchAdmission(
  worldId: string,
  admission: GuardHandoffExecutionAdmissionRecord,
  plan: SharedGuardHandoffPlanReceipt,
  outgoing: GuardDutyAssignmentOwnerRecord,
  incoming: GuardDutyAssignmentOwnerRecord,
) {
  return outgoing.worldId === worldId && incoming.worldId === worldId &&
    outgoing.assignmentId === admission.outgoingAssignmentId &&
    incoming.assignmentId === admission.incomingAssignmentId &&
    outgoing.actorId === admission.outgoingActorId && incoming.actorId === admission.incomingActorId &&
    outgoing.mapId === plan.mapId && incoming.mapId === plan.mapId &&
    outgoing.currentLocationId === plan.locationId && incoming.currentLocationId === plan.locationId;
}

function receiptMatchesReplay(
  receipt: GuardHandoffAssignmentTransitionReceipt,
  transitionKey: string,
  admission: GuardHandoffExecutionAdmissionRecord,
  plan: SharedGuardHandoffPlanReceipt,
  terminal: GuardHandoffAssignmentTransitionTerminal,
  outgoing: GuardDutyAssignmentOwnerRecord,
  incoming: GuardDutyAssignmentOwnerRecord,
) {
  return receipt.transitionKey === transitionKey && receipt.planId === admission.planId &&
    receipt.planRevision === admission.planRevision && receipt.planDigest === plan.planDigest &&
    receipt.terminalRef === terminal.terminalRef && receipt.terminalDigest === terminal.terminalDigest &&
    receipt.outgoingAssignmentId === outgoing.assignmentId &&
    receipt.outgoingPreDigest === terminal.outgoingAssignmentDigest &&
    receipt.outgoingPostRevision === outgoing.assignmentRevision &&
    receipt.outgoingPostDigest === outgoing.assignmentDigest && outgoing.status === 'revoked' &&
    receipt.incomingAssignmentId === incoming.assignmentId &&
    receipt.incomingPreDigest === terminal.incomingAssignmentDigest &&
    receipt.incomingPostRevision === incoming.assignmentRevision &&
    receipt.incomingPostDigest === incoming.assignmentDigest && incoming.status === 'active';
}

function failure(reasonCode: GuardDutyAssignmentFailure) {
  return { ok: false as const, reasonCode };
}

function transitionFailure(reasonCode: GuardHandoffAssignmentTransitionFailure) {
  return { ok: false as const, reasonCode };
}
