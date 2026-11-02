import {
  withGuardDutyAssignmentCommandDigest,
  withGuardDutyAssignmentRevokeCommandDigest,
  type GuardDutyAssignmentCommand,
} from './guardDutyAssignmentContracts';
import {
  admitGuardDutyAssignment,
  guardDutyAuthoritySnapshotFromOwnerRecord,
  revokeGuardDutyAssignment,
  transitionGuardHandoffDutyAssignments,
} from './guardDutyAssignmentLogic';
import { projectGuardDutyAuthorityReceipt } from './guardDutyAuthorityReceiptLogic';
import { withGuardDutyAuthorityAssignmentDigest } from './guardDutyAuthorityReceiptContracts';
import { guardHandoffFactsDigest } from './guardHandoffContracts';
import { withSharedGuardHandoffPlanDigest } from './sharedPlanLogic';
import type { GuardHandoffExecutionAdmissionRecord } from './guardHandoffExecutionAdmissionLogic';
import type {
  GuardDutyAssignmentOwnerRecord,
  GuardHandoffAssignmentTransitionTerminal,
} from './guardDutyAssignmentContracts';

function command(overrides: Partial<Omit<GuardDutyAssignmentCommand, 'commandDigest'>> = {}) {
  return withGuardDutyAssignmentCommandDigest({
    contractVersion: 'taixu.guard-duty-assignment-owner.v1',
    worldId: 'world-1',
    assignmentId: 'gate-watch-1',
    assignmentRevision: 3,
    actorId: 'han-li',
    role: 'guard',
    homeZoneId: 'qinglan-gate',
    dutyState: 'on_watch',
    mapId: 'qinglan',
    currentLocationId: 'qinglan-gate',
    aliveAndCapable: true,
    busy: false,
    validFromGameHour: 100,
    validUntilGameHour: 200,
    authoritySourceRevision: 'operator-grant:3',
    authoritySourceDigest: 'operator-grant-digest-3',
    authorization: {
      authorizationRef: 'operator-duty-order:gate-watch-1',
      authorizationRevision: '3',
      authorizationDigest: 'operator-duty-order-digest-3',
    },
    ...overrides,
  });
}

describe('P9c persistent guard duty assignment owner', () => {
  it('keeps the empty world quiet and creates/replays one explicit assignment', () => {
    const created = admitGuardDutyAssignment({ worldId: 'world-1', command: command(), existing: [] });
    expect(created).toMatchObject({ ok: true, status: 'created' });
    if (!created.ok) throw new Error(created.reasonCode);
    expect(created.record.authoritySourceRef).toBe('guard_duty_assignment:gate-watch-1:3');
    expect(projectGuardDutyAuthorityReceipt({
      assignment: guardDutyAuthoritySnapshotFromOwnerRecord(created.record),
      nowGameHour: 120,
      binding: {
        planId: 'plan-handoff-1',
        planRevision: 2,
        scheduleDigest: 'schedule-digest-2',
        handoffFactsDigest: 'handoff-digest-2',
        participantActorId: 'han-li',
        participantRole: 'outgoing',
        handoffMapId: 'qinglan',
        handoffLocationId: 'qinglan-gate',
      },
    }).ok).toBe(true);
    const replayed = admitGuardDutyAssignment({ worldId: 'world-1', command: command(), existing: [created.record] });
    expect(replayed).toEqual({ ok: true, status: 'replayed', record: created.record });
  });

  it.each([
    ['missing', undefined, [], 'guard_duty_assignment_command_invalid'],
    ['world drift', command({ worldId: 'world-2' }), [], 'guard_duty_assignment_world_mismatch'],
    ['invalid digest', { ...command(), commandDigest: 'tampered' }, [], 'guard_duty_assignment_command_invalid'],
    ['identity conflict', command({ role: 'farmer' }), 'identity', 'guard_duty_assignment_identity_conflict'],
    ['actor conflict', command({ assignmentId: 'gate-watch-2' }), 'actor', 'guard_duty_assignment_actor_conflict'],
  ])('%s fails closed', (label, nextCommand, fixture, reasonCode) => {
    const created = admitGuardDutyAssignment({ worldId: 'world-1', command: command(), existing: [] });
    if (!created.ok) throw new Error(created.reasonCode);
    const existing = fixture === 'identity' ? [created.record] : fixture === 'actor'
      ? [created.record] : [];
    expect(admitGuardDutyAssignment({
      worldId: 'world-1',
      command: nextCommand as GuardDutyAssignmentCommand | undefined,
      existing,
    })).toEqual({ ok: false, reasonCode });
  });

  it('revokes exactly once and rejects stale or replacement commands', () => {
    const created = admitGuardDutyAssignment({ worldId: 'world-1', command: command(), existing: [] });
    if (!created.ok) throw new Error(created.reasonCode);
    const revoke = withGuardDutyAssignmentRevokeCommandDigest({
      contractVersion: 'taixu.guard-duty-assignment-owner.v1',
      worldId: 'world-1',
      assignmentId: 'gate-watch-1',
      assignmentRevision: 3,
      expectedAssignmentDigest: created.record.assignmentDigest,
      authoritySourceRevision: 'operator-revoke:4',
      authoritySourceDigest: 'operator-revoke-digest-4',
      authorization: {
        authorizationRef: 'operator-duty-order:gate-watch-1',
        authorizationRevision: '4',
        authorizationDigest: 'operator-duty-order-digest-4',
      },
    });
    const revoked = revokeGuardDutyAssignment({ worldId: 'world-1', record: created.record, command: revoke });
    expect(revoked).toMatchObject({ ok: true, status: 'revoked', record: { status: 'revoked' } });
    if (!revoked.ok) throw new Error(revoked.reasonCode);
    expect(revokeGuardDutyAssignment({ worldId: 'world-1', record: revoked.record, command: revoke }))
      .toEqual({ ok: true, status: 'replayed', record: revoked.record });
    const { commandDigest: _revokeDigest, ...revocable } = revoke;
    const staleRevoke = withGuardDutyAssignmentRevokeCommandDigest({
      ...revocable,
      expectedAssignmentDigest: 'stale',
    });
    expect(revokeGuardDutyAssignment({
      worldId: 'world-1',
      record: created.record,
      command: staleRevoke,
    })).toEqual({ ok: false, reasonCode: 'guard_duty_assignment_revoke_mismatch' });
  });
});

