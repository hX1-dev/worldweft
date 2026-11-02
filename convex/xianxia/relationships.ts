import { v } from 'convex/values';
import { query } from '../_generated/server';
import { readGameHour } from './config';
import { relationshipDimsAt } from './relationshipLogic';

// 关系查询（M4）。展示某角色对他人的关系值（-100 敌对 / 0 陌生 / 100 生死之交）。

export const listRelationships = query({
  args: { worldId: v.id('worlds'), fromActorId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const [rows, holder, nowGameHour] = await Promise.all([
      ctx.db
      .query('relationships')
      .withIndex('from', (q) => q.eq('worldId', args.worldId).eq('fromActorId', args.fromActorId))
      .collect(),
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.fromActorId))
        .first(),
      readGameHour(ctx, args.worldId, args.now),
    ]);
    const gameDay = Math.floor(nowGameHour / 24);
    return rows.map((row) => {
      const effective = relationshipDimsAt(
        { affinity: row.value, trust: row.trust, suspicion: row.suspicion, debt: row.debt, fear: row.fear },
        row.lastTouchedDay,
        gameDay,
        holder?.innerTrait ?? '',
        holder?.outerTrait ?? '',
        row.dimensionTouchedDays,
      );
      return {
        ...row,
        value: effective.affinity,
        trust: effective.trust,
        suspicion: effective.suspicion,
        debt: effective.debt,
        fear: effective.fear,
        effectiveAtGameDay: gameDay,
      };
    });
  },
});
