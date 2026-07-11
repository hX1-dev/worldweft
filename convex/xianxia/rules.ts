import type { ActionResult, Effects, EventVisibility } from './actionSchema';
import { itemBaseValue } from './items';
import { quotePrice, type SellerView } from './priceLogic';
import { NEUTRAL_PHASE_MODS, type PhaseMods } from './timeLogic';

// 规则引擎的「纯逻辑层」（M2 起，M3 补齐 8 动作）。
// 关键约束：本文件不依赖 Convex（只 import type），输入是普通数据快照，输出是纯结果，
// 因此可被 Jest 直接单测；DB 读写留给 actions.ts。
// 依据：docs/xianxia-blueprint.md §8（8 动作）、§18（裁决原则）。

// actions.ts 从 DB 读出后传入的角色快照（只含规则需要的字段）。
export type ActorSnapshot = {
  actorId: string;
  name: string;
  realm: string;
  realmStage: number;
  cultivationXp: number;
  mood: number;
  health: number;
  spirit: number;
  reputation: number;
  currentLocationId?: string;
  inventory?: { itemId: string; qty: number }[];
};

// 地点快照。
export type LocationSnapshot = {
  locationId: string;
  name: string;
  kind: string;
  dangerLevel: number;
  spiritualEnergy: number;
  allowedActions: string[];
};

// —— 通用工具 ——

// 由种子串得到 [0,1) 的确定性掷点（FNV-1a 哈希）。可记录、可复现（§18.3）。
export function seededRoll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// 把数值夹到区间内（effects 落库前用）。
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// 境界由低到高的次序；realmRank 越大境界越高。
const REALM_ORDER = [
  'qi_refining',
  'foundation_building',
  'golden_core',
  'nascent_soul',
  'deity_transformation',
];
export function realmRank(realm: string): number {
  const i = REALM_ORDER.indexOf(realm);
  return i < 0 ? 0 : i;
}

const REALM_NAME: Record<string, string> = {
  qi_refining: '练气',
  foundation_building: '筑基',
  golden_core: '金丹',
  nascent_soul: '元婴',
  deity_transformation: '化神',
};
const REALM_MAX_STAGE: Record<string, number> = {
  qi_refining: 9,
  foundation_building: 3,
  golden_core: 3,
  nascent_soul: 3,
  deity_transformation: 3,
};
export function realmMaxStage(realm: string): number {
  return REALM_MAX_STAGE[realm] ?? 9;
}
export function realmDisplayName(realm: string): string {
  return REALM_NAME[realm] ?? realm;
}
function nextRealm(realm: string): string {
  return REALM_ORDER[realmRank(realm) + 1] ?? realm;
}

// 从当前（境界,层）突破所需的累积修为。境界越高、层数越高，所需越多。
// 供 UI 显示「还需多少修为」，也供 Agent 判断是否到了可突破的火候。
export function breakthroughThreshold(realm: string, stage: number): number {
  return (realmRank(realm) + 1) * (40 + stage * 15);
}

// 综合战力（切磋用）：境界为主，层数、心境、气血为辅。
function combatPower(a: ActorSnapshot): number {
  return realmRank(a.realm) * 100 + a.realmStage * 10 + a.mood + a.health;
}

function hasItem(a: ActorSnapshot, itemId: string, qty = 1): boolean {
  const entry = a.inventory?.find((i) => i.itemId === itemId);
  return !!entry && entry.qty >= qty;
}

// —— 8 个动作的纯规则 ——

export type CultivateInput = {
  actor: ActorSnapshot;
  location: LocationSnapshot;
  roll: number;
  phaseMods?: PhaseMods; // 昼夜修正（W3a）：清晨修炼小幅加成
};
const CULTIVATE_BASE_XP = 5;
const MOOD_FLOOR = -3;

