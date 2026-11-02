// Agent 自主意图的「纯逻辑层」（M5）。
// 不依赖 Convex / 不调 LLM：负责①把决策上下文渲染成 prompt ②把 LLM 返回的 JSON
// 解析并校验成一个合法的动作意图，非法则兜底。这样可被 Jest 直接单测。
// 真正的 DB 读取与 DeepSeek 调用在 agent.ts。
// 依据：docs/xianxia-blueprint.md §12（Agent 设计）、§19.1（意图选择 prompt）。

import type { ActionType } from './actionSchema';
import { healingAmount } from './items';
import { MAX_HEALTH, isActorDeceased, isActorIncapacitated } from './lifeStateLogic';
import { AGENT_REST_FATIGUE_THRESHOLD, normalizeFatigue } from './fatigueLogic';
import {
  availableCultivationModes,
  chooseAgentCultivationMode,
  type CultivationMode,
} from './cultivationResourceLogic';
import type { NegotiationTerms } from './negotiationContracts';
import type { LifeObservationV1 } from './lifeObservation';
import { chooseRelationshipVote, chooseUntriedRecipient } from './groupDecisionLogic';
import { SOCIAL_MODEL_PROMPT_VERSION } from './socialModelPolicy';
import { planBeliefFollowup } from './beliefRevisionLogic';
import {
  evaluateAutonomousReserveGate,
  evaluateSurvivalEnvelope,
  type AutonomousReserveGate,
  type SurvivalEnvelope,
  type SurvivalEnvelopeInput,
} from './survivalEnvelopeLogic';
import type {
  ActivePersonalGoal,
  PersonalGoalCandidate,
  PurposeGoalCadenceWindow,
} from './personalGoalContracts';
import type { ObservedWorldPressure } from './worldPressureContracts';
import type { SameLocationSocialSource } from './sameLocationSocialOpportunityLogic';
import type { AcceptedSocialInvitationSource } from './socialInvitationGoalLogic';
import type { RemoteSocialInvitationOpportunity } from './remoteSocialInvitationOpportunityLogic';
import type { PendingSocialInvitationSource } from './socialInvitations';
import type { GroupSocialInitiationRuntimeSource } from './groupSocialInitiations';
import type { TaixuSelfCoreV1 } from './taixuSelfCoreLogic';
import type { SocialConsequenceProjectionV1 } from './socialConsequenceProjectionContracts';
import type { SharedPlanParticipantRuntimeSource } from './sharedPlanLogic';
import type { AuthoritativeDecisionSnapshot } from './runtimeDecisionSnapshot';

export const ACTOR_INCAPACITATED_SKIP_REASON = 'actor_incapacitated' as const;

// 拟人生活 v1：一个人今天怎么过。由世界一侧（人物档案 + 当天心情）给出，规则层只读。
export type HumanDayPlan = {
  // 一天中的钟点（0–24）。从 bedtimeHour 睡到 wakeHour，可跨午夜。
  bedtimeHour: number;
  wakeHour: number;
  // 今天想把心思放在哪儿；没有则不偏。
  focus?: 'cultivation' | 'livelihood' | 'social' | 'idle';
  // 留着送人、不拿去卖的灵草份数（欠着人情要还，或有好友该送了）。
  keepForGift?: number;
  // 别人送的、自己留着的灵草份数：不转送，也不拿去卖。
  receivedGiftsKept?: number;
};

export type PurposeResourceOutlook = {
  // Others who have set out for this source and not yet started gathering.
  // They committed first, so they are ahead of anyone deciding now.
  inTransitActorCount: number;
  // Units promised to other actors' accepted collect requests who have not
  // set out yet: a commission outranks a casual gather.
  heldForRequestCount: number;
  etaGameHours: number;
  // Units projected to be left for this actor on arrival: current stock plus
  // refreshes due by then (capacity-capped), minus active reservations,
  // everyone already on the way and units held for commissions.
  expectedAvailableOnArrival: number;
  // This actor's own most recent goal at this source.
  lastOutcome?: {
    status: 'completed' | 'failed' | 'cancelled' | 'expired';
    reasonCode: string;
    hoursAgo: number;
    // Failed trips in a row at this source, counting the latest one.
    consecutiveFailures?: number;
  };
};

