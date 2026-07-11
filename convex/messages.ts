import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { insertInput } from './aiTown/insertInput';
import { conversationId, playerId } from './aiTown/ids';

export const listMessages = query({
  args: {
    worldId: v.id('worlds'),
    conversationId,
  },
  handler: async (ctx, args) => {
    const messages = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId).eq('conversationId', args.conversationId))
      .collect();
    const out = [];
    for (const message of messages) {
      const playerDescription = await ctx.db
        .query('playerDescriptions')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', message.author))
        .first();
      if (!playerDescription) {
        throw new Error(`Invalid author ID: ${message.author}`);
      }
      out.push({ ...message, authorName: playerDescription.name });
    }
    return out;
  },
});

// 统一对话栏（UI 重构）：跨所有对话取最近消息，附说话人姓名，最新在前。
// 让玩家在一个栏里看到「谁跟谁、说了什么」，而非只在点开某角色时才看得到。
export const listRecentMessages = query({
  args: { worldId: v.id('worlds'), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 24;
    // messages 索引为 [worldId, conversationId]，按世界前缀取一批再按时间排序。
    const raw = await ctx.db
      .query('messages')
      .withIndex('conversationId', (q) => q.eq('worldId', args.worldId))
      .collect();
    raw.sort((a, b) => b._creationTime - a._creationTime);
    const recent = raw.slice(0, limit);

    const nameCache = new Map<string, string>();
    const out = [];
    for (const m of recent) {
      let authorName = nameCache.get(m.author);
      if (!authorName) {
        const pd = await ctx.db
          .query('playerDescriptions')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId).eq('playerId', m.author))
          .first();
        authorName = pd?.name ?? m.author;
        nameCache.set(m.author, authorName);
      }
      out.push({
        _id: m._id,
        conversationId: m.conversationId,
        author: m.author,
        authorName,
        text: m.text,
        createdAt: m._creationTime,
      });
    }
    return out;
  },
});

export const writeMessage = mutation({
  args: {
    worldId: v.id('worlds'),
    conversationId,
    messageUuid: v.string(),
    playerId,
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert('messages', {
      conversationId: args.conversationId,
      author: args.playerId,
      messageUuid: args.messageUuid,
      text: args.text,
      worldId: args.worldId,
    });
    await insertInput(ctx, args.worldId, 'finishSendingMessage', {
      conversationId: args.conversationId,
      playerId: args.playerId,
      timestamp: Date.now(),
    });
  },
});
