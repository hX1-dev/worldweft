import { v } from 'convex/values';
import { mutation, query, internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
  ACTIVE_REQUEST_STATUSES,
  canSettleQuestForLifeState,
  isExpired,
  requestRequirementReady,
  requestExpiresAtHour,
  requestReofferAllowed,
  REQUEST_INITIAL_REVISION,
  isQuestPublisherEligible,
  isQuestRecipientEligible,
  chooseQuestPlan,
  type RequestType,
  type Requirements,
} from './questLogic';
import { appendWorldEvent } from './events';
import { toDurableActionResult, versionDurableEventFacts } from './durableContracts';
import { readGameHour } from './config';
import { loadProfile } from './actions';
import { assertLegacyXianxiaWriteAccess } from './access';
import { generateMemories } from './memory';
import { relationshipDimsAt } from './relationshipLogic';
import { commitSystemRequestTransition } from './requestTransitions';

const MAX_QUEST_PROFILES = 256;
const MAX_OPEN_REQUESTS = 256;
const MAX_ELDER_RELATIONSHIPS = 256;

export { canSettleQuestForLifeState, isQuestPublisherEligible, isQuestRecipientEligible };

// 轻量委托的「接线层」（Stage 2 · M6）。纯判定在 questLogic.ts。
// 闭环：长老发出 offer → 受托人显式接受/拒绝 → tick 只核验 readiness
// → 受托人回到发起者身边显式 turn-in。奖励只由统一 Action 入口原子结算。
// 全程确定性、无 LLM。W3b：发派/过期改用游戏小时。

