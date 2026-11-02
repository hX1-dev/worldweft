import {
  withGuardDutyAssignmentCommandDigest,
  withGuardDutyAssignmentRevokeCommandDigest,
  type GuardDutyAssignmentCommand,
} from './guardDutyAssignmentContracts';
import { admitGuardDutyAssignment, revokeGuardDutyAssignment } from './guardDutyAssignmentLogic';
import { projectGuardDutyAssignmentOwnerReceipt } from './guardDutyAssignmentProjectionLogic';
import { isValidGuardHandoffParticipantAuthorityReceipt } from './guardHandoffParticipantAdmissionContracts';

const binding = {
  planId: 'plan-handoff-1',
  planRevision: 2,
  scheduleDigest: 'schedule-digest-2',
  handoffFactsDigest: 'handoff-digest-2',
  participantActorId: 'han-li',
  participantRole: 'outgoing' as const,
  handoffMapId: 'qinglan',
  handoffLocationId: 'qinglan-gate',
};

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

function record() {
  const admitted = admitGuardDutyAssignment({ worldId: 'world-1', command: command(), existing: [] });
  if (!admitted.ok) throw new Error(admitted.reasonCode);
  return admitted.record;
}

function project(records = [record()], overrides: Partial<typeof binding> = {}, nowGameHour = 120) {
  return projectGuardDutyAssignmentOwnerReceipt({
    worldId: 'world-1',
    assignmentId: 'gate-watch-1',
    records,
    binding: { ...binding, ...overrides },
    nowGameHour,
  });
}

describe('P9d guard duty owner-to-receipt projection', () => {
  it('projects one exact owner row deterministically through P9b', () => {
    const first = project();
    const second = project();
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reasonCode);
    expect(isValidGuardHandoffParticipantAuthorityReceipt(first.receipt)).toBe(true);
    expect(first.receipt.roleFact.sourceRef).toBe('guard_duty_assignment:gate-watch-1:3');
  });

  it.each([
    ['missing', [], {}, 120, 'guard_duty_assignment_missing'],
    ['duplicate', [record(), record()], {}, 120, 'guard_duty_assignment_duplicate'],
    ['invalid digest', [{ ...record(), assignmentDigest: 'tampered' }], {}, 120, 'guard_duty_assignment_invalid'],
    ['expired', [record()], {}, 200, 'guard_duty_assignment_not_current'],
    ['source drift', [{ ...record(), authoritySourceDigest: 'drift' }], {}, 120, 'guard_duty_assignment_invalid'],
    ['plan drift', [record()], { planRevision: 0 }, 120, 'guard_duty_plan_binding_invalid'],
  ])('%s returns zero receipt', (_label, records, overrides, nowGameHour, reasonCode) => {
    expect(project(records, overrides, nowGameHour)).toEqual({ ok: false, reasonCode });
  });

  it('makes the prior receipt unusable after an exact revoke', () => {
    const active = record();
    const projected = project([active]);
    expect(projected.ok).toBe(true);
    const revoke = withGuardDutyAssignmentRevokeCommandDigest({
      contractVersion: 'taixu.guard-duty-assignment-owner.v1',
      worldId: 'world-1',
      assignmentId: active.assignmentId,
      assignmentRevision: active.assignmentRevision,
      expectedAssignmentDigest: active.assignmentDigest,
      authoritySourceRevision: 'operator-revoke:4',
      authoritySourceDigest: 'operator-revoke-digest-4',
      authorization: {
        authorizationRef: 'operator-duty-order:gate-watch-1',
        authorizationRevision: '4',
        authorizationDigest: 'operator-duty-order-digest-4',
      },
    });
    const revoked = revokeGuardDutyAssignment({ worldId: 'world-1', record: active, command: revoke });
    if (!revoked.ok) throw new Error(revoked.reasonCode);
    expect(project([revoked.record])).toEqual({
      ok: false,
      reasonCode: 'guard_duty_assignment_inactive',
    });
  });
});
