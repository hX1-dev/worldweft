export type AgentTickLeaseState = {
  tickId: string;
  mapId?: string;
  owner: string;
  acquiredAt: number;
  expiresAt: number;
};

export type RecentAgentTick = {
  tickId: string;
  mapId?: string;
  status: 'completed' | 'failed';
  finishedAt: number;
};

export function decideAgentTickLease(args: {
  lease?: AgentTickLeaseState;
  recentTicks?: RecentAgentTick[];
  tickId: string;
  requestedAt?: number;
  now: number;
}) {
  const completed = (args.recentTicks ?? []).find(
    (tick) => tick.tickId === args.tickId && tick.status === 'completed',
  );
  if (completed) {
    return { acquired: false as const, reason: 'tick_already_completed' as const, completed };
  }
  if (args.lease && args.lease.expiresAt > args.now) {
    return {
      acquired: false as const,
      reason:
        args.lease.tickId === args.tickId
          ? ('tick_already_active' as const)
          : ('tick_lease_busy' as const),
      activeLease: args.lease,
    };
  }
  const overlappedCompletedTick = (args.recentTicks ?? [])
    .filter(
      (tick) =>
        tick.tickId !== args.tickId &&
        args.requestedAt !== undefined &&
        args.requestedAt <= tick.finishedAt,
    )
    .at(-1);
  if (overlappedCompletedTick) {
    return {
      acquired: false as const,
      reason: 'tick_lease_busy' as const,
      overlappedCompletedTick,
    };
  }
  return {
    acquired: true as const,
    recoveredExpiredTickId: args.lease?.tickId,
  };
}

export function appendRecentAgentTick(
  recentTicks: RecentAgentTick[] | undefined,
  tick: RecentAgentTick,
  limit = 16,
) {
  return [...(recentTicks ?? []).filter((entry) => entry.tickId !== tick.tickId), tick].slice(
    -limit,
  );
}
