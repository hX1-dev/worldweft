import type { MutationCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';

export async function loadProfile(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  return await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
}
