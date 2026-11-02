import type { GuardDutyAssignmentOwnerRecord } from './guardDutyAssignmentContracts';
import {
  projectGuardDutyAssignmentOwnerReceipt,
  type GuardDutyAssignmentProjectionFailure,
} from './guardDutyAssignmentProjectionLogic';
import {
  admitGuardHandoffParticipant,
  type GuardHandoffParticipantAdmissionFailure,
} from './guardHandoffParticipantAdmissionLogic';
import {
  guardPlanFromShared,
  isValidSharedGuardHandoffPlan,
  type SharedGuardHandoffPlanReceipt,
} from './sharedPlanLogic';

export type GuardHandoffOwnerAdmissionFailure =
  | 'guard_handoff_owner_missing'
  | 'guard_handoff_owner_duplicate'
  | 'guard_handoff_owner_invalid'
  | 'guard_handoff_owner_not_scheduled'
  | 'guard_handoff_owner_participant_missing'
  | GuardDutyAssignmentProjectionFailure
  | GuardHandoffParticipantAdmissionFailure;

type OwnerRow = { worldId: string; plan: SharedGuardHandoffPlanReceipt };

type Dependencies = {
  project: typeof projectGuardDutyAssignmentOwnerReceipt;
  admit: typeof admitGuardHandoffParticipant;
};

export function admitGuardHandoffOwner(input: {
  worldId: string;
  planId: string;
  assignmentId: string;
  participantActorId: string;
  nowGameHour: number;
  owners: OwnerRow[];
  records: GuardDutyAssignmentOwnerRecord[];
}, dependencies: Dependencies = {
  project: projectGuardDutyAssignmentOwnerReceipt,
  admit: admitGuardHandoffParticipant,
}): ReturnType<typeof admitGuardHandoffParticipant> | { ok: false; reasonCode: GuardHandoffOwnerAdmissionFailure } {
  const matching = input.owners.filter((owner) => owner.worldId === input.worldId && owner.plan.planId === input.planId);
  if (matching.length === 0) return failure('guard_handoff_owner_missing');
  if (matching.length > 1) return failure('guard_handoff_owner_duplicate');
  const owner = matching[0].plan;
  if (!isValidSharedGuardHandoffPlan(owner)) return failure('guard_handoff_owner_invalid');
  if (owner.status !== 'scheduled' || !owner.scheduleRevision || !owner.scheduleDigest) {
    return failure('guard_handoff_owner_not_scheduled');
  }
  const plan = guardPlanFromShared(owner);
  const participant = plan.participants.find((entry) => entry.actorId === input.participantActorId);
  if (!participant) return failure('guard_handoff_owner_participant_missing');
  const projected = dependencies.project({
    worldId: input.worldId,
    assignmentId: input.assignmentId,
    records: input.records,
    binding: {
      planId: plan.planId,
      planRevision: plan.revision,
      scheduleDigest: plan.scheduleDigest!,
      handoffFactsDigest: plan.handoffFactsDigest,
      participantActorId: participant.actorId,
      participantRole: participant.role,
      handoffMapId: plan.handoffFacts.handoffMapId,
      handoffLocationId: plan.handoffFacts.handoffLocationId,
    },
    nowGameHour: input.nowGameHour,
  });
  if (!projected.ok) return projected;
  return dependencies.admit({ plan, participantActorId: participant.actorId, authorityReceipt: projected.receipt });
}

function failure(reasonCode: GuardHandoffOwnerAdmissionFailure) {
  return { ok: false as const, reasonCode };
}
