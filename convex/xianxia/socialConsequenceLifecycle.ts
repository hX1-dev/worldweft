import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { readGameHour } from './config';
import {
  MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK,
  planSocialConsequenceLifecycle,
} from './socialConsequenceLifecycleLogic';

/**
 * Persists time-driven consequence invalidation before an Agent can observe
 * or admit a new candidate. It is bounded and replay-safe; cron remains off.
 */
export const tickSocialConsequenceLifecycle = internalMutation({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.now) || args.now < 0) {
      throw new Error('social_consequence_lifecycle_invalid_now');
    }
    const gameHour = await readGameHour(ctx, args.worldId, args.now);
    const rows = await ctx.db
      .query('socialConsequences')
      .withIndex('byExpiry', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('status', 'active')
          .lte('expiresGameHour', gameHour))
      .take(MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK + 1);
    const plan = planSocialConsequenceLifecycle({
      gameHour,
      consequences: rows.map((row) => ({
        consequenceId: row.consequenceId,
        revision: row.revision,
        status: row.status,
        remainingProjectionBudget: row.remainingProjectionBudget,
        expiresGameHour: row.expiresGameHour,
        terminalGameHour: row.terminalGameHour,
        terminalReasonCode: row.terminalReasonCode,
      })),
    });
    const byConsequenceId = new Map(rows.map((row) => [row.consequenceId, row]));
    for (const transition of plan.transitions) {
      const row = byConsequenceId.get(transition.consequenceId);
      if (!row || row.status !== 'active' || row.revision !== transition.previousRevision) {
        throw new Error('social_consequence_lifecycle_invalid_row');
      }
      await ctx.db.patch(row._id, {
        status: transition.status,
        revision: transition.revision,
        remainingProjectionBudget: transition.remainingProjectionBudget,
        terminalGameHour: transition.terminalGameHour,
        terminalReasonCode: transition.terminalReasonCode,
        updatedAt: args.now,
      });
    }
    return {
      ...plan,
      processed: plan.transitions.length,
    };
  },
});
