import type { ActionType } from '../../actionSchema';
import type { AgentContext, AgentProposal, HumanDayPlan } from '../../agentLogic';
import {
  buildPersonalGoalPlanForProposal,
  buildPiNpcEligibleCandidateBundle,
  revalidatePiNpcEligibleCandidate,
  selectPersonaPreferredProposal,
  type PiNpcEligibleCandidateView,
} from '../../autonomyDecisionTraceLogic';
import {
  buildPurposeBoundLifeCandidateBundle,
  type PurposeBoundLifeCandidateBundleV2,
} from '../../purposeBoundLifeCandidateLogic';
import {
  evaluatePurposeGoalArrival,
  evaluatePurposeGoalIntentionalIdle,
  evaluatePurposeGoalTerminal,
  initialPurposeGoalStage,
  purposeIntentFromProposal,
} from '../../purposeBoundLifeGoalLogic';
import {
  assertPurposeBehaviorReleaseReady,
  createPurposeBehaviorReleaseAudit,
  type PurposeBehaviorCausalChangeKind,
  type PurposeBehaviorReleaseAuditSummary,
} from '../../purposeBehaviorReleaseAuditLogic';
import {
  evaluatePurposeGoalReplacement,
  purposeGoalCooldownHours,
} from '../../purposeGoalCadenceLogic';
import {
  projectPurposeBoundLifeSocialFacts,
  type PurposeBoundLifeSocialProjection,
} from '../../purposeBoundLifeSocialProjectionLogic';
import { stableObservationDigest } from '../../lifeObservation';
import {
  isContendedGatherForNewChoice,
  projectPurposeResourceOutlook,
} from '../../purposeResourceOutlookLogic';
import {
  HUMAN_BEDTIME_SET_ASIDE_REASON_CODE,
  HUMAN_CLOSE_FRIEND_RELATIONSHIP,
  HUMAN_GIFT_PAIR_COOLDOWN_DAYS,
  humanGiftKeepQuantity,
  humanMoodAfterWaking,
  humanMoodLifted,
  isHumanLeisureSpot,
  nextHumanBedtimeGameHour,
  HUMAN_MAINTENANCE_MIN_RELATIONSHIP,
  chatAffinityGain,
  humanChronotype,
  humanMaintenancePlan,
  humanDayFocus,
  isHumanSleepTime,
} from '../../humanLifeLogic';
import {
  PERSONAL_GOAL_BACKLOG_LIMIT,
  PERSONAL_GOAL_CONTRACT_VERSION,
  PERSONAL_GOAL_HARD_DEADLINE_HOURS,
  PERSONAL_GOAL_SOFT_DEADLINE_HOURS,
  type ActivePersonalGoal,
  type PersonalGoalCandidate,
  type PurposeGoalCadenceWindow,
} from '../../personalGoalContracts';
import { seededRoll } from '../../rules';
import { homeZone } from '../../routineLogic';
import {
  APOLOGY_AFFINITY,
  APOLOGY_SCAR_SHARE,
  APOLOGY_SUSPICION_RELIEF,
  DAILY_SCAR_FADE,
  QUARREL_SCAR_SHARE,
  HUMAN_NEWS_DISTORTION_CHANCE,
  HUMAN_NEWS_MEMORY_HOURS,
  HUMAN_NEWS_SALIENCE,
  HUMAN_WARMING_BLOCK_SUSPICION,
  QUARREL_AFFINITY_LOSS,
  QUARREL_OFFENDER_AFFINITY_LOSS,
  QUARREL_OFFENDER_SUSPICION,
  QUARREL_SUSPICION,
  humanAllyGrudge,
  humanDailyGrudgeRelief,
  humanDistortNews,
  humanGossipChance,
  humanImpressionOf,
  humanQuarrelChance,
  humanQuarrelOffender,
  humanTellsSelfServing,
  humanWillApologize,
  isNegativeHumanNews,
  sameHumanNewsVersion,
  type HumanNewsSource,
  type HumanNewsVersion,
} from '../../humanSocietyLogic';

export const PURPOSE_BOUND_LIFE_SOAK_VERSION =
  'taixu.purpose-bound-life-soak.v1' as const;
export const PURPOSE_BOUND_LIFE_SOAK_TICKS = 10_000 as const;
export const PURPOSE_BOUND_LIFE_SOAK_ACTORS_PER_TICK = 4 as const;
export const PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK = 0.25 as const;
export const PURPOSE_BOUND_LIFE_SOAK_MAX_DRAIN_TICKS = 128 as const;
const HOUR_TICKS = Math.round(1 / PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK);
const DAY_TICKS = 24 * HOUR_TICKS;
// Human life: shared waking hours build acquaintance up to this affinity.
const FAMILIARITY_CAP = 18;
const FAMILIARITY_PER_HOUR = 0.25;

type Inventory = Record<string, number>;

type ActorState = {
  actorId: string;
  name: string;
  role: string;
  innerTrait: string;
  outerTrait: string;
  locationId: string;
  health: number;
  maxHealth: number;
  fatigue: number;
  cultivationXp: number;
  spirit: number;
  mood: number;
  inventory: Inventory;
  activeGoal?: ActivePersonalGoal;
  cadenceWindows: PurposeGoalCadenceWindow[];
  pending?: PendingAction;
  goalRevision: number;
  causalRevision: number;
  scheduled: number;
  decisions: number;
  actions: number;
  intentionalIdle: number;
  sleepUntilGameHour?: number;
  sleepReasonCode?: string;
  observedGlobalWakeRevision: number;
  recentTalkDays: Map<string, number>;
  // Human life: what others did to this actor (talked to it, gave it something), kept a week.
  memories: SocialMemoryRow[];
  // Human life: herbs received as gifts are kept, never given on.
  receivedGiftHerbs: number;
  // Human life: what this actor knows has happened (by news id), and quarrels
  // this actor started (apologize = still means to say sorry).
  knowledge: Map<string, KnownNews>;
  offenses: Array<{ eventId: string; victimId: string; tick: number; apologize: boolean }>;
  // Human life: the day this actor last gave a gift.
  lastGiftDay?: number;
  // The actor's own latest gather goal per resource node.
  gatherOutcomes: Map<
    string,
    {
      status: 'completed' | 'cancelled' | 'failed' | 'expired';
      reasonCode: string;
      tick: number;
      consecutiveFailures: number;
    }
  >;
};

type PendingAction = {
  actionId: string;
  eventId: string;
  actorId: string;
  proposal: AgentProposal;
  goalId?: string;
  startedTick: number;
  completesTick: number;
  reservation?:
    | { kind: 'resource'; quantity: number }
    | { kind: 'shop'; quantity: number; price: number; quoteRevision: string };
};

type RequestState = {
  requestId: string;
  revision: number;
  status: 'offered' | 'accepted' | 'ready_to_turn_in' | 'completed' | 'declined';
  type: 'collect_item';
  itemId: 'spirit_herb';
  qty: number;
  issuerActorId: string;
  issuerLocationId: string;
  assigneeActorId: string;
  rewardSpiritStones: number;
};

type SocialRequestState = {
  requestId: string;
  revision: number;
  status: 'accepted' | 'ready_to_turn_in';
  issuerActorId: string;
  assigneeActorId: string;
  summary: string;
};

type ResourceState = {
  resourceNodeId: string;
  locationId: string;
  itemId: 'spirit_herb';
  stock: number;
  reserved: number;
  capacity: number;
  revision: number;
  refreshPeriodTicks: number;
  nextRefreshTick: number;
};

type ShopState = {
  shopId: string;
  merchantActorId: string;
  locationId: string;
  herbStock: number;
  herbCapacity: number;
  walletSpiritStones: number;
  reservedCapacity: number;
  reservedWallet: number;
  unitPrice: number;
  revision: number;
};

type PressureState = {
  pressureId: string;
  sourceEventId: string;
  locationId: string;
  revision: number;
  active: boolean;
};

type SocialMemoryRow = {
  sourceEventId: string;
  aboutActorIds: string[];
  eventActorIds: string[];
  eventTargetActorIds: string[];
  type: string;
  source: 'direct';
  createdAt: number;
  expiresAt: number;
};

type RelationshipState = {
  affinity: number;
  trust: number;
  lastTouchedDay: number;
  // Human life: indebtedness toward the other (> 0 means this actor owes them),
  // the same sign gift_accepted uses for the receiver.
  debt?: number;
  // Human life: a grudge held against the other (0-100), fading day by day.
  suspicion?: number;
};

// Human life: something that happened, as one person knows it.
type KnownNews = {
  version: HumanNewsVersion;
  source: HumanNewsSource;
  heardTick: number;
  fromActorId?: string;
};

// Human life: the shared record of what really happened, and of every grudge
// still being worked off (victim -> offender).
type SocietyState = {
  news: Map<string, { newsId: string; truth: HumanNewsVersion; tick: number; locationId: string }>;
  // scar: the part of the loss that only fades over months; ceiling: how warm
  // the victim felt before the first quarrel.
  grudges: Map<
    string,
    { victimId: string; offenderId: string; lost: number; recovered: number; scar: number; ceiling: number }
  >;
};

export type PurposeBoundLifeScenarioCoverage = {
  cultivationCompleted: number;
  recoveryCompleted: number;
  herbsGathered: number;
  herbsSold: number;
  requestsAccepted: number;
  requestsCompleted: number;
  resourceDepletionsObserved: number;
  // A rule decision that passed over a gather projected to find nothing left.
  // Either this or a depletion covers the resource-scarcity scenario.
  resourceContentionsAvoided: number;
  quoteInvalidationsObserved: number;
  midRouteInvalidationsObserved: number;
  emergencyPreemptions: number;
  intentionalIdleObserved: number;
};

export type PurposeBoundLifeSocialProjectionCoverage = {
  sameLocationSourceKinds: Record<
    'care_or_aid' | 'active_obligation' | 'knowledge_gap' | 'gratitude_or_repair' | 'relationship_maintenance',
    number
  >;
  remoteInvitationOpportunities: number;
  groupOpportunityKinds: Record<
    'shared_request' | 'shared_event' | 'resource_dispute' | 'duty_meeting',
    number
  >;
  decisionHookSocialCandidateObservations: number;
};

export type PurposeBoundLifeSoakIntegrity = {
  duplicateActions: number;
  duplicateEvents: number;
  duplicateSettlements: number;
  negativeInventory: number;
  resourceLedgerMismatch: number;
  multipleActiveGoals: number;
  incapacitatedActions: number;
  successfulActionGoalFailures: number;
  unexpectedIdle: number;
  drainExceeded: number;
  providerCalls: 0;
  modelFallbacks: 0;
  tokenBudgetOverruns: 0;
};

export type PurposeBoundLifeSoakCheckpoint = {
  tick: number;
  actions: number;
  settlements: number;
  activeExecutions: number;
  activeGoals: number;
  intentionalIdle: number;
  trajectoryDigest: string;
};

export type PurposeBoundLifeSoakSummary = {
  contractVersion: typeof PURPOSE_BOUND_LIFE_SOAK_VERSION;
  seed: string;
  decisionTicks: number;
  drainTicks: number;
  actorCount: number;
  schedulerOpportunities: number;
  decisions: number;
  actions: number;
  settlements: number;
  providerCalls: 0;
  scenarioCoverage: PurposeBoundLifeScenarioCoverage;
  socialProjectionCoverage: PurposeBoundLifeSocialProjectionCoverage;
  integrity: PurposeBoundLifeSoakIntegrity;
  resources: {
    initialHerbs: number;
    refreshedHerbs: number;
    finalHerbs: number;
    initialSpiritStones: number;
    finalSpiritStones: number;
    initialHealingPills: number;
    healingPillSinks: number;
    finalHealingPills: number;
  };
  fairness: {
    minimumScheduled: number;
    maximumScheduled: number;
    spread: number;
  };
  releaseAudit: PurposeBehaviorReleaseAuditSummary;
  checkpoints: PurposeBoundLifeSoakCheckpoint[];
  trajectoryDigest: string;
  finalStateDigest: string;
};

export type PurposeBoundLifeSoakOptions = {
  seed: string;
  ticks?: number;
  decisionHook?: PurposeBoundLifeDecisionHook;
  runtimeEventHook?: (event: PurposeBoundLifeRuntimeEvent) => void;
  beforeTick?: (tick: number) => void;
  // 'memory_only' hides who else is on the way and which units are held for
  // commissions, leaving each actor only its own last outcome: a probe for
  // learning from experience rather than being told.
  outlookMode?: 'full' | 'memory_only';
  // Human life v1: sleep at night, learn from empty trips, a focus per day.
  humanLife?: boolean;
  // Read-only: one snapshot of every relationship at the end of each game day.
  observeNetwork?: (snapshot: PurposeBoundLifeNetworkSnapshot) => void;
};

export type PurposeBoundLifeNetworkSnapshot = {
  tick: number;
  day: number;
  rows: Array<{
    from: string;
    to: string;
    affinity: number;
    trust: number;
    debt: number;
    // Human life: the grudge `from` holds, and how `from` sees `to`.
    suspicion?: number;
    warmth?: number;
    trouble?: number;
  }>;
};

export type PurposeBoundLifeDecisionHookInput = {
  tick: number;
  gameHour: number;
  actor: {
    actorId: string;
    name: string;
    role: string;
    innerTrait: string;
    outerTrait: string;
    locationId: string;
    health: number;
    maxHealth: number;
    fatigue: number;
    cultivationXp: number;
  };
  observationRevision: string;
  candidateSetDigest: string;
  socialContext: {
    nearbyActorCount: number;
    nearbyRelationshipEligibleActorCount: number;
    recentlyTalkedActorCount: number;
    activeGroupConversation: boolean;
    sameLocationSourceCount: number;
    remoteInvitationOpportunityCount: number;
    groupOpportunityCount: number;
    socialCandidateCount: number;
  };
  candidates: PiNpcEligibleCandidateView[];
  defaultCandidateId: string;
};

export type PurposeBoundLifeDecisionHookResult =
  | {
      kind: 'selected';
      candidateId: string;
      reasonCode: string;
      summary: string;
    }
  | {
      kind: 'wait';
      reasonCode: 'no_good_action' | 'insufficient_context';
      summary: string;
    };

export type PurposeBoundLifeDecisionHook = (
  input: PurposeBoundLifeDecisionHookInput,
) => PurposeBoundLifeDecisionHookResult | undefined;

export type PurposeBoundLifeRuntimeEvent = {
  type:
    | 'causal_change'
    | 'goal_created'
    | 'goal_terminal'
    | 'action_selected'
    | 'action_terminal'
    | 'intentional_idle'
    | 'social_event'
    | 'news_heard';
  tick: number;
  actorId?: string;
  actionId?: string;
  actionType?: ActionType;
  targetActorId?: string;
  goalId?: string;
  status?: string;
  reasonCode?: string;
  sourceRef?: string;
  fromLocationId?: string;
  targetLocationId?: string;
  finalLocationId?: string;
  untilGameHour?: number;
  // Human life: what a person heard (news_heard), and from whom.
  newsId?: string;
  newsKind?: string;
  newsSource?: string;
  distorted?: boolean;
  distortion?: string;
  corrected?: boolean;
  subjectActorId?: string;
  objectActorId?: string;
  newsExaggerated?: boolean;
  fromActorId?: string;
};

const LOCATIONS = [
  {
    locationId: 'mountain_gate',
    name: '山门生活院',
    spiritualEnergy: 6,
    allowedActions: [
      'cultivate',
      'rest',
      'talk',
      'gift',
      'accept_request',
      'decline_request',
      'turn_in_request',
      'explore',
      'use_item',
    ] satisfies ActionType[],
  },
  {
    locationId: 'herb_field',
    name: '凝露药圃',
    spiritualEnergy: 3,
    allowedActions: [
      'gather',
      'cultivate',
      'rest',
      'talk',
      'explore',
      'use_item',
    ] satisfies ActionType[],
  },
  {
    locationId: 'market',
    name: '青石坊市',
    spiritualEnergy: 2,
    allowedActions: ['trade', 'rest', 'talk', 'gift', 'use_item'] satisfies ActionType[],
  },
  {
    locationId: 'rest_pavilion',
    name: '松风歇脚亭',
    spiritualEnergy: 2,
    allowedActions: ['rest', 'talk', 'use_item'] satisfies ActionType[],
  },
  {
    locationId: 'alchemy_room',
    name: '丹房守备处',
    spiritualEnergy: 3,
    allowedActions: ['rest', 'talk', 'inspect', 'use_item'] satisfies ActionType[],
  },
] as const;

