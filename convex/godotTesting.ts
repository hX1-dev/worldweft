import type { Doc, Id } from './_generated/dataModel';
import { action, mutation, query } from './_generated/server';
import type { QueryCtx } from './_generated/server';
import { api, internal } from './_generated/api';
import { v } from 'convex/values';
import { breakthroughThreshold, seededRoll } from './xianxia/rules';
import { assertLocalGodotFixtureAccess } from './xianxia/access';
import {
  cancelMemoryFanoutForEvent,
  compactActorMemoriesInMutation,
  generateMemories,
} from './xianxia/memory';
import { toDurableActionResult, versionDurableEventFacts } from './xianxia/durableContracts';
import { appendWorldEvent } from './xianxia/events';
import {
  assertGodotSmokeActorId,
  godotSmokeCleanupPageLimit,
  nextGodotSmokeCleanupPhase,
  type GodotSmokeCleanupPhase,
} from './godotTestingPolicy';
import { QINGLAN_VALLEY_GATE_DATA } from '../data/qinglanValleyGate.generated';
import { addToInventory, applyRelationshipEvent } from './xianxia/actions';
import {
  relationshipDimsAt,
  type DimDelta,
  type RelationshipEffectKind,
} from './xianxia/relationshipLogic';
import {
  planConversationTurnIntent,
  planGroupDecisionIntent,
  planShopTradeIntent,
  planStrategicIntent,
  type AgentContext,
} from './xianxia/agentLogic';
import { collectAutonomyCandidates } from './xianxia/autonomyDecisionTraceLogic';
import { maybeIssueQuest, refreshRequestProgress } from './xianxia/quests';
import { readGameHour } from './xianxia/config';
import {
  finishSocialModelCallTx,
  markSocialModelCallStartedTx,
  reserveSocialModelCallTx,
} from './xianxia/socialModelRuntime';
import {
  SOCIAL_LLM_CALL_LEASE_MS,
  SOCIAL_LLM_CIRCUIT_OPEN_MS,
  SOCIAL_LLM_HOURLY_TOKEN_BUDGET,
  socialModelWindowStart,
} from './xianxia/socialModelPolicy';
import { registerBeliefEvidence } from './xianxia/beliefs';
import type { LifeObservationV1 } from './xianxia/lifeObservation';
import { INNER_TRAITS, OUTER_TRAITS } from './xianxia/personalityLogic';
import {
  ensureValleySurfaceSeeded,
  VALLEY_DEW_HERB_RESOURCE_NODE_ID,
} from './xianxia/valleyMovement';
import {
  ensureQinglanSurfaceSeeded,
  QINGLAN_ENTRY_LOCATION_ID,
  QINGLAN_MAP_ID,
} from './xianxia/qinglan';
import { isQinglanTileWalkable } from './xianxia/qinglanNavigation';
import {
  PERSONAL_GOAL_CONTRACT_VERSION,
  PERSONAL_GOAL_HARD_DEADLINE_HOURS,
  PERSONAL_GOAL_SOFT_DEADLINE_HOURS,
} from './xianxia/personalGoalContracts';
import {
  lifeCalendarAt,
  MS_PER_LIFE_SEASON,
  MS_PER_LIFE_YEAR,
} from './xianxia/lifeCalendarLogic';
import { actorLifecycleAt } from './xianxia/lifeProfileLogic';

const VALLEY_LIVE_ACTOR_ID = 'qinglan_valley_gate:resting_disciple';
const VALLEY_SEMANTIC_ACTION_ACTOR_ID = 'qinglan_valley_gate:herb_gatherer';
const VALLEY_PORTAL_ACTOR_ID = 'godot_player';
const VALLEY_INSPECT_ACTOR_ID = 'godot_player';
const VALLEY_LIVE_MAP_ID = 'qinglan_valley_gate';
const SYSTEM_LAB_MAP_ID = 'xianxia_system_lab';
const SYSTEM_LAB_LOCATION_ID = 'system_lab_cultivation_pad';
const SYSTEM_LAB_TILE = { x: 10, y: 10 };
const SYSTEM_LAB_RESOURCE_LOCATION_ID = 'system_lab_herb_patch';
const SYSTEM_LAB_RESOURCE_NODE_ID = 'system_lab_dew_herb_patch';
const SYSTEM_LAB_RESOURCE_TILE = { x: 20, y: 10 };
const SYSTEM_LAB_REST_LOCATION_ID = 'system_lab_rest_clearing';
const SYSTEM_LAB_REST_TILE = { x: 30, y: 10 };
const SYSTEM_LAB_BREAKTHROUGH_LOCATION_ID = 'system_lab_breakthrough_terrace';
const SYSTEM_LAB_BREAKTHROUGH_TILE = { x: 40, y: 10 };
const SYSTEM_LAB_SHOP_LOCATION_ID = 'system_lab_supply_shop';
const SYSTEM_LAB_SHOP_TILE = { x: 50, y: 10 };
const SYSTEM_LAB_SHOP_ID = 'system_lab_supply_shop_v1';
const SYSTEM_LAB_SHOPKEEPER_ACTOR_ID = 'system_lab_shopkeeper';
const SYSTEM_LAB_CONFLICT_LOCATION_ID = 'system_lab_conflict_yard';
const SYSTEM_LAB_CONFLICT_TILE = { x: 60, y: 10 };
const SYSTEM_LAB_REQUEST_LOCATION_ID = 'system_lab_request_hall';
const SYSTEM_LAB_REQUEST_TILE = { x: 70, y: 10 };
const SYSTEM_LAB_GIFT_LOCATION_ID = 'system_lab_gift_courtyard';
const SYSTEM_LAB_GIFT_TILE = { x: 80, y: 10 };
const SYSTEM_LAB_TEACHING_LOCATION_ID = 'system_lab_teaching_court';
const SYSTEM_LAB_TEACHING_TILE = { x: 90, y: 10 };
const SYSTEM_LAB_PERSONA_LOCATION_ID = 'system_lab_persona_crossroads';
const SYSTEM_LAB_PERSONA_TILE = { x: 100, y: 10 };
const SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID = 'system_lab_personal_goal_yard';
const SYSTEM_LAB_PERSONAL_GOAL_TILE = { x: 110, y: 10 };
  'system_lab_pi_npc_kernel_herbs';
const WORLD_DIRECTOR_LAB_MAP_ID = 'xianxia_world_director_lab';
const WORLD_DIRECTOR_PRESSURE_LOCATION_ID = 'world_director_herb_slope';
const WORLD_DIRECTOR_SAFE_LOCATION_ID = 'world_director_safe_lodge';
const WORLD_DIRECTOR_MARKET_LOCATION_ID = 'world_director_market';
const WORLD_DIRECTOR_QUIET_LOCATION_ID = 'world_director_quiet_court';
const WORLD_DIRECTOR_RESOURCE_NODE_ID = 'world_director_spirit_herb_node';
const WORLD_DIRECTOR_SHOP_ID = 'world_director_herb_shop';
const WORLD_DIRECTOR_GUARD_ACTOR_ID = 'system_lab_world_director_guard';
const WORLD_DIRECTOR_MERCHANT_ACTOR_ID = 'system_lab_world_director_merchant';
const REAL_DAY_MS = 24 * 60 * 60 * 1_000;
const C015_MEMORY_EVENT_PREFIX = 'c015_memory_fixture_';
const C015B_RELATIONSHIP_EVENT_PREFIX = 'c015b_relationship_fixture:';
const C016D1_CAUSAL_HISTORY_PREFIX = 'godot_smoke_c014_causal_';
const C016D2_MEMORY_REPLAY_PREFIX = 'godot_smoke_c016d2_memory_';
const C016D3_GROUP_ACTOR_PREFIX = 'godot_smoke_c014_compaction_';
const C016D3_MEMORY_TYPE_PREFIX = 'c016d3_unrelated_memory_';
const C016D4_SUPPORT_HISTORY_PREFIX = 'godot_smoke_c014_support_';
const C016D6_COMMITMENT_HISTORY_PREFIX = 'godot_smoke_c014_commitment_';
const C019A_FIXTURE_PREFIX = 'godot_smoke_c019a_';
const C019B_FIXTURE_PREFIX = 'godot_smoke_c019b_';
const C019C_FIXTURE_PREFIX = 'godot_smoke_c019c_';
const C019D_FIXTURE_PREFIX = 'godot_smoke_c019d_';
const C019E_FIXTURE_PREFIX = 'godot_smoke_c019e_';
const C019F_FIXTURE_PREFIX = 'godot_smoke_c019f_';

function c015bRelationshipFixtureSpec(eventType: string): {
  effectKind: RelationshipEffectKind;
  sourceGameDay: number;
  baseDelta: DimDelta;
} | null {
  if (!eventType.startsWith(C015B_RELATIONSHIP_EVENT_PREFIX)) return null;
  const [effectKind, dayText] = eventType.slice(C015B_RELATIONSHIP_EVENT_PREFIX.length).split(':');
  const sourceGameDay = Number(dayText);
  if (!Number.isInteger(sourceGameDay) || sourceGameDay < 0) return null;
  const deltas: Partial<Record<RelationshipEffectKind, DimDelta>> = {
    routine_talk: { affinity: 2, trust: 1 },
    gift: { affinity: 6, trust: 1, debt: 5 },
    trade: { trust: 2 },
    quest_completion: { trust: 5, debt: 5 },
    assault: { affinity: -18, suspicion: 20, fear: 15 },
  };
  const baseDelta = deltas[effectKind as RelationshipEffectKind];
  return baseDelta
    ? { effectKind: effectKind as RelationshipEffectKind, sourceGameDay, baseDelta }
    : null;
}

async function c015MemoryFixtureEvents(
  ctx: QueryCtx,
  worldId: Id<'worlds'>,
  actorId: string,
) {
  const memories = await ctx.db
    .query('shortMemories')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .collect();
  const fixtureMemories = memories.filter((memory) => memory.type.startsWith(C015_MEMORY_EVENT_PREFIX));
  const events = [];
  for (const memory of fixtureMemories) {
    const event = await ctx.db.get(memory.sourceEventId as Id<'worldEvents'>);
    if (event && event.worldId === worldId) events.push(event);
  }
  return events;
}

async function inspectMemoriesForEvents(
  ctx: QueryCtx,
  worldId: Id<'worlds'>,
  events: Array<Doc<'worldEvents'>>,
  actorIds: string[],
) {
  const allowedActors = new Set(actorIds);
  const memories = (
    await Promise.all(events.map((event) =>
      ctx.db
        .query('shortMemories')
        .withIndex('bySourceEvent', (q) =>
          q.eq('worldId', worldId).eq('sourceEventId', String(event._id)),
        )
        .collect(),
    ))
  ).flat().filter((memory) => allowedActors.has(memory.actorId));
  return memories.map((memory) => ({
    actorId: memory.actorId,
    sourceEventId: memory.sourceEventId,
    type: memory.type,
    source: memory.source,
    lifecycle: memory.lifecycle,
  }));
}

export const inspectActionExecutions = query({
  args: { actorId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectActionExecutions');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const limit = Math.max(1, Math.min(20, Math.floor(args.limit ?? 5)));
    const rows = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .take(limit);
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    return await Promise.all(
      rows.map(async (execution) => {
        const record = await ctx.db.get(execution.actionRecordId);
        const linkedEvents = await ctx.db
          .query('worldEvents')
          .withIndex('byAction', (q) =>
            q.eq('worldId', status.worldId).eq('actionId', execution.actionRecordId),
          )
          .collect();
        return {
          executionId: execution._id,
          actionRecordId: execution.actionRecordId,
          revision: execution.revision,
          actionType: execution.actionType,
          executionSource: execution.source,
          status: execution.status,
          leaseOwner: execution.leaseOwner,
          mapId: execution.mapId,
          locationId: execution.locationId,
          cultivationMode: execution.cultivationMode,
          reservedItemId: execution.reservedItemId,
          reservedItemQuantity: execution.reservedItemQuantity,
          durationMs: execution.durationMs,
          lastMapId: execution.lastMapId,
          lastTile: execution.lastTile,
          issuedAt: execution.issuedAt,
          acceptedAt: execution.acceptedAt,
          startedAt: execution.startedAt,
          terminalAt: execution.terminalAt,
          terminalEventId: execution.terminalEventId,
          resultCode: execution.resultCode,
          reasonCode: execution.reasonCode,
          actionStatus: record?.status,
          actionSource: record?.source,
          actionResult: record?.result,
          actorCultivationXp: profile?.cultivationXp,
          actorFatigue: profile?.fatigue ?? 0,
          actorInventory: profile?.inventory ?? [],
          actorRealm: profile?.realm,
          actorRealmStage: profile?.realmStage,
          actorRealmEnteredAt: profile?.realmEnteredAt,
          actorBreakthroughRecoveryUntil: profile?.breakthroughRecoveryUntil,
          linkedEventCount: linkedEvents.length,
          terminalEffectEventCount: linkedEvents.filter(
            (event) =>
              event.type === 'cultivation_completed' || event.type === 'breakthrough_resolved',
          ).length,
          terminalEventFacts: linkedEvents.find(
            (event) => event._id === execution.terminalEventId,
          )?.facts,
        };
      }),
    );
  },
});

/** C016e3a local-only facts. Gift submission and settlement still use production paths. */
export const primeGiftActionFixture = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.string(),
    itemId: v.optional(v.string()),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGiftActionFixture');
    if (args.actorId !== 'godot_player') {
      assertGodotSmokeActorId(args.actorId, 'primeGiftActionFixture');
    }
    assertGodotSmokeActorId(args.targetActorId, 'primeGiftActionFixture');
    if (args.actorId === args.targetActorId) throw new Error('Gift fixture actors must differ.');
    const quantity = Math.max(1, Math.min(4, Math.floor(args.quantity ?? 2)));
    const itemId = args.itemId ?? 'spirit_stone';
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const locationPatch = {
      name: '系统灰盒赠礼庭院',
      kind: 'social_courtyard',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 1,
      allowedActions: ['gift'],
      entryPoints: [SYSTEM_LAB_GIFT_TILE],
      bounds: { x1: 78, y1: 8, x2: 82, y2: 12 },
      description: 'C016e3a 赠礼身体、预约、冷却与幂等灰盒。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_GIFT_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_GIFT_LOCATION_ID,
        ...locationPatch,
      });
    }
    const profiles = [
      {
        actorId: args.actorId,
        name: '灰盒赠礼者',
        inventory: [{ itemId, qty: quantity }],
        currentIntent: '当面递出礼物，等待身体执行完成。',
      },
      {
        actorId: args.targetActorId,
        name: '灰盒受礼者',
        inventory: [] as { itemId: string; qty: number }[],
        currentIntent: '在庭院中等待并自主决定是否收礼。',
      },
    ];
    for (const spec of profiles) {
      const profilePatch = {
        name: spec.name,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 20,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: 0,
        inventory: spec.inventory,
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_GIFT_LOCATION_ID,
        currentIntent: spec.currentIntent,
        persona: '只依据当前事实行动的灰盒角色。',
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
      };
      const existing = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', spec.actorId),
        )
        .first();
      if (existing) await ctx.db.patch(existing._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: spec.actorId,
          ...profilePatch,
        });
      }
      const residentPatch = {
        actorId: spec.actorId,
        name: spec.name,
        role: 'outer_disciple',
        character: 'f1',
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_GIFT_LOCATION_ID,
        displayTile: SYSTEM_LAB_GIFT_TILE,
        targetTile: SYSTEM_LAB_GIFT_TILE,
        finalTargetTile: SYSTEM_LAB_GIFT_TILE,
        pathTiles: [] as { x: number; y: number }[],
        orientation: 0,
        status: 'waiting' as const,
        currentIntent: spec.currentIntent,
        activityLabel: 'gift_fixture',
        waypointId: SYSTEM_LAB_GIFT_LOCATION_ID,
        nextActionAt: now + 60_000,
        updatedAt: now,
      };
      const resident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', spec.actorId),
        )
        .filter((q) => q.eq(q.field('mapId'), SYSTEM_LAB_MAP_ID))
        .first();
      if (resident) await ctx.db.patch(resident._id, residentPatch);
      else {
        await ctx.db.insert('qinglanResidents', {
          worldId: status.worldId,
          residentId: `c016e3a:${spec.actorId}`,
          ...residentPatch,
        });
      }
    }
    return {
      worldId: status.worldId,
      actorId: args.actorId,
      targetActorId: args.targetActorId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_GIFT_LOCATION_ID,
      tile: SYSTEM_LAB_GIFT_TILE,
      itemId,
      quantity,
    };
  },
});

export const submitGiftFixtureAgentAction = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    itemId: v.string(),
    decisionId: v.string(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.submitGiftFixtureAgentAction');
    assertGodotSmokeActorId(args.actorId, 'submitGiftFixtureAgentAction');
    assertGodotSmokeActorId(args.targetActorId, 'submitGiftFixtureAgentAction');
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: 'gift',
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: args.targetActorId,
      locationId: SYSTEM_LAB_GIFT_LOCATION_ID,
      intent: '依据人设当面赠出一件已有物品。',
      params: { itemId: args.itemId },
    });
    return { actorId: args.actorId, decisionSource: 'rule', result };
  },
});

export const inspectGiftActionFixture = query({
  args: { actorId: v.string(), targetActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGiftActionFixture');
    if (args.actorId !== 'godot_player') {
      assertGodotSmokeActorId(args.actorId, 'inspectGiftActionFixture');
    }
    assertGodotSmokeActorId(args.targetActorId, 'inspectGiftActionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [actor, target, usages, records, executions] = await Promise.all([
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).first(),
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.targetActorId),
      ).first(),
      ctx.db.query('socialActionUsages').withIndex('byActorTargetTypeDay', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('actorId', args.actorId)
          .eq('targetActorId', args.targetActorId)
          .eq('actionType', 'gift'),
      ).collect(),
      ctx.db.query('actionRecords').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).collect(),
      ctx.db.query('actionExecutions').withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).collect(),
    ]);
    const giftRecords = records.filter(
      (record) => record.type === 'gift' && record.targetActorId === args.targetActorId,
    );
    const giftActionIds = new Set(giftRecords.map((record) => String(record._id)));
    const giftExecutions = executions.filter((execution) =>
      giftActionIds.has(String(execution.actionRecordId)),
    );
    const events = (
      await Promise.all(giftRecords.map((record) =>
        ctx.db.query('worldEvents').withIndex('byAction', (q) =>
          q.eq('worldId', status.worldId).eq('actionId', String(record._id)),
        ).collect(),
      ))
    ).flat();
    const terminalEventIds = new Set(
      giftExecutions.flatMap((execution) =>
        execution.terminalEventId ? [String(execution.terminalEventId)] : [],
      ),
    );
    const memories = (
      await Promise.all([...terminalEventIds].map((eventId) =>
        ctx.db.query('shortMemories').withIndex('bySourceEvent', (q) =>
          q.eq('worldId', status.worldId).eq('sourceEventId', eventId),
        ).collect(),
      ))
    ).flat();
    const relationshipChanges = (
      await Promise.all([...terminalEventIds].map((eventId) =>
        ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) =>
          q.eq('worldId', status.worldId).eq('sourceEventId', eventId),
        ).collect(),
      ))
    ).flat();
    return {
      actorInventory: actor?.inventory ?? [],
      targetInventory: target?.inventory ?? [],
      usageCount: usages.length,
      usages: usages.map((usage) => ({
        usageId: usage.usageId,
        actionRecordId: usage.actionRecordId,
        sourceEventId: usage.sourceEventId,
        sourceGameDay: usage.sourceGameDay,
        outcome: usage.outcome,
      })),
      records: giftRecords.map((record) => ({
        actionRecordId: record._id,
        source: record.source,
        status: record.status,
        result: record.result,
        clientActionId: record.clientActionId,
      })),
      executions: giftExecutions.map((execution) => ({
        executionId: execution._id,
        actionRecordId: execution.actionRecordId,
        revision: execution.revision,
        source: execution.source,
        status: execution.status,
        reservedItemId: execution.reservedItemId,
        reservedItemQuantity: execution.reservedItemQuantity,
        terminalEventId: execution.terminalEventId,
        resultCode: execution.resultCode,
        reasonCode: execution.reasonCode,
      })),
      events: events.map((event) => ({
        eventId: event._id,
        actionId: event.actionId,
        type: event.type,
        facts: event.facts,
        effects: event.effects,
      })),
      terminalMemoryCount: memories.length,
      relationshipChangeCount: relationshipChanges.length,
      providerCalls: 0,
    };
  },
});

export const primeTeachingActionFixture = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.string(),
    actorRealm: v.optional(v.string()),
    actorRealmStage: v.optional(v.number()),
    targetRealm: v.optional(v.string()),
    targetRealmStage: v.optional(v.number()),
    actorReputation: v.optional(v.number()),
    relationship: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeTeachingActionFixture');
    assertGodotSmokeActorId(args.actorId, 'primeTeachingActionFixture');
    assertGodotSmokeActorId(args.targetActorId, 'primeTeachingActionFixture');
    if (args.actorId === args.targetActorId) throw new Error('Teaching fixture actors must differ.');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const locationPatch = {
      name: '系统灰盒问道庭',
      kind: 'teaching_court',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 4,
      allowedActions: ['request_teaching', 'cultivate'],
      entryPoints: [SYSTEM_LAB_TEACHING_TILE],
      bounds: { x1: 88, y1: 8, x2: 92, y2: 12 },
      description: 'C016e3c 求教身体、资格、师者占用、冷却与幂等灰盒。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_TEACHING_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_TEACHING_LOCATION_ID,
        ...locationPatch,
      });
    }
    const profiles = [
      {
        actorId: args.actorId,
        name: '灰盒求教者',
        role: 'outer_disciple',
        realm: args.actorRealm ?? 'qi_refining',
        realmStage: args.actorRealmStage ?? 2,
        cultivationXp: 20,
        reputation: args.actorReputation ?? 0,
        currentIntent: '当面请求一次有界的修行基础指点。',
      },
      {
        actorId: args.targetActorId,
        name: '灰盒师者',
        role: 'elder',
        realm: args.targetRealm ?? 'foundation_building',
        realmStage: args.targetRealmStage ?? 2,
        cultivationXp: 180,
        reputation: 25,
        currentIntent: '在问道庭一次只指点一名后辈。',
      },
    ];
    for (const spec of profiles) {
      const profilePatch = {
        name: spec.name,
        role: spec.role,
        realm: spec.realm,
        realmStage: spec.realmStage,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: spec.role === 'elder' ? '义气' : '任我',
        cultivationXp: spec.cultivationXp,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: spec.reputation,
        inventory: [{ itemId: 'spirit_stone', qty: 8 }],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_TEACHING_LOCATION_ID,
        currentIntent: spec.currentIntent,
        persona: '只依据当前事实行动的灰盒角色。',
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
      };
      const existing = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', spec.actorId),
        )
        .first();
      if (existing) await ctx.db.patch(existing._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: spec.actorId,
          ...profilePatch,
        });
      }
      const residentPatch = {
        actorId: spec.actorId,
        name: spec.name,
        role: spec.role,
        character: 'f1',
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_TEACHING_LOCATION_ID,
        displayTile: SYSTEM_LAB_TEACHING_TILE,
        targetTile: SYSTEM_LAB_TEACHING_TILE,
        finalTargetTile: SYSTEM_LAB_TEACHING_TILE,
        pathTiles: [] as { x: number; y: number }[],
        orientation: 0,
        status: 'waiting' as const,
        currentIntent: spec.currentIntent,
        activityLabel: 'teaching_fixture',
        waypointId: SYSTEM_LAB_TEACHING_LOCATION_ID,
        nextActionAt: now + 60_000,
        updatedAt: now,
      };
      const resident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', spec.actorId),
        )
        .filter((q) => q.eq(q.field('mapId'), SYSTEM_LAB_MAP_ID))
        .first();
      if (resident) await ctx.db.patch(resident._id, residentPatch);
      else {
        await ctx.db.insert('qinglanResidents', {
          worldId: status.worldId,
          residentId: `c016e3c:${spec.actorId}`,
          ...residentPatch,
        });
      }
    }
    for (const [fromActorId, toActorId, value] of [
      [args.actorId, args.targetActorId, args.relationship ?? 8],
      [args.targetActorId, args.actorId, Math.max(0, args.relationship ?? 8)],
    ] as const) {
      const relationship = await ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q.eq('worldId', status.worldId).eq('fromActorId', fromActorId).eq('toActorId', toActorId),
        )
        .first();
      const patch = { value, trust: 4, suspicion: 0, debt: 0, fear: 0, tags: ['smoke_test'] };
      if (relationship) await ctx.db.patch(relationship._id, patch);
      else {
        await ctx.db.insert('relationships', {
          worldId: status.worldId,
          fromActorId,
          toActorId,
          ...patch,
        });
      }
    }
    return {
      worldId: status.worldId,
      actorId: args.actorId,
      targetActorId: args.targetActorId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_TEACHING_LOCATION_ID,
      tile: SYSTEM_LAB_TEACHING_TILE,
      topic: 'cultivation_fundamentals' as const,
    };
  },
});

export const submitTeachingFixtureAgentAction = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    decisionId: v.string(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.submitTeachingFixtureAgentAction');
    assertGodotSmokeActorId(args.actorId, 'submitTeachingFixtureAgentAction');
    assertGodotSmokeActorId(args.targetActorId, 'submitTeachingFixtureAgentAction');
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: 'request_teaching',
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: args.targetActorId,
      locationId: SYSTEM_LAB_TEACHING_LOCATION_ID,
      intent: '依据当前境界和关系，当面请求一次修行基础指点。',
      params: { topic: 'cultivation_fundamentals' },
    });
    return { actorId: args.actorId, decisionSource: 'rule', result };
  },
});

export const setTeachingExecutionOutcome = mutation({
  args: {
    actorId: v.string(),
    outcome: v.union(v.literal('granted'), v.literal('refused')),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setTeachingExecutionOutcome');
    assertGodotSmokeActorId(args.actorId, 'setTeachingExecutionOutcome');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    if (
      !execution ||
      execution.actionType !== 'request_teaching' ||
      !['pending', 'accepted', 'acting'].includes(execution.status)
    ) {
      throw new Error('No active teaching execution to seed.');
    }
    let seed = '';
    for (let index = 0; index < 20_000; index += 1) {
      const candidate = `restricted:c016e3c:${args.actorId}:${args.outcome}:${index}`;
      const roll = seededRoll(candidate);
      if ((args.outcome === 'granted' && roll >= 0.25) || (args.outcome === 'refused' && roll < 0.25)) {
        seed = candidate;
        break;
      }
    }
    if (!seed) throw new Error(`Unable to derive deterministic ${args.outcome} teaching seed.`);
    await ctx.db.patch(execution.actionRecordId, { seed });
    return { executionId: execution._id, seed, outcome: args.outcome };
  },
});

export const inspectTeachingActionFixture = query({
  args: { actorId: v.string(), targetActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectTeachingActionFixture');
    assertGodotSmokeActorId(args.actorId, 'inspectTeachingActionFixture');
    assertGodotSmokeActorId(args.targetActorId, 'inspectTeachingActionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [actor, target, usages, records, executions, modelCalls] = await Promise.all([
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).first(),
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.targetActorId),
      ).first(),
      ctx.db.query('socialActionUsages').withIndex('byActorTargetTypeDay', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).collect(),
      ctx.db.query('actionRecords').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).collect(),
      ctx.db.query('actionExecutions').withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).collect(),
      ctx.db.query('socialModelCalls').withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).collect(),
    ]);
    const teachingRecords = records.filter(
      (record) => record.type === 'request_teaching' && record.targetActorId === args.targetActorId,
    );
    const actionIds = new Set(teachingRecords.map((record) => String(record._id)));
    const teachingExecutions = executions.filter((execution) =>
      actionIds.has(String(execution.actionRecordId)),
    );
    const events = (
      await Promise.all(teachingRecords.map((record) =>
        ctx.db.query('worldEvents').withIndex('byAction', (q) =>
          q.eq('worldId', status.worldId).eq('actionId', String(record._id)),
        ).collect(),
      ))
    ).flat();
    const terminalEventIds = new Set(
      teachingExecutions.flatMap((execution) =>
        execution.terminalEventId ? [String(execution.terminalEventId)] : [],
      ),
    );
    const memories = (
      await Promise.all([...terminalEventIds].map((eventId) =>
        ctx.db.query('shortMemories').withIndex('bySourceEvent', (q) =>
          q.eq('worldId', status.worldId).eq('sourceEventId', eventId),
        ).collect(),
      ))
    ).flat();
    const relationshipChanges = (
      await Promise.all([...terminalEventIds].map((eventId) =>
        ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) =>
          q.eq('worldId', status.worldId).eq('sourceEventId', eventId),
        ).collect(),
      ))
    ).flat();
    return {
      actor: actor
        ? { cultivationXp: actor.cultivationXp, mood: actor.mood, health: actor.health }
        : null,
      target: target ? { health: target.health } : null,
      usageCount: usages.filter((usage) => usage.actionType === 'request_teaching').length,
      usages: usages
        .filter((usage) => usage.actionType === 'request_teaching')
        .map((usage) => ({
          usageId: usage.usageId,
          sourceEventId: usage.sourceEventId,
          targetActorId: usage.targetActorId,
          sourceGameDay: usage.sourceGameDay,
          outcome: usage.outcome,
        })),
      records: teachingRecords.map((record) => ({
        actionRecordId: record._id,
        source: record.source,
        status: record.status,
        result: record.result,
        clientActionId: record.clientActionId,
      })),
      executions: teachingExecutions.map((execution) => ({
        executionId: execution._id,
        actionRecordId: execution.actionRecordId,
        revision: execution.revision,
        source: execution.source,
        status: execution.status,
        teachingTopic: execution.teachingTopic,
        terminalEventId: execution.terminalEventId,
        resultCode: execution.resultCode,
        reasonCode: execution.reasonCode,
      })),
      events: events.map((event) => ({
        eventId: event._id,
        actionId: event.actionId,
        type: event.type,
        facts: event.facts,
        effects: event.effects,
      })),
      terminalMemoryCount: memories.length,
      relationshipChangeCount: relationshipChanges.length,
      providerCalls: modelCalls.length,
    };
  },
});

/**
 * Reset only the local live-movement fixture boundary. The persistent local
 * deployment is intentionally reused between runs, so without this reset the
 * LLM correctly sees prior movement history and is allowed to wait. A live
 * acceptance check needs a reproducible first-probe state where it must choose
 * among multiple semantic destinations.
 */
export const primeValleyLiveAgent = mutation({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeValleyLiveAgent');
    if (args.actorId !== VALLEY_LIVE_ACTOR_ID) {
      throw new Error(`primeValleyLiveAgent only accepts ${VALLEY_LIVE_ACTOR_ID}.`);
    }

    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const point = QINGLAN_VALLEY_GATE_DATA.npcPoints.find(
      (entry) => `${VALLEY_LIVE_MAP_ID}:${entry.id}` === args.actorId,
    );
    if (!point) throw new Error(`No generated valley point for ${args.actorId}.`);

    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .filter((q) => q.eq(q.field('mapId'), VALLEY_LIVE_MAP_ID))
      .first();
    if (!resident) throw new Error(`No valley resident for ${args.actorId}.`);

    const commandIds = new Set<string>();
    const actorHistory = await ctx.db
      .query('movementCommands')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .take(128);
    for (const command of actorHistory) commandIds.add(command._id);
    for (const commandStatus of ['pending', 'accepted', 'moving'] as const) {
      const active = await ctx.db
        .query('movementCommands')
        .withIndex('byMapStatus', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('mapId', VALLEY_LIVE_MAP_ID)
            .eq('status', commandStatus),
        )
        .take(128);
      for (const command of active) commandIds.add(command._id);
    }
    for (const commandId of commandIds) {
      await ctx.db.delete(commandId as Id<'movementCommands'>);
    }

    const now = Date.now();
    await ctx.db.patch(resident._id, {
      currentLocationId: point.locationId,
      displayTile: point.tile,
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
      status: 'idle',
      currentIntent: '观察附近动静，没有需要时留在原地。',
      activityLabel: '待机',
      waypointId: undefined,
      nextActionAt: now,
      updatedAt: now,
    });
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (profile) {
      await ctx.db.patch(profile._id, {
        mapId: VALLEY_LIVE_MAP_ID,
        currentLocationId: point.locationId,
        currentIntent: '观察附近动静，没有需要时留在原地。',
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      startTile: point.tile,
      startLocationId: point.locationId,
      clearedCommands: commandIds.size,
    };
  },
});

/**
 * Restricted C018a fixture: reset only the three visible valley bodies and the
 * finite dew-herb node. The run itself still uses production Agent, movement,
 * ActionExecution, resource, fatigue and event paths.
 */
export const primeValleySemanticActions = mutation({
  args: {},
  handler: async (ctx) => {
    assertLocalGodotFixtureAccess('godotTesting.primeValleySemanticActions');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const now = Date.now();
    await ensureValleySurfaceSeeded(ctx, status.worldId, now);
    const herbInteraction = QINGLAN_VALLEY_GATE_DATA.interactions.find(
      (entry) => entry.id === VALLEY_DEW_HERB_RESOURCE_NODE_ID,
    );
    if (!herbInteraction) throw new Error('Generated dew-herb interaction is missing.');
    const node = await ctx.db
      .query('resourceNodes')
      .withIndex('byNode', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('resourceNodeId', VALLEY_DEW_HERB_RESOURCE_NODE_ID),
      )
      .first();
    if (!node) throw new Error('Valley dew-herb node was not seeded.');

    // Prove the ordinary idempotent seed path does not refill consumed stock.
    const preservedRefreshAt = now + 10 * 60_000;
    await ctx.db.patch(node._id, {
      stock: 1,
      nextRefreshAt: preservedRefreshAt,
      updatedAt: now,
    });
    await ensureValleySurfaceSeeded(ctx, status.worldId, now + 1);
    const preservedNode = await ctx.db.get(node._id);
    const seedPreservedConsumedStock =
      preservedNode?.stock === 1 && preservedNode.nextRefreshAt === preservedRefreshAt;
    if (!seedPreservedConsumedStock) {
      throw new Error('Valley surface seed refilled or rescheduled consumed herb stock.');
    }

    // The explicit local fixture may restore its own starting facts.
    await ctx.db.patch(node._id, {
      stock: 3,
      nextRefreshAt: undefined,
      updatedAt: now + 2,
    });

    const visiblePointIds = new Set(['valley_guide', 'resting_disciple', 'herb_gatherer']);
    const parkedRestTile = { x: 12, y: 10 };
    if (!['walkable', 'grass', 'dock'].includes(QINGLAN_VALLEY_GATE_DATA.cells[10][12])) {
      throw new Error('Restricted resting-disciple parking tile is not walkable.');
    }
    let clearedCommands = 0;
    let expiredExecutions = 0;
    for (const point of QINGLAN_VALLEY_GATE_DATA.npcPoints) {
      if (!visiblePointIds.has(point.id)) continue;
      const actorId = `${VALLEY_LIVE_MAP_ID}:${point.id}`;
      const resident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .filter((q) => q.eq(q.field('mapId'), VALLEY_LIVE_MAP_ID))
        .first();
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .first();
      if (!resident || !profile) throw new Error(`Valley actor is not seeded: ${actorId}`);

      const tile =
        point.id === 'resting_disciple'
          ? parkedRestTile
          : point.tile;
      const actorIsGatherer = actorId === VALLEY_SEMANTIC_ACTION_ACTOR_ID;
      await ctx.db.patch(resident._id, {
        currentLocationId: point.locationId,
        displayTile: tile,
        targetTile: undefined,
        finalTargetTile: undefined,
        pathTiles: undefined,
        status: 'idle',
        currentIntent: actorIsGatherer
          ? '疲劳已深，先去篝火休息，再返回药草坡采药。'
          : 'C018a 验收期间安静待机。',
        activityLabel: '待机',
        waypointId: undefined,
        nextActionAt: actorIsGatherer ? now : now + 10 * 60_000,
        fatigue: actorIsGatherer ? 80 : resident.fatigue,
        herbNeed: actorIsGatherer ? 70 : resident.herbNeed,
        updatedAt: now,
      });
      await ctx.db.patch(profile._id, {
        health: 10,
        maxHealth: 10,
        fatigue: actorIsGatherer ? 80 : profile.fatigue,
        inventory: actorIsGatherer
          ? (profile.inventory ?? []).filter((item) => item.itemId !== 'spirit_herb')
          : profile.inventory ?? [],
        mapId: VALLEY_LIVE_MAP_ID,
        currentLocationId: point.locationId,
        currentIntent: actorIsGatherer
          ? '疲劳已深，先去篝火休息，再返回药草坡采药。'
          : 'C018a 验收期间安静待机。',
      });

      const commands = await ctx.db
        .query('movementCommands')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .take(128);
      for (const command of commands) {
        await ctx.db.delete(command._id);
        clearedCommands += 1;
      }
      const executions = await ctx.db
        .query('actionExecutions')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .order('desc')
        .take(32);
      for (const execution of executions) {
        if (!['pending', 'accepted', 'acting'].includes(execution.status)) continue;
        await ctx.db.patch(execution._id, {
          expiresAt: now - 1,
          hardDeadlineAt: now - 1,
          updatedAt: now - 1,
        });
        expiredExecutions += 1;
      }
    }

    return {
      worldId: status.worldId,
      actorId: VALLEY_SEMANTIC_ACTION_ACTOR_ID,
      startedAt: now,
      startTile: QINGLAN_VALLEY_GATE_DATA.npcPoints.find(
        (entry) => entry.id === 'herb_gatherer',
      )!.tile,
      restTarget: { interactionId: 'rest_campfire', tile: { x: 11, y: 10 } },
      gatherTarget: {
        interactionId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
        tile: herbInteraction.tile,
      },
      initial: { fatigue: 80, herbNeed: 70, herbStock: 3 },
      seedPreservedConsumedStock,
      clearedCommands,
      expiredExecutions,
    };
  },
});

export const inspectValleySemanticActions = query({
  args: { actorId: v.string(), startedAt: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectValleySemanticActions');
    if (args.actorId !== VALLEY_SEMANTIC_ACTION_ACTOR_ID) {
      throw new Error(`inspectValleySemanticActions only accepts ${VALLEY_SEMANTIC_ACTION_ACTOR_ID}.`);
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [profile, resident, node, executions, records] = await Promise.all([
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).first(),
      ctx.db.query('qinglanResidents').withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).filter((q) => q.eq(q.field('mapId'), VALLEY_LIVE_MAP_ID)).first(),
      ctx.db.query('resourceNodes').withIndex('byNode', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('resourceNodeId', VALLEY_DEW_HERB_RESOURCE_NODE_ID),
      ).first(),
      ctx.db.query('actionExecutions').withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).order('desc').take(32),
      ctx.db.query('actionRecords').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).order('desc').take(64),
    ]);
    const recentExecutions = executions.filter(
      (execution) =>
        execution.issuedAt >= args.startedAt &&
        ['rest', 'gather'].includes(execution.actionType),
    );
    const executionActionIds = new Set(
      recentExecutions.map((execution) => String(execution.actionRecordId)),
    );
    const recentRecords = records.filter((record) =>
      executionActionIds.has(String(record._id)),
    );
    const events = (
      await Promise.all(recentRecords.map((record) =>
        ctx.db.query('worldEvents').withIndex('byAction', (q) =>
          q.eq('worldId', status.worldId).eq('actionId', String(record._id)),
        ).collect(),
      ))
    ).flat();
    return {
      actorId: args.actorId,
      profile: profile
        ? {
            fatigue: profile.fatigue ?? 0,
            inventory: profile.inventory,
            mapId: profile.mapId,
            currentLocationId: profile.currentLocationId,
          }
        : null,
      resident: resident
        ? {
            fatigue: resident.fatigue,
            herbNeed: resident.herbNeed,
            status: resident.status,
            activityLabel: resident.activityLabel,
            displayTile: resident.displayTile,
            currentLocationId: resident.currentLocationId,
          }
        : null,
      node: node
        ? {
            resourceNodeId: node.resourceNodeId,
            stock: node.stock,
            capacity: node.capacity,
            nextRefreshAt: node.nextRefreshAt,
          }
        : null,
      executions: recentExecutions.map((execution) => ({
        executionId: execution._id,
        actionRecordId: execution.actionRecordId,
        actionType: execution.actionType,
        status: execution.status,
        durationMs: execution.durationMs,
        acceptedAt: execution.acceptedAt,
        startedAt: execution.startedAt,
        terminalAt: execution.terminalAt,
        terminalEventId: execution.terminalEventId,
        resultCode: execution.resultCode,
        reasonCode: execution.reasonCode,
      })),
      records: recentRecords.map((record) => ({
        actionRecordId: record._id,
        type: record.type,
        source: record.source,
        status: record.status,
        result: record.result,
      })),
      events: events.map((event) => ({
        eventId: event._id,
        actionId: event.actionId,
        type: event.type,
        facts: event.facts,
        effects: event.effects,
      })),
    };
  },
});

/**
 * Restricted C018b fixture. It creates one ordinary player body on the valley
 * map and parks the first Qinglan west-gate entry so the server must choose
 * the second legal exit. The actual travel and arrive still use the public
 * Godot bridge and production action/movement paths.
 */
export const primeValleyPortalTravel = mutation({
  args: {},
  handler: async (ctx) => {
    assertLocalGodotFixtureAccess('godotTesting.primeValleyPortalTravel');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const now = Date.now();
    await ensureQinglanSurfaceSeeded(ctx, status.worldId);
    await ensureValleySurfaceSeeded(ctx, status.worldId, now);
    const portal = QINGLAN_VALLEY_GATE_DATA.interactions.find(
      (entry) => entry.id === 'west_return_portal',
    );
    if (
      !portal ||
      portal.kind !== 'portal' ||
      !('portal' in portal) ||
      portal.portal.status !== 'available'
    ) {
      throw new Error('Generated west return portal is not available.');
    }
    const portalDestination = portal.portal;
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
      )
      .first();
    if (!profile) throw new Error('godot_player profile was not seeded.');

    let resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
      )
      .first();
    const residentPatch = {
      name: profile.name,
      role: profile.role,
      character: 'C018b Portal 跨图验收身体',
      mapId: VALLEY_LIVE_MAP_ID,
      currentLocationId: portal.locationId,
      displayTile: { x: 4, y: 18 },
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
      orientation: 2,
      status: 'idle' as const,
      currentIntent: '沿溪谷西口返回青岚坊市。',
      activityLabel: '待机',
      waypointId: undefined,
      nextActionAt: now,
      updatedAt: now,
    };
    if (resident) {
      await ctx.db.patch(resident._id, residentPatch);
      resident = { ...resident, ...residentPatch };
    } else {
      const residentId = await ctx.db.insert('qinglanResidents', {
        worldId: status.worldId,
        residentId: 'c018b_portal_player',
        actorId: VALLEY_PORTAL_ACTOR_ID,
        ...residentPatch,
      });
      resident = (await ctx.db.get(residentId))!;
    }
    await ctx.db.patch(profile._id, {
      health: Math.max(1, profile.health),
      mapId: VALLEY_LIVE_MAP_ID,
      currentLocationId: portal.locationId,
      currentIntent: residentPatch.currentIntent,
    });

    const destinationLocation = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('locationId', portalDestination.destinationLocationId),
      )
      .first();
    const destinationEntryPoints =
      destinationLocation?.mapId === portalDestination.destinationMapId
        ? destinationLocation.entryPoints.filter(isQinglanTileWalkable)
        : [];
    if (destinationEntryPoints.length < 2) {
      throw new Error('Qinglan west gate needs two walkable destination entries.');
    }
    const occupiedDestinationTile = destinationEntryPoints[0];
    const expectedDestinationTile = destinationEntryPoints[1];
    const westGateResident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', 'qinglan:qinglan-guard-west'),
      )
      .first();
    if (!westGateResident) throw new Error('Qinglan west-gate resident was not seeded.');
    await ctx.db.patch(westGateResident._id, {
      mapId: QINGLAN_MAP_ID,
      currentLocationId: QINGLAN_ENTRY_LOCATION_ID,
      displayTile: occupiedDestinationTile,
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
      status: 'idle',
      nextActionAt: now + 10 * 60_000,
      updatedAt: now,
    });

    let clearedCommands = 0;
    const commands = await ctx.db
      .query('movementCommands')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
      )
      .take(128);
    for (const command of commands) {
      await ctx.db.delete(command._id);
      clearedCommands += 1;
    }

    const migratedActorId = 'qinglan_valley_gate:resting_disciple';
    const [migratedResident, migratedProfile] = await Promise.all([
      ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', migratedActorId),
        )
        .first(),
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', migratedActorId),
        )
        .first(),
    ]);
    if (!migratedResident || !migratedProfile) {
      throw new Error('Generated resting disciple was not seeded.');
    }
    const migratedResidentSnapshot = {
      mapId: migratedResident.mapId,
      currentLocationId: migratedResident.currentLocationId,
      displayTile: migratedResident.displayTile,
    };
    const migratedProfileSnapshot = {
      mapId: migratedProfile.mapId,
      currentLocationId: migratedProfile.currentLocationId,
    };
    await ctx.db.patch(migratedResident._id, {
      mapId: QINGLAN_MAP_ID,
      currentLocationId: QINGLAN_ENTRY_LOCATION_ID,
      displayTile: { x: 18, y: 20 },
    });
    await ctx.db.patch(migratedProfile._id, {
      mapId: QINGLAN_MAP_ID,
      currentLocationId: QINGLAN_ENTRY_LOCATION_ID,
    });
    await ensureValleySurfaceSeeded(ctx, status.worldId, now + 1);
    const migratedResidentAfterSeed = await ctx.db.get(migratedResident._id);
    const migratedProfileAfterSeed = await ctx.db.get(migratedProfile._id);
    const seedPreservedMigratedGeneratedResident =
      migratedResidentAfterSeed?.mapId === QINGLAN_MAP_ID &&
      migratedResidentAfterSeed.currentLocationId === QINGLAN_ENTRY_LOCATION_ID &&
      migratedResidentAfterSeed.displayTile.x === 18 &&
      migratedResidentAfterSeed.displayTile.y === 20 &&
      migratedProfileAfterSeed?.mapId === QINGLAN_MAP_ID &&
      migratedProfileAfterSeed.currentLocationId === QINGLAN_ENTRY_LOCATION_ID;
    await ctx.db.patch(migratedResident._id, migratedResidentSnapshot);
    await ctx.db.patch(migratedProfile._id, migratedProfileSnapshot);

    return {
      worldId: status.worldId,
      actorId: VALLEY_PORTAL_ACTOR_ID,
      startedAt: now,
      startTile: residentPatch.displayTile,
      startLocationId: portal.locationId,
      portalId: portal.id,
      portalTile: portal.tile,
      destinationMapId: portalDestination.destinationMapId,
      destinationLocationId: portalDestination.destinationLocationId,
      occupiedDestinationTile,
      expectedDestinationTile,
      firstDestinationTileOccupied: true,
      seedPreservedMigratedGeneratedResident,
      clearedCommands,
    };
  },
});

export const inspectValleyPortalTravel = query({
  args: { startedAt: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectValleyPortalTravel');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [profile, resident, commands, records] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
        )
        .first(),
      ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
        )
        .first(),
      ctx.db
        .query('movementCommands')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
        )
        .order('desc')
        .take(16),
      ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
        )
        .order('desc')
        .take(32),
    ]);
    const recentRecords = records.filter((entry) => entry.createdAt >= args.startedAt);
    const events = (
      await Promise.all(
        recentRecords.map((record) =>
          ctx.db
            .query('worldEvents')
            .withIndex('byAction', (q) =>
              q.eq('worldId', status.worldId).eq('actionId', record._id),
            )
            .collect(),
        ),
      )
    ).flat();
    return {
      profile,
      resident,
      commands: commands.filter((entry) => entry.issuedAt >= args.startedAt),
      records: recentRecords,
      events: events.filter((entry) => entry.createdAt >= args.startedAt),
    };
  },
});

export const verifyValleyPortalSeedPersistence = mutation({
  args: {},
  handler: async (ctx) => {
    assertLocalGodotFixtureAccess('godotTesting.verifyValleyPortalSeedPersistence');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    await ensureValleySurfaceSeeded(ctx, status.worldId, Date.now());
    const [profile, resident] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
        )
        .first(),
      ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_PORTAL_ACTOR_ID),
        )
        .first(),
    ]);
    return {
      profileMapId: profile?.mapId,
      profileLocationId: profile?.currentLocationId,
      residentMapId: resident?.mapId,
      residentLocationId: resident?.currentLocationId,
      residentTile: resident?.displayTile,
    };
  },
});

/**
 * Restricted C018c fixture. It only places one ordinary Godot body at the
 * valley west entry and clears that actor's old movement revisions. The
 * travel, exact arrival, inspect action, event and memory all use production
 * paths through the public Godot bridge.
 */
export const primeValleyInspect = mutation({
  args: {},
  handler: async (ctx) => {
    assertLocalGodotFixtureAccess('godotTesting.primeValleyInspect');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const now = Date.now();
    await ensureQinglanSurfaceSeeded(ctx, status.worldId);
    await ensureValleySurfaceSeeded(ctx, status.worldId, now);
    const interaction = QINGLAN_VALLEY_GATE_DATA.interactions.find(
      (entry) => entry.id === 'bridge_inscription',
    );
    if (
      !interaction ||
      !(interaction.actions as readonly string[]).includes('inspect') ||
      !('inspection' in interaction)
    ) {
      throw new Error('Generated bridge inscription is not inspectable.');
    }
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
      )
      .first();
    if (!profile) throw new Error('godot_player profile was not seeded.');

    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
      )
      .first();
    const startTile = { x: 4, y: 18 };
    const startLocationId = 'valley_west_entry';
    const residentPatch = {
      name: profile.name,
      role: profile.role,
      character: 'C018c Inspect 验收身体',
      mapId: VALLEY_LIVE_MAP_ID,
      currentLocationId: startLocationId,
      displayTile: startTile,
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
      orientation: 2,
      status: 'idle' as const,
      currentIntent: '前往木桥查看桥栏刻字。',
      activityLabel: '待机',
      waypointId: undefined,
      nextActionAt: now,
      updatedAt: now,
    };
    if (resident) {
      await ctx.db.patch(resident._id, residentPatch);
    } else {
      await ctx.db.insert('qinglanResidents', {
        worldId: status.worldId,
        residentId: 'c018c_inspect_player',
        actorId: VALLEY_INSPECT_ACTOR_ID,
        ...residentPatch,
      });
    }
    await ctx.db.patch(profile._id, {
      health: Math.max(1, profile.health),
      mapId: VALLEY_LIVE_MAP_ID,
      currentLocationId: startLocationId,
      currentIntent: residentPatch.currentIntent,
    });

    let clearedCommands = 0;
    const commands = await ctx.db
      .query('movementCommands')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
      )
      .take(128);
    for (const command of commands) {
      await ctx.db.delete(command._id);
      clearedCommands += 1;
    }

    return {
      worldId: status.worldId,
      actorId: VALLEY_INSPECT_ACTOR_ID,
      startedAt: now,
      startTile,
      startLocationId,
      interactionId: interaction.id,
      interactionTile: interaction.tile,
      interactionLocationId: interaction.locationId,
      observationId: interaction.inspection.observationId,
      observationRevision: interaction.inspection.revision,
      observation: interaction.inspection.observation,
      clearedCommands,
    };
  },
});

export const inspectValleyInspect = query({
  args: { startedAt: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectValleyInspect');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [profile, resident, commands, records] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
        )
        .first(),
      ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
        )
        .first(),
      ctx.db
        .query('movementCommands')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
        )
        .order('desc')
        .take(16),
      ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', VALLEY_INSPECT_ACTOR_ID),
        )
        .order('desc')
        .take(32),
    ]);
    const recentRecords = records.filter((record) => record.createdAt >= args.startedAt);
    const events = (
      await Promise.all(
        recentRecords.map((record) =>
          ctx.db
            .query('worldEvents')
            .withIndex('byAction', (q) =>
              q.eq('worldId', status.worldId).eq('actionId', record._id),
            )
            .collect(),
        ),
      )
    )
      .flat()
      .filter((event) => event.createdAt >= args.startedAt);
    const memories = (
      await Promise.all(
        events.map((event) =>
          ctx.db
            .query('shortMemories')
            .withIndex('bySourceEvent', (q) =>
              q.eq('worldId', status.worldId).eq('sourceEventId', event._id),
            )
            .collect(),
        ),
      )
    ).flat();
    return {
      profile,
      resident,
      commands: commands.filter((command) => command.issuedAt >= args.startedAt),
      records: recentRecords,
      events,
      memories,
    };
  },
});

export const primeGodotSoakActor = mutation({
  args: {
    actorId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotSoakActor');
    assertGodotSmokeActorId(args.actorId, 'primeGodotSoakActor');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const patch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 30,
      mood: 1,
      health: 9,
      spirit: 8,
      reputation: 0,
      inventory: [{ itemId: 'spirit_stone', qty: 6 }],
      mapId: args.mapId,
      currentLocationId: args.locationId,
      currentIntent: 'Godot long-soak semantic action fixture.',
      persona: 'Temporary long-soak actor; every outcome still resolves through Convex rules.',
    };
    const existing = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (existing) await ctx.db.patch(existing._id, patch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...patch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      mapId: args.mapId,
      locationId: args.locationId,
    };
  },
});

/**
 * Creates a local-only Agent body on the semantic system-lab map. The fixture
 * only constrains the observation to one legal action; it does not submit or
 * settle that action. The real Agent and the normal rule path still do both.
 */
export const primeActionExecutionAgent = mutation({
  args: {
    actorId: v.string(),
    decisionMode: v.union(v.literal('rule'), v.literal('llm')),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeActionExecutionAgent');
    assertGodotSmokeActorId(args.actorId, 'primeActionExecutionAgent');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const locationPatch = {
      name: '系统灰盒静修台',
      kind: 'meditation',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 3,
      allowedActions: ['cultivate'],
      entryPoints: [SYSTEM_LAB_TILE],
      bounds: { x1: 8, y1: 8, x2: 12, y2: 12 },
      description: '只用于本地规则验收的纯色静修区域，不依赖正式地图美术。',
    };
    const existingLocation = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_LOCATION_ID),
      )
      .first();
    if (existingLocation) await ctx.db.patch(existingLocation._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_LOCATION_ID,
        ...locationPatch,
      });
    }

    const profilePatch = {
      name: args.decisionMode === 'llm' ? '灰盒自主弟子' : '灰盒静修长老',
      // disciple 会把本地动作交给 LLM；elder 会走同一个正式 Agent
      // action，但按本分确定性选择 cultivate，便于完全离线的协议回归。
      role: args.decisionMode === 'llm' ? 'outer_disciple' : 'elder',
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 30,
      mood: 1,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 8,
      reputation: 0,
      inventory: [],
      mapId: SYSTEM_LAB_MAP_ID,
      currentLocationId: SYSTEM_LAB_LOCATION_ID,
      currentIntent: '观察灰盒环境后自行决定是否吐纳。',
      persona: '谨慎、务实，只依据眼前可执行的行动作决定。',
    };
    const existingProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (existingProfile) await ctx.db.patch(existingProfile._id, profilePatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...profilePatch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_LOCATION_ID,
      tile: SYSTEM_LAB_TILE,
      cultivationXp: profilePatch.cultivationXp,
      decisionMode: args.decisionMode,
    };
  },
});

export const primeCultivationResourceFixture = mutation({
  args: {
    actors: v.array(
      v.object({
        actorId: v.string(),
        role: v.union(v.literal('outer_disciple'), v.literal('elder')),
        spiritStones: v.number(),
        qiPills: v.number(),
        pendant: v.boolean(),
      }),
    ),
    spiritualEnergy: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeCultivationResourceFixture');
    if (args.actors.length < 1 || args.actors.length > 4) {
      throw new Error('primeCultivationResourceFixture requires 1-4 actors.');
    }
    if (new Set(args.actors.map((actor) => actor.actorId)).size !== args.actors.length) {
      throw new Error('primeCultivationResourceFixture requires unique actorIds.');
    }
    for (const actor of args.actors) {
      if (actor.actorId !== 'godot_player') {
        assertGodotSmokeActorId(actor.actorId, 'primeCultivationResourceFixture');
      }
      if (
        !Number.isInteger(actor.spiritStones) ||
        actor.spiritStones < 0 ||
        actor.spiritStones > 99 ||
        !Number.isInteger(actor.qiPills) ||
        actor.qiPills < 0 ||
        actor.qiPills > 99
      ) {
        throw new Error('Cultivation fixture inventory must be integer quantities in 0..99.');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const spiritualEnergy = Math.max(0, Math.min(10, args.spiritualEnergy));
    const locationPatch = {
      name: '系统灰盒静修台',
      kind: 'meditation',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy,
      allowedActions: ['cultivate'],
      entryPoints: [SYSTEM_LAB_TILE],
      bounds: { x1: 8, y1: 8, x2: 12, y2: 12 },
      description: 'C007 修炼资源、灵气与原子结算灰盒。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_LOCATION_ID,
        ...locationPatch,
      });
    }

    const actorViews = [];
    for (const actor of args.actors) {
      const inventory = [
        ...(actor.spiritStones > 0
          ? [{ itemId: 'spirit_stone', qty: actor.spiritStones }]
          : []),
        ...(actor.qiPills > 0 ? [{ itemId: 'qi_pill', qty: actor.qiPills }] : []),
        ...(actor.pendant ? [{ itemId: 'qi_pendant', qty: 1 }] : []),
      ];
      const profilePatch = {
        name: actor.role === 'elder' ? '灰盒静修长老' : '灰盒修炼弟子',
        role: actor.role,
        realm: 'qi_refining',
        realmStage: 3,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 30,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: 0,
        inventory,
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_LOCATION_ID,
        currentIntent: '依据真实资源和地点灵气选择修炼方式。',
        persona: '谨慎、务实，不浪费稀少丹药。',
      };
      const existing = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actor.actorId),
        )
        .first();
      if (existing) await ctx.db.patch(existing._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: actor.actorId,
          ...profilePatch,
        });
      }
      actorViews.push({
        actorId: actor.actorId,
        cultivationXp: profilePatch.cultivationXp,
        fatigue: profilePatch.fatigue,
        inventory,
      });
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_LOCATION_ID,
      tile: SYSTEM_LAB_TILE,
      spiritualEnergy,
      actors: actorViews,
    };
  },
});

export const attemptReservedInventorySpend = mutation({
  args: { actorId: v.string(), itemId: v.string(), quantity: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.attemptReservedInventorySpend');
    if (args.actorId !== 'godot_player') {
      assertGodotSmokeActorId(args.actorId, 'attemptReservedInventorySpend');
    }
    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 99) {
      throw new Error('quantity must be an integer in 1..99.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const spent = await addToInventory(
      ctx,
      status.worldId,
      args.actorId,
      args.itemId,
      -args.quantity,
    );
    return { spent };
  },
});

// Local bridge smoke cleanup only. Older smoke code used ordinary gift actions
// to put traded items back, which now correctly hits gift cooldown and body
// execution. Cleanup must not masquerade as a production social action.
export const restoreGodotSmokeInventoryTransfer = mutation({
  args: {
    fromActorId: v.string(),
    toActorId: v.string(),
    itemId: v.string(),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.restoreGodotSmokeInventoryTransfer');
    assertGodotSmokeActorId(args.fromActorId, 'restoreGodotSmokeInventoryTransfer');
    if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 10) {
      throw new Error('Smoke cleanup quantity must be an integer in 1..10.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [from, to] = await Promise.all([
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.fromActorId),
      ).first(),
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.toActorId),
      ).first(),
    ]);
    if (!from || !to) throw new Error('Smoke cleanup profiles are missing.');
    const fromInventory = [...(from.inventory ?? [])];
    const fromIndex = fromInventory.findIndex((item) => item.itemId === args.itemId);
    if (fromIndex < 0 || fromInventory[fromIndex].qty < args.quantity) {
      throw new Error('Smoke cleanup source lacks the transferred item.');
    }
    const remaining = fromInventory[fromIndex].qty - args.quantity;
    if (remaining === 0) fromInventory.splice(fromIndex, 1);
    else fromInventory[fromIndex] = { itemId: args.itemId, qty: remaining };
    const toInventory = [...(to.inventory ?? [])];
    const toIndex = toInventory.findIndex((item) => item.itemId === args.itemId);
    if (toIndex < 0) toInventory.push({ itemId: args.itemId, qty: args.quantity });
    else toInventory[toIndex] = { itemId: args.itemId, qty: toInventory[toIndex].qty + args.quantity };
    await ctx.db.patch(from._id, { inventory: fromInventory });
    await ctx.db.patch(to._id, { inventory: toInventory });
    return { restored: true, itemId: args.itemId, quantity: args.quantity };
  },
});

/**
 * C005 local-only finite-resource fixture. It creates facts, but never submits
 * or settles gather: player/Agent requests still traverse the production
 * action, ActionExecution and Godot report paths.
 */
export const primeResourceGatherFixture = mutation({
  args: {
    actorIds: v.array(v.string()),
    stock: v.union(v.literal(0), v.literal(1), v.literal(3)),
    fatigue: v.optional(v.union(v.literal(0), v.literal(60), v.literal(80), v.literal(100))),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeResourceGatherFixture');
    if (args.actorIds.length < 1 || args.actorIds.length > 4) {
      throw new Error('primeResourceGatherFixture requires 1-4 actorIds.');
    }
    if (new Set(args.actorIds).size !== args.actorIds.length) {
      throw new Error('primeResourceGatherFixture requires unique actorIds.');
    }
    for (const actorId of args.actorIds) {
      if (actorId !== 'godot_player') {
        assertGodotSmokeActorId(actorId, 'primeResourceGatherFixture');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const locationPatch = {
      name: '灰盒凝露药圃',
      kind: 'resource_patch',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 1,
      allowedActions: ['gather'],
      entryPoints: [SYSTEM_LAB_RESOURCE_TILE],
      bounds: { x1: 18, y1: 8, x2: 22, y2: 12 },
      description: '只用于验收有限库存、预约和幂等结算的本地灰盒药圃。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_RESOURCE_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_RESOURCE_LOCATION_ID,
        ...locationPatch,
      });
    }

    const now = Date.now();
    const nodePatch = {
      name: '凝露灵草丛',
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_RESOURCE_LOCATION_ID,
      itemId: 'spirit_herb',
      tile: SYSTEM_LAB_RESOURCE_TILE,
      capacity: 3,
      stock: args.stock,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: args.stock < 3 ? now + 30_000 : undefined,
      accessRule: 'public' as const,
      ownerActorId: undefined,
      updatedAt: now,
    };
    const node = await ctx.db
      .query('resourceNodes')
      .withIndex('byNode', (q) =>
        q.eq('worldId', status.worldId).eq('resourceNodeId', SYSTEM_LAB_RESOURCE_NODE_ID),
      )
      .first();
    if (node) await ctx.db.patch(node._id, nodePatch);
    else {
      await ctx.db.insert('resourceNodes', {
        worldId: status.worldId,
        resourceNodeId: SYSTEM_LAB_RESOURCE_NODE_ID,
        ...nodePatch,
      });
    }

    for (const actorId of args.actorIds) {
      const profilePatch = {
        name: `灰盒采药弟子 ${actorId.slice(-6)}`,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 3,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 30,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: args.fatigue ?? 0,
        spirit: 8,
        reputation: 0,
        inventory: [],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_RESOURCE_LOCATION_ID,
        currentIntent: '观察药圃库存后决定是否采集。',
        persona: '谨慎务实，只采集眼前真实存在的资源。',
      };
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .first();
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId,
          ...profilePatch,
        });
      }
    }

    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_RESOURCE_LOCATION_ID,
      resourceNodeId: SYSTEM_LAB_RESOURCE_NODE_ID,
      tile: SYSTEM_LAB_RESOURCE_TILE,
      stock: args.stock,
      fatigue: args.fatigue ?? 0,
      actorIds: args.actorIds,
    };
  },
});

export const inspectResourceGatherFixture = query({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectResourceGatherFixture');
    if (args.actorIds.length > 8) throw new Error('At most 8 actorIds may be inspected.');
    for (const actorId of args.actorIds) {
      if (actorId !== 'godot_player') {
        assertGodotSmokeActorId(actorId, 'inspectResourceGatherFixture');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const node = await ctx.db
      .query('resourceNodes')
      .withIndex('byNode', (q) =>
        q.eq('worldId', status.worldId).eq('resourceNodeId', SYSTEM_LAB_RESOURCE_NODE_ID),
      )
      .first();
    const actors = [];
    for (const actorId of args.actorIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .first();
      const executions = await ctx.db
        .query('actionExecutions')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .order('desc')
        .take(8);
      actors.push({
        actorId,
        inventory: profile?.inventory ?? [],
        fatigue: profile?.fatigue ?? 0,
        executions: executions.map((execution) => ({
          executionId: execution._id,
          actionRecordId: execution.actionRecordId,
          revision: execution.revision,
          actionType: execution.actionType,
          status: execution.status,
          resourceNodeId: execution.resourceNodeId,
          reservedQuantity: execution.reservedQuantity,
          terminalEventId: execution.terminalEventId,
          resultCode: execution.resultCode,
          reasonCode: execution.reasonCode,
        })),
      });
    }
    return {
      worldId: status.worldId,
      node: node
        ? {
            resourceNodeId: node.resourceNodeId,
            capacity: node.capacity,
            stock: node.stock,
            nextRefreshAt: node.nextRefreshAt,
            updatedAt: node.updatedAt,
          }
        : null,
      actors,
    };
  },
});

export const primeFatigueRestFixture = mutation({
  args: {
    actorIds: v.array(v.string()),
    fatigue: v.union(v.literal(0), v.literal(60), v.literal(80), v.literal(100)),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeFatigueRestFixture');
    if (args.actorIds.length < 1 || args.actorIds.length > 4) {
      throw new Error('primeFatigueRestFixture requires 1-4 actorIds.');
    }
    if (new Set(args.actorIds).size !== args.actorIds.length) {
      throw new Error('primeFatigueRestFixture requires unique actorIds.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const locationPatch = {
      name: '灰盒松风歇脚地',
      kind: 'rest_area',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 1,
      allowedActions: ['rest'],
      entryPoints: [SYSTEM_LAB_REST_TILE],
      bounds: { x1: 28, y1: 8, x2: 32, y2: 12 },
      description: '只用于验收疲劳门槛和持续休息的本地灰盒区。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_REST_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_REST_LOCATION_ID,
        ...locationPatch,
      });
    }
    for (const actorId of args.actorIds) {
      if (actorId !== 'godot_player') {
        assertGodotSmokeActorId(actorId, 'primeFatigueRestFixture');
      }
      const profilePatch = {
        name: `灰盒休息弟子 ${actorId.slice(-6)}`,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 3,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 30,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: args.fatigue,
        spirit: 8,
        reputation: 0,
        inventory: [],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_REST_LOCATION_ID,
        currentIntent: '疲劳时在合法歇脚地休息。',
        persona: '谨慎务实，疲劳时优先休息。',
      };
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .first();
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId,
          ...profilePatch,
        });
      }
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_REST_LOCATION_ID,
      tile: SYSTEM_LAB_REST_TILE,
      actorIds: args.actorIds,
      fatigue: args.fatigue,
    };
  },
});

const breakthroughFixtureScenario = v.union(
  v.literal('ready'),
  v.literal('time_unmet'),
  v.literal('missing_material'),
  v.literal('recovery_active'),
);

/** C008 restricted graybox facts; actions and settlement still use production paths. */
export const primeBreakthroughProgressFixture = mutation({
  args: {
    actorId: v.string(),
    role: v.union(v.literal('outer_disciple'), v.literal('elder')),
    scenario: breakthroughFixtureScenario,
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeBreakthroughProgressFixture');
    if (args.actorId !== 'godot_player') {
      assertGodotSmokeActorId(args.actorId, 'primeBreakthroughProgressFixture');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const locationPatch = {
      name: '灰盒破境台',
      kind: 'breakthrough_terrace',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 3,
      allowedActions: ['breakthrough'],
      entryPoints: [SYSTEM_LAB_BREAKTHROUGH_TILE],
      bounds: { x1: 38, y1: 8, x2: 42, y2: 12 },
      description: 'C008 突破材料、岁月墙、持续结算与失败恢复灰盒。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('locationId', SYSTEM_LAB_BREAKTHROUGH_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_BREAKTHROUGH_LOCATION_ID,
        ...locationPatch,
      });
    }
    const ready = args.scenario !== 'time_unmet';
    const inventory =
      args.scenario === 'missing_material'
        ? [{ itemId: 'spirit_stone', qty: 3 }]
        : [{ itemId: 'spirit_stone', qty: 8 }];
    const profilePatch = {
      name: args.role === 'elder' ? '灰盒破境长老' : '灰盒破境弟子',
      role: args.role,
      realm: 'qi_refining',
      realmStage: 9,
      realmEnteredAt: now - (ready ? 13 : 11) * REAL_DAY_MS,
      breakthroughRecoveryUntil:
        args.scenario === 'recovery_active' ? now + 4 * 30_000 : undefined,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: breakthroughThreshold('qi_refining', 9),
      mood: 2,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 8,
      reputation: 0,
      inventory,
      mapId: SYSTEM_LAB_MAP_ID,
      currentLocationId: SYSTEM_LAB_BREAKTHROUGH_LOCATION_ID,
      currentIntent: '核对岁月、材料与身体状态后再尝试冲关。',
      persona: '谨慎准备，不绕过岁月和材料门槛。',
    };
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (profile) await ctx.db.patch(profile._id, profilePatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...profilePatch,
      });
    }
    return {
      worldId: status.worldId,
      actorId: args.actorId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_BREAKTHROUGH_LOCATION_ID,
      tile: SYSTEM_LAB_BREAKTHROUGH_TILE,
      scenario: args.scenario,
      realmEnteredAt: profilePatch.realmEnteredAt,
      inventory,
    };
  },
});

export const forceActiveBreakthroughOutcome = mutation({
  args: {
    actorId: v.string(),
    outcome: v.union(
      v.literal('success'),
      v.literal('failure'),
      v.literal('deviation'),
    ),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.forceActiveBreakthroughOutcome');
    if (args.actorId !== 'godot_player') {
      assertGodotSmokeActorId(args.actorId, 'forceActiveBreakthroughOutcome');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    if (!execution || execution.actionType !== 'breakthrough' || !['pending', 'accepted', 'acting'].includes(execution.status)) {
      throw new Error('No active breakthrough execution to seed.');
    }
    let selected = '';
    for (let i = 0; i < 20_000; i += 1) {
      const candidate = `restricted:c008:${args.actorId}:${args.outcome}:${i}`;
      const roll = seededRoll(candidate);
      const mishap = seededRoll(`${candidate}:mishap`);
      if (
        (args.outcome === 'success' && roll < 0.1) ||
        (args.outcome === 'failure' && roll >= 0.85 && mishap >= 0.3) ||
        (args.outcome === 'deviation' && roll >= 0.85 && mishap < 0.3)
      ) {
        selected = candidate;
        break;
      }
    }
    if (!selected) throw new Error(`Unable to derive deterministic ${args.outcome} seed.`);
    await ctx.db.patch(execution.actionRecordId, { seed: selected });
    return {
      executionId: execution._id,
      actionRecordId: execution.actionRecordId,
      outcome: args.outcome,
      seed: selected,
    };
  },
});

/** Local-only live probe that calls the production Agent action unchanged. */
export const runActionExecutionAgent = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    decisionId: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runActionExecutionAgent');
    assertGodotSmokeActorId(args.actorId, 'runActionExecutionAgent');
    return await ctx.runAction(internal.xianxia.agent.proposeAndAct, args);
  },
});

/**
 * C017c local-only paired fixture. It changes only stable profile traits while
 * leaving location, body state, role and legal actions identical. Decisions
 * still pass through the unchanged production Agent and GM paths.
 */
export const primePersonaPolicyFixture = mutation({
  args: {
    actors: v.array(v.object({
      actorId: v.string(),
      innerTrait: v.string(),
      outerTrait: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primePersonaPolicyFixture');
    if (args.actors.length !== 2) {
      throw new Error('primePersonaPolicyFixture requires exactly two actors.');
    }
    if (new Set(args.actors.map((actor) => actor.actorId)).size !== 2) {
      throw new Error('primePersonaPolicyFixture requires unique actorIds.');
    }
    for (const actor of args.actors) {
      assertGodotSmokeActorId(actor.actorId, 'primePersonaPolicyFixture');
      if (
        !INNER_TRAITS.includes(actor.innerTrait as (typeof INNER_TRAITS)[number]) ||
        !OUTER_TRAITS.includes(actor.outerTrait as (typeof OUTER_TRAITS)[number])
      ) {
        throw new Error('primePersonaPolicyFixture requires registered traits.');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const locationPatch = {
      name: '系统灰盒性情岔路',
      kind: 'persona_crossroads',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 3,
      allowedActions: ['cultivate', 'explore'],
      entryPoints: [SYSTEM_LAB_PERSONA_TILE],
      bounds: { x1: 98, y1: 8, x2: 102, y2: 12 },
      description: 'C017c 同事实、同能力、不同结构化性格的生产决策配对场景。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_PERSONA_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_PERSONA_LOCATION_ID,
        ...locationPatch,
      });
    }
    for (const actor of args.actors) {
      const profilePatch = {
        name: `灰盒性情弟子 ${actor.actorId.slice(-6)}`,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: actor.innerTrait,
        outerTrait: actor.outerTrait,
        cultivationXp: 20,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: 0,
        inventory: [] as { itemId: string; qty: number }[],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_PERSONA_LOCATION_ID,
        currentIntent: '在相同条件下依结构化性情安排下一步生活。',
        persona: '此自由文本不参与确定性人格评分。',
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
      };
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actor.actorId),
        )
        .first();
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: actor.actorId,
          ...profilePatch,
        });
      }
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_PERSONA_LOCATION_ID,
      actors: args.actors,
    };
  },
});

/**
 * C017f local-only world pressure fixture. The director writes one sparse
 * environment fact; four production Agents then remain free to respond or
 * continue their ordinary lives through the unchanged policy/action path.
 */
export const primeLifeCalendarFixture = mutation({
  args: {
    fixtureId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeLifeCalendarFixture');
    if (!args.fixtureId.startsWith(C019A_FIXTURE_PREFIX)) {
      throw new Error('c019a_fixture_id_invalid');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      conversations: [],
      players: [],
      agents: [],
    });
    await ctx.db.insert('xianxiaConfig', {
      worldId,
      autoTickEnabled: false,
      lifeCalendarStartedAt: args.now,
      lifeCalendarAppliedSeasonIndex: 0,
      lifeCalendarAppliedAt: args.now,
    });
    return {
      fixtureId: args.fixtureId,
      worldId,
      startedAt: args.now,
      targetNow: args.now + 20 * MS_PER_LIFE_SEASON,
    };
  },
});

export const runLifeCalendarFixtureTick = action({
  args: {
    worldId: v.id('worlds'),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runLifeCalendarFixtureTick');
    return await ctx.runMutation(internal.xianxia.lifeCalendar.tickLifeCalendar, args);
  },
});

export const inspectLifeCalendarFixture = query({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectLifeCalendarFixture');
    const [config, events] = await Promise.all([
      ctx.db
        .query('xianxiaConfig')
        .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
        .first(),
      ctx.db
        .query('worldEvents')
        .withIndex('byType', (q) =>
          q.eq('worldId', args.worldId).eq('type', 'life_calendar_season_changed'),
        )
        .collect(),
    ]);
    const derivedCalendar =
      config?.lifeCalendarStartedAt === undefined
        ? null
        : lifeCalendarAt(args.now, config.lifeCalendarStartedAt);
    const calendar = derivedCalendar
      ? {
          ...derivedCalendar,
          appliedSeasonIndex: config?.lifeCalendarAppliedSeasonIndex ?? 0,
          pendingSeasonTransitions: Math.max(
            0,
            derivedCalendar.seasonIndex - (config?.lifeCalendarAppliedSeasonIndex ?? 0),
          ),
        }
      : null;
    return {
      calendar,
      config: config
        ? {
            lifeCalendarStartedAt: config.lifeCalendarStartedAt,
            lifeCalendarAppliedSeasonIndex: config.lifeCalendarAppliedSeasonIndex,
            lifeCalendarAppliedAt: config.lifeCalendarAppliedAt,
          }
        : null,
      events: events
        .map((event) => ({
          eventId: String(event._id),
          actionId: event.actionId,
          createdAt: event.createdAt,
          actorIds: event.actorIds,
          facts: event.facts,
          effects: event.effects,
        }))
        .sort((left, right) => left.createdAt - right.createdAt),
    };
  },
});

export const cleanupLifeCalendarFixture = mutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupLifeCalendarFixture');
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('byType', (q) =>
        q.eq('worldId', args.worldId).eq('type', 'life_calendar_season_changed'),
      )
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config) await ctx.db.delete(config._id);
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return { deletedEvents: events.length };
  },
});

export const primeSeasonalHerbFixture = mutation({
  args: {
    fixtureId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeSeasonalHerbFixture');
    if (!args.fixtureId.startsWith(C019D_FIXTURE_PREFIX)) {
      throw new Error('c019d_fixture_id_invalid');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      conversations: [],
      players: [],
      agents: [],
    });
    const startedAt = args.now - 2 * MS_PER_LIFE_SEASON;
    const winterBoundary = startedAt + 3 * MS_PER_LIFE_SEASON;
    const springBoundary = startedAt + 4 * MS_PER_LIFE_SEASON;
    await ctx.db.insert('xianxiaConfig', {
      worldId,
      autoTickEnabled: false,
      lifeCalendarStartedAt: startedAt,
      lifeCalendarAppliedSeasonIndex: 2,
      lifeCalendarAppliedAt: args.now,
    });
    await ctx.db.insert('locations', {
      worldId,
      locationId: 'herb_meadow',
      name: '药草坡',
      kind: 'herb_slope',
      dangerLevel: 0,
      spiritualEnergy: 4,
      allowedActions: ['gather', 'explore'],
      mapId: 'qinglan_valley_gate',
      entryPoints: [{ x: 20, y: 20 }],
      description: 'C019d 季节灵草独立验收地点。',
    });
    const actorId = `${args.fixtureId}:herbalist`;
    await ctx.db.insert('xianxiaProfiles', {
      worldId,
      actorId,
      name: '听露',
      role: 'herbalist',
      realm: 'qi_refining',
      realmStage: 2,
      spiritRoot: 'wood',
      innerTrait: '中庸',
      outerTrait: '传承',
      cultivationXp: 0,
      lifeBornAt: startedAt - 20 * MS_PER_LIFE_YEAR,
      lifeBirthSource: 'c019d_fixture',
      lifeBirthRecordedAt: args.now,
      lifeStatus: 'alive',
      mood: 1,
      health: 8,
      maxHealth: 8,
      fatigue: 0,
      spirit: 5,
      reputation: 0,
      inventory: [],
      mapId: 'qinglan_valley_gate',
      currentLocationId: 'herb_meadow',
      currentIntent: '观察凝露草丛的季节变化。',
      persona: '耐心采药，冬季不从空地伪造灵草。',
    });
    await ctx.db.insert('resourceNodes', {
      worldId,
      resourceNodeId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
      name: '凝露草丛',
      mapId: 'qinglan_valley_gate',
      locationId: 'herb_meadow',
      itemId: 'spirit_herb',
      tile: { x: 20, y: 20 },
      capacity: 3,
      stock: 0,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: winterBoundary + 30_000,
      seasonalContractVersion: 'taixu.seasonal_resource.v1',
      seasonalRule: 'valley_dew_herb_winter_dormancy',
      seasonalState: 'growing',
      seasonalAppliedSeasonIndex: 2,
      accessRule: 'public',
      updatedAt: args.now,
    });
    return {
      fixtureId: args.fixtureId,
      worldId,
      actorId,
      startedAt,
      winterBoundary,
      springBoundary,
      resourceNodeId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
    };
  },
});

export const runSeasonalHerbFixtureTick = action({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runSeasonalHerbFixtureTick');
    return await ctx.runMutation(internal.xianxia.lifeCalendar.tickLifeCalendar, args);
  },
});

export const inspectSeasonalHerbAgentCandidates = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    now: v.number(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    resourceNodes: AgentContext['resourceNodes'];
    candidates: ReturnType<typeof collectAutonomyCandidates>;
  }> => {
    assertLocalGodotFixtureAccess(
      'godotTesting.inspectSeasonalHerbAgentCandidates',
    );
    const context: AgentContext | null = await ctx.runQuery(
      internal.xianxia.agent.agentContext,
      args,
    );
    if (!context) throw new Error('c019d_agent_context_missing');
    return {
      resourceNodes: context.resourceNodes,
      candidates: collectAutonomyCandidates(context, args.now).filter(
        (candidate) => candidate.planner === 'gather',
      ),
    };
  },
});

export const inspectSeasonalHerbFixture = query({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectSeasonalHerbFixture');
    const [config, node, profile, events] = await Promise.all([
      ctx.db
        .query('xianxiaConfig')
        .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
        .first(),
      ctx.db
        .query('resourceNodes')
        .withIndex('byNode', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('resourceNodeId', VALLEY_DEW_HERB_RESOURCE_NODE_ID),
        )
        .first(),
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .first(),
      ctx.db
        .query('worldEvents')
        .withIndex('byType', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('type', 'seasonal_resource_transition_applied'),
        )
        .collect(),
    ]);
    return {
      config: config
        ? {
            lifeCalendarAppliedSeasonIndex:
              config.lifeCalendarAppliedSeasonIndex,
            lifeCalendarAppliedAt: config.lifeCalendarAppliedAt,
          }
        : null,
      node,
      inventory: profile?.inventory ?? [],
      events: events
        .map((event) => ({
          eventId: String(event._id),
          actionId: event.actionId,
          createdAt: event.createdAt,
          facts: event.facts,
        }))
        .sort((left, right) => left.createdAt - right.createdAt),
    };
  },
});

export const cleanupSeasonalHerbFixture = mutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupSeasonalHerbFixture');
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    const nodes = await ctx.db
      .query('resourceNodes')
      .withIndex('byNode', (q) => q.eq('worldId', args.worldId))
      .collect();
    for (const node of nodes) await ctx.db.delete(node._id);
    const locations = await ctx.db
      .query('locations')
      .withIndex('byMap', (q) =>
        q.eq('worldId', args.worldId).eq('mapId', 'qinglan_valley_gate'),
      )
      .collect();
    for (const location of locations) await ctx.db.delete(location._id);
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (profile) await ctx.db.delete(profile._id);
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config) await ctx.db.delete(config._id);
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return {
      deletedEvents: events.length,
      deletedNodes: nodes.length,
      deletedLocations: locations.length,
    };
  },
});

export const primePopulationMigrationFixture = mutation({
  args: {
    fixtureId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primePopulationMigrationFixture');
    if (!args.fixtureId.startsWith(C019E_FIXTURE_PREFIX)) {
      throw new Error('c019e_fixture_id_invalid');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      conversations: [],
      players: [],
      agents: [],
    });
    await ctx.db.insert('xianxiaConfig', {
      worldId,
      autoTickEnabled: false,
      lifeCalendarStartedAt: args.now,
      lifeCalendarAppliedSeasonIndex: 0,
      lifeCalendarAppliedAt: args.now,
    });
    await ctx.db.insert('locations', {
      worldId,
      locationId: 'mountain_gate',
      name: '山门',
      kind: 'mountain_gate',
      dangerLevel: 0,
      spiritualEnergy: 3,
      allowedActions: ['cultivate', 'talk', 'request_teaching', 'spar', 'gift'],
      mapId: 'world',
      entryPoints: [{ x: 10, y: 15 }],
      bounds: { x1: 7, y1: 13, x2: 12, y2: 17 },
      description: 'C019e 独立迁入人口池的稳定语义入口。',
    });

    const suffix = args.fixtureId.slice(C019E_FIXTURE_PREFIX.length);
    const livingActorIds = Array.from(
      { length: 3 },
      (_, index) => `c019e_resident_${suffix}_${index}`,
    );
    const deceasedActorId = `c019e_historical_${suffix}`;
    for (const [index, actorId] of livingActorIds.entries()) {
      await ctx.db.insert('xianxiaProfiles', {
        worldId,
        actorId,
        name: `原住弟子${index + 1}`,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 20,
        realmEnteredAt: args.now,
        lifeBornAt: args.now - (20 + index) * MS_PER_LIFE_YEAR,
        lifeBirthSource: 'c019e_fixture_resident',
        lifeBirthRecordedAt: args.now,
        lifeStatus: 'alive',
        mood: 1,
        health: 8,
        maxHealth: 8,
        fatigue: 0,
        spirit: 6,
        reputation: 0,
        inventory: [],
        mapId: 'world',
        currentLocationId: 'mountain_gate',
        currentIntent: '维持灰盒人口池。',
        persona: '安稳生活，遵守宗门规矩。',
      });
    }
    await ctx.db.insert('xianxiaProfiles', {
      worldId,
      actorId: deceasedActorId,
      name: '旧册故人',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      spiritRoot: 'earth',
      innerTrait: '中庸',
      outerTrait: '传承',
      cultivationXp: 0,
      realmEnteredAt: args.now - 80 * MS_PER_LIFE_YEAR,
      lifeBornAt: args.now - 80 * MS_PER_LIFE_YEAR,
      lifeBirthSource: 'c019e_fixture_history',
      lifeBirthRecordedAt: args.now,
      lifeStatus: 'deceased',
      deceasedAt: args.now,
      deathRecordedAt: args.now,
      deathCause: 'old_age',
      deathActionId: `${args.fixtureId}:historical-death`,
      deathRealm: 'qi_refining',
      deathLifespanYears: 80,
      mood: 0,
      health: 0,
      maxHealth: 8,
      fatigue: 100,
      spirit: 0,
      reputation: 0,
      inventory: [],
      mapId: 'world',
      currentLocationId: 'mountain_gate',
      currentIntent: '已故。',
      persona: '历史人物。',
    });
    return {
      fixtureId: args.fixtureId,
      worldId,
      startedAt: args.now,
      livingActorIds,
      deceasedActorId,
    };
  },
});

export const runPopulationMigrationFixtureTick = action({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runPopulationMigrationFixtureTick');
    return await ctx.runMutation(
      internal.xianxia.populationMigrations.tickPopulationMigration,
      args,
    );
  },
});

export const reservePopulationMigrationFixtureActors = action({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess(
      'godotTesting.reservePopulationMigrationFixtureActors',
    );
    return await ctx.runMutation(
      internal.xianxia.agentTickScheduler.reserveAgentTickActors,
      {
        worldId: args.worldId,
        mapId: 'world',
        limit: 8,
      },
    );
  },
});

export const inspectPopulationMigrationFixture = query({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectPopulationMigrationFixture');
    const [profiles, admissions, events] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('populationMigrations')
        .withIndex('byAdmittedAt', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('worldEvents')
        .withIndex('byType', (q) =>
          q.eq('worldId', args.worldId).eq('type', 'actor_migrated_into_world'),
        )
        .collect(),
    ]);
    return {
      profiles: profiles
        .map((profile) => ({
          actorId: profile.actorId,
          name: profile.name,
          role: profile.role,
          realm: profile.realm,
          realmStage: profile.realmStage,
          lifeBornAt: profile.lifeBornAt,
          lifeBirthSource: profile.lifeBirthSource,
          lifeStatus: profile.lifeStatus,
          inventory: profile.inventory ?? [],
          mapId: profile.mapId,
          locationId: profile.currentLocationId,
        }))
        .sort((left, right) => left.actorId.localeCompare(right.actorId)),
      admissions: admissions
        .map((admission) => ({
          migrationId: admission.migrationId,
          actorId: admission.actorId,
          sourceId: admission.sourceId,
          calendarYear: admission.calendarYear,
          sourceSlot: admission.sourceSlot,
          populationBefore: admission.populationBefore,
          populationAfter: admission.populationAfter,
          admittedAt: admission.admittedAt,
          nextEligibleAt: admission.nextEligibleAt,
          eventActionId: admission.eventActionId,
          eventId: String(admission.eventId),
        }))
        .sort((left, right) => left.admittedAt - right.admittedAt),
      events: events
        .map((event) => ({
          eventId: String(event._id),
          actionId: event.actionId,
          actorIds: event.actorIds,
          createdAt: event.createdAt,
          facts: event.facts,
          effects: event.effects,
        }))
        .sort((left, right) => left.createdAt - right.createdAt),
    };
  },
});

export const cleanupPopulationMigrationFixture = mutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupPopulationMigrationFixture');
    const [profiles, admissions, events, locations] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('populationMigrations')
        .withIndex('byAdmittedAt', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('worldEvents')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('locations')
        .withIndex('byMap', (q) =>
          q.eq('worldId', args.worldId).eq('mapId', 'world'),
        )
        .collect(),
    ]);
    for (const row of [...admissions, ...profiles, ...events, ...locations]) {
      await ctx.db.delete(row._id);
    }
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config) await ctx.db.delete(config._id);
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return {
      deletedProfiles: profiles.length,
      deletedAdmissions: admissions.length,
      deletedEvents: events.length,
      deletedLocations: locations.length,
    };
  },
});

export const primeC019fLifecycleRestartFixture = mutation({
  args: {
    fixtureId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess(
      'godotTesting.primeC019fLifecycleRestartFixture',
    );
    if (!args.fixtureId.startsWith(C019F_FIXTURE_PREFIX)) {
      throw new Error('c019f_fixture_id_invalid');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      conversations: [],
      players: [],
      agents: [],
    });
    const startedAt = args.now - 4 * MS_PER_LIFE_SEASON;
    await ctx.db.insert('xianxiaConfig', {
      worldId,
      autoTickEnabled: false,
      lifeCalendarStartedAt: startedAt,
      lifeCalendarAppliedSeasonIndex: 3,
      lifeCalendarAppliedAt: args.now - MS_PER_LIFE_SEASON,
    });
    await ctx.db.insert('locations', {
      worldId,
      locationId: 'mountain_gate',
      name: '山门',
      kind: 'mountain_gate',
      dangerLevel: 0,
      spiritualEnergy: 3,
      allowedActions: ['cultivate', 'talk', 'request_teaching', 'spar', 'gift'],
      mapId: 'world',
      entryPoints: [{ x: 10, y: 15 }],
      bounds: { x1: 7, y1: 13, x2: 12, y2: 17 },
      description: 'C019f 重启恢复人口池入口。',
    });
    await ctx.db.insert('locations', {
      worldId,
      locationId: 'herb_meadow',
      name: '药草坡',
      kind: 'herb_slope',
      dangerLevel: 0,
      spiritualEnergy: 4,
      allowedActions: ['gather', 'explore'],
      mapId: 'qinglan_valley_gate',
      entryPoints: [{ x: 20, y: 20 }],
      description: 'C019f 重启恢复季节资源地点。',
    });
    await ctx.db.insert('resourceNodes', {
      worldId,
      resourceNodeId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
      name: '凝露草丛',
      mapId: 'qinglan_valley_gate',
      locationId: 'herb_meadow',
      itemId: 'spirit_herb',
      tile: { x: 20, y: 20 },
      capacity: 3,
      stock: 0,
      refreshAmount: 1,
      refreshIntervalMs: MS_PER_LIFE_SEASON,
      nextRefreshAt: args.now,
      seasonalContractVersion: 'taixu.seasonal_resource.v1',
      seasonalRule: 'valley_dew_herb_winter_dormancy',
      seasonalState: 'dormant',
      seasonalAppliedSeasonIndex: 3,
      seasonalRefreshBlockedUntil: args.now,
      accessRule: 'public',
      updatedAt: args.now - MS_PER_LIFE_SEASON,
    });

    const suffix = args.fixtureId.slice(C019F_FIXTURE_PREFIX.length);
    const elderActorId = `c019f_elder_${suffix}`;
    const actorIds = [
      elderActorId,
      ...Array.from(
        { length: 4 },
        (_, index) => `c019f_resident_${suffix}_${index}`,
      ),
    ];
    for (const [index, actorId] of actorIds.entries()) {
      const elder = index === 0;
      await ctx.db.insert('xianxiaProfiles', {
        worldId,
        actorId,
        name: elder ? '归岁' : `守岁弟子${index}`,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: elder ? 9 : 2,
        spiritRoot: elder ? 'mixed' : 'wood',
        innerTrait: elder ? '中庸' : '正直',
        outerTrait: elder ? '传承' : '义气',
        cultivationXp: elder ? 160 : 20,
        realmEnteredAt: startedAt,
        lifeBornAt:
          args.now - (elder ? 80 : 20 + index) * MS_PER_LIFE_YEAR,
        lifeBirthSource: 'c019f_restart_fixture',
        lifeBirthRecordedAt: args.now,
        lifeStatus: 'alive',
        mood: 1,
        health: 8,
        maxHealth: 8,
        fatigue: 0,
        spirit: 6,
        reputation: elder ? 10 : 0,
        inventory: [],
        mapId: 'world',
        currentLocationId: 'mountain_gate',
        currentIntent: elder
          ? '等待权威岁月历完成寿终结算。'
          : '守住山门并等待人口补员。',
        persona: 'C019f 真实重启恢复验收角色。',
      });
    }
    return {
      fixtureId: args.fixtureId,
      worldId,
      startedAt,
      targetNow: args.now,
      elderActorId,
      actorIds,
      resourceNodeId: VALLEY_DEW_HERB_RESOURCE_NODE_ID,
    };
  },
});

export const prepareC019fLifecycleRestart = action({
  args: {
    worldId: v.id('worlds'),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess(
      'godotTesting.prepareC019fLifecycleRestart',
    );
    return await ctx.runMutation(
      internal.xianxia.lifeCalendar.tickLifeCalendar,
      args,
    );
  },
});

export const recoverC019fLifecycleAfterRestart = action({
  args: {
    worldId: v.id('worlds'),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess(
      'godotTesting.recoverC019fLifecycleAfterRestart',
    );
    const calendar = await ctx.runMutation(
      internal.xianxia.lifeCalendar.tickLifeCalendar,
      args,
    );
    const deaths = await ctx.runMutation(
      internal.xianxia.lifeDeaths.tickOldAgeDeaths,
      args,
    );
    const migration = await ctx.runMutation(
      internal.xianxia.populationMigrations.tickPopulationMigration,
      args,
    );
    return { calendar, deaths, migration };
  },
});

export const inspectC019fLifecycleRestartFixture = query({
  args: {
    worldId: v.id('worlds'),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess(
      'godotTesting.inspectC019fLifecycleRestartFixture',
    );
    const [config, profiles, node, admissions, events, modelCalls] =
      await Promise.all([
        ctx.db
          .query('xianxiaConfig')
          .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
          .first(),
        ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) => q.eq('worldId', args.worldId))
          .collect(),
        ctx.db
          .query('resourceNodes')
          .withIndex('byNode', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq(
                'resourceNodeId',
                VALLEY_DEW_HERB_RESOURCE_NODE_ID,
              ),
          )
          .first(),
        ctx.db
          .query('populationMigrations')
          .withIndex('byAdmittedAt', (q) =>
            q.eq('worldId', args.worldId),
          )
          .collect(),
        ctx.db
          .query('worldEvents')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
          .collect(),
        ctx.db
          .query('socialModelCalls')
          .withIndex('byWorldStatus', (q) =>
            q.eq('worldId', args.worldId),
          )
          .collect(),
      ]);
    const derivedCalendar =
      config?.lifeCalendarStartedAt === undefined
        ? null
        : lifeCalendarAt(args.now, config.lifeCalendarStartedAt);
    return {
      calendar: derivedCalendar
        ? {
            ...derivedCalendar,
            appliedSeasonIndex:
              config?.lifeCalendarAppliedSeasonIndex ?? 0,
          }
        : null,
      profiles: profiles
        .map((profile) => ({
          actorId: profile.actorId,
          lifeStatus: profile.lifeStatus ?? 'alive',
          lifeBornAt: profile.lifeBornAt,
          deceasedAt: profile.deceasedAt,
          deathActionId: profile.deathActionId,
          deathEventId: profile.deathEventId
            ? String(profile.deathEventId)
            : undefined,
          mapId: profile.mapId,
          locationId: profile.currentLocationId,
          inventory: profile.inventory ?? [],
        }))
        .sort((left, right) =>
          left.actorId.localeCompare(right.actorId),
        ),
      node: node
        ? {
            resourceNodeId: node.resourceNodeId,
            mapId: node.mapId,
            locationId: node.locationId,
            capacity: node.capacity,
            stock: node.stock,
            seasonalState: node.seasonalState,
            seasonalAppliedSeasonIndex:
              node.seasonalAppliedSeasonIndex,
            nextRefreshAt: node.nextRefreshAt,
          }
        : null,
      admissions: admissions
        .map((admission) => ({
          migrationId: admission.migrationId,
          actorId: admission.actorId,
          sourceId: admission.sourceId,
          eventId: String(admission.eventId),
          eventActionId: admission.eventActionId,
          mapId: admission.mapId,
          locationId: admission.locationId,
        }))
        .sort((left, right) =>
          left.migrationId.localeCompare(right.migrationId),
        ),
      events: events
        .map((event) => ({
          eventId: String(event._id),
          type: event.type,
          actionId: event.actionId,
          actorIds: event.actorIds,
          mapId: event.mapId,
          locationId: event.locationId,
          facts: event.facts,
        }))
        .sort((left, right) =>
          String(left.actionId).localeCompare(String(right.actionId)),
        ),
      modelCallCount: modelCalls.length,
    };
  },
});

export const cleanupC019fLifecycleRestartFixture = mutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess(
      'godotTesting.cleanupC019fLifecycleRestartFixture',
    );
    const [
      actionRecords,
      profiles,
      admissions,
      events,
      nodes,
      locations,
      modelCalls,
    ] = await Promise.all([
      ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('populationMigrations')
        .withIndex('byAdmittedAt', (q) =>
          q.eq('worldId', args.worldId),
        )
        .collect(),
      ctx.db
        .query('worldEvents')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('resourceNodes')
        .withIndex('byNode', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('locations')
        .withIndex('byMap', (q) => q.eq('worldId', args.worldId))
        .collect(),
      ctx.db
        .query('socialModelCalls')
        .withIndex('byWorldStatus', (q) =>
          q.eq('worldId', args.worldId),
        )
        .collect(),
    ]);
    for (const row of [
      ...actionRecords,
      ...admissions,
      ...profiles,
      ...events,
      ...nodes,
      ...locations,
      ...modelCalls,
    ]) {
      await ctx.db.delete(row._id);
    }
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config) await ctx.db.delete(config._id);
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return {
      deletedProfiles: profiles.length,
      deletedAdmissions: admissions.length,
      deletedEvents: events.length,
      deletedNodes: nodes.length,
      deletedLocations: locations.length,
      deletedModelCalls: modelCalls.length,
    };
  },
});

export const primeLifeProfileFixture = mutation({
  args: {
    fixtureId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeLifeProfileFixture');
    if (!args.fixtureId.startsWith(C019B_FIXTURE_PREFIX)) {
      throw new Error('c019b_fixture_id_invalid');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      conversations: [],
      players: [],
      agents: [],
    });
    await ctx.db.insert('xianxiaConfig', {
      worldId,
      autoTickEnabled: false,
      lifeCalendarStartedAt: args.now,
      lifeCalendarAppliedSeasonIndex: 0,
      lifeCalendarAppliedAt: args.now,
    });
    const specs = [
      { suffix: 'qi', realm: 'qi_refining', realmStage: 3 },
      { suffix: 'foundation', realm: 'foundation_building', realmStage: 2 },
      { suffix: 'golden', realm: 'golden_core', realmStage: 1 },
      { suffix: 'nascent', realm: 'nascent_soul', realmStage: 1 },
      { suffix: 'deity', realm: 'deity_transformation', realmStage: 1 },
    ];
    const actorIds: string[] = [];
    for (const spec of specs) {
      const actorId = `${args.fixtureId}:${spec.suffix}`;
      actorIds.push(actorId);
      await ctx.db.insert('xianxiaProfiles', {
        worldId,
        actorId,
        name: spec.suffix,
        role: 'outer_disciple',
        realm: spec.realm,
        realmStage: spec.realmStage,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 0,
        mood: 0,
        health: 8,
        maxHealth: 8,
        fatigue: 0,
        spirit: 6,
        reputation: 0,
        inventory: [],
        mapId: 'xianxia_system_lab',
        currentLocationId: 'system_lab_spawn',
        currentIntent: 'C019b lifecycle fixture',
        persona: 'C019b fixture',
      });
    }
    return { fixtureId: args.fixtureId, worldId, actorIds };
  },
});

export const runLifeProfileMigration = action({
  args: {
    worldId: v.id('worlds'),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runLifeProfileMigration');
    return await ctx.runMutation(
      internal.xianxia.lifeProfiles.migrateLifeProfileBirthAnchors,
      args,
    );
  },
});

export const promoteLifeProfileFixture = mutation({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    realm: v.string(),
    realmStage: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.promoteLifeProfileFixture');
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (!profile) throw new Error('c019b_profile_not_found');
    await ctx.db.patch(profile._id, {
      realm: args.realm,
      realmStage: args.realmStage,
    });
    return { actorId: profile.actorId, lifeBornAt: profile.lifeBornAt };
  },
});

export const inspectLifeProfileFixture = query({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectLifeProfileFixture');
    const profiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId))
      .collect();
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    return {
      eventCount: events.length,
      profiles: profiles.map((profile) => ({
        actorId: profile.actorId,
        realm: profile.realm,
        realmStage: profile.realmStage,
        health: profile.health,
        lifeBornAt: profile.lifeBornAt,
        lifeBirthSource: profile.lifeBirthSource,
        lifeBirthRecordedAt: profile.lifeBirthRecordedAt,
        lifecycle:
          profile.lifeBornAt === undefined
            ? null
            : actorLifecycleAt({
                now: args.now,
                lifeBornAt: profile.lifeBornAt,
                realm: profile.realm,
              }),
      })),
    };
  },
});

export const cleanupLifeProfileFixture = mutation({
  args: { worldId: v.id('worlds') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupLifeProfileFixture');
    const profiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', args.worldId))
      .collect();
    for (const profile of profiles) await ctx.db.delete(profile._id);
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config) await ctx.db.delete(config._id);
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return { deletedProfiles: profiles.length, deletedEvents: events.length };
  },
});

export const primeOldAgeDeathFixture = mutation({
  args: { fixtureId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeOldAgeDeathFixture');
    if (!args.fixtureId.startsWith(C019C_FIXTURE_PREFIX)) {
      throw new Error('c019c_fixture_id_invalid');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      conversations: [],
      players: [],
      agents: [],
    });
    await ctx.db.insert('xianxiaConfig', {
      worldId,
      autoTickEnabled: false,
      lifeCalendarStartedAt: args.now - 100 * MS_PER_LIFE_YEAR,
      lifeCalendarAppliedSeasonIndex: 0,
      lifeCalendarAppliedAt: args.now,
    });
    const actorId = `${args.fixtureId}:elder`;
    const lifeBornAt = args.now - 80 * MS_PER_LIFE_YEAR;
    await ctx.db.insert('xianxiaProfiles', {
      worldId,
      actorId,
      name: '归鹤',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 9,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '传承',
      cultivationXp: 0,
      lifeBornAt,
      lifeBirthSource: 'c019c_fixture',
      lifeBirthRecordedAt: args.now,
      lifeStatus: 'alive',
      mood: 1,
      health: 8,
      maxHealth: 8,
      fatigue: 0,
      spirit: 8,
      reputation: 10,
      inventory: [],
      mapId: 'qinglan_valley_gate',
      currentLocationId: 'rest_clearing',
      currentIntent: '准备完成最后一次行动。',
      persona: 'C019c fixture',
    });
    const counterpartActorId = `${args.fixtureId}:counterpart`;
    await ctx.db.insert('xianxiaProfiles', {
      worldId,
      actorId: counterpartActorId,
      name: '守愿',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '正直',
      outerTrait: '义气',
      cultivationXp: 0,
      lifeBornAt: args.now - 30 * MS_PER_LIFE_YEAR,
      lifeBirthSource: 'c019c_fixture',
      lifeBirthRecordedAt: args.now,
      lifeStatus: 'alive',
      mood: 1,
      health: 8,
      maxHealth: 8,
      fatigue: 0,
      spirit: 8,
      reputation: 5,
      inventory: [],
      mapId: 'qinglan_valley_gate',
      currentLocationId: 'rest_clearing',
      currentIntent: '陪伴故友。',
      persona: 'C019c counterpart fixture',
    });
    await ctx.db.insert('qinglanResidents', {
      worldId,
      residentId: actorId,
      actorId,
      name: '归鹤',
      role: 'outer_disciple',
      character: 'f1',
      mapId: 'qinglan_valley_gate',
      currentLocationId: 'rest_clearing',
      displayTile: { x: 10, y: 10 },
      targetTile: { x: 11, y: 10 },
      finalTargetTile: { x: 12, y: 10 },
      pathTiles: [{ x: 11, y: 10 }, { x: 12, y: 10 }],
      orientation: 0,
      status: 'moving',
      currentIntent: '正在赶路。',
      activityLabel: '行走中',
      updatedAt: args.now,
    });
    const actionRecordId = await ctx.db.insert('actionRecords', {
      worldId,
      actorId,
      type: 'travel',
      status: 'validated',
      locationId: 'rest_clearing',
      intent: '前往歇脚地。',
      source: 'system',
      mapId: 'qinglan_valley_gate',
      createdAt: args.now,
    });
    await ctx.db.insert('movementCommands', {
      worldId,
      actionRecordId,
      revision: 1,
      actorId,
      mapId: 'qinglan_valley_gate',
      intent: '前往歇脚地。',
      decisionSource: 'test',
      requestedTarget: { kind: 'point', tile: { x: 12, y: 10 } },
      originTile: { x: 10, y: 10 },
      acceptedTile: { x: 12, y: 10 },
      acceptedMaskType: 'walkable',
      resolvedLocationId: 'rest_clearing',
      status: 'moving',
      lastTile: { x: 10, y: 10 },
      lastReportedAt: args.now,
      issuedAt: args.now,
      updatedAt: args.now,
      expiresAt: args.now + 60_000,
    });
    await ctx.db.insert('actionExecutions', {
      worldId,
      actionRecordId,
      revision: 1,
      actorId,
      actionType: 'travel',
      source: 'system',
      mapId: 'qinglan_valley_gate',
      locationId: 'rest_clearing',
      intent: '前往歇脚地。',
      status: 'acting',
      durationMs: 60_000,
      hardDeadlineAt: args.now + 120_000,
      startedAt: args.now,
      issuedAt: args.now,
      updatedAt: args.now,
      expiresAt: args.now + 60_000,
    });
    await ctx.db.insert('personalGoals', {
      worldId,
      contractVersion: 'taixu.personal-goal.v1',
      goalId: `${args.fixtureId}:goal`,
      actorId,
      revision: 1,
      status: 'active',
      goalKey: 'rest:last',
      kind: 'recovery',
      sourceRef: 'fixture',
      candidateId: 'fixture:rest',
      intent: '前往歇脚地。',
      progressScore: 0,
      progressKey: 'fixture',
      progressRevision: 0,
      backlog: [],
      observationRevision: 'fixture:1',
      startedGameHour: 0,
      lastProgressGameHour: 0,
      deadlineGameHour: 24,
      hardDeadlineGameHour: 72,
      attemptCount: 1,
      lastActionRecordId: actionRecordId,
      lastActionType: 'travel',
      createdAt: args.now,
      updatedAt: args.now,
    });
    const fixtureEventId = await ctx.db.insert('worldEvents', {
      worldId,
      type: 'c019c_fixture_started',
      createdAt: args.now,
      actorIds: [actorId, counterpartActorId],
      locationId: 'rest_clearing',
      actionId: `${args.fixtureId}:fixture-event`,
      visibility: 'private',
      summary: 'C019c 终态收束测试开始。',
      mapId: 'qinglan_valley_gate',
    });
    const conversationId = `${args.fixtureId}:conversation`;
    await ctx.db.insert('conversationSessions', {
      worldId,
      conversationId,
      status: 'active',
      actorAId: actorId,
      actorBId: counterpartActorId,
      proposerActorId: actorId,
      currentSpeakerActorId: actorId,
      topicId: 'last_wish',
      mapId: 'qinglan_valley_gate',
      locationId: 'rest_clearing',
      turnNumber: 1,
      maxTurns: 4,
      revision: 1,
      openedByActionId: actionRecordId,
      startedEventId: fixtureEventId,
      proposedAt: args.now,
      acceptedAt: args.now,
      startedAt: args.now,
      lastTurnAt: args.now,
      expiresAt: args.now + 60_000,
      updatedAt: args.now,
    });
    const groupConversationId = `${args.fixtureId}:group`;
    await ctx.db.insert('groupConversationSessions', {
      worldId,
      groupConversationId,
      status: 'active',
      hostActorId: actorId,
      participantActorIds: [actorId, counterpartActorId],
      observerActorIds: [],
      currentSpeakerActorId: actorId,
      topicId: 'last_wish',
      mapId: 'qinglan_valley_gate',
      locationId: 'rest_clearing',
      turnNumber: 1,
      maxTurns: 4,
      revision: 1,
      openedByActionId: actionRecordId,
      startedEventId: fixtureEventId,
      startedAt: args.now,
      lastTurnAt: args.now,
      expiresAt: args.now + 60_000,
      updatedAt: args.now,
    });
    for (const memberActorId of [actorId, counterpartActorId]) {
      await ctx.db.insert('groupConversationMemberships', {
        worldId,
        groupConversationId,
        actorId: memberActorId,
        role: 'participant',
        status: 'active',
        joinedAt: args.now,
        updatedAt: args.now,
      });
    }
    const groupProposalId = `${args.fixtureId}:group-proposal`;
    await ctx.db.insert('groupProposals', {
      worldId,
      proposalId: groupProposalId,
      groupConversationId,
      kind: 'owned_herb_allocation',
      status: 'open',
      proposerActorId: actorId,
      donorActorId: actorId,
      recipientActorId: counterpartActorId,
      itemId: 'spirit_herb',
      itemQty: 1,
      participantActorIds: [actorId, counterpartActorId],
      sessionRevision: 1,
      mapId: 'qinglan_valley_gate',
      locationId: 'rest_clearing',
      quorum: 2,
      approvals: 0,
      oppositions: 0,
      abstentions: 0,
      openedByActionId: actionRecordId,
      openedEventId: fixtureEventId,
      createdAt: args.now,
      expiresAt: args.now + 60_000,
      updatedAt: args.now,
    });
    await ctx.db.insert('groupCommitments', {
      worldId,
      commitmentId: `${args.fixtureId}:commitment`,
      proposalId: groupProposalId,
      groupConversationId,
      status: 'pending',
      donorActorId: actorId,
      recipientActorId: counterpartActorId,
      itemId: 'spirit_herb',
      itemQty: 1,
      approvedByActionId: actionRecordId,
      approvedEventId: fixtureEventId,
      createdAt: args.now,
      updatedAt: args.now,
    });
    const negotiationId = `${args.fixtureId}:negotiation`;
    const negotiationProposalId = `${args.fixtureId}:negotiation-proposal`;
    await ctx.db.insert('negotiationSessions', {
      worldId,
      negotiationId,
      conversationId,
      kind: 'herb_trade',
      status: 'active',
      actorAId: actorId,
      actorBId: counterpartActorId,
      openedByActorId: actorId,
      currentProposalId: negotiationProposalId,
      currentResponderActorId: counterpartActorId,
      revision: 1,
      mapId: 'qinglan_valley_gate',
      locationId: 'rest_clearing',
      openedByActionId: actionRecordId,
      openedAt: args.now,
      expiresAt: args.now + 60_000,
      updatedAt: args.now,
    });
    await ctx.db.insert('negotiationProposals', {
      worldId,
      proposalId: negotiationProposalId,
      negotiationId,
      conversationId,
      revision: 1,
      status: 'active',
      kind: 'herb_trade',
      proposerActorId: actorId,
      recipientActorId: counterpartActorId,
      sellerActorId: actorId,
      buyerActorId: counterpartActorId,
      itemId: 'spirit_herb',
      itemQty: 1,
      paymentItemId: 'spirit_stone',
      paymentQty: 1,
      actionRecordId,
      sourceEventId: fixtureEventId,
      createdAt: args.now,
    });
    await ctx.db.insert('requests', {
      worldId,
      issuerActorId: actorId,
      assigneeActorId: counterpartActorId,
      type: 'collect_item',
      status: 'accepted',
      revision: 1,
      requirements: { itemId: 'spirit_herb', qty: 1 },
      rewards: { cultivationXp: 1 },
      createdAt: args.now,
      expiresAt: 24,
      acceptedAt: args.now,
      openedByActionId: actionRecordId,
      sourceEventId: fixtureEventId,
      summary: '替故友寻找一株灵草。',
    });
    await ctx.db.insert('combatEncounters', {
      worldId,
      encounterId: `${args.fixtureId}:encounter`,
      attackerActorId: actorId,
      defenderActorId: counterpartActorId,
      mapId: 'qinglan_valley_gate',
      locationId: 'rest_clearing',
      status: 'active',
      witnessActorIds: [],
      guardActorIds: [],
      initiatedByActionId: actionRecordId,
      startedAt: args.now,
      updatedAt: args.now,
    });
    return {
      fixtureId: args.fixtureId,
      worldId,
      actorId,
      counterpartActorId,
      actionRecordId,
      lifeBornAt,
      deceasedAt: args.now,
    };
  },
});

export const runOldAgeDeathFixtureTick = action({
  args: { worldId: v.id('worlds'), now: v.number() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runOldAgeDeathFixtureTick');
    return await ctx.runMutation(internal.xianxia.lifeDeaths.tickOldAgeDeaths, args);
  },
});

export const attemptDeadActorActionFixture = action({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.attemptDeadActorActionFixture');
    return await ctx.runMutation(internal.xianxia.actions.submitAction, {
      worldId: args.worldId,
      actorId: args.actorId,
      type: 'rest',
      source: 'system',
      intent: '死亡后不应执行的测试动作。',
      clientActionId: `${args.actorId}:post-death-action`,
    });
  },
});

export const attemptDeadTargetActionFixture = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.attemptDeadTargetActionFixture');
    return await ctx.runMutation(internal.xianxia.actions.submitAction, {
      worldId: args.worldId,
      actorId: args.actorId,
      targetActorId: args.targetActorId,
      type: 'talk',
      source: 'system',
      intent: '死亡目标不应参与的测试对话。',
      clientActionId: `${args.actorId}:dead-target-action`,
    });
  },
});

export const inspectOldAgeDeathFixture = query({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectOldAgeDeathFixture');
    const fixtureId = args.actorId.slice(0, -':elder'.length);
    const [
      profile,
      resident,
      movements,
      executions,
      goals,
      events,
      conversation,
      groupConversation,
      groupMemberships,
      groupProposal,
      groupCommitment,
      negotiation,
      negotiationProposal,
      requests,
      encounter,
    ] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .first(),
      ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .first(),
      ctx.db
        .query('movementCommands')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .collect(),
      ctx.db
        .query('actionExecutions')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .collect(),
      ctx.db
        .query('personalGoals')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', args.actorId),
        )
        .collect(),
      ctx.db
        .query('worldEvents')
        .withIndex('byType', (q) =>
          q.eq('worldId', args.worldId).eq('type', 'actor_died_of_old_age'),
        )
        .collect(),
      ctx.db
        .query('conversationSessions')
        .withIndex('byConversation', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', `${fixtureId}:conversation`),
        )
        .first(),
      ctx.db
        .query('groupConversationSessions')
        .withIndex('byGroupConversation', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('groupConversationId', `${fixtureId}:group`),
        )
        .first(),
      ctx.db
        .query('groupConversationMemberships')
        .withIndex('byGroupRole', (q) =>
          q.eq('worldId', args.worldId).eq('groupConversationId', `${fixtureId}:group`),
        )
        .collect(),
      ctx.db
        .query('groupProposals')
        .withIndex('byProposal', (q) =>
          q.eq('worldId', args.worldId).eq('proposalId', `${fixtureId}:group-proposal`),
        )
        .first(),
      ctx.db
        .query('groupCommitments')
        .withIndex('byCommitment', (q) =>
          q.eq('worldId', args.worldId).eq('commitmentId', `${fixtureId}:commitment`),
        )
        .first(),
      ctx.db
        .query('negotiationSessions')
        .withIndex('byNegotiation', (q) =>
          q.eq('worldId', args.worldId).eq('negotiationId', `${fixtureId}:negotiation`),
        )
        .first(),
      ctx.db
        .query('negotiationProposals')
        .withIndex('byProposal', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('proposalId', `${fixtureId}:negotiation-proposal`),
        )
        .first(),
      ctx.db
        .query('requests')
        .withIndex('byIssuer', (q) =>
          q.eq('worldId', args.worldId).eq('issuerActorId', args.actorId),
        )
        .collect(),
      ctx.db
        .query('combatEncounters')
        .withIndex('byEncounter', (q) =>
          q.eq('worldId', args.worldId).eq('encounterId', `${fixtureId}:encounter`),
        )
        .first(),
    ]);
    return {
      profile,
      resident,
      movements,
      executions,
      goals,
      deathEvents: events,
      conversation,
      groupConversation,
      groupMemberships,
      groupProposal,
      groupCommitment,
      negotiation,
      negotiationProposal,
      requests,
      encounter,
    };
  },
});

export const cleanupOldAgeDeathFixture = mutation({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupOldAgeDeathFixture');
    const fixtureId = args.actorId.slice(0, -':elder'.length);
    const [
      goals,
      executions,
      movements,
      actions,
      residents,
      profiles,
      events,
      conversations,
      groupConversations,
      groupMemberships,
      groupProposals,
      groupCommitments,
      negotiations,
      negotiationProposals,
      requests,
      encounters,
    ] =
      await Promise.all([
        ctx.db
          .query('personalGoals')
          .withIndex('byActorRevision', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .collect(),
        ctx.db
          .query('actionExecutions')
          .withIndex('byActorRevision', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .collect(),
        ctx.db
          .query('movementCommands')
          .withIndex('byActorRevision', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .collect(),
        ctx.db
          .query('actionRecords')
          .withIndex('actor', (q) => q.eq('worldId', args.worldId))
          .collect(),
        ctx.db
          .query('qinglanResidents')
          .withIndex('byActor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .collect(),
        ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) => q.eq('worldId', args.worldId))
          .collect(),
        ctx.db
          .query('worldEvents')
          .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
          .collect(),
        ctx.db
          .query('conversationSessions')
          .withIndex('byConversation', (q) =>
            q.eq('worldId', args.worldId).eq('conversationId', `${fixtureId}:conversation`),
          )
          .collect(),
        ctx.db
          .query('groupConversationSessions')
          .withIndex('byGroupConversation', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('groupConversationId', `${fixtureId}:group`),
          )
          .collect(),
        ctx.db
          .query('groupConversationMemberships')
          .withIndex('byGroupRole', (q) =>
            q.eq('worldId', args.worldId).eq('groupConversationId', `${fixtureId}:group`),
          )
          .collect(),
        ctx.db
          .query('groupProposals')
          .withIndex('byProposal', (q) =>
            q.eq('worldId', args.worldId).eq('proposalId', `${fixtureId}:group-proposal`),
          )
          .collect(),
        ctx.db
          .query('groupCommitments')
          .withIndex('byCommitment', (q) =>
            q.eq('worldId', args.worldId).eq('commitmentId', `${fixtureId}:commitment`),
          )
          .collect(),
        ctx.db
          .query('negotiationSessions')
          .withIndex('byNegotiation', (q) =>
            q.eq('worldId', args.worldId).eq('negotiationId', `${fixtureId}:negotiation`),
          )
          .collect(),
        ctx.db
          .query('negotiationProposals')
          .withIndex('byProposal', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('proposalId', `${fixtureId}:negotiation-proposal`),
          )
          .collect(),
        ctx.db
          .query('requests')
          .withIndex('byIssuer', (q) =>
            q.eq('worldId', args.worldId).eq('issuerActorId', args.actorId),
          )
          .collect(),
        ctx.db
          .query('combatEncounters')
          .withIndex('byEncounter', (q) =>
            q.eq('worldId', args.worldId).eq('encounterId', `${fixtureId}:encounter`),
          )
          .collect(),
      ]);
    let deleted = 0;
    for (const row of [
      ...goals,
      ...executions,
      ...movements,
      ...actions,
      ...residents,
      ...profiles,
      ...events,
      ...conversations,
      ...groupConversations,
      ...groupMemberships,
      ...groupProposals,
      ...groupCommitments,
      ...negotiations,
      ...negotiationProposals,
      ...requests,
      ...encounters,
    ]) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', args.worldId))
      .first();
    if (config) {
      await ctx.db.delete(config._id);
      deleted += 1;
    }
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return { deleted };
  },
});

export const primeWorldDirectorFixture = mutation({
  args: {
    aidActorId: v.string(),
    reportActorId: v.string(),
    profitActorId: v.string(),
    continueActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeWorldDirectorFixture');
    const actorIds = Object.values(args);
    if (new Set(actorIds).size !== actorIds.length) {
      throw new Error('C017f fixture requires six unique actors.');
    }
    for (const actorId of actorIds) {
      assertGodotSmokeActorId(actorId, 'primeWorldDirectorFixture');
      if (!actorId.startsWith('godot_smoke_c017f_')) {
        throw new Error('C017f fixture actors must stay inside C017f.');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const active = await ctx.db
      .query('worldPressures')
      .withIndex('byWorldStatus', (q) =>
        q.eq('worldId', status.worldId).eq('status', 'active'),
      )
      .first();
    if (active) {
      if (active.mapId !== WORLD_DIRECTOR_LAB_MAP_ID) {
        throw new Error(`C017f fixture requires no pre-existing active pressure: ${active.pressureId}`);
      }
      const recoveryEventId = await appendWorldEvent(ctx, {
        worldId: status.worldId,
        type: 'world_pressure_cancelled',
        createdAt: Date.now(),
        actorIds: [],
        locationId: active.locationId,
        visibility: 'public',
        summary: '上一次 C017f 灰盒异常退出，已显式取消遗留药瘴。',
        facts: versionDurableEventFacts({
          resultCode: 'world_pressure_cancelled',
          pressureId: active.pressureId,
          revision: active.revision,
          pressureKind: active.kind,
          pressureStatus: 'cancelled',
          severity: active.severity,
          affectedResourceNodeIds: active.affectedResourceNodeIds,
          effectCodes: active.effectCodes,
          startsAtGameHour: active.startsAtGameHour,
          endsAtGameHour: active.endsAtGameHour,
          sourceEventId: String(active.sourceEventId),
        }),
        mapId: active.mapId,
      });
      for (const resourceNodeId of active.affectedResourceNodeIds) {
        const staleNode = await ctx.db
          .query('resourceNodes')
          .withIndex('byNode', (q) =>
            q.eq('worldId', status.worldId).eq('resourceNodeId', resourceNodeId),
          )
          .first();
        if (staleNode?.refreshBlockedByPressureId === active.pressureId) {
          await ctx.db.patch(staleNode._id, {
            refreshBlockedUntil: undefined,
            refreshBlockedByPressureId: undefined,
            updatedAt: Date.now(),
          });
        }
      }
      await ctx.db.patch(active._id, {
        status: 'cancelled',
        terminalEventId: recoveryEventId,
        terminalReason: 'fixture_recovered_after_interruption',
        updatedAt: Date.now(),
      });
    }
    const now = Date.now();
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', status.worldId))
      .first();
    const previousConfig = {
      worldDirectorEnabled: config?.worldDirectorEnabled,
      worldDirectorNextEligibleGameHour: config?.worldDirectorNextEligibleGameHour,
    };
    if (config) {
      await ctx.db.patch(config._id, {
        worldDirectorEnabled: true,
        worldDirectorNextEligibleGameHour: undefined,
      });
    } else {
      await ctx.db.insert('xianxiaConfig', {
        worldId: status.worldId,
        autoTickEnabled: false,
        worldDirectorEnabled: true,
      });
    }

    const locations = [
      {
        locationId: WORLD_DIRECTOR_PRESSURE_LOCATION_ID,
        name: '药瘴灰盒坡',
        kind: 'resource_patch',
        spiritualEnergy: 1,
        allowedActions: ['gather', 'explore', 'gift', 'talk'],
        tile: { x: 10, y: 10 },
      },
      {
        locationId: WORLD_DIRECTOR_SAFE_LOCATION_ID,
        name: '清风避瘴舍',
        kind: 'rest_clearing',
        spiritualEnergy: 2,
        allowedActions: ['rest', 'cultivate'],
        tile: { x: 20, y: 10 },
      },
      {
        locationId: WORLD_DIRECTOR_MARKET_LOCATION_ID,
        name: '药材灰盒市',
        kind: 'market',
        spiritualEnergy: 1,
        allowedActions: ['trade', 'talk'],
        tile: { x: 30, y: 10 },
      },
      {
        locationId: WORLD_DIRECTOR_QUIET_LOCATION_ID,
        name: '静修灰盒院',
        kind: 'cultivation_court',
        spiritualEnergy: 4,
        allowedActions: ['cultivate'],
        tile: { x: 40, y: 10 },
      },
    ];
    for (const spec of locations) {
      const existing = await ctx.db
        .query('locations')
        .withIndex('byLocationId', (q) =>
          q.eq('worldId', status.worldId).eq('locationId', spec.locationId),
        )
        .first();
      const patch = {
        name: spec.name,
        kind: spec.kind,
        dangerLevel: 0,
        spiritualEnergy: spec.spiritualEnergy,
        allowedActions: spec.allowedActions,
        mapId: WORLD_DIRECTOR_LAB_MAP_ID,
        entryPoints: [spec.tile],
        bounds: {
          x1: spec.tile.x - 2,
          y1: spec.tile.y - 2,
          x2: spec.tile.x + 2,
          y2: spec.tile.y + 2,
        },
        description: 'C017f 有界世界压力生产路径灰盒。',
      };
      if (existing) await ctx.db.patch(existing._id, patch);
      else {
        await ctx.db.insert('locations', {
          worldId: status.worldId,
          locationId: spec.locationId,
          ...patch,
        });
      }
    }

    const node = await ctx.db
      .query('resourceNodes')
      .withIndex('byNode', (q) =>
        q.eq('worldId', status.worldId).eq('resourceNodeId', WORLD_DIRECTOR_RESOURCE_NODE_ID),
      )
      .first();
    const nodePatch = {
      name: '受瘴凝露灵草',
      mapId: WORLD_DIRECTOR_LAB_MAP_ID,
      locationId: WORLD_DIRECTOR_PRESSURE_LOCATION_ID,
      itemId: 'spirit_herb',
      tile: { x: 10, y: 10 },
      capacity: 3,
      stock: 0,
      refreshAmount: 1,
      refreshIntervalMs: 30_000,
      nextRefreshAt: now + 30_000,
      refreshBlockedUntil: undefined,
      refreshBlockedByPressureId: undefined,
      accessRule: 'public' as const,
      ownerActorId: undefined,
      updatedAt: now,
    };
    if (node) await ctx.db.patch(node._id, nodePatch);
    else {
      await ctx.db.insert('resourceNodes', {
        worldId: status.worldId,
        resourceNodeId: WORLD_DIRECTOR_RESOURCE_NODE_ID,
        ...nodePatch,
      });
    }

    const profiles = [
      {
        actorId: args.aidActorId,
        name: '仁善援手',
        role: 'outer_disciple',
        innerTrait: '仁善',
        outerTrait: '义气',
        locationId: WORLD_DIRECTOR_PRESSURE_LOCATION_ID,
        inventory: [{ itemId: 'iron_ore', qty: 1 }],
      },
      {
        actorId: args.reportActorId,
        name: '正直查报者',
        role: 'outer_disciple',
        innerTrait: '正直',
        outerTrait: '名声',
        locationId: WORLD_DIRECTOR_PRESSURE_LOCATION_ID,
        inventory: [] as { itemId: string; qty: number }[],
      },
      {
        actorId: args.profitActorId,
        name: '逐利药商',
        role: 'outer_disciple',
        innerTrait: '利己',
        outerTrait: '权力',
        locationId: WORLD_DIRECTOR_MARKET_LOCATION_ID,
        inventory: [{ itemId: 'spirit_herb', qty: 1 }],
      },
      {
        actorId: args.continueActorId,
        name: '静修旁观者',
        role: 'outer_disciple',
        innerTrait: '中庸',
        outerTrait: '权力',
        locationId: WORLD_DIRECTOR_QUIET_LOCATION_ID,
        inventory: [] as { itemId: string; qty: number }[],
      },
      {
        actorId: WORLD_DIRECTOR_GUARD_ACTOR_ID,
        name: '药坡守卫',
        role: 'guard',
        innerTrait: '中庸',
        outerTrait: '忠贞',
        locationId: WORLD_DIRECTOR_PRESSURE_LOCATION_ID,
        inventory: [] as { itemId: string; qty: number }[],
      },
      {
        actorId: WORLD_DIRECTOR_MERCHANT_ACTOR_ID,
        name: '灰盒药商',
        role: 'merchant',
        innerTrait: '中庸',
        outerTrait: '任我',
        locationId: WORLD_DIRECTOR_MARKET_LOCATION_ID,
        inventory: [] as { itemId: string; qty: number }[],
      },
    ];
    for (const spec of profiles) {
      const existing = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', spec.actorId),
        )
        .first();
      const patch = {
        name: spec.name,
        role: spec.role,
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: spec.innerTrait,
        outerTrait: spec.outerTrait,
        cultivationXp: 10,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: 0,
        inventory: spec.inventory,
        mapId: WORLD_DIRECTOR_LAB_MAP_ID,
        currentLocationId: spec.locationId,
        currentIntent: '依据真实世界压力、人设与当前能力自行选择。',
        persona: '不调用外部模型。',
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
      };
      if (existing) await ctx.db.patch(existing._id, patch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: spec.actorId,
          ...patch,
        });
      }
    }

    const shop = await ctx.db
      .query('shopInventories')
      .withIndex('byShop', (q) =>
        q.eq('worldId', status.worldId).eq('shopId', WORLD_DIRECTOR_SHOP_ID),
      )
      .first();
    const shopPatch = {
      name: '灰盒收药铺',
      merchantActorId: WORLD_DIRECTOR_MERCHANT_ACTOR_ID,
      mapId: WORLD_DIRECTOR_LAB_MAP_ID,
      locationId: WORLD_DIRECTOR_MARKET_LOCATION_ID,
      restockSourceId: 'world_director_fixture_caravan',
      restockIntervalMs: 24 * 30_000,
      nextRestockAt: now + 24 * 30_000,
      walletSpiritStones: 100,
      walletCapacity: 100,
      walletRestockAmount: 0,
      stock: [{ itemId: 'spirit_herb', qty: 0, capacity: 8, restockAmount: 1 }],
      updatedAt: now,
    };
    if (shop) await ctx.db.patch(shop._id, shopPatch);
    else {
      await ctx.db.insert('shopInventories', {
        worldId: status.worldId,
        shopId: WORLD_DIRECTOR_SHOP_ID,
        ...shopPatch,
      });
    }
    return {
      worldId: status.worldId,
      mapId: WORLD_DIRECTOR_LAB_MAP_ID,
      now,
      actorIds,
      decisionActorIds: [
        args.aidActorId,
        args.reportActorId,
        args.profitActorId,
        args.continueActorId,
      ],
      previousConfig,
    };
  },
});

export const runWorldDirectorFixtureTick = action({
  args: {
    worldId: v.id('worlds'),
    mapId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runWorldDirectorFixtureTick');
    if (args.mapId !== WORLD_DIRECTOR_LAB_MAP_ID) {
      throw new Error('C017f director tick is outside its fixture map.');
    }
    return await ctx.runMutation(internal.xianxia.worldDirector.tickWorldDirector, args);
  },
});

export const inspectWorldDirectorFixture = query({
  args: {
    actorIds: v.array(v.string()),
    pressureId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectWorldDirectorFixture');
    for (const actorId of args.actorIds) {
      assertGodotSmokeActorId(actorId, 'inspectWorldDirectorFixture');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [pressures, node, events, config] = await Promise.all([
      args.pressureId
        ? ctx.db
            .query('worldPressures')
            .withIndex('byPressure', (q) =>
              q.eq('worldId', status.worldId).eq('pressureId', args.pressureId!),
            )
            .take(1)
        : ctx.db
            .query('worldPressures')
            .withIndex('byMapStatus', (q) =>
              q
                .eq('worldId', status.worldId)
                .eq('mapId', WORLD_DIRECTOR_LAB_MAP_ID)
                .eq('status', 'active'),
            )
            .take(4),
      ctx.db
        .query('resourceNodes')
        .withIndex('byNode', (q) =>
          q.eq('worldId', status.worldId).eq('resourceNodeId', WORLD_DIRECTOR_RESOURCE_NODE_ID),
        )
        .first(),
      ctx.db
        .query('worldEvents')
        .withIndex('byMap', (q) =>
          q.eq('worldId', status.worldId).eq('mapId', WORLD_DIRECTOR_LAB_MAP_ID),
        )
        .order('desc')
        .take(20),
      ctx.db
        .query('xianxiaConfig')
        .withIndex('byWorld', (q) => q.eq('worldId', status.worldId))
        .first(),
    ]);
    const actors = [];
    for (const actorId of args.actorIds) {
      const [profile, trace] = await Promise.all([
        ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) =>
            q.eq('worldId', status.worldId).eq('actorId', actorId),
          )
          .first(),
        ctx.db
          .query('autonomyDecisionTraces')
          .withIndex('byActorCreatedAt', (q) =>
            q.eq('worldId', status.worldId).eq('actorId', actorId),
          )
          .order('desc')
          .first(),
      ]);
      actors.push({
        actorId,
        profile: profile
          ? {
              locationId: profile.currentLocationId,
              inventory: profile.inventory,
            }
          : null,
        trace: trace
          ? {
              observationRevision: trace.observationRevision,
              chosenCandidateId: trace.chosenCandidateId,
              candidates: trace.candidates,
            }
          : null,
      });
    }
    return {
      worldId: status.worldId,
      pressures,
      node,
      events: events.map((event) => ({
        eventId: event._id,
        type: event.type,
        facts: event.facts,
      })),
      config: config
        ? {
            worldDirectorEnabled: config.worldDirectorEnabled,
            worldDirectorNextEligibleGameHour: config.worldDirectorNextEligibleGameHour,
          }
        : null,
      actors,
    };
  },
});

export const restoreWorldDirectorFixtureConfig = mutation({
  args: {
    worldDirectorEnabled: v.optional(v.boolean()),
    worldDirectorNextEligibleGameHour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.restoreWorldDirectorFixtureConfig');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const config = await ctx.db
      .query('xianxiaConfig')
      .withIndex('byWorld', (q) => q.eq('worldId', status.worldId))
      .first();
    if (config) {
      await ctx.db.patch(config._id, {
        worldDirectorEnabled: args.worldDirectorEnabled,
        worldDirectorNextEligibleGameHour: args.worldDirectorNextEligibleGameHour,
      });
    }
    return { restored: true };
  },
});

/**
 * C017d local-only production fixture. The mutation seeds only authoritative
 * facts plus three pre-existing bounded goals; every following choice still
 * runs through the unchanged production Agent and GM paths with provider=0.
 */
export const primePersonalGoalFixture = mutation({
  args: {
    continuationActorId: v.string(),
    preemptActorId: v.string(),
    idleActorId: v.string(),
    expiryActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primePersonalGoalFixture');
    const actorIds = [
      args.continuationActorId,
      args.preemptActorId,
      args.idleActorId,
      args.expiryActorId,
    ];
    if (new Set(actorIds).size !== 4) {
      throw new Error('primePersonalGoalFixture requires four unique actors.');
    }
    for (const actorId of actorIds) {
      assertGodotSmokeActorId(actorId, 'primePersonalGoalFixture');
      if (!actorId.startsWith('godot_smoke_c017d_')) {
        throw new Error('primePersonalGoalFixture actors must stay inside C017d.');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, status.worldId, now);
    const locationPatch = {
      name: '系统灰盒个人目标院',
      kind: 'personal_goal_yard',
      mapId: SYSTEM_LAB_MAP_ID,
      dangerLevel: 0,
      spiritualEnergy: 3,
      allowedActions: ['cultivate', 'explore', 'rest', 'use_item'],
      entryPoints: [SYSTEM_LAB_PERSONAL_GOAL_TILE],
      bounds: { x1: 108, y1: 8, x2: 112, y2: 12 },
      description: 'C017d 持久目标、抢占和显式空闲的生产路径灰盒。',
    };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('locationId', SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID),
      )
      .first();
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID,
        ...locationPatch,
      });
    }

    for (const actorId of actorIds) {
      const isPreempt = actorId === args.preemptActorId;
      const isIdle = actorId === args.idleActorId;
      const profilePatch = {
        name: `灰盒目标弟子 ${actorId.slice(-6)}`,
        role: isIdle ? 'guard' : 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '忠贞',
        cultivationXp: 10,
        mood: 1,
        health: isPreempt ? 3 : 10,
        maxHealth: 10,
        fatigue: isPreempt ? 82 : 0,
        spirit: 6,
        reputation: 0,
        inventory: isPreempt
          ? [{ itemId: 'healing_pill', qty: 1 }]
          : [] as { itemId: string; qty: number }[],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: isIdle ? undefined : SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID,
        currentIntent: '只依据服务端持久目标和当前事实行动。',
        persona: '不调用外部模型。',
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
      };
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .first();
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId,
          ...profilePatch,
        });
      }
    }

    for (const [actorId, spec] of [
      [
        args.continuationActorId,
        {
          kind: 'cultivation' as const,
          goalKey: `cultivation:cultivation:${args.continuationActorId}`,
          sourceRef: `cultivation:${args.continuationActorId}`,
          candidateId: 'seed:cultivation',
          intent: '延续已经开始的修行打算',
        },
      ],
      [
        args.preemptActorId,
        {
          kind: 'livelihood' as const,
          goalKey: `livelihood:location:${SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID}`,
          sourceRef: `location:${SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID}`,
          candidateId: 'seed:livelihood',
          intent: '在院中寻找生计',
        },
      ],
      [
        args.expiryActorId,
        {
          kind: 'cultivation' as const,
          goalKey: `cultivation:cultivation:${args.expiryActorId}`,
          sourceRef: `cultivation:${args.expiryActorId}`,
          candidateId: 'seed:expired',
          intent: '一桩已经超过软期限的修行打算',
        },
      ],
    ] as const) {
      const expired = actorId === args.expiryActorId;
      await ctx.db.insert('personalGoals', {
        worldId: status.worldId,
        contractVersion: PERSONAL_GOAL_CONTRACT_VERSION,
        goalId: `personal_goal:${actorId}:1`,
        actorId,
        revision: 1,
        status: 'active',
        goalKey: spec.goalKey,
        kind: spec.kind,
        sourceRef: spec.sourceRef,
        candidateId: spec.candidateId,
        intent: spec.intent,
        progressScore: 0,
        progressKey: 'fixture:initial',
        progressRevision: 0,
        backlog: [],
        observationRevision: 'fixture:initial',
        startedGameHour: nowGameHour,
        lastProgressGameHour: nowGameHour,
        deadlineGameHour: expired
          ? nowGameHour
          : nowGameHour + PERSONAL_GOAL_SOFT_DEADLINE_HOURS,
        hardDeadlineGameHour: nowGameHour + PERSONAL_GOAL_HARD_DEADLINE_HOURS,
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_PERSONAL_GOAL_LOCATION_ID,
      actorIds,
    };
  },
});

export const inspectPersonalGoalFixture = query({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectPersonalGoalFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const actors = [];
    for (const actorId of args.actorIds) {
      assertGodotSmokeActorId(actorId, 'inspectPersonalGoalFixture');
      const goals = await ctx.db
        .query('personalGoals')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .order('asc')
        .collect();
      const actions = await ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .order('desc')
        .take(5);
      actors.push({
        actorId,
        goals: goals.map((goal) => ({
          goalId: goal.goalId,
          revision: goal.revision,
          status: goal.status,
          kind: goal.kind,
          sourceRef: goal.sourceRef,
          progressRevision: goal.progressRevision,
          deadlineGameHour: goal.deadlineGameHour,
          hardDeadlineGameHour: goal.hardDeadlineGameHour,
          backlogCount: goal.backlog.length,
          attemptCount: goal.attemptCount,
          terminalReasonCode: goal.terminalReasonCode,
          idleReasonCode: goal.idleReasonCode,
          lastActionRecordId: goal.lastActionRecordId,
        })),
        actions: actions.map((actionRecord) => ({
          actionRecordId: actionRecord._id,
          type: actionRecord.type,
          status: actionRecord.status,
          resultCode: actionRecord.result?.resultCode,
        })),
      });
    }
    return { worldId: status.worldId, actors };
  },
});

/**
 * Reissues an already observed/approved live breakthrough proposal after a
 * harness-side lease expiry. It never calls an LLM and cannot choose another
 * action; the production GM/action path still revalidates every world fact.
 */
export const resumeApprovedBreakthroughDecision = action({
  args: { actorId: v.string(), decisionId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.resumeApprovedBreakthroughDecision');
    assertGodotSmokeActorId(args.actorId, 'resumeApprovedBreakthroughDecision');
    const status = await ctx.runQuery(api.world.defaultWorldStatus, {});
    if (!status?.worldId) throw new Error('No default worldStatus found.');
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: status.worldId,
      actorId: args.actorId,
      now: Date.now(),
    });
    if (!context?.self.currentLocationId || !context.availableActions.includes('breakthrough')) {
      throw new Error('Approved breakthrough proposal is no longer legal.');
    }
    return await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: status.worldId,
      type: 'breakthrough',
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent-resume:${args.decisionId.slice(0, 80)}:${args.actorId.slice(0, 48)}`,
      locationId: context.self.currentLocationId,
      intent: '依心而行',
    });
  },
});

const godotHealingScenario = v.union(
  v.literal('injured_two_pills'),
  v.literal('near_max_one_pill'),
  v.literal('full_one_pill'),
  v.literal('injured_no_pill'),
  v.literal('injured_wrong_item'),
  v.literal('incapacitated_one_pill'),
);

type GodotHealingScenario =
  | 'injured_two_pills'
  | 'near_max_one_pill'
  | 'full_one_pill'
  | 'injured_no_pill'
  | 'injured_wrong_item'
  | 'incapacitated_one_pill';

function godotHealingScenarioState(scenario: GodotHealingScenario) {
  switch (scenario) {
    case 'injured_two_pills':
      return {
        health: 4,
        inventory: [{ itemId: 'healing_pill', qty: 2 }],
      };
    case 'near_max_one_pill':
      return {
        health: 9,
        inventory: [{ itemId: 'healing_pill', qty: 1 }],
      };
    case 'full_one_pill':
      return {
        health: 10,
        inventory: [{ itemId: 'healing_pill', qty: 1 }],
      };
    case 'injured_no_pill':
      return { health: 4, inventory: [] };
    case 'injured_wrong_item':
      return {
        health: 4,
        inventory: [{ itemId: 'qi_pill', qty: 1 }],
      };
    case 'incapacitated_one_pill':
      return {
        health: 0,
        inventory: [{ itemId: 'healing_pill', qty: 1 }],
      };
  }
}

/**
 * Restricted real-backend fixture for the healing-item transaction checks.
 * Callers select a named state instead of supplying arbitrary profile values.
 */
export const primeGodotHealingCandidate = mutation({
  args: {
    actorId: v.string(),
    scenario: godotHealingScenario,
    mapId: v.optional(v.string()),
    locationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotHealingCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotHealingCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const state = godotHealingScenarioState(args.scenario);
    const mapId = args.mapId ?? 'qinglan';
    const locationId = args.locationId ?? 'market_tea_stall';
    const now = Date.now();
    const incapacitationState =
      args.scenario === 'incapacitated_one_pill'
        ? {
            incapacitatedAt: now,
            recoveryEligibleAt: now + 86_400_000,
            recoveryToken: `godot-healing-fixture:${args.actorId}:${now}`,
          }
        : {};
    const patch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 30,
      mood: 1,
      health: state.health,
      maxHealth: 10,
      ...incapacitationState,
      spirit: 8,
      reputation: 0,
      inventory: state.inventory,
      mapId,
      currentLocationId: locationId,
      currentIntent: `Godot healing transaction fixture: ${args.scenario}.`,
      persona: 'Restricted local actor for real Convex healing transaction checks.',
    };
    const existing = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...patch,
        ...(args.scenario === 'incapacitated_one_pill'
          ? {}
          : {
              incapacitatedAt: undefined,
              recoveryEligibleAt: undefined,
              recoveryToken: undefined,
            }),
      });
    } else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...patch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      scenario: args.scenario,
      mapId,
      locationId,
      health: state.health,
      maxHealth: 10,
      inventory: state.inventory,
    };
  },
});

/**
 * Exact durable inspection for the healing transaction smoke test. Recent-page
 * projections are intentionally insufficient here: duplicate rows must be
 * counted by the idempotency key and every linked event must be enumerated.
 */
export const inspectGodotHealingFixture = query({
  args: {
    actorId: v.string(),
    clientActionIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGodotHealingFixture');
    assertGodotSmokeActorId(args.actorId, 'inspectGodotHealingFixture');
    if (args.clientActionIds.length > 32) {
      throw new Error('inspectGodotHealingFixture accepts at most 32 clientActionIds.');
    }
    if (args.clientActionIds.some((clientActionId) => clientActionId.length === 0)) {
      throw new Error('inspectGodotHealingFixture requires non-empty clientActionIds.');
    }

    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (!profile) throw new Error(`No healing fixture profile found for ${args.actorId}.`);

    const lifecycles = [];
    for (const clientActionId of args.clientActionIds) {
      const records = await ctx.db
        .query('actionRecords')
        .withIndex('byClientAction', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('actorId', args.actorId)
            .eq('clientActionId', clientActionId),
        )
        .collect();
      const inspectedRecords = [];
      for (const record of records) {
        const events = await ctx.db
          .query('worldEvents')
          .withIndex('byAction', (q) =>
            q.eq('worldId', status.worldId).eq('actionId', String(record._id)),
          )
          .collect();
        inspectedRecords.push({
          actionRecordId: record._id,
          type: record.type,
          status: record.status,
          resultCode: record.result?.resultCode,
          effects: record.result?.effects,
          eventCount: events.length,
          eventIds: events.map((event) => event._id),
        });
      }
      lifecycles.push({
        clientActionId,
        actionRecordCount: inspectedRecords.length,
        eventCount: inspectedRecords.reduce((total, record) => total + record.eventCount, 0),
        records: inspectedRecords,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      profile: {
        health: profile.health,
        maxHealth: profile.maxHealth,
        inventory: profile.inventory ?? [],
      },
      lifecycles,
    };
  },
});

export const primeGodotBreakthroughCandidate = mutation({
  args: {
    actorId: v.string(),
    mapId: v.optional(v.string()),
    locationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotBreakthroughCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotBreakthroughCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const mapId = args.mapId ?? 'qinglan';
    const locationId = args.locationId ?? 'market_tea_stall';
    const realm = 'qi_refining';
    const realmStage = 9;
    const cultivationXp = breakthroughThreshold(realm, realmStage);
    const patch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm,
      realmStage,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp,
      realmEnteredAt: Date.now() - 13 * REAL_DAY_MS,
      breakthroughRecoveryUntil: undefined,
      mood: 2,
      health: 9,
      spirit: 8,
      reputation: 0,
      inventory: [{ itemId: 'spirit_stone', qty: 24 }],
      mapId,
      currentLocationId: locationId,
      currentIntent: 'Godot bridge smoke test breakthrough candidate.',
      persona: 'Temporary smoke-test cultivator; actions still resolve through Convex rules.',
    };

    const existing = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...patch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      mapId,
      locationId,
      realm,
      realmStage,
      cultivationXp,
    };
  },
});

export const primeGodotTeachingCandidate = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.optional(v.string()),
    mapId: v.optional(v.string()),
    locationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotTeachingCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotTeachingCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const priorTeachingUsages = await ctx.db
      .query('socialActionUsages')
      .withIndex('byActorTargetTypeDay', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .collect();
    for (const usage of priorTeachingUsages) {
      if (usage.actionType === 'request_teaching') await ctx.db.delete(usage._id);
    }

    const mapId = args.mapId ?? 'qinglan';
    const locationId = args.locationId ?? 'market_tea_stall';
    const targetActorId = args.targetActorId ?? 'qinglan:qinglan-elder-mu';
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', locationId),
      )
      .first();
    if (!location) throw new Error(`No location ${locationId} found.`);
    const tile = location.entryPoints[0] ?? { x: 50, y: 50 };

    const residents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', mapId))
      .collect();
    const resident = residents.find((entry) => entry.actorId === targetActorId);
    if (!resident) throw new Error(`No Qinglan resident ${targetActorId} found.`);
    await ctx.db.patch(resident._id, {
      currentLocationId: locationId,
      displayTile: tile,
      targetTile: tile,
      finalTargetTile: tile,
      status: 'waiting',
      currentIntent: '在茶摊清静处点拨后辈。',
      activityLabel: 'teaching',
      waypointId: locationId,
      updatedAt: Date.now(),
    });

    const actorPatch = {
      name: args.actorId,
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 20,
      mood: 2,
      health: 9,
      spirit: 8,
      reputation: 0,
      inventory: [{ itemId: 'spirit_stone', qty: 24 }],
      mapId,
      currentLocationId: locationId,
      currentIntent: 'Godot bridge smoke test teaching candidate.',
      persona: 'Temporary smoke-test cultivator; actions still resolve through Convex rules.',
    };
    const actorProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    if (actorProfile) await ctx.db.patch(actorProfile._id, actorPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        ...actorPatch,
      });
    }

    const targetPatch = {
      name: resident.name,
      role: resident.role,
      realm: 'foundation_building',
      realmStage: 2,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '义气',
      cultivationXp: 180,
      mood: 2,
      health: 9,
      spirit: 9,
      reputation: 25,
      inventory: [{ itemId: 'spirit_stone', qty: 8 }],
      mapId,
      currentLocationId: locationId,
      currentIntent: '在茶摊清静处点拨后辈。',
      persona: 'Qinglan elder prepared for Godot bridge teaching smoke tests.',
    };
    const targetProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', targetActorId))
      .first();
    if (targetProfile) await ctx.db.patch(targetProfile._id, targetPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: targetActorId,
        ...targetPatch,
      });
    }

    const relationship = await ctx.db
      .query('relationships')
      .withIndex('pair', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('fromActorId', args.actorId)
          .eq('toActorId', targetActorId),
      )
      .first();
    const relationshipPatch = {
      value: 8,
      trust: 4,
      suspicion: 0,
      debt: 0,
      fear: 0,
      tags: ['smoke_test'],
    };
    if (relationship) await ctx.db.patch(relationship._id, relationshipPatch);
    else {
      await ctx.db.insert('relationships', {
        worldId: status.worldId,
        fromActorId: args.actorId,
        toActorId: targetActorId,
        ...relationshipPatch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      targetActorId,
      mapId,
      locationId,
      tile,
    };
  },
});

export const primeShopEconomyLab = mutation({
  args: {
    actorIds: v.array(v.string()),
    actorInventories: v.optional(
      v.array(
        v.object({
          actorId: v.string(),
          inventory: v.array(v.object({ itemId: v.string(), qty: v.number() })),
        }),
      ),
    ),
    incapacitatedActorIds: v.optional(v.array(v.string())),
    herbStock: v.optional(v.number()),
    qiPillStock: v.optional(v.number()),
    walletSpiritStones: v.optional(v.number()),
    restockIntervalMs: v.optional(v.number()),
    nextRestockAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeShopEconomyLab');
    if (args.actorIds.length < 1 || args.actorIds.length > 8) {
      throw new Error('Shop lab requires 1..8 actors.');
    }
    for (const actorId of args.actorIds) assertGodotSmokeActorId(actorId, 'primeShopEconomyLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    // A failed local runner can leave a 60-second reservation on the shared
    // fixture shop. Reset only smoke-actor active executions before re-priming;
    // production actors and terminal audit rows are never touched.
    for (const executionStatus of ['pending', 'accepted', 'acting'] as const) {
      const staleExecutions = await ctx.db
        .query('actionExecutions')
        .withIndex('byShopStatus', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('shopId', SYSTEM_LAB_SHOP_ID)
            .eq('status', executionStatus),
        )
        .collect();
      for (const execution of staleExecutions) {
        if (execution.actorId.startsWith('godot_smoke_')) await ctx.db.delete(execution._id);
      }
    }
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_SHOP_LOCATION_ID),
      )
      .first();
    const locationPatch = {
      name: '灰盒补给铺',
      kind: 'market',
      dangerLevel: 0,
      spiritualEnergy: 2,
      allowedActions: ['talk', 'trade', 'gift', 'rest'],
      mapId: SYSTEM_LAB_MAP_ID,
      entryPoints: [SYSTEM_LAB_SHOP_TILE],
      bounds: { x1: 47, y1: 7, x2: 53, y2: 13 },
      description: 'C009 有限库存、资金、补货与稀缺报价灰盒。',
    };
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_SHOP_LOCATION_ID,
        ...locationPatch,
      });
    }

    const shopkeeper = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', SYSTEM_LAB_SHOPKEEPER_ACTOR_ID),
      )
      .first();
    const shopkeeperPatch = {
      name: '灰盒掌柜',
      role: 'merchant',
      realm: 'qi_refining',
      realmStage: 2,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '义气',
      cultivationXp: 20,
      mood: 1,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 6,
      reputation: 5,
      inventory: [],
      mapId: SYSTEM_LAB_MAP_ID,
      currentLocationId: SYSTEM_LAB_SHOP_LOCATION_ID,
      currentIntent: '经营具名供应源支持的有限补给铺。',
      persona: '守规矩的灰盒掌柜，只按真实货架与资金成交。',
    };
    if (shopkeeper) await ctx.db.patch(shopkeeper._id, shopkeeperPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: SYSTEM_LAB_SHOPKEEPER_ACTOR_ID,
        ...shopkeeperPatch,
      });
    }
    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', SYSTEM_LAB_SHOPKEEPER_ACTOR_ID),
      )
      .first();
    const residentPatch = {
      residentId: 'system-lab-shopkeeper',
      name: '灰盒掌柜',
      role: 'merchant',
      character: 'f6',
      mapId: SYSTEM_LAB_MAP_ID,
      currentLocationId: SYSTEM_LAB_SHOP_LOCATION_ID,
      displayTile: SYSTEM_LAB_SHOP_TILE,
      orientation: 0,
      status: 'trading' as const,
      emoji: '🧺',
      currentIntent: '按真实库存和资金经营补给铺。',
      activityLabel: '经营',
      updatedAt: now,
    };
    if (resident) await ctx.db.patch(resident._id, residentPatch);
    else {
      await ctx.db.insert('qinglanResidents', {
        worldId: status.worldId,
        actorId: SYSTEM_LAB_SHOPKEEPER_ACTOR_ID,
        ...residentPatch,
      });
    }

    const requestedInventories = new Map(
      (args.actorInventories ?? []).map((entry) => [entry.actorId, entry.inventory]),
    );
    const incapacitatedActorIds = new Set(args.incapacitatedActorIds ?? []);
    for (const actorId of args.actorIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      const actorPatch = {
        name: actorId,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 1,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 0,
        mood: 1,
        health: incapacitatedActorIds.has(actorId) ? 0 : 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 6,
        reputation: 0,
        inventory:
          requestedInventories.get(actorId) ?? [
            { itemId: 'spirit_herb', qty: 1 },
            { itemId: 'spirit_stone', qty: 30 },
          ],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_SHOP_LOCATION_ID,
        currentIntent: '参加 C009 商店经济灰盒验收。',
        persona: '先把采得灵草换成灵石，遵守服务端报价。',
        ...(incapacitatedActorIds.has(actorId)
          ? {
              incapacitatedAt: now,
              recoveryEligibleAt: now + 120_000,
              recoveryToken: `shop-lab-${actorId}`,
            }
          : {
              incapacitatedAt: undefined,
              recoveryEligibleAt: undefined,
              recoveryToken: undefined,
            }),
      };
      if (profile) await ctx.db.patch(profile._id, actorPatch);
      else await ctx.db.insert('xianxiaProfiles', { worldId: status.worldId, actorId, ...actorPatch });
      const actorResident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .filter((q) => q.eq(q.field('mapId'), SYSTEM_LAB_MAP_ID))
        .first();
      const actorResidentPatch = {
        actorId,
        name: actorId,
        role: 'outer_disciple',
        character: 'f1',
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_SHOP_LOCATION_ID,
        displayTile: SYSTEM_LAB_SHOP_TILE,
        targetTile: SYSTEM_LAB_SHOP_TILE,
        finalTargetTile: SYSTEM_LAB_SHOP_TILE,
        pathTiles: [] as { x: number; y: number }[],
        orientation: 0,
        status: 'waiting' as const,
        currentIntent: '参加交易预约与身体执行验收。',
        activityLabel: 'trade_fixture',
        waypointId: SYSTEM_LAB_SHOP_LOCATION_ID,
        nextActionAt: now + 60_000,
        updatedAt: now,
      };
      if (actorResident) await ctx.db.patch(actorResident._id, actorResidentPatch);
      else {
        await ctx.db.insert('qinglanResidents', {
          worldId: status.worldId,
          residentId: `trade-fixture:${actorId}`,
          ...actorResidentPatch,
        });
      }
    }

    const restockIntervalMs = args.restockIntervalMs ?? 30_000;
    const shop = await ctx.db
      .query('shopInventories')
      .withIndex('byShop', (q) =>
        q.eq('worldId', status.worldId).eq('shopId', SYSTEM_LAB_SHOP_ID),
      )
      .first();
    const shopPatch = {
      name: '灰盒补给铺',
      merchantActorId: SYSTEM_LAB_SHOPKEEPER_ACTOR_ID,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_SHOP_LOCATION_ID,
      restockSourceId: 'system_lab_sect_caravan',
      restockIntervalMs,
      nextRestockAt: args.nextRestockAt ?? now + restockIntervalMs,
      walletSpiritStones: args.walletSpiritStones ?? 20,
      walletCapacity: 40,
      walletRestockAmount: 4,
      stock: [
        { itemId: 'spirit_herb', qty: args.herbStock ?? 1, capacity: 4, restockAmount: 1 },
        { itemId: 'qi_pill', qty: args.qiPillStock ?? 1, capacity: 2, restockAmount: 1 },
        { itemId: 'healing_pill', qty: 1, capacity: 2, restockAmount: 1 },
      ],
      updatedAt: now,
    };
    if (shop) await ctx.db.patch(shop._id, shopPatch);
    else {
      await ctx.db.insert('shopInventories', {
        worldId: status.worldId,
        shopId: SYSTEM_LAB_SHOP_ID,
        ...shopPatch,
      });
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_SHOP_LOCATION_ID,
      tile: SYSTEM_LAB_SHOP_TILE,
      shopId: SYSTEM_LAB_SHOP_ID,
      merchantActorId: SYSTEM_LAB_SHOPKEEPER_ACTOR_ID,
      actorIds: args.actorIds,
    };
  },
});

export const inspectShopEconomyLab = query({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectShopEconomyLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const shop = await ctx.db
      .query('shopInventories')
      .withIndex('byShop', (q) =>
        q.eq('worldId', status.worldId).eq('shopId', SYSTEM_LAB_SHOP_ID),
      )
      .first();
    const actors = [];
    for (const actorId of args.actorIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      const actions = await ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .order('desc')
        .take(20);
      const executions = await ctx.db
        .query('actionExecutions')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .order('desc')
        .take(20);
      const usages = await ctx.db
        .query('socialActionUsages')
        .withIndex('byActorTargetTypeDay', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .collect();
      const modelCalls = await ctx.db
        .query('socialModelCalls')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        )
        .collect();
      actors.push({
        actorId,
        health: profile?.health,
        inventory: profile?.inventory ?? [],
        providerCalls: modelCalls.length,
        actions: actions.map((actionRecord) => ({
          actionRecordId: actionRecord._id,
          clientActionId: actionRecord.clientActionId,
          type: actionRecord.type,
          status: actionRecord.status,
          result: actionRecord.result,
        })),
        executions: executions.map((execution) => ({
          executionId: execution._id,
          actionRecordId: execution.actionRecordId,
          revision: execution.revision,
          actionType: execution.actionType,
          source: execution.source,
          status: execution.status,
          tradeMode: execution.tradeMode,
          shopId: execution.shopId,
          reservedItemId: execution.reservedItemId,
          reservedItemQuantity: execution.reservedItemQuantity,
          reservedTargetItemId: execution.reservedTargetItemId,
          reservedTargetItemQuantity: execution.reservedTargetItemQuantity,
          tradeUnitPrice: execution.tradeUnitPrice,
          tradeTotalPrice: execution.tradeTotalPrice,
          terminalEventId: execution.terminalEventId,
          resultCode: execution.resultCode,
          reasonCode: execution.reasonCode,
        })),
        tradeUsages: usages.filter((usage) => usage.actionType === 'trade'),
      });
    }
    const shopEvents = await ctx.db
      .query('worldEvents')
      .withIndex('byMap', (q) =>
        q.eq('worldId', status.worldId).eq('mapId', SYSTEM_LAB_MAP_ID),
      )
      .order('desc')
      .take(40);
    return {
      shop,
      actors,
      events: shopEvents.filter(
        (event) =>
          event.type === 'shop_trade_completed' ||
          event.type === 'trade_completed' ||
          event.type === 'trade_started' ||
          event.type === 'shop_restocked' ||
          event.type === 'action_refused' ||
          event.type === 'action_execution_blocked' ||
          event.type === 'action_execution_interrupted',
      ),
    };
  },
});

/**
 * C009 offline Agent acceptance. It uses the production observation query,
 * production deterministic shop planner, and production GM/action settlement,
 * but deliberately has no LLM fallback so a regression run never spends a
 * live-model authorization.
 */
export const runShopRuleAgent = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    decisionId: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runShopRuleAgent');
    assertGodotSmokeActorId(args.actorId, 'runShopRuleAgent');
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: args.worldId,
      actorId: args.actorId,
      now: Date.now(),
    });
    if (!context) return { actorId: args.actorId, skipped: 'no_profile' };
    const proposal = planShopTradeIntent(context);
    if (!proposal) {
      return {
        actorId: args.actorId,
        skipped: 'no_shop_trade_intent',
        observation: {
          availableActions: context.availableActions,
          shopOffers: context.shopOffers ?? [],
        },
      };
    }
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: proposal.type,
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: proposal.targetActorId,
      targetId: proposal.targetId,
      locationId: proposal.locationId,
      intent: proposal.intent,
      params: proposal.params,
    });
    return { actorId: args.actorId, proposal, result, decisionSource: 'rule' };
  },
});

export const primeGodotTradeCandidate = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.optional(v.string()),
    mapId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotTradeCandidate');
    assertGodotSmokeActorId(args.actorId, 'primeGodotTradeCandidate');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const mapId = args.mapId ?? 'qinglan';
    const targetActorId = args.targetActorId ?? 'qinglan:qinglan-medicine-keeper';
    const residents = await ctx.db
      .query('qinglanResidents')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', mapId))
      .collect();
    const resident = residents.find((entry) => entry.actorId === targetActorId);
    if (!resident) throw new Error(`No Qinglan resident ${targetActorId} found.`);

    const actorProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    const actorPatch = {
      inventory: [{ itemId: 'spirit_stone', qty: 24 }],
      mapId,
      currentLocationId: resident.currentLocationId,
      currentIntent: 'Godot bridge smoke test trade candidate.',
    };
    if (actorProfile) await ctx.db.patch(actorProfile._id, actorPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: args.actorId,
        name: args.actorId,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 1,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 20,
        mood: 2,
        health: 9,
        spirit: 8,
        reputation: 0,
        persona: 'Temporary smoke-test cultivator; actions still resolve through Convex rules.',
        ...actorPatch,
      });
    }

    const targetPatch = {
      name: resident.name,
      role: resident.role,
      realm: 'qi_refining',
      realmStage: 3,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '义气',
      cultivationXp: 80,
      mood: 1,
      health: 8,
      spirit: 7,
      reputation: 8,
      inventory: [
        { itemId: 'spirit_stone', qty: 40 },
        { itemId: 'spirit_herb', qty: 3 },
      ],
      mapId,
      currentLocationId: resident.currentLocationId,
      currentIntent: 'Godot bridge smoke test trade seller.',
      persona: 'Qinglan merchant prepared for Godot bridge trade smoke tests.',
    };
    const targetProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', targetActorId))
      .first();
    if (targetProfile) await ctx.db.patch(targetProfile._id, targetPatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: targetActorId,
        ...targetPatch,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      targetActorId,
      mapId,
      locationId: resident.currentLocationId,
      actorSpiritStones: 24,
      targetStock: 3,
    };
  },
});

export const primeConflictLootLab = mutation({
  args: {
    attackerActorId: v.string(),
    defenderActorId: v.string(),
    competitorActorId: v.string(),
    witnessActorId: v.string(),
    guardActorId: v.string(),
    defenderHealth: v.optional(v.number()),
    defenderHealingPills: v.optional(v.number()),
    attackerSpiritStones: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeConflictLootLab');
    const actorIds = [
      args.attackerActorId,
      args.defenderActorId,
      args.competitorActorId,
      args.witnessActorId,
      args.guardActorId,
    ];
    for (const actorId of actorIds) assertGodotSmokeActorId(actorId, 'primeConflictLootLab');
    if (new Set(actorIds).size !== actorIds.length) throw new Error('C010 actors must be distinct.');
    if (
      !Number.isInteger(args.attackerSpiritStones ?? 0) ||
      (args.attackerSpiritStones ?? 0) < 0 ||
      (args.attackerSpiritStones ?? 0) > 999
    ) {
      throw new Error('C013c2 attacker spirit stones must remain in 0..999.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const existingLocation = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_CONFLICT_LOCATION_ID),
      )
      .first();
    const locationPatch = {
      name: '灰盒止戈场',
      kind: 'conflict_yard',
      dangerLevel: 1,
      spiritualEnergy: 1,
      allowedActions: ['attack', 'spar', 'talk'],
      mapId: SYSTEM_LAB_MAP_ID,
      entryPoints: [SYSTEM_LAB_CONFLICT_TILE],
      bounds: { x1: 56, y1: 6, x2: 64, y2: 14 },
      description: 'C010 攻击、逃跑、击倒、掠夺、目击与守卫追责灰盒。',
    };
    if (existingLocation) await ctx.db.patch(existingLocation._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_CONFLICT_LOCATION_ID,
        ...locationPatch,
      });
    }

    // This local-only fixture reuses one semantic yard across repeated soak runs.
    // Retire earlier C010 fixture profiles from that yard before seeding the next
    // scene, otherwise the production observer query's bounded page can be filled
    // entirely by stale test actors and hide the current witness/guard.
    const staleConflictProfiles = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('byLocation', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('mapId', SYSTEM_LAB_MAP_ID)
          .eq('currentLocationId', SYSTEM_LAB_CONFLICT_LOCATION_ID),
      )
      .collect();
    const currentActorIds = new Set(actorIds);
    for (const profile of staleConflictProfiles) {
      if (
        (profile.actorId.startsWith('godot_smoke_c010_') ||
          profile.actorId.startsWith('godot_smoke_c013_compensation_')) &&
        !currentActorIds.has(profile.actorId)
      ) {
        await ctx.db.patch(profile._id, { currentLocationId: undefined });
      }
    }

    const fixtures = [
      {
        actorId: args.attackerActorId,
        name: '灰盒进攻者',
        role: 'outer_disciple',
        health: 10,
        tile: { x: 59, y: 10 },
        inventory: (args.attackerSpiritStones ?? 0) > 0
          ? [{ itemId: 'spirit_stone', qty: args.attackerSpiritStones! }]
          : [],
      },
      {
        actorId: args.defenderActorId,
        name: '灰盒守方',
        role: 'outer_disciple',
        health: Math.max(1, Math.min(10, Math.floor(args.defenderHealth ?? 2))),
        tile: { x: 60, y: 10 },
        inventory: [
          { itemId: 'spirit_herb', qty: 1 },
          ...(Math.max(0, Math.floor(args.defenderHealingPills ?? 0)) > 0
            ? [
                {
                  itemId: 'healing_pill',
                  qty: Math.max(0, Math.floor(args.defenderHealingPills ?? 0)),
                },
              ]
            : []),
        ],
      },
      { actorId: args.competitorActorId, name: '灰盒竞争者', role: 'outer_disciple', health: 10, tile: { x: 61, y: 10 }, inventory: [] },
      { actorId: args.witnessActorId, name: '灰盒目击者', role: 'outer_disciple', health: 10, tile: { x: 60, y: 11 }, inventory: [] },
      { actorId: args.guardActorId, name: '灰盒守卫', role: 'guard', health: 10, tile: { x: 60, y: 9 }, inventory: [] },
    ];
    for (const fixture of fixtures) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', fixture.actorId),
        )
        .first();
      const profilePatch = {
        name: fixture.name,
        role: fixture.role,
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: fixture.role === 'guard' ? '名声' : '任我',
        cultivationXp: 0,
        mood: 0,
        health: fixture.health,
        maxHealth: 10,
        fatigue: 0,
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
        spirit: 5,
        reputation: 0,
        inventory: fixture.inventory,
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_CONFLICT_LOCATION_ID,
        currentIntent: '参加 C010 冲突与资源守恒灰盒验收。',
        persona: '只提交高层冲突意图，服从规则层裁决。',
      };
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: fixture.actorId,
          ...profilePatch,
        });
      }
      const resident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', fixture.actorId),
        )
        .first();
      const residentPatch = {
        residentId: `system-lab-conflict-${fixture.actorId}`,
        name: fixture.name,
        role: fixture.role,
        character: fixture.role === 'guard' ? 'm6' : 'm3',
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_CONFLICT_LOCATION_ID,
        displayTile: fixture.tile,
        orientation: 0,
        status: 'waiting' as const,
        currentIntent: '等待 C010 灰盒动作。',
        activityLabel: '冲突灰盒',
        updatedAt: now,
      };
      if (resident) await ctx.db.patch(resident._id, residentPatch);
      else {
        await ctx.db.insert('qinglanResidents', {
          worldId: status.worldId,
          actorId: fixture.actorId,
          ...residentPatch,
        });
      }
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_CONFLICT_LOCATION_ID,
      tile: SYSTEM_LAB_CONFLICT_TILE,
      actors: fixtures.map((fixture) => ({ actorId: fixture.actorId, tile: fixture.tile })),
    };
  },
});

export const expireConflictLootProtection = mutation({
  args: { encounterId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.expireConflictLootProtection');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const encounter = await ctx.db
      .query('combatEncounters')
      .withIndex('byEncounter', (q) =>
        q.eq('worldId', status.worldId).eq('encounterId', args.encounterId),
      )
      .first();
    if (!encounter) throw new Error('Combat encounter not found.');
    await ctx.db.patch(encounter._id, { lootProtectedUntil: Date.now() - 1, updatedAt: Date.now() });
    return { encounterId: encounter.encounterId, lootProtectedUntil: Date.now() - 1 };
  },
});

export const forceActiveFleeOutcome = mutation({
  args: { actorId: v.string(), outcome: v.union(v.literal('success'), v.literal('failure')) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.forceActiveFleeOutcome');
    assertGodotSmokeActorId(args.actorId, 'forceActiveFleeOutcome');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    if (!execution || execution.actionType !== 'flee' || !['pending', 'accepted', 'acting'].includes(execution.status)) {
      throw new Error('No active flee execution to seed.');
    }
    let seed = '';
    for (let index = 0; index < 20_000; index += 1) {
      const candidate = `restricted:c010:flee:${args.actorId}:${args.outcome}:${index}`;
      const roll = seededRoll(candidate);
      if ((args.outcome === 'success' && roll < 0.55) || (args.outcome === 'failure' && roll >= 0.55)) {
        seed = candidate;
        break;
      }
    }
    if (!seed) throw new Error(`Unable to derive deterministic flee ${args.outcome} seed.`);
    await ctx.db.patch(execution.actionRecordId, { seed });
    return { executionId: execution._id, actionRecordId: execution.actionRecordId, seed, outcome: args.outcome };
  },
});

export const expireActiveConflictExecutionLease = mutation({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.expireActiveConflictExecutionLease');
    assertGodotSmokeActorId(args.actorId, 'expireActiveConflictExecutionLease');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const execution = await ctx.db
      .query('actionExecutions')
      .withIndex('byActorRevision', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    if (
      !execution ||
      !['attack', 'flee', 'loot'].includes(execution.actionType) ||
      !['pending', 'accepted', 'acting'].includes(execution.status)
    ) {
      throw new Error('No active C010 action execution to expire.');
    }
    const now = Date.now();
    await ctx.db.patch(execution._id, {
      expiresAt: now - 1,
      hardDeadlineAt: Math.max(execution.hardDeadlineAt, now + 30_000),
      updatedAt: now,
    });
    return { executionId: execution._id, revision: execution.revision, expiresAt: now - 1 };
  },
});

export const inspectConflictLootLab = query({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectConflictLootLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const actors = [];
    const actionRecordIds = new Set<string>();
    for (const actorId of args.actorIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      const actions = await ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .order('desc')
        .take(20);
      const relationships = await ctx.db
        .query('relationships')
        .withIndex('from', (q) => q.eq('worldId', status.worldId).eq('fromActorId', actorId))
        .take(30);
      for (const actionRecord of actions) actionRecordIds.add(String(actionRecord._id));
      actors.push({
        actorId,
        health: profile?.health,
        recoveryEligibleAt: profile?.recoveryEligibleAt,
        inventory: profile?.inventory ?? [],
        reputation: profile?.reputation,
        actions: actions.map((actionRecord) => ({
          actionRecordId: actionRecord._id,
          clientActionId: actionRecord.clientActionId,
          type: actionRecord.type,
          status: actionRecord.status,
          resultCode: actionRecord.result?.resultCode,
        })),
        relationships: relationships.map((relationship) => ({
          toActorId: relationship.toActorId,
          value: relationship.value,
          suspicion: relationship.suspicion ?? 0,
          fear: relationship.fear ?? 0,
          lastChangedByEventId: relationship.lastChangedByEventId,
        })),
      });
    }
    const encounters = [];
    for (const encounterStatus of [
      'active',
      'attacker_fled',
      'defender_fled',
      'attacker_defeated',
      'defender_defeated',
      'closed',
    ] as const) {
      encounters.push(
        ...(await ctx.db
          .query('combatEncounters')
          .withIndex('byLocationStatus', (q) =>
            q
              .eq('worldId', status.worldId)
              .eq('mapId', SYSTEM_LAB_MAP_ID)
              .eq('locationId', SYSTEM_LAB_CONFLICT_LOCATION_ID)
              .eq('status', encounterStatus),
          )
          .order('desc')
          .take(20)),
      );
    }
    const events = (
      await Promise.all([...actionRecordIds].map((actionId) =>
        ctx.db
          .query('worldEvents')
          .withIndex('byAction', (q) => q.eq('worldId', status.worldId).eq('actionId', actionId))
          .collect(),
      ))
    ).flat();
    const memories = await inspectMemoriesForEvents(ctx, status.worldId, events, args.actorIds);
    return {
      actors,
      events: events.map((event) => ({
        eventId: event._id,
        type: event.type,
        actionId: event.actionId,
        actorIds: event.actorIds,
        targetActorIds: event.targetActorIds,
        witnessActorIds: event.witnessActorIds,
      })),
      memories,
      encounters: encounters.map((encounter) => ({
        encounterId: encounter.encounterId,
        status: encounter.status,
        attackerActorId: encounter.attackerActorId,
        defenderActorId: encounter.defenderActorId,
        winnerActorId: encounter.winnerActorId,
        defeatedActorId: encounter.defeatedActorId,
        lootOwnerActorId: encounter.lootOwnerActorId,
        lootProtectedUntil: encounter.lootProtectedUntil,
        witnessActorIds: encounter.witnessActorIds,
        guardActorIds: encounter.guardActorIds,
        terminalActionId: encounter.terminalActionId,
        terminalEventId: encounter.terminalEventId,
        compensationNegotiationId: encounter.compensationNegotiationId,
        compensationActionId: encounter.compensationActionId,
        compensationEventId: encounter.compensationEventId,
        compensationSpiritStones: encounter.compensationSpiritStones,
        compensatedAt: encounter.compensatedAt,
      })),
    };
  },
});

export const recoverCompensationNegotiationLab = mutation({
  args: { encounterId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.recoverCompensationNegotiationLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const encounter = await ctx.db
      .query('combatEncounters')
      .withIndex('byEncounter', (q) =>
        q.eq('worldId', status.worldId).eq('encounterId', args.encounterId),
      )
      .first();
    if (
      !encounter ||
      encounter.status !== 'defender_defeated' ||
      !encounter.attackerActorId.startsWith('godot_smoke_c013_compensation_') ||
      !encounter.defenderActorId.startsWith('godot_smoke_c013_compensation_') ||
      !encounter.terminalEventId
    ) {
      throw new Error('C013c2 exact defeated encounter fixture not found.');
    }
    const defender = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', encounter.defenderActorId),
      )
      .first();
    if (!defender) throw new Error('C013c2 defeated profile not found.');
    await ctx.db.patch(defender._id, {
      health: 1,
      incapacitatedAt: undefined,
      recoveryEligibleAt: undefined,
      recoveryToken: undefined,
      currentLocationId: SYSTEM_LAB_CONFLICT_LOCATION_ID,
    });
    return {
      worldId: status.worldId,
      encounterId: encounter.encounterId,
      payerActorId: encounter.attackerActorId,
      payeeActorId: encounter.defenderActorId,
      harmEventId: encounter.terminalEventId,
    };
  },
});

export const setCompensationFixtureSpiritStones = mutation({
  args: { actorId: v.string(), qty: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setCompensationFixtureSpiritStones');
    if (
      !args.actorId.startsWith('godot_smoke_c013_compensation_') ||
      !Number.isInteger(args.qty) ||
      args.qty < 0 ||
      args.qty > 999
    ) {
      throw new Error('C013c2 compensation inventory fixture is out of bounds.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (!profile) throw new Error('C013c2 compensation actor not found.');
    const inventory = (profile.inventory ?? []).filter((item) => item.itemId !== 'spirit_stone');
    if (args.qty > 0) inventory.push({ itemId: 'spirit_stone', qty: args.qty });
    await ctx.db.patch(profile._id, { inventory });
    return { actorId: args.actorId, qty: args.qty };
  },
});

export const primeSocialQuestLab = mutation({
  args: {
    assigneeActorId: v.string(),
    issuerActorId: v.string(),
    requestType: v.optional(v.union(v.literal('collect_item'), v.literal('explore_location'))),
    createRequest: v.optional(v.boolean()),
    initialIssuerTrust: v.optional(v.number()),
    initialAssigneeAffinity: v.optional(v.number()),
    assigneeRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeSocialQuestLab');
    if (args.assigneeActorId !== 'godot_player') {
      assertGodotSmokeActorId(args.assigneeActorId, 'primeSocialQuestLab');
    }
    if (!args.issuerActorId.startsWith('system_lab_request_issuer')) {
      throw new Error('C011 issuer must stay inside the system_lab_request_issuer fixture boundary.');
    }
    if (args.assigneeActorId === args.issuerActorId) throw new Error('C011 actors must be distinct.');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const requestType = args.requestType ?? 'collect_item';
    const fixtureGameHour = await readGameHour(ctx, status.worldId, now);
    const fixtureGameDay = Math.floor(fixtureGameHour / 24);
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', SYSTEM_LAB_REQUEST_LOCATION_ID),
      )
      .first();
    const locationPatch = {
      name: '灰盒委托堂',
      kind: 'request_hall',
      dangerLevel: 0,
      spiritualEnergy: 2,
      allowedActions: ['talk', 'rest'],
      mapId: SYSTEM_LAB_MAP_ID,
      entryPoints: [SYSTEM_LAB_REQUEST_TILE],
      bounds: { x1: 66, y1: 6, x2: 74, y2: 14 },
      description: 'C011 委托接受、拒绝与交付灰盒。',
    };
    if (location) await ctx.db.patch(location._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        ...locationPatch,
      });
    }

    const fixtures = [
      {
        actorId: args.assigneeActorId,
        name: '灰盒受托弟子',
        role: args.assigneeRole ?? 'outer_disciple',
        tile: { x: 69, y: 10 },
        inventory: [{ itemId: 'spirit_stone', qty: 8 }],
      },
      {
        actorId: args.issuerActorId,
        name: '灰盒委托长老',
        role: 'elder',
        tile: { x: 71, y: 10 },
        inventory: [],
      },
    ];
    for (const fixture of fixtures) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', fixture.actorId),
        )
        .first();
      const profilePatch = {
        name: fixture.name,
        role: fixture.role,
        realm: fixture.role === 'elder' ? 'foundation_building' : 'qi_refining',
        realmStage: fixture.role === 'elder' ? 2 : 1,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: fixture.role === 'elder' ? '义气' : '任我',
        cultivationXp: 0,
        mood: 0,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        incapacitatedAt: undefined,
        recoveryEligibleAt: undefined,
        recoveryToken: undefined,
        spirit: 5,
        reputation: 0,
        inventory: fixture.inventory,
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        currentIntent: '参加 C011 显式委托灰盒验收。',
        persona: '只选择高层委托意图，服从服务端状态机。',
      };
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else {
        await ctx.db.insert('xianxiaProfiles', {
          worldId: status.worldId,
          actorId: fixture.actorId,
          ...profilePatch,
        });
      }
      const resident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', fixture.actorId),
        )
        .first();
      const residentPatch = {
        residentId: `system-lab-request-${fixture.actorId}`,
        name: fixture.name,
        role: fixture.role,
        character: fixture.role === 'elder' ? 'f5' : 'm3',
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        displayTile: fixture.tile,
        orientation: 0,
        status: 'waiting' as const,
        currentIntent: '等待 C011 委托互动。',
        activityLabel: '委托灰盒',
        updatedAt: now,
      };
      if (resident) await ctx.db.patch(resident._id, residentPatch);
      else {
        await ctx.db.insert('qinglanResidents', {
          worldId: status.worldId,
          actorId: fixture.actorId,
          ...residentPatch,
        });
      }
    }

    const oldRequests = await ctx.db
      .query('requests')
      .withIndex('byAssignee', (q) =>
        q.eq('worldId', status.worldId).eq('assigneeActorId', args.assigneeActorId),
      )
      .collect();
    for (const oldRequest of oldRequests) await ctx.db.delete(oldRequest._id);
    const oldRelationships = await Promise.all([
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('fromActorId', args.issuerActorId)
            .eq('toActorId', args.assigneeActorId),
        )
        .first(),
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('fromActorId', args.assigneeActorId)
            .eq('toActorId', args.issuerActorId),
        )
        .first(),
    ]);
    for (const relationship of oldRelationships) {
      if (relationship) await ctx.db.delete(relationship._id);
    }
    await ctx.db.insert('relationships', {
      worldId: status.worldId,
      fromActorId: args.issuerActorId,
      toActorId: args.assigneeActorId,
      value: 0,
      trust: args.initialIssuerTrust ?? 0,
      suspicion: 0,
      debt: 0,
      fear: 0,
      lastTouchedDay: fixtureGameDay,
    });
    await ctx.db.insert('relationships', {
      worldId: status.worldId,
      fromActorId: args.assigneeActorId,
      toActorId: args.issuerActorId,
      value: args.initialAssigneeAffinity ?? 0,
      trust: 0,
      suspicion: 0,
      debt: 0,
      fear: 0,
      lastTouchedDay: fixtureGameDay,
    });
    let requestId: Id<'requests'> | undefined;
    if (args.createRequest !== false) {
      const offerActionId = await ctx.db.insert('actionRecords', {
        worldId: status.worldId,
        actorId: args.issuerActorId,
        type: 'offer_request',
        status: 'proposed',
        targetActorId: args.assigneeActorId,
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        source: 'system',
        mapId: SYSTEM_LAB_MAP_ID,
        createdAt: now,
      });
      requestId = await ctx.db.insert('requests', {
      worldId: status.worldId,
      issuerActorId: args.issuerActorId,
      assigneeActorId: args.assigneeActorId,
      type: requestType,
      status: 'offered',
      revision: 1,
      requirements:
        requestType === 'collect_item'
          ? { itemId: 'spirit_herb', qty: 1 }
          : { locationId: SYSTEM_LAB_RESOURCE_LOCATION_ID },
      rewards: {
        cultivationXp: 12,
        trust: 5,
        debt: 5,
        items: [{ itemId: 'healing_pill', qty: 1 }],
      },
      createdAt: now,
      offeredAtGameHour: fixtureGameHour,
      expiresAt: 1_000_000_000,
      originalExpiresAt: 1_000_000_000,
      deadlineExtensionCount: 0,
      openedByActionId: offerActionId,
      summary:
        requestType === 'collect_item'
          ? '替长老取一株有来源的灵草，再当面交付。'
          : '前往灰盒药草地查探，再回来当面禀报。',
      });
      const offerSummary = '灰盒委托长老向灰盒受托弟子提出一桩委托，尚待答复。';
      const offerEventId = await appendWorldEvent(ctx, {
        worldId: status.worldId,
        type: 'request_offered',
        createdAt: now,
        actorIds: [args.issuerActorId],
        targetActorIds: [args.assigneeActorId],
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        actionId: offerActionId,
        visibility: 'local',
        summary: offerSummary,
        facts: versionDurableEventFacts({
          resultCode: 'request_offered',
          requestType,
          requestId: String(requestId),
          requestStatus: 'offered',
          fromStatus: 'none',
          toStatus: 'offered',
          requestRevision: 1,
          sourceGameHour: fixtureGameHour,
        }),
        mapId: SYSTEM_LAB_MAP_ID,
      });
      await ctx.db.patch(requestId, {
        sourceEventId: offerEventId,
        lastTransitionActionId: offerActionId,
        lastTransitionEventId: offerEventId,
        lastTransitionAt: now,
      });
      await ctx.db.patch(offerActionId, {
        status: 'applied',
        result: toDurableActionResult({
          status: 'applied',
          resultCode: 'request_offered',
          reason: offerSummary,
          effects: {},
          eventType: 'request_offered',
          visibility: 'local',
        }),
      });
      await generateMemories(ctx, status.worldId, {
        eventId: offerEventId,
        type: 'request_offered',
        visibility: 'local',
        actorIds: [args.issuerActorId],
        targetActorIds: [args.assigneeActorId],
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        summary: offerSummary,
        createdAt: now,
      }, fixtureGameHour);
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
      tile: SYSTEM_LAB_REQUEST_TILE,
      requestId,
      requestRevision: requestId ? 1 : undefined,
      requestType,
      assigneeActorId: args.assigneeActorId,
      issuerActorId: args.issuerActorId,
      actors: fixtures.map((fixture) => ({ actorId: fixture.actorId, tile: fixture.tile })),
    };
  },
});

/** C016e4 local-only evidence: reuse a real request event, then separate the
 * issuer physically and archive only the observer's episodic row. */
export const primeLifeObservationFixture = mutation({
  args: { requestId: v.id('requests') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeLifeObservationFixture');
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      !request.assigneeActorId.startsWith('godot_smoke_c016e4_') ||
      !request.issuerActorId.startsWith('system_lab_request_issuer_c016e4_') ||
      !request.sourceEventId
    ) {
      throw new Error('C016e4 request fixture is outside its boundary.');
    }
    const [assignee, issuer, issuerResident] = await Promise.all([
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
        )
        .first(),
      ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', request.worldId).eq('actorId', request.issuerActorId),
        )
        .first(),
      ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) =>
          q.eq('worldId', request.worldId).eq('actorId', request.issuerActorId),
        )
        .first(),
    ]);
    if (!assignee || !issuer) throw new Error('C016e4 fixture profiles are missing.');
    const secretMarker = `issuer-private:${String(request._id)}`;
    await ctx.db.patch(issuer._id, {
      currentLocationId: undefined,
      inventory: [{ itemId: secretMarker, qty: 7 }],
      persona: secretMarker,
    });
    if (issuerResident) {
      await ctx.db.patch(issuerResident._id, {
        currentLocationId: SYSTEM_LAB_REST_LOCATION_ID,
        currentIntent: secretMarker,
        updatedAt: Date.now(),
      });
    }
    const sourceEventId = String(request.sourceEventId);
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('bySourceEvent', (q) =>
        q.eq('worldId', request.worldId).eq('sourceEventId', sourceEventId),
      )
      .collect();
    const observerMemory = memories.find((memory) => memory.actorId === request.assigneeActorId);
    const issuerMemory = memories.find((memory) => memory.actorId === request.issuerActorId);
    if (!observerMemory || !issuerMemory) {
      throw new Error('C016e4 fixture requires generated principal memories.');
    }
    const summaryId = `c016e4-summary:${String(request._id)}`;
    await ctx.db.patch(observerMemory._id, {
      lifecycle: 'archived',
      archivedAtGameHour: request.offeredAtGameHour ?? 0,
      socialSummaryId: summaryId,
    });
    await ctx.db.patch(issuerMemory._id, { summary: secretMarker });
    const existingSummary = await ctx.db
      .query('socialMemorySummaries')
      .withIndex('bySummary', (q) =>
        q.eq('worldId', request.worldId).eq('summaryId', summaryId),
      )
      .first();
    if (existingSummary) await ctx.db.delete(existingSummary._id);
    const now = Date.now();
    await ctx.db.insert('socialMemorySummaries', {
      worldId: request.worldId,
      summaryId,
      actorId: request.assigneeActorId,
      subjectActorId: request.issuerActorId,
      summary: '我记得这名委托人曾提出过请求；这只是背景印象，不是当前世界事实。',
      memoryCount: 1,
      sourceEventIds: [sourceEventId],
      eventTypes: [observerMemory.type],
      sourceKinds: [observerMemory.source ?? 'direct'],
      firstOccurredAt: observerMemory.createdAt,
      lastOccurredAt: observerMemory.createdAt,
      highestSalience: observerMemory.salience,
      containsDistortion: observerMemory.distorted ?? false,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return {
      worldId: request.worldId,
      actorId: request.assigneeActorId,
      issuerActorId: request.issuerActorId,
      requestId: String(request._id),
      sourceEventId,
      archivedMemoryId: String(observerMemory._id),
      privateMemoryId: String(issuerMemory._id),
      summaryId,
      secretMarker,
    };
  },
});

export const inspectLifeObservationFixture = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<LifeObservationV1 | null> => {
    assertLocalGodotFixtureAccess('godotTesting.inspectLifeObservationFixture');
    if (!args.actorId.startsWith('godot_smoke_c016e4_')) {
      throw new Error('C016e4 observation actor is outside its fixture boundary.');
    }
    const context: AgentContext | null = await ctx.runQuery(
      internal.xianxia.agent.agentContext,
      args,
    );
    return context?.lifeObservation ?? null;
  },
});

export const primeRequestDeadlineNegotiationLab = mutation({
  args: {
    requestId: v.id('requests'),
    expiresInGameHours: v.number(),
    requestStatus: v.optional(v.union(v.literal('accepted'), v.literal('ready_to_turn_in'))),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeRequestDeadlineNegotiationLab');
    if (
      !Number.isInteger(args.expiresInGameHours) ||
      args.expiresInGameHours < 1 ||
      args.expiresInGameHours > 168
    ) {
      throw new Error('C013c1 request deadline fixture requires 1..168 integer game hours.');
    }
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      !request.assigneeActorId.startsWith('godot_smoke_c013') ||
      !request.issuerActorId.startsWith('system_lab_request_issuer_c013')
    ) {
      throw new Error('C013c1 request is outside the negotiation fixture boundary.');
    }
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, request.worldId, now);
    const expiresAt = nowGameHour + args.expiresInGameHours;
    await ctx.db.patch(request._id, {
      status: args.requestStatus ?? 'accepted',
      acceptedAt: now,
      readyAt: args.requestStatus === 'ready_to_turn_in' ? now : undefined,
      completedAt: undefined,
      expiresAt,
      originalExpiresAt: expiresAt,
      deadlineExtensionCount: 0,
      deadlineExtendedAt: undefined,
      deadlineExtensionHours: undefined,
      deadlineNegotiationId: undefined,
    });
    return {
      requestId: request._id,
      worldId: request.worldId,
      issuerActorId: request.issuerActorId,
      assigneeActorId: request.assigneeActorId,
      nowGameHour,
      expiresAt,
      status: args.requestStatus ?? 'accepted',
    };
  },
});

export const mutateRequestDeadlineNegotiationLab = mutation({
  args: {
    requestId: v.id('requests'),
    operation: v.union(
      v.literal('change_deadline'),
      v.literal('complete'),
      v.literal('expire'),
    ),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.mutateRequestDeadlineNegotiationLab');
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      !request.assigneeActorId.startsWith('godot_smoke_c013') ||
      !request.issuerActorId.startsWith('system_lab_request_issuer_c013')
    ) {
      throw new Error('C013c1 request is outside the negotiation fixture boundary.');
    }
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, request.worldId, now);
    if (args.operation === 'change_deadline') {
      await ctx.db.patch(request._id, { expiresAt: request.expiresAt + 1 });
    } else if (args.operation === 'complete') {
      await ctx.db.patch(request._id, { status: 'completed', completedAt: now });
    } else {
      await ctx.db.patch(request._id, { status: 'expired', expiresAt: nowGameHour - 1 });
    }
    return { requestId: request._id, operation: args.operation, nowGameHour };
  },
});

export const issueSocialQuestAfterConversation = mutation({
  args: { issuerActorId: v.string(), assigneeActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.issueSocialQuestAfterConversation');
    if (args.assigneeActorId !== 'godot_player') {
      assertGodotSmokeActorId(args.assigneeActorId, 'issueSocialQuestAfterConversation');
    }
    if (!args.issuerActorId.startsWith('system_lab_request_issuer')) {
      throw new Error('C011 issuer must stay inside the system_lab_request_issuer fixture boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, status.worldId, now);
    return (
      (await maybeIssueQuest(ctx, status.worldId, now, nowGameHour, {
        issuerActorId: args.issuerActorId,
        assigneeActorId: args.assigneeActorId,
      })) ?? null
    );
  },
});

export const inspectSocialDialogueLab = query({
  args: { assigneeActorId: v.string(), issuerActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectSocialDialogueLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const relationships = await Promise.all([
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('fromActorId', args.assigneeActorId)
            .eq('toActorId', args.issuerActorId),
        )
        .first(),
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('fromActorId', args.issuerActorId)
            .eq('toActorId', args.assigneeActorId),
        )
        .first(),
    ]);
    const requests = await ctx.db
      .query('requests')
      .withIndex('byAssignee', (q) =>
        q.eq('worldId', status.worldId).eq('assigneeActorId', args.assigneeActorId),
      )
      .collect();
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('byMap', (q) => q.eq('worldId', status.worldId).eq('mapId', SYSTEM_LAB_MAP_ID))
      .order('desc')
      .take(100);
    const relevantEvents = events.filter(
      (event) =>
        event.actorIds.includes(args.assigneeActorId) ||
        event.actorIds.includes(args.issuerActorId) ||
        (event.targetActorIds ?? []).includes(args.assigneeActorId) ||
        (event.targetActorIds ?? []).includes(args.issuerActorId),
    );
    const eventIds = new Set(relevantEvents.map((event) => String(event._id)));
    const relationshipChanges = (
      await Promise.all(
        relevantEvents.map((event) =>
          ctx.db
            .query('relationshipChanges')
            .withIndex('bySourceEvent', (q) =>
              q.eq('worldId', status.worldId).eq('sourceEventId', event._id),
            )
            .collect(),
        ),
      )
    )
      .flat()
      .filter(
        (change) =>
          (change.fromActorId === args.assigneeActorId &&
            change.toActorId === args.issuerActorId) ||
          (change.fromActorId === args.issuerActorId &&
            change.toActorId === args.assigneeActorId),
      );
    const memories = (
      await Promise.all(
        [args.assigneeActorId, args.issuerActorId].map((actorId) =>
          ctx.db
            .query('shortMemories')
            .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
            .order('desc')
            .take(50),
        ),
      )
    )
      .flat()
      .filter((memory) => eventIds.has(memory.sourceEventId));
    return {
      assigneeToIssuer: relationships[0]
        ? {
            affinity: relationships[0].value,
            trust: relationships[0].trust ?? 0,
            lastChangedByEventId: relationships[0].lastChangedByEventId,
          }
        : null,
      issuerToAssignee: relationships[1]
        ? {
            affinity: relationships[1].value,
            trust: relationships[1].trust ?? 0,
            debt: relationships[1].debt ?? 0,
            lastChangedByEventId: relationships[1].lastChangedByEventId,
          }
        : null,
      requests: requests.map((request) => ({
        requestId: request._id,
        status: request.status,
        type: request.type,
      })),
      events: relevantEvents.map((event) => ({
        eventId: event._id,
        type: event.type,
        actionId: event.actionId,
        facts: event.facts,
      })),
      memories: memories.map((memory) => ({
        actorId: memory.actorId,
        sourceEventId: memory.sourceEventId,
        type: memory.type,
      })),
      relationshipChanges: relationshipChanges.map((change) => ({
        changeId: change.changeId,
        sourceEventId: change.sourceEventId,
        fromActorId: change.fromActorId,
        toActorId: change.toActorId,
        effectKind: change.effectKind,
        baseDelta: change.baseDelta,
        appliedDelta: change.appliedDelta,
        status: change.status,
        reasonCode: change.reasonCode,
      })),
    };
  },
});

export const primeConversationKnowledgeFacts = mutation({
  args: { knowerActorId: v.string(), otherActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeConversationKnowledgeFacts');
    assertGodotSmokeActorId(args.knowerActorId, 'primeConversationKnowledgeFacts');
    if (!args.otherActorId.startsWith('system_lab_request_issuer')) {
      throw new Error('C012 other actor must remain in the request issuer fixture boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const privateEventId = await ctx.db.insert('worldEvents', {
      worldId: status.worldId,
      type: 'conversation_lab_private_fact',
      createdAt: now,
      actorIds: [args.knowerActorId],
      locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
      visibility: 'private',
      summary: '灰盒受托弟子亲自核对了私密药册中的缺货记录。',
      facts: versionDurableEventFacts({ resultCode: 'conversation_lab_private_fact' }),
      mapId: SYSTEM_LAB_MAP_ID,
    });
    const publicEventId = await ctx.db.insert('worldEvents', {
      worldId: status.worldId,
      type: 'conversation_lab_public_fact',
      createdAt: now + 1,
      actorIds: [args.knowerActorId],
      targetActorIds: [args.otherActorId],
      locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
      visibility: 'public',
      summary: '委托堂公开张贴了今日药草交付时辰。',
      facts: versionDurableEventFacts({ resultCode: 'conversation_lab_public_fact' }),
      mapId: SYSTEM_LAB_MAP_ID,
    });
    return {
      worldId: status.worldId,
      privateEventId,
      publicEventId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
    };
  },
});

export const primeNonAuthoritativeKnowledgeMemories = mutation({
  args: { actorId: v.string(), otherActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeNonAuthoritativeKnowledgeMemories');
    if (!args.actorId.startsWith('system_lab_request_issuer_c016e2_')) {
      throw new Error('C016e2 rumor fixture actor is outside its boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, status.worldId, now);
    const create = async (kind: 'rumor' | 'distorted') => {
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: status.worldId,
        type: `c016e2_${kind}_only_fact`,
        createdAt: now + (kind === 'rumor' ? 0 : 1),
        actorIds: [args.otherActorId],
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        visibility: 'private',
        summary: kind === 'rumor'
          ? '这件事只经转述传到该角色耳中。'
          : '这份记忆在传播中已经发生走样。',
        facts: versionDurableEventFacts({ resultCode: `c016e2_${kind}_only_fact` }),
        mapId: SYSTEM_LAB_MAP_ID,
      });
      await ctx.db.insert('shortMemories', {
        worldId: status.worldId,
        actorId: args.actorId,
        sourceEventId: String(eventId),
        aboutActorIds: [args.otherActorId],
        type: `c016e2_${kind}_only_fact`,
        salience: 5,
        createdAt: nowGameHour,
        expiresAt: nowGameHour + 168,
        summary: kind === 'rumor' ? '据说发生过此事。' : '记得似乎发生过此事。',
        source: kind === 'rumor' ? 'rumor' : 'witness',
        distorted: kind === 'distorted',
        lifecycle: 'active',
      });
      return eventId;
    };
    return {
      worldId: status.worldId,
      rumorEventId: await create('rumor'),
      distortedEventId: await create('distorted'),
    };
  },
});

export const primeBeliefClarificationEvidence = mutation({
  args: {
    subjectClaimId: v.string(),
    verdict: v.union(v.literal('confirm'), v.literal('refute'), v.literal('uncertain')),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeBeliefClarificationEvidence');
    if (!args.subjectClaimId.includes('c016e2')) {
      throw new Error('C016e2 evidence fixture claim is outside its boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const claim = await ctx.db
      .query('socialClaims')
      .withIndex('byClaim', (q) =>
        q.eq('worldId', status.worldId).eq('claimId', args.subjectClaimId),
      )
      .first();
    if (!claim?.topicId || !claim.subjectActorIds?.length) {
      throw new Error('C016e2 evidence fixture requires a versioned root claim.');
    }
    const now = Date.now();
    const sourceEventId = await ctx.db.insert('worldEvents', {
      worldId: status.worldId,
      type: `c016e2_evidence_${args.verdict}`,
      createdAt: now,
      actorIds: claim.subjectActorIds,
      locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
      visibility: 'public',
      summary: `规则层登记了一条${args.verdict}该主张的可核验记录。`,
      facts: versionDurableEventFacts({ resultCode: `c016e2_evidence_${args.verdict}` }),
      mapId: SYSTEM_LAB_MAP_ID,
    });
    const first = await registerBeliefEvidence(ctx, {
      worldId: status.worldId,
      subjectClaimId: args.subjectClaimId,
      topicId: claim.topicId,
      subjectActorIds: claim.subjectActorIds,
      sourceEventId,
      verdict: args.verdict,
      now,
    });
    const replay = await registerBeliefEvidence(ctx, {
      worldId: status.worldId,
      subjectClaimId: args.subjectClaimId,
      topicId: claim.topicId,
      subjectActorIds: claim.subjectActorIds,
      sourceEventId,
      verdict: args.verdict,
      now: now + 1,
    });
    return {
      worldId: status.worldId,
      sourceEventId,
      evidenceId: first.evidenceId,
      idempotentReplay: first._id === replay._id,
      topicId: first.topicId,
      subjectActorIds: first.subjectActorIds,
      verdict: first.verdict,
    };
  },
});

export const inspectConversationLab = query({
  args: {
    conversationId: v.string(),
    actorIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectConversationLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const session = await ctx.db
      .query('conversationSessions')
      .withIndex('byConversation', (q) =>
        q.eq('worldId', status.worldId).eq('conversationId', args.conversationId),
      )
      .first();
    const turns = await ctx.db
      .query('conversationUtterances')
      .withIndex('byConversationTurn', (q) =>
        q.eq('worldId', status.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    const claims = await ctx.db
      .query('socialClaims')
      .withIndex('byConversation', (q) =>
        q.eq('worldId', status.worldId).eq('conversationId', args.conversationId),
      )
      .collect();
    const beliefs = (
      await Promise.all(
        args.actorIds.map((actorId) =>
          ctx.db
            .query('actorBeliefs')
            .withIndex('byActor', (q) =>
              q.eq('worldId', status.worldId).eq('actorId', actorId),
            )
            .collect(),
        ),
      )
    ).flat();
    const actionIds = new Set(turns.map((turn) => String(turn.actionRecordId)));
    const events = (
      await ctx.db
        .query('worldEvents')
        .withIndex('byMap', (q) =>
          q.eq('worldId', status.worldId).eq('mapId', SYSTEM_LAB_MAP_ID),
        )
        .order('desc')
        .take(200)
    ).filter(
      (event) =>
        actionIds.has(String(event.actionId)) ||
        (event.facts as { conversationId?: string } | undefined)?.conversationId ===
          args.conversationId,
    );
    const relationships = (
      await Promise.all(
        args.actorIds.map((actorId) =>
          ctx.db
            .query('relationships')
            .withIndex('from', (q) =>
              q.eq('worldId', status.worldId).eq('fromActorId', actorId),
            )
            .collect(),
        ),
      )
    )
      .flat()
      .filter((relationship) => args.actorIds.includes(relationship.toActorId));
    const subjectClaimIds = new Set(claims.map((claim) => claim.subjectClaimId ?? claim.claimId));
    const evidence = (await ctx.db.query('beliefEvidence').collect()).filter(
      (row) => row.worldId === status.worldId && subjectClaimIds.has(row.subjectClaimId),
    );
    const beliefSeriesIds = new Set(
      beliefs.map((belief) =>
        belief.beliefSeriesId ??
        `belief-series:${belief.subjectClaimId ?? belief.sourceClaimId}:${belief.actorId}`,
      ),
    );
    const evidenceApplications = (await ctx.db.query('beliefEvidenceApplications').collect()).filter(
      (row) => row.worldId === status.worldId && beliefSeriesIds.has(row.beliefSeriesId),
    );
    const modelCalls = (
      await Promise.all(args.actorIds.map((actorId) =>
        ctx.db
          .query('socialModelCalls')
          .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
          .collect(),
      ))
    ).flat();
    return {
      session,
      turns,
      claims,
      beliefs,
      evidence,
      evidenceApplications,
      modelCalls,
      events,
      relationships,
    };
  },
});

export const primeGroupConversationLab = mutation({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGroupConversationLab');
    if (
      args.actorIds.length !== 5 ||
      new Set(args.actorIds).size !== 5 ||
      args.actorIds.some((actorId) => !actorId.startsWith('godot_smoke_c014_'))
    ) {
      throw new Error('C014a fixture requires five unique godot_smoke_c014 actors.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const locationId = 'system_lab_group_circle';
    const tile = { x: 80, y: 10 };
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', locationId),
      )
      .first();
    const locationPatch = {
      name: '灰盒群议圆场',
      kind: 'group_conversation_circle',
      dangerLevel: 0,
      spiritualEnergy: 1,
      // The commitment causality fixture settles its agreed transfer via the
      // ordinary gift action after the group terminal, so this isolated lab
      // must expose that capability as well as the group actions.
      allowedActions: ['talk', 'group_talk', 'group_decide', 'gift', 'rest'],
      mapId: SYSTEM_LAB_MAP_ID,
      entryPoints: [tile],
      bounds: { x1: 76, y1: 6, x2: 84, y2: 14 },
      description: 'C014a 服务端发言权、旁听知识和终态灰盒。',
    };
    if (location) await ctx.db.patch(location._id, locationPatch);
    else await ctx.db.insert('locations', { worldId: status.worldId, locationId, ...locationPatch });
    const tiles = [
      { x: 79, y: 9 },
      { x: 81, y: 9 },
      { x: 79, y: 11 },
      { x: 81, y: 11 },
      { x: 80, y: 13 },
    ];
    for (let index = 0; index < args.actorIds.length; index += 1) {
      const actorId = args.actorIds[index];
      const name = index === 0 ? '群议发起者' : index === 4 ? '群议旁听者' : `群议弟子${index}`;
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      const profilePatch = {
        name,
        role: index === 4 ? 'guard' : 'social_disciple',
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: index === 4 ? '义气' : '名声',
        cultivationXp: 0,
        mood: 0,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 5,
        reputation: 0,
        inventory: index === 0 ? [{ itemId: 'spirit_herb', qty: 2 }] : [],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: locationId,
        currentIntent: '参加 C014a 群体关系灰盒。',
        persona: '只在服务端授予发言权后陈述，不创造世界事实。',
      };
      if (profile) await ctx.db.patch(profile._id, profilePatch);
      else await ctx.db.insert('xianxiaProfiles', { worldId: status.worldId, actorId, ...profilePatch });
      const resident = await ctx.db
        .query('qinglanResidents')
        .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      const residentPatch = {
        residentId: `system-lab-group-${actorId}`,
        name,
        role: profilePatch.role,
        character: index === 4 ? 'm4' : 'm3',
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: locationId,
        displayTile: tiles[index],
        orientation: 0,
        status: 'waiting' as const,
        currentIntent: '等待群议发言权。',
        activityLabel: 'C014a 群议',
        updatedAt: now,
      };
      if (resident) await ctx.db.patch(resident._id, residentPatch);
      else await ctx.db.insert('qinglanResidents', { worldId: status.worldId, actorId, ...residentPatch });
    }
    return {
      worldId: status.worldId,
      mapId: SYSTEM_LAB_MAP_ID,
      locationId,
      tile,
      actors: args.actorIds.map((actorId, index) => ({ actorId, tile: tiles[index] })),
    };
  },
});

export const primeGroupCausalHistoryFixture = mutation({
  args: {
    actorIds: v.array(v.string()),
    voterActorId: v.string(),
    recipientActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGroupCausalHistoryFixture');
    const uniqueActors = new Set(args.actorIds);
    if (
      args.actorIds.length !== 5 ||
      uniqueActors.size !== 5 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D1_CAUSAL_HISTORY_PREFIX)) ||
      !uniqueActors.has(args.voterActorId) ||
      !uniqueActors.has(args.recipientActorId) ||
      args.voterActorId === args.recipientActorId
    ) {
      throw new Error('C016d1 fixture requires five bounded actors and a distinct voter/recipient pair.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    for (const actorId of args.actorIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      if (
        !profile ||
        profile.mapId !== SYSTEM_LAB_MAP_ID ||
        profile.currentLocationId !== 'system_lab_group_circle'
      ) {
        throw new Error('C016d1 fixture actors must be primed in the group circle first.');
      }
    }
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, status.worldId, now);
    const sourceGameDay = Math.floor(nowGameHour / 24);
    const fixtureId = `c016d1_history:${args.voterActorId}:${args.recipientActorId}`;
    const eventId = await ctx.db.insert('worldEvents', {
      worldId: status.worldId,
      type: 'combatant_defeated',
      createdAt: now,
      actorIds: [args.recipientActorId],
      targetActorIds: [args.voterActorId],
      locationId: 'system_lab_group_circle',
      visibility: 'private',
      summary: '受赠者过去曾在冲突中击倒关键投票者。',
      facts: versionDurableEventFacts({
        fixtureId,
        source: 'restricted_test_fixture',
      }),
      mapId: SYSTEM_LAB_MAP_ID,
    });
    const event = (await ctx.db.get(eventId))!;
    const first = await applyRelationshipEvent(
      ctx,
      status.worldId,
      args.voterActorId,
      args.recipientActorId,
      { affinity: -18, suspicion: 20, fear: 15 },
      eventId,
      'assault',
      sourceGameDay,
      now,
    );
    const replay = await applyRelationshipEvent(
      ctx,
      status.worldId,
      args.voterActorId,
      args.recipientActorId,
      { affinity: -18, suspicion: 20, fear: 15 },
      eventId,
      'assault',
      sourceGameDay,
      now + 1,
    );
    await generateMemories(ctx, status.worldId, {
      eventId,
      type: event.type,
      visibility: event.visibility,
      actorIds: event.actorIds,
      targetActorIds: event.targetActorIds,
      witnessActorIds: event.witnessActorIds,
      locationId: event.locationId,
      summary: event.summary,
      createdAt: event.createdAt,
    }, nowGameHour);
    return {
      worldId: status.worldId,
      eventId,
      fixtureId,
      firstChangeId: first.changeId,
      replayChangeId: replay.changeId,
      sourceGameDay,
    };
  },
});

export const inspectGroupCausalHistoryFixture = query({
  args: {
    eventId: v.id('worldEvents'),
    actorIds: v.array(v.string()),
    voterActorId: v.string(),
    recipientActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGroupCausalHistoryFixture');
    const uniqueActors = new Set(args.actorIds);
    if (
      args.actorIds.length !== 5 ||
      uniqueActors.size !== 5 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D1_CAUSAL_HISTORY_PREFIX)) ||
      !uniqueActors.has(args.voterActorId) ||
      !uniqueActors.has(args.recipientActorId) ||
      args.voterActorId === args.recipientActorId
    ) {
      throw new Error('C016d1 inspect is outside its fixture boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [event, relationship, changes, memories] = await Promise.all([
      ctx.db.get(args.eventId),
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('fromActorId', args.voterActorId)
            .eq('toActorId', args.recipientActorId),
        )
        .first(),
      ctx.db
        .query('relationshipChanges')
        .withIndex('bySourceEvent', (q) =>
          q.eq('worldId', status.worldId).eq('sourceEventId', String(args.eventId)),
        )
        .collect(),
      ctx.db
        .query('shortMemories')
        .withIndex('bySourceEvent', (q) =>
          q.eq('worldId', status.worldId).eq('sourceEventId', String(args.eventId)),
        )
        .collect(),
    ]);
    const eventFacts = event?.facts as { fixtureId?: string; source?: string } | undefined;
    if (
      !event ||
      event.worldId !== status.worldId ||
      event.type !== 'combatant_defeated' ||
      event.visibility !== 'private' ||
      event.actorIds.length !== 1 ||
      event.actorIds[0] !== args.recipientActorId ||
      event.targetActorIds?.length !== 1 ||
      event.targetActorIds[0] !== args.voterActorId ||
      eventFacts?.source !== 'restricted_test_fixture' ||
      !eventFacts.fixtureId?.startsWith('c016d1_history:')
    ) {
      throw new Error('C016d1 history source is missing or mismatched.');
    }
    return {
      event: {
        eventId: String(event._id),
        type: event.type,
        actorIds: event.actorIds,
        targetActorIds: event.targetActorIds ?? [],
        visibility: event.visibility,
        facts: event.facts,
      },
      relationship: relationship
        ? {
            fromActorId: relationship.fromActorId,
            toActorId: relationship.toActorId,
            affinity: relationship.value,
            trust: relationship.trust ?? 0,
            suspicion: relationship.suspicion ?? 0,
            debt: relationship.debt ?? 0,
            fear: relationship.fear ?? 0,
            lastChangedByEventId: relationship.lastChangedByEventId,
          }
        : null,
      changes: changes.map((change) => ({
        changeId: change.changeId,
        sourceEventId: change.sourceEventId,
        fromActorId: change.fromActorId,
        toActorId: change.toActorId,
        effectKind: change.effectKind,
        status: change.status,
        appliedDelta: change.appliedDelta,
      })),
      memories: args.actorIds.map((actorId) => ({
        actorId,
        rows: memories
          .filter((memory) => memory.actorId === actorId)
          .map((memory) => ({
            sourceEventId: memory.sourceEventId,
            source: memory.source,
            distorted: memory.distorted ?? false,
            lifecycle: memory.lifecycle ?? 'active',
          })),
      })),
    };
  },
});

function assertC016d4SupportActors(
  actorIds: string[],
  voterActorId: string,
  recipientActorId: string,
) {
  const uniqueActors = new Set(actorIds);
  if (
    actorIds.length !== 5 ||
    uniqueActors.size !== 5 ||
    actorIds.some((actorId) => !actorId.startsWith(C016D4_SUPPORT_HISTORY_PREFIX)) ||
    !uniqueActors.has(voterActorId) ||
    !uniqueActors.has(recipientActorId) ||
    voterActorId === recipientActorId
  ) {
    throw new Error('C016d4 fixture requires five bounded actors and a distinct voter/recipient pair.');
  }
}

export const primeGroupSupportiveHistoryFixture = mutation({
  args: {
    actorIds: v.array(v.string()),
    voterActorId: v.string(),
    recipientActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGroupSupportiveHistoryFixture');
    assertC016d4SupportActors(args.actorIds, args.voterActorId, args.recipientActorId);
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    for (const actorId of args.actorIds) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      if (
        !profile ||
        profile.mapId !== SYSTEM_LAB_MAP_ID ||
        profile.currentLocationId !== 'system_lab_group_circle'
      ) {
        throw new Error('C016d4 actors must be primed in the group circle first.');
      }
    }
    const now = Date.now();
    const nowGameHour = await readGameHour(ctx, status.worldId, now);
    const sourceGameDay = Math.floor(nowGameHour / 24);
    const fixtureId = `c016d4_fulfilled_request:${args.voterActorId}:${args.recipientActorId}`;
    const eventId = await ctx.db.insert('worldEvents', {
      worldId: status.worldId,
      type: 'request_resolved',
      createdAt: now,
      actorIds: [args.recipientActorId],
      targetActorIds: [args.voterActorId],
      locationId: 'system_lab_group_circle',
      visibility: 'private',
      summary: '受赠者过去曾完成关键投票者发布的一桩委托。',
      facts: versionDurableEventFacts({
        fixtureId,
        source: 'restricted_test_fixture',
        resultCode: 'request_completed',
      }),
      mapId: SYSTEM_LAB_MAP_ID,
    });
    const event = (await ctx.db.get(eventId))!;
    const first = await applyRelationshipEvent(
      ctx,
      status.worldId,
      args.voterActorId,
      args.recipientActorId,
      { trust: 5, debt: 5 },
      eventId,
      'quest_completion',
      sourceGameDay,
      now,
    );
    const replay = await applyRelationshipEvent(
      ctx,
      status.worldId,
      args.voterActorId,
      args.recipientActorId,
      { trust: 5, debt: 5 },
      eventId,
      'quest_completion',
      sourceGameDay,
      now + 1,
    );
    await generateMemories(ctx, status.worldId, {
      eventId,
      type: event.type,
      visibility: event.visibility,
      actorIds: event.actorIds,
      targetActorIds: event.targetActorIds,
      witnessActorIds: event.witnessActorIds,
      locationId: event.locationId,
      summary: event.summary,
      createdAt: event.createdAt,
    }, nowGameHour);
    return {
      worldId: status.worldId,
      eventId,
      fixtureId,
      firstChangeId: first.changeId,
      replayChangeId: replay.changeId,
      sourceGameDay,
    };
  },
});

export const inspectGroupSupportiveHistoryFixture = query({
  args: {
    eventId: v.id('worldEvents'),
    actorIds: v.array(v.string()),
    voterActorId: v.string(),
    recipientActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGroupSupportiveHistoryFixture');
    assertC016d4SupportActors(args.actorIds, args.voterActorId, args.recipientActorId);
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [event, relationship, changes, memories] = await Promise.all([
      ctx.db.get(args.eventId),
      ctx.db.query('relationships').withIndex('pair', (q) =>
        q
          .eq('worldId', status.worldId)
          .eq('fromActorId', args.voterActorId)
          .eq('toActorId', args.recipientActorId),
      ).first(),
      ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) =>
        q.eq('worldId', status.worldId).eq('sourceEventId', String(args.eventId)),
      ).collect(),
      ctx.db.query('shortMemories').withIndex('bySourceEvent', (q) =>
        q.eq('worldId', status.worldId).eq('sourceEventId', String(args.eventId)),
      ).collect(),
    ]);
    const facts = event?.facts as {
      fixtureId?: string;
      source?: string;
      resultCode?: string;
    } | undefined;
    if (
      !event ||
      event.worldId !== status.worldId ||
      event.type !== 'request_resolved' ||
      event.visibility !== 'private' ||
      event.actorIds.length !== 1 ||
      event.actorIds[0] !== args.recipientActorId ||
      event.targetActorIds?.length !== 1 ||
      event.targetActorIds[0] !== args.voterActorId ||
      facts?.source !== 'restricted_test_fixture' ||
      facts.resultCode !== 'request_completed' ||
      !facts.fixtureId?.startsWith('c016d4_fulfilled_request:')
    ) {
      throw new Error('C016d4 fulfilled-request source is missing or mismatched.');
    }
    return {
      event: {
        eventId: String(event._id),
        type: event.type,
        actorIds: event.actorIds,
        targetActorIds: event.targetActorIds ?? [],
        visibility: event.visibility,
        facts: event.facts,
      },
      relationship: relationship
        ? {
            fromActorId: relationship.fromActorId,
            toActorId: relationship.toActorId,
            affinity: relationship.value,
            trust: relationship.trust ?? 0,
            suspicion: relationship.suspicion ?? 0,
            debt: relationship.debt ?? 0,
            fear: relationship.fear ?? 0,
            lastChangedByEventId: relationship.lastChangedByEventId,
          }
        : null,
      changes: changes.map((change) => ({
        changeId: change.changeId,
        sourceEventId: change.sourceEventId,
        fromActorId: change.fromActorId,
        toActorId: change.toActorId,
        effectKind: change.effectKind,
        status: change.status,
        appliedDelta: change.appliedDelta,
      })),
      memories: args.actorIds.map((actorId) => ({
        actorId,
        rows: memories
          .filter((memory) => memory.actorId === actorId)
          .map((memory) => ({
            sourceEventId: memory.sourceEventId,
            source: memory.source,
            distorted: memory.distorted ?? false,
            lifecycle: memory.lifecycle ?? 'active',
          })),
      })),
    };
  },
});

export const primeMemoryDeliveryReplayFixture = mutation({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeMemoryDeliveryReplayFixture');
    if (
      args.actorIds.length !== 3 ||
      new Set(args.actorIds).size !== 3 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D2_MEMORY_REPLAY_PREFIX))
    ) {
      throw new Error('C016d2 fixture requires three unique bounded actors.');
    }
    const worldId = await ctx.db.insert('worlds', {
      nextId: 0,
      agents: [],
      conversations: [],
      players: [],
    });
    for (let index = 0; index < args.actorIds.length; index += 1) {
      await ctx.db.insert('xianxiaProfiles', {
        worldId,
        actorId: args.actorIds[index],
        name: index === 0 ? '记忆当事人甲' : index === 1 ? '记忆当事人乙' : '无关旁观者',
        role: 'social_disciple',
        realm: 'qi_refining',
        realmStage: 2,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 0,
        mood: 0,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 5,
        reputation: 0,
        inventory: [],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: 'system_lab_private_room',
        currentIntent: 'C016d2 isolated memory delivery replay fixture.',
        persona: '只拥有自己收到且有来源的记忆。',
      });
    }
    const now = Date.now();
    const eventId = await ctx.db.insert('worldEvents', {
      worldId,
      type: 'gift_given',
      createdAt: now,
      actorIds: [args.actorIds[0]],
      targetActorIds: [args.actorIds[1]],
      locationId: 'system_lab_private_room',
      visibility: 'private',
      summary: '甲曾私下赠予乙一份小礼。',
      facts: versionDurableEventFacts({
        fixtureId: `c016d2_memory_replay:${args.actorIds[0]}:${args.actorIds[1]}`,
        source: 'restricted_test_fixture',
      }),
      mapId: SYSTEM_LAB_MAP_ID,
    });
    const event = (await ctx.db.get(eventId))!;
    const memoryInput = {
      eventId,
      type: event.type,
      visibility: event.visibility,
      actorIds: event.actorIds,
      targetActorIds: event.targetActorIds,
      witnessActorIds: event.witnessActorIds,
      locationId: event.locationId,
      summary: event.summary,
      createdAt: event.createdAt,
    };
    await generateMemories(ctx, worldId, memoryInput, 100);
    await generateMemories(ctx, worldId, memoryInput, 100);
    return { worldId, eventId, actorIds: args.actorIds };
  },
});

export const replayMemoryDeliveryFixture = mutation({
  args: { worldId: v.id('worlds'), eventId: v.id('worldEvents'), actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.replayMemoryDeliveryFixture');
    if (
      args.actorIds.length !== 3 ||
      new Set(args.actorIds).size !== 3 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D2_MEMORY_REPLAY_PREFIX))
    ) {
      throw new Error('C016d2 replay is outside its fixture boundary.');
    }
    const event = await ctx.db.get(args.eventId);
    const facts = event?.facts as { fixtureId?: string; source?: string } | undefined;
    if (
      !event ||
      event.worldId !== args.worldId ||
      event.type !== 'gift_given' ||
      event.visibility !== 'private' ||
      event.actorIds.length !== 1 ||
      event.actorIds[0] !== args.actorIds[0] ||
      event.targetActorIds?.length !== 1 ||
      event.targetActorIds[0] !== args.actorIds[1] ||
      facts?.source !== 'restricted_test_fixture' ||
      !facts.fixtureId?.startsWith('c016d2_memory_replay:')
    ) {
      throw new Error('C016d2 replay source is missing or mismatched.');
    }
    await generateMemories(ctx, args.worldId, {
      eventId: event._id,
      type: event.type,
      visibility: event.visibility,
      actorIds: event.actorIds,
      targetActorIds: event.targetActorIds,
      witnessActorIds: event.witnessActorIds,
      locationId: event.locationId,
      summary: event.summary,
      createdAt: event.createdAt,
    }, 100);
    return { replayed: true, eventId: String(event._id) };
  },
});

export const inspectMemoryDeliveryReplayFixture = query({
  args: { worldId: v.id('worlds'), eventId: v.id('worldEvents'), actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectMemoryDeliveryReplayFixture');
    if (
      args.actorIds.length !== 3 ||
      new Set(args.actorIds).size !== 3 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D2_MEMORY_REPLAY_PREFIX))
    ) {
      throw new Error('C016d2 inspect is outside its fixture boundary.');
    }
    const [world, event, memories, events, modelCalls] = await Promise.all([
      ctx.db.get(args.worldId),
      ctx.db.get(args.eventId),
      ctx.db
        .query('shortMemories')
        .withIndex('bySourceEvent', (q) =>
          q.eq('worldId', args.worldId).eq('sourceEventId', String(args.eventId)),
        )
        .collect(),
      ctx.db
        .query('worldEvents')
        .withIndex('worldId', (q) => q.eq('worldId', args.worldId))
        .collect(),
      Promise.all(args.actorIds.map((actorId) =>
        ctx.db.query('socialModelCalls').withIndex('byActor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', actorId),
        ).collect(),
      )),
    ]);
    if (!world || !event || event.worldId !== args.worldId) {
      throw new Error('C016d2 fixture world or event is missing.');
    }
    return {
      eventCount: events.length,
      memories: args.actorIds.map((actorId) => ({
        actorId,
        rows: memories.filter((memory) => memory.actorId === actorId).map((memory) => ({
          sourceEventId: memory.sourceEventId,
          source: memory.source,
          distorted: memory.distorted ?? false,
          lifecycle: memory.lifecycle ?? 'active',
          summary: memory.summary,
        })),
      })),
      totalMemories: memories.length,
      modelCalls: modelCalls.flat().length,
    };
  },
});

export const cleanupMemoryDeliveryReplayFixture = mutation({
  args: { worldId: v.id('worlds'), eventId: v.id('worldEvents'), actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupMemoryDeliveryReplayFixture');
    if (
      args.actorIds.length !== 3 ||
      new Set(args.actorIds).size !== 3 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D2_MEMORY_REPLAY_PREFIX))
    ) {
      throw new Error('C016d2 cleanup is outside its fixture boundary.');
    }
    let deleted = 0;
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('bySourceEvent', (q) =>
        q.eq('worldId', args.worldId).eq('sourceEventId', String(args.eventId)),
      )
      .collect();
    for (const memory of memories) {
      await ctx.db.delete(memory._id);
      deleted += 1;
    }
    for (const actorId of args.actorIds) {
      const [profile, state, summaries] = await Promise.all([
        ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', actorId),
        ).first(),
        ctx.db.query('memoryCompactionStates').withIndex('byActor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', actorId),
        ).first(),
        ctx.db.query('socialMemorySummaries').withIndex('byActorUpdated', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', actorId),
        ).collect(),
      ]);
      if (profile) await ctx.db.delete(profile._id);
      if (state) await ctx.db.delete(state._id);
      for (const summary of summaries) await ctx.db.delete(summary._id);
    }
    const job = await ctx.db.query('memoryFanoutJobs').withIndex('byEvent', (q) =>
      q.eq('worldId', args.worldId).eq('eventId', args.eventId),
    ).first();
    if (job) await ctx.db.delete(job._id);
    const event = await ctx.db.get(args.eventId);
    if (event?.worldId === args.worldId) await ctx.db.delete(event._id);
    const world = await ctx.db.get(args.worldId);
    if (world) await ctx.db.delete(world._id);
    return { deletedMemories: deleted, cleaned: true };
  },
});

function assertC016d3FixtureActors(
  actorIds: string[],
  memoryActorId: string,
  subjectActorId: string,
) {
  const actorSet = new Set(actorIds);
  if (
    actorIds.length !== 5 ||
    actorSet.size !== 5 ||
    actorIds.some((actorId) => !actorId.startsWith(C016D3_GROUP_ACTOR_PREFIX)) ||
    !actorSet.has(memoryActorId) ||
    !actorSet.has(subjectActorId) ||
    memoryActorId === subjectActorId
  ) {
    throw new Error('C016d3 fixture requires five bounded actors and distinct memory owner/subject.');
  }
}

export const primeGroupUnrelatedMemoryFixture = mutation({
  args: {
    worldId: v.id('worlds'),
    groupConversationId: v.string(),
    actorIds: v.array(v.string()),
    memoryActorId: v.string(),
    subjectActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGroupUnrelatedMemoryFixture');
    assertC016d3FixtureActors(args.actorIds, args.memoryActorId, args.subjectActorId);
    const session = await ctx.db
      .query('groupConversationSessions')
      .withIndex('byGroupConversation', (q) =>
        q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId),
      )
      .first();
    if (
      !session ||
      session.status !== 'active' ||
      !session.participantActorIds.includes(args.memoryActorId) ||
      !session.observerActorIds.includes(args.subjectActorId) ||
      new Set([...session.participantActorIds, ...session.observerActorIds]).size !== 5 ||
      args.actorIds.some((actorId) =>
        !session.participantActorIds.includes(actorId) && !session.observerActorIds.includes(actorId),
      )
    ) {
      throw new Error('C016d3 memories must be attached to one participant and the group observer.');
    }
    const profiles = await Promise.all(args.actorIds.map((actorId) =>
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', actorId),
      ).first(),
    ));
    if (profiles.some((profile) =>
      !profile || profile.mapId !== session.mapId || profile.currentLocationId !== session.locationId,
    )) {
      throw new Error('C016d3 actors must remain together in the active group scene.');
    }

    const now = Date.now();
    const oldMemoryBase = now - 1_000_000;
    const eventIds: Id<'worldEvents'>[] = [];
    for (let index = 0; index < 30; index += 1) {
      const type = `${C016D3_MEMORY_TYPE_PREFIX}${String(index).padStart(2, '0')}`;
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: args.worldId,
        type,
        createdAt: oldMemoryBase + index,
        actorIds: [args.memoryActorId],
        targetActorIds: [args.subjectActorId],
        locationId: session.locationId,
        visibility: 'private',
        summary: `关键投票者与旁听者过去的一段无关经历 ${index}`,
        facts: versionDurableEventFacts({
          fixtureId: `c016d3_unrelated_memory:${args.groupConversationId}:${index}`,
          source: 'restricted_test_fixture',
        }),
        mapId: session.mapId,
      });
      eventIds.push(eventId);
      for (const actorId of [args.memoryActorId, args.subjectActorId]) {
        await ctx.db.insert('shortMemories', {
          worldId: args.worldId,
          actorId,
          sourceEventId: String(eventId),
          aboutActorIds: [actorId === args.memoryActorId ? args.subjectActorId : args.memoryActorId],
          type,
          salience: 1,
          createdAt: oldMemoryBase + index,
          expiresAt: 1_000_000_000,
          summary: `与当前灵草提案无关的旧经历 ${index}`,
          source: 'direct',
          distorted: false,
          lifecycle: 'active',
        });
      }
    }
    return {
      worldId: args.worldId,
      groupConversationId: args.groupConversationId,
      memoryActorId: args.memoryActorId,
      subjectActorId: args.subjectActorId,
      eventIds,
      memoriesSeededPerPrincipal: 30,
    };
  },
});

export const compactGroupUnrelatedMemoryFixture = mutation({
  args: {
    worldId: v.id('worlds'),
    actorIds: v.array(v.string()),
    memoryActorId: v.string(),
    subjectActorId: v.string(),
    nowGameHour: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.compactGroupUnrelatedMemoryFixture');
    assertC016d3FixtureActors(args.actorIds, args.memoryActorId, args.subjectActorId);
    const owner = await compactActorMemoriesInMutation(
      ctx,
      args.worldId,
      args.memoryActorId,
      args.nowGameHour,
    );
    const subject = await compactActorMemoriesInMutation(
      ctx,
      args.worldId,
      args.subjectActorId,
      args.nowGameHour,
    );
    return { owner, subject };
  },
});

export const inspectGroupUnrelatedMemoryFixture = query({
  args: {
    worldId: v.id('worlds'),
    groupConversationId: v.string(),
    eventIds: v.array(v.id('worldEvents')),
    actorIds: v.array(v.string()),
    memoryActorId: v.string(),
    subjectActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGroupUnrelatedMemoryFixture');
    assertC016d3FixtureActors(args.actorIds, args.memoryActorId, args.subjectActorId);
    if (args.eventIds.length !== 30 || new Set(args.eventIds.map(String)).size !== 30) {
      throw new Error('C016d3 inspect requires the exact 30 source events.');
    }
    const eventIdSet = new Set(args.eventIds.map(String));
    const [events, memoriesByEvent, summariesByActor, relationships, profiles, proposals, modelCalls] =
      await Promise.all([
        Promise.all(args.eventIds.map((eventId) => ctx.db.get(eventId))),
        Promise.all(args.eventIds.map((eventId) =>
          ctx.db.query('shortMemories').withIndex('bySourceEvent', (q) =>
            q.eq('worldId', args.worldId).eq('sourceEventId', String(eventId)),
          ).collect(),
        )),
        Promise.all([args.memoryActorId, args.subjectActorId].map((actorId) =>
          ctx.db.query('socialMemorySummaries').withIndex('byActorUpdated', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', actorId),
          ).collect(),
        )),
        ctx.db.query('relationships').withIndex('from', (q) =>
          q.eq('worldId', args.worldId).eq('fromActorId', args.memoryActorId),
        ).collect(),
        Promise.all(args.actorIds.map((actorId) =>
          ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', actorId),
          ).first(),
        )),
        ctx.db.query('groupProposals').withIndex('byGroupStatus', (q) =>
          q.eq('worldId', args.worldId).eq('groupConversationId', args.groupConversationId),
        ).collect(),
        Promise.all(args.actorIds.map((actorId) =>
          ctx.db.query('socialModelCalls').withIndex('byActor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', actorId),
          ).collect(),
        )),
      ]);
    const memories = memoriesByEvent.flat();
    const summaries = summariesByActor.flat().filter((summary) =>
      summary.sourceEventIds.some((eventId) => eventIdSet.has(eventId)),
    );
    return {
      sourceEvents: events.filter(Boolean).map((event) => ({
        eventId: String(event!._id),
        type: event!.type,
        actorIds: event!.actorIds,
        targetActorIds: event!.targetActorIds ?? [],
        visibility: event!.visibility,
      })),
      principals: [args.memoryActorId, args.subjectActorId].map((actorId) => {
        const rows = memories.filter((memory) => memory.actorId === actorId);
        return {
          actorId,
          active: rows.filter((memory) => memory.lifecycle !== 'archived').length,
          archived: rows.filter((memory) => memory.lifecycle === 'archived').length,
          sourceEventIds: rows.map((memory) => memory.sourceEventId).sort(),
          provenanceValid: rows.every((memory) =>
            memory.source === 'direct' &&
            memory.distorted !== true &&
            eventIdSet.has(memory.sourceEventId),
          ),
        };
      }),
      summaries: summaries.map((summary) => ({
        actorId: summary.actorId,
        subjectActorId: summary.subjectActorId,
        memoryCount: summary.memoryCount,
        sourceEventIds: summary.sourceEventIds,
        revision: summary.revision,
      })),
      relationships: relationships
        .filter((relationship) => args.actorIds.includes(relationship.toActorId))
        .map((relationship) => ({
          toActorId: relationship.toActorId,
          value: relationship.value,
          trust: relationship.trust ?? 0,
          suspicion: relationship.suspicion ?? 0,
          debt: relationship.debt ?? 0,
          fear: relationship.fear ?? 0,
          lastChangedByEventId: relationship.lastChangedByEventId,
        })),
      inventories: profiles.map((profile, index) => ({
        actorId: args.actorIds[index],
        inventory: profile?.inventory ?? [],
      })),
      proposals: proposals.map((proposal) => ({
        proposalId: proposal.proposalId,
        status: proposal.status,
        donorActorId: proposal.donorActorId,
        recipientActorId: proposal.recipientActorId,
        approvals: proposal.approvals,
        oppositions: proposal.oppositions,
        abstentions: proposal.abstentions,
      })),
      providerCalls: modelCalls.flat().length,
    };
  },
});

type C016d3GroupDecisionPlanProbe = {
  proposal: ReturnType<typeof planGroupDecisionIntent>;
  observation: null | {
    recentEvents: string[];
    socialSummaries: string[];
    availableActions: AgentContext['availableActions'];
    groupConversationId?: string;
    openProposal?: {
      proposalId: string;
      proposerActorId: string;
      donorActorId: string;
      recipientActorId: string;
      hasVoted: boolean;
    };
    relationshipToRecipient: number | null;
  };
};

export const inspectGroupDecisionRulePlan = action({
  args: { worldId: v.id('worlds'), actorId: v.string() },
  handler: async (ctx, args): Promise<C016d3GroupDecisionPlanProbe> => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGroupDecisionRulePlan');
    if (!args.actorId.startsWith(C016D3_GROUP_ACTOR_PREFIX)) {
      throw new Error('C016d3 planner probe is outside its fixture boundary.');
    }
    const context: AgentContext | null = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: args.worldId,
      actorId: args.actorId,
      now: Date.now(),
    });
    if (!context) return { proposal: null, observation: null };
    const open = context.activeGroupDecision?.openProposal;
    return {
      proposal: planGroupDecisionIntent(context),
      observation: {
        recentEvents: context.recentEvents,
        socialSummaries: context.socialSummaries ?? [],
        availableActions: context.availableActions,
        groupConversationId: context.activeGroupConversation?.groupConversationId,
        openProposal: open,
        relationshipToRecipient: open
          ? context.others.find((other) => other.actorId === open.recipientActorId)?.relationship ?? 0
          : null,
      },
    };
  },
});

export const cleanupGroupUnrelatedMemoryFixture = mutation({
  args: {
    worldId: v.id('worlds'),
    eventIds: v.array(v.id('worldEvents')),
    actorIds: v.array(v.string()),
    memoryActorId: v.string(),
    subjectActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupGroupUnrelatedMemoryFixture');
    assertC016d3FixtureActors(args.actorIds, args.memoryActorId, args.subjectActorId);
    if (args.eventIds.length !== 30) throw new Error('C016d3 cleanup source set is incomplete.');
    const eventIdSet = new Set(args.eventIds.map(String));
    let memoriesDeleted = 0;
    for (const eventId of args.eventIds) {
      const memories = await ctx.db.query('shortMemories').withIndex('bySourceEvent', (q) =>
        q.eq('worldId', args.worldId).eq('sourceEventId', String(eventId)),
      ).collect();
      for (const memory of memories) {
        if (![args.memoryActorId, args.subjectActorId].includes(memory.actorId)) continue;
        await ctx.db.delete(memory._id);
        memoriesDeleted += 1;
      }
    }
    let summariesDeleted = 0;
    for (const actorId of [args.memoryActorId, args.subjectActorId]) {
      const [summaries, state] = await Promise.all([
        ctx.db.query('socialMemorySummaries').withIndex('byActorUpdated', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', actorId),
        ).collect(),
        ctx.db.query('memoryCompactionStates').withIndex('byActor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', actorId),
        ).first(),
      ]);
      for (const summary of summaries) {
        if (!summary.sourceEventIds.some((eventId) => eventIdSet.has(eventId))) continue;
        await ctx.db.delete(summary._id);
        summariesDeleted += 1;
      }
      if (state) await ctx.db.delete(state._id);
    }
    let eventsDeleted = 0;
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      if (event?.worldId !== args.worldId || !event.type.startsWith(C016D3_MEMORY_TYPE_PREFIX)) continue;
      await ctx.db.delete(event._id);
      eventsDeleted += 1;
    }
    return { memoriesDeleted, summariesDeleted, eventsDeleted };
  },
});

export const inspectGroupConversationLab = query({
  args: { groupConversationId: v.string(), actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGroupConversationLab');
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    const session = await ctx.db
      .query('groupConversationSessions')
      .withIndex('byGroupConversation', (q) =>
        q.eq('worldId', status.worldId).eq('groupConversationId', args.groupConversationId),
      )
      .first();
    const memberships = await ctx.db
      .query('groupConversationMemberships')
      .filter((q) => q.eq(q.field('worldId'), status.worldId))
      .filter((q) => q.eq(q.field('groupConversationId'), args.groupConversationId))
      .collect();
    const turns = await ctx.db
      .query('conversationUtterances')
      .withIndex('byConversationTurn', (q) =>
        q.eq('worldId', status.worldId).eq('conversationId', args.groupConversationId),
      )
      .collect();
    const claims = await ctx.db
      .query('socialClaims')
      .withIndex('byConversation', (q) =>
        q.eq('worldId', status.worldId).eq('conversationId', args.groupConversationId),
      )
      .collect();
    const beliefs = (
      await Promise.all(args.actorIds.map((actorId) =>
        ctx.db.query('actorBeliefs').withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        ).collect(),
      ))
    ).flat().filter((belief) =>
      claims.some((claim) => claim.claimId === belief.sourceClaimId),
    );
    const actionIds = new Set(turns.map((turn) => String(turn.actionRecordId)));
    const events = (
      await ctx.db.query('worldEvents').withIndex('byMap', (q) =>
        q.eq('worldId', status.worldId).eq('mapId', SYSTEM_LAB_MAP_ID),
      ).order('desc').take(300)
    ).filter((event) => actionIds.has(String(event.actionId)) ||
      (event.facts as { groupConversationId?: string } | undefined)?.groupConversationId === args.groupConversationId);
    const decisionActionIds = [...new Set(events.map((event) => event.actionId).filter(Boolean))];
    const actions = await Promise.all(
      decisionActionIds.map((actionId) => ctx.db.get(actionId as Id<'actionRecords'>)),
    );
    const modelCalls = (
      await Promise.all(args.actorIds.map((actorId) =>
        ctx.db.query('socialModelCalls').withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        ).collect(),
      ))
    ).flat();
    const relationships = (
      await Promise.all(args.actorIds.map((actorId) =>
        ctx.db.query('relationships').withIndex('from', (q) =>
          q.eq('worldId', status.worldId).eq('fromActorId', actorId),
        ).collect(),
      ))
    ).flat().filter((relationship) => args.actorIds.includes(relationship.toActorId));
    const proposals = await ctx.db.query('groupProposals').withIndex('byGroupStatus', (q) =>
      q.eq('worldId', status.worldId).eq('groupConversationId', args.groupConversationId),
    ).collect();
    const votes = (
      await Promise.all(proposals.map((proposal) => ctx.db.query('groupVotes').withIndex('byProposal', (q) =>
        q.eq('worldId', status.worldId).eq('proposalId', proposal.proposalId),
      ).collect()))
    ).flat();
    const commitments = (
      await Promise.all(proposals.map((proposal) => ctx.db.query('groupCommitments').withIndex('byProposal', (q) =>
        q.eq('worldId', status.worldId).eq('proposalId', proposal.proposalId),
      ).collect()))
    ).flat();
    const inventories = await Promise.all(args.actorIds.map(async (actorId) => {
      const profile = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', actorId),
      ).first();
      return { actorId, inventory: profile?.inventory ?? [] };
    }));
    const memories = await inspectMemoriesForEvents(ctx, status.worldId, events, args.actorIds);
    return { session, memberships, turns, claims, beliefs, events, actions, modelCalls, relationships, proposals, votes, commitments, inventories, memories };
  },
});

export const inspectGroupCommitmentOutcomeFixture = query({
  args: {
    groupConversationId: v.string(),
    eventId: v.id('worldEvents'),
    actorIds: v.array(v.string()),
    donorActorId: v.string(),
    recipientActorId: v.string(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectGroupCommitmentOutcomeFixture');
    const actorSet = new Set(args.actorIds);
    if (
      args.actorIds.length !== 5 ||
      actorSet.size !== 5 ||
      args.actorIds.some((actorId) => !actorId.startsWith(C016D6_COMMITMENT_HISTORY_PREFIX)) ||
      !actorSet.has(args.donorActorId) ||
      !actorSet.has(args.recipientActorId) ||
      args.donorActorId === args.recipientActorId
    ) {
      throw new Error('C016d6 outcome inspect is outside its fixture boundary.');
    }
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    const [event, relationship, changes, memories] = await Promise.all([
      ctx.db.get(args.eventId),
      ctx.db.query('relationships').withIndex('pair', (q) => q
        .eq('worldId', status.worldId)
        .eq('fromActorId', args.recipientActorId)
        .eq('toActorId', args.donorActorId),
      ).first(),
      ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) => q
        .eq('worldId', status.worldId)
        .eq('sourceEventId', String(args.eventId)),
      ).collect(),
      ctx.db.query('shortMemories').withIndex('bySourceEvent', (q) => q
        .eq('worldId', status.worldId)
        .eq('sourceEventId', String(args.eventId)),
      ).collect(),
    ]);
    const facts = event?.facts as {
      groupConversationId?: string;
      commitmentId?: string;
      commitmentStatus?: string;
      reasonCode?: string;
    } | undefined;
    if (
      !event ||
      event.worldId !== status.worldId ||
      !['group_commitment_fulfilled', 'group_commitment_breached'].includes(event.type) ||
      facts?.groupConversationId !== args.groupConversationId ||
      event.actorIds.length !== 1 ||
      event.actorIds[0] !== args.donorActorId ||
      event.targetActorIds?.length !== 1 ||
      event.targetActorIds[0] !== args.recipientActorId
    ) {
      throw new Error('C016d6 outcome source is missing or mismatched.');
    }
    return {
      event: {
        eventId: String(event._id),
        type: event.type,
        actorIds: event.actorIds,
        targetActorIds: event.targetActorIds ?? [],
        witnessActorIds: event.witnessActorIds ?? [],
        visibility: event.visibility,
        facts: event.facts,
      },
      relationship: relationship ? {
        fromActorId: relationship.fromActorId,
        toActorId: relationship.toActorId,
        affinity: relationship.value,
        trust: relationship.trust ?? 0,
        suspicion: relationship.suspicion ?? 0,
        debt: relationship.debt ?? 0,
        fear: relationship.fear ?? 0,
        lastChangedByEventId: relationship.lastChangedByEventId,
      } : null,
      changes: changes.map((change) => ({
        changeId: change.changeId,
        sourceEventId: change.sourceEventId,
        fromActorId: change.fromActorId,
        toActorId: change.toActorId,
        effectKind: change.effectKind,
        status: change.status,
        appliedDelta: change.appliedDelta,
      })),
      memories: args.actorIds.map((actorId) => ({
        actorId,
        rows: memories.filter((memory) => memory.actorId === actorId).map((memory) => ({
          sourceEventId: memory.sourceEventId,
          source: memory.source,
          distorted: memory.distorted ?? false,
          lifecycle: memory.lifecycle ?? 'active',
        })),
      })),
    };
  },
});

export const runGroupConversationRuleAgent = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), decisionId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runGroupConversationRuleAgent');
    if (!args.actorId.startsWith('godot_smoke_c014_')) {
      throw new Error('C014a rule Agent must remain inside its fixture boundary.');
    }
    return await ctx.runAction(internal.xianxia.agent.proposeAndAct, args);
  },
});

export const setGroupDecisionFixtureHerbs = mutation({
  args: { actorId: v.string(), qty: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setGroupDecisionFixtureHerbs');
    if (!args.actorId.startsWith('godot_smoke_c014_') || !Number.isInteger(args.qty) || args.qty < 0 || args.qty > 3) {
      throw new Error('C014b herb fixture is outside its boundary.');
    }
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    const profile = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
      q.eq('worldId', status.worldId).eq('actorId', args.actorId),
    ).first();
    if (!profile) throw new Error('C014b fixture actor missing.');
    await ctx.db.patch(profile._id, { inventory: args.qty > 0 ? [{ itemId: 'spirit_herb', qty: args.qty }] : [] });
    return { actorId: args.actorId, qty: args.qty };
  },
});

export const expireGroupProposalFixture = mutation({
  args: { proposalId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.expireGroupProposalFixture');
    if (!args.proposalId.startsWith('group_proposal:')) throw new Error('C014b proposal id is invalid.');
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    const proposal = await ctx.db.query('groupProposals').withIndex('byProposal', (q) =>
      q.eq('worldId', status.worldId).eq('proposalId', args.proposalId),
    ).first();
    if (!proposal || !proposal.participantActorIds.every((actorId) => actorId.startsWith('godot_smoke_c014_'))) {
      throw new Error('C014b proposal outside fixture boundary.');
    }
    await ctx.db.patch(proposal._id, { expiresAt: Date.now() - 1, updatedAt: Date.now() });
    return { proposalId: args.proposalId, expired: true };
  },
});

export const setGroupDecisionFixtureRelationships = mutation({
  args: {
    edges: v.array(v.object({ fromActorId: v.string(), toActorId: v.string(), value: v.number() })),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setGroupDecisionFixtureRelationships');
    if (args.edges.length > 12 || args.edges.some((edge) =>
      !edge.fromActorId.startsWith('godot_smoke_c014_') ||
      !edge.toActorId.startsWith('godot_smoke_c014_') ||
      edge.fromActorId === edge.toActorId ||
      !Number.isInteger(edge.value) || edge.value < -100 || edge.value > 100
    )) throw new Error('C014c relationship fixture is outside its boundary.');
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    for (const edge of args.edges) {
      const existing = await ctx.db.query('relationships').withIndex('pair', (q) =>
        q.eq('worldId', status.worldId).eq('fromActorId', edge.fromActorId).eq('toActorId', edge.toActorId),
      ).first();
      const fields = { value: edge.value, trust: 0, suspicion: 0, debt: 0, fear: 0, tags: ['restricted_test_fixture'] };
      if (existing) await ctx.db.patch(existing._id, fields);
      else await ctx.db.insert('relationships', { worldId: status.worldId, fromActorId: edge.fromActorId, toActorId: edge.toActorId, ...fields });
    }
    return { updated: args.edges.length };
  },
});

export const setGroupConversationFixtureActorState = mutation({
  args: {
    actorId: v.string(),
    mode: v.union(v.literal('present'), v.literal('leave'), v.literal('incapacitate')),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setGroupConversationFixtureActorState');
    if (!args.actorId.startsWith('godot_smoke_c014_')) throw new Error('C014a actor outside fixture.');
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    const profile = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
      q.eq('worldId', status.worldId).eq('actorId', args.actorId),
    ).first();
    if (!profile) throw new Error('C014a fixture actor missing.');
    await ctx.db.patch(profile._id, {
      health: args.mode === 'incapacitate' ? 0 : 10,
      mapId: SYSTEM_LAB_MAP_ID,
      currentLocationId: args.mode === 'leave' ? SYSTEM_LAB_REST_LOCATION_ID : 'system_lab_group_circle',
    });
    return { actorId: args.actorId, mode: args.mode };
  },
});

export const expireGroupConversationFixture = mutation({
  args: { groupConversationId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.expireGroupConversationFixture');
    if (!args.groupConversationId.startsWith('group_conversation:')) {
      throw new Error('C014a fixture group id is invalid.');
    }
    const status = await ctx.db.query('worldStatus').filter((q) => q.eq(q.field('isDefault'), true)).first();
    if (!status) throw new Error('No default worldStatus found.');
    const session = await ctx.db.query('groupConversationSessions').withIndex('byGroupConversation', (q) =>
      q.eq('worldId', status.worldId).eq('groupConversationId', args.groupConversationId),
    ).first();
    if (!session || !session.participantActorIds.every((actorId) => actorId.startsWith('godot_smoke_c014_'))) {
      throw new Error('C014a session outside fixture boundary.');
    }
    await ctx.db.patch(session._id, { expiresAt: Date.now() - 1, updatedAt: Date.now() });
    return { groupConversationId: args.groupConversationId, expired: true };
  },
});

export const primeNegotiationLabInventory = mutation({
  args: {
    sellerActorId: v.string(),
    buyerActorId: v.string(),
    sellerHerbs: v.number(),
    buyerSpiritStones: v.number(),
    sellerSpiritStones: v.optional(v.number()),
    buyerHerbs: v.optional(v.number()),
    sellerToBuyerRelationship: v.optional(v.number()),
    buyerToSellerRelationship: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeNegotiationLabInventory');
    if (
      !args.sellerActorId.startsWith('system_lab_request_issuer') ||
      !args.buyerActorId.startsWith('godot_smoke_c013')
    ) {
      throw new Error('C013 negotiation actors must remain inside their fixture boundary.');
    }
    if (
      !Number.isInteger(args.sellerHerbs) ||
      args.sellerHerbs < 0 ||
      args.sellerHerbs > 20 ||
      !Number.isInteger(args.buyerSpiritStones) ||
      args.buyerSpiritStones < 0 ||
      args.buyerSpiritStones > 999 ||
      !Number.isInteger(args.sellerSpiritStones ?? 0) ||
      (args.sellerSpiritStones ?? 0) < 0 ||
      (args.sellerSpiritStones ?? 0) > 999 ||
      !Number.isInteger(args.buyerHerbs ?? 0) ||
      (args.buyerHerbs ?? 0) < 0 ||
      (args.buyerHerbs ?? 0) > 20
    ) {
      throw new Error('C013 negotiation fixture inventory is out of bounds.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const seller = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
      q.eq('worldId', status.worldId).eq('actorId', args.sellerActorId),
    ).first();
    const buyer = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
      q.eq('worldId', status.worldId).eq('actorId', args.buyerActorId),
    ).first();
    if (!seller || !buyer) throw new Error('Prime the C013 social pair before inventory.');
    await ctx.db.patch(seller._id, {
      inventory: [
        ...(args.sellerHerbs > 0 ? [{ itemId: 'spirit_herb', qty: args.sellerHerbs }] : []),
        ...((args.sellerSpiritStones ?? 0) > 0
          ? [{ itemId: 'spirit_stone', qty: args.sellerSpiritStones! }]
          : []),
      ],
    });
    await ctx.db.patch(buyer._id, {
      inventory: [
        ...(args.buyerSpiritStones > 0
          ? [{ itemId: 'spirit_stone', qty: args.buyerSpiritStones }]
          : []),
        ...((args.buyerHerbs ?? 0) > 0
          ? [{ itemId: 'spirit_herb', qty: args.buyerHerbs! }]
          : []),
      ],
    });
    for (const [fromActorId, toActorId, value] of [
      [args.sellerActorId, args.buyerActorId, args.sellerToBuyerRelationship],
      [args.buyerActorId, args.sellerActorId, args.buyerToSellerRelationship],
    ] as const) {
      if (value === undefined) continue;
      if (!Number.isFinite(value) || value < -100 || value > 100) {
        throw new Error('C013 relationship fixture must remain in -100..100.');
      }
      const relationship = await ctx.db.query('relationships').withIndex('pair', (q) =>
        q.eq('worldId', status.worldId).eq('fromActorId', fromActorId).eq('toActorId', toActorId),
      ).first();
      if (!relationship) throw new Error('Prime the C013 social relationship before inventory.');
      await ctx.db.patch(relationship._id, { value });
    }
    return { worldId: status.worldId, sellerActorId: args.sellerActorId, buyerActorId: args.buyerActorId };
  },
});

export const inspectNegotiationLab = query({
  args: { negotiationId: v.string(), actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectNegotiationLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const session = await ctx.db.query('negotiationSessions').withIndex('byNegotiation', (q) =>
      q.eq('worldId', status.worldId).eq('negotiationId', args.negotiationId),
    ).first();
    const proposals = await ctx.db.query('negotiationProposals').withIndex('byNegotiationRevision', (q) =>
      q.eq('worldId', status.worldId).eq('negotiationId', args.negotiationId),
    ).collect();
    const turns = session
      ? await ctx.db
          .query('conversationUtterances')
          .withIndex('byConversationTurn', (q) =>
            q.eq('worldId', status.worldId).eq('conversationId', session.conversationId),
          )
          .collect()
      : [];
    const profiles = [];
    for (const actorId of args.actorIds) {
      const profile = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', actorId),
      ).first();
      profiles.push({ actorId, inventory: profile?.inventory ?? [] });
    }
    const events = session
      ? (await ctx.db.query('worldEvents').withIndex('byMap', (q) =>
          q.eq('worldId', status.worldId).eq('mapId', session.mapId),
        ).order('desc').take(200)).filter((event) =>
          (event.facts as { negotiationId?: string } | undefined)?.negotiationId === args.negotiationId,
        )
      : [];
    const actionIds = new Set(
      [
        ...proposals.map((proposal) => String(proposal.actionRecordId)),
        ...events.map((event) => event.actionId ? String(event.actionId) : undefined),
        session?.settlementActionId ? String(session.settlementActionId) : undefined,
      ].filter((value): value is string => !!value),
    );
    const actions = [];
    for (const actionId of actionIds) {
      const id = ctx.db.normalizeId('actionRecords', actionId);
      const action = id ? await ctx.db.get(id) : null;
      if (action) actions.push(action);
    }
    const memories = await inspectMemoriesForEvents(ctx, status.worldId, events, args.actorIds);
    const modelCalls = (
      await Promise.all(args.actorIds.map((actorId) =>
        ctx.db.query('socialModelCalls').withIndex('byActor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', actorId),
        ).collect(),
      ))
    ).flat().filter((call) => !session || call.conversationId === session.conversationId);
    return { session, proposals, turns, profiles, events, actions, memories, modelCalls };
  },
});

export const setC016cLiveFixturePersonas = mutation({
  args: {
    actors: v.array(v.object({
      actorId: v.string(),
      persona: v.string(),
      currentIntent: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setC016cLiveFixturePersonas');
    if (
      args.actors.length < 2 ||
      args.actors.length > 8 ||
      new Set(args.actors.map((actor) => actor.actorId)).size !== args.actors.length ||
      args.actors.some((actor) =>
        (!actor.actorId.startsWith('godot_smoke_c013') &&
          !actor.actorId.startsWith('system_lab_request_issuer_c013') &&
          !actor.actorId.startsWith('godot_smoke_c014_')) ||
        actor.persona.length < 4 || actor.persona.length > 240 ||
        actor.currentIntent.length < 4 || actor.currentIntent.length > 240
      )
    ) {
      throw new Error('C016c live persona fixture is outside its bounded actor/text contract.');
    }
    const status = await ctx.db.query('worldStatus').filter((q) =>
      q.eq(q.field('isDefault'), true),
    ).first();
    if (!status) throw new Error('No default worldStatus found.');
    for (const actor of args.actors) {
      const profile = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', actor.actorId),
      ).first();
      if (!profile) throw new Error(`C016c fixture profile missing: ${actor.actorId}`);
      await ctx.db.patch(profile._id, {
        persona: actor.persona,
        currentIntent: actor.currentIntent,
      });
    }
    return { updated: args.actors.length };
  },
});

export const clearNegotiationFixtureConversationCooldowns = mutation({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.clearNegotiationFixtureConversationCooldowns');
    if (args.actorIds.length < 1 || args.actorIds.length > 4) {
      throw new Error('C013 cooldown fixture accepts 1..4 actors.');
    }
    for (const actorId of args.actorIds) {
      if (
        !actorId.startsWith('godot_smoke_c013') &&
        !actorId.startsWith('system_lab_request_issuer_c013')
      ) {
        throw new Error('C013 cooldown fixture actor is outside the negotiation boundary.');
      }
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const actorIds = new Set(args.actorIds);
    const cooldowns = await ctx.db.query('conversationCooldowns').collect();
    let deleted = 0;
    for (const cooldown of cooldowns) {
      if (
        cooldown.worldId === status.worldId &&
        ((cooldown.actorId && actorIds.has(cooldown.actorId)) ||
          (cooldown.targetActorId && actorIds.has(cooldown.targetActorId)))
      ) {
        await ctx.db.delete(cooldown._id);
        deleted += 1;
      }
    }
    return { deleted };
  },
});

export const scheduleNegotiationFixtureExpiry = mutation({
  args: { negotiationId: v.string(), delayMs: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.scheduleNegotiationFixtureExpiry');
    if (!Number.isInteger(args.delayMs) || args.delayMs < 100 || args.delayMs > 15_000) {
      throw new Error('C013 fixture expiry delay must be an integer in 100..15000ms.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const session = await ctx.db
      .query('negotiationSessions')
      .withIndex('byNegotiation', (q) =>
        q.eq('worldId', status.worldId).eq('negotiationId', args.negotiationId),
      )
      .first();
    if (
      !session ||
      !['opened', 'active'].includes(session.status) ||
      (!session.actorAId.startsWith('godot_smoke_c013') &&
        !session.actorAId.startsWith('system_lab_request_issuer_c013')) ||
      (!session.actorBId.startsWith('godot_smoke_c013') &&
        !session.actorBId.startsWith('system_lab_request_issuer_c013'))
    ) {
      throw new Error('C013 active negotiation fixture not found.');
    }
    const expiresAt = Date.now() + args.delayMs;
    await ctx.db.patch(session._id, { expiresAt, updatedAt: Date.now() });
    await ctx.scheduler.runAt(expiresAt, internal.xianxia.negotiations.expireNegotiation, {
      worldId: status.worldId,
      negotiationId: session.negotiationId,
      revision: session.revision,
    });
    return {
      worldId: status.worldId,
      negotiationId: session.negotiationId,
      revision: session.revision,
      expiresAt,
    };
  },
});

export const setConversationFixtureState = mutation({
  args: {
    actorId: v.optional(v.string()),
    locationId: v.optional(v.string()),
    health: v.optional(v.number()),
    conversationId: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setConversationFixtureState');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    if (args.actorId) {
      if (
        !args.actorId.startsWith('godot_smoke_') &&
        !args.actorId.startsWith('system_lab_request_issuer')
      ) {
        throw new Error('C012 actor must stay inside the social fixture boundary.');
      }
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', args.actorId!),
        )
        .first();
      if (!profile) throw new Error('C012 fixture profile not found.');
      const patch: { currentLocationId?: string; health?: number } = {};
      if (args.locationId !== undefined) patch.currentLocationId = args.locationId;
      if (args.health !== undefined) patch.health = args.health;
      await ctx.db.patch(profile._id, patch);
    }
    if (args.conversationId && args.expiresAt !== undefined) {
      const session = await ctx.db
        .query('conversationSessions')
        .withIndex('byConversation', (q) =>
          q.eq('worldId', status.worldId).eq('conversationId', args.conversationId!),
        )
        .first();
      if (!session) throw new Error('C012 fixture conversation not found.');
      await ctx.db.patch(session._id, { expiresAt: args.expiresAt, updatedAt: Date.now() });
    }
    return { ok: true };
  },
});

export const inspectConversationCooldownLab = query({
  args: { actorIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectConversationCooldownLab');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const actorIds = new Set(args.actorIds);
    const cooldowns = (await ctx.db.query('conversationCooldowns').collect()).filter(
      (cooldown) =>
        cooldown.worldId === status.worldId &&
        (!!cooldown.actorId && actorIds.has(cooldown.actorId)) &&
        (!cooldown.targetActorId || actorIds.has(cooldown.targetActorId)),
    );
    const sessions = (await ctx.db.query('conversationSessions').collect()).filter(
      (session) =>
        session.worldId === status.worldId &&
        actorIds.has(session.actorAId) &&
        actorIds.has(session.actorBId),
    );
    return { cooldowns, sessions };
  },
});

export const runConversationRuleAgent = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), decisionId: v.string() },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.runConversationRuleAgent');
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: args.worldId,
      actorId: args.actorId,
      now: Date.now(),
    });
    if (!context) return { actorId: args.actorId, skipped: 'no_profile' };
    const proposal = planConversationTurnIntent(context);
    if (!proposal) {
      return {
        actorId: args.actorId,
        skipped: context.activeConversation ? 'conversation_waiting_turn' : 'no_active_conversation',
      };
    }
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: proposal.type,
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: proposal.targetActorId,
      locationId: proposal.locationId,
      intent: proposal.intent,
      params: proposal.params,
    });
    return { actorId: args.actorId, proposal, result, decisionSource: 'rule' };
  },
});

export const runNegotiationProductionAgent = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), decisionId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runNegotiationProductionAgent');
    if (
      !args.actorId.startsWith('godot_smoke_c013') &&
      !args.actorId.startsWith('system_lab_request_issuer_c013')
    ) {
      throw new Error('C013 production Agent must remain inside the negotiation fixture.');
    }
    return await ctx.runAction(internal.xianxia.agent.proposeAndAct, args);
  },
});

export const runConversationModelDefaultGuard = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), decisionId: v.string() },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.runConversationModelDefaultGuard');
    if (
      !args.actorId.startsWith('godot_smoke_') &&
      !args.actorId.startsWith('system_lab_request_issuer')
    ) {
      throw new Error('C012b model guard actor must remain inside the social fixture boundary.');
    }
    return await ctx.runAction(internal.xianxia.agent.proposeAndAct, args);
  },
});

export const inspectSocialModelCalls = query({
  args: { callIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectSocialModelCalls');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    return (
      await Promise.all(
        args.callIds.slice(0, 30).map((callId) =>
          ctx.db
            .query('socialModelCalls')
            .withIndex('byCall', (q) => q.eq('worldId', status.worldId).eq('callId', callId))
            .first(),
        ),
      )
    ).filter((call): call is NonNullable<typeof call> => !!call);
  },
});

// Network-free transaction fixture for the durable C012b runtime. It invokes
// the same reservation/start/finish helpers as production, snapshots the rows,
// then restores the world's budget and removes fixture-only calls.
export const runSocialModelRuntimeFixture = mutation({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.runSocialModelRuntimeFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const worldId = status.worldId;
    const originalBudget = await ctx.db
      .query('socialModelBudgets')
      .withIndex('byWorld', (q) => q.eq('worldId', worldId))
      .first();
    const prefix = `c012b-fixture:${args.runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}`;
    const now = Date.now();
    const callIds: string[] = [];
    const switches = {
      deploymentEnabled: true,
      liveAuthorized: true,
      promptAuthorized: true,
      authorizationLease: 'valid' as const,
    };
    const reserve = async (suffix: string, actorSuffix: string, at: number, promptHash = suffix) => {
      const callId = `${prefix}:${suffix}`;
      callIds.push(callId);
      return await reserveSocialModelCallTx(
        ctx,
        {
          worldId,
          callId,
          actorId: `godot_smoke_c012b_${actorSuffix}_${args.runId}`.slice(0, 150),
          conversationId: `${prefix}:conversation:${actorSuffix}`,
          provider: 'fixture',
          model: 'fixture-model',
          promptVersion: 'fixture-v1',
          scenarioKind: 'conversation',
          promptHash: `${prefix}:prompt:${promptHash}`,
          estimatedInputTokens: 100,
          maxOutputTokens: 220,
          now: at,
        },
        switches,
      );
    };
    const ensure = (condition: boolean, message: string) => {
      if (!condition) throw new Error(`C012b runtime fixture: ${message}`);
    };

    const activeA = await reserve('active-a', 'active_a', now);
    const activeB = await reserve('active-b', 'active_b', now + 1);
    const concurrencyBlocked = await reserve('active-c', 'active_c', now + 2);
    ensure(activeA.reserved && activeB.reserved, 'first two world calls must reserve');
    ensure(
      !concurrencyBlocked.reserved &&
        concurrencyBlocked.reasonCode === 'social_llm_concurrency_limit',
      'third active world call must be blocked',
    );
    await finishSocialModelCallTx(ctx, {
      worldId,
      callId: `${prefix}:active-a`,
      status: 'cancelled',
      now: now + 3,
      attemptCount: 0,
      reasonCode: 'llm_cancelled',
    });
    await finishSocialModelCallTx(ctx, {
      worldId,
      callId: `${prefix}:active-b`,
      status: 'cancelled',
      now: now + 4,
      attemptCount: 0,
      reasonCode: 'llm_cancelled',
    });

    const firstActorCall = await reserve('actor-first', 'actor_cd', now + 10, 'actor-first');
    ensure(firstActorCall.reserved, 'first actor call must reserve');
    await markSocialModelCallStartedTx(ctx, {
      worldId,
      callId: `${prefix}:actor-first`,
      now: now + 11,
    });
    const validResponse = JSON.stringify({
      speechAct: 'respond',
      utteranceText: '我会先核对来源。',
      referencedFactIds: [],
      referencedBeliefIds: [],
    });
    await finishSocialModelCallTx(ctx, {
      worldId,
      callId: `${prefix}:actor-first`,
      status: 'succeeded',
      now: now + 12,
      attemptCount: 1,
      resultHash: `${prefix}:result`,
      responseText: validResponse,
      totalTokens: 140,
    });
    const actorBlocked = await reserve('actor-second', 'actor_cd', now + 13, 'different');
    ensure(
      !actorBlocked.reserved && actorBlocked.reasonCode === 'social_llm_actor_cooldown',
      'same actor must be cooldown-blocked',
    );
    const cached = await reserve('cache', 'actor_cd', now + 14, 'actor-first');
    ensure(cached.reserved && cached.cacheHit && cached.reservedTokens === 0, 'exact cache must be free');
    await finishSocialModelCallTx(ctx, {
      worldId,
      callId: `${prefix}:cache`,
      status: 'succeeded',
      now: now + 15,
      attemptCount: 0,
      resultHash: `${prefix}:result`,
      responseText: validResponse,
    });
    const replay = await reserveSocialModelCallTx(
      ctx,
      {
        worldId,
        callId: `${prefix}:cache`,
        actorId: `godot_smoke_c012b_actor_cd_${args.runId}`.slice(0, 150),
        conversationId: `${prefix}:conversation:actor_cd`,
        provider: 'fixture',
        model: 'fixture-model',
        promptVersion: 'fixture-v1',
        scenarioKind: 'conversation',
        promptHash: `${prefix}:prompt:actor-first`,
        estimatedInputTokens: 100,
        maxOutputTokens: 220,
        now: now + 16,
      },
      switches,
    );
    ensure(!replay.reserved && replay.idempotentReplay === true, 'terminal callId must replay');
    const conflict = await reserveSocialModelCallTx(
      ctx,
      {
        worldId,
        callId: `${prefix}:cache`,
        actorId: `godot_smoke_c012b_actor_cd_${args.runId}`.slice(0, 150),
        conversationId: `${prefix}:conversation:actor_cd`,
        provider: 'fixture',
        model: 'fixture-model',
        promptVersion: 'fixture-v1',
        scenarioKind: 'conversation',
        promptHash: `${prefix}:prompt:conflicting`,
        estimatedInputTokens: 100,
        maxOutputTokens: 220,
        now: now + 17,
      },
      switches,
    );
    ensure(
      !conflict.reserved && conflict.reasonCode === 'social_llm_call_conflict',
      'same callId with a different prompt must conflict',
    );

    for (let index = 1; index <= 3; index += 1) {
      const failed = await reserve(`failure-${index}`, `failure_${index}`, now + 30 + index);
      ensure(failed.reserved, `failure ${index} must reserve before circuit opens`);
      await markSocialModelCallStartedTx(ctx, {
        worldId,
        callId: `${prefix}:failure-${index}`,
        now: now + 40 + index,
      });
      await finishSocialModelCallTx(ctx, {
        worldId,
        callId: `${prefix}:failure-${index}`,
        status: 'failed',
        now: now + 50 + index,
        attemptCount: 1,
        reasonCode: 'llm_unavailable',
      });
    }
    const circuitBlocked = await reserve('circuit-blocked', 'circuit', now + 60);
    ensure(
      !circuitBlocked.reserved && circuitBlocked.reasonCode === 'social_llm_circuit_open',
      'three failures must open the circuit',
    );

    const afterCircuit = now + SOCIAL_LLM_CIRCUIT_OPEN_MS + 100;
    const leaseA = await reserve('lease-a', 'lease_a', afterCircuit);
    const leaseB = await reserve('lease-b', 'lease_b', afterCircuit + 1);
    ensure(leaseA.reserved && leaseB.reserved, 'post-circuit lease calls must reserve');
    const afterLease = afterCircuit + SOCIAL_LLM_CALL_LEASE_MS + 2;
    const leaseRecovered = await reserve('lease-recovered', 'lease_c', afterLease);
    ensure(leaseRecovered.reserved, 'expired leases must free concurrency');
    await finishSocialModelCallTx(ctx, {
      worldId,
      callId: `${prefix}:lease-recovered`,
      status: 'cancelled',
      now: afterLease + 1,
      attemptCount: 0,
      reasonCode: 'llm_cancelled',
    });

    const budget = await ctx.db
      .query('socialModelBudgets')
      .withIndex('byWorld', (q) => q.eq('worldId', worldId))
      .first();
    ensure(!!budget, 'budget row must exist');
    const budgetNow = afterLease + 10;
    await ctx.db.patch(budget!._id, {
      hourlyWindowStartedAt: socialModelWindowStart(budgetNow, 60 * 60_000),
      hourlyReservedTokens: SOCIAL_LLM_HOURLY_TOKEN_BUDGET,
      dailyWindowStartedAt: socialModelWindowStart(budgetNow, 24 * 60 * 60_000),
      dailyReservedTokens: 0,
      consecutiveFailures: 0,
      circuitOpenUntil: undefined,
      updatedAt: budgetNow,
    });
    const budgetBlocked = await reserve('budget-blocked', 'budget', budgetNow);
    ensure(
      !budgetBlocked.reserved && budgetBlocked.reasonCode === 'token_budget_blocked',
      'hourly budget must block before provider work',
    );

    const rows = (
      await Promise.all(
        callIds.map((callId) =>
          ctx.db
            .query('socialModelCalls')
            .withIndex('byCall', (q) => q.eq('worldId', worldId).eq('callId', callId))
            .first(),
        ),
      )
    ).filter((row): row is NonNullable<typeof row> => !!row);
    const evidence = rows.map((row) => ({
      callId: row.callId,
      actorId: row.actorId,
      status: row.status,
      reasonCode: row.reasonCode,
      reservedTokens: row.reservedTokens,
      attemptCount: row.attemptCount,
      cacheHit: row.cacheHit,
    }));
    for (const row of rows) await ctx.db.delete(row._id);
    const currentBudget = await ctx.db
      .query('socialModelBudgets')
      .withIndex('byWorld', (q) => q.eq('worldId', worldId))
      .first();
    if (originalBudget && currentBudget) {
      await ctx.db.patch(currentBudget._id, {
        hourlyWindowStartedAt: originalBudget.hourlyWindowStartedAt,
        hourlyReservedTokens: originalBudget.hourlyReservedTokens,
        dailyWindowStartedAt: originalBudget.dailyWindowStartedAt,
        dailyReservedTokens: originalBudget.dailyReservedTokens,
        consecutiveFailures: originalBudget.consecutiveFailures,
        circuitOpenUntil: originalBudget.circuitOpenUntil,
        updatedAt: originalBudget.updatedAt,
      });
    } else if (!originalBudget && currentBudget) {
      await ctx.db.delete(currentBudget._id);
    }
    return {
      worldId,
      checks: {
        concurrency: concurrencyBlocked.reserved ? null : concurrencyBlocked.reasonCode,
        actorCooldown: actorBlocked.reserved ? null : actorBlocked.reasonCode,
        cacheHit: cached.reserved ? cached.cacheHit : false,
        idempotentReplay: replay.idempotentReplay,
        callConflict: conflict.reserved ? null : conflict.reasonCode,
        circuit: circuitBlocked.reserved ? null : circuitBlocked.reasonCode,
        leaseRecovered: leaseRecovered.reserved,
        budget: budgetBlocked.reserved ? null : budgetBlocked.reasonCode,
      },
      evidence,
    };
  },
});

export const submitConversationFixtureTurn = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    decisionId: v.string(),
    conversationId: v.string(),
    turnId: v.string(),
    expectedTurnNumber: v.number(),
    speechAct: v.string(),
    utteranceText: v.string(),
    addressedActorIds: v.array(v.string()),
    referencedFactIds: v.array(v.string()),
    referencedBeliefIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.submitConversationFixtureTurn');
    if (!args.actorId.startsWith('system_lab_request_issuer')) {
      throw new Error('C012 controlled NPC turn must remain inside the request issuer fixture.');
    }
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: 'talk',
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: args.targetActorId,
      intent: 'C012 受控 NPC 会话失败注入',
      params: {
        conversationId: args.conversationId,
        turnId: args.turnId,
        expectedTurnNumber: args.expectedTurnNumber,
        speechAct: args.speechAct,
        utteranceText: args.utteranceText,
        addressedActorIds: args.addressedActorIds,
        referencedFactIds: args.referencedFactIds,
        referencedBeliefIds: args.referencedBeliefIds,
      },
    });
    return { actorId: args.actorId, result, decisionSource: 'fixture' };
  },
});

export const submitNegotiationFixtureAction = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    decisionId: v.string(),
    operation: v.union(
      v.literal('open'),
      v.literal('counter'),
      v.literal('accept'),
      v.literal('reject'),
      v.literal('withdraw'),
    ),
    conversationId: v.string(),
    negotiationId: v.optional(v.string()),
    expectedRevision: v.optional(v.number()),
    turnId: v.optional(v.string()),
    expectedTurnNumber: v.optional(v.number()),
    utteranceText: v.optional(v.string()),
    terms: v.optional(
      v.union(
        v.object({
          kind: v.literal('herb_trade'),
          sellerActorId: v.string(),
          buyerActorId: v.string(),
          itemId: v.literal('spirit_herb'),
          itemQty: v.number(),
          paymentItemId: v.literal('spirit_stone'),
          paymentQty: v.number(),
        }),
        v.object({
          kind: v.literal('request_deadline'),
          requestId: v.string(),
          issuerActorId: v.string(),
          assigneeActorId: v.string(),
          baseExpiresAtGameHour: v.number(),
          extensionGameHours: v.number(),
        }),
        v.object({
          kind: v.literal('event_compensation'),
          harmEventId: v.string(),
          encounterId: v.string(),
          payerActorId: v.string(),
          payeeActorId: v.string(),
          harmDamage: v.number(),
          paymentItemId: v.literal('spirit_stone'),
          paymentQty: v.number(),
        }),
      ),
    ),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.submitNegotiationFixtureAction');
    if (
      !args.actorId.startsWith('system_lab_request_issuer_c013') &&
      !args.actorId.startsWith('godot_smoke_c013')
    ) {
      throw new Error('C013 controlled Agent must remain inside the negotiation fixture.');
    }
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: 'negotiate',
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: args.targetActorId,
      locationId:
        args.actorId.startsWith('godot_smoke_c013_compensation_') ||
        args.terms?.kind === 'event_compensation'
          ? SYSTEM_LAB_CONFLICT_LOCATION_ID
          : SYSTEM_LAB_REQUEST_LOCATION_ID,
      intent: 'C013 受控 Agent 双边议价验收',
      params: {
        operation: args.operation,
        conversationId: args.conversationId,
        negotiationId: args.negotiationId,
        expectedRevision: args.expectedRevision,
        turnId: args.turnId,
        expectedTurnNumber: args.expectedTurnNumber,
        utteranceText: args.utteranceText,
        referencedFactIds:
          args.terms?.kind === 'event_compensation' ? [args.terms.harmEventId] : [],
        referencedBeliefIds: [],
        terms: args.terms,
      },
    });
    return { actorId: args.actorId, result, decisionSource: 'fixture' };
  },
});

export const fulfillSocialQuestLab = mutation({
  args: { requestId: v.id('requests') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.fulfillSocialQuestLab');
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error('C011 request not found.');
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
      )
      .first();
    if (!profile) throw new Error('C011 assignee profile not found.');
    if (request.type === 'collect_item') {
      const inventory = (profile.inventory ?? []).filter((item) => item.itemId !== 'spirit_herb');
      inventory.push({ itemId: 'spirit_herb', qty: request.requirements.qty ?? 1 });
      await ctx.db.patch(profile._id, { inventory });
    } else {
      await ctx.db.patch(profile._id, { currentLocationId: request.requirements.locationId });
    }
    return { requestId: request._id, requirementFactsPrimed: true };
  },
});

export const returnSocialQuestAssignee = mutation({
  args: { requestId: v.id('requests'), removeDeliveryItem: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.returnSocialQuestAssignee');
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error('C011 request not found.');
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
      )
      .first();
    if (!profile) throw new Error('C011 assignee profile not found.');
    await ctx.db.patch(profile._id, {
      currentLocationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
      ...(args.removeDeliveryItem
        ? { inventory: (profile.inventory ?? []).filter((item) => item.itemId !== request.requirements.itemId) }
        : {}),
    });
    return { requestId: request._id, returned: true };
  },
});

export const refreshSocialQuestLab = mutation({
  args: { requestId: v.id('requests') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.refreshSocialQuestLab');
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error('C011 request not found.');
    const progress = await refreshRequestProgress(ctx, request, Date.now());
    return { requestId: request._id, progress };
  },
});

export const inspectSocialQuestLab = query({
  args: { requestId: v.id('requests') },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectSocialQuestLab');
    const request = await ctx.db.get(args.requestId);
    if (!request) throw new Error('C011 request not found.');
    const assignee = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) =>
        q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
      )
      .first();
    const [relationship, reverseRelationship] = await Promise.all([
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', request.worldId)
            .eq('fromActorId', request.issuerActorId)
            .eq('toActorId', request.assigneeActorId),
        )
        .first(),
      ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', request.worldId)
            .eq('fromActorId', request.assigneeActorId)
            .eq('toActorId', request.issuerActorId),
        )
        .first(),
    ]);
    const actions = await ctx.db
      .query('actionRecords')
      .withIndex('actor', (q) =>
        q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
      )
      .order('desc')
      .take(30);
    const events = await ctx.db
      .query('worldEvents')
      .withIndex('byMap', (q) =>
        q.eq('worldId', request.worldId).eq('mapId', SYSTEM_LAB_MAP_ID),
      )
      .order('desc')
      .take(50);
    const [executions, usages, assigneeRequests, providerCalls, terminalMemories] =
      await Promise.all([
        ctx.db
          .query('actionExecutions')
          .withIndex('byActorRevision', (q) =>
            q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
          )
          .order('desc')
          .take(30),
        ctx.db
          .query('socialActionUsages')
          .withIndex('byActorTargetTypeDay', (q) =>
            q
              .eq('worldId', request.worldId)
              .eq('actorId', request.assigneeActorId)
              .eq('targetActorId', request.issuerActorId)
              .eq('actionType', 'decline_request'),
          )
          .collect(),
        ctx.db
          .query('requests')
          .withIndex('byAssignee', (q) =>
            q.eq('worldId', request.worldId).eq('assigneeActorId', request.assigneeActorId),
          )
          .collect(),
        ctx.db
          .query('socialModelCalls')
          .withIndex('byActor', (q) =>
            q.eq('worldId', request.worldId).eq('actorId', request.assigneeActorId),
          )
          .collect(),
        request.lastTransitionEventId
          ? ctx.db
              .query('shortMemories')
              .withIndex('bySourceEvent', (q) =>
                q
                  .eq('worldId', request.worldId)
                  .eq('sourceEventId', String(request.lastTransitionEventId)),
              )
              .collect()
          : Promise.resolve([]),
      ]);
    const relationshipView = (row: Doc<'relationships'> | null) =>
      row
        ? {
            affinity: row.value,
            trust: row.trust ?? 0,
            suspicion: row.suspicion ?? 0,
            debt: row.debt ?? 0,
            fear: row.fear ?? 0,
            lastChangedByEventId: row.lastChangedByEventId,
          }
        : null;
    return {
      request,
      assignee: assignee
        ? {
            actorId: assignee.actorId,
            cultivationXp: assignee.cultivationXp,
            inventory: assignee.inventory,
            currentLocationId: assignee.currentLocationId,
          }
        : null,
      issuerRelationship: relationshipView(relationship),
      assigneeRelationship: relationshipView(reverseRelationship),
      actions: actions.map((record) => ({
        clientActionId: record.clientActionId,
        type: record.type,
        status: record.status,
        resultCode: record.result?.resultCode,
      })),
      events: events
        .filter((event) => event.facts && (event.facts as { requestId?: string }).requestId === String(request._id))
        .map((event) => ({ type: event.type, actionId: event.actionId, facts: event.facts })),
      executions: executions.map((execution) => ({
        executionId: String(execution._id),
        actionRecordId: String(execution.actionRecordId),
        revision: execution.revision,
        actionType: execution.actionType,
        status: execution.status,
        requestId: execution.requestId ? String(execution.requestId) : undefined,
        requestRevision: execution.requestRevision,
        terminalEventId: execution.terminalEventId
          ? String(execution.terminalEventId)
          : undefined,
        resultCode: execution.resultCode,
        reasonCode: execution.reasonCode,
      })),
      refusalUsages: usages.map((usage) => ({
        actionRecordId: String(usage.actionRecordId),
        sourceEventId: String(usage.sourceEventId),
        outcome: usage.outcome,
      })),
      terminalMemories: terminalMemories.map((memory) => ({
        actorId: memory.actorId,
        sourceEventId: memory.sourceEventId,
        type: memory.type,
        source: memory.source,
      })),
      requestCountForAssignee: assigneeRequests.length,
      providerCallCount: providerCalls.length,
    };
  },
});

export const setSocialQuestActorTile = mutation({
  args: { actorId: v.string(), tile: v.object({ x: v.number(), y: v.number() }) },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.setSocialQuestActorTile');
    if (
      !args.actorId.startsWith('godot_smoke_c016e3d_') &&
      !args.actorId.startsWith('system_lab_request_issuer_c016e3d_')
    ) {
      throw new Error('C016e3d tile mutation is outside its fixture boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (!resident || resident.mapId !== SYSTEM_LAB_MAP_ID) {
      throw new Error('C016e3d resident not found in system lab.');
    }
    await ctx.db.patch(resident._id, { displayTile: args.tile, updatedAt: Date.now() });
    return { actorId: args.actorId, tile: args.tile };
  },
});

export const submitSocialQuestDecisionFixtureAction = action({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    targetActorId: v.string(),
    requestId: v.id('requests'),
    expectedRevision: v.number(),
    decisionId: v.string(),
  },
  handler: async (ctx, args): Promise<Record<string, unknown>> => {
    assertLocalGodotFixtureAccess('godotTesting.submitSocialQuestDecisionFixtureAction');
    if (
      !args.actorId.startsWith('godot_smoke_c016e3d_') ||
      !args.targetActorId.startsWith('system_lab_request_issuer_c016e3d_')
    ) {
      throw new Error('C016e3d controlled Agent is outside its fixture boundary.');
    }
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: 'decline_request',
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: args.targetActorId,
      locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
      intent: '依据自身安排，当面婉拒一桩已绑定 revision 的委托',
      params: { requestId: String(args.requestId), expectedRevision: args.expectedRevision },
    });
    return { actorId: args.actorId, result, decisionSource: 'fixture' };
  },
});

export const tryReissueSocialQuestFixture = mutation({
  args: { issuerActorId: v.string(), assigneeActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.tryReissueSocialQuestFixture');
    if (
      !args.assigneeActorId.startsWith('godot_smoke_c016e3d_') ||
      !args.issuerActorId.startsWith('system_lab_request_issuer_c016e3d_')
    ) {
      throw new Error('C016e3d reissue is outside its fixture boundary.');
    }
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const issued = await maybeIssueQuest(
      ctx,
      status.worldId,
      now,
      await readGameHour(ctx, status.worldId, now),
      { issuerActorId: args.issuerActorId, assigneeActorId: args.assigneeActorId },
    );
    return issued ?? null;
  },
});

export const runSocialQuestRuleAgent = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), decisionId: v.string() },
  handler: async (ctx, args): Promise<unknown> => {
    assertLocalGodotFixtureAccess('godotTesting.runSocialQuestRuleAgent');
    assertGodotSmokeActorId(args.actorId, 'runSocialQuestRuleAgent');
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: args.worldId,
      actorId: args.actorId,
      now: Date.now(),
    });
    if (!context) return { actorId: args.actorId, skipped: 'no_profile' };
    const proposal = planStrategicIntent(context);
    if (!proposal) {
      return {
        actorId: args.actorId,
        skipped: 'no_request_strategic_intent',
        observation: {
          availableActions: context.availableActions,
          activeRequests: context.activeRequests ?? [],
        },
      };
    }
    const result = await ctx.runAction(internal.xianxia.gm.actInternal, {
      worldId: args.worldId,
      type: proposal.type,
      actorId: args.actorId,
      source: 'agent',
      clientActionId: `agent:${args.decisionId.slice(0, 96)}:${args.actorId.slice(0, 48)}`,
      targetActorId: proposal.targetActorId,
      targetId: proposal.targetId,
      locationId: proposal.locationId,
      intent: proposal.intent,
      params: proposal.params,
    });
    return { actorId: args.actorId, proposal, result, decisionSource: 'rule' };
  },
});

function godotMapIsolationFixtureKeys(actorId: string) {
  const suffix = actorId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-48);
  const fixtureId = `map_isolation_${suffix}`;
  return {
    fixtureId,
    otherMapId: `godot_other_${suffix}`,
    locationId: `godot_other_location_${suffix}`,
    residentId: `godot-other-resident-${suffix}`,
    residentActorId: `godot:other:${suffix}`,
    profileActorId: `aaa_map_isolation_${suffix}`,
  };
}

const godotMapIsolationEventTypes = [
  'godot_map_isolation_qinglan',
  'godot_map_isolation_other',
  'godot_map_isolation_legacy_mapless',
] as const;

export const primeMemoryCompactionFixture = mutation({
  args: {
    actorId: v.string(),
    subjectActorId: v.string(),
    nowGameHour: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeMemoryCompactionFixture');
    assertGodotSmokeActorId(args.actorId, 'primeMemoryCompactionFixture');
    assertGodotSmokeActorId(args.subjectActorId, 'primeMemoryCompactionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const oldEvents = await c015MemoryFixtureEvents(ctx, status.worldId, args.actorId);
    const oldMemories = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .collect();
    for (const memory of oldMemories) {
      if (memory.type.startsWith(C015_MEMORY_EVENT_PREFIX)) await ctx.db.delete(memory._id);
    }
    for (const event of oldEvents) await ctx.db.delete(event._id);
    const oldSummaries = await ctx.db
      .query('socialMemorySummaries')
      .withIndex('byActorUpdated', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .collect();
    for (const summary of oldSummaries) await ctx.db.delete(summary._id);

    const upsertProfile = async (actorId: string, name: string) => {
      const patch = {
        name,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 3,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '任我',
        cultivationXp: 30,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: 0,
        inventory: [{ itemId: 'spirit_stone', qty: 6 }],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        currentIntent: 'C015 bounded memory compaction fixture.',
        persona: 'Isolated local memory lifecycle actor.',
      };
      const existing = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      if (existing) await ctx.db.patch(existing._id, patch);
      else await ctx.db.insert('xianxiaProfiles', { worldId: status.worldId, actorId, ...patch });
    };
    await upsertProfile(args.actorId, 'C015 记忆拥有者');
    await upsertProfile(args.subjectActorId, 'C015 关系对象');

    const now = Date.now();
    const sourceEventIds: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const type = `${C015_MEMORY_EVENT_PREFIX}${String(index).padStart(2, '0')}`;
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: status.worldId,
        type,
        createdAt: now + index,
        actorIds: [args.actorId],
        targetActorIds: [args.subjectActorId],
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        visibility: 'local',
        summary: `C015 episodic fixture ${index}`,
        facts: versionDurableEventFacts({
          fixtureId: `c015_memory_compaction:${args.actorId}:${index}`,
          source: 'restricted_test_fixture',
        }),
        mapId: SYSTEM_LAB_MAP_ID,
      });
      sourceEventIds.push(String(eventId));
      const rumor = index % 7 === 0;
      await ctx.db.insert('shortMemories', {
        worldId: status.worldId,
        actorId: args.actorId,
        sourceEventId: String(eventId),
        aboutActorIds: [args.subjectActorId],
        type,
        salience: index < 10 ? 3 : 5,
        createdAt: now + index,
        expiresAt: args.nowGameHour + 1_000,
        summary: `C015 episodic fixture ${index}`,
        source: rumor ? 'rumor' : 'direct',
        distorted: rumor,
        lifecycle: 'active',
      });
    }
    return {
      worldId: status.worldId,
      actorId: args.actorId,
      subjectActorId: args.subjectActorId,
      nowGameHour: args.nowGameHour,
      sourceEventIds,
      activeSeeded: 30,
    };
  },
});

export const addExpiredMemoryCompactionFixture = mutation({
  args: {
    actorId: v.string(),
    subjectActorId: v.string(),
    nowGameHour: v.number(),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.addExpiredMemoryCompactionFixture');
    assertGodotSmokeActorId(args.actorId, 'addExpiredMemoryCompactionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const now = Date.now();
    const sourceEventIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const type = `${C015_MEMORY_EVENT_PREFIX}expired_${index}`;
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: status.worldId,
        type,
        createdAt: now + index,
        actorIds: [args.actorId],
        targetActorIds: [args.subjectActorId],
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        visibility: 'local',
        summary: `C015 expired episodic fixture ${index}`,
        facts: versionDurableEventFacts({
          fixtureId: `c015_memory_compaction_expired:${args.actorId}:${index}`,
          source: 'restricted_test_fixture',
        }),
        mapId: SYSTEM_LAB_MAP_ID,
      });
      sourceEventIds.push(String(eventId));
      await ctx.db.insert('shortMemories', {
        worldId: status.worldId,
        actorId: args.actorId,
        sourceEventId: String(eventId),
        aboutActorIds: [args.subjectActorId],
        type,
        salience: 8,
        createdAt: now + index,
        expiresAt: args.nowGameHour - 1,
        summary: `C015 expired episodic fixture ${index}`,
        source: 'witness',
        distorted: false,
        lifecycle: 'active',
      });
    }
    return { worldId: status.worldId, sourceEventIds, expiredSeeded: 3 };
  },
});

export const runMemoryCompactionFixture = mutation({
  args: { actorId: v.string(), nowGameHour: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.runMemoryCompactionFixture');
    assertGodotSmokeActorId(args.actorId, 'runMemoryCompactionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    return compactActorMemoriesInMutation(ctx, status.worldId, args.actorId, args.nowGameHour);
  },
});

export const inspectMemoryCompactionFixture = query({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectMemoryCompactionFixture');
    assertGodotSmokeActorId(args.actorId, 'inspectMemoryCompactionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const events = await c015MemoryFixtureEvents(ctx, status.worldId, args.actorId);
    const eventIds = new Set(events.map((event) => String(event._id)));
    const memories = (await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .collect()).filter((memory) => memory.type.startsWith(C015_MEMORY_EVENT_PREFIX));
    const summaries = await ctx.db
      .query('socialMemorySummaries')
      .withIndex('byActorUpdated', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .collect();
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .first();
    const relationships = await ctx.db
      .query('relationships')
      .withIndex('from', (q) => q.eq('worldId', status.worldId).eq('fromActorId', args.actorId))
      .collect();
    const compactionState = await ctx.db
      .query('memoryCompactionStates')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    return {
      worldId: status.worldId,
      actorId: args.actorId,
      active: memories.filter((memory) => memory.lifecycle !== 'archived').map((memory) => ({
        memoryId: memory._id,
        sourceEventId: memory.sourceEventId,
        salience: memory.salience,
        createdAt: memory.createdAt,
        expiresAt: memory.expiresAt,
      })),
      archived: memories.filter((memory) => memory.lifecycle === 'archived').map((memory) => ({
        memoryId: memory._id,
        sourceEventId: memory.sourceEventId,
        aboutActorIds: memory.aboutActorIds,
        source: memory.source,
        distorted: memory.distorted,
        createdAt: memory.createdAt,
        expiresAt: memory.expiresAt,
        archivedAtGameHour: memory.archivedAtGameHour,
        socialSummaryId: memory.socialSummaryId,
      })),
      summaries: summaries.map((summary) => ({
        summaryId: summary.summaryId,
        subjectActorId: summary.subjectActorId,
        summary: summary.summary,
        memoryCount: summary.memoryCount,
        sourceEventIds: summary.sourceEventIds,
        eventTypes: summary.eventTypes,
        sourceKinds: summary.sourceKinds,
        firstOccurredAt: summary.firstOccurredAt,
        lastOccurredAt: summary.lastOccurredAt,
        highestSalience: summary.highestSalience,
        containsDistortion: summary.containsDistortion,
        revision: summary.revision,
      })),
      sourceEvents: events.map((event) => ({ eventId: event._id, type: event.type })),
      danglingSourceEventIds: memories
        .filter((memory) => !eventIds.has(memory.sourceEventId))
        .map((memory) => memory.sourceEventId),
      inventory: profile?.inventory ?? [],
      relationships: relationships.map((relationship) => ({
        toActorId: relationship.toActorId,
        value: relationship.value,
        trust: relationship.trust,
        suspicion: relationship.suspicion,
      })),
      compactionState: compactionState
        ? {
            status: compactionState.status,
            requestedAtGameHour: compactionState.requestedAtGameHour,
            lastCompactedAtGameHour: compactionState.lastCompactedAtGameHour,
          }
        : null,
    };
  },
});

export const inspectMemoryCompactionAgentContext = action({
  args: { worldId: v.id('worlds'), actorId: v.string(), now: v.number() },
  handler: async (ctx, args): Promise<AgentContext | null> => {
    assertLocalGodotFixtureAccess('godotTesting.inspectMemoryCompactionAgentContext');
    assertGodotSmokeActorId(args.actorId, 'inspectMemoryCompactionAgentContext');
    return ctx.runQuery(internal.xianxia.agent.agentContext, args);
  },
});

export const cleanupMemoryCompactionFixture = mutation({
  args: { actorId: v.string(), subjectActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupMemoryCompactionFixture');
    assertGodotSmokeActorId(args.actorId, 'cleanupMemoryCompactionFixture');
    assertGodotSmokeActorId(args.subjectActorId, 'cleanupMemoryCompactionFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const events = await c015MemoryFixtureEvents(ctx, status.worldId, args.actorId);
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .collect();
    let memoriesDeleted = 0;
    for (const memory of memories) {
      if (!memory.type.startsWith(C015_MEMORY_EVENT_PREFIX)) continue;
      await ctx.db.delete(memory._id);
      memoriesDeleted += 1;
    }
    const summaries = await ctx.db
      .query('socialMemorySummaries')
      .withIndex('byActorUpdated', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .collect();
    for (const summary of summaries) await ctx.db.delete(summary._id);
    const compactionState = await ctx.db
      .query('memoryCompactionStates')
      .withIndex('byActor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      )
      .first();
    if (compactionState) await ctx.db.delete(compactionState._id);
    for (const event of events) await ctx.db.delete(event._id);
    let profilesDeleted = 0;
    for (const actorId of [args.actorId, args.subjectActorId]) {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      if (profile) {
        await ctx.db.delete(profile._id);
        profilesDeleted += 1;
      }
    }
    return {
      worldId: status.worldId,
      eventsDeleted: events.length,
      memoriesDeleted,
      summariesDeleted: summaries.length,
      compactionStateDeleted: compactionState ? 1 : 0,
      profilesDeleted,
    };
  },
});

export const primeRelationshipStabilityFixture = mutation({
  args: { actorId: v.string(), targetActorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeRelationshipStabilityFixture');
    assertGodotSmokeActorId(args.actorId, 'primeRelationshipStabilityFixture');
    assertGodotSmokeActorId(args.targetActorId, 'primeRelationshipStabilityFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const upsertProfile = async (actorId: string, name: string) => {
      const patch = {
        name,
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 3,
        spiritRoot: 'mixed',
        innerTrait: '中庸',
        outerTrait: '义气',
        cultivationXp: 30,
        mood: 1,
        health: 10,
        maxHealth: 10,
        fatigue: 0,
        spirit: 8,
        reputation: 0,
        inventory: [{ itemId: 'spirit_stone', qty: 6 }],
        mapId: SYSTEM_LAB_MAP_ID,
        currentLocationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        currentIntent: 'C015b relationship stability fixture.',
        persona: 'Isolated local relationship stability actor.',
      };
      const existing = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', actorId))
        .first();
      if (existing) await ctx.db.patch(existing._id, patch);
      else await ctx.db.insert('xianxiaProfiles', { worldId: status.worldId, actorId, ...patch });
    };
    await upsertProfile(args.actorId, 'C015b 关系持有者');
    await upsertProfile(args.targetActorId, 'C015b 关系对象');

    const phases: Record<string, Id<'worldEvents'>[]> = {
      talkSameDay: [],
      talkLong: [],
      gifts: [],
      trades: [],
      assaults: [],
      concurrentReplay: [],
    };
    const addEvent = async (
      phase: keyof typeof phases,
      effectKind: RelationshipEffectKind,
      sourceGameDay: number,
      index: number,
    ) => {
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: status.worldId,
        type: `${C015B_RELATIONSHIP_EVENT_PREFIX}${effectKind}:${sourceGameDay}:${index}`,
        createdAt: Date.now() + index,
        actorIds: [args.actorId],
        targetActorIds: [args.targetActorId],
        locationId: SYSTEM_LAB_REQUEST_LOCATION_ID,
        visibility: 'local',
        summary: `C015b ${effectKind} day ${sourceGameDay} fixture`,
        facts: versionDurableEventFacts({
          fixtureId: `c015b_relationship:${args.actorId}:${effectKind}:${sourceGameDay}:${index}`,
          source: 'restricted_test_fixture',
        }),
        mapId: SYSTEM_LAB_MAP_ID,
      });
      phases[phase].push(eventId);
    };
    for (let index = 0; index < 10; index += 1) await addEvent('talkSameDay', 'routine_talk', 0, index);
    for (let day = 1; day <= 45; day += 1) await addEvent('talkLong', 'routine_talk', day, day);
    for (let index = 0; index < 4; index += 1) await addEvent('gifts', 'gift', 46, index);
    for (let index = 0; index < 20; index += 1) await addEvent('trades', 'trade', 47, index);
    for (let index = 0; index < 3; index += 1) await addEvent('assaults', 'assault', 48 + index, index);
    await addEvent('concurrentReplay', 'quest_completion', 51, 0);
    return { worldId: status.worldId, phases };
  },
});

export const applyRelationshipStabilityFixtureEvents = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.string(),
    eventIds: v.array(v.id('worldEvents')),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.applyRelationshipStabilityFixtureEvents');
    assertGodotSmokeActorId(args.actorId, 'applyRelationshipStabilityFixtureEvents');
    assertGodotSmokeActorId(args.targetActorId, 'applyRelationshipStabilityFixtureEvents');
    if (args.eventIds.length < 1 || args.eventIds.length > 64) throw new Error('relationship_fixture_batch_invalid');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const results = [];
    for (const eventId of args.eventIds) {
      const event = await ctx.db.get(eventId);
      const spec = event ? c015bRelationshipFixtureSpec(event.type) : null;
      if (
        !event ||
        event.worldId !== status.worldId ||
        !event.actorIds.includes(args.actorId) ||
        !(event.targetActorIds ?? []).includes(args.targetActorId) ||
        !spec
      ) {
        throw new Error('relationship_fixture_event_invalid');
      }
      results.push(await applyRelationshipEvent(
        ctx,
        status.worldId,
        args.actorId,
        args.targetActorId,
        spec.baseDelta,
        eventId,
        spec.effectKind,
        spec.sourceGameDay,
        event.createdAt,
      ));
    }
    return results.map((result) => ({
      changeId: result.changeId,
      status: result.status,
      reasonCode: result.reasonCode,
      sourceEventId: result.sourceEventId,
      appliedDelta: result.appliedDelta,
      priorWindowCount: result.priorWindowCount,
    }));
  },
});

export const inspectRelationshipStabilityFixture = query({
  args: { actorId: v.string(), targetActorId: v.string(), gameDay: v.number() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.inspectRelationshipStabilityFixture');
    assertGodotSmokeActorId(args.actorId, 'inspectRelationshipStabilityFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const [relationship, holder] = await Promise.all([
      ctx.db.query('relationships').withIndex('pair', (q) =>
        q.eq('worldId', status.worldId).eq('fromActorId', args.actorId).eq('toActorId', args.targetActorId),
      ).first(),
      ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', args.actorId),
      ).first(),
    ]);
    const changes = (await Promise.all(
      (['routine_talk', 'gift', 'trade', 'quest_completion', 'assault'] as const).map((effectKind) =>
        ctx.db.query('relationshipChanges').withIndex('byDirectionKindDay', (q) =>
          q
            .eq('worldId', status.worldId)
            .eq('fromActorId', args.actorId)
            .eq('toActorId', args.targetActorId)
            .eq('effectKind', effectKind),
        ).collect(),
      ),
    )).flat();
    const missingSourceEventIds: string[] = [];
    for (const change of changes) {
      const event = await ctx.db.get(change.sourceEventId as Id<'worldEvents'>);
      if (!event || event.worldId !== status.worldId) missingSourceEventIds.push(change.sourceEventId);
    }
    const stored = relationship
      ? {
          affinity: relationship.value,
          trust: relationship.trust ?? 0,
          suspicion: relationship.suspicion ?? 0,
          debt: relationship.debt ?? 0,
          fear: relationship.fear ?? 0,
        }
      : { affinity: 0, trust: 0, suspicion: 0, debt: 0, fear: 0 };
    const effective = relationshipDimsAt(
      stored,
      relationship?.lastTouchedDay,
      args.gameDay,
      holder?.innerTrait ?? '',
      holder?.outerTrait ?? '',
    );
    const byKind = Object.fromEntries(
      (['routine_talk', 'gift', 'trade', 'quest_completion', 'assault'] as const).map((effectKind) => {
        const rows = changes.filter((change) => change.effectKind === effectKind);
        return [effectKind, {
          total: rows.length,
          applied: rows.filter((change) => change.status === 'applied').length,
          suppressed: rows.filter((change) => change.status === 'suppressed').length,
        }];
      }),
    );
    return {
      worldId: status.worldId,
      stored,
      effective,
      lastTouchedDay: relationship?.lastTouchedDay,
      lastChangedByEventId: relationship?.lastChangedByEventId,
      changes: changes.length,
      applied: changes.filter((change) => change.status === 'applied').length,
      suppressed: changes.filter((change) => change.status === 'suppressed').length,
      duplicateChangeIds: changes.length - new Set(changes.map((change) => change.changeId)).size,
      missingSourceEventIds,
      byKind,
    };
  },
});

export const cleanupRelationshipStabilityFixture = mutation({
  args: {
    actorId: v.string(),
    targetActorId: v.string(),
    eventIds: v.array(v.id('worldEvents')),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupRelationshipStabilityFixture');
    assertGodotSmokeActorId(args.actorId, 'cleanupRelationshipStabilityFixture');
    assertGodotSmokeActorId(args.targetActorId, 'cleanupRelationshipStabilityFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    let changesDeleted = 0;
    for (const eventId of args.eventIds) {
      const changes = await ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) =>
        q.eq('worldId', status.worldId).eq('sourceEventId', String(eventId)),
      ).collect();
      for (const change of changes) {
        await ctx.db.delete(change._id);
        changesDeleted += 1;
      }
      const event = await ctx.db.get(eventId);
      if (event?.worldId === status.worldId && event.type.startsWith(C015B_RELATIONSHIP_EVENT_PREFIX)) {
        await ctx.db.delete(event._id);
      }
    }
    const relationship = await ctx.db.query('relationships').withIndex('pair', (q) =>
      q.eq('worldId', status.worldId).eq('fromActorId', args.actorId).eq('toActorId', args.targetActorId),
    ).first();
    if (relationship) await ctx.db.delete(relationship._id);
    let profilesDeleted = 0;
    for (const actorId of [args.actorId, args.targetActorId]) {
      const profile = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
        q.eq('worldId', status.worldId).eq('actorId', actorId),
      ).first();
      if (profile) {
        await ctx.db.delete(profile._id);
        profilesDeleted += 1;
      }
    }
    return { worldId: status.worldId, changesDeleted, profilesDeleted };
  },
});

export const primeGodotMapIsolationFixture = mutation({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.primeGodotMapIsolationFixture');
    assertGodotSmokeActorId(args.actorId, 'primeGodotMapIsolationFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const keys = godotMapIsolationFixtureKeys(args.actorId);
    const now = Date.now();
    const locationPatch = {
      name: 'Godot isolation test location',
      kind: 'test_location',
      dangerLevel: 0,
      spiritualEnergy: 1,
      allowedActions: ['cultivate'],
      mapId: keys.otherMapId,
      entryPoints: [{ x: 3, y: 4 }],
      bounds: { x1: 0, y1: 0, x2: 8, y2: 8 },
      description: 'Restricted local fixture for proving Godot map isolation.',
    };
    const existingLocation = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', keys.locationId),
      )
      .first();
    if (existingLocation) await ctx.db.patch(existingLocation._id, locationPatch);
    else {
      await ctx.db.insert('locations', {
        worldId: status.worldId,
        locationId: keys.locationId,
        ...locationPatch,
      });
    }

    const residentPatch = {
      actorId: keys.residentActorId,
      name: 'Isolation Resident',
      role: 'test_resident',
      character: 'f1',
      mapId: keys.otherMapId,
      currentLocationId: keys.locationId,
      displayTile: { x: 3, y: 4 },
      targetTile: { x: 3, y: 4 },
      finalTargetTile: { x: 3, y: 4 },
      pathTiles: [],
      orientation: 0,
      status: 'waiting' as const,
      currentIntent: 'Wait inside the isolated map fixture.',
      activityLabel: 'isolation_test',
      waypointId: keys.locationId,
      nextActionAt: now + 60_000,
      updatedAt: now,
    };
    const existingResident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byResident', (q) =>
        q.eq('worldId', status.worldId).eq('residentId', keys.residentId),
      )
      .first();
    if (existingResident) await ctx.db.patch(existingResident._id, residentPatch);
    else {
      await ctx.db.insert('qinglanResidents', {
        worldId: status.worldId,
        residentId: keys.residentId,
        ...residentPatch,
      });
    }

    const profilePatch = {
      name: 'Isolation Tick Candidate',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      spiritRoot: 'mixed',
      innerTrait: '中庸',
      outerTrait: '任我',
      cultivationXp: 1,
      mood: 0,
      health: 10,
      spirit: 10,
      reputation: 0,
      inventory: [],
      mapId: keys.otherMapId,
      currentLocationId: keys.locationId,
      currentIntent: 'Prove map-scoped agent selection.',
      persona: 'Restricted local fixture for map-scoped tick selection.',
    };
    const existingProfile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', keys.profileActorId))
      .first();
    if (existingProfile) await ctx.db.patch(existingProfile._id, profilePatch);
    else {
      await ctx.db.insert('xianxiaProfiles', {
        worldId: status.worldId,
        actorId: keys.profileActorId,
        ...profilePatch,
      });
    }

    const eventSpecs = [
      {
        type: godotMapIsolationEventTypes[0],
        mapId: 'qinglan' as string | undefined,
        summary: `${keys.fixtureId}: qinglan event`,
      },
      {
        type: godotMapIsolationEventTypes[1],
        mapId: keys.otherMapId as string | undefined,
        summary: `${keys.fixtureId}: other-map event`,
      },
      {
        type: godotMapIsolationEventTypes[2],
        mapId: undefined,
        summary: `${keys.fixtureId}: legacy mapless event`,
      },
    ];
    const eventIds: Id<'worldEvents'>[] = [];
    for (const [index, spec] of eventSpecs.entries()) {
      const eventId = await ctx.db.insert('worldEvents', {
        worldId: status.worldId,
        type: spec.type,
        createdAt: now + index,
        actorIds: [args.actorId],
        targetActorIds: [keys.residentActorId],
        locationId: spec.mapId === keys.otherMapId ? keys.locationId : undefined,
        visibility: 'public',
        summary: spec.summary,
        facts: versionDurableEventFacts({
          fixtureId: keys.fixtureId,
          source: 'restricted_test_fixture',
        }),
        mapId: spec.mapId,
      });
      eventIds.push(eventId);
      await ctx.db.insert('shortMemories', {
        worldId: status.worldId,
        actorId: args.actorId,
        sourceEventId: eventId,
        aboutActorIds: [keys.residentActorId],
        type: spec.type,
        salience: 1,
        createdAt: now + index,
        expiresAt: 1_000_000_000,
        summary: spec.summary,
      });
    }

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      ...keys,
      eventIds,
      qinglanEventId: eventIds[0],
      otherMapEventId: eventIds[1],
      maplessEventId: eventIds[2],
    };
  },
});

export const cleanupGodotMapIsolationFixture = mutation({
  args: { actorId: v.string() },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupGodotMapIsolationFixture');
    assertGodotSmokeActorId(args.actorId, 'cleanupGodotMapIsolationFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');
    const keys = godotMapIsolationFixtureKeys(args.actorId);

    const fixtureEvents: Doc<'worldEvents'>[] = [];
    for (const type of godotMapIsolationEventTypes) {
      const events = await ctx.db
        .query('worldEvents')
        .withIndex('byType', (q) => q.eq('worldId', status.worldId).eq('type', type))
        .collect();
      fixtureEvents.push(
        ...events.filter((event) => {
          const facts: unknown = event.facts;
          return (
            facts !== null &&
            typeof facts === 'object' &&
            !Array.isArray(facts) &&
            (facts as Record<string, unknown>).fixtureId === keys.fixtureId
          );
        }),
      );
    }
    const eventIds = new Set(fixtureEvents.map((event) => String(event._id)));
    for (const event of fixtureEvents) {
      await cancelMemoryFanoutForEvent(ctx, status.worldId, event._id);
    }
    let memoriesDeleted = 0;
    const memories = await ctx.db
      .query('shortMemories')
      .withIndex('byActor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
      .collect();
    for (const memory of memories) {
      if (!eventIds.has(memory.sourceEventId)) continue;
      await ctx.db.delete(memory._id);
      memoriesDeleted += 1;
    }
    for (const event of fixtureEvents) await ctx.db.delete(event._id);

    const resident = await ctx.db
      .query('qinglanResidents')
      .withIndex('byResident', (q) =>
        q.eq('worldId', status.worldId).eq('residentId', keys.residentId),
      )
      .first();
    if (resident) await ctx.db.delete(resident._id);
    const location = await ctx.db
      .query('locations')
      .withIndex('byLocationId', (q) =>
        q.eq('worldId', status.worldId).eq('locationId', keys.locationId),
      )
      .first();
    if (location) await ctx.db.delete(location._id);
    const profile = await ctx.db
      .query('xianxiaProfiles')
      .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', keys.profileActorId))
      .first();
    if (profile) await ctx.db.delete(profile._id);

    return {
      worldId: status.worldId,
      actorId: args.actorId,
      fixtureId: keys.fixtureId,
      eventsDeleted: fixtureEvents.length,
      memoriesDeleted,
      residentDeleted: resident ? 1 : 0,
      locationDeleted: location ? 1 : 0,
      profileDeleted: profile ? 1 : 0,
    };
  },
});

export const cleanupGodotSmokeFixture = mutation({
  args: {
    actorId: v.string(),
    phase: v.optional(
      v.union(
        v.literal('profile'),
        v.literal('personal_goals'),
        v.literal('relationships_from'),
        v.literal('relationships_to'),
        v.literal('memories'),
        v.literal('requests_assignee'),
        v.literal('requests_issuer'),
      ),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertLocalGodotFixtureAccess('godotTesting.cleanupGodotSmokeFixture');
    assertGodotSmokeActorId(args.actorId, 'cleanupGodotSmokeFixture');
    const status = await ctx.db
      .query('worldStatus')
      .filter((q) => q.eq(q.field('isDefault'), true))
      .first();
    if (!status) throw new Error('No default worldStatus found.');

    const phase: GodotSmokeCleanupPhase = args.phase ?? 'profile';
    const limit = godotSmokeCleanupPageLimit(args.limit);
    const counts = {
      profilesDeleted: 0,
      relationshipsDeleted: 0,
      memoriesDeleted: 0,
      requestsDeleted: 0,
      personalGoalsDeleted: 0,
    };

    if (phase === 'profile') {
      const profile = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
        .first();
      if (profile) {
        await ctx.db.delete(profile._id);
        counts.profilesDeleted = 1;
      }
      return cleanupPageResult(status.worldId, args.actorId, phase, true, null, 1, counts);
    }

    if (phase === 'personal_goals') {
      const page = await ctx.db
        .query('personalGoals')
        .withIndex('byActorRevision', (q) =>
          q.eq('worldId', status.worldId).eq('actorId', args.actorId),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const goal of page.page) {
        await ctx.db.delete(goal._id);
        counts.personalGoalsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    if (phase === 'relationships_from') {
      const page = await ctx.db
        .query('relationships')
        .withIndex('from', (q) =>
          q.eq('worldId', status.worldId).eq('fromActorId', args.actorId),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const relationship of page.page) {
        await ctx.db.delete(relationship._id);
        counts.relationshipsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    if (phase === 'relationships_to') {
      const page = await ctx.db
        .query('relationships')
        .withIndex('to', (q) => q.eq('worldId', status.worldId).eq('toActorId', args.actorId))
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const relationship of page.page) {
        await ctx.db.delete(relationship._id);
        counts.relationshipsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    if (phase === 'memories') {
      const actionPage = await ctx.db
        .query('actionRecords')
        .withIndex('actor', (q) => q.eq('worldId', status.worldId).eq('actorId', args.actorId))
        .paginate({ cursor: args.cursor ?? null, numItems: 1 });
      const actionRecord = actionPage.page[0];
      if (actionRecord) {
        const event = await ctx.db
          .query('worldEvents')
          .withIndex('byAction', (q) =>
            q.eq('worldId', status.worldId).eq('actionId', String(actionRecord._id)),
          )
          .first();
        if (event) await cancelMemoryFanoutForEvent(ctx, status.worldId, event._id);
        const memories = event
          ? await ctx.db
              .query('shortMemories')
              .withIndex('bySourceEvent', (q) =>
                q.eq('worldId', status.worldId).eq('sourceEventId', String(event._id)),
              )
              .take(limit)
          : [];
        for (const memory of memories) {
          await ctx.db.delete(memory._id);
          counts.memoriesDeleted += 1;
        }
        if (memories.length === limit) {
          return cleanupPageResult(
            status.worldId,
            args.actorId,
            phase,
            false,
            args.cursor ?? null,
            1,
            counts,
            true,
          );
        }
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        actionPage.isDone,
        actionPage.isDone ? null : actionPage.continueCursor,
        actionPage.page.length,
        counts,
      );
    }

    if (phase === 'requests_assignee') {
      const page = await ctx.db
        .query('requests')
        .withIndex('byAssignee', (q) =>
          q.eq('worldId', status.worldId).eq('assigneeActorId', args.actorId),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: limit });
      for (const request of page.page) {
        await ctx.db.delete(request._id);
        counts.requestsDeleted += 1;
      }
      return cleanupPageResult(
        status.worldId,
        args.actorId,
        phase,
        page.isDone,
        page.isDone ? null : page.continueCursor,
        page.page.length,
        counts,
      );
    }

    const page = await ctx.db
      .query('requests')
      .withIndex('byIssuer', (q) =>
        q.eq('worldId', status.worldId).eq('issuerActorId', args.actorId),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: limit });
    for (const request of page.page) {
      await ctx.db.delete(request._id);
      counts.requestsDeleted += 1;
    }
    return cleanupPageResult(
      status.worldId,
      args.actorId,
      phase,
      page.isDone,
      page.isDone ? null : page.continueCursor,
      page.page.length,
      counts,
    );
  },
});

function cleanupPageResult(
  worldId: Id<'worlds'>,
  actorId: string,
  phase: GodotSmokeCleanupPhase,
  phaseDone: boolean,
  continueCursor: string | null,
  scanned: number,
  counts: {
    profilesDeleted: number;
    relationshipsDeleted: number;
    memoriesDeleted: number;
    requestsDeleted: number;
    personalGoalsDeleted: number;
  },
  repeatCursor = false,
) {
  const nextPhase = phaseDone ? nextGodotSmokeCleanupPhase(phase) : phase;
  return {
    worldId,
    actorId,
    phase,
    phaseDone,
    nextPhase: nextPhase ?? null,
    continueCursor,
    repeatCursor,
    done: phaseDone && nextPhase === undefined,
    scanned,
    ...counts,
    durableTracePreserved: true,
  };
}
