import { guardHandoffFactsDigest } from './guardHandoffContracts';
import { withGuardHandoffParticipantAdmissionDigest } from './guardHandoffParticipantAdmissionContracts';
import { admitGuardHandoffExecutionAdmission } from './guardHandoffExecutionAdmissionLogic';
import { projectGuardHandoffTwoPartyDispatch } from './guardHandoffTwoPartyDispatchLogic';
import { withSharedGuardHandoffPlanDigest } from './sharedPlanLogic';

const ownerPlan = () => {
  const facts = {
    handoffRevision: 1, sourceRef: 'group-commitment:guard-duty', sourceRevision: 'commitment:1', sourceDigest: 'source-digest',
    outgoingActorId: 'outgoing', incomingActorId: 'incoming', outgoingRole: 'guard' as const, incomingRole: 'guard' as const,
    outgoingDutyState: 'on_watch' as const, incomingDutyState: 'on_watch' as const, handoffMapId: 'qinglan', handoffLocationId: 'watch-post',
  };
  return withSharedGuardHandoffPlanDigest({
    contractVersion: 'taixu.shared-plan.v1' as const, planId: 'guard-plan', planKey: 'guard-plan-key', revision: 2,
    kind: 'guard_handoff' as const, status: 'scheduled' as const, proposerActorId: 'outgoing', inviteeActorId: 'incoming',
    sourceReviewId: 'review-1', sourceReviewDigest: 'review-digest', sourceWindowId: 'window-1', sourceRef: facts.sourceRef,
    sourceRevision: facts.sourceRevision, sourceDigest: facts.sourceDigest, sourceCommitmentId: 'guard-duty', mapId: facts.handoffMapId,
    locationId: facts.handoffLocationId, handoffFacts: facts, handoffFactsDigest: guardHandoffFactsDigest(facts),
    participants: [
      { actorId: 'outgoing', role: 'outgoing' as const, status: 'accepted' as const, baselineItemQuantity: 0 },
      { actorId: 'incoming', role: 'incoming' as const, status: 'accepted' as const, baselineItemQuantity: 0 },
    ],
    scheduleRevision: 2, scheduleDigest: 'schedule-digest', expiresGameHour: 24, providerCalls: 0 as const,
    createdWorldActions: 0 as const, createdAt: 1, updatedAt: 2,
  });
};

const validDispatch = () => {
  const owner = ownerPlan();
  const result = projectGuardHandoffTwoPartyDispatch({
    worldId: 'world-1', planId: owner.planId, nowGameHour: 12, owners: [{ worldId: 'world-1', plan: owner }],
    outgoing: { assignmentId: 'outgoing-assignment', records: [] }, incoming: { assignmentId: 'incoming-assignment', records: [] },
  }, {
    admit: ((call: { participantActorId: 'outgoing' | 'incoming' }) => ({
      ok: true,
      admission: withGuardHandoffParticipantAdmissionDigest({
        contractVersion: 'taixu.guard-handoff-participant-admission.v1', planId: owner.planId, planRevision: owner.revision,
        scheduleDigest: 'schedule-digest', handoffFactsDigest: owner.handoffFactsDigest, participantActorId: call.participantActorId,
        participantRole: call.participantActorId, authorityReceiptDigest: `${call.participantActorId}-receipt`,
      }),
    })) as never,
  });
  if (!result.ok) throw new Error(result.reasonCode);
  return result.dispatch;
};

const input = (overrides: Record<string, unknown> = {}) => ({
  worldId: 'world-1', planId: 'guard-plan', outgoingAssignmentId: 'outgoing-assignment', incomingAssignmentId: 'incoming-assignment',
  owners: [{ worldId: 'world-1', plan: ownerPlan() }], dispatch: validDispatch(), existing: [], ...overrides,
});

describe('guardHandoffExecutionAdmissionLogic', () => {
  it('creates one nonterminal admission and replays its same record with every non-admission write at zero', () => {
    const first = admitGuardHandoffExecutionAdmission(input());
    expect(first).toMatchObject({ ok: true, status: 'created', record: { status: 'admitted', providerCalls: 0, createdWorldActions: 0 } });
    if (!first.ok) throw new Error(first.reasonCode);
    const replay = admitGuardHandoffExecutionAdmission(input({ existing: [first.record] }));
    expect(replay).toEqual({ ok: true, status: 'replayed', record: first.record });
  });

  it.each([
    ['missing P8 owner', { owners: [] }],
    ['duplicate P8 owner', { owners: [{ worldId: 'world-1', plan: ownerPlan() }, { worldId: 'world-1', plan: ownerPlan() }] }],
    ['assignment pair', { incomingAssignmentId: 'outgoing-assignment' }],
    ['dispatch digest', { dispatch: { ...validDispatch(), dispatchDigest: 'drift' } }],
    ['source', { dispatch: { ...validDispatch(), sourceDigest: 'other-source' } }],
    ['revision', { dispatch: { ...validDispatch(), planRevision: 3 } }],
    ['schedule', { dispatch: { ...validDispatch(), scheduleDigest: 'other-schedule' } }],
    ['participant', { dispatch: { ...validDispatch(), outgoingActorId: 'incoming' } }],
  ])('rejects %s drift without producing a record', (_name, overrides) => {
    const result = admitGuardHandoffExecutionAdmission(input(overrides));
    expect(result.ok).toBe(false);
  });

  it('fails closed on duplicate or semantically mismatched natural-key rows', () => {
    const first = admitGuardHandoffExecutionAdmission(input());
    if (!first.ok) throw new Error(first.reasonCode);
    expect(admitGuardHandoffExecutionAdmission(input({ existing: [first.record, first.record] }))).toEqual({
      ok: false, reasonCode: 'guard_handoff_execution_existing_duplicate',
    });
    expect(admitGuardHandoffExecutionAdmission(input({ existing: [{ ...first.record, sourceDigest: 'drift' }] }))).toEqual({
      ok: false, reasonCode: 'guard_handoff_execution_existing_invalid',
    });
  });
});
