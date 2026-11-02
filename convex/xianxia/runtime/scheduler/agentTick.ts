import { v } from 'convex/values';
import { internalAction } from '../../../_generated/server';
import { api, internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';
import { shouldRunAutonomousAgentTick } from '../../agentTickScheduler';
import { assembleRuntimeAgentTickResult } from '../../runtimeAgentTickResultPort';
import type { ProposeResult, AgentTickLeaseView, AcquireAgentTickLeaseResult, AgentTickResult, AgentTickActorResult } from '../agentContracts';
import { AGENT_TICK_LEASE_TTL_MS, emptyAgentTickReservation } from '../agentHelpers';

// 推进一回合：由 Convex 按 map 公平轮转预留 limit 名角色，再逐一提出意图并走正式动作链。
// 每名角色由规则层 proposeAndAct 决定（2026-10-21/22 两轮规则对 DeepSeek 实验后，AI 不再进每 tick 决策）。
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
      // C019a–c：生命周期裁决必须先于本 tick 的任何身体或世界动作。
      // 否则刚越过寿命线的角色仍可能多移动一个稀疏 tick。
      const lifecycleNow = Date.now();
      await ctx.runMutation(internal.xianxia.lifeCalendar.tickLifeCalendar, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
      await ctx.runMutation(internal.xianxia.lifeProfiles.migrateLifeProfileBirthAnchors, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
      await ctx.runMutation(internal.xianxia.lifeDeaths.tickOldAgeDeaths, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
      // C019e：死亡结算后、Agent 预留前，以服务端权威人口池做至多一人的有界补员。
      await ctx.runMutation(internal.xianxia.populationMigrations.tickPopulationMigration, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
      // LWSE-2c：在任何 Agent context/candidate 读取之前，把已跨过精确
      // game-hour 边界的 consequence 有界持久化为 expired。无 tick 时
      // projection 的 read-side 时间门仍 fail closed；下一 tick 再 catch up。
      await ctx.runMutation(
        internal.xianxia.socialConsequenceLifecycle.tickSocialConsequenceLifecycle,
        { worldId: args.worldId, now: lifecycleNow },
      );
      // LWSE-3a：先物化已完整结束的日/周 review occurrence，再让任何
      // Agent 观察世界。这里仅推进持久时间 owner；provider/action/candidate
      // 固定为 0，后续阶段才可从窗口投影有来源的生活计划。
      await ctx.runMutation(internal.xianxia.lifeRhythmWindows.tickLifeRhythmWindows, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
      // LWSE-3b：从刚关闭的窗口与每名角色可见的 owner facts 生成
      // actor/window exactly-once review receipt。review 固定 provider/action/
      // candidate/relationship/memory=0；LWSE-3c 才能消费它提出共同计划。
      await ctx.runMutation(internal.xianxia.lifeSocialReviews.tickLifeSocialReviews, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
      // LWSE-3c: reconcile existing source-bound shared plans, then create at
      // most two provider=0 proposals from exact weekly review facts. A plan
      // remains coordination-only; later actor turns must still select and
      // execute the projected purpose candidate through the normal body chain.
      await ctx.runMutation(internal.xianxia.sharedPlans.tickSharedPlans, {
        worldId: args.worldId,
        now: lifecycleNow,
      });
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
      // C017f：环境事实全局推进，深度 Agent 只处理本 tick 的有限角色。
      const director = await ctx.runMutation(internal.xianxia.worldDirector.tickWorldDirector, {
        worldId: args.worldId,
        mapId: args.mapId,
        now: Date.now(),
      });
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
      const results: AgentTickActorResult[] = [];
      for (const actorId of scheduler.actorIds) {
        const result = await ctx.runAction(internal.xianxia.agent.proposeAndAct, {
          worldId: args.worldId as Id<'worlds'>,
          actorId,
          decisionId: tickId,
        });
        results.push(result);
      }
      completionStatus = 'completed';
      return assembleRuntimeAgentTickResult({
        ticked: results.length,
        results,
        scheduler,
        qinglan,
        director,
        lease: {
          acquired: true,
          tickId,
          owner,
          status: 'completed',
          recoveredExpiredTickId: lease.recoveredExpiredTickId,
        },
      });
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
    if (!shouldRunAutonomousAgentTick(enabled, process.env.XIANXIA_AUTO_TICK)) {
      return { ran: false };
    }
    const tick: AgentTickResult = await ctx.runAction(internal.xianxia.agent.runAgentTickInternal, {
      worldId: status.worldId,
      limit: 5,
      owner: 'cron',
    });
    return { ran: tick.lease.acquired, lease: tick.lease };
  },
});