// 修炼（§8.1）：成功增修为；地点不允许或心境过低则拒绝；极小概率顿悟/走火入魔。
export function resolveCultivate(input: CultivateInput): ActionResult {
  const { actor, location, roll } = input;
  const mods = input.phaseMods ?? NEUTRAL_PHASE_MODS;
  if (!location.allowedActions.includes('cultivate')) {
    return reject('location_forbids_cultivate', `${location.name}不容在此处吐纳修炼。`);
  }
  if (actor.mood <= MOOD_FLOOR) {
    return reject('mood_too_low', `${actor.name}心境不宁，难以静心修炼。`);
  }
  const baseGain =
    CULTIVATE_BASE_XP + location.spiritualEnergy + Math.floor(roll * 4) + mods.cultivationXpBonus;
  if (roll >= 0.95) {
    return applied(
      'cultivation_breakthrough_insight',
      `${actor.name}于${location.name}静修，忽有顿悟，修为大进。`,
      { cultivationXp: baseGain * 2, mood: 2 },
      'cultivation_completed',
    );
  }
  if (roll < 0.05) {
    return applied(
      'cultivation_deviation',
      `${actor.name}修炼时灵气紊乱，险些走火入魔，所获甚微。`,
      { cultivationXp: 1, mood: -2, health: -1 },
      'cultivation_completed',
    );
  }
  return applied(
    'cultivation_success',
    `${actor.name}在${location.name}吐纳行功，修为稳步精进。`,
    { cultivationXp: baseGain, mood: 1 },
    'cultivation_completed',
  );
}

export type BreakthroughInput = {
  actor: ActorSnapshot;
  location: LocationSnapshot;
  roll: number; // 决定是否突破成功
  mishapRoll: number; // 失败时决定是否走火入魔
};

// 突破：修为累积的「兑现」。攒够阈值方可尝试。
// - 境内升层（如练气 1→9）：水到渠成、一路直达，攒够即成，无风险。
// - 跨境大关（如练气满 9→筑基）：才是真正的坎，有失败、掉修为、伤气血、走火入魔之险；
//   心境与地点灵气提升成功率，境界越高越难。
export function resolveBreakthrough(input: BreakthroughInput): ActionResult {
  const { actor, location, roll, mishapRoll } = input;
  const threshold = breakthroughThreshold(actor.realm, actor.realmStage);
  if (actor.cultivationXp < threshold) {
    return reject('insufficient_cultivation', `${actor.name}修为未足（需 ${threshold}），强行冲关只是徒劳。`);
  }
  const overflow = actor.cultivationXp - threshold;
  const isRealmGate = actor.realmStage >= realmMaxStage(actor.realm);

  // —— 境内升层：一路直达，攒够即成 ——
  if (!isRealmGate) {
    return applied(
      'breakthrough_success',
      `${actor.name}水到渠成，修为精进，晋入${REALM_NAME[actor.realm] ?? actor.realm} ${actor.realmStage + 1} 层。`,
      { realmChange: { realm: actor.realm, realmStage: actor.realmStage + 1, cultivationXp: overflow }, mood: 1 },
      'breakthrough_resolved',
    );
  }

  // —— 跨境大关：才有风险 ——
  const successChance = clamp(
    0.5 + actor.mood * 0.04 + location.spiritualEnergy * 0.03 - realmRank(actor.realm) * 0.05,
    0.1,
    0.85,
  );
  if (roll < successChance) {
    const realm = nextRealm(actor.realm);
    return applied(
      'breakthrough_success',
      `${actor.name}历经险关，灵光迸现，一举突破至${REALM_NAME[realm] ?? realm}！`,
      { realmChange: { realm, realmStage: 1, cultivationXp: overflow }, mood: 2 },
      'breakthrough_resolved',
      'public',
    );
  }
  if (mishapRoll < 0.3) {
    return applied(
      'breakthrough_deviation',
      `${actor.name}冲关失败，灵气逆冲走火入魔，伤势不轻。`,
      { cultivationXp: -Math.floor(threshold * 0.3), mood: -3, health: -3 },
      'breakthrough_resolved',
    );
  }
  return applied(
    'breakthrough_failed',
    `${actor.name}冲关未成，气血翻涌，只得暂且作罢。`,
    { cultivationXp: -Math.floor(threshold * 0.15), mood: -2, health: -1 },
    'breakthrough_resolved',
  );
}

