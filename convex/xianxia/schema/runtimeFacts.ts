import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  tilePointValidator,
} from './validators';

export const runtimeFactsTables = {
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
    // 当前大境界开始的服务端 epoch；旧档缺失时以文档 _creationTime 迁移兼容。
    realmEnteredAt: v.optional(v.number()),
    // C019b 岁月历同轴出生锚点。年龄永远从此字段投影，不持久化 mutable age counter。
    lifeBornAt: v.optional(v.number()),
    lifeBirthSource: v.optional(v.string()),
    lifeBirthRecordedAt: v.optional(v.number()),
    // C019c 不可逆生命终态。legacy 缺字段按 alive；死亡后 profile 永久保留为历史人物。
    lifeStatus: v.optional(v.union(v.literal('alive'), v.literal('deceased'))),
    deceasedAt: v.optional(v.number()),
    deathRecordedAt: v.optional(v.number()),
    deathCause: v.optional(v.literal('old_age')),
    deathActionId: v.optional(v.string()),
    deathEventId: v.optional(v.id('worldEvents')),
    deathRealm: v.optional(v.string()),
    deathLifespanYears: v.optional(v.number()),
    // 突破失败后的有界恢复截止时间，只阻止再次突破。
    breakthroughRecoveryUntil: v.optional(v.number()),
    mood: v.number(),
    health: v.number(),
    maxHealth: v.optional(v.number()),
    // 0=精力充足，100=极度疲惫；旧档缺失按 0 处理。
    fatigue: v.optional(v.number()),
    // 生命状态由 health 推导；这里只持久化一次失能的恢复资格，避免双状态漂移。
    incapacitatedAt: v.optional(v.number()),
    recoveryEligibleAt: v.optional(v.number()),
    recoveryToken: v.optional(v.string()),
    spirit: v.number(),
    reputation: v.number(), // -100 臭名昭著 / 0 无名 / 100 德高望重
    // 轻量物品（M3）：仅 itemId + 数量，不做价格/品阶/堆叠体系（蓝图 §14.4 不做完整 inventory）。
    inventory: v.optional(v.array(v.object({ itemId: v.string(), qty: v.number() }))),
    mapId: v.optional(v.string()), // 可选，旧档默认视为 world；青岚真实居民先不放入 profiles。
    currentLocationId: v.optional(v.string()),
    currentIntent: v.optional(v.string()),
    // 精炼行为倾向，喂给「选动作」的 Agent（与对话用的丰富 identity 分工）。
    persona: v.optional(v.string()),
    // Transitional C015a builds briefly wrote this marker. It remains optional
    // for local data compatibility; production compaction now uses the small
    // memoryCompactionStates table and never reads or writes this profile field.
    memoryLifecycleMigratedAt: v.optional(v.number()),
  })
    .index('actor', ['worldId', 'actorId'])
    .index('byLifeBirth', ['worldId', 'lifeBornAt', 'actorId'])
    .index('byLifeStatusRealmBirth', ['worldId', 'lifeStatus', 'realm', 'lifeBornAt', 'actorId'])
    .index('byLifeStatusRecorded', ['worldId', 'lifeStatus', 'deathRecordedAt', 'actorId'])
    .index('byMap', ['worldId', 'mapId', 'actorId'])
    .index('byMapLifeStatusActor', ['worldId', 'mapId', 'lifeStatus', 'actorId'])
    .index('byLocation', ['worldId', 'mapId', 'currentLocationId', 'actorId']),