function handoffPlan() {
  const handoffFacts = {
    handoffRevision: 2,
    sourceRef: 'duty-order:qinglan-gate',
    sourceRevision: '2',
    sourceDigest: 'duty-order-digest-2',
    outgoingActorId: 'han-li',
    incomingActorId: 'su-xiao',
    outgoingRole: 'guard' as const,
    incomingRole: 'guard' as const,
    outgoingDutyState: 'on_watch' as const,
    incomingDutyState: 'on_watch' as const,
    handoffMapId: 'qinglan',
    handoffLocationId: 'qinglan-gate',
  };
  return withSharedGuardHandoffPlanDigest({
    contractVersion: 'taixu.shared-plan.v1' as const,
    planId: 'plan-handoff-1',
    planKey: 'guard-handoff:qinglan-gate:2',
    revision: 2,
    kind: 'guard_handoff' as const,
    status: 'scheduled' as const,
    proposerActorId: 'han-li',
    inviteeActorId: 'su-xiao',
    sourceReviewId: 'review-1',
    sourceReviewDigest: 'review-digest-1',
    sourceWindowId: 'window-1',
    sourceRef: handoffFacts.sourceRef,
    sourceRevision: handoffFacts.sourceRevision,
    sourceDigest: handoffFacts.sourceDigest,
    sourceCommitmentId: 'commitment-1',
    mapId: handoffFacts.handoffMapId,
    locationId: handoffFacts.handoffLocationId,
    handoffFacts,
    handoffFactsDigest: guardHandoffFactsDigest(handoffFacts),
    participants: [
      { actorId: 'han-li', role: 'outgoing' as const, status: 'accepted' as const, baselineItemQuantity: 0 },
      { actorId: 'su-xiao', role: 'incoming' as const, status: 'accepted' as const, baselineItemQuantity: 0 },
    ],
    scheduleRevision: 3,
    scheduleDigest: 'schedule-digest-3',
    expiresGameHour: 200,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdAt: 1000,
    updatedAt: 1000,
  });
}

function assignment(overrides: Partial<Omit<GuardDutyAssignmentCommand, 'commandDigest'>> = {}) {
  const created = admitGuardDutyAssignment({ worldId: 'world-1', command: command(overrides), existing: [] });
  if (!created.ok) throw new Error(created.reasonCode);
  return created.record;
}

function admission(
  plan = handoffPlan(),
  outgoingAssignmentId = 'gate-watch-1',
  incomingAssignmentId = 'gate-watch-2',
): GuardHandoffExecutionAdmissionRecord {
  return {
    contractVersion: 'taixu.guard-handoff-execution-admission.v1', executionAdmissionId: 'execution-admission-1',
    status: 'admitted', worldId: 'world-1', planId: plan.planId, planRevision: plan.revision,
    planDigest: plan.planDigest, scheduleRevision: plan.scheduleRevision!, scheduleDigest: plan.scheduleDigest!,
    handoffFactsDigest: plan.handoffFactsDigest, sourceRef: plan.sourceRef,
    sourceRevision: plan.sourceRevision, sourceDigest: plan.sourceDigest,
    handoffMapId: plan.mapId, handoffLocationId: plan.locationId,
    outgoingActorId: 'han-li', incomingActorId: 'su-xiao', outgoingAssignmentId, incomingAssignmentId,
    outgoingAdmissionDigest: 'outgoing-admission-digest-1', incomingAdmissionDigest: 'incoming-admission-digest-1',
    dispatchDigest: 'dispatch-digest-1', providerCalls: 0, createdWorldActions: 0,
  };
}

