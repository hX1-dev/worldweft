import { v } from 'convex/values';
import { mutation, query, internalMutation } from '../_generated/server';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
  isRequirementMet,
  isExpired,
  requestExpiresAtHour,
  chooseQuestPlan,
  type RequestType,
  type Requirements,
} from './questLogic';
import { appendWorldEvent } from './events';
import { versionDurableEventFacts } from './durableContracts';
import { generateMemories } from './memory';
import { readGameHour } from './config';
import { loadProfile, upsertRelationship, addToInventory } from './actions';
import { assertLegacyXianxiaWriteAccess } from './access';

const MAX_QUEST_PROFILES = 256;
const MAX_OPEN_REQUESTS = 256;
const MAX_ELDER_RELATIONSHIPS = 256;

// 轻量委托的「接线层」（Stage 2 · M6）。纯判定在 questLogic.ts。
// 闭环：长老据信任向在场弟子派采药委托 → 弟子探索得灵草 → tick 自动核验完成 → 发奖改关系。
// 全程确定性、无 LLM。W3b：发派/过期改用游戏小时。

// 自动发委托：长老向「最受信任、且名下无 open 委托」的弟子派一桩采药委托（关系驱动 §12.2）。
// now=真实 ms（用于事件时间戳），nowGameHour=当前游戏小时（用于有效期）。
async function maybeIssueQuest(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  now: number,
  nowGameHour: number,
) {
  const profiles = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', worldId))
    .take(MAX_QUEST_PROFILES);
  const elder = profiles.find((p) => p.role === 'elder');
  if (!elder) return;

  const openRequests = await ctx.db
    .query('requests')
    .withIndex('byStatus', (q) => q.eq('worldId', worldId).eq('status', 'offered'))
    .take(MAX_OPEN_REQUESTS);
  const assignedActorIds = new Set(openRequests.map((request) => request.assigneeActorId));
  const elderRelationships = await ctx.db
    .query('relationships')
    .withIndex('from', (q) =>
      q.eq('worldId', worldId).eq('fromActorId', elder.actorId),
    )
    .take(MAX_ELDER_RELATIONSHIPS);
  const trustByActor = new Map(
    elderRelationships.map((relationship) => [
      relationship.toActorId,
      relationship.trust ?? 0,
    ]),
  );

  // 合格弟子 = 弟子 ∩ 名下无 open 委托；附 elder→该弟子的信任，交纯逻辑轮换发派（W4b-D）。
  const eligible: { actorId: string; trust: number }[] = [];
  for (const d of profiles.filter((p) => p.role.endsWith('disciple'))) {
    if (assignedActorIds.has(d.actorId)) continue;
    eligible.push({ actorId: d.actorId, trust: trustByActor.get(d.actorId) ?? 0 });
  }

  const gameDay = Math.floor(nowGameHour / 24);
  const plan = chooseQuestPlan(eligible, gameDay);
  if (!plan) return;
  const assignee = profiles.find((p) => p.actorId === plan.assigneeActorId);
  if (!assignee) return;

  const isCollect = plan.type === 'collect_item';
  await ctx.db.insert('requests', {
    worldId,
    issuerActorId: elder.actorId,
    assigneeActorId: plan.assigneeActorId,
    type: plan.type,
    status: 'offered',
    requirements: plan.requirements,
    rewards: isCollect
      ? { cultivationXp: 12, trust: 5, debt: 5, items: [{ itemId: 'healing_pill', qty: 1 }] }
      : { cultivationXp: 15, trust: 5, debt: 5 },
    createdAt: now,
    expiresAt: requestExpiresAtHour(nowGameHour), // 游戏小时（7 游戏日后）
    summary: isCollect
      ? `${elder.name}托${assignee.name}采一株灵草回山门。`
      : `${elder.name}命${assignee.name}前往秘境入口查探一番。`,
  });
}