export type AgentContext = {
  // C016e4: production-built, actor-private and versioned read envelope. Existing
  // planners keep consuming the legacy fields until C017 explicitly adopts it.
  lifeObservation?: LifeObservationV1;
  // A1 read-only binding over the existing observation/candidate builders.
  // It is absent for legacy-v1 replay surfaces and grants no new authority.
  authoritativeDecisionSnapshot?: AuthoritativeDecisionSnapshot;
  // C021g2: versioned stable identity for bounded model SelfView. It contains
  // no current health, inventory, location, relationships, secrets or memory.
  // Legacy contexts may omit it and must then report persona_unavailable.
  stableSelfCore?: TaixuSelfCoreV1;
  // C017d server-authoritative high-level continuity. This never grants an
  // action or changes facts; planners may only prefer a still-eligible source.
  personalGoal?: ActivePersonalGoal;
  // C021q4: recent terminal purpose windows gate only repeated world-action
  // admission. They are server-derived and never let a model advance time.
  currentGameHour?: number;
  personalGoalCadences?: PurposeGoalCadenceWindow[];
  // H7 actor-owned, digest-validated result habits may only break an existing
  // same-rank Pi candidate tie. They never create an action or relax a gate.
  resultHabitPreferences?: { candidateId: string; strength: number }[];
  // C017f public same-map environment facts. They suggest choices but never
  // grant an action or mutate actor state.
  worldPressures?: ObservedWorldPressure[];
  self: {
    actorId: string;
    name: string;
    role: string;
    realm: string;
    realmStage: number;
    cultivationXp: number;
    mood: number;
    health: number;
    lifeStatus?: 'alive' | 'deceased';
    maxHealth?: number;
    fatigue?: number;
    spirit: number;
    reputation: number;
    currentLocationId?: string;
    inventory: { itemId: string; qty: number }[];
    innerTrait?: string;
    outerTrait?: string;
    persona?: string; // 精炼行为倾向，影响选动作
  };
  currentLocationName?: string;
  currentLocationSpiritualEnergy?: number;
  cultivationModes?: CultivationMode[];
  others: {
    actorId: string;
    name: string;
    role?: string;
    realm: string;
    relationship: number;
    trust?: number;
    suspicion?: number;
    debt?: number;
    fear?: number;
    // 拟人生活 v1：自己对此人的印象（热心、惹事），来自亲历和传闻。
    impression?: { warmth: number; trouble: number };
  }[];
  recentEvents: string[];
  // C015a deterministic background distilled from archived episodic rows.
  // These are not worldFact ids and must never be cited as verified facts.
  socialSummaries?: string[];
  // 当前地点允许、且第一阶段已实现的动作。
  availableActions: ActionType[];
  // 修为已攒够、可尝试突破（有风险）。
  readyToBreakthrough?: boolean;
  // M7 点亮：让 Agent 能为目标主动 travel / 响应委托。
  knownLocations?: {
    locationId: string;
    name: string;
    allowedActions: string[];
    dangerLevel?: number;
    spiritualEnergy?: number;
  }[];
  // C020d3c6 opt-in keeps previously frozen A/B and soak observations replayable.
  stableLifeSemanticTravelV1?: boolean;
  // C021q2 is explicitly enabled only for ordinary production rule turns.
  // C020/Pi frozen paths omit this and therefore keep the v1 replay surface.
  purposeBoundLifeIntentV2?: boolean;
  // C021g: source-typed, lexicographic candidate lanes. Historical frozen
  // replay fixtures omit this flag and keep their prior byte representation.
  decisionPriorityProjectionV1?: boolean;
  purposeFactsDigest?: string;
  // C021b0b: bounded, server-derived same-location social facts. Proximity or
  // relationship alone never creates one of these records.
  sameLocationSocialSources?: SameLocationSocialSource[];
  // C021b0c: only accepted, server-reserved invitations are projected here.
  // Pending/declined/expired receipts can never become travel candidates.
  acceptedSocialInvitations?: AcceptedSocialInvitationSource[];
  // C021b0c: cross-location warrants are offered as explicit invitations.
  // Pending receipts remain coordination decisions; neither shape can move a
  // body until the target accepts and the receipt is revalidated.
  remoteSocialInvitationOpportunities?: RemoteSocialInvitationOpportunity[];
  pendingSocialInvitations?: PendingSocialInvitationSource[];
  // LWSE-3c: accepted source-bound shared activities. These rows only project
  // a purpose candidate; the existing PersonalGoal/action/body chain remains
  // the sole path to a physical terminal.
  acceptedSharedPlans?: SharedPlanParticipantRuntimeSource[];
  // C021b0d host-derived only: invite/respond/start intents backed by fresh
  // group initiation receipts. The selector cannot invent participants.
  groupSocialCoordinationProposals?: AgentProposal[];
  groupSocialCoordination?: GroupSocialInitiationRuntimeSource[];
  // C021q2 host-precomputed, bounded candidate projection. Keeping the heavy
  // fact planner outside the Pi kernel prevents the portable selector bundle
  // from absorbing host-domain planning code.
  purposeBoundLifeCandidateBundle?: {
    purposeFactsDigest: string;
    // C021f: the single merged Pi surface is pinned independently from the
    // broader purpose-facts digest so selection can be revalidated exactly.
    candidateSetDigest?: string;
    candidates: {
      planner: string;
      candidateId: string;
      legacyOrder: number;
      proposal: AgentProposal;
      personalGoalCandidate?: PersonalGoalCandidate;
      socialConsequenceProjection?: SocialConsequenceProjectionV1;
    }[];
    intentionalIdle?: {
      sourceRef: string;
      reasonCode: 'on_watch' | 'awaiting_customer' | 'sleeping';
      untilGameHour?: number;
    };
    cadenceDeferred?: {
      cadenceKey: string;
      priorGoalId: string;
      nextEligibleGameHour: number;
    }[];
  };
  // 拟人生活 v1（作息、吃一堑长一智、一天一个样）。只有显式打开的上下文才生效，
  // 未打开时候选与打分与原来完全一致。
  humanLifeV1?: boolean;
  humanDay?: HumanDayPlan;
  activeRequests?: {
    requestId?: string;
    revision?: number;
    status?: 'offered' | 'accepted' | 'ready_to_turn_in';
    type: string;
    itemId?: string;
    qty?: number;
    locationId?: string;
    issuerActorId?: string; // W4a：发委托者（在附近则可回报）
    issuerLocationId?: string;
    issuerMapId?: string;
    issuerAliveAndCapable?: boolean;
    issuerBusy?: boolean;
    summary: string;
  }[];
  // W4a：当前昼夜阶段，让「按时辰生活」的日常有据可依。
  phase?: 'dawn' | 'day' | 'dusk' | 'night';
  // W4b-B：本游戏日内已叙谈过的对象 actorId（对话冷却，避免刷屏）。
  recentlyTalked?: string[];
  // C017e：服务端礼物使用记录推导出的冷却对象。只影响候选生成，
  // 真正赠礼时仍由 action 层再次校验。
  giftCooldownTargetActorIds?: string[];
  activeExecution?: {
    executionId: string;
    actionType: string;
    status: 'pending' | 'accepted' | 'acting';
    expiresAt: number;
  };
  activeConversation?: {
    conversationId: string;
    topicId: string;
    otherActorId: string;
    otherActorName: string;
    currentSpeakerActorId?: string;
    turnNumber: number;
    maxTurns: number;
    expiresAt: number;
    recentTurns: {
      turnNumber: number;
      speakerActorId: string;
      speechAct: string;
      utteranceText: string;
    }[];
    visibleFacts: {
      eventId: string;
      summary: string;
      source: 'direct' | 'witness' | 'present' | 'rumor';
    }[];
    beliefs: {
      beliefId: string;
      kind: 'claim' | 'belief' | 'rumor';
      summary: string;
      sourceActorId: string;
      truthStatus?: 'unknown' | 'supported' | 'contradicted';
      revision?: number;
      availableEvidenceEventId?: string;
      availableEvidenceVerdict?: 'confirm' | 'refute' | 'uncertain';
    }[];
  };
  activeGroupConversation?: {
    groupConversationId: string;
    role: 'participant' | 'observer';
    topicId: string;
    participantActorIds: string[];
    observerActorIds: string[];
    currentSpeakerActorId?: string;
    turnNumber: number;
    maxTurns: number;
    expiresAt: number;
    expired: boolean;
    recentTurns: {
      turnNumber: number;
      speakerActorId: string;
      speechAct: string;
      utteranceText: string;
    }[];
    beliefs: {
      beliefId: string;
      kind: 'claim' | 'belief' | 'rumor';
      summary: string;
      sourceActorId: string;
      truthStatus?: 'unknown' | 'supported' | 'contradicted';
      revision?: number;
      availableEvidenceEventId?: string;
      availableEvidenceVerdict?: 'confirm' | 'refute' | 'uncertain';
    }[];
  };
  activeGroupDecision?: {
    openProposal?: {
      proposalId: string;
      proposerActorId: string;
      donorActorId: string;
      recipientActorId: string;
      hasVoted: boolean;
    };
    pendingCommitment?: {
      commitmentId: string;
      donorActorId: string;
      recipientActorId: string;
    };
    attemptedRecipientActorIds?: string[];
    proposalCount?: number;
    mediationExhausted?: boolean;
  };
  activeNegotiation?: {
    negotiationId: string;
    proposalId: string;
    revision: number;
    proposerActorId: string;
    recipientActorId: string;
    terms: NegotiationTerms;
    priorOffers: Array<{
      proposerActorId: string;
      paymentQty?: number;
      extensionGameHours?: number;
    }>;
  };
  negotiationOpportunity?:
    | {
        kind: 'herb_trade';
        sellerActorId: string;
        buyerActorId: string;
        itemQty: number;
        openingPaymentQty: number;
      }
    | {
        kind: 'request_deadline';
        requestId: string;
        issuerActorId: string;
        assigneeActorId: string;
        baseExpiresAtGameHour: number;
        openingExtensionGameHours: number;
      }
    | {
        kind: 'event_compensation';
        harmEventId: string;
        encounterId: string;
        payerActorId: string;
        payeeActorId: string;
        harmDamage: number;
        openingPaymentQty: number;
      };
  negotiationRelationship?: number;
  // 溪谷移动 Agent 只看紧凑空间观察，不接收整张 cellMask。
  currentTile?: { x: number; y: number };
  movementPointRadius?: number;
  knownInteractions?: {
    interactionId: string;
    name: string;
    locationId?: string;
    actions?: string[];
  }[];
  resourceNodes?: {
    resourceNodeId: string;
    name: string;
    itemId: string;
    stock: number;
    available: number;
    seasonalState?: 'growing' | 'dormant';
    seasonalRefreshBlockedUntil?: number;
  }[];
  purposeResourceNodes?: {
    resourceNodeId: string;
    name: string;
    locationId: string;
    itemId: string;
    available: number;
    sourceRevision: string;
    // What this actor can see about the trip: builders that cannot observe
    // it leave it out, and gather candidates then behave as before.
    outlook?: PurposeResourceOutlook;
  }[];
  shopOffers?: {
    shopId: string;
    shopName: string;
    targetActorId: string;
    direction: 'buy' | 'sell';
    itemId: string;
    qty: number;
    unitPrice: number;
    totalPrice: number;
    stock: number;
    capacity: number;
    walletSpiritStones: number;
  }[];
  purposeShopOffers?: {
    shopId: string;
    shopName: string;
    locationId: string;
    targetActorId: string;
    direction: 'buy' | 'sell';
    itemId: string;
    qty: number;
    unitPrice: number;
    totalPrice: number;
    stock: number;
    capacity: number;
    walletSpiritStones: number;
    sourceRevision: string;
  }[];
  combat?: {
    activeEncounterId?: string;
    opponentActorId?: string;
    opponentName?: string;
    opponentHealth?: number;
    lootTargets: {
      encounterId: string;
      actorId: string;
      name: string;
      priorityAllowed: boolean;
      items: { itemId: string; qty: number }[];
    }[];
  };
  valleyRuntime?: {
    hasMovementHistory: boolean;
    activeCommand: boolean;
    fatigue?: number;
    herbNeed?: number;
    nextActionAt?: number;
    recentEventTypes: string[];
  };
};

export type MovementTarget =
  | { kind: 'location'; locationId: string }
  | { kind: 'zone'; zoneId: string }
  | { kind: 'actor'; actorId: string; preferredDistanceTiles?: number }
  | { kind: 'interactable'; interactionId: string }
  | { kind: 'point'; tile: { x: number; y: number } };

// LLM 产出的意图，转成 submitAction 的入参（worldId 由 agent.ts 补）。
export type AgentProposal = {
  type: ActionType;
  targetActorId?: string;
  targetId?: string; // travel 的目标语义地点（系统据此查 entryPoint，Agent 不输出坐标）
  locationId?: string;
  params?: Record<string, unknown>;
  intent: string;
  source: 'agent';
};

export function assertAgentProviderCallAllowed(providerPolicy: 'disabled' | undefined) {
  if (providerPolicy === 'disabled') {
    throw new Error('pi_npc_provider_forbidden');
  }
}

export type ValleyMovementDecision =
  | { kind: 'move'; proposal: AgentProposal }
  | { kind: 'wait'; reason: string };

export type ValleyAutonomyPlan =
  | { kind: 'act'; proposal: AgentProposal }
  | { kind: 'llm'; requireMove: boolean }
  | { kind: 'skip'; reason: string };