// 自动发委托：长老向「最受信任、且名下无 open 委托」的弟子派一桩采药委托（关系驱动 §12.2）。
// now=真实 ms（用于事件时间戳），nowGameHour=当前游戏小时（用于有效期）。
export async function maybeIssueQuest(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  now: number,
  nowGameHour: number,
  restrictTo?: { issuerActorId: string; assigneeActorId: string },
) {
  const profiles = restrictTo
    ? (
        await Promise.all(
          [restrictTo.issuerActorId, restrictTo.assigneeActorId].map((actorId) =>
            ctx.db
              .query('xianxiaProfiles')
              .withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
              .first(),
          ),
        )
      ).filter((profile): profile is Doc<'xianxiaProfiles'> => profile !== null)
    : await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', worldId))
        .take(MAX_QUEST_PROFILES);
  const elder = profiles.find(
    (profile) =>
      isQuestPublisherEligible(profile) &&
      (!restrictTo || profile.actorId === restrictTo.issuerActorId),
  );
  if (!elder) return;

  const openRequests = (
    await Promise.all(
      ACTIVE_REQUEST_STATUSES.map((status) =>
        ctx.db
          .query('requests')
          .withIndex('byStatus', (q) => q.eq('worldId', worldId).eq('status', status))
          .take(MAX_OPEN_REQUESTS),
      ),
    )
  ).flat();
  const priorRequests = await ctx.db
    .query('requests')
    .withIndex('byIssuer', (q) => q.eq('worldId', worldId).eq('issuerActorId', elder.actorId))
    .order('desc')
    .take(MAX_OPEN_REQUESTS);
  const assignedActorIds = new Set(openRequests.map((request) => request.assigneeActorId));
  const elderRelationships = await ctx.db
    .query('relationships')
    .withIndex('from', (q) => q.eq('worldId', worldId).eq('fromActorId', elder.actorId))
    .take(MAX_ELDER_RELATIONSHIPS);
  const gameDay = Math.floor(nowGameHour / 24);
  const trustByActor = new Map(
    elderRelationships.map((relationship) => [
      relationship.toActorId,
      relationshipDimsAt(
        {
          affinity: relationship.value,
          trust: relationship.trust,
          suspicion: relationship.suspicion,
          debt: relationship.debt,
          fear: relationship.fear,
        },
        relationship.lastTouchedDay,
        gameDay,
        elder.innerTrait ?? '',
        elder.outerTrait ?? '',
        relationship.dimensionTouchedDays,
      ).trust,
    ]),
  );

  // 合格弟子 = 弟子 ∩ 名下无 open 委托；附 elder→该弟子的信任，交纯逻辑轮换发派（W4b-D）。
  const eligible: { actorId: string; trust: number }[] = [];
  for (const d of profiles.filter(
    (profile) =>
      isQuestRecipientEligible(profile) &&
      (!restrictTo || profile.actorId === restrictTo.assigneeActorId),
  )) {
    if (assignedActorIds.has(d.actorId)) continue;
    if (
      !requestReofferAllowed(
        nowGameHour,
        priorRequests.filter((request) => request.assigneeActorId === d.actorId),
      )
    ) {
      continue;
    }
    eligible.push({ actorId: d.actorId, trust: trustByActor.get(d.actorId) ?? 0 });
  }

  const plan = chooseQuestPlan(eligible, gameDay);
  if (!plan) return;
  const assignee = profiles.find((p) => p.actorId === plan.assigneeActorId);
  if (!assignee) return;

  const isCollect = plan.type === 'collect_item';
  const expiresAt = requestExpiresAtHour(nowGameHour);
  const actionRecordId = await ctx.db.insert('actionRecords', {
    worldId,
    actorId: elder.actorId,
    type: 'offer_request',
    status: 'proposed',
    targetActorId: assignee.actorId,
    locationId: elder.currentLocationId,
    source: 'system',
    mapId: elder.mapId,
    createdAt: now,
  });
  const requestId = await ctx.db.insert('requests', {
    worldId,
    issuerActorId: elder.actorId,
    assigneeActorId: plan.assigneeActorId,
    type: plan.type,
    status: 'offered',
    revision: REQUEST_INITIAL_REVISION,
    requirements: plan.requirements,
    rewards: isCollect
      ? { cultivationXp: 12, trust: 5, debt: 5, items: [{ itemId: 'healing_pill', qty: 1 }] }
      : { cultivationXp: 15, trust: 5, debt: 5 },
    createdAt: now,
    offeredAtGameHour: nowGameHour,
    expiresAt, // 游戏小时（7 游戏日后）
    originalExpiresAt: expiresAt,
    deadlineExtensionCount: 0,
    openedByActionId: actionRecordId,
    summary: isCollect
      ? `${elder.name}托${assignee.name}采一株灵草回山门。`
      : `${elder.name}命${assignee.name}前往秘境入口查探一番。`,
  });
  const summary = isCollect
    ? `${elder.name}向${assignee.name}提出一桩采药委托，尚待答复。`
    : `${elder.name}向${assignee.name}提出一桩查探委托，尚待答复。`;
  const eventId = await appendWorldEvent(ctx, {
    worldId,
    type: 'request_offered',
    createdAt: now,
    actorIds: [elder.actorId],
    targetActorIds: [assignee.actorId],
    locationId: elder.currentLocationId,
    actionId: actionRecordId,
    visibility: 'local',
    summary,
    facts: versionDurableEventFacts({
      resultCode: 'request_offered',
      requestType: plan.type,
      requestId: String(requestId),
      requestStatus: 'offered',
      fromStatus: 'none',
      toStatus: 'offered',
      requestRevision: REQUEST_INITIAL_REVISION,
      sourceGameHour: nowGameHour,
    }),
    mapId: elder.mapId,
  });
  await ctx.db.patch(requestId, {
    sourceEventId: eventId,
    lastTransitionActionId: actionRecordId,
    lastTransitionEventId: eventId,
    lastTransitionAt: now,
  });
  await ctx.db.patch(actionRecordId, {
    status: 'applied',
    result: toDurableActionResult({
      status: 'applied',
      resultCode: 'request_offered',
      reason: summary,
      effects: {},
      eventType: 'request_offered',
      visibility: 'local',
    }),
  });
  await generateMemories(
    ctx,
    worldId,
    {
      eventId,
      type: 'request_offered',
      visibility: 'local',
      actorIds: [elder.actorId],
      targetActorIds: [assignee.actorId],
      locationId: elder.currentLocationId,
      summary,
      createdAt: now,
    },
    nowGameHour,
  );
  return { requestId, eventId, assigneeActorId: assignee.actorId, requestType: plan.type };
}