function terminal(
  outgoing: GuardDutyAssignmentOwnerRecord,
  incoming: GuardDutyAssignmentOwnerRecord,
): GuardHandoffAssignmentTransitionTerminal {
  return {
    terminalRef: 'pair-terminal:event-1', terminalDigest: 'pair-terminal-digest-1',
    outgoingAssignmentDigest: outgoing.assignmentDigest, incomingAssignmentDigest: incoming.assignmentDigest,
  };
}

describe('P9l source-bound guard assignment transition helper', () => {
  function fixture() {
    const outgoing = assignment();
    const incoming = assignment({
      assignmentId: 'gate-watch-2', actorId: 'su-xiao',
      authorization: {
        authorizationRef: 'operator-duty-order:gate-watch-2', authorizationRevision: '3',
        authorizationDigest: 'operator-duty-order-digest-3',
      },
    });
    const plan = handoffPlan();
    return { outgoing, incoming, plan, admission: admission(plan), terminal: terminal(outgoing, incoming) };
  }

  it('applies one source-bound transition and records immutable pre/post evidence', () => {
    const current = fixture();
    const result = transitionGuardHandoffDutyAssignments({ ...current, worldId: 'world-1', existingReceipts: [] });
    expect(result).toMatchObject({ ok: true, status: 'applied' });
    if (!result.ok) throw new Error(result.reasonCode);
    expect(result.outgoing).toMatchObject({ status: 'revoked', assignmentRevision: current.outgoing.assignmentRevision + 1 });
    expect(result.incoming.assignmentDigest).toBe(current.incoming.assignmentDigest);
    expect(result.receipt).toMatchObject({
      outcome: 'applied', reasonCode: 'guard_handoff_completed', outgoingPreDigest: current.outgoing.assignmentDigest,
      outgoingPostDigest: result.outgoing.assignmentDigest, incomingPreDigest: current.incoming.assignmentDigest,
      incomingPostDigest: current.incoming.assignmentDigest,
    });
  });

  it('replays exactly and rejects source, terminal, and assignment drift', () => {
    const current = fixture();
    const applied = transitionGuardHandoffDutyAssignments({ ...current, worldId: 'world-1', existingReceipts: [] });
    if (!applied.ok) throw new Error(applied.reasonCode);
    expect(transitionGuardHandoffDutyAssignments({
      ...current, worldId: 'world-1', outgoing: applied.outgoing, incoming: applied.incoming,
      existingReceipts: [applied.receipt],
    })).toMatchObject({ ok: true, status: 'replayed', receipt: applied.receipt });
    expect(transitionGuardHandoffDutyAssignments({
      ...current, worldId: 'world-1', admission: { ...current.admission, sourceDigest: 'drifted-source-digest' },
      existingReceipts: [],
    })).toEqual({ ok: false, reasonCode: 'guard_handoff_assignment_transition_source_drift' });
    expect(transitionGuardHandoffDutyAssignments({
      ...current, worldId: 'world-1', outgoing: applied.outgoing, incoming: applied.incoming,
      terminal: { ...current.terminal, terminalDigest: 'drifted-terminal' }, existingReceipts: [applied.receipt],
    })).toEqual({ ok: false, reasonCode: 'guard_handoff_assignment_transition_receipt_conflict' });
    const { assignmentDigest: _digest, ...outgoingSemantic } = guardDutyAuthoritySnapshotFromOwnerRecord(current.outgoing);
    const driftedOutgoing = {
      ...current.outgoing,
      ...withGuardDutyAuthorityAssignmentDigest({ ...outgoingSemantic, currentLocationId: 'elsewhere' }),
    };
    expect(transitionGuardHandoffDutyAssignments({
      ...current, worldId: 'world-1', outgoing: driftedOutgoing, existingReceipts: [],
    })).toEqual({ ok: false, reasonCode: 'guard_handoff_assignment_transition_assignment_drift' });
  });

  it('fails closed for an already-revoked source and an atomic revoke failure', () => {
    const current = fixture();
    const applied = transitionGuardHandoffDutyAssignments({ ...current, worldId: 'world-1', existingReceipts: [] });
    if (!applied.ok) throw new Error(applied.reasonCode);
    expect(transitionGuardHandoffDutyAssignments({
      ...current, worldId: 'world-1', outgoing: applied.outgoing, existingReceipts: [],
    })).toEqual({ ok: false, reasonCode: 'guard_handoff_assignment_transition_assignment_not_active' });
    expect(transitionGuardHandoffDutyAssignments(
      { ...current, worldId: 'world-1', existingReceipts: [] },
      { revoke: () => ({ ok: false as const, reasonCode: 'guard_duty_assignment_revoke_mismatch' }) as never },
    )).toEqual({ ok: false, reasonCode: 'guard_handoff_assignment_transition_revoke_failed' });
  });
});
