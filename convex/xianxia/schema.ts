import { defineTable } from 'convex/server';
import { v } from 'convex/values';
// 契约（动作来源/生命周期/事件可见性）集中在 actionSchema.ts，建表直接复用，避免重复定义。
import { actionSource, actionStatus, eventVisibility } from './actionSchema';
import {
  durableActionMetadataValidator,
  durableActionResultValidator,
  durableEffectsValidator,
  durableEventFactsValidator,
} from './durableContracts';

// 太虚界第一阶段修仙数据表（M1，M2 起复用 actionSchema 契约）。
// 设计依据：docs/xianxia-blueprint.md §12（事件日志）、§13（世界模型）、§8（动作）。
//
// 落点约定（蓝图 §14.2）：这些表通过 `...xianxiaTables` 并入根 convex/schema.ts，
// 不侵入任何 AI Town 原表。actor / location / action 一律用「语义字符串 id」
// （如 "npc_hanli" / "market" / "action_001"），与 AI Town 的 playerId 解耦，
// 仅 worldId 引用真实的 worlds 文档。
//
// Durable facts/effects/results/metadata use versioned validators. Legacy rows
// may omit schemaVersion, while every new write records schemaVersion 1.

export const xianxiaTables = {
  // §12 Event Log：世界事实的核心，前端展示 / 记忆来源 / 关系声望依据 / 回放。
  worldEvents: defineTable({
    worldId: v.id('worlds'),
    type: v.string(), // e.g. steal_resolved / cultivation_completed / actor_arrived_location
    createdAt: v.number(),
    actorIds: v.array(v.string()),
    targetActorIds: v.optional(v.array(v.string())),
    locationId: v.optional(v.string()),
    actionId: v.optional(v.string()),
    visibility: eventVisibility,
    witnessActorIds: v.optional(v.array(v.string())),
    summary: v.string(), // 可有文学性
    facts: v.optional(durableEventFactsValidator),
    effects: v.optional(durableEffectsValidator),
    mapId: v.optional(v.string()), // 渐进式多地图：world / qinglan 等 surface id。
  })
    .index('worldId', ['worldId', 'createdAt'])
    .index('byMap', ['worldId', 'mapId', 'createdAt'])
    .index('byType', ['worldId', 'type'])
    .index('byAction', ['worldId', 'actionId']),

  // §13.3 角色修仙状态。给现有 AI Town 角色挂修仙档案。
  xianxiaProfiles: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(),
    name: v.string(),
    role: v.string(), // outer_disciple / merchant / elder / guard ...
    realm: v.string(), // qi_refining / foundation_building ...
    realmStage: v.number(), // 练气 1-9 层等
    // 灵根天赋（metal/wood/water/fire/earth/mixed）。第一阶段只立字段，
    // 影响修炼效率/长老评价的修正留待后续 loop（概念包 taixu-world-rules §6.3）。
    spiritRoot: v.optional(v.string()),
    // 性格双轴（鬼谷仿造 · D）。内在 7 / 外在 12，确定性「性格→行为/好感」修正与叙事，
    // 定义见 personalityLogic.ts。optional：旧档无此字段不破，由 seed 赋值。
    innerTrait: v.optional(v.string()), // 无私/正直/仁善/中庸/利己/狂邪/邪恶
    outerTrait: v.optional(v.string()), // 天伦/义气/护短/孤僻/爱家/名声/权力/睚眦/任我/情种/传承/忠贞
    cultivationXp: v.number(),
    mood: v.number(),
    health: v.number(),
    spirit: v.number(),
    reputation: v.number(), // -100 臭名昭著 / 0 无名 / 100 德高望重
    // 轻量物品（M3）：仅 itemId + 数量，不做价格/品阶/堆叠体系（蓝图 §14.4 不做完整 inventory）。
    inventory: v.optional(v.array(v.object({ itemId: v.string(), qty: v.number() }))),
    mapId: v.optional(v.string()), // 可选，旧档默认视为 world；青岚真实居民先不放入 profiles。
    currentLocationId: v.optional(v.string()),
    currentIntent: v.optional(v.string()),
    // 精炼行为倾向，喂给「选动作」的 Agent（与对话用的丰富 identity 分工）。
    persona: v.optional(v.string()),
  })
    .index('actor', ['worldId', 'actorId'])
    .index('byMap', ['worldId', 'mapId', 'actorId'])
    .index('byLocation', ['worldId', 'mapId', 'currentLocationId', 'actorId']),

  // 关系（M2 多维）。value=好感(affinity) −100..100，沿用第一阶段字段。
  // M2 增 4 维（§6）：trust/debt −100..100，suspicion/fear 0..100。均可选、默认 0、稀疏创建。
  // 所有变化必须来自事件（lastChangedByEventId）。
  relationships: defineTable({
    worldId: v.id('worlds'),
    fromActorId: v.string(),
    toActorId: v.string(),
    value: v.number(), // = affinity 好感
    trust: v.optional(v.number()),
    suspicion: v.optional(v.number()),
    debt: v.optional(v.number()),
    fear: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    lastChangedByEventId: v.optional(v.string()),
    // 鬼谷仿造 · E：该有向关系最后变动的游戏日。衰减按 (当前游戏日 − 此值) 惰性补算。
    lastTouchedDay: v.optional(v.number()),
  })
    .index('from', ['worldId', 'fromActorId'])
    .index('to', ['worldId', 'toActorId'])
    .index('pair', ['worldId', 'fromActorId', 'toActorId']),

  // §11.5 / §13.5 语义地点：地图坐标与修仙语义分离。
  locations: defineTable({
    worldId: v.id('worlds'),
    locationId: v.string(), // 语义 id，如 "market"
    name: v.string(),
    kind: v.string(), // mountain_gate / market / secret_realm_gate / alchemy_room
    dangerLevel: v.number(),
    spiritualEnergy: v.number(),
    allowedActions: v.array(v.string()),
    mapId: v.optional(v.string()), // 可选，旧地点默认视为 world。
    entryPoints: v.array(v.object({ x: v.number(), y: v.number() })),
    bounds: v.optional(
      v.object({ x1: v.number(), y1: v.number(), x2: v.number(), y2: v.number() }),
    ),
    description: v.optional(v.string()),
  })
    .index('byLocationId', ['worldId', 'locationId'])
    .index('byMap', ['worldId', 'mapId', 'locationId']),

  // 青岚坊市的第二地图居民。第一阶段只做真实后端显示/语义状态，
  // 不写入 AI Town world.players/world.agents，避免牵动原地图寻路与对话引擎。
  qinglanResidents: defineTable({
    worldId: v.id('worlds'),
    residentId: v.string(),
    actorId: v.string(),
    name: v.string(),
    role: v.string(),
    character: v.string(),
    mapId: v.string(),
    currentLocationId: v.string(),
    displayTile: v.object({ x: v.number(), y: v.number() }),
    targetTile: v.optional(v.object({ x: v.number(), y: v.number() })),
    finalTargetTile: v.optional(v.object({ x: v.number(), y: v.number() })),
    pathTiles: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
    orientation: v.number(),
    status: v.union(
      v.literal('idle'),
      v.literal('moving'),
      v.literal('walking'),
      v.literal('thinking'),
      v.literal('speaking'),
      v.literal('talking'),
      v.literal('trading'),
      v.literal('resting'),
      v.literal('patrolling'),
      v.literal('watching'),
      v.literal('arranging_herbs'),
      v.literal('carrying'),
      v.literal('waiting'),
    ),
    emoji: v.optional(v.string()),
    currentIntent: v.optional(v.string()),
    activityLabel: v.optional(v.string()),
    waypointId: v.optional(v.string()),
    nextActionAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('byResident', ['worldId', 'residentId'])
    .index('byMap', ['worldId', 'mapId'])
    .index('byActor', ['worldId', 'actorId']),

  // 用户/调试视角当前所在 surface。它只表达“入口/返回状态”，不移动 AI Town 身体。
  surfaceSessions: defineTable({
    worldId: v.id('worlds'),
    sessionId: v.string(),
    currentMapId: v.string(),
    currentLocationId: v.optional(v.string()),
    originMapId: v.optional(v.string()),
    originLocationId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('bySession', ['worldId', 'sessionId']),

  // M5 短期记忆：由重要事件经可见性/传闻传播生成，喂给 Agent 决策（知识过滤）。
  // 记忆必关联 sourceEventId（§10.1：记忆来自事件，非 LLM 凭空生成）。summary 可能是
  // 走样的传言版本。salience/expiresAt 控制重要度与保留时长（§10.4）。
  shortMemories: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(), // 记住此事的人
    sourceEventId: v.string(),
    aboutActorIds: v.array(v.string()),
    type: v.string(),
    salience: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    summary: v.string(),
  })
    .index('byActor', ['worldId', 'actorId', 'createdAt'])
    .index('bySourceEvent', ['worldId', 'sourceEventId']),

  // Large-world memory propagation is asynchronous. The durable job row is the
  // cancellation/continuation boundary: cleanup removes it before deleting
  // memories, so an in-flight page conflicts and cannot recreate cleaned data.
  memoryFanoutJobs: defineTable({
    worldId: v.id('worlds'),
    eventId: v.id('worldEvents'),
    nowGameHour: v.number(),
    status: v.union(v.literal('pending'), v.literal('completed')),
    cursor: v.optional(v.string()),
    pagesProcessed: v.number(),
    actorsProcessed: v.number(),
    memoriesInserted: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('byEvent', ['worldId', 'eventId']),

  // M6 轻量委托：NPC 据关系派事，完成改关系/发奖（§12）。第一版两类：collect_item / explore_location。
  requests: defineTable({
    worldId: v.id('worlds'),
    issuerActorId: v.string(),
    assigneeActorId: v.string(),
    type: v.string(),
    status: v.string(), // offered / completed / expired
    requirements: v.object({
      itemId: v.optional(v.string()),
      qty: v.optional(v.number()),
      locationId: v.optional(v.string()),
    }),
    rewards: v.object({
      cultivationXp: v.optional(v.number()),
      trust: v.optional(v.number()),
      debt: v.optional(v.number()),
      items: v.optional(v.array(v.object({ itemId: v.string(), qty: v.number() }))),
    }),
    createdAt: v.number(),
    expiresAt: v.number(),
    summary: v.string(),
  })
    .index('byAssignee', ['worldId', 'assigneeActorId', 'status'])
    .index('byIssuer', ['worldId', 'issuerActorId', 'status'])
    .index('byStatus', ['worldId', 'status']),

  // 世界级配置（每世界一行）。「自动推进」开关 + 世界时钟锚点 + 自主成长开关，供 UI 切换、cron 读取。
  xianxiaConfig: defineTable({
    worldId: v.id('worlds'),
    autoTickEnabled: v.boolean(),
    // W3a 世界时钟锚点：真实 ms = 第 1 日 0 时。游戏时间由 (now − 此值) 推导，见 timeLogic.ts。
    clockStartedAt: v.optional(v.number()),
    // G 自主成长开关。默认关闭——寿命/死亡安全栏（docs/世界逻辑/寿命-时间尺度.md）建好前不开，
    // 否则全员只升不死、漂向「全员化神」。optional：旧档/缺省一律按关处理。
    autonomousGrowthEnabled: v.optional(v.boolean()),
    // Agent tick 的操作性轮转游标。按 map/scope 独立保存，避免固定 slice 让后排角色永久饥饿。
    agentTickCursors: v.optional(
      v.array(
        v.object({
          scope: v.string(),
          afterActorId: v.string(),
          updatedAt: v.number(),
        }),
      ),
    ),
    // Optional autonomous-growth batch cursor. Growth is disabled by default,
    // but when enabled it advances every profile through bounded lexical pages.
    growthCursorActorId: v.optional(v.string()),
    agentTickLease: v.optional(
      v.object({
        tickId: v.string(),
        mapId: v.optional(v.string()),
        owner: v.string(),
        acquiredAt: v.number(),
        expiresAt: v.number(),
      }),
    ),
    recentAgentTicks: v.optional(
      v.array(
        v.object({
          tickId: v.string(),
          mapId: v.optional(v.string()),
          status: v.union(v.literal('completed'), v.literal('failed')),
          finishedAt: v.number(),
        }),
      ),
    ),
  }).index('byWorld', ['worldId']),

  // §8 Action 生命周期与结果记录。玩家与 Agent 共用同一入口 submitAction（M2）。
  actionRecords: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(),
    type: v.string(), // cultivate / talk / trade / gift / request_teaching / spar / explore / steal / travel
    status: actionStatus,
    targetId: v.optional(v.string()),
    targetActorId: v.optional(v.string()),
    locationId: v.optional(v.string()),
    intent: v.optional(v.string()),
    source: actionSource,
    mapId: v.optional(v.string()),
    clientActionId: v.optional(v.string()),
    clientActionFingerprint: v.optional(v.string()),
    riskTolerance: v.optional(v.number()),
    createdAt: v.number(),
    result: v.optional(durableActionResultValidator),
    seed: v.optional(v.string()), // 可记录随机种子，便于复现（§18.3）
    metadata: v.optional(durableActionMetadataValidator),
  })
    .index('actor', ['worldId', 'actorId'])
    .index('byClientAction', ['worldId', 'actorId', 'clientActionId'])
    .index('byStatus', ['worldId', 'status']),
};