// 结算一桩已达成的委托：发奖（修为/关系/物品）、扣交付物、写事件与记忆、标记完成。
async function settleRequest(
  ctx: MutationCtx,
  req: Doc<'requests'>,
  now: number,
  nowGameHour: number,
): Promise<boolean> {
  const assignee = await loadProfile(ctx, req.worldId, req.assigneeActorId);
  if (!assignee) return false;
  const met = isRequirementMet(req.type as RequestType, req.requirements as Requirements, {
    inventory: assignee.inventory,
    currentLocationId: assignee.currentLocationId,
  });
  if (!met) return false;

  const issuer = await loadProfile(ctx, req.worldId, req.issuerActorId);
  if (req.rewards.cultivationXp) {
    await ctx.db.patch(assignee._id, {
      cultivationXp: Math.max(0, assignee.cultivationXp + req.rewards.cultivationXp),
    });
  }
  const eventId = await appendWorldEvent(ctx, {
    worldId: req.worldId,
    type: 'request_resolved',
    createdAt: now,
    actorIds: [req.assigneeActorId],
    targetActorIds: [req.issuerActorId],
    locationId: assignee.currentLocationId,
    visibility: 'local',
    summary: `${assignee.name}完成了${issuer?.name ?? req.issuerActorId}的委托：${req.summary}`,
    facts: versionDurableEventFacts({
      resultCode: 'request_completed',
      requestType: req.type,
    }),
  });
  // 交付物扣除（collect_item）。
  if (req.type === 'collect_item' && req.requirements.itemId) {
    await addToInventory(
      ctx,
      req.worldId,
      req.assigneeActorId,
      req.requirements.itemId,
      -(req.requirements.qty ?? 1),
    );
  }
  // 奖励物品 + 关系（长老对弟子更信任、欠其人情）。
  for (const it of req.rewards.items ?? []) {
    await addToInventory(ctx, req.worldId, req.assigneeActorId, it.itemId, it.qty);
  }
  if (req.rewards.trust || req.rewards.debt) {
    await upsertRelationship(
      ctx,
      req.worldId,
      req.issuerActorId,
      req.assigneeActorId,
      {
        trust: req.rewards.trust,
        debt: req.rewards.debt,
      },
      eventId,
    );
  }
  await ctx.db.patch(req._id, { status: 'completed' });
  await generateMemories(
    ctx,
    req.worldId,
    {
      eventId,
      type: 'request_resolved',
      visibility: 'local',
      actorIds: [req.assigneeActorId],
      targetActorIds: [req.issuerActorId],
      locationId: assignee.currentLocationId,
      summary: `完成委托：${req.summary}`,
      createdAt: now,
    },
    nowGameHour,
  );
  return true;
}

// 每次世界推进调用：发新委托 + 自动结算已达成的 + 过期清理。确定性、无 LLM。
export const tickQuests = internalMutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, { worldId }) => {
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, worldId, now); // W3b：以游戏小时判过期/发派
    const open = await ctx.db
      .query('requests')
      .withIndex('byStatus', (q) => q.eq('worldId', worldId).eq('status', 'offered'))
      .take(MAX_OPEN_REQUESTS);
    let settled = 0;
    for (const req of open) {
      if (req.status !== 'offered') continue;
      if (isExpired(req, nowGameHour)) {
        await ctx.db.patch(req._id, { status: 'expired' });
        continue;
      }
      if (await settleRequest(ctx, req, now, nowGameHour)) settled++;
    }
    await maybeIssueQuest(ctx, worldId, now, nowGameHour);
    return {
      settled,
      requestsScanned: open.length,
      truncated: open.length === MAX_OPEN_REQUESTS,
    };
  },
});

// 手动结算（UI/玩家触发）。
export const completeRequest = mutation({
  args: { worldId: v.id('worlds'), requestId: v.id('requests') },
  handler: async (ctx, args) => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.quests.completeRequest');
    const req = await ctx.db.get(args.requestId);
    if (!req || req.worldId !== args.worldId) return { ok: false, reason: '委托不存在。' };
    if (req.status !== 'offered') return { ok: false, reason: '委托已结束。' };
    const now = Date.now();
    const ok = await settleRequest(ctx, req, now, await readGameHour(ctx, args.worldId, now));
    return { ok, reason: ok ? undefined : '尚未达成委托条件。' };
  },
});

// 列出 open 委托（可按受托人过滤），供 UI 与 Agent。
export const listRequests = query({
  args: { worldId: v.id('worlds'), assigneeActorId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = args.assigneeActorId
      ? await ctx.db
          .query('requests')
          .withIndex('byAssignee', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('assigneeActorId', args.assigneeActorId!)
              .eq('status', 'offered'),
          )
          .take(MAX_OPEN_REQUESTS)
      : await ctx.db
          .query('requests')
          .withIndex('byStatus', (q) =>
            q.eq('worldId', args.worldId).eq('status', 'offered'),
          )
          .take(MAX_OPEN_REQUESTS);
    return rows.filter((r) => r.status === 'offered');
  },
});