export function isAgentInteractionTargetEligible(actor: {
  health: number;
  lifeStatus?: 'alive' | 'deceased';
}) {
  return !isActorDeceased(actor) && !isActorIncapacitated(actor.health);
}

export function planValleyAutonomy(ctx: AgentContext, now: number): ValleyAutonomyPlan | null {
  const runtime = ctx.valleyRuntime;
  if (!runtime || !ctx.self.actorId.startsWith('qinglan_valley_gate:')) return null;
  if (isActorDeceased(ctx.self)) {
    return { kind: 'skip', reason: 'actor_deceased' };
  }
  if (isActorIncapacitated(ctx.self.health)) {
    return { kind: 'skip', reason: ACTOR_INCAPACITATED_SKIP_REASON };
  }
  if (runtime.activeCommand) return { kind: 'skip', reason: 'movement_active' };
  if ((runtime.nextActionAt ?? 0) > now) return { kind: 'skip', reason: 'action_dwell' };

  const pointId = ctx.self.actorId.slice('qinglan_valley_gate:'.length);
  if (pointId === 'resting_disciple') {
    return { kind: 'llm', requireMove: !runtime.hasMovementHistory };
  }
  if (pointId === 'valley_guide') {
    if (runtime.hasMovementHistory) return { kind: 'skip', reason: 'guide_waiting' };
    if (!runtime.recentEventTypes.includes('player_entered_valley')) {
      return { kind: 'skip', reason: 'awaiting_player_event' };
    }
    return {
      kind: 'act',
      proposal: valleyTravelProposal(ctx, 'creek_bridge', '听闻来客入谷，前往桥边接引', 'event'),
    };
  }
  if (pointId === 'herb_gatherer') {
    const fatigue = runtime.fatigue ?? 0;
    const herbNeed = runtime.herbNeed ?? 0;
    if (fatigue >= 75) {
      if (ctx.self.currentLocationId === 'rest_clearing') {
        return { kind: 'skip', reason: 'resting_here' };
      }
      return {
        kind: 'act',
        proposal: valleyTravelProposal(
          ctx,
          'rest_clearing',
          '疲惫已深，去松风歇脚地休息',
          'utility',
          'rest_campfire',
        ),
      };
    }
    if (herbNeed >= 65 && fatigue < 75) {
      if (ctx.self.currentLocationId === 'herb_meadow') {
        return { kind: 'skip', reason: 'gathering_here' };
      }
      return {
        kind: 'act',
        proposal: valleyTravelProposal(
          ctx,
          'herb_meadow',
          '药材不足，去凝露药草坡采药',
          'utility',
          'dew_herb_patch',
        ),
      };
    }
    return { kind: 'skip', reason: 'needs_satisfied' };
  }
  return { kind: 'skip', reason: 'on_watch' };
}

function valleyTravelProposal(
  ctx: AgentContext,
  locationId: string,
  intent: string,
  decisionSource: 'event' | 'utility',
  interactionId?: string,
): AgentProposal {
  return {
    type: 'travel',
    targetId: locationId,
    locationId: ctx.self.currentLocationId,
    intent,
    source: 'agent',
    params: {
      movementTarget: interactionId
        ? { kind: 'interactable', interactionId }
        : { kind: 'location', locationId },
      decisionSource,
    },
  };
}

const LOCAL_ACTIONS: ActionType[] = ['cultivate', 'explore', 'breakthrough', 'flee'];
// 非法/超时输出只能退到低风险本地动作；绝不能把高风险突破当默认兜底。
const SAFE_FALLBACK_ACTIONS: ActionType[] = ['cultivate', 'explore'];
const TARGET_ACTIONS: ActionType[] = [
  'talk',
  'spar',
  'request_teaching',
  'accept_request',
  'decline_request',
  'turn_in_request',
  'gift',
  'trade',
  'steal',
  'attack',
  'loot',
];
const ITEM_GIVE_ACTIONS: ActionType[] = ['gift', 'trade'];

export type AgentSurvivalPlan =
  | { kind: 'pass'; envelope: SurvivalEnvelope }
  | { kind: 'wait'; reasonCode: string; envelope: SurvivalEnvelope }
  | { kind: 'act'; proposal: AgentProposal; envelope: SurvivalEnvelope };

export function survivalEnvelopeInput(ctx: AgentContext): SurvivalEnvelopeInput {
  return {
    health: ctx.self.health,
    maxHealth: ctx.self.maxHealth,
    fatigue: ctx.self.fatigue,
    currentLocationId: ctx.self.currentLocationId,
    inventory: ctx.self.inventory,
    availableActions: ctx.availableActions,
    knownLocations: ctx.knownLocations,
    shopOffers: ctx.shopOffers,
    combat: ctx.combat
      ? {
          activeEncounterId: ctx.combat.activeEncounterId,
          opponentActorId: ctx.combat.opponentActorId,
          opponentName: ctx.combat.opponentName,
          opponentHealth: ctx.combat.opponentHealth,
        }
      : undefined,
  };
}

export function planSurvivalEnvelope(ctx: AgentContext): AgentSurvivalPlan {
  const envelope = evaluateSurvivalEnvelope(survivalEnvelopeInput(ctx));
  const decision = envelope.decision;
  if (decision.kind === 'pass') return { kind: 'pass', envelope };
  if (decision.kind === 'wait') {
    return { kind: 'wait', reasonCode: decision.reasonCode, envelope };
  }
  if (decision.kind === 'flee') {
    return {
      kind: 'act',
      envelope,
      proposal: {
        type: 'flee',
        locationId: ctx.self.currentLocationId,
        intent: `当前冲突风险过高，先脱离与${decision.opponentName ?? '对手'}的交锋`,
        source: 'agent',
      },
    };
  }
  if (decision.kind === 'attack') {
    return {
      kind: 'act',
      envelope,
      proposal: {
        type: 'attack',
        targetActorId: decision.opponentActorId,
        locationId: ctx.self.currentLocationId,
        intent: `仍在冲突中，继续防卫并压制${decision.opponentName ?? '对手'}`,
        source: 'agent',
      },
    };
  }
  if (decision.kind === 'use_item') {
    return {
      kind: 'act',
      envelope,
      proposal: {
        type: 'use_item',
        params: { itemId: decision.itemId },
        intent: '伤势已重，先服用疗伤物稳定气血',
        source: 'agent',
      },
    };
  }
  if (decision.kind === 'rest') {
    return {
      kind: 'act',
      envelope,
      proposal: {
        type: 'rest',
        locationId: decision.locationId,
        intent: `疲劳已达 ${normalizeFatigue(ctx.self.fatigue)}，在${decision.locationName}安静休息`,
        source: 'agent',
      },
    };
  }
  if (decision.kind === 'travel_rest') {
    const valleyInteractionId =
      ctx.self.actorId.startsWith('qinglan_valley_gate:') && decision.locationId === 'rest_clearing'
        ? 'rest_campfire'
        : undefined;
    return {
      kind: 'act',
      envelope,
      proposal: {
        type: 'travel',
        targetId: decision.locationId,
        locationId: ctx.self.currentLocationId,
        params: valleyInteractionId
          ? {
              movementTarget: {
                kind: 'interactable',
                interactionId: valleyInteractionId,
              },
              decisionSource: 'utility',
            }
          : undefined,
        intent: `疲劳已达 ${normalizeFatigue(ctx.self.fatigue)}，前往${decision.locationName}休息`,
        source: 'agent',
      },
    };
  }
  if (decision.kind === 'buy_healing') {
    return {
      kind: 'act',
      envelope,
      proposal: {
        type: 'trade',
        targetActorId: decision.targetActorId,
        locationId: ctx.self.currentLocationId,
        params: {
          offeredItemId: 'spirit_stone',
          offeredQty: decision.totalPrice,
          requestedItemId: decision.itemId,
          requestedQty: decision.quantity,
        },
        intent: `伤势已重，从${decision.shopName}购买疗伤物`,
        source: 'agent',
      },
    };
  }
  return {
    kind: 'act',
    envelope,
    proposal: {
      type: 'travel',
      targetId: decision.locationId,
      locationId: ctx.self.currentLocationId,
      intent: `伤势已重，前往${decision.locationName}寻找疗伤补给`,
      source: 'agent',
    },
  };
}

export function evaluateAgentAutonomousReserveGate(
  ctx: AgentContext,
  proposal: AgentProposal,
): AutonomousReserveGate {
  return evaluateAutonomousReserveGate(survivalEnvelopeInput(ctx), proposal);
}

