import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import { versionDurableEventFacts } from './durableContracts';
import { appendWorldEvent } from './events';
import {
  LIFE_CALENDAR_VERSION,
  lifeCalendarAt,
  lifeSeasonLabel,
  planLifeSeasonTransitions,
  type LifeSeasonTransition,
} from './lifeCalendarLogic';
import {
  SEASONAL_RESOURCE_VERSION,
  VALLEY_DEW_HERB_RESOURCE_NODE_ID,
  VALLEY_DEW_HERB_SEASONAL_RULE,
  planValleyDewHerbSeasonTransition,
  seasonalResourceEventActionId,
} from './seasonalResourceLogic';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export const getLifeCalendar = query({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config?.lifeCalendarStartedAt === undefined) return null;
    const calendar = lifeCalendarAt(args.now, config.lifeCalendarStartedAt);
    const appliedSeasonIndex = config.lifeCalendarAppliedSeasonIndex ?? 0;
    return {
      ...calendar,
      appliedSeasonIndex,
      pendingSeasonTransitions: Math.max(0, calendar.seasonIndex - appliedSeasonIndex),
    };
  },
});

export const tickLifeCalendar = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();

    if (!config) {
      await ctx.db.insert('xianxiaConfig', {
        worldId: args.worldId,
        autoTickEnabled: false,
        lifeCalendarStartedAt: args.now,
        lifeCalendarAppliedSeasonIndex: 0,
        lifeCalendarAppliedAt: args.now,
      });
      return initializedResult(args.now);
    }

    if (config.lifeCalendarStartedAt === undefined) {
      await ctx.db.patch(config._id, {
        lifeCalendarStartedAt: args.now,
        lifeCalendarAppliedSeasonIndex: 0,
        lifeCalendarAppliedAt: args.now,
      });
      return initializedResult(args.now);
    }

    const appliedSeasonIndex = config.lifeCalendarAppliedSeasonIndex ?? 0;
    const plan = planLifeSeasonTransitions({
      nowMs: args.now,
      startedAtMs: config.lifeCalendarStartedAt,
      appliedSeasonIndex,
    });
    if (plan.transitions.length === 0) {
      return {
        status: 'no_op' as const,
        calendar: lifeCalendarAt(args.now, config.lifeCalendarStartedAt),
        appliedSeasonIndex,
        createdEventCount: 0,
        createdSeasonalResourceEventCount: 0,
        missingSeasonalResourceNodeCount: 0,
        remainingTransitions: 0,
        caughtUp: true,
      };
    }

    let createdEventCount = 0;
    let createdSeasonalResourceEventCount = 0;
    let missingSeasonalResourceNodeCount = 0;
    for (const transition of plan.transitions) {
      const seasonalResult = await applyValleyDewHerbSeasonTransition(
        ctx,
        args.worldId,
        transition,
      );
      if (seasonalResult.created) createdSeasonalResourceEventCount += 1;
      if (seasonalResult.missing) missingSeasonalResourceNodeCount += 1;
      const existing = await ctx.db
        .query('worldEvents')
        .withIndex('byAction', (q) =>
          q.eq('worldId', args.worldId).eq('actionId', transition.eventActionId),
        )
        .first();
      if (existing) continue;
      await appendWorldEvent(ctx, {
        worldId: args.worldId,
        type: 'life_calendar_season_changed',
        createdAt: transition.boundaryAt,
        actorIds: [],
        actionId: transition.eventActionId,
        visibility: 'public',
        summary: `太虚历${transition.year}年${lifeSeasonLabel(transition.toSeason)}季已至。`,
        facts: versionDurableEventFacts({
          resultCode: 'life_calendar_season_changed',
          calendarVersion: LIFE_CALENDAR_VERSION,
          seasonIndex: transition.seasonIndex,
          year: transition.year,
          fromSeason: transition.fromSeason,
          toSeason: transition.toSeason,
          boundaryAt: transition.boundaryAt,
        }),
      });
      createdEventCount += 1;
    }

    const nextAppliedSeasonIndex = plan.transitions.at(-1)!.seasonIndex;
    await ctx.db.patch(config._id, {
      lifeCalendarAppliedSeasonIndex: nextAppliedSeasonIndex,
      lifeCalendarAppliedAt: args.now,
    });
    return {
      status: 'advanced' as const,
      calendar: lifeCalendarAt(args.now, config.lifeCalendarStartedAt),
      appliedSeasonIndex: nextAppliedSeasonIndex,
      createdEventCount,
      createdSeasonalResourceEventCount,
      missingSeasonalResourceNodeCount,
      remainingTransitions: plan.remainingTransitions,
      caughtUp: plan.caughtUp,
    };
  },
});