// topic = 这次开口的缘由（来自需求驱动的 intent，如「回报委托进展」「与相熟之人叙谈」）。
export type TalkInput = {
  actor: ActorSnapshot;
  target: ActorSnapshot;
  relationship: number;
  roll: number;
  topic?: string;
};

// 交谈（§8.2）：关系过差则拒绝；否则小幅升温。W4b-G：summary 据 topic/关系生成更具体的内容
//（模板，无 LLM），不再是空泛套话——对话是需求的副产物，事件里要看得出「为何而谈」。
export function resolveTalk(input: TalkInput): ActionResult {
  const { actor, target, relationship, roll, topic } = input;
  if (relationship <= -50) {
    return reject('relationship_too_hostile', `${target.name}对${actor.name}心存敌意，不愿交谈。`);
  }
  const warmed = roll >= 0.2; // 偶尔冷场
  const about = topic ? `就「${topic}」` : '';
  const tone = !warmed
    ? '只寒暄两句，气氛淡淡'
    : relationship >= 25
      ? '相谈甚欢，情谊更笃'
      : '相谈尚欢';
  return applied(
    'conversation_started',
    `${actor.name}${about}与${target.name}叙谈，${tone}。`,
    { mood: warmed ? 1 : 0, relationships: warmed ? [{ targetActorId: target.actorId, delta: 2 }] : [] },
    'conversation_started',
  );
}

export type SparInput = { actor: ActorSnapshot; target: ActorSnapshot; relationship: number; roll: number };

// 切磋（§8.6）：境界差距过大则拒绝；按战力+掷点判胜负，影响声望与关系。
export function resolveSpar(input: SparInput): ActionResult {
  const { actor, target, roll } = input;
  if (Math.abs(realmRank(actor.realm) - realmRank(target.realm)) >= 2) {
    return reject('realm_gap_too_large', `${actor.name}与${target.name}境界相差悬殊，难以切磋。`);
  }
  const actorScore = combatPower(actor) + Math.floor(roll * 50);
  const targetScore = combatPower(target) + Math.floor((1 - roll) * 50);
  const diff = actorScore - targetScore;
  if (Math.abs(diff) <= 5) {
    return applied(
      'spar_draw',
      `${actor.name}与${target.name}点到为止，难分高下。`,
      { mood: 1, reputation: 1, relationships: [{ targetActorId: target.actorId, delta: 3 }] },
      'spar_resolved',
      'public',
    );
  }
  if (diff > 0) {
    return applied(
      'spar_actor_win',
      `${actor.name}在切磋中胜过${target.name}，赢得喝彩。`,
      { reputation: 3, mood: 1, relationships: [{ targetActorId: target.actorId, delta: 2 }] },
      'spar_resolved',
      'public',
    );
  }
  return applied(
    'spar_actor_lose',
    `${actor.name}不敌${target.name}，略受轻伤，却也心服。`,
    { reputation: -1, mood: -1, health: -1, relationships: [{ targetActorId: target.actorId, delta: 2 }] },
    'spar_resolved',
    'public',
  );
}

export type ExploreInput = {
  actor: ActorSnapshot;
  location: LocationSnapshot;
  roll: number;
  phaseMods?: PhaseMods; // 昼夜修正（W3a）：夜探更险
};

