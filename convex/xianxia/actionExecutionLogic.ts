import {
  ACTION_EXECUTION_LEASE_MS,
  ACTIVE_ACTION_EXECUTION_STATUSES,
  TERMINAL_ACTION_EXECUTION_STATUSES,
  type ActionExecutionProtocolFailure,
  type ActionExecutionReport,
  type ActionExecutionReportStatus,
  type ActionExecutionStatus,
} from './actionExecutionContracts';

export type ActionExecutionSnapshot = {
  revision: number;
  actorId: string;
  status: ActionExecutionStatus;
  durationMs: number;
  leaseOwner?: string;
  hardDeadlineAt: number;
  lastMapId?: string;
  lastTile?: { x: number; y: number };
  acceptedAt?: number;
  startedAt?: number;
  lastHeartbeatAt?: number;
  issuedAt: number;
  expiresAt: number;
};

export type ActionExecutionReportDecision =
  | {
      ok: true;
      idempotentReplay: boolean;
      patch: null | {
        status: ActionExecutionReportStatus;
        acceptedAt?: number;
        startedAt?: number;
        leaseOwner?: string;
        lastMapId?: string;
        lastTile?: { x: number; y: number };
        lastHeartbeatAt?: number;
        terminalAt?: number;
        updatedAt: number;
        expiresAt: number;
        reasonCode?: string;
      };
    }
  | ActionExecutionProtocolFailure;

export function evaluateActionExecutionReport(
  execution: ActionExecutionSnapshot,
  report: ActionExecutionReport,
  now: number,
): ActionExecutionReportDecision {
  if (report.revision !== execution.revision) {
    return failure('stale_revision', 'The action execution revision is no longer current.');
  }
  if (report.actorId !== execution.actorId) {
    return failure('execution_actor_mismatch', 'The report actor does not own this execution.');
  }
  if (execution.leaseOwner && report.executorId !== execution.leaseOwner) {
    return failure('lease_owner_mismatch', 'The report executor does not own this lease.');
  }
  if (TERMINAL_ACTION_EXECUTION_STATUSES.has(execution.status)) {
    if (report.status === execution.status) {
      return { ok: true, idempotentReplay: true, patch: null };
    }
    return failure('execution_terminal', `The execution is already ${execution.status}.`);
  }
  if (execution.expiresAt <= now) {
    return failure('execution_lease_expired', 'The action execution lease has expired.');
  }
  if (execution.hardDeadlineAt <= now) {
    return failure('execution_deadline_exceeded', 'The action execution hard deadline has passed.');
  }
  if (!isLegalActionExecutionTransition(execution.status, report.status)) {
    return failure(
      'invalid_execution_transition',
      `Action execution cannot transition from ${execution.status} to ${report.status}.`,
    );
  }

  if (report.status === 'completed') {
    if (execution.startedAt === undefined) {
      return failure('execution_not_ready', 'The action execution has not started acting.');
    }
    const completesAt = execution.startedAt + execution.durationMs;
    if (now < completesAt) {
      return failure(
        'execution_not_ready',
        `The action execution cannot complete before ${completesAt}.`,
      );
    }
  }

  const active = ACTIVE_ACTION_EXECUTION_STATUSES.has(report.status);
  const patch = {
    status: report.status,
    acceptedAt:
      report.status === 'accepted' && execution.acceptedAt === undefined
        ? now
        : execution.acceptedAt,
    startedAt:
      report.status === 'acting' && execution.startedAt === undefined
        ? now
        : execution.startedAt,
    leaseOwner:
      report.status === 'accepted' && execution.leaseOwner === undefined
        ? report.executorId
        : execution.leaseOwner,
    lastMapId: report.mapId ?? execution.lastMapId,
    lastTile: report.positionTiles ?? execution.lastTile,
    lastHeartbeatAt: active ? now : execution.lastHeartbeatAt,
    terminalAt: active ? undefined : now,
    updatedAt: now,
    expiresAt: active
      ? Math.min(now + ACTION_EXECUTION_LEASE_MS, execution.hardDeadlineAt)
      : execution.expiresAt,
    reasonCode: report.reasonCode,
  };
  return { ok: true, idempotentReplay: false, patch };
}

export function isLegalActionExecutionTransition(
  current: ActionExecutionStatus,
  next: ActionExecutionReportStatus,
) {
  if (current === 'pending') {
    return next === 'accepted' || next === 'interrupted' || next === 'blocked';
  }
  if (current === 'accepted') {
    return (
      next === 'accepted' ||
      next === 'acting' ||
      next === 'interrupted' ||
      next === 'blocked'
    );
  }
  if (current === 'acting') {
    return (
      next === 'acting' ||
      next === 'completed' ||
      next === 'interrupted' ||
      next === 'blocked'
    );
  }
  return false;
}

export function nextActionExecutionRevision(executions: readonly { revision: number }[]) {
  return executions.reduce((highest, execution) => Math.max(highest, execution.revision), 0) + 1;
}

function failure(
  code: ActionExecutionProtocolFailure['code'],
  reason: string,
): ActionExecutionProtocolFailure {
  return { ok: false, code, reason };
}
