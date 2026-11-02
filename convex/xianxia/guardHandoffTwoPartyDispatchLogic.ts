import { stableObservationDigest } from './lifeObservation';
import {
  guardHandoffParticipantAdmissionDigest,
  type GuardHandoffParticipantAdmission,
} from './guardHandoffParticipantAdmissionContracts';
import { admitGuardHandoffOwner } from './guardHandoffOwnerAdmissionLogic';
import {
  guardPlanFromShared,
  isValidSharedGuardHandoffPlan,
} from './sharedPlanLogic';

const GUARD_HANDOFF_TWO_PARTY_DISPATCH_VERSION =
  'taixu.guard-handoff-two-party-dispatch.v1' as const;

type OwnerAdmissionInput = Parameters<typeof admitGuardHandoffOwner>[0];

export type GuardHandoffTwoPartyDispatch = {
  contractVersion: typeof GUARD_HANDOFF_TWO_PARTY_DISPATCH_VERSION;
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
  outgoingAdmissionDigest: string;
  incomingAdmissionDigest: string;
  providerCalls: 0;
  createdWorldActions: 0;
  dispatchDigest: string;
};

export type GuardHandoffTwoPartyDispatchFailure =
  | 'guard_handoff_dispatch_owner_missing'
  | 'guard_handoff_dispatch_owner_duplicate'
  | 'guard_handoff_dispatch_owner_invalid'
  | 'guard_handoff_dispatch_owner_not_scheduled'
  | 'guard_handoff_dispatch_participants_invalid'
  | 'guard_handoff_dispatch_outgoing_admission_rejected'
  | 'guard_handoff_dispatch_incoming_admission_rejected'
  | 'guard_handoff_dispatch_outgoing_admission_invalid'
  | 'guard_handoff_dispatch_incoming_admission_invalid';

export type GuardHandoffTwoPartyDispatchInput = {
  worldId: string;
  planId: string;
  nowGameHour: number;
  owners: OwnerAdmissionInput['owners'];
  outgoing: Pick<OwnerAdmissionInput, 'assignmentId' | 'records'>;
  incoming: Pick<OwnerAdmissionInput, 'assignmentId' | 'records'>;
};

type Dependencies = {
  admit: typeof admitGuardHandoffOwner;
};

export function projectGuardHandoffTwoPartyDispatch(
  input: GuardHandoffTwoPartyDispatchInput,
  dependencies: Dependencies = { admit: admitGuardHandoffOwner },
):
  | { ok: true; dispatch: GuardHandoffTwoPartyDispatch }
  | { ok: false; reasonCode: GuardHandoffTwoPartyDispatchFailure } {
  const matching = input.owners.filter((owner) =>
    owner.worldId === input.worldId && owner.plan.planId === input.planId);
  if (matching.length === 0) return failure('guard_handoff_dispatch_owner_missing');
  if (matching.length > 1) return failure('guard_handoff_dispatch_owner_duplicate');

  const owner = matching[0].plan;
  if (!isValidSharedGuardHandoffPlan(owner)) return failure('guard_handoff_dispatch_owner_invalid');
  const scheduleRevision = owner.scheduleRevision;
  const scheduleDigest = owner.scheduleDigest;
  if (
    owner.status !== 'scheduled' ||
    typeof scheduleRevision !== 'number' ||
    !Number.isSafeInteger(scheduleRevision) || scheduleRevision < 1 ||
    !scheduleDigest
  ) return failure('guard_handoff_dispatch_owner_not_scheduled');

  const plan = guardPlanFromShared(owner);
  const outgoing = plan.participants.find((participant) => participant.role === 'outgoing');
  const incoming = plan.participants.find((participant) => participant.role === 'incoming');
  if (!outgoing || !incoming || outgoing.actorId === incoming.actorId) {
    return failure('guard_handoff_dispatch_participants_invalid');
  }

  const outgoingAdmission = dependencies.admit({
    worldId: input.worldId,
    planId: input.planId,
    assignmentId: input.outgoing.assignmentId,
    participantActorId: outgoing.actorId,
    nowGameHour: input.nowGameHour,
    owners: input.owners,
    records: input.outgoing.records,
  });
  if (!outgoingAdmission.ok) return failure('guard_handoff_dispatch_outgoing_admission_rejected');
  if (!matchesAdmission(outgoingAdmission.admission, plan, scheduleDigest, outgoing.actorId, 'outgoing')) {
    return failure('guard_handoff_dispatch_outgoing_admission_invalid');
  }

  const incomingAdmission = dependencies.admit({
    worldId: input.worldId,
    planId: input.planId,
    assignmentId: input.incoming.assignmentId,
    participantActorId: incoming.actorId,
    nowGameHour: input.nowGameHour,
    owners: input.owners,
    records: input.incoming.records,
  });
  if (!incomingAdmission.ok) return failure('guard_handoff_dispatch_incoming_admission_rejected');
  if (!matchesAdmission(incomingAdmission.admission, plan, scheduleDigest, incoming.actorId, 'incoming')) {
    return failure('guard_handoff_dispatch_incoming_admission_invalid');
  }

  return { ok: true, dispatch: withDispatchDigest({
    contractVersion: GUARD_HANDOFF_TWO_PARTY_DISPATCH_VERSION,
    planId: plan.planId,
    planRevision: plan.revision,
    planDigest: plan.planDigest,
    scheduleRevision,
    scheduleDigest,
    handoffFactsDigest: plan.handoffFactsDigest,
    sourceRef: plan.handoffFacts.sourceRef,
    sourceRevision: plan.handoffFacts.sourceRevision,
    sourceDigest: plan.handoffFacts.sourceDigest,
    handoffMapId: plan.handoffFacts.handoffMapId,
    handoffLocationId: plan.handoffFacts.handoffLocationId,
    outgoingActorId: outgoing.actorId,
    incomingActorId: incoming.actorId,
    outgoingAdmissionDigest: outgoingAdmission.admission.admissionDigest,
    incomingAdmissionDigest: incomingAdmission.admission.admissionDigest,
    providerCalls: 0,
    createdWorldActions: 0,
  }) };
}

function matchesAdmission(
  admission: GuardHandoffParticipantAdmission,
  plan: ReturnType<typeof guardPlanFromShared>,
  scheduleDigest: string,
  participantActorId: string,
  participantRole: 'outgoing' | 'incoming',
) {
  const { admissionDigest, ...semantic } = admission;
  return admission.contractVersion === 'taixu.guard-handoff-participant-admission.v1' &&
    admissionDigest === guardHandoffParticipantAdmissionDigest(semantic) &&
    Number.isSafeInteger(admission.planRevision) && admission.planRevision >= 1 &&
    [
      admission.planId,
      admission.scheduleDigest,
      admission.handoffFactsDigest,
      admission.participantActorId,
      admission.authorityReceiptDigest,
      admission.admissionDigest,
    ].every((value) => value.length > 0) &&
    admission.planId === plan.planId &&
    admission.planRevision === plan.revision &&
    admission.scheduleDigest === scheduleDigest &&
    admission.handoffFactsDigest === plan.handoffFactsDigest &&
    admission.participantActorId === participantActorId &&
    admission.participantRole === participantRole;
}

function withDispatchDigest(
  dispatch: Omit<GuardHandoffTwoPartyDispatch, 'dispatchDigest'>,
): GuardHandoffTwoPartyDispatch {
  return { ...dispatch, dispatchDigest: stableObservationDigest(dispatch) };
}

function failure(reasonCode: GuardHandoffTwoPartyDispatchFailure) {
  return { ok: false as const, reasonCode };
}
