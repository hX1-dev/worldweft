export type WorldLifecycleStatus =
  | 'running'
  | 'inactive'
  | 'stoppedByDeveloper';

export type WorldHeartbeatAction =
  | 'none'
  | 'mark_running'
  | 'start';

export type InactiveWorldAction =
  | 'none'
  | 'mark_inactive'
  | 'stop';

export type DeadWorldAction =
  | 'none'
  | 'start'
  | 'kick';

export type OrphanedWorldAction =
  | 'none'
  | 'reject_default'
  | 'mark_inactive'
  | 'stop_and_mark_inactive';

export function orphanedWorldAction(input: {
  worldExists: boolean;
  isDefault: boolean;
  engineRunning: boolean;
  status: WorldLifecycleStatus;
}): OrphanedWorldAction {
  if (input.worldExists) {
    return 'none';
  }
  if (input.isDefault) {
    return 'reject_default';
  }
  if (!input.engineRunning && input.status === 'inactive') {
    return 'none';
  }
  return input.engineRunning
    ? 'stop_and_mark_inactive'
    : 'mark_inactive';
}

export function heartbeatWorldAction(input: {
  status: WorldLifecycleStatus;
  engineRunning: boolean;
}): WorldHeartbeatAction {
  if (input.status === 'stoppedByDeveloper') {
    return 'none';
  }
  if (input.status === 'inactive') {
    return input.engineRunning ? 'mark_running' : 'start';
  }
  return input.engineRunning ? 'none' : 'start';
}

export function inactiveWorldAction(input: {
  status: WorldLifecycleStatus;
  engineRunning: boolean;
  lastViewed: number;
  cutoff: number;
}): InactiveWorldAction {
  if (
    input.status !== 'running' ||
    input.lastViewed > input.cutoff
  ) {
    return 'none';
  }
  return input.engineRunning ? 'stop' : 'mark_inactive';
}

export function deadWorldAction(input: {
  status: WorldLifecycleStatus;
  engineRunning: boolean;
  engineCurrentTime: number | undefined;
  engineTimeout: number;
}): DeadWorldAction {
  if (input.status !== 'running') {
    return 'none';
  }
  if (!input.engineRunning) {
    return 'start';
  }
  return input.engineCurrentTime === undefined ||
    input.engineCurrentTime < input.engineTimeout
    ? 'kick'
    : 'none';
}
