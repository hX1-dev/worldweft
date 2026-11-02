import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { ensureIncapacitationRecovery } from './actions';
import {
  needsIncapacitationRecoveryEnrollment,
} from './lifeStateLogic';
export {
  isAutonomousAgentEligible,
  isGodotControlledActorId,
  selectBoundedRoundRobinActorIds,
  selectRoundRobinActorIds,
  shouldRunAutonomousAgentTick,
} from './agentTickSchedulerPolicy';
import {
  isAutonomousAgentEligible,
  selectBoundedRoundRobinActorIds,
} from './agentTickSchedulerPolicy';

const ALL_MAPS_SCOPE = '*';
const AGENT_TICK_SCAN_LIMIT = 128;

export type AgentTickReservation = {
  scope: string;
  actorIds: string[];
  eligibleCount: number;
  startAfterActorId?: string;
  nextAfterActorId?: string;
  wrapped: boolean;
  scannedCount?: number;
  eligibleCountExact?: boolean;
  recoveryEnrollments?: number;
};

export const reserveAgentTickActors = internalMutation({
  args: {
    worldId: v.id('worlds'),
    limit: v.optional(v.number()),
    mapId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AgentTickReservation> => {
    const scope = args.mapId ?? ALL_MAPS_SCOPE;
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    const cursors = [...(config?.agentTickCursors ?? [])];
    const cursorIndex = cursors.findIndex((cursor) => cursor.scope === scope);
    const afterActorId = cursorIndex >= 0 ? cursors[cursorIndex].afterActorId : undefined;
    const afterProfiles = args.mapId
      ? await ctx.db
          .query('xianxiaProfiles')
          .withIndex('byMap', (q) =>
            afterActorId
              ? q.eq('worldId', args.worldId).eq('mapId', args.mapId).gt('actorId', afterActorId)
              : q.eq('worldId', args.worldId).eq('mapId', args.mapId),
          )
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT)
      : await ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) =>
            afterActorId
              ? q.eq('worldId', args.worldId).gt('actorId', afterActorId)
              : q.eq('worldId', args.worldId),
          )
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT);
    const beginningProfiles = args.mapId
      ? await ctx.db
          .query('xianxiaProfiles')
          .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', args.mapId))
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT)
      : await ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) => q.eq('worldId', args.worldId))
          .order('asc')
          .take(AGENT_TICK_SCAN_LIMIT);
    const recoveryEnrollmentNow = Date.now();
    const scannedProfiles = new Map(
      [...afterProfiles, ...beginningProfiles].map((profile) => [String(profile._id), profile]),
    );
    let recoveryEnrollments = 0;
    for (const profile of scannedProfiles.values()) {
      if (!needsIncapacitationRecoveryEnrollment(profile)) continue;
      if (await ensureIncapacitationRecovery(ctx, profile, recoveryEnrollmentNow)) {
        recoveryEnrollments++;
      }
    }
    const requestedLimit = Math.min(8, Math.max(1, Math.floor(args.limit ?? 4)));
    const afterEligible = afterProfiles.filter(isAutonomousAgentEligible);
    const beginningEligible = beginningProfiles.filter(isAutonomousAgentEligible);
    // 尚未扫到索引尾端时不提前回卷；若当前 128 条里大多失能，则推进扫描游标，
    // 避免前一窗口的失能者让后面的健康角色永久饥饿。
    const reachedEnd = afterProfiles.length < AGENT_TICK_SCAN_LIMIT;
    const actorIds = selectBoundedRoundRobinActorIds(
      afterEligible.map((profile) => profile.actorId),
      reachedEnd ? beginningEligible.map((profile) => profile.actorId) : [],
      requestedLimit,
    );
    const selectedFromAfter = actorIds.filter((actorId) =>
      afterEligible.some((profile) => profile.actorId === actorId),
    );
    const mustAdvancePastIneligibleWindow =
      !reachedEnd && selectedFromAfter.length < requestedLimit;
    const nextAfterActorId = mustAdvancePastIneligibleWindow
      ? (afterProfiles.at(-1)?.actorId ?? afterActorId)
      : (actorIds.at(-1) ??
        afterProfiles.at(-1)?.actorId ??
        beginningProfiles.at(-1)?.actorId ??
        afterActorId);
    const selected: Omit<AgentTickReservation, 'scope'> = {
      actorIds,
      eligibleCount: beginningEligible.length,
      startAfterActorId: afterActorId,
      nextAfterActorId,
      wrapped:
        Boolean(afterActorId) && actorIds.some((actorId) => actorId <= (afterActorId ?? actorId)),
      scannedCount: afterProfiles.length + beginningProfiles.length,
      eligibleCountExact: beginningProfiles.length < AGENT_TICK_SCAN_LIMIT,
      recoveryEnrollments,
    };

    if (selected.nextAfterActorId && selected.nextAfterActorId !== afterActorId) {
      const cursor = {
        scope,
        afterActorId: selected.nextAfterActorId,
        updatedAt: Date.now(),
      };
      if (cursorIndex >= 0) cursors[cursorIndex] = cursor;
      else cursors.push(cursor);
      if (config) await ctx.db.patch(config._id, { agentTickCursors: cursors });
      else {
        await ctx.db.insert('xianxiaConfig', {
          worldId: args.worldId,
          autoTickEnabled: false,
          agentTickCursors: cursors,
        });
      }
    }

    return { scope, ...selected };
  },
});