const ACTOR_BLUEPRINTS = [
  ['life:q6:cultivator', '守静弟子', 'inner_disciple', '中庸', '权力', 'mountain_gate'],
  ['life:q6:tired', '疲惫弟子', 'outer_disciple', '无私', '义气', 'mountain_gate'],
  ['life:q6:seller', '卖药弟子', 'outer_disciple', '利己', '名声', 'mountain_gate'],
  ['life:q6:remote_gatherer', '远行采药人', 'outer_disciple', '中庸', '孤僻', 'mountain_gate'],
  ['life:q6:local_gatherer', '药圃弟子', 'outer_disciple', '无私', '天伦', 'herb_field'],
  ['life:q6:quester', '重诺弟子', 'outer_disciple', '正直', '义气', 'mountain_gate'],
  ['life:q6:merchant', '河湾掌柜', 'merchant', '利己', '名声', 'market'],
  ['life:q6:guard', '丹房守卫', 'guard', '正直', '忠贞', 'alchemy_room'],
  ['life:q6:explorer', '谨慎行脚弟子', 'outer_disciple', '中庸', '孤僻', 'mountain_gate'],
  ['life:q6:emergency', '返山弟子', 'outer_disciple', '中庸', '爱家', 'rest_pavilion'],
] as const;

export function runPurposeBoundLifeSoak(
  options: PurposeBoundLifeSoakOptions,
): PurposeBoundLifeSoakSummary {
  const seed = options.seed.trim();
  if (!seed) throw new Error('purpose_bound_life_soak_seed_required');
  const ticks = options.ticks ?? PURPOSE_BOUND_LIFE_SOAK_TICKS;
  if (!Number.isInteger(ticks) || ticks < 1_000 || ticks > PURPOSE_BOUND_LIFE_SOAK_TICKS) {
    throw new Error('purpose_bound_life_soak_ticks_out_of_range');
  }

  const actors = createActors(seed);
  const actorById = new Map(actors.map((actor) => [actor.actorId, actor]));
  const requests = createRequests();
  const socialRequests = createSocialRequests();
  const resource = createResource(seed);
  const shop = createShop(seed);
  const pressure: PressureState = {
    pressureId: 'q6_fleeting_miasma',
    sourceEventId: 'event:q6:fleeting_miasma',
    locationId: 'herb_field',
    revision: 1,
    active: false,
  };
  const relationships = createRelationships(actors, seed);
  // Human life: the last day each pair exchanged a gift (either direction).
  const giftDayByPair = new Map<string, number>();
  // Human life: what really happened (news) and the grudges still being worked off.
  const society: SocietyState = { news: new Map(), grudges: new Map() };
  const audit = createPurposeBehaviorReleaseAudit();
  const trajectory = new StableDigest();
  const actionIds = new Set<string>();
  const eventIds = new Set<string>();
  const settlementIds = new Set<string>();
  const checkpoints: PurposeBoundLifeSoakCheckpoint[] = [];
  const coverage = emptyCoverage();
  const socialProjectionCoverage = emptySocialProjectionCoverage();
  const observedSameLocationSources = new Set<string>();
  const observedRemoteInvitations = new Set<string>();
  const observedGroupOpportunities = new Set<string>();
  const latestSocialProjectionCounts = new Map<
    string,
    { sameLocation: number; remote: number; group: number }
  >();
  const integrity = emptyIntegrity();
  const initialResources = resourceTotals(actors, resource, shop);
  let refreshedHerbs = 0;
  let healingPillSinks = 0;
  let sequence = 0;
  let actionSerial = 0;
  let decisions = 0;
  let actions = 0;
  let settlements = 0;
  let schedulerCursor = 0;
  let schedulerOpportunities = 0;
  let drainTicks = 0;
  let globalWakeRevision = 0;

  const observeSocialProjection = (
    actorId: string,
    projection: PurposeBoundLifeSocialProjection,
  ) => {
    latestSocialProjectionCounts.set(actorId, {
      sameLocation: projection.sameLocationSources.length,
      remote: projection.remoteInvitationOpportunities.length,
      group: projection.groupOpportunities.length,
    });
    for (const source of projection.sameLocationSources) {
      // This legacy purpose soak supplies requests, beliefs, memories and
      // relationships, but no verified action-terminal consequence facts.
      // LWSE-2b conflict coverage belongs to causalSocialSoakLogic instead.
      if (source.kind === 'conflict_resolution') continue;
      const key = `${source.kind}|${source.sourceRef}|${source.sourceRevision}|${source.targetActorId}`;
      if (observedSameLocationSources.has(key)) continue;
      observedSameLocationSources.add(key);
      socialProjectionCoverage.sameLocationSourceKinds[source.kind] += 1;
    }
    for (const opportunity of projection.remoteInvitationOpportunities) {
      if (observedRemoteInvitations.has(opportunity.candidateId)) continue;
      observedRemoteInvitations.add(opportunity.candidateId);
      socialProjectionCoverage.remoteInvitationOpportunities += 1;
    }
    for (const opportunity of projection.groupOpportunities) {
      const key = `${opportunity.sourceKind}|${opportunity.warrant.sourceRef}|${opportunity.warrant.sourceRevision}`;
      if (observedGroupOpportunities.has(key)) continue;
      observedGroupOpportunities.add(key);
      socialProjectionCoverage.groupOpportunityKinds[opportunity.sourceKind] += 1;
    }
  };

  const gameHour = (tick: number) => tick * PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK;
  // Human life: bedtime and waking are body needs, the same kind of cause as
  // fatigue crossing a threshold. Recording them explains going home at night.
  const asleepByActor = new Map<string, boolean>();
  const recordSleepTransitions = (tick: number) => {
    for (const actor of actors) {
      const asleep = isHumanSleepTime({
        humanLifeV1: true,
        currentGameHour: gameHour(tick),
        humanDay: humanChronotype(actor.actorId),
      } as AgentContext);
      const before = asleepByActor.get(actor.actorId) ?? false;
      asleepByActor.set(actor.actorId, asleep);
      if (asleep === before) continue;
      // Falling asleep and waking change the person's own state: a task set
      // aside at bedtime may be picked up again in the morning. Overnight the
      // mood settles one step back toward its usual level.
      actor.causalRevision += 1;
      if (!asleep) actor.mood = humanMoodAfterWaking(actor.mood);
      recordCause({
        tick,
        actorId: actor.actorId,
        kind: 'need',
        eventId: `event:human:${asleep ? 'bedtime' : 'wake'}:${actor.actorId}:${tick}`,
        sourceRef: `body:${actor.actorId}`,
        before: stableObservationDigest({ asleep: before }),
        after: stableObservationDigest({ asleep }),
      });
    }
  };
  // Human life: people who spend their waking hours in the same place slowly
  // become acquaintances (propinquity). Shared time alone stops at FAMILIARITY_CAP;
  // anything closer has to come from talking and helping.
  const growFamiliarity = (tick: number) => {
    const awake = actors.filter(
      (actor) =>
        actor.health > 0 &&
        !isHumanSleepTime({
          humanLifeV1: true,
          currentGameHour: gameHour(tick),
          humanDay: humanChronotype(actor.actorId),
        } as AgentContext),
    );
    for (const actor of awake) {
      for (const other of awake) {
        if (other.actorId === actor.actorId || other.locationId !== actor.locationId) continue;
        const key = edgeKey(actor.actorId, other.actorId);
        const current = relationships.get(key);
        if (!current || current.affinity >= FAMILIARITY_CAP) continue;
        // A grudge keeps two people from warming to each other just by being around,
        // and a quarrel leaves a scar that mere company does not heal.
        if ((current.suspicion ?? 0) >= HUMAN_WARMING_BLOCK_SUSPICION) continue;
        const scarCap = FAMILIARITY_CAP - (society.grudges.get(key)?.scar ?? 0);
        if (current.affinity >= scarCap) continue;
        relationships.set(key, {
          ...current,
          affinity: Math.min(scarCap, Math.round((current.affinity + FAMILIARITY_PER_HOUR) * 100) / 100),
        });
      }
    }
  };
  // Human life, once a day: grudges fade and part of the lost goodwill comes
  // back, at a pace set by temperament (personalityLogic.grudgeDecayMult).
  const relieveGrudges = (ticksSoFar: number) => {
    for (const from of actors) {
      const relief = humanDailyGrudgeRelief(from);
      for (const to of actors) {
        if (to.actorId === from.actorId) continue;
        const row = relationships.get(edgeKey(from.actorId, to.actorId));
        if (!row?.suspicion) continue;
        row.suspicion = Math.max(0, Math.round((row.suspicion - relief.suspicion) * 100) / 100);
      }
    }
    // An offense is let go once the grudge against it is gone, or after 30 days.
    for (const actor of actors) {
      actor.offenses = actor.offenses.filter((offense) => {
        const held = relationships.get(edgeKey(offense.victimId, actor.actorId))?.suspicion ?? 0;
        return held > 0 && gameHour(ticksSoFar) - gameHourForTick(offense.tick) < 30 * 24;
      });
    }
    for (const [key, grudge] of society.grudges) {
      const victim = actorById.get(grudge.victimId);
      const row = relationships.get(key);
      if (!victim || !row) continue;
      // What comes back with time is the loss less the scar; the scar fades over months.
      const step = Math.min(
        grudge.lost - grudge.scar - grudge.recovered,
        grudge.lost * humanDailyGrudgeRelief(victim).recoveryShare,
      );
      if (step > 0) {
        row.affinity = clamp(Math.round((row.affinity + step) * 100) / 100, -100, 100);
        grudge.recovered = Math.round((grudge.recovered + step) * 100) / 100;
      }
      grudge.scar = Math.max(0, Math.round((grudge.scar - DAILY_SCAR_FADE) * 100) / 100);
      // Until the scar is gone, goodwill cannot climb back above where it was less the scar.
      const cap = grudge.ceiling - grudge.scar;
      if (row.affinity > cap) row.affinity = Math.round(cap * 100) / 100;
      if (grudge.scar === 0 && grudge.recovered >= grudge.lost - 0.01) society.grudges.delete(key);
    }
  };
  const observeNetwork = (tick: number) => {
    options.observeNetwork?.({
      tick,
      day: Math.floor(gameHour(tick) / 24),
      rows: actors.flatMap((from) =>
        actors
          .filter((to) => to.actorId !== from.actorId)
          .map((to) => {
            const row = relationships.get(edgeKey(from.actorId, to.actorId));
            const impression = options.humanLife ? humanImpression(from, to.actorId, tick) : undefined;
            return {
              from: from.actorId,
              to: to.actorId,
              affinity: row?.affinity ?? 0,
              trust: row?.trust ?? 0,
              debt: row?.debt ?? 0,
              ...(options.humanLife
                ? {
                    suspicion: row?.suspicion ?? 0,
                    warmth: impression?.warmth ?? 0,
                    trouble: impression?.trouble ?? 0,
                  }
                : {}),
            };
          }),
      ),
    });
  };
  const nextSequence = () => {
    sequence += 1;
    return sequence;
  };

  const recordCause = (input: {
    tick: number;
    actorId?: string;
    kind: PurposeBehaviorCausalChangeKind;
    eventId: string;
    sourceRef: string;
    before: string;
    after: string;
  }) => {
    if (input.actorId === undefined) globalWakeRevision += 1;
    audit.recordCausalChange({
      sequence: nextSequence(),
      gameHour: gameHour(input.tick),
      actorId: input.actorId,
      kind: input.kind,
      sourceEventId: input.eventId,
      sourceRef: input.sourceRef,
      beforeDigest: input.before,
      afterDigest: input.after,
    });
    options.runtimeEventHook?.({
      type: 'causal_change',
      tick: input.tick,
      actorId: input.actorId,
      reasonCode: input.kind,
      sourceRef: input.sourceRef,
    });
    trajectory.update(
      `cause:${input.tick}:${input.eventId}:${input.kind}:${input.before}:${input.after}`,
    );
  };

  const terminalizeGoal = (
    actor: ActorState,
    status: 'completed' | 'cancelled' | 'failed' | 'expired',
    reasonCode: string,
    tick: number,
  ) => {
    const goal = actor.activeGoal;
    if (!goal) return;
    audit.recordGoalTerminal({
      sequence: nextSequence(),
      gameHour: gameHour(tick),
      actorId: actor.actorId,
      goalId: goal.goalId,
      status,
      reasonCode,
    });
    options.runtimeEventHook?.({
      type: 'goal_terminal',
      tick,
      actorId: actor.actorId,
      goalId: goal.goalId,
      status,
      reasonCode,
      sourceRef: goal.sourceRef,
    });
    if (goal.purposeIntent && goal.purposeCadenceKey) {
      const terminalGameHour = gameHour(tick);
      actor.cadenceWindows.push({
        goalId: goal.goalId,
        cadenceKey: goal.purposeCadenceKey,
        sourceRef: goal.purposeIntent.sourceRef,
        sourceRevision: goal.purposeIntent.sourceRevision,
        purposeKind: goal.purposeIntent.purposeKind,
        intendedActivity: goal.purposeIntent.intendedActivity,
        terminalStatus: status,
        terminalReasonCode: reasonCode,
        terminalGameHour,
        nextEligibleGameHour:
          terminalGameHour +
          purposeGoalCooldownHours({ intent: goal.purposeIntent, terminalStatus: status, reasonCode }),
      });
      const latestByCadence = new Map<string, PurposeGoalCadenceWindow>();
      for (const window of actor.cadenceWindows) {
        const prior = latestByCadence.get(window.cadenceKey);
        if (!prior || window.terminalGameHour >= prior.terminalGameHour) {
          latestByCadence.set(window.cadenceKey, window);
        }
      }
      actor.cadenceWindows = [...latestByCadence.values()]
        .sort(
          (left, right) =>
            left.terminalGameHour - right.terminalGameHour ||
            left.cadenceKey.localeCompare(right.cadenceKey),
        )
        .slice(-32);
    }
    if (gatherClaimOn(actor, resource)) {
      const prior = actor.gatherOutcomes.get(resource.resourceNodeId);
      actor.gatherOutcomes.set(resource.resourceNodeId, {
        status,
        reasonCode,
        tick,
        consecutiveFailures:
          status === 'failed' ? (prior?.status === 'failed' ? prior.consecutiveFailures : 0) + 1 : 0,
      });
    }
    trajectory.update(`goal_terminal:${tick}:${goal.goalId}:${status}:${reasonCode}`);
    actor.activeGoal = undefined;
  };

  const recordInvalidationCoverage = (goal: ActivePersonalGoal, reasonCode: string) => {
    const sourceRef = goal.purposeIntent?.sourceRef ?? goal.sourceRef;
    if (sourceRef.startsWith('resource:')) coverage.resourceDepletionsObserved += 1;
    if (sourceRef.startsWith('shop:')) coverage.quoteInvalidationsObserved += 1;
    if (sourceRef.startsWith('world_event:')) coverage.midRouteInvalidationsObserved += 1;
    trajectory.update(`goal_invalidated:${goal.goalId}:${sourceRef}:${reasonCode}`);
  };

  const createGoal = (
    actor: ActorState,
    selected: PersonalGoalCandidate,
    context: AgentContext,
    tick: number,
  ) => {
    if (!selected.purposeIntent || !selected.purposeIntentDigest || !selected.purposeCadenceKey) {
      return undefined;
    }
    actor.goalRevision += 1;
    const now = gameHour(tick);
    const goal: ActivePersonalGoal = {
      contractVersion: PERSONAL_GOAL_CONTRACT_VERSION,
      goalId: `purpose_soak_goal:${seed}:${actor.actorId}:${actor.goalRevision}`,
      actorId: actor.actorId,
      revision: actor.goalRevision,
      status: 'active',
      goalKey: selected.goalKey,
      kind: selected.kind,
      sourceRef: selected.sourceRef,
      targetRef: selected.targetRef,
      candidateId: selected.candidateId,
      intent: selected.intent,
      progressScore: selected.progressScore,
      progressKey: selected.progressKey,
      progressRevision: 0,
      backlog: [],
      observationRevision:
        context.lifeObservation?.observationRevision ?? `purpose_soak:${seed}:${tick}`,
      startedGameHour: now,
      lastProgressGameHour: now,
      deadlineGameHour: now + PERSONAL_GOAL_SOFT_DEADLINE_HOURS,
      hardDeadlineGameHour: now + PERSONAL_GOAL_HARD_DEADLINE_HOURS,
      attemptCount: 0,
      purposeIntent: selected.purposeIntent,
      purposeIntentDigest: selected.purposeIntentDigest,
      purposeCadenceKey: selected.purposeCadenceKey,
      purposeStage: initialPurposeGoalStage(
        selected.purposeIntent,
        actor.locationId,
      ),
    };
    actor.activeGoal = goal;
    const sourceStateDigest = stableObservationDigest({
      sourceRef: selected.purposeIntent.sourceRef,
      sourceRevision: selected.purposeIntent.sourceRevision,
      completionCondition: selected.purposeIntent.completionCondition,
      actorCausalRevision: actor.causalRevision,
      locationId: actor.locationId,
    });
    audit.recordGoalCreated({
      sequence: nextSequence(),
      gameHour: gameHour(tick),
      actorId: actor.actorId,
      goalId: goal.goalId,
      cadenceKey: selected.purposeCadenceKey,
      purposeIntentDigest: selected.purposeIntentDigest,
      sourceRef: selected.purposeIntent.sourceRef,
      sourceRevision: selected.purposeIntent.sourceRevision,
      sourceStateDigest,
      targetLocationId: selected.purposeIntent.targetLocationId,
      intendedActivity: selected.purposeIntent.intendedActivity,
      completionConditionDigest: stableObservationDigest(
        selected.purposeIntent.completionCondition,
      ),
    });
    options.runtimeEventHook?.({
      type: 'goal_created',
      tick,
      actorId: actor.actorId,
      goalId: goal.goalId,
      status: goal.status,
      sourceRef: goal.sourceRef,
      targetLocationId: selected.purposeIntent.targetLocationId,
    });
    trajectory.update(`goal_created:${tick}:${goal.goalId}:${goal.goalKey}`);
    return goal;
  };

  const settlePending = (pending: PendingAction, tick: number) => {
    const actor = actorById.get(pending.actorId);
    if (!actor || actor.pending?.actionId !== pending.actionId) return;
    actor.pending = undefined;
    const settlementId = `settlement:${pending.actionId}`;
    if (settlementIds.has(settlementId)) {
      integrity.duplicateSettlements += 1;
      return;
    }
    settlementIds.add(settlementId);
    settlements += 1;
    const before = causalSnapshot(actor, requests, resource, shop, relationships, pressure);
    const result = applyActionEffects({
      actor,
      pending,
      actorById,
      requests,
      resource,
      shop,
      relationships,
      giftDayByPair,
      pressure,
      humanLife: options.humanLife === true,
      society: options.humanLife ? society : undefined,
      emit: options.runtimeEventHook,
    });
    const after = causalSnapshot(actor, requests, resource, shop, relationships, pressure);
    if (pending.proposal.type === 'use_item' && result.applied) healingPillSinks += 1;
    audit.recordActionTerminal({
      sequence: nextSequence(),
      gameHour: gameHour(tick),
      actorId: actor.actorId,
      actionId: pending.actionId,
      status:
        result.applied && pending.proposal.type === 'travel'
          ? 'arrived'
          : result.applied
            ? 'completed'
            : 'blocked',
      reasonCode: result.applied ? undefined : result.reasonCode,
      finalLocationId: actor.locationId,
    });
    options.runtimeEventHook?.({
      type: 'action_terminal',
      tick,
      actorId: actor.actorId,
      actionId: pending.actionId,
      actionType: pending.proposal.type,
      goalId: pending.goalId,
      status:
        result.applied && pending.proposal.type === 'travel'
          ? 'arrived'
          : result.applied
            ? 'completed'
            : 'blocked',
      reasonCode: result.applied ? undefined : result.reasonCode,
      finalLocationId: actor.locationId,
    });
    if (result.applied && pending.proposal.type !== 'travel' && before !== after) {
      actor.causalRevision += 1;
      const globallyVisibleChange =
        pending.proposal.type === 'gather' ||
        pending.proposal.type === 'trade' ||
        pending.proposal.type === 'explore';
      recordCause({
        tick,
        actorId: globallyVisibleChange ? undefined : actor.actorId,
        kind: causalKind(pending.proposal.type),
        eventId: pending.eventId,
        sourceRef:
          actor.activeGoal?.purposeIntent?.sourceRef ?? `action:${pending.actionId}`,
        before,
        after,
      });
    }
    finishGoalAfterAction(actor, pending, result, tick);
    trajectory.update(
      `settled:${tick}:${pending.actionId}:${pending.proposal.type}:${result.applied ? 'applied' : result.reasonCode}`,
    );
  };

  const finishGoalAfterAction = (
    actor: ActorState,
    pending: PendingAction,
    result: { applied: boolean; reasonCode?: string },
    tick: number,
  ) => {
    const goal = actor.activeGoal;
    if (!goal || goal.goalId !== pending.goalId || !goal.purposeIntent || !goal.purposeIntentDigest) {
      return;
    }
    if (!result.applied) {
      terminalizeGoal(
        actor,
        'failed',
        result.reasonCode ?? 'purpose_goal_action_rejected',
        tick,
      );
      return;
    }
    if (pending.proposal.type === 'travel') {
      const arrival = evaluatePurposeGoalArrival({
        intent: goal.purposeIntent,
        intentDigest: goal.purposeIntentDigest,
        stage: goal.purposeStage ?? 'travel_pending',
        actionType: 'travel',
        actionRecordId: pending.actionId,
        terminalEventActionId: pending.actionId,
        currentLocationId: actor.locationId,
      });
      if (!arrival.ok) {
        terminalizeGoal(actor, 'failed', arrival.reasonCode, tick);
        return;
      }
      goal.purposeStage = arrival.nextStage;
      goal.progressRevision += 1;
      goal.progressScore += 1;
      goal.progressKey = `purpose_arrival:${pending.actionId}`;
      goal.lastProgressGameHour = gameHour(tick);
      goal.lastActionRecordId = undefined;
      goal.lastActionType = undefined;
      return;
    }
    const requestId = stringParam(pending.proposal.params, 'requestId');
    const request = requestId
      ? requests.find((entry) => entry.requestId === requestId)
      : undefined;
    const completion = evaluatePurposeGoalTerminal({
      intent: goal.purposeIntent,
      intentDigest: goal.purposeIntentDigest,
      actionType: pending.proposal.type,
      actionRecordId: pending.actionId,
      terminalEventActionId: pending.actionId,
      terminalEventType: `action_${pending.proposal.type}_completed`,
      actor: {
        health: actor.health,
        fatigue: actor.fatigue,
        cultivationXp: actor.cultivationXp,
        currentLocationId: actor.locationId,
        inventory: inventoryRows(actor.inventory),
      },
      requestStatus: request?.status,
    });
    if (!completion.ok) {
      integrity.successfulActionGoalFailures += 1;
      terminalizeGoal(actor, 'failed', completion.reasonCode, tick);
      return;
    }
    countCompletedPurpose(goal, coverage);
    terminalizeGoal(actor, 'completed', 'purpose_goal_activity_completed', tick);
  };

  const admitAction = (
    actor: ActorState,
    proposal: AgentProposal,
    selected: PersonalGoalCandidate | undefined,
    context: AgentContext,
    tick: number,
  ) => {
    actor.sleepUntilGameHour = undefined;
    actor.sleepReasonCode = undefined;
    let goal = actor.activeGoal;
    const proposalIntent = purposeIntentFromProposal(proposal);
    if (proposalIntent && selected?.purposeIntent) {
      if (!goal) {
        goal = createGoal(actor, selected, context, tick);
      } else if (goal.goalKey !== selected.goalKey) {
        const replacement = evaluatePurposeGoalReplacement({ active: goal, selected });
        if (replacement.kind !== 'replace') {
          integrity.multipleActiveGoals += 1;
          return;
        }
        terminalizeGoal(actor, 'cancelled', replacement.reasonCode, tick);
        goal = createGoal(actor, selected, context, tick);
      }
    } else if (isMandatorySurvival(proposal, actor)) {
      if (goal) {
        terminalizeGoal(actor, 'cancelled', 'higher_priority_survival', tick);
        coverage.emergencyPreemptions += 1;
        goal = undefined;
      }
    }

    if (proposal.type === 'travel' && !goal) {
      // Keep the action visible to q5. The release gate, rather than the
      // simulator, decides whether any legacy/raw travel escaped grounding.
    }
    actionSerial += 1;
    const actionId = `purpose_soak_action:${seed}:${actionSerial}`;
    const eventId = `purpose_soak_event:${seed}:${actionSerial}`;
    if (actionIds.has(actionId)) integrity.duplicateActions += 1;
    if (eventIds.has(eventId)) integrity.duplicateEvents += 1;
    actionIds.add(actionId);
    eventIds.add(eventId);
    actions += 1;
    actor.actions += 1;
    if (goal) {
      if (proposal.type === goal.purposeIntent?.intendedActivity) {
        goal.purposeStage = 'activity_pending';
      }
      goal.attemptCount += 1;
      goal.lastActionRecordId = actionId;
      goal.lastActionType = proposal.type;
    }
    audit.recordActionSelected({
      sequence: nextSequence(),
      gameHour: gameHour(tick),
      actorId: actor.actorId,
      actionId,
      actionType: proposal.type,
      goalId: goal?.goalId,
      purposeIntentDigest: goal?.purposeIntentDigest,
      sourceRef: goal?.purposeIntent?.sourceRef,
      sourceRevision: goal?.purposeIntent?.sourceRevision,
      intendedActivity: goal?.purposeIntent?.intendedActivity,
      fromLocationId: actor.locationId,
      targetLocationId: proposal.type === 'travel' ? proposal.targetId : undefined,
    });
    options.runtimeEventHook?.({
      type: 'action_selected',
      tick,
      actorId: actor.actorId,
      actionId,
      actionType: proposal.type,
      targetActorId: proposal.targetActorId,
      goalId: goal?.goalId,
      sourceRef: goal?.sourceRef,
      fromLocationId: actor.locationId,
      targetLocationId: proposal.type === 'travel' ? proposal.targetId : undefined,
    });
    const pending = reserveAction(actor, proposal, actionId, eventId, tick, resource, shop);
    pending.goalId = goal?.goalId;
    actor.pending = pending;
    trajectory.update(
      `selected:${tick}:${actor.actorId}:${proposal.type}:${proposalTarget(proposal)}:${goal?.goalId ?? 'one_shot'}`,
    );
  };

  const processActor = (
    actor: ActorState,
    tick: number,
    admitNewGoals: boolean,
    countSchedulerOpportunity: boolean,
  ) => {
    if (countSchedulerOpportunity) {
      actor.scheduled += 1;
      schedulerOpportunities += 1;
    }
    if (actor.pending || actor.health <= 0) return;
    const nowGameHour = gameHour(tick);
    if (
      !actor.activeGoal &&
      actor.sleepUntilGameHour !== undefined &&
      nowGameHour < actor.sleepUntilGameHour &&
      actor.observedGlobalWakeRevision === globalWakeRevision
    ) {
      const reasonCode = actor.sleepReasonCode ?? 'purpose_goal_cadence_wait';
      audit.recordIntentionalIdle({
        sequence: nextSequence(),
        gameHour: nowGameHour,
        actorId: actor.actorId,
        reasonCode,
      });
      actor.intentionalIdle += 1;
      coverage.intentionalIdleObserved += 1;
      trajectory.update(`sleep:${tick}:${actor.actorId}:${reasonCode}`);
      return;
    }
    actor.sleepUntilGameHour = undefined;
    actor.sleepReasonCode = undefined;
    let context = buildContext({
      seed,
      tick,
      actor,
      actors,
      requests,
      socialRequests,
      resource,
      shop,
      relationships,
      giftDayByPair,
      pressure,
      observeSocialProjection,
      outlookMode: options.outlookMode ?? 'full',
      humanLife: options.humanLife === true,
    });
    let choice = selectPersonaPreferredProposal(context, deterministicNow(tick));
    // The rule never picks these, so any present here were passed over.
    if (
      context.purposeBoundLifeCandidateBundle?.candidates.some((candidate) =>
        isContendedGatherForNewChoice(context, candidate.proposal),
      )
    ) {
      coverage.resourceContentionsAvoided += 1;
    }
    let modelWaitReason: string | undefined;
    decisions += 1;
    actor.decisions += 1;

    if (
      options.decisionHook &&
      !actor.activeGoal &&
      choice &&
      !isMandatorySurvival(choice.proposal, actor)
    ) {
      const liveBundle = buildPiNpcEligibleCandidateBundle(
        context,
        deterministicNow(tick),
      );
      if (liveBundle.candidates.length >= 2) {
        const hookResult = options.decisionHook({
          tick,
          gameHour: nowGameHour,
          actor: {
            actorId: actor.actorId,
            name: actor.name,
            role: actor.role,
            innerTrait: actor.innerTrait,
            outerTrait: actor.outerTrait,
            locationId: actor.locationId,
            health: actor.health,
            maxHealth: actor.maxHealth,
            fatigue: actor.fatigue,
            cultivationXp: actor.cultivationXp,
          },
          observationRevision: liveBundle.observationRevision,
          candidateSetDigest: liveBundle.candidateSetDigest,
          socialContext: {
            nearbyActorCount: context.others.length,
            nearbyRelationshipEligibleActorCount: context.others.filter(
              (other) =>
                other.relationship >= 25 &&
                !(context.recentlyTalked ?? []).includes(other.actorId),
            ).length,
            recentlyTalkedActorCount: (context.recentlyTalked ?? []).length,
            activeGroupConversation: context.activeGroupConversation !== undefined,
            sameLocationSourceCount:
              latestSocialProjectionCounts.get(actor.actorId)?.sameLocation ?? 0,
            remoteInvitationOpportunityCount:
              latestSocialProjectionCounts.get(actor.actorId)?.remote ?? 0,
            groupOpportunityCount:
              latestSocialProjectionCounts.get(actor.actorId)?.group ?? 0,
            socialCandidateCount: liveBundle.candidates.filter(isSocialCandidate).length,
          },
          candidates: liveBundle.candidates.map((candidate) => ({
            ...candidate,
            survivalReasonCodes: [...candidate.survivalReasonCodes],
            personaReasonCodes: [...candidate.personaReasonCodes],
            relationshipReasons: [...candidate.relationshipReasons],
            memorySourceIds: [...candidate.memorySourceIds],
          })),
          defaultCandidateId: choice.candidateId,
        });
        if (liveBundle.candidates.some(isSocialCandidate)) {
          socialProjectionCoverage.decisionHookSocialCandidateObservations += 1;
        }
        if (hookResult?.kind === 'wait') {
          choice = null;
          modelWaitReason = `deepseek_wait:${hookResult.reasonCode}`;
        } else if (hookResult?.kind === 'selected') {
          const selected = liveBundle.options.find(
            (option) => option.candidate.candidateId === hookResult.candidateId,
          );
          if (!selected) {
            throw new Error('purpose_bound_life_live_candidate_invalid');
          }
          context = buildContext({
            seed,
            tick,
            actor,
            actors,
            requests,
            socialRequests,
            resource,
            shop,
            relationships,
            giftDayByPair,
            pressure,
            observeSocialProjection,
            outlookMode: options.outlookMode ?? 'full',
            humanLife: options.humanLife === true,
          });
          const validated = revalidatePiNpcEligibleCandidate({
            actorId: actor.actorId,
            candidateId: hookResult.candidateId,
            proposalFingerprint: selected.proposalFingerprint,
            freshContext: context,
            now: deterministicNow(tick),
          });
          if (!validated.ok) {
            throw new Error(validated.reasonCode);
          }
          choice = {
            proposal: validated.option.proposal,
            candidateId: validated.option.candidate.candidateId,
            personaFit: validated.option.candidate.personaFit,
            rank: 0,
            personalGoalPlan: buildPersonalGoalPlanForProposal(
              context,
              deterministicNow(tick),
              validated.option.proposal,
            ),
            exceptionSourceIds: [],
          };
        }
      }
    }

    if (actor.activeGoal && choice && isMandatorySurvival(choice.proposal, actor)) {
      admitAction(actor, choice.proposal, choice.personalGoalPlan.selected, context, tick);
      return;
    }

    if (actor.activeGoal?.purposeIntent?.intendedActivity === 'intentional_idle') {
      const goal = actor.activeGoal;
      const intent = goal.purposeIntent;
      if (!intent) {
        terminalizeGoal(actor, 'failed', 'purpose_goal_intent_missing', tick);
        return;
      }
      const idle = evaluatePurposeGoalIntentionalIdle({
        intent,
        intentDigest: goal.purposeIntentDigest ?? '',
        stage: goal.purposeStage ?? 'travel_pending',
        actorId: actor.actorId,
        currentLocationId: actor.locationId,
        sourceRef: goal.sourceRef,
      });
      if (idle.ok) {
        const condition = intent.completionCondition;
        const reasonCode =
          condition.kind === 'duty_state_confirmed' ? condition.dutyState : 'on_duty';
        audit.recordIntentionalIdle({
          sequence: nextSequence(),
          gameHour: gameHour(tick),
          actorId: actor.actorId,
          reasonCode,
          goalId: goal.goalId,
          sourceRef: goal.sourceRef,
        });
        actor.intentionalIdle += 1;
        coverage.intentionalIdleObserved += 1;
        terminalizeGoal(actor, 'completed', 'purpose_goal_duty_state_confirmed', tick);
        return;
      }
    }

    if (actor.activeGoal) {
      const active = resolveActiveGoal(context, actor.activeGoal);
      if (!active.ok && isHumanSleepTime(context)) {
        // Bedtime: whatever was in hand is put down until morning, not failed.
        terminalizeGoal(actor, 'cancelled', HUMAN_BEDTIME_SET_ASIDE_REASON_CODE, tick);
        return;
      }
      if (!active.ok) {
        recordInvalidationCoverage(actor.activeGoal, active.reasonCode);
        terminalizeGoal(actor, 'failed', active.reasonCode, tick);
        return;
      }
      if (!choice) {
        terminalizeGoal(actor, 'failed', 'purpose_goal_activity_unavailable', tick);
        return;
      }
    }

    if (!choice) {
      const reasonCode =
        modelWaitReason ??
        context.purposeBoundLifeCandidateBundle?.intentionalIdle?.reasonCode ??
        (context.purposeBoundLifeCandidateBundle?.cadenceDeferred?.length
          ? 'purpose_goal_cadence_wait'
          : 'no_good_action');
      audit.recordIntentionalIdle({
        sequence: nextSequence(),
        gameHour: gameHour(tick),
        actorId: actor.actorId,
        reasonCode,
      });
      actor.intentionalIdle += 1;
      coverage.intentionalIdleObserved += 1;
      const nextCadenceGameHour = context.purposeBoundLifeCandidateBundle?.cadenceDeferred
        ?.map((entry) => entry.nextEligibleGameHour)
        .sort((left, right) => left - right)[0];
      // Asleep: stay down until morning unless a rest becomes due earlier.
      const sleepingUntil =
        reasonCode === 'sleeping'
          ? context.purposeBoundLifeCandidateBundle?.intentionalIdle?.untilGameHour
          : undefined;
      const waitUntil =
        nextCadenceGameHour !== undefined
          ? Math.max(nowGameHour + PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK, nextCadenceGameHour)
          : nowGameHour + 4;
      // Human life: sitting idle while awake lasts at most until one's bedtime.
      const idleUntil =
        sleepingUntil === undefined && isHumanSleepTime(context) === false && context.humanLifeV1
          ? Math.min(waitUntil, nextHumanBedtimeGameHour(context))
          : waitUntil;
      actor.sleepUntilGameHour =
        sleepingUntil !== undefined && nextCadenceGameHour === undefined
          ? sleepingUntil
          : sleepingUntil !== undefined
            ? Math.min(idleUntil, sleepingUntil)
            : idleUntil;
      actor.sleepReasonCode = reasonCode;
      actor.observedGlobalWakeRevision = globalWakeRevision;
      options.runtimeEventHook?.({
        type: 'intentional_idle',
        tick,
        actorId: actor.actorId,
        reasonCode,
        untilGameHour: actor.sleepUntilGameHour,
      });
      trajectory.update(`idle:${tick}:${actor.actorId}:${reasonCode}`);
      return;
    }
    if (!admitNewGoals && !actor.activeGoal) return;
    admitAction(
      actor,
      choice.proposal,
      choice.personalGoalPlan.selected,
      context,
      tick,
    );
  };

  // The scripted fixture events (quote change, a short miasma, an injury) run in
  // the first game hour. With human life everyone is asleep then, so the script
  // moves to the first morning (08:00) instead.
  const scriptOffsetTicks = options.humanLife
    ? Math.round(8 / PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK)
    : 0;
  // With human life nobody's schedule is fixed, so the quote change fires the
  // first time a seller is actually on the way to the shop (it exists to test
  // a quote invalidated mid-route), and at the latest a week into the script.
  let quoteChanged = false;
  const sellerEnRoute = () =>
    actors.some(
      (actor) =>
        actor.activeGoal?.purposeIntent?.intendedActivity === 'trade' &&
        actor.activeGoal.purposeStage === 'travel_pending' &&
        actor.pending?.proposal.type === 'travel',
    );
  const applyScheduledWorldEvents = (tick: number) => {
    const scriptTick = tick - scriptOffsetTicks;
    const quoteDue = options.humanLife
      ? !quoteChanged && scriptTick >= 2 && (sellerEnRoute() || scriptTick >= 2 + 7 * DAY_TICKS)
      : scriptTick === 2;
    if (quoteDue) {
      quoteChanged = true;
      const before = stableObservationDigest({ unitPrice: shop.unitPrice, revision: shop.revision });
      shop.unitPrice += 1;
      shop.revision += 1;
      const after = stableObservationDigest({ unitPrice: shop.unitPrice, revision: shop.revision });
      recordCause({
        tick,
        kind: 'resource',
        eventId: 'event:q6:quote_changed',
        sourceRef: `shop:${shop.shopId}`,
        before,
        after,
      });
    }
    if (options.humanLife && scriptTick === Math.round(26 / PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK)) {
      // Human life: the planted story for the rumour test (标准 R4). Only the quester
      // saw it, on the way outside the gate; everyone else can only hear of it.
      const quester = actorById.get('life:q6:quester');
      if (quester) {
        createHumanNews(
          { society, actorById, relationships, emit: options.runtimeEventHook },
          'event:q6:white_deer_sighting',
          { kind: 'sighting', subjectId: quester.actorId },
          'outside_the_gate',
          tick,
        );
      }
    }
    if (scriptTick === 3) {
      const before = stableObservationDigest({ active: pressure.active, revision: pressure.revision });
      pressure.active = true;
      pressure.revision += 1;
      const after = stableObservationDigest({ active: pressure.active, revision: pressure.revision });
      recordCause({
        tick,
        kind: 'world_event',
        eventId: 'event:q6:pressure_started',
        sourceRef: `world_event:${pressure.sourceEventId}`,
        before,
        after,
      });
    }
    if (scriptTick === 4) {
      const beforePressure = stableObservationDigest({
        active: pressure.active,
        revision: pressure.revision,
      });
      pressure.active = false;
      pressure.revision += 1;
      const afterPressure = stableObservationDigest({
        active: pressure.active,
        revision: pressure.revision,
      });
      recordCause({
        tick,
        kind: 'world_event',
        eventId: 'event:q6:pressure_ended',
        sourceRef: `world_event:${pressure.sourceEventId}`,
        before: beforePressure,
        after: afterPressure,
      });
      const emergency = actorById.get('life:q6:emergency');
      if (emergency && options.humanLife) {
        // Human life: the planted story for the rumour test (标准 R4).
        createHumanNews(
          { society, actorById, relationships, emit: options.runtimeEventHook },
          'event:q6:environmental_injury',
          { kind: 'injury', subjectId: emergency.actorId },
          emergency.locationId,
          tick,
        );
      }
      if (emergency) {
        const beforeNeed = stableObservationDigest({ health: emergency.health });
        emergency.health = 4;
        emergency.causalRevision += 1;
        const afterNeed = stableObservationDigest({ health: emergency.health });
        recordCause({
          tick,
          actorId: emergency.actorId,
          kind: 'need',
          eventId: 'event:q6:environmental_injury',
          sourceRef: `body:${emergency.actorId}`,
          before: beforeNeed,
          after: afterNeed,
        });
      }
    }
  };

  for (let tick = 1; tick <= ticks; tick += 1) {
    options.beforeTick?.(tick);
    applyScheduledWorldEvents(tick);
    if (tick >= resource.nextRefreshTick) {
      while (tick >= resource.nextRefreshTick) {
        const before = stableObservationDigest({ stock: resource.stock, revision: resource.revision });
        if (resource.stock < resource.capacity) {
          resource.stock += 1;
          resource.revision += 1;
          refreshedHerbs += 1;
        }
        const after = stableObservationDigest({ stock: resource.stock, revision: resource.revision });
        if (before !== after) {
          recordCause({
            tick,
            kind: 'resource',
            eventId: `event:q6:resource_refresh:${resource.nextRefreshTick}`,
            sourceRef: `resource:${resource.resourceNodeId}`,
            before,
            after,
          });
        }
        resource.nextRefreshTick += resource.refreshPeriodTicks;
      }
    }
    if (options.humanLife) recordSleepTransitions(tick);
    if (options.humanLife && tick % HOUR_TICKS === 0) growFamiliarity(tick);
    if (options.humanLife && tick % DAY_TICKS === 0) relieveGrudges(tick);
    if (options.observeNetwork && tick % DAY_TICKS === 0) observeNetwork(tick);
    expireGoals(actors, tick, terminalizeGoal);
    const due = actors
      .flatMap((actor) => (actor.pending ? [actor.pending] : []))
      .filter((pending) => pending.completesTick <= tick)
      .sort((left, right) => left.actionId.localeCompare(right.actionId));
    for (const pending of due) settlePending(pending, tick);
    updateReadyRequests(actors, requests);
    const scheduled = nextScheduledActors(actors, schedulerCursor);
    schedulerCursor = scheduled.nextCursor;
    for (const actor of scheduled.actors) processActor(actor, tick, true, true);
    auditIntegrity(actors, resource, shop, integrity);
    if (tick % 1_000 === 0) {
      checkpoints.push(checkpoint(tick, actions, settlements, actors, trajectory));
    }
  }

  let drainTick = ticks;
  while (
    actors.some((actor) => actor.pending || actor.activeGoal) &&
    drainTicks < PURPOSE_BOUND_LIFE_SOAK_MAX_DRAIN_TICKS
  ) {
    drainTicks += 1;
    drainTick += 1;
    const due = actors
      .flatMap((actor) => (actor.pending ? [actor.pending] : []))
      .filter((pending) => pending.completesTick <= drainTick)
      .sort((left, right) => left.actionId.localeCompare(right.actionId));
    for (const pending of due) settlePending(pending, drainTick);
    updateReadyRequests(actors, requests);
    for (const actor of actors) {
      if (actor.pending || !actor.activeGoal) continue;
      processActor(actor, drainTick, false, false);
    }
  }
  if (actors.some((actor) => actor.pending || actor.activeGoal)) integrity.drainExceeded += 1;

  const finalResources = resourceTotals(actors, resource, shop);
  if (
    finalResources.herbs !== initialResources.herbs + refreshedHerbs ||
    finalResources.stones !== initialResources.stones ||
    finalResources.healingPills + healingPillSinks !== initialResources.healingPills
  ) {
    integrity.resourceLedgerMismatch += 1;
  }
  const scheduleCounts = actors.map((actor) => actor.scheduled);
  const minimumScheduled = Math.min(...scheduleCounts);
  const maximumScheduled = Math.max(...scheduleCounts);
  const releaseAudit = audit.finish();
  const finalState = {
    actors: actors.map((actor) => ({
      actorId: actor.actorId,
      locationId: actor.locationId,
      health: actor.health,
      fatigue: actor.fatigue,
      cultivationXp: actor.cultivationXp,
      inventory: inventoryRows(actor.inventory),
      cadenceWindows: actor.cadenceWindows,
    })),
    requests,
    socialRequests,
    resource,
    shop,
    pressure,
    relationships: [...relationships.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  };
  return {
    contractVersion: PURPOSE_BOUND_LIFE_SOAK_VERSION,
    seed,
    decisionTicks: ticks,
    drainTicks,
    actorCount: actors.length,
    schedulerOpportunities,
    decisions,
    actions,
    settlements,
    providerCalls: 0,
    scenarioCoverage: coverage,
    socialProjectionCoverage,
    integrity,
    resources: {
      initialHerbs: initialResources.herbs,
      refreshedHerbs,
      finalHerbs: finalResources.herbs,
      initialSpiritStones: initialResources.stones,
      finalSpiritStones: finalResources.stones,
      initialHealingPills: initialResources.healingPills,
      healingPillSinks,
      finalHealingPills: finalResources.healingPills,
    },
    fairness: {
      minimumScheduled,
      maximumScheduled,
      spread: maximumScheduled - minimumScheduled,
    },
    releaseAudit,
    checkpoints,
    trajectoryDigest: trajectory.digest(),
    finalStateDigest: stableObservationDigest(finalState),
  };
}

export function assertPurposeBoundLifeSoakReady(summary: PurposeBoundLifeSoakSummary) {
  if (summary.contractVersion !== PURPOSE_BOUND_LIFE_SOAK_VERSION) {
    throw new Error('purpose_bound_life_soak_contract_mismatch');
  }
  assertPurposeBehaviorReleaseReady(summary.releaseAudit);
  const integrityFailures = Object.entries(summary.integrity)
    .filter(([, count]) => count !== 0)
    .map(([name]) => name);
  const { resourceDepletionsObserved, resourceContentionsAvoided, ...requiredCoverage } =
    summary.scenarioCoverage;
  const missingCoverage = Object.entries(requiredCoverage)
    .filter(([, count]) => count <= 0)
    .map(([name]) => name);
  if (resourceDepletionsObserved + resourceContentionsAvoided <= 0) {
    missingCoverage.push('resourceScarcity');
  }
  if (summary.fairness.spread > 1) integrityFailures.push('scheduler_spread');
  if (
    summary.schedulerOpportunities !==
    summary.decisionTicks * PURPOSE_BOUND_LIFE_SOAK_ACTORS_PER_TICK
  ) {
    integrityFailures.push('scheduler_opportunity_mismatch');
  }
  if (summary.releaseAudit.actions.pendingAtEnd !== 0) integrityFailures.push('pending_actions');
  if (summary.releaseAudit.goals.activeAtEnd !== 0) integrityFailures.push('active_goals');
  if (summary.actions !== summary.settlements) integrityFailures.push('unsettled_actions');
  if (
    summary.resources.finalHerbs !==
      summary.resources.initialHerbs + summary.resources.refreshedHerbs ||
    summary.resources.finalSpiritStones !== summary.resources.initialSpiritStones ||
    summary.resources.finalHealingPills + summary.resources.healingPillSinks !==
      summary.resources.initialHealingPills
  ) {
    integrityFailures.push('resource_conservation_mismatch');
  }
  if (integrityFailures.length > 0 || missingCoverage.length > 0) {
    throw new Error(
      `purpose_bound_life_soak_failed:integrity=${integrityFailures.join(',')};coverage=${missingCoverage.join(',')}`,
    );
  }
  return summary;
}

function buildContext(input: {
  seed: string;
  tick: number;
  actor: ActorState;
  actors: ActorState[];
  requests: RequestState[];
  socialRequests: SocialRequestState[];
  resource: ResourceState;
  shop: ShopState;
  relationships: Map<string, RelationshipState>;
  giftDayByPair?: Map<string, number>;
  pressure: PressureState;
  observeSocialProjection?: (
    actorId: string,
    projection: PurposeBoundLifeSocialProjection,
  ) => void;
  outlookMode?: 'full' | 'memory_only';
  humanLife?: boolean;
}): AgentContext {
  const { actor } = input;
  const location = locationById(actor.locationId);
  const nowGameHour = gameHourForTick(input.tick);
  const currentGameDay = Math.floor(nowGameHour / 24);
  const nearby = input.actors
    .filter((other) => other.actorId !== actor.actorId && other.locationId === actor.locationId)
    .map((other) => {
      const relationship = input.relationships.get(edgeKey(actor.actorId, other.actorId)) ?? {
        affinity: 0,
        trust: 0,
      };
      return {
        actorId: other.actorId,
        name: other.name,
        role: other.role,
        realm: 'qi_refining',
        relationship: relationship.affinity,
        trust: relationship.trust,
        suspicion: input.humanLife ? humanTension(actor, other, input.relationships) : 0,
        debt: input.humanLife ? (relationship as RelationshipState).debt ?? 0 : 0,
        fear: 0,
        ...(input.humanLife
          ? { impression: humanImpression(actor, other.actorId, input.tick) }
          : {}),
      };
    });
  const activeRequests: NonNullable<AgentContext['activeRequests']> = input.requests.flatMap(
    (request) =>
      request.assigneeActorId === actor.actorId &&
      (request.status === 'offered' ||
        request.status === 'accepted' ||
        request.status === 'ready_to_turn_in')
        ? [{
      requestId: request.requestId,
      revision: request.revision,
      status: request.status,
      type: request.type,
      itemId: request.itemId,
      qty: request.qty,
      issuerActorId: request.issuerActorId,
      issuerLocationId: request.issuerLocationId,
      summary: `采集并交付 ${request.qty} 份${request.itemId}`,
          }]
        : [],
  );
  const humanFocus = input.humanLife
    ? humanDayFocus({
        seedKey: `${input.seed}:human_focus:${actor.actorId}:${currentGameDay}`,
        role: actor.role,
        innerTrait: actor.innerTrait,
        outerTrait: actor.outerTrait,
      })
    : undefined;
  const giftCooldownClear = (otherActorId: string) => {
    const last = input.giftDayByPair?.get(giftPairKey(actor.actorId, otherActorId));
    return last === undefined || currentGameDay - last >= HUMAN_GIFT_PAIR_COOLDOWN_DAYS;
  };
  // Human life: keep one herb back from sale for someone - a gift owed in
  // return, or a close friend not given anything for a while.
  // A gift received is kept: neither given on nor sold.
  const receivedGiftsKept = input.humanLife
    ? Math.min(actor.receivedGiftHerbs, quantity(actor.inventory, 'spirit_herb'))
    : 0;
  const keepForGift = input.humanLife
    ? humanGiftKeepQuantity({
        ownGiftable: ownGiftableHerbs(actor, input.requests),
        owesSomeone: input.actors.some(
          (other) =>
            other.actorId !== actor.actorId &&
            (input.relationships.get(edgeKey(actor.actorId, other.actorId))?.debt ?? 0) > 0,
        ),
        hasCloseFriendDue: input.actors.some(
          (other) =>
            other.actorId !== actor.actorId &&
            (input.relationships.get(edgeKey(actor.actorId, other.actorId))?.affinity ?? 0) >=
              HUMAN_CLOSE_FRIEND_RELATIONSHIP &&
            giftCooldownClear(other.actorId),
        ),
        daysSinceOwnLastGift:
          actor.lastGiftDay === undefined ? undefined : currentGameDay - actor.lastGiftDay,
      })
    : 0;
  const socialProjection = projectPurposeBoundLifeSocialFacts({
    now: deterministicNow(input.tick),
    nowGameHour,
    currentGameDay,
    mapId: 'xianxia_purpose_lab',
    actor: {
      actorId: actor.actorId,
      locationId: actor.locationId,
      health: actor.health,
      maxHealth: actor.maxHealth,
      hasHealingItem: quantity(actor.inventory, 'healing_pill') > 0,
      hasGiftableItem: input.humanLife
        ? keepForGift > 0
        : inventoryRows(actor.inventory).some(
            (item) =>
              item.qty > 0 &&
              item.itemId !== 'spirit_stone' &&
              item.itemId !== 'healing_pill',
          ),
      aliveAndCapable: actor.health > 0,
      busy: Boolean(actor.pending),
    },
    targets: nearby.map((other) => {
      const target = input.actors.find((entry) => entry.actorId === other.actorId);
      const relationship = input.relationships.get(edgeKey(actor.actorId, other.actorId));
      const recentlyTalked =
        actor.recentTalkDays.get(other.actorId) === currentGameDay;
      return {
        actorId: other.actorId,
        role: other.role,
        locationId: actor.locationId,
        relationship: other.relationship,
        trust: other.trust ?? 0,
        suspicion: other.suspicion ?? 0,
        debt: other.debt ?? 0,
        fear: other.fear ?? 0,
        lastTouchedDay: relationship?.lastTouchedDay,
        recentlyTalked,
        aliveAndCapable: (target?.health ?? 0) > 0,
        busy: Boolean(target?.pending),
        cooldownClear: !recentlyTalked,
        sessionCapacityAvailable: !target?.pending,
        ...(input.humanLife ? { giftCooldownClear: giftCooldownClear(other.actorId) } : {}),
      };
    }),
    requests: [
      ...activeRequests.flatMap((request) =>
        request.requestId && request.issuerActorId
          ? [{
              requestId: request.requestId,
              revision: request.revision ?? 1,
              status: request.status ?? 'accepted',
              issuerActorId: request.issuerActorId,
            }]
          : [],
      ),
      ...input.socialRequests.flatMap((request) =>
        request.assigneeActorId === actor.actorId
          ? [{
              requestId: request.requestId,
              revision: request.revision,
              status: request.status,
              issuerActorId: request.issuerActorId,
            }]
          : [],
      ),
    ],
    remoteRequests: [...activeRequests.flatMap((request) => {
      const issuer = request.issuerActorId
        ? input.actors.find((entry) => entry.actorId === request.issuerActorId)
        : undefined;
      return request.requestId && issuer
        ? [{
            requestId: request.requestId,
            revision: request.revision ?? 1,
            status: request.status ?? 'accepted',
            issuerActorId: issuer.actorId,
            issuerMapId: 'xianxia_purpose_lab',
            issuerLocationId: issuer.locationId,
            issuerAliveAndCapable: issuer.health > 0,
            issuerBusy: Boolean(issuer.pending),
            summary: request.summary,
          }]
        : [];
    }), ...input.socialRequests.flatMap((request) => {
      const issuer = input.actors.find((entry) => entry.actorId === request.issuerActorId);
      return request.assigneeActorId === actor.actorId && issuer
        ? [{
            requestId: request.requestId,
            revision: request.revision,
            status: request.status,
            issuerActorId: issuer.actorId,
            issuerMapId: 'xianxia_purpose_lab',
            issuerLocationId: issuer.locationId,
            issuerAliveAndCapable: issuer.health > 0,
            issuerBusy: Boolean(issuer.pending),
            summary: request.summary,
          }]
        : [];
    })],
    beliefs: [],
    memories: input.humanLife
      ? [
          ...actor.memories.filter((memory) => memory.expiresAt > nowGameHour),
          // A quarrel one started and means to apologize for (gratitude_or_repair).
          ...actor.offenses.flatMap((offense) => {
            const createdAt = gameHourForTick(offense.tick);
            const expiresAt = createdAt + 7 * 24;
            return offense.apologize && expiresAt > nowGameHour
              ? [{
                  sourceEventId: offense.eventId,
                  aboutActorIds: [offense.victimId],
                  eventActorIds: [actor.actorId],
                  eventTargetActorIds: [offense.victimId],
                  type: 'quarrel_started',
                  source: 'direct' as const,
                  createdAt,
                  expiresAt,
                }]
              : [];
          }),
        ]
      : [],
    ...(input.humanLife
      ? {
          maintenanceMinRelationship: HUMAN_MAINTENANCE_MIN_RELATIONSHIP,
          maintenanceDebtDays: humanMaintenancePlan(humanFocus).minDebtDays,
          maintenanceDebtDaysByRelationship: humanMaintenancePlan(humanFocus).tiers,
          maintenanceGiftMinRelationship: HUMAN_CLOSE_FRIEND_RELATIONSHIP,
        }
      : {}),
    group: {
      location: {
        allowedActions: [...location.allowedActions, 'group_talk', 'group_decide'],
        dangerLevel: 0,
        capacity: 12,
        occupiedCapacity: 0,
      },
      actors: input.actors.map((entry) => ({
        actorId: entry.actorId,
        role: entry.role,
        mapId: 'xianxia_purpose_lab',
        locationId: entry.locationId,
        aliveAndCapable: entry.health > 0,
        busy: Boolean(entry.pending),
        inventory: inventoryRows(entry.inventory),
        neededItemIds:
          entry.actorId === 'life:q6:quester' ? ['spirit_herb'] : undefined,
      })),
      requests: input.requests.flatMap((request) =>
        request.status === 'accepted' || request.status === 'ready_to_turn_in'
          ? [{
              requestId: request.requestId,
              revision: request.revision,
              status: request.status,
              type: request.type,
              issuerActorId: request.issuerActorId,
              assigneeActorId: request.assigneeActorId,
              itemId: request.itemId,
            }]
          : [],
      ),
      events:
        nowGameHour <= 24
          ? [{
              eventId: 'event:q6:shared_supply_loss',
              eventType: 'resource_loss',
              createdAt: 0,
              visibility: 'witnessed',
              actorIds: ['life:q6:cultivator'],
              targetActorIds: ['life:q6:tired'],
              witnessActorIds: ['life:q6:seller'],
              mapId: 'xianxia_purpose_lab',
              locationId: 'mountain_gate',
            }]
          : [],
      resources: [{
        resourceNodeId: input.resource.resourceNodeId,
        itemId: input.resource.itemId,
        revision: resourceRevision(input.resource),
        available: Math.max(0, input.resource.stock - input.resource.reserved),
      }],
      // F1 observes the existing group opportunity without admitting its
      // coordination action. F2/F3 own arbitration and lifecycle execution.
      coordinationAllowed: false,
    },
  });
  input.observeSocialProjection?.(actor.actorId, socialProjection);
  const availableResource = Math.max(0, input.resource.stock - input.resource.reserved);
  const sourceRevision = resourceRevision(input.resource);
  const resourceOutlook = gatherOutlookFor(input);
  // Human life: a fixed sleep rhythm per person and, each day, what they feel like doing.
  const humanDay: HumanDayPlan | undefined = input.humanLife
    ? {
        ...humanChronotype(actor.actorId),
        focus: humanFocus,
        ...(keepForGift > 0 ? { keepForGift } : {}),
        ...(receivedGiftsKept > 0 ? { receivedGiftsKept } : {}),
      }
    : undefined;
  const shopRevision = shopSourceRevision(input.shop);
  // Human life: herbs kept back for a gift or promised to a commission are not for sale.
  const promisedHerbs = input.humanLife
    ? activeRequests
        .filter(
          (request) =>
            request.itemId === 'spirit_herb' &&
            (request.status === 'accepted' || request.status === 'ready_to_turn_in'),
        )
        .reduce((sum, request) => sum + (request.qty ?? 0), 0)
    : 0;
  const purposeShopOffers =
    quantity(actor.inventory, 'spirit_herb') - keepForGift - receivedGiftsKept - promisedHerbs > 0 &&
    input.shop.walletSpiritStones - input.shop.reservedWallet >= input.shop.unitPrice &&
    input.shop.herbStock + input.shop.reservedCapacity < input.shop.herbCapacity
      ? [
          {
            shopId: input.shop.shopId,
            shopName: '河湾药铺',
            locationId: input.shop.locationId,
            targetActorId: input.shop.merchantActorId,
            direction: 'sell' as const,
            itemId: 'spirit_herb',
            qty: 1,
            unitPrice: input.shop.unitPrice,
            totalPrice: input.shop.unitPrice,
            stock: input.shop.herbStock,
            capacity: input.shop.herbCapacity,
            walletSpiritStones: input.shop.walletSpiritStones - input.shop.reservedWallet,
            sourceRevision: shopRevision,
          },
        ]
      : [];
  const observationRevision = stableObservationDigest({
    seed: input.seed,
    tick: input.tick,
    actorId: actor.actorId,
    locationId: actor.locationId,
    health: actor.health,
    fatigue: actor.fatigue,
    cultivationXp: actor.cultivationXp,
    inventory: inventoryRows(actor.inventory),
    requests: activeRequests,
    resourceRevision: sourceRevision,
    ...(availableResource > 0 ? { resourceOutlook } : {}),
    ...(humanDay ? { humanDay } : {}),
    shopRevision,
    pressureRevision: input.pressure.revision,
    activeGoalRevision: actor.activeGoal?.revision,
    socialProjection: {
      sameLocationSources: socialProjection.sameLocationSources,
      remoteInvitationOpportunities: socialProjection.remoteInvitationOpportunities,
      groupOpportunities: socialProjection.groupOpportunities.map((entry) => ({
        sourceKind: entry.sourceKind,
        warrant: entry.warrant,
        candidate: entry.candidate,
      })),
    },
  });
  const context: AgentContext = {
    lifeObservation: { observationRevision } as AgentContext['lifeObservation'],
    purposeBoundLifeIntentV2: true,
    currentGameHour: nowGameHour,
    ...(humanDay ? { humanLifeV1: true, humanDay } : {}),
    personalGoal: actor.activeGoal,
    personalGoalCadences: actor.cadenceWindows,
    self: {
      actorId: actor.actorId,
      name: actor.name,
      role: actor.role,
      realm: 'qi_refining',
      realmStage: 1,
      cultivationXp: actor.cultivationXp,
      mood: actor.mood,
      health: actor.health,
      maxHealth: actor.maxHealth,
      fatigue: actor.fatigue,
      spirit: actor.spirit,
      reputation: 0,
      currentLocationId: actor.locationId,
      inventory: inventoryRows(actor.inventory),
      innerTrait: actor.innerTrait,
      outerTrait: actor.outerTrait,
      persona: `${actor.innerTrait}；${actor.outerTrait}`,
    },
    currentLocationName: location.name,
    currentLocationSpiritualEnergy: location.spiritualEnergy,
    cultivationModes: ['ambient'],
    others: nearby,
    recentEvents: [],
    availableActions: [...location.allowedActions],
    knownLocations: LOCATIONS.map((entry) => ({
      locationId: entry.locationId,
      name: entry.name,
      allowedActions: [...entry.allowedActions],
      dangerLevel: 0,
      spiritualEnergy: entry.spiritualEnergy,
    })),
    activeRequests,
    phase: phaseForTick(input.tick),
    recentlyTalked: [...actor.recentTalkDays.entries()]
      .filter(([, day]) => day === currentGameDay)
      .map(([actorId]) => actorId),
    giftCooldownTargetActorIds: [],
    sameLocationSocialSources:
      socialProjection.sameLocationSources.length > 0
        ? socialProjection.sameLocationSources
        : undefined,
    remoteSocialInvitationOpportunities:
      socialProjection.remoteInvitationOpportunities.length > 0
        ? socialProjection.remoteInvitationOpportunities
        : undefined,
    purposeResourceNodes:
      availableResource > 0
        ? [
            {
              resourceNodeId: input.resource.resourceNodeId,
              name: '凝露灵草丛',
              locationId: input.resource.locationId,
              itemId: input.resource.itemId,
              available: availableResource,
              sourceRevision,
              outlook: resourceOutlook,
            },
          ]
        : [],
    purposeShopOffers,
    worldPressures: input.pressure.active
      ? [
          {
            pressureId: input.pressure.pressureId,
            revision: input.pressure.revision,
            kind: 'herb_miasma',
            status: 'active',
            mapId: 'xianxia_purpose_lab',
            locationId: input.pressure.locationId,
            affectedResourceNodeIds: [input.resource.resourceNodeId],
            severity: 1,
            effectCodes: ['resource_refresh_delayed'],
            endsAt: deterministicNow(input.tick + 1),
            endsAtGameHour: gameHourForTick(input.tick + 1),
            sourceEventId: input.pressure.sourceEventId,
          },
        ]
      : [],
    combat: { lootTargets: [] },
  };
  const bundle = buildPurposeBoundLifeCandidateBundle(context);
  context.purposeFactsDigest = bundle.purposeFactsDigest;
  context.purposeBoundLifeCandidateBundle = projectBundle(bundle);
  return context;
}

// Everything here is observable to the actor: the patch's stock, reservations
// and refresh rhythm, who has already set out for it, and its own last trip.
function gatherOutlookFor(input: {
  tick: number;
  actor: ActorState;
  actors: ActorState[];
  requests: RequestState[];
  resource: ResourceState;
  outlookMode?: 'full' | 'memory_only';
}) {
  const { actor, resource } = input;
  const othersVisible = input.outlookMode !== 'memory_only';
  // A unit is held for another actor's accepted commission until that actor
  // sets out (then it is counted as a claimant instead).
  const heldForRequests = input.requests.filter((request) => {
    if (request.status !== 'accepted' || request.itemId !== resource.itemId) return false;
    if (request.assigneeActorId === actor.actorId) return false;
    const assignee = input.actors.find((entry) => entry.actorId === request.assigneeActorId);
    return (
      assignee !== undefined &&
      assignee.health > 0 &&
      !gatherClaimOn(assignee, resource) &&
      quantity(assignee.inventory, request.itemId) < request.qty
    );
  }).length;
  const ownGoal = gatherClaimOn(actor, resource) ? actor.activeGoal : undefined;
  const claimantsAhead = input.actors.filter((other) => {
    if (other.actorId === actor.actorId || !gatherClaimOn(other, resource)) return false;
    // Someone already gathering holds a reservation and is counted there.
    if (other.pending?.reservation?.kind === 'resource') return false;
    if (!ownGoal) return true;
    const theirs = other.activeGoal!.startedGameHour;
    return (
      theirs < ownGoal.startedGameHour ||
      (theirs === ownGoal.startedGameHour && other.actorId < actor.actorId)
    );
  }).length;
  const last = actor.gatherOutcomes.get(resource.resourceNodeId);
  return projectPurposeResourceOutlook({
    stock: resource.stock,
    reserved: resource.reserved,
    capacity: resource.capacity,
    claimantsAhead: othersVisible ? claimantsAhead : 0,
    heldForRequests: othersVisible ? heldForRequests : 0,
    nowGameHour: gameHourForTick(input.tick),
    etaGameHours:
      actor.locationId === resource.locationId ? 0 : gameHourForTick(actionDurationTicks('travel')),
    nextRefreshGameHour: gameHourForTick(resource.nextRefreshTick),
    refreshPeriodGameHours: gameHourForTick(resource.refreshPeriodTicks),
    lastOutcome: last
      ? {
          status: last.status,
          reasonCode: last.reasonCode,
          hoursAgo: gameHourForTick(input.tick - last.tick),
          ...(last.consecutiveFailures > 0 ? { consecutiveFailures: last.consecutiveFailures } : {}),
        }
      : undefined,
  });
}

function gatherClaimOn(actor: ActorState, resource: ResourceState) {
  const intent = actor.activeGoal?.purposeIntent;
  return intent?.intendedActivity === 'gather' && intent.targetLocationId === resource.locationId;
}

function projectBundle(bundle: PurposeBoundLifeCandidateBundleV2) {
  return {
    purposeFactsDigest: bundle.purposeFactsDigest,
    candidates: bundle.candidates.map((candidate) => ({
      planner: candidate.planner,
      candidateId: candidate.candidateId,
      legacyOrder: candidate.legacyOrder,
      proposal: candidate.proposal,
      personalGoalCandidate: candidate.personalGoalCandidate,
    })),
    intentionalIdle: bundle.intentionalIdle
      ? {
          sourceRef: bundle.intentionalIdle.sourceRef,
          reasonCode: bundle.intentionalIdle.reasonCode,
          ...(bundle.intentionalIdle.untilGameHour !== undefined
            ? { untilGameHour: bundle.intentionalIdle.untilGameHour }
            : {}),
        }
      : undefined,
    cadenceDeferred: bundle.cadenceDeferred,
  };
}

function resolveActiveGoal(context: AgentContext, goal: ActivePersonalGoal) {
  const intent = goal.purposeIntent;
  const digest = goal.purposeIntentDigest;
  if (!intent || !digest || !goal.purposeStage) {
    return { ok: false as const, reasonCode: 'purpose_goal_intent_missing' };
  }
  let sawSource = false;
  let sawRevision = false;
  let sawTarget = false;
  const expectedAction =
    goal.purposeStage === 'travel_pending' ? 'travel' : intent.intendedActivity;
  for (const candidate of context.purposeBoundLifeCandidateBundle?.candidates ?? []) {
    const candidateIntent = purposeIntentFromProposal(candidate.proposal);
    if (!candidateIntent || candidateIntent.sourceRef !== intent.sourceRef) continue;
    sawSource = true;
    if (candidateIntent.sourceRevision !== intent.sourceRevision) continue;
    sawRevision = true;
    if (candidateIntent.targetLocationId !== intent.targetLocationId) continue;
    sawTarget = true;
    if (
      candidate.proposal.params?.purposeBoundIntentDigest === digest &&
      candidate.proposal.type === expectedAction
    ) {
      return { ok: true as const };
    }
  }
  if (!sawSource) return { ok: false as const, reasonCode: 'purpose_goal_source_missing' };
  if (!sawRevision) {
    return { ok: false as const, reasonCode: 'purpose_goal_source_revision_stale' };
  }
  if (!sawTarget) return { ok: false as const, reasonCode: 'purpose_goal_target_stale' };
  return { ok: false as const, reasonCode: 'purpose_goal_activity_unavailable' };
}

function reserveAction(
  actor: ActorState,
  proposal: AgentProposal,
  actionId: string,
  eventId: string,
  tick: number,
  resource: ResourceState,
  shop: ShopState,
): PendingAction {
  let reservation: PendingAction['reservation'];
  if (proposal.type === 'gather' && resource.stock - resource.reserved > 0) {
    resource.reserved += 1;
    reservation = { kind: 'resource', quantity: 1 };
  }
  if (
    proposal.type === 'trade' &&
    quantity(actor.inventory, 'spirit_herb') > 0 &&
    shop.walletSpiritStones - shop.reservedWallet >= shop.unitPrice &&
    shop.herbStock + shop.reservedCapacity < shop.herbCapacity
  ) {
    shop.reservedCapacity += 1;
    shop.reservedWallet += shop.unitPrice;
    reservation = {
      kind: 'shop',
      quantity: 1,
      price: shop.unitPrice,
      quoteRevision: shopSourceRevision(shop),
    };
  }
  return {
    actionId,
    eventId,
    actorId: actor.actorId,
    proposal,
    startedTick: tick,
    completesTick: tick + actionDurationTicks(proposal.type),
    reservation,
  };
}

function applyActionEffects(input: {
  actor: ActorState;
  pending: PendingAction;
  actorById: Map<string, ActorState>;
  requests: RequestState[];
  resource: ResourceState;
  shop: ShopState;
  relationships: Map<string, RelationshipState>;
  giftDayByPair?: Map<string, number>;
  pressure: PressureState;
  humanLife?: boolean;
  society?: SocietyState;
  emit?: (event: PurposeBoundLifeRuntimeEvent) => void;
}): { applied: boolean; reasonCode?: string } {
  const { actor, pending, resource, shop } = input;
  const proposal = pending.proposal;
  if (actor.health <= 0) return rejectAndRelease(pending, resource, shop, 'actor_incapacitated');
  if (proposal.type === 'travel') {
    if (!proposal.targetId || !LOCATIONS.some((entry) => entry.locationId === proposal.targetId)) {
      return { applied: false, reasonCode: 'location_unknown' };
    }
    actor.locationId = proposal.targetId;
    return { applied: true };
  }
  const location = locationById(actor.locationId);
  if (!(location.allowedActions as readonly ActionType[]).includes(proposal.type)) {
    return rejectAndRelease(pending, resource, shop, 'activity_unavailable');
  }
  if (proposal.type === 'rest') {
    actor.fatigue = clamp(actor.fatigue - 40, 0, 100);
    // Human life: sitting a while somewhere pleasant lifts the mood a little.
    if (input.humanLife && isHumanLeisureSpot(locationById(actor.locationId), homeZone(actor.role))) {
      actor.mood = humanMoodLifted(actor.mood);
    }
    return { applied: true };
  }
  if (proposal.type === 'cultivate') {
    if (actor.fatigue >= 80) return { applied: false, reasonCode: 'fatigue_too_high' };
    actor.cultivationXp += 2;
    actor.fatigue = clamp(actor.fatigue + 10, 0, 100);
    return { applied: true };
  }
  if (proposal.type === 'gather') {
    if (pending.reservation?.kind !== 'resource' || resource.stock < 1) {
      return rejectAndRelease(pending, resource, shop, 'resource_depleted');
    }
    resource.reserved -= 1;
    resource.stock -= 1;
    resource.revision += 1;
    addQuantity(actor.inventory, resource.itemId, 1);
    actor.fatigue = clamp(actor.fatigue + 25, 0, 100);
    updateReadyRequests([...input.actorById.values()], input.requests);
    return { applied: true };
  }
  if (proposal.type === 'trade') {
    const reservation = pending.reservation;
    if (
      reservation?.kind !== 'shop' ||
      quantity(actor.inventory, 'spirit_herb') < 1 ||
      shop.reservedCapacity < 1 ||
      shop.reservedWallet < reservation.price
    ) {
      return rejectAndRelease(pending, resource, shop, 'shop_quote_unavailable');
    }
    removeQuantity(actor.inventory, 'spirit_herb', 1);
    actor.receivedGiftHerbs = Math.min(actor.receivedGiftHerbs, quantity(actor.inventory, 'spirit_herb'));
    shop.reservedCapacity -= 1;
    shop.reservedWallet -= reservation.price;
    shop.herbStock += 1;
    shop.walletSpiritStones -= reservation.price;
    shop.revision += 1;
    addQuantity(actor.inventory, 'spirit_stone', reservation.price);
    return { applied: true };
  }
  if (proposal.type === 'use_item') {
    if (!removeQuantity(actor.inventory, 'healing_pill', 1)) {
      return { applied: false, reasonCode: 'item_unavailable' };
    }
    actor.health = Math.min(actor.maxHealth, actor.health + 6);
    return { applied: true };
  }
  const requestId = stringParam(proposal.params, 'requestId');
  const request = requestId
    ? input.requests.find((entry) => entry.requestId === requestId)
    : undefined;
  if (proposal.type === 'accept_request') {
    if (!request || request.status !== 'offered' || request.assigneeActorId !== actor.actorId) {
      return { applied: false, reasonCode: 'request_stale' };
    }
    request.status = 'accepted';
    request.revision += 1;
    return { applied: true };
  }
  if (proposal.type === 'decline_request') {
    if (!request || request.status !== 'offered' || request.assigneeActorId !== actor.actorId) {
      return { applied: false, reasonCode: 'request_stale' };
    }
    request.status = 'declined';
    request.revision += 1;
    return { applied: true };
  }
  if (proposal.type === 'turn_in_request') {
    const issuer = request ? input.actorById.get(request.issuerActorId) : undefined;
    if (
      !request ||
      request.status !== 'ready_to_turn_in' ||
      request.assigneeActorId !== actor.actorId ||
      !issuer ||
      issuer.locationId !== actor.locationId ||
      quantity(actor.inventory, request.itemId) < request.qty ||
      quantity(issuer.inventory, 'spirit_stone') < request.rewardSpiritStones
    ) {
      return { applied: false, reasonCode: 'request_turn_in_unavailable' };
    }
    removeQuantity(actor.inventory, request.itemId, request.qty);
    actor.receivedGiftHerbs = Math.min(actor.receivedGiftHerbs, quantity(actor.inventory, 'spirit_herb'));
    addQuantity(issuer.inventory, request.itemId, request.qty);
    removeQuantity(issuer.inventory, 'spirit_stone', request.rewardSpiritStones);
    addQuantity(actor.inventory, 'spirit_stone', request.rewardSpiritStones);
    request.status = 'completed';
    request.revision += 1;
    if (input.humanLife && input.society) {
      createHumanNews(
        { society: input.society, actorById: input.actorById, relationships: input.relationships, emit: input.emit },
        `news:${pending.actionId}`,
        { kind: 'commission', subjectId: actor.actorId, objectId: issuer.actorId },
        actor.locationId,
        pending.completesTick,
      );
    }
    return { applied: true };
  }
  if (proposal.type === 'talk') {
    const target = proposal.targetActorId
      ? input.actorById.get(proposal.targetActorId)
      : undefined;
    if (!target || target.locationId !== actor.locationId) {
      return { applied: false, reasonCode: 'target_not_nearby' };
    }
    const key = edgeKey(actor.actorId, target.actorId);
    const touchedDay = Math.floor(gameHourForTick(pending.completesTick) / 24);
    const current = input.relationships.get(key) ?? {
      affinity: 0,
      trust: 0,
      lastTouchedDay: touchedDay,
    };
    if (input.humanLife && input.society) {
      const tick = pending.completesTick;
      const society: SocietyInput = {
        society: input.society,
        actorById: input.actorById,
        relationships: input.relationships,
        emit: input.emit,
      };
      const sourceRef = purposeIntentFromProposal(proposal)?.sourceRef ?? '';
      const eventId = sourceRef.startsWith('event:') ? sourceRef.slice('event:'.length) : undefined;
      const offense = eventId
        ? actor.offenses.find(
            (entry) => entry.apologize && entry.eventId === eventId && entry.victimId === target.actorId,
          )
        : undefined;
      if (offense) {
        // An apology: the one wronged lets go of part of the grudge.
        adjustRelationship(input.relationships, target.actorId, actor.actorId, touchedDay, {
          affinity: APOLOGY_AFFINITY,
          suspicion: -APOLOGY_SUSPICION_RELIEF,
        });
        adjustRelationship(input.relationships, actor.actorId, target.actorId, touchedDay, { affinity: 1 });
        const scarred = input.society.grudges.get(edgeKey(target.actorId, actor.actorId));
        if (scarred) scarred.scar = Math.round(scarred.scar * APOLOGY_SCAR_SHARE * 100) / 100;
        actor.offenses = actor.offenses.filter((entry) => entry !== offense);
        input.emit?.({
          type: 'social_event',
          tick,
          actorId: actor.actorId,
          targetActorId: target.actorId,
          reasonCode: 'apology',
          finalLocationId: actor.locationId,
        });
        createHumanNews(society, `news:${pending.actionId}`, {
          kind: 'apology',
          subjectId: actor.actorId,
          objectId: target.actorId,
        }, actor.locationId, tick);
        actor.recentTalkDays.set(target.actorId, touchedDay);
        return { applied: true };
      }
      const chemistry = chatAffinityGain(actor, target);
      const quarrel =
        seededRoll(`${pending.actionId}:quarrel`) <
        humanQuarrelChance({
          chemistry,
          speaker: actor,
          listener: target,
          speakerMood: actor.mood,
          tension: Math.max(
            humanTension(actor, target, input.relationships),
            humanTension(target, actor, input.relationships),
          ),
          troubleImpression: humanImpression(actor, target.actorId, tick).trouble,
        });
      if (quarrel) {
        // Words got sharp: whoever said the hurtful thing offended the other.
        const offender = humanQuarrelOffender(actor, target) === actor.actorId ? actor : target;
        const victim = offender === actor ? target : actor;
        adjustRelationship(input.relationships, victim.actorId, offender.actorId, touchedDay, {
          affinity: -QUARREL_AFFINITY_LOSS,
          trust: -3,
          suspicion: QUARREL_SUSPICION,
        });
        adjustRelationship(input.relationships, offender.actorId, victim.actorId, touchedDay, {
          affinity: -QUARREL_OFFENDER_AFFINITY_LOSS,
          suspicion: QUARREL_OFFENDER_SUSPICION,
        });
        const grudgeKey = edgeKey(victim.actorId, offender.actorId);
        const grudge = input.society.grudges.get(grudgeKey);
        const ceiling =
          grudge?.ceiling ??
          (input.relationships.get(grudgeKey)?.affinity ?? 0) + QUARREL_AFFINITY_LOSS;
        input.society.grudges.set(grudgeKey, {
          victimId: victim.actorId,
          offenderId: offender.actorId,
          lost: (grudge?.lost ?? 0) + QUARREL_AFFINITY_LOSS,
          recovered: grudge?.recovered ?? 0,
          scar: (grudge?.scar ?? 0) + QUARREL_AFFINITY_LOSS * QUARREL_SCAR_SHARE,
          ceiling,
        });
        actor.mood = clamp(actor.mood - 1, 0, 10);
        target.mood = clamp(target.mood - 1, 0, 10);
        offender.offenses.push({
          eventId: pending.actionId,
          victimId: victim.actorId,
          tick,
          apologize: humanWillApologize(offender),
        });
        input.emit?.({
          type: 'social_event',
          tick,
          actorId: offender.actorId,
          targetActorId: victim.actorId,
          reasonCode: 'quarrel',
          finalLocationId: actor.locationId,
        });
        createHumanNews(society, `news:${pending.actionId}`, {
          kind: 'quarrel',
          subjectId: offender.actorId,
          objectId: victim.actorId,
        }, actor.locationId, tick);
        actor.recentTalkDays.set(target.actorId, touchedDay);
        return { applied: true };
      }
      // A chat brings two people closer by how well they click (it can also push
      // them apart). A thank-you pays back part of a gift; small talk pays back
      // nothing. Both may pass on what they have heard.
      adjustRelationship(input.relationships, actor.actorId, target.actorId, touchedDay, {
        affinity: chemistry,
        ...(eventId ? { repay: 3 } : {}),
      });
      adjustRelationship(input.relationships, target.actorId, actor.actorId, touchedDay, {
        affinity: chemistry,
      });
      rememberSocialEvent(target, actor.actorId, pending.actionId, 'conversation_started', pending.completesTick);
      shareHumanNews(society, actor, target, tick, `${pending.actionId}:tell`);
      shareHumanNews(society, target, actor, tick, `${pending.actionId}:reply`);
    } else {
      input.relationships.set(key, {
        affinity: current.affinity + 1,
        trust: current.trust,
        lastTouchedDay: touchedDay,
      });
    }
    actor.recentTalkDays.set(target.actorId, touchedDay);
    return { applied: true };
  }
  if (proposal.type === 'gift') {
    const target = proposal.targetActorId
      ? input.actorById.get(proposal.targetActorId)
      : undefined;
    const itemId = stringParam(proposal.params, 'itemId');
    // Human life: only what is one's own to give - not a gift received, not a
    // herb promised to a commission.
    if (input.humanLife && itemId === 'spirit_herb' && ownGiftableHerbs(actor, input.requests) < 1) {
      return { applied: false, reasonCode: 'gift_unavailable' };
    }
    if (!target || !itemId || !removeQuantity(actor.inventory, itemId, 1)) {
      return { applied: false, reasonCode: 'gift_unavailable' };
    }
    addQuantity(target.inventory, itemId, 1);
    if (input.humanLife) {
      const touchedDay = Math.floor(gameHourForTick(pending.completesTick) / 24);
      if (itemId === 'spirit_herb') target.receivedGiftHerbs += 1;
      target.mood = humanMoodLifted(target.mood);
      // gift_accepted: the receiver warms to the giver and owes them (debt +5).
      // A return gift first settles what the giver owed; only the rest is new debt.
      const owed = input.relationships.get(edgeKey(actor.actorId, target.actorId))?.debt ?? 0;
      const settled = Math.min(owed, 5);
      adjustRelationship(input.relationships, target.actorId, actor.actorId, touchedDay, {
        affinity: 6,
        trust: 1,
        owe: 5 - settled,
      });
      adjustRelationship(input.relationships, actor.actorId, target.actorId, touchedDay, {
        affinity: 2,
        repay: settled,
      });
      input.giftDayByPair?.set(giftPairKey(actor.actorId, target.actorId), touchedDay);
      actor.lastGiftDay = touchedDay;
      rememberSocialEvent(target, actor.actorId, pending.actionId, 'gift_given', pending.completesTick);
      if (input.society) {
        createHumanNews(
          { society: input.society, actorById: input.actorById, relationships: input.relationships, emit: input.emit },
          `news:${pending.actionId}`,
          { kind: 'gift', subjectId: actor.actorId, objectId: target.actorId },
          actor.locationId,
          pending.completesTick,
        );
      }
    }
    return { applied: true };
  }
  if (proposal.type === 'explore') {
    if (!input.pressure.active) {
      return { applied: false, reasonCode: 'world_event_invalidated' };
    }
    input.pressure.active = false;
    input.pressure.revision += 1;
    actor.mood = clamp(actor.mood + 1, 0, 10);
    actor.fatigue = clamp(actor.fatigue + 10, 0, 100);
    return { applied: true };
  }
  return { applied: false, reasonCode: 'unsupported_action' };
}

function rejectAndRelease(
  pending: PendingAction,
  resource: ResourceState,
  shop: ShopState,
  reasonCode: string,
) {
  if (pending.reservation?.kind === 'resource') {
    resource.reserved = Math.max(0, resource.reserved - pending.reservation.quantity);
  }
  if (pending.reservation?.kind === 'shop') {
    shop.reservedCapacity = Math.max(0, shop.reservedCapacity - pending.reservation.quantity);
    shop.reservedWallet = Math.max(0, shop.reservedWallet - pending.reservation.price);
  }
  return { applied: false, reasonCode };
}

function createActors(seed: string): ActorState[] {
  return ACTOR_BLUEPRINTS.map(
    ([actorId, name, role, innerTrait, outerTrait, locationId], index) => {
      const inventory: Inventory = {
        spirit_stone: index === 0 ? 60 : 12,
      };
      if (actorId === 'life:q6:seller') inventory.spirit_herb = 1;
      if (actorId === 'life:q6:emergency') inventory.healing_pill = 1;
      return {
        actorId,
        name,
        role,
        innerTrait,
        outerTrait,
        locationId,
        health: 10,
        maxHealth: 10,
        fatigue:
          actorId === 'life:q6:tired'
            ? 72
            : Math.floor(seededRoll(`${seed}:fatigue:${actorId}`) * 8),
        cultivationXp: Math.floor(seededRoll(`${seed}:xp:${actorId}`) * 4),
        spirit: 5,
        mood: 5,
        inventory,
        cadenceWindows: [],
        goalRevision: 0,
        causalRevision: 0,
        scheduled: 0,
        decisions: 0,
        actions: 0,
        intentionalIdle: 0,
        observedGlobalWakeRevision: 0,
        recentTalkDays: new Map<string, number>(),
        memories: [],
        receivedGiftHerbs: 0,
        knowledge: new Map(),
        offenses: [],
        gatherOutcomes: new Map(),
      };
    },
  );
}

function createRequests(): RequestState[] {
  return [
    {
      requestId: 'q6_request_herb',
      revision: 1,
      status: 'offered',
      type: 'collect_item',
      itemId: 'spirit_herb',
      qty: 1,
      issuerActorId: 'life:q6:cultivator',
      issuerLocationId: 'mountain_gate',
      assigneeActorId: 'life:q6:quester',
      rewardSpiritStones: 6,
    },
  ];
}

function createSocialRequests(): SocialRequestState[] {
  return [{
    requestId: 'q6_guard_report',
    revision: 1,
    status: 'accepted',
    issuerActorId: 'life:q6:cultivator',
    assigneeActorId: 'life:q6:guard',
    summary: '向守静弟子说明丹房当值情况',
  }];
}

function createResource(seed: string): ResourceState {
  return {
    resourceNodeId: 'q6_dew_patch',
    locationId: 'herb_field',
    itemId: 'spirit_herb',
    stock: 1,
    reserved: 0,
    capacity: 3,
    revision: 1,
    refreshPeriodTicks: 48 + Math.floor(seededRoll(`${seed}:refresh`) * 24),
    nextRefreshTick: 40,
  };
}

function createShop(seed: string): ShopState {
  return {
    shopId: 'q6_herb_shop',
    merchantActorId: 'life:q6:merchant',
    locationId: 'market',
    herbStock: 0,
    herbCapacity: 20_000,
    walletSpiritStones: 20_000,
    reservedCapacity: 0,
    reservedWallet: 0,
    unitPrice: 4 + Math.floor(seededRoll(`${seed}:price`) * 3),
    revision: 1,
  };
}

function adjustRelationship(
  relationships: Map<string, RelationshipState>,
  fromActorId: string,
  toActorId: string,
  day: number,
  change: {
    affinity?: number;
    trust?: number;
    owe?: number;
    repay?: number;
    suspicion?: number;
    // Hearing about someone is not contact with them: keep lastTouchedDay.
    touch?: boolean;
  },
) {
  const key = edgeKey(fromActorId, toActorId);
  const current = relationships.get(key) ?? { affinity: 0, trust: 0, lastTouchedDay: day };
  const debt = (current.debt ?? 0) + (change.owe ?? 0);
  const suspicion =
    current.suspicion !== undefined || change.suspicion !== undefined
      ? clamp(Math.round(((current.suspicion ?? 0) + (change.suspicion ?? 0)) * 100) / 100, 0, 100)
      : undefined;
  relationships.set(key, {
    affinity: clamp(Math.round((current.affinity + (change.affinity ?? 0)) * 100) / 100, -100, 100),
    trust: clamp(current.trust + (change.trust ?? 0), -100, 100),
    lastTouchedDay: change.touch === false ? current.lastTouchedDay : day,
    debt: change.repay ? Math.max(0, debt - change.repay) : debt,
    ...(suspicion !== undefined ? { suspicion } : {}),
  });
}

// ---------------------------------------------------------------- human life: society

type SocietyInput = {
  society: SocietyState;
  actorById: Map<string, ActorState>;
  relationships: Map<string, RelationshipState>;
  emit?: (event: PurposeBoundLifeRuntimeEvent) => void;
};

function humanAwake(actor: ActorState, tick: number) {
  return !isHumanSleepTime({
    humanLifeV1: true,
    currentGameHour: gameHourForTick(tick),
    humanDay: humanChronotype(actor.actorId),
  } as AgentContext);
}

// How `observer` sees `subjectId`, from what the observer knows of the last 30 days.
function humanImpression(observer: ActorState, subjectId: string, tick: number) {
  const now = gameHourForTick(tick);
  return humanImpressionOf(
    [...observer.knowledge.values()].filter(
      (entry) => now - gameHourForTick(entry.heardTick) <= HUMAN_NEWS_MEMORY_HOURS,
    ),
    subjectId,
  );
}

// The strain between two people as `actor` feels it: the grudge `actor` holds,
// or, after a quarrel `actor` started, the grudge held against them.
function humanTension(
  actor: ActorState,
  other: ActorState,
  relationships: Map<string, RelationshipState>,
) {
  const own = relationships.get(edgeKey(actor.actorId, other.actorId))?.suspicion ?? 0;
  const strain = actor.offenses.some((offense) => offense.victimId === other.actorId)
    ? relationships.get(edgeKey(other.actorId, actor.actorId))?.suspicion ?? 0
    : 0;
  return Math.max(own, strain);
}

function learnHumanNews(
  input: SocietyInput,
  hearer: ActorState,
  newsId: string,
  version: HumanNewsVersion,
  source: HumanNewsSource,
  tick: number,
  extra: { fromActorId?: string; distortion?: string; corrected?: boolean } = {},
) {
  const truth = input.society.news.get(newsId)?.truth;
  const previous = hearer.knowledge.get(newsId);
  hearer.knowledge.set(newsId, { version, source, heardTick: tick, fromActorId: extra.fromActorId });
  input.emit?.({
    type: 'news_heard',
    tick,
    actorId: hearer.actorId,
    newsId,
    newsKind: version.kind,
    newsSource: source,
    distorted: truth ? !sameHumanNewsVersion(version, truth) : false,
    distortion: extra.distortion,
    corrected: extra.corrected === true,
    subjectActorId: version.subjectId,
    objectActorId: version.objectId,
    newsExaggerated: version.exaggerated === true,
    fromActorId: extra.fromActorId,
  });
  // Feelings form the first time one hears of it; the people in it feel the
  // event itself, not the news.
  if (previous || version.subjectId === hearer.actorId || version.objectId === hearer.actorId) return;
  const day = Math.floor(gameHourForTick(tick) / 24);
  if (isNegativeHumanNews(version.kind)) {
    adjustRelationship(input.relationships, hearer.actorId, version.subjectId, day, {
      affinity: -1,
      touch: false,
    });
    if (version.objectId) {
      // A friend of the one wronged may take it up (grudgeLogic.deriveGrudges).
      const seed = humanAllyGrudge({
        offenderId: version.subjectId,
        hearer,
        closenessToVictim:
          input.relationships.get(edgeKey(hearer.actorId, version.objectId))?.affinity ?? 0,
      });
      if (seed) {
        adjustRelationship(input.relationships, hearer.actorId, version.subjectId, day, {
          affinity: seed.delta.affinity ?? 0,
          suspicion: seed.delta.suspicion ?? 0,
          touch: false,
        });
      }
    }
  } else if (version.kind !== 'injury') {
    adjustRelationship(input.relationships, hearer.actorId, version.subjectId, day, {
      affinity: 1,
      touch: false,
    });
  }
}

// Something happened: the people in it know it, and so does everyone awake who was there.
function createHumanNews(
  input: SocietyInput,
  newsId: string,
  truth: HumanNewsVersion,
  locationId: string,
  tick: number,
) {
  if (input.society.news.has(newsId)) return;
  input.society.news.set(newsId, { newsId, truth, tick, locationId });
  for (const actor of input.actorById.values()) {
    const principal = actor.actorId === truth.subjectId || actor.actorId === truth.objectId;
    const witness =
      !principal && actor.health > 0 && actor.locationId === locationId && humanAwake(actor, tick);
    if (!principal && !witness) continue;
    learnHumanNews(input, actor, newsId, truth, principal ? 'direct' : 'witness', tick);
  }
}

// One side of a chat: first set right a wrong version the hearer holds (if the
// teller knows it first-hand), otherwise perhaps pass on the most notable fresh
// thing the hearer has not heard. Second-hand retelling may garble it.
function shareHumanNews(
  input: SocietyInput,
  teller: ActorState,
  hearer: ActorState,
  tick: number,
  rollKey: string,
) {
  for (const [newsId, known] of teller.knowledge) {
    if (known.source === 'told') continue;
    const heard = hearer.knowledge.get(newsId);
    if (!heard || sameHumanNewsVersion(heard.version, known.version)) continue;
    learnHumanNews(input, hearer, newsId, known.version, 'told', tick, {
      fromActorId: teller.actorId,
      corrected: true,
    });
    return;
  }
  const closeness = input.relationships.get(edgeKey(teller.actorId, hearer.actorId))?.affinity ?? 0;
  const now = gameHourForTick(tick);
  const pick = [...teller.knowledge.entries()]
    .filter(([newsId, known]) => {
      if (hearer.knowledge.has(newsId)) return false;
      if (now - gameHourForTick(known.heardTick) > HUMAN_NEWS_MEMORY_HOURS) return false;
      if (known.version.subjectId === hearer.actorId || known.version.objectId === hearer.actorId) {
        return false;
      }
      // Nobody spreads a bad story about a close friend.
      const friend =
        (input.relationships.get(edgeKey(teller.actorId, known.version.subjectId))?.affinity ?? 0) >= 40;
      return !(isNegativeHumanNews(known.version.kind) && friend);
    })
    .sort(
      ([leftId, left], [rightId, right]) =>
        HUMAN_NEWS_SALIENCE[right.version.kind] - HUMAN_NEWS_SALIENCE[left.version.kind] ||
        right.heardTick - left.heardTick ||
        leftId.localeCompare(rightId),
    )[0];
  if (!pick) return;
  const [newsId, known] = pick;
  // The more striking the story, the harder it is to keep to oneself.
  const salience = HUMAN_NEWS_SALIENCE[known.version.kind];
  if (seededRoll(`${rollKey}:gossip`) >= humanGossipChance(teller, closeness, salience)) return;
  let version = known.version;
  let distortion: string | undefined;
  if (
    isNegativeHumanNews(version.kind) &&
    version.subjectId === teller.actorId &&
    version.objectId &&
    humanTellsSelfServing(teller)
  ) {
    // The one who started it tells it the other way round.
    version = { ...version, subjectId: version.objectId, objectId: teller.actorId };
    distortion = 'self_serving';
  } else if (known.source === 'told' && seededRoll(`${rollKey}:distort`) < HUMAN_NEWS_DISTORTION_CHANCE) {
    const others = [...input.actorById.keys()]
      .filter((actorId) => actorId !== teller.actorId && actorId !== hearer.actorId)
      .sort();
    const garbled = humanDistortNews(version, seededRoll(`${rollKey}:how`), others);
    version = garbled.version;
    distortion = garbled.distortion;
  }
  learnHumanNews(input, hearer, newsId, version, 'told', tick, {
    fromActorId: teller.actorId,
    distortion,
  });
}

// Human life: herbs this actor may give away - not ones received as gifts,
// not ones already promised to a commission.
function ownGiftableHerbs(actor: ActorState, requests: readonly RequestState[]) {
  const held = quantity(actor.inventory, 'spirit_herb');
  const promised = requests
    .filter(
      (request) =>
        request.assigneeActorId === actor.actorId &&
        (request.status === 'accepted' || request.status === 'ready_to_turn_in'),
    )
    .reduce((sum, request) => sum + request.qty, 0);
  return Math.max(0, held - Math.min(actor.receivedGiftHerbs, held) - promised);
}

function giftPairKey(left: string, right: string) {
  return [left, right].sort().join('|');
}

const SOCIAL_MEMORY_HOURS = 7 * 24;
const SOCIAL_MEMORY_LIMIT = 24;

function rememberSocialEvent(
  rememberer: ActorState,
  otherActorId: string,
  eventId: string,
  type: string,
  tick: number,
) {
  const createdAt = gameHourForTick(tick);
  rememberer.memories = [
    ...rememberer.memories.filter((memory) => memory.expiresAt > createdAt),
    {
      sourceEventId: eventId,
      aboutActorIds: [otherActorId],
      eventActorIds: [otherActorId],
      eventTargetActorIds: [rememberer.actorId],
      type,
      source: 'direct' as const,
      createdAt,
      expiresAt: createdAt + SOCIAL_MEMORY_HOURS,
    },
  ].slice(-SOCIAL_MEMORY_LIMIT);
}

function createRelationships(actors: ActorState[], seed: string) {
  const relationships = new Map<string, RelationshipState>();
  for (const actor of actors) {
    for (const other of actors) {
      if (actor.actorId === other.actorId) continue;
      const close = seededRoll(`${seed}:relationship:${actor.actorId}:${other.actorId}`) > 0.92;
      relationships.set(edgeKey(actor.actorId, other.actorId), {
        affinity: close ? 30 : 5,
        trust: close ? 20 : 5,
        lastTouchedDay: 0,
      });
    }
  }
  return relationships;
}

function expireGoals(
  actors: ActorState[],
  tick: number,
  terminalize: (
    actor: ActorState,
    status: 'completed' | 'cancelled' | 'failed' | 'expired',
    reasonCode: string,
    tick: number,
  ) => void,
) {
  const now = gameHourForTick(tick);
  for (const actor of actors) {
    const goal = actor.activeGoal;
    if (!goal || actor.pending) continue;
    if (now >= goal.hardDeadlineGameHour) {
      terminalize(actor, 'expired', 'goal_hard_deadline_expired', tick);
    } else if (now >= goal.deadlineGameHour) {
      terminalize(actor, 'expired', 'goal_deadline_expired', tick);
    }
  }
}

function updateReadyRequests(actors: ActorState[], requests: RequestState[]) {
  const byId = new Map(actors.map((actor) => [actor.actorId, actor]));
  for (const request of requests) {
    if (request.status !== 'accepted') continue;
    const assignee = byId.get(request.assigneeActorId);
    if (assignee && quantity(assignee.inventory, request.itemId) >= request.qty) {
      request.status = 'ready_to_turn_in';
      request.revision += 1;
    }
  }
}

function countCompletedPurpose(
  goal: ActivePersonalGoal,
  coverage: PurposeBoundLifeScenarioCoverage,
) {
  switch (goal.purposeIntent?.intendedActivity) {
    case 'cultivate':
      coverage.cultivationCompleted += 1;
      break;
    case 'rest':
      coverage.recoveryCompleted += 1;
      break;
    case 'gather':
      coverage.herbsGathered += 1;
      break;
    case 'trade':
      coverage.herbsSold += 1;
      break;
    case 'accept_request':
      coverage.requestsAccepted += 1;
      break;
    case 'turn_in_request':
      coverage.requestsCompleted += 1;
      break;
  }
}

function causalKind(actionType: ActionType): PurposeBehaviorCausalChangeKind {
  if (actionType === 'rest' || actionType === 'use_item') return 'need';
  if (actionType === 'gather' || actionType === 'trade') return 'resource';
  if (actionType === 'talk' || actionType === 'gift' || actionType === 'request_teaching') {
    return 'relationship';
  }
  if (
    actionType === 'accept_request' ||
    actionType === 'decline_request' ||
    actionType === 'turn_in_request'
  ) {
    return 'duty';
  }
  return 'world_event';
}

function causalSnapshot(
  actor: ActorState,
  requests: RequestState[],
  resource: ResourceState,
  shop: ShopState,
  relationships: Map<string, RelationshipState>,
  pressure: PressureState,
) {
  return stableObservationDigest({
    actor: {
      actorId: actor.actorId,
      health: actor.health,
      fatigue: actor.fatigue,
      cultivationXp: actor.cultivationXp,
      mood: actor.mood,
      inventory: inventoryRows(actor.inventory),
    },
    requests: requests
      .filter(
        (request) =>
          request.assigneeActorId === actor.actorId || request.issuerActorId === actor.actorId,
      )
      .map((request) => ({
        requestId: request.requestId,
        revision: request.revision,
        status: request.status,
      })),
    resource: { stock: resource.stock, reserved: resource.reserved, revision: resource.revision },
    shop: {
      stock: shop.herbStock,
      wallet: shop.walletSpiritStones,
      revision: shop.revision,
    },
    pressure: { active: pressure.active, revision: pressure.revision },
    relationships: [...relationships.entries()]
      .filter(
        ([key]) =>
          key.startsWith(`${actor.actorId}\u0000`) || key.endsWith(`\u0000${actor.actorId}`),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  });
}

function auditIntegrity(
  actors: ActorState[],
  resource: ResourceState,
  shop: ShopState,
  integrity: PurposeBoundLifeSoakIntegrity,
) {
  const values = [
    resource.stock,
    resource.reserved,
    shop.herbStock,
    shop.walletSpiritStones,
    shop.reservedCapacity,
    shop.reservedWallet,
    ...actors.flatMap((actor) => Object.values(actor.inventory)),
  ];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    integrity.negativeInventory += 1;
  }
  if (actors.some((actor) => actor.activeGoal && actor.activeGoal.actorId !== actor.actorId)) {
    integrity.multipleActiveGoals += 1;
  }
  if (
    actors.some(
      (actor) => (actor.activeGoal?.backlog.length ?? 0) > PERSONAL_GOAL_BACKLOG_LIMIT,
    )
  ) {
    integrity.multipleActiveGoals += 1;
  }
}

function checkpoint(
  tick: number,
  actions: number,
  settlements: number,
  actors: ActorState[],
  trajectory: StableDigest,
): PurposeBoundLifeSoakCheckpoint {
  return {
    tick,
    actions,
    settlements,
    activeExecutions: actors.filter((actor) => actor.pending).length,
    activeGoals: actors.filter((actor) => actor.activeGoal).length,
    intentionalIdle: actors.reduce((sum, actor) => sum + actor.intentionalIdle, 0),
    trajectoryDigest: trajectory.digest(),
  };
}

function nextScheduledActors(actors: ActorState[], cursor: number) {
  const selected: ActorState[] = [];
  for (let offset = 0; offset < PURPOSE_BOUND_LIFE_SOAK_ACTORS_PER_TICK; offset += 1) {
    selected.push(actors[(cursor + offset) % actors.length]);
  }
  return {
    actors: selected,
    nextCursor: (cursor + PURPOSE_BOUND_LIFE_SOAK_ACTORS_PER_TICK) % actors.length,
  };
}

function resourceTotals(actors: ActorState[], resource: ResourceState, shop: ShopState) {
  return {
    herbs:
      resource.stock +
      shop.herbStock +
      actors.reduce((sum, actor) => sum + quantity(actor.inventory, 'spirit_herb'), 0),
    stones:
      shop.walletSpiritStones +
      actors.reduce((sum, actor) => sum + quantity(actor.inventory, 'spirit_stone'), 0),
    healingPills: actors.reduce(
      (sum, actor) => sum + quantity(actor.inventory, 'healing_pill'),
      0,
    ),
  };
}

function resourceRevision(resource: ResourceState) {
  return `resource:rev:${resource.revision}:available:${Math.max(0, resource.stock - resource.reserved)}`;
}

function shopSourceRevision(shop: ShopState) {
  return `shop:rev:${shop.revision}:price:${shop.unitPrice}:wallet:${shop.walletSpiritStones - shop.reservedWallet}`;
}

function isMandatorySurvival(proposal: AgentProposal, actor: ActorState) {
  return proposal.type === 'use_item' && actor.health <= actor.maxHealth / 2;
}

function isSocialCandidate(candidate: PiNpcEligibleCandidateView) {
  return [
    'talk',
    'gift',
    'request_teaching',
    'invite_social',
    'respond_social_invitation',
    'group_talk',
    'group_decide',
  ].includes(candidate.intentKind);
}

function actionDurationTicks(actionType: ActionType) {
  switch (actionType) {
    case 'travel':
      return 3;
    case 'rest':
      return 3;
    case 'gather':
    case 'cultivate':
      return 2;
    default:
      return 1;
  }
}

function locationById(locationId: string) {
  const location = LOCATIONS.find((entry) => entry.locationId === locationId);
  if (!location) throw new Error(`purpose_bound_life_location_missing:${locationId}`);
  return location;
}

function phaseForTick(tick: number): 'dawn' | 'day' | 'dusk' | 'night' {
  const hour = gameHourForTick(tick) % 24;
  if (hour < 6) return 'night';
  if (hour < 9) return 'dawn';
  if (hour < 18) return 'day';
  if (hour < 21) return 'dusk';
  return 'night';
}

function gameHourForTick(tick: number) {
  return tick * PURPOSE_BOUND_LIFE_SOAK_GAME_HOURS_PER_TICK;
}

function deterministicNow(tick: number) {
  return gameHourForTick(tick) * 60 * 60 * 1_000;
}

function proposalTarget(proposal: AgentProposal) {
  return (
    proposal.targetId ??
    proposal.targetActorId ??
    stringParam(proposal.params, 'requestId') ??
    stringParam(proposal.params, 'resourceNodeId') ??
    proposal.locationId ??
    'none'
  );
}

function inventoryRows(inventory: Inventory) {
  return Object.entries(inventory)
    .filter(([, qty]) => qty > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, qty]) => ({ itemId, qty }));
}

