import type { MutationCtx } from '../../../_generated/server';
import type { Doc, Id } from '../../../_generated/dataModel';
import { refreshResourceStock } from '../../resourceNodeLogic';

export async function loadResourceNode(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  resourceNodeId: string,
) {
  return await ctx.db
    .query('resourceNodes')
    .withIndex('byNode', (q) =>
      q.eq('worldId', worldId).eq('resourceNodeId', resourceNodeId),
    )
    .first();
}

export async function refreshResourceNodeDocument(
  ctx: MutationCtx,
  node: Doc<'resourceNodes'>,
  now: number,
) {
  const refreshed = refreshResourceStock(node, now);
  const changed =
    refreshed.stock !== node.stock ||
    refreshed.nextRefreshAt !== node.nextRefreshAt ||
    refreshed.refreshBlockedUntil !== node.refreshBlockedUntil ||
    refreshed.refreshBlockedByPressureId !== node.refreshBlockedByPressureId ||
    refreshed.seasonalRefreshBlockedUntil !== node.seasonalRefreshBlockedUntil;
  if (changed) {
    await ctx.db.patch(node._id, {
      stock: refreshed.stock,
      nextRefreshAt: refreshed.nextRefreshAt,
      refreshBlockedUntil: refreshed.refreshBlockedUntil,
      refreshBlockedByPressureId: refreshed.refreshBlockedByPressureId,
      seasonalRefreshBlockedUntil: refreshed.seasonalRefreshBlockedUntil,
      updatedAt: now,
    });
  }
  return {
    ...node,
    stock: refreshed.stock,
    nextRefreshAt: refreshed.nextRefreshAt,
    refreshBlockedUntil: refreshed.refreshBlockedUntil,
    refreshBlockedByPressureId: refreshed.refreshBlockedByPressureId,
    seasonalRefreshBlockedUntil: refreshed.seasonalRefreshBlockedUntil,
    updatedAt: changed ? now : node.updatedAt,
  };
}

export async function activeResourceReservationQuantity(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  resourceNodeId: string,
) {
  let total = 0;
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const rows = await ctx.db
      .query('actionExecutions')
      .withIndex('byResourceStatus', (q) =>
        q
          .eq('worldId', worldId)
          .eq('resourceNodeId', resourceNodeId)
          .eq('status', status),
      )
      .take(64);
    total += rows.reduce((sum, execution) => sum + (execution.reservedQuantity ?? 0), 0);
  }
  return total;
}
