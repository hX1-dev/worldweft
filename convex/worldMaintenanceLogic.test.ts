import {
  deadWorldAction,
  heartbeatWorldAction,
  inactiveWorldAction,
  orphanedWorldAction,
} from './worldMaintenanceLogic';

describe('world maintenance lifecycle convergence', () => {
  test.each([
    ['stoppedByDeveloper', false, 'none'],
    ['stoppedByDeveloper', true, 'none'],
    ['inactive', false, 'start'],
    ['inactive', true, 'mark_running'],
    ['running', false, 'start'],
    ['running', true, 'none'],
  ] as const)(
    'heartbeat %s with engine running=%s chooses %s',
    (status, engineRunning, expected) => {
      expect(
        heartbeatWorldAction({ status, engineRunning }),
      ).toBe(expected);
    },
  );

  test.each([
    ['stoppedByDeveloper', false, 0, 'none'],
    ['stoppedByDeveloper', true, 0, 'none'],
    ['inactive', false, 0, 'none'],
    ['inactive', true, 0, 'none'],
    ['running', false, 101, 'none'],
    ['running', true, 101, 'none'],
    ['running', false, 100, 'mark_inactive'],
    ['running', true, 100, 'stop'],
  ] as const)(
    'inactive check %s running=%s lastViewed=%s chooses %s',
    (status, engineRunning, lastViewed, expected) => {
      expect(
        inactiveWorldAction({
          status,
          engineRunning,
          lastViewed,
          cutoff: 100,
        }),
      ).toBe(expected);
    },
  );

  test.each([
    ['stoppedByDeveloper', false, 0, 'none'],
    ['stoppedByDeveloper', true, 0, 'none'],
    ['inactive', false, 0, 'none'],
    ['inactive', true, 0, 'none'],
    ['running', false, 0, 'start'],
    ['running', false, 101, 'start'],
    ['running', true, undefined, 'kick'],
    ['running', true, 99, 'kick'],
    ['running', true, 100, 'none'],
  ] as const)(
    'dead check %s running=%s currentTime=%s chooses %s',
    (status, engineRunning, engineCurrentTime, expected) => {
      expect(
        deadWorldAction({
          status,
          engineRunning,
          engineCurrentTime,
          engineTimeout: 100,
        }),
      ).toBe(expected);
    },
  );

  test('converged replay is a no-op', () => {
    expect(
      inactiveWorldAction({
        status: 'inactive',
        engineRunning: false,
        lastViewed: 0,
        cutoff: 100,
      }),
    ).toBe('none');
    expect(
      deadWorldAction({
        status: 'running',
        engineRunning: true,
        engineCurrentTime: 100,
        engineTimeout: 100,
      }),
    ).toBe('none');
  });

  test.each([
    [true, false, false, 'running', 'none'],
    [true, true, true, 'running', 'none'],
    [false, true, false, 'inactive', 'reject_default'],
    [false, true, true, 'running', 'reject_default'],
    [false, false, false, 'inactive', 'none'],
    [false, false, false, 'running', 'mark_inactive'],
    [false, false, true, 'inactive', 'stop_and_mark_inactive'],
    [false, false, true, 'running', 'stop_and_mark_inactive'],
  ] as const)(
    'orphan check exists=%s default=%s running=%s status=%s chooses %s',
    (worldExists, isDefault, engineRunning, status, expected) => {
      expect(
        orphanedWorldAction({
          worldExists,
          isDefault,
          engineRunning,
          status,
        }),
      ).toBe(expected);
    },
  );
});