export function planCombatIntent(ctx: AgentContext): AgentProposal | null {
  const combat = ctx.combat;
  if (!combat) return null;
  if (combat.activeEncounterId && combat.opponentActorId) {
    if (ctx.self.health <= 3 && ctx.availableActions.includes('flee')) {
      return {
        type: 'flee',
        locationId: ctx.self.currentLocationId,
        intent: `气血只余 ${ctx.self.health}，尝试脱离与${combat.opponentName ?? '对手'}的冲突`,
        source: 'agent',
      };
    }
    if (ctx.availableActions.includes('attack')) {
      return {
        type: 'attack',
        targetActorId: combat.opponentActorId,
        locationId: ctx.self.currentLocationId,
        intent: `仍在冲突中，继续压制${combat.opponentName ?? '对手'}`,
        source: 'agent',
      };
    }
  }
  const loot = combat.lootTargets.find(
    (target) => target.priorityAllowed && target.items.some((item) => item.qty > 0),
  );
  const item = loot?.items.find((candidate) => candidate.qty > 0);
  if (loot && item && ctx.availableActions.includes('loot')) {
    return {
      type: 'loot',
      targetActorId: loot.actorId,
      locationId: ctx.self.currentLocationId,
      intent: `从已被击倒的${loot.name}处取走一件${item.itemId}`,
      params: { itemId: item.itemId },
      source: 'agent',
    };
  }
  return null;
}

// C012 非模型基线：只有服务端明确分配到发言权时才提交下一轮。它只用于
// 可重复回归和模型不可用时的显式 rule 模式，不冒充自然语言模型验收。
export function planConversationTurnIntent(ctx: AgentContext): AgentProposal | null {
  const session = ctx.activeConversation;
  if (!session || session.currentSpeakerActorId !== ctx.self.actorId) return null;
  const expectedTurnNumber = session.turnNumber + 1;
  const shouldEnd = session.turnNumber >= 5 || expectedTurnNumber >= session.maxTurns;
  const last = session.recentTurns[session.recentTurns.length - 1];
  const belief = session.beliefs[0];
  const evidence = belief?.availableEvidenceEventId;
  const followup = belief ? planBeliefFollowup(belief) : undefined;
  const speechAct = shouldEnd
    ? 'end_topic'
    : evidence
      ? 'clarify'
      : (followup?.speechAct ?? (last ? 'respond' : 'greet'));
  const utteranceText = shouldEnd
    ? '今日所谈我已记下，改日再续。'
    : evidence && belief
      ? `关于「${belief.summary.slice(0, 80)}」，我找到了一条可核验的服务端记录。`
      : belief && followup?.reasonCode === 'rumor_unverified'
        ? `关于「${belief.summary.slice(0, 80)}」，这只是听闻，你可有可核验的来源？`
        : belief && followup?.reasonCode === 'evidence_refuted'
          ? `关于「${belief.summary.slice(0, 80)}」，已有证据与原说法冲突，我不能把它当成事实。`
          : belief
            ? `关于「${belief.summary.slice(0, 80)}」，我会按现有证据谨慎判断。`
            : last
              ? `你说的「${last.utteranceText.slice(0, 80)}」，我听见了。`
              : '道友请讲。';
  return {
    type: 'talk',
    targetActorId: session.otherActorId,
    locationId: ctx.self.currentLocationId,
    intent: `继续会话 ${session.conversationId} 的第 ${expectedTurnNumber} 轮`,
    params: {
      conversationId: session.conversationId,
      turnId: `${session.conversationId}:turn:${expectedTurnNumber}`,
      expectedTurnNumber,
      speechAct,
      utteranceText,
      addressedActorIds: [session.otherActorId],
      referencedFactIds: evidence ? [evidence] : [],
      referencedBeliefIds: belief ? [belief.beliefId] : [],
      knowledgeReasonCode: evidence ? 'registered_evidence_available' : followup?.reasonCode,
    },
    source: 'agent',
  };
}

// C014a 非模型生产基线：服务端地板是唯一发言授权。观察者只等待；
// participant 在轮到时向其他所有 participant 发言，不可选择性排除听众。
export function planGroupConversationTurnIntent(ctx: AgentContext): AgentProposal | null {
  const session = ctx.activeGroupConversation;
  if (!session || session.role !== 'participant' || !ctx.availableActions.includes('group_talk'))
    return null;
  const expectedTurnNumber = session.turnNumber + 1;
  if (session.expired) {
    return {
      type: 'group_talk',
      locationId: ctx.self.currentLocationId,
      intent: `收束已过期的群体会话 ${session.groupConversationId}`,
      params: {
        operation: 'speak',
        groupConversationId: session.groupConversationId,
        turnId: `${session.groupConversationId}:expiry:${expectedTurnNumber}`,
        expectedTurnNumber,
        speechAct: 'end_topic',
        utteranceText: '会话时限已过，由服务端收束本次群议。',
        addressedActorIds: session.participantActorIds.filter(
          (actorId) => actorId !== ctx.self.actorId,
        ),
        referencedFactIds: [],
        referencedBeliefIds: [],
      },
      source: 'agent',
    };
  }
  if (session.currentSpeakerActorId !== ctx.self.actorId) return null;
  const shouldEnd = session.turnNumber >= 9 || expectedTurnNumber >= session.maxTurns;
  const belief = session.beliefs[0];
  const last = session.recentTurns[session.recentTurns.length - 1];
  const evidence = belief?.availableEvidenceEventId;
  const followup = belief ? planBeliefFollowup(belief) : undefined;
  const speechAct = shouldEnd
    ? 'end_topic'
    : evidence
      ? 'clarify'
      : (followup?.speechAct ?? 'inform');
  const utteranceText = shouldEnd
    ? '诸位的意见已经记下，这一轮商议先到此为止。'
    : evidence && belief
      ? `关于「${belief.summary.slice(0, 80)}」，我有一条规则层可核验的记录。`
      : belief && followup?.reasonCode === 'rumor_unverified'
        ? `关于「${belief.summary.slice(0, 80)}」，目前只是听闻，请先核对来源。`
        : belief && followup?.reasonCode === 'evidence_refuted'
          ? `关于「${belief.summary.slice(0, 80)}」，现有证据与原说法冲突。`
          : belief
            ? `关于「${belief.summary.slice(0, 80)}」，我会依照当前证据判断。`
            : last
              ? `关于「${last.utteranceText.slice(0, 80)}」，我主张先让每个在场者陈述自己所知。`
              : '我主张先让每个在场者陈述自己所知。';
  return {
    type: 'group_talk',
    locationId: ctx.self.currentLocationId,
    intent: `群体会话 ${session.groupConversationId} 第 ${expectedTurnNumber} 轮`,
    params: {
      operation: 'speak',
      groupConversationId: session.groupConversationId,
      turnId: `${session.groupConversationId}:turn:${expectedTurnNumber}`,
      expectedTurnNumber,
      speechAct,
      utteranceText,
      addressedActorIds: session.participantActorIds.filter(
        (actorId) => actorId !== ctx.self.actorId,
      ),
      referencedFactIds: evidence ? [evidence] : [],
      referencedBeliefIds: belief ? [belief.beliefId] : [],
      knowledgeReasonCode: evidence ? 'registered_evidence_available' : followup?.reasonCode,
    },
    source: 'agent',
  };
}

// C014b 结构化群体决定优先于语言轮次：票不占发言权，承诺由 donor 独立履行。
// 首版规则 Agent 对可守恒的一株自有灵草分配投赞成票；事实结果仍由服务端裁决。
export function planGroupDecisionIntent(ctx: AgentContext): AgentProposal | null {
  const session = ctx.activeGroupConversation;
  const decision = ctx.activeGroupDecision;
  if (!session || session.role !== 'participant' || !ctx.availableActions.includes('group_decide'))
    return null;
  const pending = decision?.pendingCommitment;
  if (pending?.donorActorId === ctx.self.actorId) {
    return {
      type: 'group_decide',
      locationId: ctx.self.currentLocationId,
      intent: `履行群体承诺 ${pending.commitmentId}`,
      params: {
        operation: 'execute',
        groupConversationId: session.groupConversationId,
        commitmentId: pending.commitmentId,
      },
      source: 'agent',
    };
  }
  const open = decision?.openProposal;
  if (open && !open.hasVoted) {
    const recipientView = ctx.others.find((other) => other.actorId === open.recipientActorId);
    const vote = chooseRelationshipVote({
      actorId: ctx.self.actorId,
      donorActorId: open.donorActorId,
      recipientActorId: open.recipientActorId,
      relationshipToRecipient: recipientView?.relationship,
      trustToRecipient: recipientView?.trust,
      suspicionToRecipient: recipientView?.suspicion,
      debtToRecipient: recipientView?.debt,
    });
    return {
      type: 'group_decide',
      locationId: ctx.self.currentLocationId,
      intent: `表决群体提案 ${open.proposalId}`,
      params: {
        operation: 'vote',
        groupConversationId: session.groupConversationId,
        proposalId: open.proposalId,
        choice: vote.choice,
      },
      source: 'agent',
    };
  }
  if (!open && !pending) {
    const ownsHerb = ctx.self.inventory.some(
      (item) => item.itemId === 'spirit_herb' && item.qty > 0,
    );
    const recipientActorId = chooseUntriedRecipient({
      donorActorId: ctx.self.actorId,
      participantActorIds: session.participantActorIds,
      attemptedRecipientActorIds: decision?.attemptedRecipientActorIds ?? [],
    });
    if (ownsHerb && recipientActorId) {
      return {
        type: 'group_decide',
        locationId: ctx.self.currentLocationId,
        intent: '提议把自己的一株灵草分给一名在场参与者',
        params: {
          operation: 'propose',
          groupConversationId: session.groupConversationId,
          recipientActorId,
        },
        source: 'agent',
      };
    }
  }
  return null;
}