function quantity(inventory: Inventory, itemId: string) {
  return inventory[itemId] ?? 0;
}

function addQuantity(inventory: Inventory, itemId: string, quantityToAdd: number) {
  inventory[itemId] = quantity(inventory, itemId) + quantityToAdd;
}

function removeQuantity(inventory: Inventory, itemId: string, quantityToRemove: number) {
  if (quantity(inventory, itemId) < quantityToRemove) return false;
  inventory[itemId] = quantity(inventory, itemId) - quantityToRemove;
  return true;
}

function stringParam(params: Record<string, unknown> | undefined, key: string) {
  const value = params?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function edgeKey(fromActorId: string, toActorId: string) {
  return `${fromActorId}\u0000${toActorId}`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyCoverage(): PurposeBoundLifeScenarioCoverage {
  return {
    cultivationCompleted: 0,
    recoveryCompleted: 0,
    herbsGathered: 0,
    herbsSold: 0,
    requestsAccepted: 0,
    requestsCompleted: 0,
    resourceDepletionsObserved: 0,
    resourceContentionsAvoided: 0,
    quoteInvalidationsObserved: 0,
    midRouteInvalidationsObserved: 0,
    emergencyPreemptions: 0,
    intentionalIdleObserved: 0,
  };
}

function emptySocialProjectionCoverage(): PurposeBoundLifeSocialProjectionCoverage {
  return {
    sameLocationSourceKinds: {
      care_or_aid: 0,
      active_obligation: 0,
      knowledge_gap: 0,
      gratitude_or_repair: 0,
      relationship_maintenance: 0,
    },
    remoteInvitationOpportunities: 0,
    groupOpportunityKinds: {
      shared_request: 0,
      shared_event: 0,
      resource_dispute: 0,
      duty_meeting: 0,
    },
    decisionHookSocialCandidateObservations: 0,
  };
}

function emptyIntegrity(): PurposeBoundLifeSoakIntegrity {
  return {
    duplicateActions: 0,
    duplicateEvents: 0,
    duplicateSettlements: 0,
    negativeInventory: 0,
    resourceLedgerMismatch: 0,
    multipleActiveGoals: 0,
    incapacitatedActions: 0,
    successfulActionGoalFailures: 0,
    unexpectedIdle: 0,
    drainExceeded: 0,
    providerCalls: 0,
    modelFallbacks: 0,
    tokenBudgetOverruns: 0,
  };
}

class StableDigest {
  private left = 0x811c9dc5;
  private right = 0x9e3779b9;

  update(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      this.left = Math.imul(this.left ^ code, 0x01000193) >>> 0;
      this.right = Math.imul(this.right ^ code, 0x85ebca6b) >>> 0;
      this.right = (this.right ^ (this.right >>> 13)) >>> 0;
    }
    return this;
  }

  digest() {
    return `stable64:${this.left.toString(16).padStart(8, '0')}${this.right
      .toString(16)
      .padStart(8, '0')}`;
  }
}
