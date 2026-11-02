import type { AgentContext, AgentProposal, HumanDayPlan } from './agentLogic';
import { validatePurposeBoundLifeIntentV2 } from './purposeBoundLifeIntentContracts';
import { humanImpressionAdjustment } from './humanSocietyLogic';
import { purposeResourceOutlookForProposal } from './purposeResourceOutlookLogic';
import { seededRoll } from './rules';

// 拟人生活 v1：让 NPC 像人一样过一天。全部是纯函数，只在 context.humanLifeV1 时生效。
//   作息：到点就回家睡，夜里不做不急的事。
//   吃一堑长一智：在一个地方扑空后，隔一阵再去，连着扑空就隔得更久。
//   一天一个样：每天早上定下今天的心思，顺着它的事更愿意做。

export const DEFAULT_BEDTIME_HOUR = 22;
export const DEFAULT_WAKE_HOUR = 6;
export const FAILURE_BACKOFF_BASE_HOURS = 6;
export const FAILURE_BACKOFF_MAX_HOURS = 96;
export const DAY_FOCUS_BOOST = 12;
export const IDLE_DAY_CULTIVATION_PENALTY = 15;
export const RECENT_FAILURE_WHY_NOW_CODE = 'resource_recently_failed' as const;
// 到点睡下时，手上没做完的事放下，明早再说：记为取消，不记失败。
export const HUMAN_BEDTIME_SET_ASIDE_REASON_CODE = 'human_bedtime_set_aside' as const;
// 熟人（好感 ≥ 15）隔两天没说话就会想着聊几句；原规则是好友（≥ 25）隔七天。
export const HUMAN_MAINTENANCE_MIN_RELATIONSHIP = 15;
export const HUMAN_MAINTENANCE_DEBT_DAYS = 2;
// 好友：好感到了 40，见面时手头有余就会送点东西；同一对人之间（不论谁送谁）
// 主动送礼至少隔三天。送礼和聊天同等要紧（原规则下送礼的需求分比聊天低 10）。
export const HUMAN_CLOSE_FRIEND_RELATIONSHIP = 40;
export const HUMAN_GIFT_PAIR_COOLDOWN_DAYS = 3;
export const HUMAN_GIFT_NEED_LIFT = 10;
// 一个人主动送礼至少隔四天；还人情不受这个限制。
export const HUMAN_GIFT_ACTOR_COOLDOWN_DAYS = 4;
// 出去走走：身上有些乏（≥ 20）时去人多的地方歇歇脚。
export const LEISURE_NEED_SCORE = 35;
export const LEISURE_MIN_FATIGUE = 20;

export function humanLifeEnabled(context: AgentContext) {
  return context.humanLifeV1 === true && Number.isFinite(context.currentGameHour);
}

function hourOfDay(gameHour: number) {
  return ((gameHour % 24) + 24) % 24;
}

function sleepWindow(context: AgentContext) {
  return {
    bedtime: hourOfDay(context.humanDay?.bedtimeHour ?? DEFAULT_BEDTIME_HOUR),
    wake: hourOfDay(context.humanDay?.wakeHour ?? DEFAULT_WAKE_HOUR),
  };
}

// 此刻是否该睡。bedtime 晚于 wake 时窗口跨午夜（例如 22 → 6）。
export function isHumanSleepTime(context: AgentContext) {
  if (!humanLifeEnabled(context)) return false;
  const hour = hourOfDay(context.currentGameHour!);
  const { bedtime, wake } = sleepWindow(context);
  if (bedtime === wake) return false;
  return bedtime > wake ? hour >= bedtime || hour < wake : hour >= bedtime && hour < wake;
}

// 下一次醒来的游戏小时（绝对值）。
export function nextHumanWakeGameHour(context: AgentContext) {
  const now = context.currentGameHour ?? 0;
  const { wake } = sleepWindow(context);
  const today = Math.floor(now / 24) * 24;
  const candidate = today + wake;
  return candidate > now ? candidate : candidate + 24;
}

// 下一次该睡下的游戏小时（绝对值）：清醒时的闲坐最多坐到这一刻。
export function nextHumanBedtimeGameHour(context: AgentContext) {
  const now = context.currentGameHour ?? 0;
  const { bedtime } = sleepWindow(context);
  const today = Math.floor(now / 24) * 24;
  const candidate = today + bedtime;
  return candidate > now ? candidate : candidate + 24;
}

// 每个人固定的作息：21–23 点睡、5–7 点起。只取决于这个人，不随世界种子变。
export function humanChronotype(actorId: string): Pick<HumanDayPlan, 'bedtimeHour' | 'wakeHour'> {
  const bed = seededRoll(`human_chronotype:${actorId}:bed`);
  const wake = seededRoll(`human_chronotype:${actorId}:wake`);
  return {
    bedtimeHour: 21 + Math.round(bed * 8) / 4,
    wakeHour: 5 + Math.round(wake * 8) / 4,
  };
}