export function buildConversationTurnMessages(
  ctx: AgentContext,
): { system: string; user: string } | null {
  const session = ctx.activeConversation;
  if (!session || session.currentSpeakerActorId !== ctx.self.actorId) return null;
  const system = [
    `promptContract=${SOCIAL_MODEL_PROMPT_VERSION}`,
    `你是太虚界中的${ctx.self.name}。你正在与${session.otherActorName}进行多轮交谈。`,
    ctx.self.persona ? `你的性情：${ctx.self.persona}` : '',
    '你只负责本轮表达；不能直接修改关系、任务、奖励或世界事实，这些全部由服务端裁决。',
    '只能引用下方“你确实知道的事实”和“你的信念”。一句话只是主张，不会自动成为世界事实。',
    'speechAct 只能是 greet/ask/inform/request/respond/refuse/clarify/end_topic。',
    session.turnNumber < 6
      ? '为了形成完整交流，双方至少说满6轮；第6轮之前不要用 end_topic。'
      : '话题已经自然完成时可以用 end_topic 收束。',
    '只输出 JSON：{"speechAct":"respond","utteranceText":"...","referencedFactIds":[],"referencedBeliefIds":[]}',
  ]
    .filter(Boolean)
    .join('\n');
  const turns = session.recentTurns.length
    ? session.recentTurns
        .map((turn) => `  ${turn.turnNumber}. ${turn.speakerActorId}: ${turn.utteranceText}`)
        .join('\n')
    : '  （无）';
  const facts = session.visibleFacts.length
    ? session.visibleFacts
        .map((fact) => `  - ${fact.summary}（eventId=${fact.eventId}，来源=${fact.source}）`)
        .join('\n')
    : '  （无）';
  const beliefs = session.beliefs.length
    ? session.beliefs
        .map(
          (belief) =>
            `  - ${belief.summary}（beliefId=${belief.beliefId}，类型=${belief.kind}，` +
            `真值=${belief.truthStatus ?? 'unknown'}，revision=${belief.revision ?? 1}）`,
        )
        .join('\n')
    : '  （无）';
  return {
    system,
    user: [
      `话题：${session.topicId}`,
      `轮次：下一轮 ${session.turnNumber + 1}/${session.maxTurns}`,
      '最近发言：',
      turns,
      '你确实知道的事实：',
      facts,
      '你的信念：',
      beliefs,
      '请生成本轮 JSON。',
    ].join('\n'),
  };
}

export function ownedHealingItemId(actor: {
  inventory: { itemId: string; qty: number }[];
}): string | null {
  return (
    actor.inventory.find((item) => item.qty > 0 && healingAmount(item.itemId) !== null)?.itemId ??
    null
  );
}

// 稀缺疗伤丹采用确定性 Utility 自救：只有气血不高于一半时才自动消耗，
// 受伤但未到危险线时仍允许 LLM/玩家自主决定是否使用。
export function planSelfCareIntent(ctx: AgentContext): AgentProposal | null {
  const { self } = ctx;
  if (isActorIncapacitated(self.health) || !ctx.availableActions.includes('use_item')) return null;
  const maxHealth = Math.max(1, self.maxHealth ?? MAX_HEALTH);
  if (self.health >= maxHealth || self.health / maxHealth > 0.5) return null;
  const itemId = ownedHealingItemId(self);
  if (!itemId) return null;
  return {
    type: 'use_item',
    params: { itemId },
    intent: '伤势已重，先服用疗伤丹稳定气血',
    source: 'agent',
  };
}

// C005：资源来自有限节点，Agent 只能选择一个观察中真实存在且尚有可预约
// 库存的节点。它不直接增减库存，也不猜测坐标；后续仍由 submitAction 与
// ActionExecution 在开始、完成两个时点重新校验。
export function planGatherIntent(ctx: AgentContext): AgentProposal | null {
  if (isActorIncapacitated(ctx.self.health) || !ctx.availableActions.includes('gather')) {
    return null;
  }
  const node = (ctx.resourceNodes ?? [])
    .filter((candidate) => candidate.available > 0)
    .sort((a, b) => a.resourceNodeId.localeCompare(b.resourceNodeId))[0];
  if (!node) return null;
  const owned = ctx.self.inventory.find((item) => item.itemId === node.itemId)?.qty ?? 0;
  if (owned >= 1) return null;
  return {
    type: 'gather',
    locationId: ctx.self.currentLocationId,
    params: { resourceNodeId: node.resourceNodeId },
    intent: `行囊中尚无${node.itemId}，从${node.name}采集一份`,
    source: 'agent',
  };
}

// C009：Production Agent 只从服务端给出的真实商店报价中选择交易。
// 首版保守地出售一份已采得灵草，不自动购买或清空背包，避免规则 Utility
// 替 LLM/玩家作高成本消费决定。
export function planShopTradeIntent(ctx: AgentContext): AgentProposal | null {
  if (isActorIncapacitated(ctx.self.health) || !ctx.availableActions.includes('trade')) return null;
  const offer = (ctx.shopOffers ?? [])
    .filter((candidate) => candidate.direction === 'sell' && candidate.itemId === 'spirit_herb')
    .sort((a, b) => a.shopId.localeCompare(b.shopId))[0];
  if (!offer) return null;
  return {
    type: 'trade',
    targetActorId: offer.targetActorId,
    locationId: ctx.self.currentLocationId,
    params: {
      offeredItemId: offer.itemId,
      offeredQty: offer.qty,
      requestedItemId: 'spirit_stone',
      requestedQty: offer.totalPrice,
    },
    intent: `将采得的${offer.itemId}卖给${offer.shopName}，换取 ${offer.totalPrice} 枚灵石`,
    source: 'agent',
  };
}

export function planRestIntent(ctx: AgentContext): AgentProposal | null {
  if (isActorIncapacitated(ctx.self.health)) return null;
  const fatigue = normalizeFatigue(ctx.self.fatigue);
  if (fatigue < AGENT_REST_FATIGUE_THRESHOLD) return null;
  const restLocations = (ctx.knownLocations ?? [])
    .filter((location) => location.allowedActions.includes('rest'))
    .sort((a, b) => a.locationId.localeCompare(b.locationId));
  // Multiple semantic rest zones may coexist in the graybox/world. If the
  // actor is already standing in one, resting in place must win over a
  // lexicographically earlier remote zone; otherwise a tired Agent can leave a
  // valid bed merely because another rest location was seeded later.
  const restLocation =
    restLocations.find((location) => location.locationId === ctx.self.currentLocationId) ??
    restLocations[0];
  if (!restLocation) return null;
  if (ctx.self.currentLocationId !== restLocation.locationId) {
    return {
      type: 'travel',
      targetId: restLocation.locationId,
      locationId: ctx.self.currentLocationId,
      intent: `疲劳已达 ${fatigue}，前往${restLocation.name}休息`,
      source: 'agent',
    };
  }
  if (!ctx.availableActions.includes('rest')) return null;
  return {
    type: 'rest',
    locationId: restLocation.locationId,
    intent: `疲劳已达 ${fatigue}，在${restLocation.name}安静休息`,
    source: 'agent',
  };
}

// Agent 只选目录中真实可用的修炼模式。规则/日程没有显式指定时，保守 Utility
// 仅在高灵气且至少持有 12 枚灵石时消耗一枚；聚气丹永不被 Utility 自动使用。
export function applyAgentCultivationMode(
  proposal: AgentProposal,
  ctx: AgentContext,
): AgentProposal {
  if (proposal.type !== 'cultivate') return proposal;
  const explicit = proposal.params?.cultivationMode;
  const modes = ctx.cultivationModes ?? availableCultivationModes(ctx.self.inventory);
  const mode =
    typeof explicit === 'string' && modes.includes(explicit as CultivationMode)
      ? (explicit as CultivationMode)
      : chooseAgentCultivationMode({
          spiritualEnergy: ctx.currentLocationSpiritualEnergy ?? 0,
          inventory: ctx.self.inventory,
        });
  return {
    ...proposal,
    params: { ...(proposal.params ?? {}), cultivationMode: mode },
  };
}