// 探索（§8.7）：地点须允许；按事件表抽取机缘/传闻/无事/危险。
export function resolveExplore(input: ExploreInput): ActionResult {
  const { actor, location, roll } = input;
  const mods = input.phaseMods ?? NEUTRAL_PHASE_MODS;
  if (!location.allowedActions.includes('explore')) {
    return reject('location_forbids_explore', `${location.name}无可探索之处。`);
  }
  // 夜晚抬高遇险概率（exploreRiskBonus 扩大危险区间）。
  if (roll < 0.1 + mods.exploreRiskBonus) {
    return applied(
      'exploration_danger',
      `${actor.name}在${location.name}遭遇凶险，受了些伤。`,
      { health: -2, mood: -1 },
      'exploration_resolved',
    );
  }
  if (roll < 0.5) {
    return applied(
      'exploration_nothing',
      `${actor.name}在${location.name}探查一番，无甚收获。`,
      {},
      'exploration_resolved',
      'private',
    );
  }
  if (roll < 0.8) {
    return applied(
      'exploration_rumor',
      `${actor.name}在${location.name}打探到一则传闻。`,
      { mood: 1 },
      'exploration_resolved',
    );
  }
  return applied(
    'exploration_resource',
    `${actor.name}在${location.name}寻得一份机缘，收获灵药。`,
    {
      cultivationXp: 5 + location.spiritualEnergy,
      mood: 1,
      items: [{ to: actor.actorId, itemId: 'spirit_herb', qty: 1 }],
    },
    'exploration_resolved',
  );
}

export type TeachingInput = { actor: ActorSnapshot; master: ActorSnapshot; relationship: number; roll: number };

// 求教（§8.5）：师长境界须更高、须有交情、声望不可太差；偶被婉拒。
export function resolveRequestTeaching(input: TeachingInput): ActionResult {
  const { actor, master, relationship, roll } = input;
  if (realmRank(master.realm) <= realmRank(actor.realm)) {
    return reject('master_not_qualified', `${master.name}境界未必高过${actor.name}，无从指点。`);
  }
  if (relationship < 0) {
    return reject('relationship_insufficient', `${master.name}与${actor.name}素无交情，不愿指点。`);
  }
  if (actor.reputation <= -50) {
    return reject('reputation_too_low', `${actor.name}声名狼藉，${master.name}不愿沾染。`);
  }
  if (roll < 0.25) {
    return applied(
      'teaching_refused',
      `${master.name}此刻无暇，婉拒了${actor.name}的求教。`,
      { mood: -1 },
      'teaching_resolved',
    );
  }
  const gain = 8 + realmRank(master.realm) * 2;
  return applied(
    'teaching_granted',
    `${master.name}为${actor.name}指点迷津，使其修为精进。`,
    { cultivationXp: gain, mood: 1, relationships: [{ targetActorId: master.actorId, delta: 5 }] },
    'teaching_resolved',
  );
}

export type GiftInput = {
  actor: ActorSnapshot;
  target: ActorSnapshot;
  itemId: string;
  relationship: number;
  roll: number;
};

// 赠礼（§8.4）：须拥有该物；敌对者可能拒收；接受则关系提升并转移物品。
export function resolveGift(input: GiftInput): ActionResult {
  const { actor, target, itemId, relationship, roll } = input;
  if (!hasItem(actor, itemId)) {
    return reject('item_not_owned', `${actor.name}并无「${itemId}」，无以为赠。`);
  }
  if (relationship <= -60 && roll < 0.5) {
    return applied(
      'gift_rejected',
      `${target.name}冷淡地回绝了${actor.name}的赠礼。`,
      {},
      'gift_given',
    );
  }
  return applied(
    'gift_accepted',
    `${actor.name}将「${itemId}」赠予${target.name}，${target.name}记下了这份情谊。`,
    {
      // 关系变化方向由 relationshipEffectFor(gift_accepted) 处理：受礼者→送礼者 好感/信任/恩情↑。
      // 此处不再写「送礼者→受礼者」的好感（方向不自然，W4b-E 去除）。
      items: [{ from: actor.actorId, to: target.actorId, itemId, qty: 1 }],
    },
    'gift_given',
  );
}

