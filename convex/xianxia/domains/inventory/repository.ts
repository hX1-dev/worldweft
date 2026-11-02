import type { MutationCtx } from '../../../_generated/server';
import type { Id } from '../../../_generated/dataModel';
import { loadProfile } from '../life/profile';

export async function activeTargetItemReservationQuantity(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  targetActorId: string,
  itemId: string,
  now: number,
  excludeExecutionId?: Id<'actionExecutions'>,
) {
  let reserved = 0;
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const executions = await ctx.db
      .query('actionExecutions')
      .withIndex('byTargetStatus', (q) =>
        q.eq('worldId', worldId).eq('targetActorId', targetActorId).eq('status', status),
      )
      .collect();
    for (const execution of executions) {
      if (excludeExecutionId && execution._id === excludeExecutionId) continue;
      if (execution.expiresAt <= now || execution.hardDeadlineAt <= now) continue;
      if (execution.reservedTargetItemId !== itemId) continue;
      reserved += execution.reservedTargetItemQuantity ?? 0;
    }
  }
  return reserved;
}

export async function activeInventoryReservationQuantity(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  itemId: string,
  now: number,
  excludeExecutionId?: Id<'actionExecutions'>,
): Promise<number> {
  let reserved = 0;
  for (const status of ['pending', 'accepted', 'acting'] as const) {
    const executions = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorStatus', (q) =>
        q.eq('worldId', worldId).eq('actorId', actorId).eq('status', status),
      )
      .collect();
    for (const execution of executions) {
      if (excludeExecutionId && execution._id === excludeExecutionId) continue;
      if (execution.expiresAt <= now || execution.hardDeadlineAt <= now) continue;
      if (execution.reservedItemId !== itemId) continue;
      const quantity = execution.reservedItemQuantity ?? 0;
      if (Number.isInteger(quantity) && quantity > 0) reserved += quantity;
    }
  }
  return reserved + (
    await activeTargetItemReservationQuantity(
      ctx,
      worldId,
      actorId,
      itemId,
      now,
      excludeExecutionId,
    )
  );
}

export async function addToInventory(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  itemId: string,
  delta: number,
) {
  if (!Number.isInteger(delta)) return false;
  if (delta === 0) return true;
  const profile = await loadProfile(ctx, worldId, actorId);
  if (!profile) return false;
  const inventory = [...(profile.inventory ?? [])];
  const index = inventory.findIndex((item) => item.itemId === itemId);
  const reserved =
    delta < 0
      ? await activeInventoryReservationQuantity(ctx, worldId, actorId, itemId, Date.now())
      : 0;
  if (index >= 0) {
    const quantity = inventory[index].qty + delta;
    if (
      !Number.isInteger(inventory[index].qty) ||
      inventory[index].qty < 0 ||
      quantity < reserved ||
      quantity < 0
    ) return false;
    if (quantity === 0) inventory.splice(index, 1);
    else inventory[index] = { itemId, qty: quantity };
  } else if (delta > 0) {
    inventory.push({ itemId, qty: delta });
  } else {
    return false;
  }
  await ctx.db.patch(profile._id, { inventory });
  return true;
}