// —— M7 战略意图（纯逻辑，先于 LLM）——
// 为「具体目标」主动 travel / 取物：响应委托。无明确目标则返回 null，交给 LLM 在本地动作里选。
// 这不是 planner/GOAP，只是把已建的 travel + 委托接成最小目标导向闭环。Agent 仍只出语义目标。
export function planStrategicIntent(ctx: AgentContext): AgentProposal | null {
  const self = ctx.self;
  if (isActorIncapacitated(self.health)) return null;
  const known = ctx.knownLocations ?? [];
  const reqs = ctx.activeRequests ?? [];
  const here = self.currentLocationId;
  const has = (itemId: string, qty = 1) =>
    (self.inventory.find((i) => i.itemId === itemId)?.qty ?? 0) >= qty;
  const locExists = (id: string) => known.some((l) => l.locationId === id);
  const travelTo = (
    id: string,
    why: string,
    request?: NonNullable<AgentContext['activeRequests']>[number],
  ): AgentProposal => ({
    type: 'travel',
    targetId: id,
    intent: why,
    source: 'agent',
    locationId: here,
    params: request?.requestId
      ? { requestId: request.requestId, expectedRevision: request.revision }
      : undefined,
  });

  for (const r of reqs) {
    if (r.status === 'ready_to_turn_in' && r.issuerActorId && r.requestId) {
      if (here !== r.issuerLocationId && r.issuerLocationId && locExists(r.issuerLocationId)) {
        return travelTo(r.issuerLocationId, `委托已经办妥，返回发起者处交付`, r);
      }
      if (
        here === r.issuerLocationId &&
        ctx.others.some((other) => other.actorId === r.issuerActorId) &&
        ctx.availableActions.includes('turn_in_request')
      ) {
        return {
          type: 'turn_in_request',
          targetActorId: r.issuerActorId,
          locationId: here,
          params: { requestId: r.requestId, expectedRevision: r.revision },
          intent: '当面交付已经完成的委托并领取规则核定的奖励',
          source: 'agent',
        };
      }
      continue;
    }
    // offered 必须由 Agent/玩家显式选择接受或拒绝；战略 Utility 不替它作决定。
    if (r.status === 'offered') continue;
    // 探索类委托：人不在目标地点 → 前往；已在 → 探索推进（到达即由 tick 结算）。
    if (r.type === 'explore_location' && r.locationId) {
      if (here !== r.locationId && locExists(r.locationId))
        return travelTo(r.locationId, `受托前往目标之地`, r);
      if (here === r.locationId && ctx.availableActions.includes('explore')) {
        return {
          type: 'explore',
          intent: '履行探索委托',
          source: 'agent',
          locationId: here,
          params: { requestId: r.requestId, expectedRevision: r.revision },
        };
      }
    }
    // 采集类委托且尚缺其物：去真实允许 gather 的地点；
    // 抵达后必须选择同物品的可预约节点，不再用 explore 凭空生成。
    if (r.type === 'collect_item' && r.itemId && !has(r.itemId, r.qty ?? 1)) {
      const gatherLoc = known.find((l) => l.allowedActions.includes('gather'));
      if (gatherLoc) {
        if (here !== gatherLoc.locationId)
          return travelTo(gatherLoc.locationId, `为委托采办所需之物`, r);
        const node = (ctx.resourceNodes ?? [])
          .filter((candidate) => candidate.itemId === r.itemId && candidate.available > 0)
          .sort((a, b) => a.resourceNodeId.localeCompare(b.resourceNodeId))[0];
        if (ctx.availableActions.includes('gather') && node) {
          return {
            type: 'gather',
            intent: '从真实资源点采办委托所需之物',
            source: 'agent',
            locationId: here,
            params: {
              resourceNodeId: node.resourceNodeId,
              requestId: r.requestId,
              expectedRevision: r.revision,
            },
          };
        }
      }
    }
    // collect_item 且已持有 → 等 tick 只标记 ready；绝不自动发奖。
  }
  return null;
}

// —— 构造给 LLM 的 prompt（§19.1 强调：不能直接改世界、只能选可用动作、输出 JSON）——
export function buildAgentMessages(ctx: AgentContext): { system: string; user: string } {
  const s = ctx.self;
  const system = [
    `你是修仙世界「太虚界」中的角色：${s.name}（${s.role}，${s.realm} ${s.realmStage} 层）。`,
    s.persona ? `你的性情：${s.persona}` : '',
    '规则：',
    '- 你不能直接控制世界，只能从【可用动作】里选择一个，提交你的意图。',
    '- 你不知道视野外的信息，不要编造不存在的角色、地点或物品。',
    '- 行动要符合你的身份、境界、心境与处境。',
    '- 没有特别合适的行动时，就选择 cultivate（修炼）。',
    (ctx.activeRequests ?? []).some((request) => request.status === 'offered')
      ? '- 你正面对一桩待答复委托；本次必须自主选择 accept_request 或 decline_request，并逐字带回观察中的 requestId、revision 与 issuer targetActorId。'
      : '',
    '- 必须只输出一个 JSON 对象，形如：',
    '  {"type":"<动作>","targetActorId":"<目标角色actorId,可空>","params":{"itemId":"<物品,可空>"},"reason":"<一句话理由>"}',
  ]
    .filter(Boolean)
    .join('\n');

  const others =
    ctx.others.length > 0
      ? ctx.others
          .map((o) => `  - ${o.name}（actorId=${o.actorId}，${o.realm}，关系 ${o.relationship}）`)
          .join('\n')
      : '  （附近无人）';
  const inv =
    s.inventory.length > 0 ? s.inventory.map((i) => `${i.itemId}×${i.qty}`).join('、') : '（无）';
  const events =
    ctx.recentEvents.length > 0 ? ctx.recentEvents.map((e) => `  - ${e}`).join('\n') : '  （无）';
  const socialSummaries =
    (ctx.socialSummaries ?? []).length > 0
      ? (ctx.socialSummaries ?? []).map((summary) => `  - ${summary}`).join('\n')
      : '  （无）';
  const places =
    (ctx.knownLocations ?? []).length > 0
      ? (ctx.knownLocations ?? [])
          .map((l) => `  - ${l.name}（id=${l.locationId}，可：${l.allowedActions.join('/')}）`)
          .join('\n')
      : '  （未知）';
  const quests =
    (ctx.activeRequests ?? []).length > 0
      ? (ctx.activeRequests ?? [])
          .map(
            (r) =>
              `  - [${r.status ?? 'accepted'}] ${r.summary}（requestId=${r.requestId ?? 'legacy'}，revision=${r.revision ?? 1}，issuer=${r.issuerActorId ?? '未知'}）`,
          )
          .join('\n')
      : '  （无）';
  const resources =
    (ctx.resourceNodes ?? []).length > 0
      ? (ctx.resourceNodes ?? [])
          .map(
            (node) =>
              `  - ${node.name}（resourceNodeId=${node.resourceNodeId}，${node.itemId}，库存 ${node.stock}，可预约 ${node.available}${node.seasonalState ? `，季节状态 ${node.seasonalState}` : ''}）`,
          )
          .join('\n')
      : '  （无）';
  const shopOffers =
    (ctx.shopOffers ?? []).length > 0
      ? (ctx.shopOffers ?? [])
          .map(
            (offer) =>
              `  - ${offer.shopName}（shopId=${offer.shopId}，merchant=${offer.targetActorId}，${offer.direction} ${offer.itemId}×${offer.qty}，总价 ${offer.totalPrice} 灵石，库存 ${offer.stock}/${offer.capacity}，店资 ${offer.walletSpiritStones}）`,
          )
          .join('\n')
      : '  （无可成交报价）';
  const combat = ctx.combat;
  const combatSummary = combat?.activeEncounterId
    ? `active encounter=${combat.activeEncounterId}，对手=${combat.opponentName ?? combat.opponentActorId}，对手气血=${combat.opponentHealth ?? '未知'}`
    : '无 active encounter';
  const lootSummary =
    (combat?.lootTargets ?? []).length > 0
      ? (combat?.lootTargets ?? [])
          .map(
            (target) =>
              `${target.name}(actorId=${target.actorId}, encounter=${target.encounterId}, priority=${target.priorityAllowed}, items=${target.items.map((item) => `${item.itemId}×${item.qty}`).join('、') || '无'})`,
          )
          .join('；')
      : '无可追溯失能目标';

  const user = [
    `当前地点：${ctx.currentLocationName ?? '未知'}`,
    `地点灵气：${ctx.currentLocationSpiritualEnergy ?? 0}/10`,
    `你的状态：修为 ${s.cultivationXp}，心境 ${s.mood}，气血 ${s.health}/${s.maxHealth ?? MAX_HEALTH}，神识 ${s.spirit}，声望 ${s.reputation}`,
    `疲劳：${normalizeFatigue(s.fatigue)}/100`,
    `你的物品：${inv}`,
    '附近的人：',
    others,
    '最近发生：',
    events,
    '长期社会印象（仅为有来源经历的压缩背景，不等于已证实世界事实）：',
    socialSummaries,
    '你身上的委托：',
    quests,
    '可去之处：',
    places,
    '当前资源点：',
    resources,
    '当前商店报价：',
    shopOffers,
    `当前冲突：${combatSummary}`,
    `可掠夺目标：${lootSummary}`,
    `可用动作：${ctx.availableActions.join('、')}`,
    `可用修炼模式：${(ctx.cultivationModes ?? ['ambient']).join('、')}`,
    ctx.readyToBreakthrough
      ? '【你修为已足，可尝试 breakthrough 突破境界——成功则境界提升，但失败伤身、小概率走火入魔】'
      : '',
    '需要目标角色的动作：talk/spar/request_teaching/gift/trade/steal/attack/loot/accept_request/decline_request/turn_in_request（请给 targetActorId）。',
    '委托动作只能逐字选择观察中的 requestId 和 revision；offered 可 accept_request 或 decline_request，ready_to_turn_in 才可 turn_in_request。',
    'attack/flee/loot 只选择高层意图；命中、伤害、逃跑成败、物品与追责全部由规则层裁决。',
    'gift 需要 params.itemId（你的物品之一）。',
    'use_item 仅用于自用治疗类丹药，必须给 params.itemId，恢复量由规则和物品目录决定。',
    'gather 必须选择“当前资源点”中可预约的真实节点，并给 params.resourceNodeId。',
    'inspect 必须选择当前位置“已知交互物”中明确允许 inspect 的对象，并给 params.interactionId。',
    'trade 若针对商店，只能逐字选择“当前商店报价”中的 merchant、方向、物品、数量和总价；你不能自行定价。',
    'cultivate 可给 params.cultivationMode，但只能从“可用修炼模式”选择；不提供时由保守 Utility 决定。',
    '若你想做的事此地不可为（如想交易却不在坊市），可输出 {"type":"travel","targetId":"<可去之处的id>"} 先前往。',
    '请输出你的选择（仅 JSON）。',
  ]
    .filter(Boolean)
    .join('\n');

  return { system, user };
}