export type TradeInput = {
  actor: ActorSnapshot;
  target: ActorSnapshot;
  offeredItemId: string;
  offeredQty?: number; // 默认 1
  requestedItemId: string;
  requestedQty?: number; // 默认 1
  sellerView: SellerView; // 卖家(target)如何看买家(actor)，用于报价（M4）
};

// 交易（§8.3 / §9）：按 M4 价格系统报价。
//   - 灵石购买：系统按报价收灵石，须够付。
//   - 以物易物：所出之物价值须 ≥ 报价。
// 「不愿做这笔买卖」（信任极差/怀疑过高）已由 M3 拒绝系统在 resolver 前拦下，此处只管价值。
export function resolveTrade(input: TradeInput): ActionResult {
  const { actor, target, offeredItemId, requestedItemId, sellerView } = input;
  const offeredQty = positiveQty(input.offeredQty);
  const requestedQty = positiveQty(input.requestedQty);
  if (!hasItem(actor, offeredItemId, offeredQty)) {
    return reject('actor_lacks_item', `${actor.name}并无足够的「${offeredItemId}」可供交易。`);
  }
  if (!hasItem(target, requestedItemId, requestedQty)) {
    return reject('merchant_lacks_item', `${target.name}并无足够的「${requestedItemId}」。`);
  }

  const unitPrice = quotePrice(itemBaseValue(requestedItemId), sellerView).finalPrice;
  const price = unitPrice * requestedQty;
  const requestedLabel =
    requestedQty === 1 ? `「${requestedItemId}」` : `${requestedQty}件「${requestedItemId}」`;

  if (offeredItemId === 'spirit_stone') {
    if (!hasItem(actor, 'spirit_stone', price)) {
      return reject('insufficient_funds', `${actor.name}灵石不足，买不起${requestedLabel}（需 ${price} 枚）。`);
    }
    return applied(
      'trade_completed',
      `${actor.name}以 ${price} 枚灵石购得${requestedLabel}。`,
      {
        items: [
          { from: actor.actorId, to: target.actorId, itemId: 'spirit_stone', qty: price },
          { from: target.actorId, to: actor.actorId, itemId: requestedItemId, qty: requestedQty },
        ],
      },
      'trade_completed',
    );
  }

  const offeredValue = itemBaseValue(offeredItemId) * offeredQty;
  if (offeredValue < price) {
    return applied(
      'trade_refused',
      `${target.name}嫌${actor.name}出价太低（${requestedLabel}约值 ${price} 灵石）。`,
      {},
      'trade_completed',
    );
  }
  return applied(
    'trade_completed',
    `${actor.name}以「${offeredItemId}」换得${requestedLabel}。`,
    {
      items: [
        { from: actor.actorId, to: target.actorId, itemId: offeredItemId, qty: offeredQty },
        { from: target.actorId, to: actor.actorId, itemId: requestedItemId, qty: requestedQty },
      ],
    },
    'trade_completed',
  );
}

function positiveQty(value: number | undefined) {
  return Math.max(1, Math.min(99, Math.floor(Number.isFinite(value) ? value! : 1)));
}

export type StealInput = {
  actor: ActorSnapshot;
  target: ActorSnapshot;
  location: LocationSnapshot;
  itemId: string;
  roll: number; // 决定是否得手
  detectionRoll: number; // 决定是否被发现
  phaseMods?: PhaseMods; // 昼夜修正（W3a）：夜色更隐蔽，但被抓更重
};