// 今天把心思放在哪儿：按性格加权，再按"这个人 + 这一天"掷一次。
export function humanDayFocus(input: {
  seedKey: string;
  role: string;
  innerTrait?: string;
  outerTrait?: string;
}): NonNullable<HumanDayPlan['focus']> {
  const traits = new Set([input.innerTrait, input.outerTrait].filter(Boolean));
  // 守卫、掌柜的"谋生"就是当值：大半日子当值，其余是轮休。
  const weights = hasDutyPost(input.role)
    ? { cultivation: 2, livelihood: 5, social: 1, idle: 1 }
    : { cultivation: 4, livelihood: 2, social: 2, idle: 1 };
  if (traits.has('孤僻')) weights.social = 0.4;
  for (const warm of ['义气', '仁善', '无私', '天伦', '爱家', '情种']) {
    if (traits.has(warm)) weights.social += 1.5;
  }
  for (const gain of ['利己', '名声']) {
    if (traits.has(gain)) weights.livelihood += 1.5;
  }
  for (const driven of ['权力', '正直', '中庸']) {
    if (traits.has(driven)) weights.cultivation += 1;
  }
  for (const loose of ['任我', '狂邪']) {
    if (traits.has(loose)) weights.idle += 1;
  }
  const entries = Object.entries(weights) as Array<[keyof typeof weights, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = seededRoll(input.seedKey) * total;
  for (const [focus, weight] of entries) {
    roll -= weight;
    if (roll < 0) return focus;
  }
  return 'cultivation';
}

// 有固定岗位的人：守卫守丹房，掌柜守坊市。
export function hasDutyPost(role: string) {
  return role === 'guard' || role === 'merchant';
}

// 今天是不是当值的日子。没有岗位的人不分当值、轮休。
export function isHumanDutyDay(context: AgentContext) {
  return (
    humanLifeEnabled(context) &&
    hasDutyPost(context.self.role) &&
    context.humanDay?.focus === 'livelihood'
  );
}

export function isHumanDayOff(context: AgentContext) {
  return humanLifeEnabled(context) && hasDutyPost(context.self.role) && !isHumanDutyDay(context);
}

// 连着扑空几次，就隔多久再去：6、12、24、48 小时，最多 96 小时。
export function recentFailureBackoffHours(consecutiveFailures: number) {
  const count = Math.max(1, Math.floor(consecutiveFailures));
  return Math.min(FAILURE_BACKOFF_MAX_HOURS, FAILURE_BACKOFF_BASE_HOURS * 2 ** (count - 1));
}

// 是不是一趟"上次刚扑空、还没到该再去的时候"的采药。人已经在那儿、亲眼看得见就不算。
export function isRecentlyFailedTrip(context: AgentContext, proposal: AgentProposal | undefined) {
  if (!humanLifeEnabled(context)) return false;
  const outlook = purposeResourceOutlookForProposal(context, proposal);
  const last = outlook?.lastOutcome;
  if (!outlook || !last || last.status !== 'failed') return false;
  if (outlook.etaGameHours <= 0) return false;
  const activeSourceRef =
    context.personalGoal?.purposeIntent?.sourceRef ?? context.personalGoal?.sourceRef;
  const purpose = validatePurposeBoundLifeIntentV2(proposal?.params?.purposeBoundIntent);
  if (purpose.ok && activeSourceRef === purpose.intent.sourceRef) return false;
  // 答应了别人的事会多跑几趟：替委托采药时，间隔减半。
  const backoff = recentFailureBackoffHours(last.consecutiveFailures ?? 1);
  const obligation = purpose.ok && purpose.intent.purposeKind === 'obligation';
  return last.hoursAgo < (obligation ? backoff / 2 : backoff);
}

function purposeActivity(proposal: AgentProposal) {
  const purpose = validatePurposeBoundLifeIntentV2(proposal.params?.purposeBoundIntent);
  return purpose.ok ? purpose.intent.intendedActivity : proposal.type;
}

// 今天的心思对一条候选需求分的加减。
export function humanDayFocusAdjustment(
  context: AgentContext,
  proposal: AgentProposal | undefined,
  planner?: string,
) {
  if (!humanLifeEnabled(context) || !proposal) return 0;
  const focus = context.humanDay?.focus;
  if (!focus) return 0;
  if (planner === 'leisure') return focus === 'social' || focus === 'idle' ? DAY_FOCUS_BOOST : 0;
  const activity = purposeActivity(proposal);
  if (focus === 'cultivation' && activity === 'cultivate') return DAY_FOCUS_BOOST;
  if (focus === 'livelihood' && (activity === 'gather' || activity === 'trade')) return DAY_FOCUS_BOOST;
  if (
    focus === 'social' &&
    (activity === 'talk' || activity === 'gift' || activity === 'request_teaching')
  ) {
    return DAY_FOCUS_BOOST;
  }
  if (focus === 'idle' && activity === 'cultivate') return -IDLE_DAY_CULTIVATION_PENALTY;
  return 0;
}

const WARM_TRAITS = new Set(['义气', '仁善', '无私', '天伦', '爱家', '情种']);

// 两个人聊一次，彼此近了多少：脾性相同、都是热心肠就更投缘；一个利己一个不利己、
// 有人孤僻就难投缘；另有一份只属于这两个人的"缘分"（-1、0、+1，与世界种子无关）。
// 结果在 -1 到 +3 之间：不投缘的人聊几次反而疏远。
export function chatAffinityGain(
  left: { actorId: string; innerTrait?: string; outerTrait?: string },
  right: { actorId: string; innerTrait?: string; outerTrait?: string },
) {
  let gain = 1;
  if (left.innerTrait && left.innerTrait === right.innerTrait) gain += 1;
  if (left.outerTrait && left.outerTrait === right.outerTrait) gain += 1;
  const warm = (actor: typeof left) =>
    WARM_TRAITS.has(actor.innerTrait ?? '') || WARM_TRAITS.has(actor.outerTrait ?? '');
  if (warm(left) && warm(right)) gain += 1;
  if ((left.innerTrait === '利己') !== (right.innerTrait === '利己')) gain -= 1;
  if (left.outerTrait === '孤僻' || right.outerTrait === '孤僻') gain -= 1;
  const pair = [left.actorId, right.actorId].sort().join('|');
  gain += Math.round(seededRoll(`human_chemistry:${pair}`) * 2 - 1);
  return Math.max(-1, Math.min(3, gain));
}

type DayFocus = NonNullable<HumanDayPlan['focus']>;

// 今天的心思决定多久修一次：修炼日照常（两小时一次，由原有节奏管），
// 谋生日三小时、交际日四小时、歇息日六小时一次。
export function humanCultivationSpacingHours(focus: DayFocus | undefined) {
  if (focus === 'livelihood') return 3;
  if (focus === 'social') return 4;
  if (focus === 'idle') return 6;
  return 0;
}

// 离上次修完还不到今天该隔的时辰。
export function isHumanCultivationRestDue(context: AgentContext) {
  if (!humanLifeEnabled(context)) return false;
  const spacing = humanCultivationSpacingHours(context.humanDay?.focus);
  if (spacing <= 0) return false;
  const last = (context.personalGoalCadences ?? [])
    .filter((window) => window.intendedActivity === 'cultivate' && window.terminalStatus === 'completed')
    .sort((left, right) => right.terminalGameHour - left.terminalGameHour)[0];
  if (!last) return false;
  return (context.currentGameHour ?? 0) - last.terminalGameHour < spacing;
}

// 隔几天没说话就想去找，看有多亲近：好友（≥ 40）隔一天，朋友（≥ 25）三天，
// 点头之交（≥ 15）六天。交际日各短一些、修炼日各长一些；今天惦记几个人也随心思：
// 修炼日一个，交际日三个，其余两个。
export type HumanMaintenanceTier = { minRelationship: number; debtDays: number };

export function humanMaintenancePlan(focus: DayFocus | undefined): {
  tiers: HumanMaintenanceTier[];
  minDebtDays: number;
  targets: number;
} {
  const days =
    focus === 'social' ? [1, 2, 4] : focus === 'cultivation' ? [2, 4, 8] : [1, 3, 6];
  const tiers = [
    { minRelationship: HUMAN_CLOSE_FRIEND_RELATIONSHIP, debtDays: days[0] },
    { minRelationship: 25, debtDays: days[1] },
    { minRelationship: HUMAN_MAINTENANCE_MIN_RELATIONSHIP, debtDays: days[2] },
  ];
  return {
    tiers,
    minDebtDays: Math.min(...tiers.map((tier) => tier.debtDays)),
    targets: focus === 'cultivation' ? 1 : focus === 'social' ? 3 : 2,
  };
}

export function humanMaintenanceDebtDays(focus: DayFocus | undefined, relationship: number) {
  const tier = humanMaintenancePlan(focus).tiers.find((entry) => relationship >= entry.minRelationship);
  return tier?.debtDays ?? Number.POSITIVE_INFINITY;
}

// 在场的人里，先想起最亲近的（觉得热心的加分，觉得爱惹事的减分）；一样亲近的，
// 先想起最久没说话的。
export function humanMaintenanceTargetIds(
  context: AgentContext,
  candidates: ReadonlyArray<{ targetActorId: string; debtDays: number }>,
) {
  const closeness = new Map(
    context.others.map((other) => [
      other.actorId,
      other.relationship + humanImpressionAdjustment(other.impression),
    ]),
  );
  const limit = humanMaintenancePlan(context.humanDay?.focus).targets;
  return new Set(
    [...candidates]
      .sort(
        (left, right) =>
          (closeness.get(right.targetActorId) ?? 0) - (closeness.get(left.targetActorId) ?? 0) ||
          right.debtDays - left.debtDays ||
          left.targetActorId.localeCompare(right.targetActorId),
      )
      .slice(0, limit)
      .map((candidate) => candidate.targetActorId),
  );
}

// 越亲近的人越想找：好感 20 不加不减，每多 4 点加 1 分，最多加 10、最少减 5；
// 送礼另加 10，与聊天同等要紧；觉得对方热心的更想找，觉得对方爱惹事的不想找。
export function humanSocialAdjustment(context: AgentContext, proposal: AgentProposal | undefined) {
  if (!humanLifeEnabled(context) || !proposal?.targetActorId) return 0;
  if (proposal.type !== 'talk' && proposal.type !== 'gift') return 0;
  const other = context.others.find((entry) => entry.actorId === proposal.targetActorId);
  const relationship = other?.relationship ?? 0;
  const closeness = Math.max(-5, Math.min(10, Math.round((relationship - 20) / 4)));
  return (
    closeness +
    (proposal.type === 'gift' ? HUMAN_GIFT_NEED_LIFT : 0) +
    humanImpressionAdjustment(other?.impression)
  );
}

// 留一株给人，不拿去卖：欠着别人的人情（收过礼还没回），或者离上次送礼已有些日子、
// 又有该送的好友时，就留一株。手上没有自己的灵草（收来的、答应了委托的不算）就不留。
export function humanGiftKeepQuantity(input: {
  ownGiftable: number;
  owesSomeone: boolean;
  hasCloseFriendDue: boolean;
  daysSinceOwnLastGift?: number;
}) {
  if (input.ownGiftable < 1) return 0;
  if (input.owesSomeone) return 1;
  const rested =
    input.daysSinceOwnLastGift === undefined ||
    input.daysSinceOwnLastGift >= HUMAN_GIFT_ACTOR_COOLDOWN_DAYS;
  return rested && input.hasCloseFriendDue ? 1 : 0;
}

// 答应了委托、还没交出去的份数。
export function humanPromisedQuantity(context: AgentContext, itemId: string) {
  return (context.activeRequests ?? [])
    .filter(
      (request) =>
        request.itemId === itemId &&
        (request.status === 'accepted' || request.status === 'ready_to_turn_in'),
    )
    .reduce((sum, request) => sum + (request.qty ?? 0), 0);
}

// 谋生时看的行囊：留着送人的、别人送的、答应了委托的那几份不算（不为它停采，也不拿它去卖）。
export function humanLivelihoodQuantity(context: AgentContext, itemId: string, held: number) {
  if (!humanLifeEnabled(context)) return held;
  const keep =
    itemId === 'spirit_herb'
      ? (context.humanDay?.keepForGift ?? 0) + (context.humanDay?.receivedGiftsKept ?? 0)
      : 0;
  return Math.max(0, held - keep - humanPromisedQuantity(context, itemId));
}

// 心境（0–10，平常是 5）：出门到歇脚处坐坐、收到礼物，心境好一点；每天醒来往平常回落一点。
// 心境已满，就不必为散心出门。
export const HUMAN_MOOD_BASELINE = 5;
export const HUMAN_MOOD_MAX = 10;

// 歇脚处：能歇能聊、又不是干活的地方（药圃要采药、山门要修炼、丹房有人守），也不是自己家。
export function isHumanLeisureSpot(
  location: { locationId: string; allowedActions: readonly string[] },
  homeLocationId: string | undefined,
) {
  return (
    location.locationId !== homeLocationId &&
    location.allowedActions.includes('rest') &&
    location.allowedActions.includes('talk') &&
    !location.allowedActions.includes('gather') &&
    !location.allowedActions.includes('cultivate') &&
    !location.allowedActions.includes('inspect')
  );
}

export function humanMoodAfterWaking(mood: number) {
  if (mood > HUMAN_MOOD_BASELINE) return mood - 1;
  if (mood < HUMAN_MOOD_BASELINE) return mood + 1;
  return mood;
}

export function humanMoodLifted(mood: number) {
  return Math.min(HUMAN_MOOD_MAX, mood + 1);
}
