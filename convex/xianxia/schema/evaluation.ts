import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  socialModelCallStatusValidator,
} from './validators';

export const evaluationTables = {
  // C012b 每一次真实社交模型调用的持久审计与租约。blocked 也落库，
  // 因而预算耗尽、circuit 或双开关拒绝不会只存在于易丢失的 console。
  socialModelCalls: defineTable({
    worldId: v.id('worlds'),
    callId: v.string(),
    actorId: v.string(),
    conversationId: v.string(),
    status: socialModelCallStatusValidator,
    provider: v.string(),
    model: v.string(),
    promptVersion: v.optional(v.string()),
    scenarioKind: v.optional(v.string()),
    authorizationId: v.optional(v.string()),
    promptHash: v.string(),
    resultHash: v.optional(v.string()),
    responseText: v.optional(v.string()),
    estimatedInputTokens: v.number(),
    maxOutputTokens: v.number(),
    reservedTokens: v.number(),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    attemptCount: v.number(),
    cacheHit: v.boolean(),
    reasonCode: v.optional(v.string()),
    reservedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    leaseExpiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byCall', ['worldId', 'callId'])
    .index('byWorldStatus', ['worldId', 'status', 'reservedAt'])
    .index('byActor', ['worldId', 'actorId', 'reservedAt'])
    .index('byConversation', ['worldId', 'conversationId', 'reservedAt'])
    .index('byPromptStatus', ['worldId', 'provider', 'model', 'promptHash', 'status']),

// 世界级保守 token 预约和 circuit breaker。额度按窗口预约后不返还，
  // 即使 provider 未报告 usage 也不会突破上限。
  socialModelBudgets: defineTable({
    worldId: v.id('worlds'),
    hourlyWindowStartedAt: v.number(),
    hourlyReservedTokens: v.number(),
    dailyWindowStartedAt: v.number(),
    dailyReservedTokens: v.number(),
    consecutiveFailures: v.number(),
    circuitOpenUntil: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('byWorld', ['worldId']),
} as const;
