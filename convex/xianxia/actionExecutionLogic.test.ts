import {
  ACTION_EXECUTION_LEASE_MS,
  type ActionExecutionReport,
} from './actionExecutionContracts';
import {
  evaluateActionExecutionReport,
  isLegalActionExecutionTransition,
  nextActionExecutionRevision,
  type ActionExecutionSnapshot,
} from './actionExecutionLogic';

const NOW = 1_000_000;

function execution(
  patch: Partial<ActionExecutionSnapshot> = {},
): ActionExecutionSnapshot {
  return {
    revision: 3,
    actorId: 'npc_muyun',
    status: 'pending',
    durationMs: 8_000,
    hardDeadlineAt: NOW + 120_000,
    issuedAt: NOW - 1_000,
    expiresAt: NOW + 30_000,
    ...patch,
  };
}

function report(
  status: ActionExecutionReport['status'],
  patch: Partial<ActionExecutionReport> = {},
): ActionExecutionReport {
  return {
    executionId: 'execution_1',
    revision: 3,
    actorId: 'npc_muyun',
    executorId: 'godot:test-runner',
    status,
    reportedAt: NOW,
    ...patch,
  };
}

describe('action execution protocol', () => {
  test('accepts pending then starts acting and rolls the lease', () => {
    const accepted = evaluateActionExecutionReport(execution(), report('accepted'), NOW);
    expect(accepted).toMatchObject({
      ok: true,
      idempotentReplay: false,
      patch: {
        status: 'accepted',
        acceptedAt: NOW,
        leaseOwner: 'godot:test-runner',
        lastHeartbeatAt: NOW,
        expiresAt: NOW + ACTION_EXECUTION_LEASE_MS,
      },
    });

    const acting = evaluateActionExecutionReport(
      execution({ status: 'accepted', acceptedAt: NOW }),
      report('acting'),
      NOW + 500,
    );
    expect(acting).toMatchObject({
      ok: true,
      patch: {
        status: 'acting',
        acceptedAt: NOW,
        startedAt: NOW + 500,
        lastHeartbeatAt: NOW + 500,
      },
    });
  });

  test('requires accepted -> acting and the full duration before completion', () => {
    expect(evaluateActionExecutionReport(execution(), report('acting'), NOW)).toMatchObject({
      ok: false,
      code: 'invalid_execution_transition',
    });
    expect(
      evaluateActionExecutionReport(
        execution({ status: 'accepted', acceptedAt: NOW - 500 }),
        report('completed'),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_execution_transition' });

    const active = execution({
      status: 'acting',
      acceptedAt: NOW - 10_000,
      startedAt: NOW - 7_999,
    });
    expect(evaluateActionExecutionReport(active, report('completed'), NOW)).toMatchObject({
      ok: false,
      code: 'execution_not_ready',
    });
    expect(
      evaluateActionExecutionReport(
        { ...active, startedAt: NOW - 8_000 },
        report('completed'),
        NOW,
      ),
    ).toMatchObject({
      ok: true,
      idempotentReplay: false,
      patch: { status: 'completed', terminalAt: NOW },
    });
  });

  test('rejects stale, wrong-actor, expired and illegal reports', () => {
    expect(
      evaluateActionExecutionReport(execution(), report('accepted', { revision: 2 }), NOW),
    ).toMatchObject({ ok: false, code: 'stale_revision' });
    expect(
      evaluateActionExecutionReport(
        execution({ status: 'accepted', leaseOwner: 'godot:owner-a' }),
        report('acting', { executorId: 'godot:owner-b' }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'lease_owner_mismatch' });
    expect(
      evaluateActionExecutionReport(
        execution(),
        report('accepted', { actorId: 'npc_other' }),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'execution_actor_mismatch' });
    expect(
      evaluateActionExecutionReport(
        execution({ expiresAt: NOW }),
        report('accepted'),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'execution_lease_expired' });
    expect(
      evaluateActionExecutionReport(
        execution({ hardDeadlineAt: NOW }),
        report('accepted'),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'execution_deadline_exceeded' });
    expect(
      evaluateActionExecutionReport(
        execution({ status: 'acting', startedAt: NOW - 9_000 }),
        report('accepted'),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_execution_transition' });
  });

  test('allows explicit interruption/blocking from any active phase', () => {
    for (const status of ['pending', 'accepted', 'acting'] as const) {
      for (const terminal of ['interrupted', 'blocked'] as const) {
        expect(
          evaluateActionExecutionReport(
            execution({ status, startedAt: status === 'acting' ? NOW - 1_000 : undefined }),
            report(terminal, { reasonCode: 'cancelled_by_actor' }),
            NOW,
          ),
        ).toMatchObject({
          ok: true,
          patch: { status: terminal, reasonCode: 'cancelled_by_actor', terminalAt: NOW },
        });
      }
    }
  });

  test('terminal retry is an idempotent acknowledgement and cannot change outcome', () => {
    expect(
      evaluateActionExecutionReport(
        execution({ status: 'completed', startedAt: NOW - 9_000 }),
        report('completed'),
        NOW,
      ),
    ).toEqual({ ok: true, idempotentReplay: true, patch: null });
    expect(
      evaluateActionExecutionReport(
        execution({ status: 'completed', startedAt: NOW - 9_000 }),
        report('interrupted'),
        NOW,
      ),
    ).toMatchObject({ ok: false, code: 'execution_terminal' });
  });

  test('transition table and revision allocation remain deterministic', () => {
    expect(isLegalActionExecutionTransition('pending', 'accepted')).toBe(true);
    expect(isLegalActionExecutionTransition('pending', 'completed')).toBe(false);
    expect(isLegalActionExecutionTransition('acting', 'acting')).toBe(true);
    expect(nextActionExecutionRevision([{ revision: 8 }, { revision: 2 }, { revision: 11 }])).toBe(
      12,
    );
  });
});
