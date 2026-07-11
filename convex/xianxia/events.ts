import { v } from 'convex/values';
import { query } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import type { EventVisibility } from './actionSchema';
import type { Effects } from './actionSchema';
import type { DurableEventFacts } from './durableContracts';

// 事件日志的写入与查询（M2）。
// worldEvents 是世界事实的核心：前端展示、记忆来源、关系/声望依据、回放。
// 依据：docs/xianxia-blueprint.md §12。

export type AppendEventArgs = {
  worldId: Id<'worlds'>;
  type: string;
  createdAt: number;
  actorIds: string[];
  summary: string;
  visibility: EventVisibility;
  targetActorIds?: string[];
  locationId?: string;
  actionId?: string;
  witnessActorIds?: string[];
  facts?: DurableEventFacts;
  effects?: Effects;
  mapId?: string;
};

// resolver 内部调用，追加一条结构化事件，返回事件 id。
export async function appendWorldEvent(
  ctx: MutationCtx,
  args: AppendEventArgs,
): Promise<Id<'worldEvents'>> {
  return await ctx.db.insert('worldEvents', args);
}

// 按世界倒序取最近事件（worldId 索引内即按 createdAt 排序）。
export const listEvents = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('worldEvents')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .order('desc')
      .take(args.limit ?? 50);
  },
});
