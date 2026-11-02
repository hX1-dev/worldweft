import {
  guardDutyAuthoritySourceRef,
  withGuardDutyAuthorityAssignmentDigest,
  type GuardDutyAuthorityAssignmentSnapshot,
  type GuardDutyAuthorityPlanBinding,
} from './guardDutyAuthorityReceiptContracts';
import {
  isGuardDutyAuthorityReceiptCurrent,
  projectGuardDutyAuthorityReceipt,
} from './guardDutyAuthorityReceiptLogic';
import { isValidGuardHandoffParticipantAuthorityReceipt } from './guardHandoffParticipantAdmissionContracts';

const binding: GuardDutyAuthorityPlanBinding = {
  planId: 'plan-handoff-1',
  planRevision: 2,
  scheduleDigest: 'schedule-digest-2',
  handoffFactsDigest: 'handoff-digest-2',
  participantActorId: 'han-li',
  participantRole: 'outgoing',
  handoffMapId: 'qinglan',
  handoffLocationId: 'qinglan-gate',
};

function assignment(overrides: Partial<Omit<GuardDutyAuthorityAssignmentSnapshot, 'assignmentDigest'>> = {}) {
  const base = {
    contractVersion: 'taixu.guard-duty-assignment.v1' as const,
    assignmentId: 'gate-watch-1',
    assignmentRevision: 3,
    actorId: 'han-li',
    status: 'active' as const,
    role: 'guard',
    homeZoneId: 'qinglan-gate',
    dutyState: 'on_watch',
    mapId: 'qinglan',
    currentLocationId: 'qinglan-gate',
    aliveAndCapable: true,
    busy: false,
    validFromGameHour: 100,
    validUntilGameHour: 200,
    authoritySourceRef: guardDutyAuthoritySourceRef('gate-watch-1', 3),
    authoritySourceRevision: 'assignment:3',
    authoritySourceDigest: 'assignment-source-digest-3',
    ...overrides,
  };
  return withGuardDutyAuthorityAssignmentDigest(base);
}

describe('P9b guard duty authority receipt seam', () => {
  it('projects a deterministic P9a-valid receipt with no world write', () => {
    const first = projectGuardDutyAuthorityReceipt({ assignment: assignment(), binding, nowGameHour: 120 });
    const second = projectGuardDutyAuthorityReceipt({ assignment: assignment(), binding, nowGameHour: 120 });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reasonCode);
    expect(isValidGuardHandoffParticipantAuthorityReceipt(first.receipt)).toBe(true);
    expect(first.receipt.roleFact.sourceRef).toBe('guard_duty_assignment:gate-watch-1:3');
    expect(isGuardDutyAuthorityReceiptCurrent({
      assignment: assignment(), binding, nowGameHour: 120, receipt: first.receipt,
    })).toBe(true);
  });

  it.each([
    ['missing', undefined, binding, 120, 'guard_duty_assignment_missing'],
    ['invalid source', assignment({ authoritySourceRef: 'profile:han-li' }), binding, 120, 'guard_duty_assignment_invalid'],
    ['revoked', assignment({ status: 'revoked' }), binding, 120, 'guard_duty_assignment_inactive'],
    ['expired', assignment(), binding, 200, 'guard_duty_assignment_not_current'],
    ['wrong actor', assignment({ actorId: 'lin-xiaoman' }), binding, 120, 'guard_duty_assignment_actor_mismatch'],
    ['role drift', assignment({ role: 'farmer' }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['home drift', assignment({ homeZoneId: 'qinglan-market' }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['duty drift', assignment({ dutyState: 'off_watch' }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['map drift', assignment({ mapId: 'valley' }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['location drift', assignment({ currentLocationId: 'qinglan-market' }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['incapable', assignment({ aliveAndCapable: false }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['busy', assignment({ busy: true }), binding, 120, 'guard_duty_assignment_ineligible'],
    ['invalid plan', assignment(), { ...binding, planRevision: 0 }, 120, 'guard_duty_plan_binding_invalid'],
  ])('%s fails closed', (_label, currentAssignment, currentBinding, nowGameHour, reasonCode) => {
    expect(projectGuardDutyAuthorityReceipt({
      assignment: currentAssignment,
      binding: currentBinding,
      nowGameHour,
    })).toEqual({ ok: false, reasonCode });
  });

  it('rejects an otherwise valid receipt after plan or assignment source drift', () => {
    const projected = projectGuardDutyAuthorityReceipt({ assignment: assignment(), binding, nowGameHour: 120 });
    if (!projected.ok) throw new Error(projected.reasonCode);
    expect(isGuardDutyAuthorityReceiptCurrent({
      assignment: assignment(), binding: { ...binding, planRevision: 3 }, nowGameHour: 120, receipt: projected.receipt,
    })).toBe(false);
    expect(isGuardDutyAuthorityReceiptCurrent({
      assignment: assignment({ authoritySourceDigest: 'assignment-source-digest-4' }),
      binding,
      nowGameHour: 120,
      receipt: projected.receipt,
    })).toBe(false);
  });
});
