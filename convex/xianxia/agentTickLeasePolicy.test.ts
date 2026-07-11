import {
  appendRecentAgentTick,
  decideAgentTickLease,
  type RecentAgentTick,
} from './agentTickLeasePolicy';

describe('agent tick lease policy', () => {
  const active = {
    tickId: 'tick-a',
    mapId: 'qinglan',
    owner: 'test',
    acquiredAt: 100,
    expiresAt: 500,
  };

  test('rejects overlapping and duplicate active ticks', () => {
    expect(decideAgentTickLease({ lease: active, tickId: 'tick-b', now: 200 })).toMatchObject({
      acquired: false,
      reason: 'tick_lease_busy',
    });
    expect(decideAgentTickLease({ lease: active, tickId: 'tick-a', now: 200 })).toMatchObject({
      acquired: false,
      reason: 'tick_already_active',
    });
  });

  test('recovers an expired lease and rejects a completed tick id', () => {
    expect(decideAgentTickLease({ lease: active, tickId: 'tick-b', now: 600 })).toEqual({
      acquired: true,
      recoveredExpiredTickId: 'tick-a',
    });
    expect(
      decideAgentTickLease({
        recentTicks: [{ tickId: 'tick-b', status: 'completed', finishedAt: 550 }],
        tickId: 'tick-b',
        now: 600,
      }),
    ).toMatchObject({ acquired: false, reason: 'tick_already_completed' });
  });

  test('rejects a request that arrived before a prior tick finished', () => {
    expect(
      decideAgentTickLease({
        recentTicks: [{ tickId: 'tick-a', status: 'completed', finishedAt: 550 }],
        tickId: 'tick-b',
        requestedAt: 500,
        now: 600,
      }),
    ).toMatchObject({
      acquired: false,
      reason: 'tick_lease_busy',
      overlappedCompletedTick: { tickId: 'tick-a' },
    });
    expect(
      decideAgentTickLease({
        recentTicks: [{ tickId: 'tick-a', status: 'completed', finishedAt: 550 }],
        tickId: 'tick-b',
        requestedAt: 551,
        now: 600,
      }),
    ).toMatchObject({ acquired: true });
  });

  test('keeps a bounded deduplicated completion window', () => {
    let ticks: RecentAgentTick[] = Array.from({ length: 16 }, (_, index) => ({
      tickId: `tick-${index}`,
      status: 'completed' as const,
      finishedAt: index,
    }));
    ticks = appendRecentAgentTick(ticks, {
      tickId: 'tick-8',
      status: 'failed',
      finishedAt: 20,
    });
    expect(ticks).toHaveLength(16);
    expect(ticks.at(-1)).toMatchObject({ tickId: 'tick-8', status: 'failed' });
    expect(ticks.filter((tick) => tick.tickId === 'tick-8')).toHaveLength(1);
  });
});