// 偷取（§8.8）：高风险。成功率 = 基础 + 行动者敏锐 − 目标感知 − 地点守卫。
// 第一阶段用规则裁决；M6 起 steal 会改走弱 GM 提供社会后果建议。
export function resolveSteal(input: StealInput): ActionResult {
  const { actor, target, location, itemId, roll, detectionRoll } = input;
  const mods = input.phaseMods ?? NEUTRAL_PHASE_MODS;
  if (!hasItem(target, itemId)) {
    return reject('target_lacks_item', `${target.name}身上并无「${itemId}」，无从偷取。`);
  }
  const successChance = clamp(
    0.4 + (actor.spirit - target.spirit) * 0.05 - location.dangerLevel * 0.1,
    0.05,
    0.9,
  );
  const success = roll < successChance;
  // 夜色掩护：降低被发现的门槛。
  const detected = detectionRoll < 0.5 - mods.stealStealthBonus;
  const outcome: StealOutcome =
    success && !detected
      ? 'success_undetected'
      : success && detected
        ? 'success_suspected'
        : !success && !detected
          ? 'failed_undetected'
          : 'failed_detected';
  return buildStealResult({
    outcome,
    actorActorId: actor.actorId,
    targetActorId: target.actorId,
    actorName: actor.name,
    targetName: target.name,
    itemId,
    penaltyMult: mods.stealPenaltyMult,
  });
}

// 偷窃的四种结局；确定性规则与弱 GM 裁决复用同一构造器（M6）。
export type StealOutcome =
  | 'success_undetected'
  | 'success_suspected'
  | 'failed_undetected'
  | 'failed_detected';

// 由结局码构造 steal 结果。reason/deltas 可被 GM 覆盖（默认走确定性数值）。
export function buildStealResult(a: {
  outcome: StealOutcome;
  actorActorId: string;
  targetActorId: string;
  actorName: string;
  targetName: string;
  itemId: string;
  reason?: string;
  reputationDelta?: number;
  // 偷窃对受害者关系的影响方向/幅度，统一由 relationshipEffectFor(steal_*) 给出（W4b-E）。
  penaltyMult?: number; // 昼夜惩罚倍率（W3a，仅作用于确定性默认值；GM 提供的 delta 不缩放）
}): ActionResult {
  const transfer = { from: a.targetActorId, to: a.actorActorId, itemId: a.itemId, qty: 1 };
  const mult = a.penaltyMult ?? 1;
  const rep = (def: number) => Math.round((a.reputationDelta ?? def) * (a.reputationDelta === undefined ? mult : 1));
  switch (a.outcome) {
    case 'success_undetected':
      return applied(
        'steal_success_undetected',
        a.reason ?? `${a.actorName}神不知鬼不觉地取走了${a.targetName}的「${a.itemId}」。`,
        { items: [transfer] },
        'steal_resolved',
        'private',
      );
    case 'success_suspected':
      return applied(
        'steal_success_suspected',
        a.reason ?? `${a.actorName}得手「${a.itemId}」，却被${a.targetName}察觉了几分异样。`,
        {
          // 关系方向由 relationshipEffectFor(steal_success_suspected) 处理：受害者→小偷 怀疑↑/信任↓。
          // 此处不再写「小偷→受害者」的好感（方向不自然，W4b-E 去除）。
          items: [transfer],
          reputation: rep(-3),
        },
        'steal_resolved',
        'witnessed',
      );
    case 'failed_undetected':
      return applied(
        'steal_failed_undetected',
        a.reason ?? `${a.actorName}伸手不成，悻悻收手，未被发觉。`,
        {},
        'steal_resolved',
        'private',
      );
    case 'failed_detected':
      return applied(
        'steal_failed_detected',
        a.reason ?? `${a.actorName}行窃败露，被${a.targetName}当场识破。`,
        {
          // 关系方向由 relationshipEffectFor(steal_failed_detected) 处理：受害者→小偷 怀疑↑/信任↓/畏惧。
          reputation: rep(-5),
        },
        'steal_resolved',
        'witnessed',
      );
  }
}

// —— 内部小工具：构造成功 / 拒绝结果，统一形状 ——
function applied(
  resultCode: string,
  reason: string,
  effects: Effects,
  eventType: string,
  visibility: EventVisibility = 'local',
): ActionResult {
  return { status: 'applied', resultCode, reason, effects, eventType, visibility };
}

function reject(resultCode: string, reason: string): ActionResult {
  return {
    status: 'rejected',
    resultCode,
    reason,
    effects: {},
    eventType: 'action_rejected',
    visibility: 'private',
  };
}
