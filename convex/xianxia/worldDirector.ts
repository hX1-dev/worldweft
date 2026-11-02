import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { readClockStartedAt } from './config';
import { gameTimeAt, MS_PER_GAME_HOUR } from './timeLogic';
import {
  WORLD_PRESSURE_CONTRACT_VERSION,
  WORLD_PRESSURE_LIMITS,
  type WorldDirectorTickResult,
} from './worldPressureContracts';
import {
  selectHerbMiasmaScope,
  shouldResolveWorldPressure,
  worldDirectorStartGate,
} from './worldPressureLogic';

const MAX_DIRECTOR_RESOURCE_NODES = 256;

export const tickWorldDirector = internalMutation({
  args: {
    worldId: v.id('worlds'),
    mapId: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<WorldDirectorTickResult> => {
    const now = args.now ?? Date.now();
    const clockStartedAt = await readClockStartedAt(ctx, args.worldId);
    const nowGameHour =
      clockStartedAt === null ? 0 : gameTimeAt(now, clockStartedAt).totalHours;
    const active = await ctx.db
      .query('worldPressures')
      .withIndex('byWorldStatus', (q) =>
        q.eq('worldId', args.worldId).eq('status', 'active'),
      )
      .order('asc')
      .collect();

    // Resolve before checking the enable switch. Turning off the director must
    // never strand an existing pressure or its resource blocker.
    const expired = active.find((pressure) =>
      shouldResolveWorldPressure(pressure, nowGameHour) || pressure.endsAt <= now,
    );
    if (expired) {
      const terminalEventId = await appendWorldEvent(ctx, {
        worldId: args.worldId,
        type: 'world_pressure_resolved',
        createdAt: now,
        actorIds: [],
        locationId: expired.locationId,
        visibility: 'public',
        summary: `${expired.locationId}一带的药瘴已散，灵草将按原有节律恢复。`,
        facts: versionDurableEventFacts({
          resultCode: 'world_pressure_resolved',
          pressureId: expired.pressureId,
          revision: expired.revision,
          pressureKind: expired.kind,
          pressureStatus: 'resolved',
          severity: expired.severity,
          affectedResourceNodeIds: expired.affectedResourceNodeIds,
          effectCodes: expired.effectCodes,
          startsAtGameHour: expired.startsAtGameHour,
          endsAtGameHour: expired.endsAtGameHour,
          sourceEventId: String(expired.sourceEventId),
        }),
        mapId: expired.mapId,
      });
      for (const resourceNodeId of expired.affectedResourceNodeIds) {
        const node = await ctx.db
          .query('resourceNodes')
          .withIndex('byNode', (q) =>
            q.eq('worldId', args.worldId).eq('resourceNodeId', resourceNodeId),
          )
          .first();
        if (node?.refreshBlockedByPressureId === expired.pressureId) {
          await ctx.db.patch(node._id, {
            refreshBlockedUntil: undefined,
            refreshBlockedByPressureId: undefined,
            updatedAt: now,
          });
        }
      }
      await ctx.db.patch(expired._id, {
        status: 'resolved',
        terminalEventId,
        terminalReason: 'duration_elapsed',
        updatedAt: now,
      });
      return {
        outcome: 'resolved',
        pressureId: expired.pressureId,
        terminalEventId: String(terminalEventId),
      };
    }

    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    const gate = worldDirectorStartGate({
      enabled: config?.worldDirectorEnabled ?? false,
      activePressureCount: active.length,
      nowGameHour,
      nextEligibleGameHour: config?.worldDirectorNextEligibleGameHour,
    });
    if (!gate.ok) {
      return {
        outcome: gate.reason,
        pressureId: active[0]?.pressureId,
        nextEligibleGameHour: config?.worldDirectorNextEligibleGameHour,
      };
    }

    const nodes = await ctx.db
      .query('resourceNodes')
      .withIndex('byMap', (q) =>
        args.mapId
          ? q.eq('worldId', args.worldId).eq('mapId', args.mapId)
          : q.eq('worldId', args.worldId),
      )
      .take(MAX_DIRECTOR_RESOURCE_NODES);
    const scope = selectHerbMiasmaScope(nodes, args.mapId);
    if (!scope) return { outcome: 'no_compatible_scope' };

    const pressureId =
      `pressure:herb_miasma:${now}:${scope.mapId}:${scope.locationId}`;
    const endsAtGameHour =
      nowGameHour + WORLD_PRESSURE_LIMITS.durationGameHours;
    const endsAt =
      now + WORLD_PRESSURE_LIMITS.durationGameHours * MS_PER_GAME_HOUR;
    const cooldownEndsAtGameHour =
      nowGameHour + WORLD_PRESSURE_LIMITS.cooldownGameHours;
    const sourceEventId = await appendWorldEvent(ctx, {
      worldId: args.worldId,
      type: 'world_pressure_started',
      createdAt: now,
      actorIds: [],
      locationId: scope.locationId,
      visibility: 'public',
      summary: `${scope.locationId}药坡升起瘴气，灵草不会消失，但下一次恢复将延后。`,
      facts: versionDurableEventFacts({
        resultCode: 'world_pressure_started',
        pressureId,
        revision: 1,
        pressureKind: 'herb_miasma',
        pressureStatus: 'active',
        severity: WORLD_PRESSURE_LIMITS.severity,
        affectedResourceNodeIds: scope.affectedResourceNodeIds,
        effectCodes: ['resource_refresh_delayed'],
        startsAtGameHour: nowGameHour,
        endsAtGameHour,
      }),
      mapId: scope.mapId,
    });
    await ctx.db.insert('worldPressures', {
      worldId: args.worldId,
      contractVersion: WORLD_PRESSURE_CONTRACT_VERSION,
      pressureId,
      revision: 1,
      kind: 'herb_miasma',
      status: 'active',
      mapId: scope.mapId,
      locationId: scope.locationId,
      affectedResourceNodeIds: scope.affectedResourceNodeIds,
      severity: WORLD_PRESSURE_LIMITS.severity,
      effectCodes: ['resource_refresh_delayed'],
      maximumAffectedResourceNodes:
        WORLD_PRESSURE_LIMITS.affectedResourceNodes,
      startedAt: now,
      startsAtGameHour: nowGameHour,
      endsAt,
      endsAtGameHour,
      cooldownEndsAtGameHour,
      sourceEventId,
      updatedAt: now,
    });
    for (const resourceNodeId of scope.affectedResourceNodeIds) {
      const node = await ctx.db
        .query('resourceNodes')
        .withIndex('byNode', (q) =>
          q.eq('worldId', args.worldId).eq('resourceNodeId', resourceNodeId),
        )
        .first();
      if (!node) continue;
      await ctx.db.patch(node._id, {
        refreshBlockedUntil: endsAt,
        refreshBlockedByPressureId: pressureId,
        nextRefreshAt:
          node.stock < node.capacity
            ? Math.max(
                node.nextRefreshAt ?? endsAt,
                endsAt,
                node.seasonalRefreshBlockedUntil ?? Number.NEGATIVE_INFINITY,
              )
            : node.nextRefreshAt,
        updatedAt: now,
      });
    }
    if (config) {
      await ctx.db.patch(config._id, {
        worldDirectorNextEligibleGameHour: cooldownEndsAtGameHour,
      });
    }
    return {
      outcome: 'started',
      pressureId,
      sourceEventId: String(sourceEventId),
      affectedResourceNodeIds: scope.affectedResourceNodeIds,
    };
  },
});
