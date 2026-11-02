import { stableObservationDigest } from './lifeObservation';
import {
  guardPlanFromShared,
  isValidSharedGuardHandoffPlan,
  type SharedGuardHandoffPlanReceipt,
} from './sharedPlanLogic';
import type { GuardHandoffTwoPartyDispatch } from './guardHandoffTwoPartyDispatchLogic';

export const GUARD_HANDOFF_EXECUTION_ADMISSION_VERSION =
  'taixu.guard-handoff-execution-admission.v1' as const;

export type GuardHandoffExecutionAdmissionRecord = {
  contractVersion: typeof GUARD_HANDOFF_EXECUTION_ADMISSION_VERSION;
  executionAdmissionId: string;
  status: 'admitted';
  worldId: string;
  planId: string;
  planRevision: number;
  planDigest: string;
  scheduleRevision: number;
  scheduleDigest: string;
  handoffFactsDigest: string;
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
  handoffMapId: string;
  handoffLocationId: string;
  outgoingActorId: string;
  incomingActorId: string;
  outgoingAssignmentId: string;
  incomingAssignmentId: string;
  outgoingAdmissionDigest: string;
  incomingAdmissionDigest: string;
  dispatchDigest: string;
  providerCalls: 0;
  createdWorldActions: 0;
};

export type GuardHandoffExecutionAdmissionFailure =
  | 'guard_handoff_execution_owner_missing'
  | 'guard_handoff_execution_owner_duplicate'
  | 'guard_handoff_execution_owner_invalid'
  | 'guard_handoff_execution_owner_not_scheduled'
  | 'guard_handoff_execution_assignment_invalid'
  | 'guard_handoff_execution_dispatch_invalid'
  | 'guard_handoff_execution_binding_mismatch'
  | 'guard_handoff_execution_existing_duplicate'
  | 'guard_handoff_execution_existing_invalid';

type OwnerRow = { worldId: string; plan: SharedGuardHandoffPlanReceipt };

export function admitGuardHandoffExecutionAdmission(input: {
  worldId: string;
  planId: string;
  outgoingAssignmentId: string;
  incomingAssignmentId: string;
  owners: OwnerRow[];
  dispatch: GuardHandoffTwoPartyDispatch;
  existing: GuardHandoffExecutionAdmissionRecord[];
}):
  | { ok: true; status: 'created' | 'replayed'; record: GuardHandoffExecutionAdmissionRecord }
  | { ok: false; reasonCode: GuardHandoffExecutionAdmissionFailure } {
  const matching = input.owners.filter((owner) =>
    owner.worldId === input.worldId && owner.plan.planId === input.planId);
  if (matching.length === 0) return failure('guard_handoff_execution_owner_missing');
  if (matching.length > 1) return failure('guard_handoff_execution_owner_duplicate');
  const owner = matching[0].plan;
  if (!isValidSharedGuardHandoffPlan(owner)) return failure('guard_handoff_execution_owner_invalid');
  const scheduleRevision = owner.scheduleRevision;
  if (
    owner.status !== 'scheduled' ||
    scheduleRevision === undefined ||
    !Number.isSafeInteger(scheduleRevision) || scheduleRevision < 1 ||
    !owner.scheduleDigest
  ) return failure('guard_handoff_execution_owner_not_scheduled');
  if (
    input.outgoingAssignmentId.length === 0 || input.incomingAssignmentId.length === 0 ||
    input.outgoingAssignmentId === input.incomingAssignmentId
  ) return failure('guard_handoff_execution_assignment_invalid');
  if (!isValidDispatch(input.dispatch)) return failure('guard_handoff_execution_dispatch_invalid');
  if (!matchesOwner(input.dispatch, owner)) return failure('guard_handoff_execution_binding_mismatch');

  const record = recordFor(input.worldId, input.outgoingAssignmentId, input.incomingAssignmentId, input.dispatch);
  const matchingExisting = input.existing.filter((existing) =>
    existing.worldId === record.worldId &&
    existing.planId === record.planId &&
    existing.planRevision === record.planRevision &&
    existing.dispatchDigest === record.dispatchDigest);
  if (matchingExisting.length > 1) return failure('guard_handoff_execution_existing_duplicate');
  if (matchingExisting.length === 1) {
    if (stableObservationDigest(matchingExisting[0]) !== stableObservationDigest(record)) {
      return failure('guard_handoff_execution_existing_invalid');
    }
    return { ok: true, status: 'replayed', record: matchingExisting[0] };
  }
  return { ok: true, status: 'created', record };
}

