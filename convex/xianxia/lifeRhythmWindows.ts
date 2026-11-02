import { v } from 'convex/values';
import { internalMutation, query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { gameTimeAt } from './timeLogic';
import {
  LIFE_RHYTHM_WINDOW_VERSION,
  buildLifeRhythmWindow,
  planLifeRhythmWindows,
  sameLifeRhythmWindow,
  type LifeRhythmCadence,
  type LifeRhythmWindowTransition,
} from './lifeRhythmWindowLogic';

/**
 * Materializes completed daily/weekly scene-clock windows before Agent
 * observation. The mutation is deliberately provider=0 and effect-free apart
 * from its own window rows and cursors.
 */
export const tickLifeRhythmWindows = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertNow(args.now);
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config?.clockStartedAt === undefined) {
      return unavailableResult();
    }
    const clockStartedAt = config.clockStartedAt;
    const appliedDayIndex = config.lifeRhythmAppliedDayIndex ?? 0;
    const appliedWeekIndex = config.lifeRhythmAppliedWeekIndex ?? 0;
    await assertCursorIntegrity(ctx, args.worldId, 'daily', appliedDayIndex, clockStartedAt);
    await assertCursorIntegrity(ctx, args.worldId, 'weekly', appliedWeekIndex, clockStartedAt);

    const totalGameHours = gameTimeAt(args.now, clockStartedAt).totalHours;
    const plan = planLifeRhythmWindows({
      totalGameHours,
      clockStartedAt,
      appliedDayIndex,
      appliedWeekIndex,
    });
    let createdWindowCount = 0;
    for (const transition of plan.transitions) {
      const matches = await ctx.db
        .query('lifeRhythmWindows')
        .withIndex('byWindow', (q) =>
          q.eq('worldId', args.worldId).eq('windowId', transition.windowId))
        .take(2);
      if (matches.length > 1) throw new Error('life_rhythm_duplicate_window');
      const existing = matches[0];
      if (existing) {
        if (!sameLifeRhythmWindow(rowAsTransition(existing), transition)) {
          throw new Error('life_rhythm_window_conflict');
        }
        continue;
      }
      await ctx.db.insert('lifeRhythmWindows', {
        worldId: args.worldId,
        contractVersion: LIFE_RHYTHM_WINDOW_VERSION,
        ...transition,
        recordedAt: args.now,
      });
      createdWindowCount += 1;
    }
    if (plan.transitions.length > 0) {
      await ctx.db.patch(config._id, {
        lifeRhythmAppliedDayIndex: plan.nextAppliedDayIndex,
        lifeRhythmAppliedWeekIndex: plan.nextAppliedWeekIndex,
        lifeRhythmAppliedAt: args.now,
      });
    }
    return {
      status: plan.transitions.length > 0 ? 'advanced' as const : 'no_op' as const,
      ...plan,
      processed: plan.transitions.length,
      createdWindowCount,
    };
  },
});

export const getLifeRhythmWindowState = query({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertNow(args.now);
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config?.clockStartedAt === undefined) return null;
    const recentWindows = await ctx.db
      .query('lifeRhythmWindows')
      .withIndex('byRecordedAt', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(16);
    const totalGameHours = gameTimeAt(args.now, config.clockStartedAt).totalHours;
    return {
      contractVersion: LIFE_RHYTHM_WINDOW_VERSION,
      clockStartedAt: config.clockStartedAt,
      totalGameHours,
      targetDayIndex: Math.floor(totalGameHours / 24),
      targetWeekIndex: Math.floor(totalGameHours / (7 * 24)),
      appliedDayIndex: config.lifeRhythmAppliedDayIndex ?? 0,
      appliedWeekIndex: config.lifeRhythmAppliedWeekIndex ?? 0,
      recentWindows,
    };
  },
});

async function assertCursorIntegrity(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  cadence: LifeRhythmCadence,
  cursor: number,
  clockStartedAt: number,
) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('life_rhythm_invalid_cursor');
  const latest = await ctx.db
    .query('lifeRhythmWindows')
    .withIndex('byCadencePeriod', (q) =>
      q.eq('worldId', worldId).eq('cadence', cadence))
    .order('desc')
    .first();
  if (cursor === 0) {
    if (latest) throw new Error('life_rhythm_cursor_gap');
    return;
  }
  if (!latest || latest.periodIndex !== cursor) throw new Error('life_rhythm_cursor_gap');
  const duplicates = await ctx.db
    .query('lifeRhythmWindows')
    .withIndex('byCadencePeriod', (q) =>
      q.eq('worldId', worldId).eq('cadence', cadence).eq('periodIndex', cursor))
    .take(2);
  if (duplicates.length !== 1) throw new Error('life_rhythm_duplicate_window');
  const expected = buildLifeRhythmWindow(cadence, cursor, clockStartedAt);
  if (!sameLifeRhythmWindow(rowAsTransition(duplicates[0]), expected)) {
    const reason = duplicates[0].clockStartedAt !== clockStartedAt
      ? 'life_rhythm_clock_anchor_drift'
      : 'life_rhythm_window_conflict';
    throw new Error(reason);
  }
}

function rowAsTransition(row: {
  windowId: string;
  cadence: LifeRhythmCadence;
  periodIndex: number;
  windowStartGameHour: number;
  windowEndGameHour: number;
  clockStartedAt: number;
  status: 'closed';
  providerCalls: 0;
  createdWorldActions: 0;
  createdSocialCandidates: 0;
  windowDigest: string;
}): LifeRhythmWindowTransition {
  return {
    windowId: row.windowId,
    cadence: row.cadence,
    periodIndex: row.periodIndex,
    windowStartGameHour: row.windowStartGameHour,
    windowEndGameHour: row.windowEndGameHour,
    clockStartedAt: row.clockStartedAt,
    status: row.status,
    providerCalls: row.providerCalls,
    createdWorldActions: row.createdWorldActions,
    createdSocialCandidates: row.createdSocialCandidates,
    windowDigest: row.windowDigest,
  };
}

function unavailableResult() {
  return {
    status: 'unavailable' as const,
    reasonCode: 'life_rhythm_clock_unavailable' as const,
    contractVersion: LIFE_RHYTHM_WINDOW_VERSION,
    processed: 0,
    createdWindowCount: 0,
    remainingWindows: 0,
    caughtUp: true,
  };
}

function assertNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('life_rhythm_invalid_time');
}
