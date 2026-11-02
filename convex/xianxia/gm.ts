import { v } from 'convex/values';
import { action, internalAction, internalQuery } from '../_generated/server';
import type { QueryCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { chatCompletion } from '../util/llm';
import { actionEnvelopeArgs, type ActionResult } from './actionSchema';
import {
  buildGmMessages,
  parseGmVerdict,
  shouldInvokeWeakGmProvider,
  type GmContext,
  type GmVerdict,
} from './gmLogic';
import { assertLegacyXianxiaWriteAccess } from './access';
import { readGameHour } from './config';
import { relationshipDimsAt } from './relationshipLogic';
import { purposeGoalFenceValidator } from './personalGoalContracts';

// 弱 GM 的 Convex 层（M6）。act 是 UI 与 Agent 共用的统一提交入口：
// 高风险动作 steal 先调 DeepSeek 产结构化裁决，再经 submitAction 落地（其内再钳一次）；
// 其余动作直接 submitAction。GM 只辅助，规则层有最终裁决权（蓝图 §9/§13.5）。

type SubmitResult = ActionResult & {
  eventId: Id<'worldEvents'>;
  actionRecordId: Id<'actionRecords'>;
  clientActionId?: string;
  idempotentReplay?: boolean;
};

// 偷窃情境快照，供 GM 决策。
export const gmContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    itemId: v.string(),
    locationId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<GmContext | null> => {
    const actor = await loadProfile(ctx, args.worldId, args.actorId);
    const target = await loadProfile(ctx, args.worldId, args.targetActorId);
    if (!actor || !target) return null;
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', args.worldId).eq('locationId', args.locationId),
      )
      .first();
    if (!location) return null;

    const rel = await ctx.db
      .query('relationships')
      .withIndex('pair', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('fromActorId', args.actorId)
          .eq('toActorId', args.targetActorId),
      )
      .first();
    const nowGameHour = await readGameHour(ctx, args.worldId, args.now);
    const effectiveRelationship = relationshipDimsAt(
      rel
        ? { affinity: rel.value, trust: rel.trust, suspicion: rel.suspicion, debt: rel.debt, fear: rel.fear }
        : {},
      rel?.lastTouchedDay,
      Math.floor(nowGameHour / 24),
      actor.innerTrait ?? '',
      actor.outerTrait ?? '',
      rel?.dimensionTouchedDays,
    );

    const all = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId))
      .collect();
    const witnessNames = all
      .filter(
        (p) =>
          p.actorId !== args.actorId &&
          p.actorId !== args.targetActorId &&
          p.currentLocationId === location.locationId,
      )
      .map((p) => p.name);

    return {
      actorName: actor.name,
      targetName: target.name,
      itemId: args.itemId,
      locationName: location.name,
      dangerLevel: location.dangerLevel,
      actorSpirit: actor.spirit,
      targetSpirit: target.spirit,
      relationship: effectiveRelationship.affinity,
      witnessNames,
    };
  },
});

// 调 DeepSeek 产 steal 裁决；失败或非法返回 null（调用方退回确定性规则）。
export const gmResolveSteal = internalAction({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    itemId: v.string(),
    locationId: v.string(),
  },
  handler: async (ctx, args): Promise<GmVerdict | null> => {
    const context = await ctx.runQuery(internal.xianxia.gm.gmContext, { ...args, now: Date.now() });
    if (!context) return null;
    const { system, user } = buildGmMessages(context);
    try {
      const res = await chatCompletion({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 200,
        temperature: 0.6,
        response_format: { type: 'json_object' },
      });
      return parseGmVerdict(res.content as string);
    } catch (e) {
      console.error('GM 裁决调用失败，退回确定性规则：', e);
      return null;
    }
  },
});

// 统一提交入口。UI 与 Agent 都经此。steal 走弱 GM，其余直接提交。
export const actInternal = internalAction({
  args: {
    ...actionEnvelopeArgs,
    // Internal callers with an explicit provider=0 contract may still submit
    // steal. In that case the authoritative action resolver uses its existing
    // deterministic fallback instead of invoking the weak-GM model.
    providerPolicy: v.optional(v.literal('disabled')),
    purposeGoalFence: v.optional(purposeGoalFenceValidator),
  },
  handler: async (ctx, args): Promise<SubmitResult> => {
    const { providerPolicy, ...actionArgs } = args;
    let gmVerdict: GmVerdict | null = null;
    const params = (actionArgs.params ?? {}) as Record<string, unknown>;
    const itemId = typeof params.itemId === 'string' ? params.itemId : undefined;
    if (shouldInvokeWeakGmProvider({
      providerPolicy,
      actionType: actionArgs.type,
      targetActorId: actionArgs.targetActorId,
      locationId: actionArgs.locationId,
      itemId,
    })) {
      gmVerdict = await ctx.runAction(internal.xianxia.gm.gmResolveSteal, {
        worldId: actionArgs.worldId,
        actorId: actionArgs.actorId,
        targetActorId: actionArgs.targetActorId!,
        itemId: itemId!,
        locationId: actionArgs.locationId!,
      });
    }
    return (await ctx.runMutation(internal.xianxia.actions.submitAction, {
      ...actionArgs,
      gmVerdict: gmVerdict ?? undefined,
    })) as SubmitResult;
  },
});

// 失能后的有界自然恢复。定时器不直接改 health，而是带当次失能凭证
// 重走统一 submitAction：未到时间、旧凭证和重复调度都会在权威门禁被拒绝。
export const recoverIncapacitatedActor = internalAction({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    recoveryToken: v.string(),
  },
  handler: async (ctx, args): Promise<SubmitResult> => {
    return (await ctx.runMutation(internal.xianxia.actions.submitAction, {
      worldId: args.worldId,
      type: 'recover',
      actorId: args.actorId,
      source: 'system',
      clientActionId: `natural-recovery:${args.recoveryToken}`,
      intent: '伤势自然稳定',
      params: { recoveryToken: args.recoveryToken },
    })) as SubmitResult;
  },
});

// Compatibility entry for the old web console. The production Godot bridge
// calls actInternal after its own bound-credential policy has succeeded.
export const act = action({
  args: actionEnvelopeArgs,
  handler: async (ctx, args): Promise<SubmitResult> => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.gm.act');
    if (args.source !== 'human') {
      throw new Error('xianxia_source_forbidden: public callers may submit only human actions.');
    }
    return await ctx.runAction(internal.xianxia.gm.actInternal, args);
  },
});

async function loadProfile(ctx: QueryCtx, worldId: Id<'worlds'>, actorId: string) {
  return await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .first();
}
