import { guardHandoffFactsDigest } from './guardHandoffContracts';
import { withGuardHandoffParticipantAdmissionDigest } from './guardHandoffParticipantAdmissionContracts';
import { projectGuardHandoffTwoPartyDispatch } from './guardHandoffTwoPartyDispatchLogic';
import { withSharedGuardHandoffPlanDigest } from './sharedPlanLogic';

const ownerPlan = () => {
  const facts = {
    handoffRevision: 1,
    sourceRef: 'group-commitment:guard-duty',
    sourceRevision: 'commitment:1',
    sourceDigest: 'source-digest',
    outgoingActorId: 'outgoing',
    incomingActorId: 'incoming',
    outgoingRole: 'guard' as const,
    incomingRole: 'guard' as const,
    outgoingDutyState: 'on_watch' as const,
    incomingDutyState: 'on_watch' as const,
    handoffMapId: 'qinglan',
    handoffLocationId: 'watch-post',
  };
  return withSharedGuardHandoffPlanDigest({
    contractVersion: 'taixu.shared-plan.v1' as const,
    planId: 'guard-plan',
    planKey: 'guard-plan-key',
    revision: 2,
    kind: 'guard_handoff' as const,
    status: 'scheduled' as const,
    proposerActorId: 'outgoing',
    inviteeActorId: 'incoming',
    sourceReviewId: 'review-1',
    sourceReviewDigest: 'review-digest',
    sourceWindowId: 'window-1',
    sourceRef: facts.sourceRef,
    sourceRevision: facts.sourceRevision,
    sourceDigest: facts.sourceDigest,
    sourceCommitmentId: 'guard-duty',
    mapId: facts.handoffMapId,
    locationId: facts.handoffLocationId,
    handoffFacts: facts,
    handoffFactsDigest: guardHandoffFactsDigest(facts),
    participants: [
      { actorId: 'outgoing', role: 'outgoing' as const, status: 'accepted' as const, baselineItemQuantity: 0 },
      { actorId: 'incoming', role: 'incoming' as const, status: 'accepted' as const, baselineItemQuantity: 0 },
    ],
    scheduleRevision: 2,
    scheduleDigest: 'schedule-digest',
    expiresGameHour: 24,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdAt: 1,
    updatedAt: 2,
  });
};

const proposedOwnerPlan = () => {
  const { planDigest: _planDigest, ...semantic } = ownerPlan();
  return withSharedGuardHandoffPlanDigest({
    ...semantic,
    status: 'proposed' as const,
    scheduleRevision: undefined,
    scheduleDigest: undefined,
  });
};

const admission = (participantActorId: 'outgoing' | 'incoming', overrides = {}) =>
  withGuardHandoffParticipantAdmissionDigest({
    contractVersion: 'taixu.guard-handoff-participant-admission.v1' as const,
    planId: 'guard-plan',
    planRevision: 2,
    scheduleDigest: 'schedule-digest',
    handoffFactsDigest: guardHandoffFactsDigest(ownerPlan().handoffFacts),
    participantActorId,
    participantRole: participantActorId,
    authorityReceiptDigest: `${participantActorId}-receipt`,
    ...overrides,
  });

const input = (owners = [{ worldId: 'world-1', plan: ownerPlan() }]) => ({
  worldId: 'world-1',
  planId: 'guard-plan',
  nowGameHour: 12,
  owners,
  outgoing: { assignmentId: 'outgoing-assignment', records: [] },
  incoming: { assignmentId: 'incoming-assignment', records: [] },
});

describe('guardHandoffTwoPartyDispatchLogic', () => {
  it('requires both P9e admissions from one scheduled owner and produces a replay-stable zero-write dispatch', () => {
    const calls: Array<{ participantActorId: string; nowGameHour: number }> = [];
    const admit = (call: { participantActorId: 'outgoing' | 'incoming'; nowGameHour: number }) => {
      calls.push({ participantActorId: call.participantActorId, nowGameHour: call.nowGameHour });
      return { ok: true as const, admission: admission(call.participantActorId) };
    };
    const first = projectGuardHandoffTwoPartyDispatch(input(), { admit: admit as never });
    const replay = projectGuardHandoffTwoPartyDispatch(input(), { admit: admit as never });

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      ok: true,
      dispatch: {
        planId: 'guard-plan',
        scheduleDigest: 'schedule-digest',
        outgoingActorId: 'outgoing',
        incomingActorId: 'incoming',
        providerCalls: 0,
        createdWorldActions: 0,
      },
    });
    expect(calls).toEqual([
      { participantActorId: 'outgoing', nowGameHour: 12 },
      { participantActorId: 'incoming', nowGameHour: 12 },
      { participantActorId: 'outgoing', nowGameHour: 12 },
      { participantActorId: 'incoming', nowGameHour: 12 },
    ]);
  });

  it.each([
    ['missing owner', []],
    ['duplicate owner', [{ worldId: 'world-1', plan: ownerPlan() }, { worldId: 'world-1', plan: ownerPlan() }]],
    ['non-scheduled owner', [{ worldId: 'world-1', plan: proposedOwnerPlan() }]],
  ])('rejects %s before either P9e admission', (_name, owners) => {
    let calls = 0;
    const result = projectGuardHandoffTwoPartyDispatch(input(owners), {
      admit: (() => { calls += 1; return { ok: true, admission: admission('outgoing') }; }) as never,
    });
    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it('short-circuits a rejected outgoing admission and rejects an invalid incoming binding', () => {
    let calls = 0;
    const outgoingRejected = projectGuardHandoffTwoPartyDispatch(input(), {
      admit: (() => { calls += 1; return { ok: false, reasonCode: 'guard_handoff_participant_ineligible' }; }) as never,
    });
    expect(outgoingRejected).toEqual({ ok: false, reasonCode: 'guard_handoff_dispatch_outgoing_admission_rejected' });
    expect(calls).toBe(1);

    const incomingDrift = projectGuardHandoffTwoPartyDispatch(input(), {
      admit: ((call: { participantActorId: 'outgoing' | 'incoming' }) => ({
        ok: true,
        admission: call.participantActorId === 'outgoing'
          ? admission('outgoing')
          : admission('incoming', { scheduleDigest: 'other-schedule' }),
      })) as never,
    });
    expect(incomingDrift).toEqual({ ok: false, reasonCode: 'guard_handoff_dispatch_incoming_admission_invalid' });
  });

  it.each([
    ['plan', { planId: 'other-plan' }],
    ['revision', { planRevision: 3 }],
    ['handoff digest', { handoffFactsDigest: 'other-handoff' }],
    ['participant', { participantActorId: 'incoming', participantRole: 'incoming' as const }],
  ])('rejects outgoing %s drift without calling incoming P9e admission', (_name, overrides) => {
    const calls: string[] = [];
    const result = projectGuardHandoffTwoPartyDispatch(input(), {
      admit: ((call: { participantActorId: 'outgoing' | 'incoming' }) => {
        calls.push(call.participantActorId);
        return { ok: true, admission: admission(call.participantActorId, overrides) };
      }) as never,
    });
    expect(result).toEqual({ ok: false, reasonCode: 'guard_handoff_dispatch_outgoing_admission_invalid' });
    expect(calls).toEqual(['outgoing']);
  });
});
