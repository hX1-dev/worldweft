import { v } from 'convex/values';
import { action, internalAction, internalQuery } from '../_generated/server';
import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { chatCompletion } from '../util/llm';
import {
  buildAgentMessages,
  parseProposal,
  planStrategicIntent,
  type AgentContext,
  type AgentProposal,
} from './agentLogic';
import type { ActionResult, ActionType } from './actionSchema';
import { breakthroughThreshold } from './rules';
import { allowedActionsForRole } from './policy';
import { readClockStartedAt } from './config';
import { gameTimeAt, MS_PER_GAME_HOUR } from './timeLogic';
import { planRoutineIntent } from './routineLogic';
import { personaFragment } from './personalityLogic';
import { assertLegacyXianxiaWriteAccess } from './access';
import type { AgentTickReservation } from './agentTickScheduler';

// submitAction 的返回形状（finalize 总是返回 result + 两个 id）。
type SubmitResult = ActionResult & {
  eventId: Id<'worldEvents'>;
  actionRecordId: Id<'actionRecords'>;
};
// proposeAndAct 的返回（显式标注以打破 Convex 自引用类型循环 / TS7022）。
type ProposeResult =
  // skipped 原因：no_profile / 守职不动（awaiting_customer/on_watch/on_duty…）/ no_meaningful_action
  | { actorId: string; skipped: string }
  | { actorId: string; proposal: AgentProposal; result: SubmitResult };

type AgentTickLeaseView = {
  acquired: boolean;
  tickId: string;
  owner: string;
  status?: 'completed';
  reason?: string;
  activeTickId?: string;
  recoveredExpiredTickId?: string;
};

type AcquireAgentTickLeaseResult =
  | {
      acquired: true;
      recoveredExpiredTickId?: string;
      lease: {
        tickId: string;
        mapId?: string;
        owner: string;
        acquiredAt: number;
        expiresAt: number;
      };
    }
  | {
      acquired: false;
      reason: 'tick_already_completed' | 'tick_already_active' | 'tick_lease_busy';
      activeLease?: { tickId: string };
    };

type AgentTickResult = {
  ticked: number;
  results: ProposeResult[];
  scheduler: AgentTickReservation;
  qinglan: { mapId: string; [key: string]: unknown };
  lease: AgentTickLeaseView;
};

// Agent 自主意图的 Convex 层（M5）。流程：装载上下文 → DeepSeek 产意图 → 校验兜底
// → 经 submitAction 落地。LLM 只产 proposal，永远改不了世界（一切经规则层裁决）。
// 依据：docs/xianxia-blueprint.md §12、§19.1。手动/UI 触发以控成本（§20.3）。

const IMPLEMENTED: ActionType[] = [
  'cultivate',
  'talk',
  'trade',
  'gift',
  'request_teaching',
  'spar',
  'explore',
  'steal',
  'breakthrough',
];

const MAX_NEARBY_ACTORS = 24;
const MAX_AGENT_RELATIONSHIPS = 256;
const MAX_KNOWN_LOCATIONS = 64;
const MAX_ACTIVE_REQUESTS = 20;
const AGENT_TICK_LEASE_TTL_MS = 300_000;

function isGodotSmokeActor(actorId: string) {
  return actorId.startsWith('godot_smoke_');
}

function memoryTouchesGodotSmoke(memory: { aboutActorIds?: string[]; summary?: string }) {
  return (
    (memory.aboutActorIds ?? []).some(isGodotSmokeActor) ||
    (memory.summary ?? '').includes('godot_smoke_')
  );
}