// 溪谷的真实 LLM 只选择「等待」或一个受约束移动目标。首个探针可要求必须移动，
// 但目的地仍由模型从实时可达候选中选择，测试不会提前写死目标。
export function buildValleyMovementMessages(
  ctx: AgentContext,
  options: { requireMove?: boolean } = {},
): { system: string; user: string } {
  const radius = Math.max(1, Math.min(12, Math.floor(ctx.movementPointRadius ?? 12)));
  const system = [
    `你是太虚界溪谷中的${ctx.self.name}。`,
    ctx.self.persona ? `你的性情：${ctx.self.persona}` : '',
    '你只负责选择下一步意图与目标，不能直接设置身体坐标、速度、路径或动画。',
    '只能使用观察中列出的地点、角色、交互物，或当前坐标附近允许半径内的整数格。',
    options.requireMove
      ? '这是首次自主移动验证：必须从“可选择的其他地点”中自主选择一个 location 并 move；首次不得 wait 或选择 point。'
      : '若此刻没有值得移动的理由，可以选择 wait；等待不是失败。',
    '只输出一个 JSON 对象，不要输出解释文字。',
    '移动格式：{"decision":"move","target":{"kind":"location","locationId":"..."},"reason":"..."}',
    '附近点格式：{"decision":"move","target":{"kind":"point","tile":{"x":12,"y":9}},"reason":"..."}',
    ...(options.requireMove ? [] : ['等待格式：{"decision":"wait","reason":"..."}']),
  ]
    .filter(Boolean)
    .join('\n');

  const locations = (ctx.knownLocations ?? [])
    .filter((location) => location.locationId !== ctx.self.currentLocationId)
    .map((location) => `${location.name}(locationId=${location.locationId})`)
    .join('、');
  const actors = ctx.others.map((actor) => `${actor.name}(actorId=${actor.actorId})`).join('、');
  const interactions = (ctx.knownInteractions ?? [])
    .map((interaction) => `${interaction.name}(interactionId=${interaction.interactionId})`)
    .join('、');
  const tile = ctx.currentTile
    ? `(${ctx.currentTile.x},${ctx.currentTile.y})`
    : '未知（不可选择 point）';
  const user = [
    `当前位置：${ctx.currentLocationName ?? ctx.self.currentLocationId ?? '未知'}，格子 ${tile}`,
    `可选择的其他地点：${locations || '无'}`,
    `附近角色：${actors || '无'}`,
    `已知交互物：${interactions || '无'}`,
    `point 目标限制：距离当前格不超过 ${radius} 格，必须为整数格；最终通行与可达性由规则层裁决。`,
    `最近事件：${ctx.recentEvents.join('；') || '无'}`,
  ].join('\n');
  return { system, user };
}

export function parseValleyMovementDecision(
  content: string,
  ctx: AgentContext,
  options: { requireMove?: boolean } = {},
): ValleyMovementDecision | null {
  if (isActorIncapacitated(ctx.self.health)) return null;
  const raw = extractJson(content);
  if (!raw) return null;
  const decision =
    typeof raw.decision === 'string' ? raw.decision : raw.type === 'travel' ? 'move' : '';
  const reason =
    typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim().slice(0, 240)
      : '观察溪谷后作出选择';
  if (decision === 'wait') {
    return options.requireMove ? null : { kind: 'wait', reason };
  }
  if (decision !== 'move') return null;
  const target = parseMovementTarget(raw.target ?? raw.movementTarget ?? raw, ctx);
  if (!target) return null;
  if (options.requireMove && target.kind !== 'location' && target.kind !== 'zone') return null;
  const targetId =
    target.kind === 'location'
      ? target.locationId
      : target.kind === 'zone'
        ? target.zoneId
        : undefined;
  return {
    kind: 'move',
    proposal: {
      type: 'travel',
      targetId,
      locationId: ctx.self.currentLocationId,
      intent: reason,
      source: 'agent',
      params: { movementTarget: target, decisionSource: 'llm' },
    },
  };
}