function initializedResult(now: number) {
  return {
    status: 'initialized' as const,
    calendar: lifeCalendarAt(now, now),
    appliedSeasonIndex: 0,
    createdEventCount: 0,
    createdSeasonalResourceEventCount: 0,
    missingSeasonalResourceNodeCount: 0,
    remainingTransitions: 0,
    caughtUp: true,
  };
}

async function applyValleyDewHerbSeasonTransition(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  transition: LifeSeasonTransition,
): Promise<{ created: boolean; missing: boolean }> {
  const actionId = seasonalResourceEventActionId(
    VALLEY_DEW_HERB_RESOURCE_NODE_ID,
    transition.seasonIndex,
  );
  const existing = await ctx.db
    .query('worldEvents')
    .withIndex('byAction', (q) => q.eq('worldId', worldId).eq('actionId', actionId))
    .first();
  if (existing) return { created: false, missing: false };

  const node = await ctx.db
    .query('resourceNodes')
    .withIndex('byNode', (q) =>
      q.eq('worldId', worldId).eq('resourceNodeId', VALLEY_DEW_HERB_RESOURCE_NODE_ID),
    )
    .first();
  if (!node) {
    return { created: false, missing: true };
  }

  const planned = planValleyDewHerbSeasonTransition(node, transition);
  await ctx.db.patch(node._id, {
    stock: planned.stockAfter,
    nextRefreshAt: planned.nextRefreshAt,
    refreshBlockedUntil: planned.refreshBlockedUntil,
    refreshBlockedByPressureId: planned.refreshBlockedByPressureId,
    seasonalContractVersion: SEASONAL_RESOURCE_VERSION,
    seasonalRule: VALLEY_DEW_HERB_SEASONAL_RULE,
    seasonalState: planned.seasonalState,
    seasonalAppliedSeasonIndex: planned.seasonalAppliedSeasonIndex,
    seasonalRefreshBlockedUntil: planned.seasonalRefreshBlockedUntil,
    updatedAt: Math.max(node.updatedAt, transition.boundaryAt),
  });
  await appendWorldEvent(ctx, {
    worldId,
    type: 'seasonal_resource_transition_applied',
    createdAt: transition.boundaryAt,
    actorIds: [],
    locationId: node.locationId,
    actionId,
    visibility: 'public',
    summary:
      planned.seasonalState === 'dormant'
        ? `${node.name}入冬休眠，现存灵草保留，下一次自然恢复等到春季。`
        : `${node.name}进入${lifeSeasonLabel(transition.toSeason)}季生长状态，按有限容量继续恢复。`,
    facts: versionDurableEventFacts({
      resultCode: 'seasonal_resource_transition_applied',
      seasonalResourceVersion: SEASONAL_RESOURCE_VERSION,
      seasonalRule: VALLEY_DEW_HERB_SEASONAL_RULE,
      resourceNodeId: node.resourceNodeId,
      seasonIndex: transition.seasonIndex,
      year: transition.year,
      fromSeason: transition.fromSeason,
      toSeason: transition.toSeason,
      seasonalState: planned.seasonalState,
      boundaryAt: transition.boundaryAt,
      capacity: planned.capacity,
      stockBefore: planned.stockBefore,
      stockAfter: planned.stockAfter,
      replenished: planned.replenished,
      nextRefreshAt: planned.nextRefreshAt,
      refreshBlockedUntil: planned.refreshBlockedUntil,
      seasonalRefreshBlockedUntil: planned.seasonalRefreshBlockedUntil,
    }),
    mapId: node.mapId,
  });
  return { created: true, missing: false };
}