// 组装某角色的决策上下文（单次一致快照）。
export const agentContext = internalQuery({
  args: { worldId: v.id('worlds'), actorId: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<AgentContext | null> => {
    const self = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
      .first();
    if (!self) return null;
    const selfMapId = self.mapId ?? 'world';

    const nearbyProfiles = self.currentLocationId
      ? await ctx.db
          .query('xianxiaProfiles')
          .withIndex('byLocation', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('mapId', self.mapId)
              .eq('currentLocationId', self.currentLocationId),
          )
          .take(MAX_NEARBY_ACTORS + 1)
      : [];
    const relationships = await ctx.db
      .query('relationships')
      .withIndex('from', (q) =>
        q.eq('worldId', args.worldId).eq('fromActorId', self.actorId),
      )
      .take(MAX_AGENT_RELATIONSHIPS);
    const relationshipByActor = new Map(
      relationships.map((relationship) => [relationship.toActorId, relationship.value]),
    );

    // W4b-A：「附近的人」= 与自己同处一个语义地点者；自己无地点（途中）则附近无人。
    const others = [];
    for (const p of nearbyProfiles.slice(0, MAX_NEARBY_ACTORS)) {
      if (p.actorId === self.actorId) continue;
      if (isGodotSmokeActor(p.actorId)) continue;
      if ((p.mapId ?? 'world') !== selfMapId) continue;
      if (!self.currentLocationId || p.currentLocationId !== self.currentLocationId) continue;
      others.push({
        actorId: p.actorId,
        name: p.name,
        realm: p.realm,
        relationship: relationshipByActor.get(p.actorId) ?? 0,
      });
    }

    const location = self.currentLocationId
      ? await ctx.db
          .query('locations')
          .withIndex('byLocationId', (q) =>
            q.eq('worldId', args.worldId).eq('locationId', self.currentLocationId!),
          )
          .first()
      : null;
    const locationOnSameMap =
      location && (location.mapId ?? 'world') === selfMapId ? location : null;
    // 可用动作 = 地点允许 ∩ 已实现 ∩ 角色白名单（M1 §2.3：掌柜不探索、守卫不偷…）。
    const roleKit = allowedActionsForRole(self.role);
    let availableActions = (
      locationOnSameMap
        ? locationOnSameMap.allowedActions.filter(
            (a) => IMPLEMENTED.includes(a as ActionType) && roleKit.includes(a),
          )
        : []
    ) as ActionType[];
    if (availableActions.length === 0) {
      // 兜底到角色允许的安全动作：能修炼则修炼，否则交谈（talk 在所有角色白名单内）。
      availableActions = [roleKit.includes('cultivate') ? 'cultivate' : 'talk'] as ActionType[];
    }

    // M5 知识过滤（directive E）：agent 只看「自己听说/记得」的事，不再读全局事件。
    // W3b：过期以当前游戏小时为基准；W4a：顺带取当前昼夜阶段供「按时辰生活」。
    const clockStartedAt = await readClockStartedAt(ctx, args.worldId);
    const gt = clockStartedAt === null ? null : gameTimeAt(args.now, clockStartedAt);
    const nowGameHour = gt?.totalHours ?? 0;
    const mems = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', self.actorId))
      .order('desc')
      .take(15);
    const recentEvents = mems
      .filter((m) => m.expiresAt > nowGameHour)
      .filter((m) => !memoryTouchesGodotSmoke(m))
      .slice(0, 5)
      .map((m) => m.summary);

    // W4b-B：本游戏日内已与谁叙谈过（对话冷却）。查近期 conversation_started，取与己相关者的另一方。
    const oneGameDayMs = 24 * MS_PER_GAME_HOUR;
    const talkEvents = await ctx.db
      .query('worldEvents')
      .withIndex('byType', (q) => q.eq('worldId', args.worldId).eq('type', 'conversation_started'))
      .order('desc')
      .take(40);
    const recentlyTalked = [
      ...new Set(
        talkEvents
          .filter((e) => e.createdAt > args.now - oneGameDayMs)
          .filter(
            (e) =>
              e.actorIds.includes(self.actorId) || (e.targetActorIds ?? []).includes(self.actorId),
          )
          .flatMap((e) => [...e.actorIds, ...(e.targetActorIds ?? [])])
          .filter((a) => a !== self.actorId),
      ),
    ];

    // M7 点亮：让 Agent 知道「可去之处」与「身上的委托」，以便主动 travel / 履约。
    const allLocs = await ctx.db
      .query('locations')
      .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', self.mapId))
      .take(MAX_KNOWN_LOCATIONS);
    const knownLocations = allLocs.map((l) => ({
        locationId: l.locationId,
        name: l.name,
        allowedActions: l.allowedActions,
      }));
    const reqs = await ctx.db
      .query('requests')
      .withIndex('byAssignee', (q) =>
        q.eq('worldId', args.worldId).eq('assigneeActorId', self.actorId).eq('status', 'offered'),
      )
      .take(MAX_ACTIVE_REQUESTS);
    const activeRequests = reqs.map((r) => ({
      type: r.type,
      itemId: r.requirements.itemId,
      qty: r.requirements.qty,
      locationId: r.requirements.locationId,
      issuerActorId: r.issuerActorId,
      summary: r.summary,
    }));

    return {
      self: {
        actorId: self.actorId,
        name: self.name,
        role: self.role,
        realm: self.realm,
        realmStage: self.realmStage,
        cultivationXp: self.cultivationXp,
        mood: self.mood,
        health: self.health,
        spirit: self.spirit,
        reputation: self.reputation,
        currentLocationId: self.currentLocationId,
        inventory: self.inventory ?? [],
        // D：把性格双轴的确定性叙事并进 persona，喂给选动作/对话 LLM（旧档无 trait → 片段为空，persona 不变）。
        persona: [self.persona, personaFragment(self.innerTrait ?? '', self.outerTrait ?? '')]
          .filter(Boolean)
          .join('；'),
      },
      currentLocationName: locationOnSameMap?.name,
      others,
      recentEvents,
      availableActions,
      readyToBreakthrough: self.cultivationXp >= breakthroughThreshold(self.realm, self.realmStage),
      knownLocations,
      activeRequests,
      phase: gt?.phase,
      recentlyTalked,
    };
  },
});

// 单个角色：产意图 → 提交。LLM 失败或输出非法都会被 parseProposal 兜底，不会卡住。
export const proposeAndAct = internalAction({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args): Promise<ProposeResult> => {
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      ...args,
      now: Date.now(),
    });
    if (!context) return { actorId: args.actorId, skipped: 'no_profile' };

    // M7：先看有无明确目标（履行委托 / 为目标 travel）。有则直接采用，省一次 LLM。
    let proposal: AgentProposal | null = planStrategicIntent(context);
    // W4a/W4b：再按本分日程定夺——有对话需求才说话；无合法事可做就守职 skip（不空转）。
    if (!proposal) {
      const routine = planRoutineIntent(context);
      if (routine.kind === 'skip') return { actorId: args.actorId, skipped: routine.reason };
      if (routine.kind === 'act') proposal = routine.proposal;
      // routine.kind === 'defer' → 落到下面让 LLM 添变化（仅自由弟子会到这）
    }
    if (!proposal) {
      // 自由弟子的非社交变化：LLM 在**不含 talk** 的可用动作里选（talk 只由需求触发）。
      const noTalk: AgentContext = {
        ...context,
        availableActions: context.availableActions.filter((a: ActionType) => a !== 'talk'),
      };
      const { system, user } = buildAgentMessages(noTalk);
      let content = '';
      try {
        const res = await chatCompletion({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          max_tokens: 200,
          temperature: 0.7,
          response_format: { type: 'json_object' },
        });
        content = res.content;
      } catch (e) {
        console.error(`agent ${args.actorId} LLM 失败，兜底：`, e);
      }
      proposal = parseProposal(content, noTalk);
      // W4b-C：没有任何合法动作 → 守本分，不提交必被拒的动作。
      if (!proposal) return { actorId: args.actorId, skipped: 'no_meaningful_action' };
    }
    // 统一经 gm.act 提交：steal 会先走弱 GM 裁决，其余直接落地。
    const result: SubmitResult = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: proposal.type,
      actorId: args.actorId,
      source: 'agent',
      targetActorId: proposal.targetActorId,
      targetId: proposal.targetId,
      locationId: proposal.locationId,
      intent: proposal.intent,
      params: proposal.params,
    });
    return { actorId: args.actorId, proposal, result };
  },
});