function matchesOwner(dispatch: GuardHandoffTwoPartyDispatch, owner: SharedGuardHandoffPlanReceipt) {
  const plan = guardPlanFromShared(owner);
  const outgoing = plan.participants.find((participant) => participant.role === 'outgoing');
  const incoming = plan.participants.find((participant) => participant.role === 'incoming');
  return Boolean(outgoing && incoming) &&
    dispatch.planId === plan.planId &&
    dispatch.planRevision === plan.revision &&
    dispatch.planDigest === plan.planDigest &&
    dispatch.scheduleRevision === owner.scheduleRevision &&
    dispatch.scheduleDigest === owner.scheduleDigest &&
    dispatch.handoffFactsDigest === plan.handoffFactsDigest &&
    dispatch.sourceRef === plan.handoffFacts.sourceRef &&
    dispatch.sourceRevision === plan.handoffFacts.sourceRevision &&
    dispatch.sourceDigest === plan.handoffFacts.sourceDigest &&
    dispatch.handoffMapId === plan.handoffFacts.handoffMapId &&
    dispatch.handoffLocationId === plan.handoffFacts.handoffLocationId &&
    dispatch.outgoingActorId === outgoing?.actorId &&
    dispatch.incomingActorId === incoming?.actorId;
}

function isValidDispatch(dispatch: GuardHandoffTwoPartyDispatch) {
  const { dispatchDigest, ...semantic } = dispatch;
  return dispatch.contractVersion === 'taixu.guard-handoff-two-party-dispatch.v1' &&
    dispatchDigest === stableObservationDigest(semantic) &&
    Number.isSafeInteger(dispatch.planRevision) && dispatch.planRevision >= 1 &&
    Number.isSafeInteger(dispatch.scheduleRevision) && dispatch.scheduleRevision >= 1 &&
    dispatch.providerCalls === 0 && dispatch.createdWorldActions === 0 &&
    [
      dispatch.planId, dispatch.planDigest, dispatch.scheduleDigest,
      dispatch.handoffFactsDigest, dispatch.sourceRef, dispatch.sourceRevision,
      dispatch.sourceDigest, dispatch.handoffMapId, dispatch.handoffLocationId,
      dispatch.outgoingActorId, dispatch.incomingActorId,
      dispatch.outgoingAdmissionDigest, dispatch.incomingAdmissionDigest,
      dispatch.dispatchDigest,
    ].every((value) => value.length > 0);
}

function recordFor(
  worldId: string,
  outgoingAssignmentId: string,
  incomingAssignmentId: string,
  dispatch: GuardHandoffTwoPartyDispatch,
): GuardHandoffExecutionAdmissionRecord {
  const executionAdmissionId = `guard-handoff-execution:${stableObservationDigest({
    worldId,
    planId: dispatch.planId,
    planRevision: dispatch.planRevision,
    dispatchDigest: dispatch.dispatchDigest,
  }).slice('stable64:'.length)}`;
  return {
    contractVersion: GUARD_HANDOFF_EXECUTION_ADMISSION_VERSION,
    executionAdmissionId,
    status: 'admitted',
    worldId,
    planId: dispatch.planId,
    planRevision: dispatch.planRevision,
    planDigest: dispatch.planDigest,
    scheduleRevision: dispatch.scheduleRevision,
    scheduleDigest: dispatch.scheduleDigest,
    handoffFactsDigest: dispatch.handoffFactsDigest,
    sourceRef: dispatch.sourceRef,
    sourceRevision: dispatch.sourceRevision,
    sourceDigest: dispatch.sourceDigest,
    handoffMapId: dispatch.handoffMapId,
    handoffLocationId: dispatch.handoffLocationId,
    outgoingActorId: dispatch.outgoingActorId,
    incomingActorId: dispatch.incomingActorId,
    outgoingAssignmentId,
    incomingAssignmentId,
    outgoingAdmissionDigest: dispatch.outgoingAdmissionDigest,
    incomingAdmissionDigest: dispatch.incomingAdmissionDigest,
    dispatchDigest: dispatch.dispatchDigest,
    providerCalls: 0,
    createdWorldActions: 0,
  };
}

function failure(reasonCode: GuardHandoffExecutionAdmissionFailure) {
  return { ok: false as const, reasonCode };
}