// C019e immutable migration admissions. Profiles remain the actor fact;
  // this table is the source-capacity/cooldown ledger and exactly-once receipt.
  populationMigrations: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.population_migration.v1'),
    migrationId: v.string(),
    poolId: v.literal('main_world_residents'),
    sourceId: v.literal('qinglan_outer_villages'),
    calendarYear: v.number(),
    sourceSlot: v.number(),
    actorId: v.string(),
    status: v.literal('admitted'),
    mapId: v.literal('world'),
    locationId: v.literal('mountain_gate'),
    populationBefore: v.number(),
    populationAfter: v.number(),
    admittedAt: v.number(),
    nextEligibleAt: v.number(),
    lifeBornAt: v.number(),
    initialAgeYears: v.number(),
    eventActionId: v.string(),
    eventId: v.id('worldEvents'),
  })
    .index('byMigration', ['worldId', 'migrationId'])
    .index('bySourceCohort', ['worldId', 'sourceId', 'calendarYear', 'sourceSlot'])
    .index('byActor', ['worldId', 'actorId'])
    .index('byAdmittedAt', ['worldId', 'admittedAt']),

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
    // C016d5：各维度独立衰减锚点；旧档缺失时回退 lastTouchedDay，首次事件再兼容迁移。
    dimensionTouchedDays: v.optional(
      v.object({
        affinity: v.number(),
        trust: v.number(),
        suspicion: v.number(),
        debt: v.number(),
        fear: v.number(),
      }),
    ),
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

// C005 有限环境资源。预约不另造锁表，而由 active ActionExecution 的
  // resourceNodeId/reservedQuantity 表达；完成时节点与背包同事务结算。
  resourceNodes: defineTable({
    worldId: v.id('worlds'),
    resourceNodeId: v.string(),
    name: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    itemId: v.string(),
    tile: tilePointValidator,
    capacity: v.number(),
    stock: v.number(),
    refreshAmount: v.number(),
    refreshIntervalMs: v.number(),
    nextRefreshAt: v.optional(v.number()),
    refreshBlockedUntil: v.optional(v.number()),
    refreshBlockedByPressureId: v.optional(v.string()),
    // C019d：独立于临时 world pressure 的太虚历休眠 blocker。两个
    // blocker 取较晚者；解除任何一个都不能误解除另一个。
    seasonalContractVersion: v.optional(v.literal('taixu.seasonal_resource.v1')),
    seasonalRule: v.optional(v.literal('valley_dew_herb_winter_dormancy')),
    seasonalState: v.optional(v.union(v.literal('growing'), v.literal('dormant'))),
    seasonalAppliedSeasonIndex: v.optional(v.number()),
    seasonalRefreshBlockedUntil: v.optional(v.number()),
    accessRule: v.union(v.literal('public'), v.literal('actor')),
    ownerActorId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('byNode', ['worldId', 'resourceNodeId'])
    .index('byMap', ['worldId', 'mapId', 'resourceNodeId'])
    .index('byLocation', ['worldId', 'mapId', 'locationId', 'resourceNodeId']),

// C009 独立商店事实。商人个人背包不再冒充货架；货架、资金池和具名
  // 上游补给源共享一个文档，使最后一件货的并发购买由 Convex OCC 串行化。
  shopInventories: defineTable({
    worldId: v.id('worlds'),
    shopId: v.string(),
    name: v.string(),
    merchantActorId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    restockSourceId: v.string(),
    restockIntervalMs: v.number(),
    nextRestockAt: v.optional(v.number()),
    walletSpiritStones: v.number(),
    walletCapacity: v.number(),
    walletRestockAmount: v.number(),
    stock: v.array(
      v.object({
        itemId: v.string(),
        qty: v.number(),
        capacity: v.number(),
        restockAmount: v.number(),
      }),
    ),
    updatedAt: v.number(),
  })
    .index('byShop', ['worldId', 'shopId'])
    .index('byMerchant', ['worldId', 'merchantActorId'])
    .index('byLocation', ['worldId', 'mapId', 'locationId', 'shopId']),

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
      v.literal('incapacitated'),
      v.literal('deceased'),
    ),
    emoji: v.optional(v.string()),
    currentIntent: v.optional(v.string()),
    activityLabel: v.optional(v.string()),
    waypointId: v.optional(v.string()),
    nextActionAt: v.optional(v.number()),
    // 溪谷采药杂役的轻量 Utility 状态；旧青岚居民不需要这些字段。
    fatigue: v.optional(v.number()),
    herbNeed: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('byResident', ['worldId', 'residentId'])
    .index('byMap', ['worldId', 'mapId'])
    .index('byActor', ['worldId', 'actorId']),
} as const;