// 推进一回合：由 Convex 按 map 公平轮转预留 limit 名角色，再逐一提出意图并走正式动作链。
export const runAgentTickInternal = internalAction({
  args: {
    worldId: v.id('worlds'),
    limit: v.optional(v.number()),
    mapId: v.optional(v.string()),
    tickId: v.optional(v.string()),
    owner: v.optional(v.string()),
    requestedAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AgentTickResult> => {
    const tickId = args.tickId ?? `tick:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const owner = args.owner ?? 'internal';
    const lease: AcquireAgentTickLeaseResult = await ctx.runMutation(
      internal.xianxia.agentTickLease.acquireAgentTickLease,
      {
        worldId: args.worldId,
        tickId,
        mapId: args.mapId,
        owner,
        requestedAt: args.requestedAt ?? Date.now(),
        now: Date.now(),
        ttlMs: AGENT_TICK_LEASE_TTL_MS,
      },
    );
    if (!lease.acquired) {
      return {
        ticked: 0,
        results: [] as ProposeResult[],
        scheduler: emptyAgentTickReservation(args.mapId),
        qinglan: { mapId: 'qinglan', skipped: lease.reason },
        lease: {
          acquired: false,
          tickId,
          owner,
          reason: lease.reason,
          activeTickId: lease.activeLease?.tickId,
        },
      };
    }

    let completionStatus: 'completed' | 'failed' = 'failed';
    try {
      const qinglan =
        args.mapId === 'qinglan'
          ? await ctx.runMutation(internal.xianxia.qinglan.tickQinglanResidentsInternal, {
              worldId: args.worldId,
              now: Date.now(),
            })
          : {
              mapId: 'qinglan',
              skipped: 'requested_map_not_qinglan',
              requestedMapId: args.mapId,
            };
      // 推进前先把身体坐标→语义地点同步一遍（M1 §2.1），让 agent 看到的「自己在哪」是真的。
      await ctx.runMutation(internal.xianxia.movement.syncLocations, { worldId: args.worldId });
      // M6：发/结算委托（确定性，无 LLM）。
      await ctx.runMutation(internal.xianxia.quests.tickQuests, { worldId: args.worldId });
      // W4b-F：按在场人群 + 昼夜，确定性触发群体场景（晨课/议价/组队）为 worldEvent。
      await ctx.runMutation(internal.xianxia.groupScene.tickGroupScenes, { worldId: args.worldId });
      // G：自主成长（确定性、无 LLM）。挂在独立开关后、默认关闭。
      const growthEnabled = await ctx.runQuery(api.xianxia.config.getAutonomousGrowth, {
        worldId: args.worldId,
      });
      if (growthEnabled) {
        await ctx.runMutation(internal.xianxia.growth.tickAutonomousGrowth, {
          worldId: args.worldId,
        });
      }
      const scheduler = await ctx.runMutation(
        internal.xianxia.agentTickScheduler.reserveAgentTickActors,
        {
          worldId: args.worldId,
          limit: args.limit,
          mapId: args.mapId,
        },
      );
      const results: ProposeResult[] = [];
      for (const actorId of scheduler.actorIds) {
        const result = await ctx.runAction(internal.xianxia.agent.proposeAndAct, {
          worldId: args.worldId as Id<'worlds'>,
          actorId,
        });
        results.push(result);
      }
      completionStatus = 'completed';
      return {
        ticked: results.length,
        results,
        scheduler,
        qinglan,
        lease: {
          acquired: true,
          tickId,
          owner,
          status: 'completed',
          recoveredExpiredTickId: lease.recoveredExpiredTickId,
        },
      };
    } finally {
      await ctx.runMutation(internal.xianxia.agentTickLease.releaseAgentTickLease, {
        worldId: args.worldId,
        tickId,
        mapId: args.mapId,
        status: completionStatus,
        finishedAt: Date.now(),
      });
    }
  },
});

// Compatibility entry for the old web console. Godot debug tick calls the
// internal action only after bridge scope and world binding checks.
export const runAgentTick = action({
  args: {
    worldId: v.id('worlds'),
    limit: v.optional(v.number()),
    mapId: v.optional(v.string()),
    tickId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AgentTickResult> => {
    await assertLegacyXianxiaWriteAccess(ctx, 'xianxia.agent.runAgentTick');
    return await ctx.runAction(internal.xianxia.agent.runAgentTickInternal, {
      ...args,
      owner: 'legacy',
    });
  },
});

// 自动推进（由 cron 每 90s 触发）。是否真的跑由世界配置 xianxiaConfig.autoTickEnabled
// 决定（UI 可切换），默认关闭以控成本。开启后修士自主行动、无需手动推进。
export const autoTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ran: boolean; lease?: AgentTickLeaseView }> => {
    const status: { worldId?: Id<'worlds'> } | null = await ctx.runQuery(
      api.world.defaultWorldStatus,
      {},
    );
    if (!status?.worldId) return { ran: false };
    const enabled = await ctx.runQuery(api.xianxia.config.getAutoTick, { worldId: status.worldId });
    if (!enabled) return { ran: false };
    const tick: AgentTickResult = await ctx.runAction(
      internal.xianxia.agent.runAgentTickInternal,
      {
      worldId: status.worldId,
      limit: 5,
      owner: 'cron',
      },
    );
    return { ran: tick.lease.acquired, lease: tick.lease };
  },
});

function emptyAgentTickReservation(mapId: string | undefined): AgentTickReservation {
  return {
    scope: mapId ?? '*',
    actorIds: [],
    eligibleCount: 0,
    wrapped: false,
    scannedCount: 0,
    eligibleCountExact: false,
  };
}