// tick 只刷新服务端可验证的进度。探索到访一旦 fulfilled 就保持；采集物若被
// 花掉则从 ready 回到 accepted，实际 turn-in 仍会在同一 mutation 内最终复核。
export async function refreshRequestProgress(
  ctx: MutationCtx,
  req: Doc<'requests'>,
  now: number,
): Promise<'ready' | 'reopened' | 'unchanged'> {
  const assignee = await loadProfile(ctx, req.worldId, req.assigneeActorId);
  if (!assignee || !canSettleQuestForLifeState(assignee)) return 'unchanged';
  const ready = requestRequirementReady(
    req.type as RequestType,
    req.requirements as Requirements,
    { inventory: assignee.inventory, currentLocationId: assignee.currentLocationId },
    req.fulfilledAt,
  );
  if (req.status === 'accepted' && ready) {
    const nowGameHour = await readGameHour(ctx, req.worldId, now);
    await commitSystemRequestTransition(ctx, {
      request: req,
      fromStatus: 'accepted',
      toStatus: 'ready_to_turn_in',
      now,
      nowGameHour,
      resultCode: 'request_ready',
      eventType: 'request_ready',
      reason: `${assignee.name}已经满足委托条件，可以当面交付。`,
      locationId: assignee.currentLocationId,
      mapId: assignee.mapId,
      patch: { readyAt: now, fulfilledAt: req.fulfilledAt ?? now },
    });
    return 'ready';
  }
  if (req.status === 'ready_to_turn_in' && req.type === 'collect_item' && !ready) {
    const nowGameHour = await readGameHour(ctx, req.worldId, now);
    await commitSystemRequestTransition(ctx, {
      request: req,
      fromStatus: 'ready_to_turn_in',
      toStatus: 'accepted',
      now,
      nowGameHour,
      resultCode: 'request_reopened',
      eventType: 'request_reopened',
      reason: `${assignee.name}已不再持有所需物品，委托回到进行中。`,
      locationId: assignee.currentLocationId,
      mapId: assignee.mapId,
      patch: { readyAt: undefined },
    });
    return 'reopened';
  }
  return 'unchanged';
}

// 每次世界推进调用：发新 offer + 刷新 readiness + 过期清理。绝不自动结算。
export const tickQuests = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, worldId, now); // W3b：以游戏小时判过期/发派
    const open = (
      await Promise.all(
        ACTIVE_REQUEST_STATUSES.map((status) =>
          ctx.db
            .query('requests')
            .withIndex('byStatus', (q) => q.eq('worldId', worldId).eq('status', status))
            .take(MAX_OPEN_REQUESTS),
        ),
      )
    ).flat();
    let ready = 0;
    let reopened = 0;
    let expired = 0;
    for (const req of open) {
      if (isExpired(req, nowGameHour)) {
        const assignee = await loadProfile(ctx, worldId, req.assigneeActorId);
        await commitSystemRequestTransition(ctx, {
          request: req,
          fromStatus: req.status as 'offered' | 'accepted' | 'ready_to_turn_in',
          toStatus: 'expired',
          now,
          nowGameHour,
          resultCode: 'request_expired',
          eventType: 'request_expired',
          reason: '这桩委托已经超过期限。',
          locationId: assignee?.currentLocationId,
          mapId: assignee?.mapId,
        });
        expired++;
        continue;
      }
      if (req.status === 'accepted' || req.status === 'ready_to_turn_in') {
        const progress = await refreshRequestProgress(ctx, req, now);
        if (progress === 'ready') ready++;
        if (progress === 'reopened') reopened++;
      }
    }
    await maybeIssueQuest(ctx, worldId, now, nowGameHour);
    return {
      settled: 0,
      ready,
      reopened,
      expired,
      requestsScanned: open.length,
      truncated: open.length === MAX_OPEN_REQUESTS,
    };
  },
});

// 旧旁路保留为明确拒绝；正式交付必须走 submitAction(turn_in_request)。
export const completeRequest = mutation({
  args: { worldId: v.id('worlds'), requestId: v.id('requests') },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.quests.completeRequest');
    const req = await ctx.db.get(args.requestId);
    if (!req || req.worldId !== args.worldId) return { ok: false, reason: '委托不存在。' };
    return { ok: false, reason: 'explicit_turn_in_required' };
  },
});

// 列出所有 active 委托（可按受托人过滤），供 UI 与 Agent。
export const listRequests = query({
  args: { worldId: v.id('worlds'), assigneeActorId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const pages = await Promise.all(
      ACTIVE_REQUEST_STATUSES.map((status) =>
        args.assigneeActorId
          ? ctx.db
              .query('requests')
              .withIndex('byAssignee', (q) =>
                q
                  .eq('worldId', args.worldId)
                  .eq('assigneeActorId', args.assigneeActorId!)
                  .eq('status', status),
              )
              .take(MAX_OPEN_REQUESTS)
          : ctx.db
              .query('requests')
              .withIndex('byStatus', (q) => q.eq('worldId', args.worldId).eq('status', status))
              .take(MAX_OPEN_REQUESTS),
      ),
    );
    return pages.flat().sort((a, b) => a.createdAt - b.createdAt);
  },
});
