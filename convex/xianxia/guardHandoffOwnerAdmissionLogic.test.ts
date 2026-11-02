import { guardHandoffFactsDigest } from './guardHandoffContracts';
import { isValidGuardHandoffPlan } from './guardHandoffLogic';
import { admitGuardHandoffOwner } from './guardHandoffOwnerAdmissionLogic';
import { guardPlanFromShared, withSharedGuardHandoffPlanDigest } from './sharedPlanLogic';

const ownerPlan = () => {
  const facts = { handoffRevision: 1, sourceRef: 'group-commitment:guard-duty', sourceRevision: 'commitment:1', sourceDigest: 'source-digest', outgoingActorId: 'outgoing', incomingActorId: 'incoming', outgoingRole: 'guard' as const, incomingRole: 'guard' as const, outgoingDutyState: 'on_watch' as const, incomingDutyState: 'on_watch' as const, handoffMapId: 'qinglan', handoffLocationId: 'watch-post' };
  return withSharedGuardHandoffPlanDigest({
  contractVersion: 'taixu.shared-plan.v1' as const,
  planId: 'guard-plan', planKey: 'guard-plan-key', revision: 2, kind: 'guard_handoff' as const, status: 'scheduled' as const,
  proposerActorId: 'outgoing', inviteeActorId: 'incoming', sourceReviewId: 'review-1', sourceReviewDigest: 'review-digest',
  sourceWindowId: 'window-1', sourceRef: 'group-commitment:guard-duty', sourceRevision: 'commitment:1', sourceDigest: 'source-digest',
  sourceCommitmentId: 'guard-duty', mapId: 'qinglan', locationId: 'watch-post',
  handoffFacts: facts, handoffFactsDigest: guardHandoffFactsDigest(facts), participants: [{ actorId: 'outgoing', role: 'outgoing' as const, status: 'accepted' as const, baselineItemQuantity: 0 }, { actorId: 'incoming', role: 'incoming' as const, status: 'accepted' as const, baselineItemQuantity: 0 }],
  scheduleRevision: 2, scheduleDigest: 'schedule-digest', expiresGameHour: 24, providerCalls: 0 as const, createdWorldActions: 0 as const, createdAt: 1, updatedAt: 2,
  });
};

describe('guardHandoffOwnerAdmissionLogic', () => {
  it('uses the canonical P8 converter, producing a valid P9a plan without changing the P8 digest', () => {
    const owner = ownerPlan();
    const plan = guardPlanFromShared(owner);
    expect(plan.contractVersion).toBe('taixu.guard-handoff.v1');
    expect(isValidGuardHandoffPlan(plan)).toBe(true);
    expect(owner.planDigest).toBe(ownerPlan().planDigest);
  });

  it('derives P9d binding from the canonical plan then calls P9a only after projection', () => {
    const owner = ownerPlan();
    let binding: unknown;
    const result = admitGuardHandoffOwner({ worldId: 'world-1', planId: owner.planId, assignmentId: 'assignment-1', participantActorId: 'incoming', nowGameHour: 12, owners: [{ worldId: 'world-1', plan: owner }], records: [] }, {
      project: (input) => { binding = input.binding; return { ok: true, receipt: { receiptDigest: 'receipt' } } as never; },
      admit: () => ({ ok: false, reasonCode: 'guard_handoff_participant_ineligible' }),
    });
    expect(binding).toMatchObject({ planId: owner.planId, planRevision: 2, scheduleDigest: 'schedule-digest', participantActorId: 'incoming', participantRole: 'incoming' });
    expect(result).toEqual({ ok: false, reasonCode: 'guard_handoff_participant_ineligible' });
  });

  it.each([
    ['missing', []],
    ['duplicate', [{ worldId: 'world-1', plan: ownerPlan() }, { worldId: 'world-1', plan: ownerPlan() }]],
  ])('rejects %s owners before P9d or P9a', (_name, owners) => {
    let projectCalls = 0; let admitCalls = 0;
    const project = () => { projectCalls += 1; return { ok: false, reasonCode: 'guard_duty_assignment_missing' } as never; };
    const admit = () => { admitCalls += 1; return { ok: false, reasonCode: 'guard_handoff_participant_ineligible' } as never; };
    const result = admitGuardHandoffOwner({ worldId: 'world-1', planId: 'guard-plan', assignmentId: 'assignment-1', participantActorId: 'incoming', nowGameHour: 12, owners, records: [] }, { project, admit });
    expect(result.ok).toBe(false); expect(projectCalls).toBe(0); expect(admitCalls).toBe(0);
  });

  it('short-circuits P9a when canonical binding has no P9d receipt', () => {
    let admitCalls = 0; const admit = () => { admitCalls += 1; return { ok: false, reasonCode: 'guard_handoff_participant_ineligible' } as never; }; const owner = ownerPlan();
    const result = admitGuardHandoffOwner({ worldId: 'world-1', planId: owner.planId, assignmentId: 'assignment-1', participantActorId: 'incoming', nowGameHour: 12, owners: [{ worldId: 'world-1', plan: owner }], records: [] }, { project: () => ({ ok: false, reasonCode: 'guard_duty_assignment_missing' }), admit });
    expect(result).toEqual({ ok: false, reasonCode: 'guard_duty_assignment_missing' }); expect(admitCalls).toBe(0);
  });
});