// —— 解析并校验 LLM 输出，非法一律兜底为安全动作（§19.1）——
export function parseProposal(content: string, ctx: AgentContext): AgentProposal | null {
  if (isActorIncapacitated(ctx.self.health)) return null;
  const raw = extractJson(content);
  if (!raw) return fallback(ctx);

  const type = raw.type as ActionType;
  const intent =
    typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.trim() : '依心而行';

  // travel 不在地点的 availableActions 里，单独校验：目标须是已知语义地点（绝不收坐标）。
  if (type === 'travel') {
    const dest =
      typeof raw.targetId === 'string'
        ? raw.targetId
        : typeof raw.targetLocationId === 'string'
          ? raw.targetLocationId
          : undefined;
    if (
      dest &&
      dest !== ctx.self.currentLocationId &&
      (ctx.knownLocations ?? []).some((l) => l.locationId === dest)
    ) {
      return {
        type: 'travel',
        targetId: dest,
        intent,
        source: 'agent',
        locationId: ctx.self.currentLocationId,
      };
    }
    const movementTarget = parseMovementTarget(raw.movementTarget ?? raw.target, ctx);
    if (movementTarget) {
      return {
        type: 'travel',
        targetId:
          movementTarget.kind === 'location'
            ? movementTarget.locationId
            : movementTarget.kind === 'zone'
              ? movementTarget.zoneId
              : undefined,
        params: { movementTarget, decisionSource: 'llm' },
        intent,
        source: 'agent',
        locationId: ctx.self.currentLocationId,
      };
    }
    return fallback(ctx);
  }

  if (!ctx.availableActions.includes(type)) return fallback(ctx);

  const base: AgentProposal = {
    type,
    intent,
    source: 'agent',
    locationId: ctx.self.currentLocationId,
  };

  if (type === 'use_item') {
    const itemId = pickItem(raw);
    const maxHealth = Math.max(1, ctx.self.maxHealth ?? MAX_HEALTH);
    const owned = ctx.self.inventory.some((item) => item.itemId === itemId && item.qty > 0);
    if (!itemId || healingAmount(itemId) === null || !owned || ctx.self.health >= maxHealth) {
      return fallback(ctx);
    }
    return { type, intent, source: 'agent', params: { itemId } };
  }

  if (type === 'gather') {
    const params =
      raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
        ? (raw.params as Record<string, unknown>)
        : {};
    const resourceNodeId =
      typeof params.resourceNodeId === 'string'
        ? params.resourceNodeId
        : typeof raw.resourceNodeId === 'string'
          ? raw.resourceNodeId
          : undefined;
    const node = (ctx.resourceNodes ?? []).find(
      (candidate) => candidate.resourceNodeId === resourceNodeId && candidate.available > 0,
    );
    return node ? { ...base, params: { resourceNodeId: node.resourceNodeId } } : fallback(ctx);
  }

  if (type === 'inspect') {
    const params =
      raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
        ? (raw.params as Record<string, unknown>)
        : {};
    const interactionId =
      typeof params.interactionId === 'string'
        ? params.interactionId
        : typeof raw.interactionId === 'string'
          ? raw.interactionId
          : undefined;
    const interaction = (ctx.knownInteractions ?? []).find(
      (candidate) =>
        candidate.interactionId === interactionId &&
        candidate.locationId === ctx.self.currentLocationId &&
        candidate.actions?.includes('inspect'),
    );
    return interaction
      ? { ...base, params: { interactionId: interaction.interactionId } }
      : fallback(ctx);
  }

  if (type === 'cultivate') {
    const params =
      raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
        ? (raw.params as Record<string, unknown>)
        : {};
    const requestedMode =
      typeof params.cultivationMode === 'string'
        ? params.cultivationMode
        : typeof raw.cultivationMode === 'string'
          ? raw.cultivationMode
          : undefined;
    if (
      requestedMode !== undefined &&
      !(ctx.cultivationModes ?? availableCultivationModes(ctx.self.inventory)).includes(
        requestedMode as CultivationMode,
      )
    ) {
      return fallback(ctx);
    }
    return requestedMode ? { ...base, params: { cultivationMode: requestedMode } } : base;
  }

  if (LOCAL_ACTIONS.includes(type)) return base;

  if (TARGET_ACTIONS.includes(type)) {
    const targetActorId = typeof raw.targetActorId === 'string' ? raw.targetActorId : undefined;
    const combatLootTarget = targetActorId
      ? ctx.combat?.lootTargets.find((target) => target.actorId === targetActorId)
      : undefined;
    const targetKnown =
      !!targetActorId &&
      (ctx.others.some((o) => o.actorId === targetActorId) ||
        (type === 'loot' && !!combatLootTarget?.priorityAllowed));
    if (!targetKnown) return fallback(ctx); // 目标缺失/不可见 → 兜底
    const proposal: AgentProposal = { ...base, targetActorId };

    if (['accept_request', 'decline_request', 'turn_in_request'].includes(type)) {
      const params =
        raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
          ? (raw.params as Record<string, unknown>)
          : {};
      const requestId =
        typeof params.requestId === 'string'
          ? params.requestId
          : typeof raw.requestId === 'string'
            ? raw.requestId
            : undefined;
      const request = (ctx.activeRequests ?? []).find(
        (candidate) =>
          candidate.requestId === requestId && candidate.issuerActorId === targetActorId,
      );
      const statusMatches =
        !!request &&
        ((type === 'turn_in_request' && request.status === 'ready_to_turn_in') ||
          ((type === 'accept_request' || type === 'decline_request') &&
            request.status === 'offered'));
      if (!requestId || !statusMatches) return fallback(ctx);
      proposal.params = { requestId, expectedRevision: request.revision ?? 1 };
      return proposal;
    }

    // gift：自动用自己的第一件物品；无物品则兜底。
    if (type === 'gift') {
      const itemId = pickItem(raw) ?? ctx.self.inventory[0]?.itemId;
      if (!itemId) return fallback(ctx);
      proposal.params = { itemId };
    } else if (ITEM_GIVE_ACTIONS.includes(type) || type === 'steal' || type === 'loot') {
      // trade/steal：物品须由 LLM 给出（可能涉及对方物品）；缺失则透传交给规则层裁决/拒绝。
      const p: Record<string, string | number> = {};
      const itemId = pickItem(raw);
      if (itemId) p.itemId = itemId;
      if (typeof raw.offeredItemId === 'string') p.offeredItemId = raw.offeredItemId;
      if (typeof raw.requestedItemId === 'string') p.requestedItemId = raw.requestedItemId;
      if (type === 'trade' && (!p.offeredItemId || !p.requestedItemId)) return fallback(ctx);
      if (type === 'trade' && (ctx.shopOffers ?? []).length > 0) {
        const matching = (ctx.shopOffers ?? []).find(
          (offer) =>
            offer.targetActorId === targetActorId &&
            ((offer.direction === 'buy' &&
              p.offeredItemId === 'spirit_stone' &&
              p.requestedItemId === offer.itemId) ||
              (offer.direction === 'sell' &&
                p.offeredItemId === offer.itemId &&
                p.requestedItemId === 'spirit_stone')),
        );
        if (!matching) return fallback(ctx);
        proposal.params =
          matching.direction === 'buy'
            ? {
                offeredItemId: 'spirit_stone',
                offeredQty: matching.totalPrice,
                requestedItemId: matching.itemId,
                requestedQty: matching.qty,
              }
            : {
                offeredItemId: matching.itemId,
                offeredQty: matching.qty,
                requestedItemId: 'spirit_stone',
                requestedQty: matching.totalPrice,
              };
        return proposal;
      }
      if (type === 'steal' && !p.itemId) return fallback(ctx);
      if (type === 'loot') {
        const selected = combatLootTarget?.items.find(
          (item) => item.itemId === p.itemId && item.qty > 0,
        );
        if (!selected) return fallback(ctx);
        proposal.params = { itemId: selected.itemId };
        return proposal;
      }
      proposal.params = p;
    }
    return proposal;
  }

  return fallback(ctx);
}

function parseMovementTarget(value: unknown, ctx: AgentContext): MovementTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const kind = raw.kind;
  if (kind === 'location') {
    const locationId = typeof raw.locationId === 'string' ? raw.locationId : undefined;
    if (
      locationId &&
      locationId !== ctx.self.currentLocationId &&
      (ctx.knownLocations ?? []).some((location) => location.locationId === locationId)
    ) {
      return { kind, locationId };
    }
    return null;
  }
  if (kind === 'zone') {
    const zoneId = typeof raw.zoneId === 'string' ? raw.zoneId : undefined;
    if (
      zoneId &&
      zoneId !== ctx.self.currentLocationId &&
      (ctx.knownLocations ?? []).some((location) => location.locationId === zoneId)
    ) {
      return { kind, zoneId };
    }
    return null;
  }
  if (kind === 'actor') {
    const actorId = typeof raw.actorId === 'string' ? raw.actorId : undefined;
    if (!actorId || !ctx.others.some((actor) => actor.actorId === actorId)) return null;
    const distance = raw.preferredDistanceTiles;
    const preferredDistanceTiles =
      typeof distance === 'number' && Number.isFinite(distance)
        ? Math.max(1, Math.min(2, Math.round(distance)))
        : undefined;
    return preferredDistanceTiles ? { kind, actorId, preferredDistanceTiles } : { kind, actorId };
  }
  if (kind === 'interactable') {
    const interactionId = typeof raw.interactionId === 'string' ? raw.interactionId : undefined;
    if (
      interactionId &&
      (ctx.knownInteractions ?? []).some(
        (interaction) => interaction.interactionId === interactionId,
      )
    ) {
      return { kind, interactionId };
    }
    return null;
  }
  if (kind === 'point') {
    const tile = raw.tile;
    if (!tile || typeof tile !== 'object' || Array.isArray(tile) || !ctx.currentTile) return null;
    const point = tile as Record<string, unknown>;
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) return null;
    const x = point.x as number;
    const y = point.y as number;
    const radius = Math.max(1, Math.min(12, Math.floor(ctx.movementPointRadius ?? 12)));
    if (Math.hypot(x - ctx.currentTile.x, y - ctx.currentTile.y) > radius) return null;
    return { kind, tile: { x, y } };
  }
  return null;
}

// 兜底到一个「此地此身份合法」的无目标动作；没有就返回 null（→ 上层 skip，
// 绝不提交一个必被身份/地点闸拒绝的动作，W4b-C 修空转死循环）。
function fallback(ctx: AgentContext): AgentProposal | null {
  if (isActorIncapacitated(ctx.self.health)) return null;
  const type = SAFE_FALLBACK_ACTIONS.find((a) => ctx.availableActions.includes(a));
  if (!type) return null;
  return {
    type,
    locationId: ctx.self.currentLocationId,
    intent: '审时度势，先稳住自身',
    source: 'agent',
  };
}

// 从可能带 ```json 围栏或多余文本的内容里抽出第一个 JSON 对象。
function extractJson(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const fenced = content.replace(/```json/gi, '```').split('```');
  for (const chunk of [content, ...fenced]) {
    const start = chunk.indexOf('{');
    const end = chunk.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed: unknown = JSON.parse(chunk.slice(start, end + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // 试下一个候选
      }
    }
  }
  return null;
}

function pickItem(raw: Record<string, unknown>): string | undefined {
  if (typeof raw.itemId === 'string') return raw.itemId;
  const params = raw.params;
  if (
    params &&
    typeof params === 'object' &&
    typeof (params as Record<string, unknown>).itemId === 'string'
  ) {
    return (params as Record<string, string>).itemId;
  }
  return undefined;
}
