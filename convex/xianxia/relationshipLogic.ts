// 多维关系的「纯逻辑层」（Stage 2 · M2）。不依赖 Convex，可被 Jest 直接单测；
// 落库（upsert + 钳值）在 actions.ts。
//
// 第一阶段关系只有一个 value（好感）。M2 升级为 5 维，并把「事件→关系变化」集中到一张
// 按 resultCode 索引的表里（§7），让 rules.ts 的裁决保持纯净、关系语义只此一处。
// 方向很关键（§6 的核心立意：世界对你的行为产生反应）：
//   - 偷被发现 → 受害者对小偷 suspicion↑/trust↓（targetToActor）
//   - 送礼被收 → 受礼者对送礼者 affinity↑/debt↑（targetToActor）
//   - 求教获允 → 弟子对师父 trust↑/debt↑（actorToTarget）
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §6、§7。
//
// 鬼谷仿造 · E：补两件鬼谷的空壳——
//   - decayDims：关系随游戏时间向 0「遗忘」，负面情绪的淡化由性格调节（睚眦不忘、仁善宽宥）。
//   - giftAffinityMult：同一对人重复送礼好感收益递减，杜绝「按售价/数量刷好感」。

import { grudgeDecayMult } from './personalityLogic';

export type Dims = {
  affinity: number; // 好感 −100..100（落库存于 relationships.value）
  trust: number; // 信任 −100..100
  suspicion: number; // 怀疑 0..100
  debt: number; // 恩情/人情 −100..100（>0：对方欠 actor；<0：actor 欠对方）
  fear: number; // 畏惧 0..100
};
export type DimDelta = Partial<Dims>;
export type DimensionTouchedDays = Partial<Record<keyof Dims, number>>;

export const DEFAULT_DIMS: Dims = { affinity: 0, trust: 0, suspicion: 0, debt: 0, fear: 0 };

const RANGES: Record<keyof Dims, [number, number]> = {
  affinity: [-100, 100],
  trust: [-100, 100],
  suspicion: [0, 100],
  debt: [-100, 100],
  fear: [0, 100],
};

const DIM_KEYS = Object.keys(RANGES) as (keyof Dims)[];

function clamp1(v: number, [lo, hi]: [number, number]): number {
  return Math.max(lo, Math.min(hi, v));
}

// 把任意 Dims 钳进各自范围（落库前调用）。
export function clampDims(d: Dims): Dims {
  const out = {} as Dims;
  for (const k of DIM_KEYS) out[k] = clamp1(d[k], RANGES[k]);
  return out;
}

// 在当前维度上叠加增量并钳值；current/delta 任一维度缺省都按 0 处理
// （稀疏关系：未交互过默认全 0，DB 里各维度也可能 undefined）。
export function applyDimDelta(current: Partial<Dims>, delta: DimDelta): Dims {
  const base = {} as Dims;
  for (const k of DIM_KEYS) {
    base[k] = (current[k] ?? DEFAULT_DIMS[k]) + (delta[k] ?? 0);
  }
  return clampDims(base);
}

export type RelEffect = { actorToTarget?: DimDelta; targetToActor?: DimDelta };

export type RelationshipEffectKind =
  | 'routine_talk'
  | 'gift'
  | 'trade'
  | 'teaching'
  | 'spar'
  | 'theft'
  | 'quest_completion'
  | 'commitment_fulfillment'
  | 'commitment_breach'
  | 'assault'
  | 'guard_witness'
  | 'ally_grudge';

type RelationshipEventPolicy = {
  windowDays: number;
  maxBenefits: number;
  multipliers: number[];
  bounds?: Partial<Record<keyof Dims, [number, number]>>;
};

const UNBOUNDED_EVENT_POLICY: RelationshipEventPolicy = {
  windowDays: 0,
  maxBenefits: Number.POSITIVE_INFINITY,
  multipliers: [1],
};

export const RELATIONSHIP_EVENT_POLICIES: Record<RelationshipEffectKind, RelationshipEventPolicy> = {
  routine_talk: {
    windowDays: 1,
    maxBenefits: 1,
    multipliers: [1],
    bounds: { affinity: [-100, 40], trust: [-100, 30] },
  },
  gift: {
    windowDays: 7,
    maxBenefits: 2,
    multipliers: [1, 0.5],
    bounds: { affinity: [-100, 60], trust: [-100, 40], debt: [-100, 60], suspicion: [0, 40] },
  },
  trade: {
    windowDays: 1,
    maxBenefits: 1,
    multipliers: [1],
    bounds: { affinity: [-20, 100], trust: [-100, 40] },
  },
  teaching: {
    windowDays: 7,
    maxBenefits: 1,
    multipliers: [1],
    bounds: { affinity: [-20, 100], trust: [-100, 70], debt: [-100, 80] },
  },
  spar: {
    windowDays: 1,
    maxBenefits: 1,
    multipliers: [1],
    bounds: { affinity: [-30, 100], trust: [-100, 40], fear: [0, 60] },
  },
  theft: UNBOUNDED_EVENT_POLICY,
  quest_completion: {
    ...UNBOUNDED_EVENT_POLICY,
    bounds: { trust: [-100, 85], debt: [-100, 85] },
  },
  commitment_fulfillment: {
    ...UNBOUNDED_EVENT_POLICY,
    bounds: { affinity: [-100, 70], trust: [-100, 85], debt: [-100, 85] },
  },
  commitment_breach: {
    ...UNBOUNDED_EVENT_POLICY,
    bounds: { affinity: [-85, 100], trust: [-85, 100], suspicion: [0, 85] },
  },
  assault: UNBOUNDED_EVENT_POLICY,
  guard_witness: UNBOUNDED_EVENT_POLICY,
  ally_grudge: UNBOUNDED_EVENT_POLICY,
};

// 一桩可验证的动作结果 → 双向关系维度变化（§7）。未列出的 resultCode 不改额外维度。
// actor=行动者，target=对象。LWSE-0 G0 明确禁止把 conversation_started（只是交流活动
// 开始）直接当作关系结果；routine_talk policy 只为历史审计行的读取/衰减兼容保留。
const EFFECTS: Record<string, RelEffect> = {
  // 赠礼：受礼者承情、增好感与信任
  gift_accepted: { targetToActor: { affinity: 6, trust: 1, debt: 5 } },
  gift_rejected: { targetToActor: { affinity: -2, suspicion: 3 } },
  // 交易：买卖双方互增信任
  trade_completed: { actorToTarget: { trust: 1 }, targetToActor: { trust: 2 } },
  trade_refused: { targetToActor: { affinity: -1 } },
  // 求教：弟子对师父生信任与人情
  teaching_granted: { actorToTarget: { trust: 3, debt: 8 } },
  teaching_refused: { actorToTarget: { affinity: -1 } },
  // 切磋：败者对胜者生畏、略失好感；平手互敬
  spar_actor_win: { targetToActor: { fear: 3, affinity: -1 } },
  spar_actor_lose: { actorToTarget: { fear: 3, affinity: -1 } },
  spar_draw: { actorToTarget: { trust: 1 }, targetToActor: { trust: 1 } },
  // 偷取：未被发现则无人知晓、不改关系；被疑/被抓则受害者怀疑、失信、生畏
  steal_success_undetected: {},
  steal_failed_undetected: {},
  steal_success_suspected: { targetToActor: { suspicion: 20, trust: -10, affinity: -5 } },
  steal_failed_detected: { targetToActor: { suspicion: 40, trust: -25, affinity: -15, fear: 2 } },
  // 群议承诺的受诺者会记住承诺者是否守信。这里仅定义关系方向与幅度；
  // commitment/proposal 状态和物品转移仍由 groupDecisions 的服务端状态机裁决。
  group_commitment_fulfilled: { targetToActor: { affinity: 3, trust: 5, debt: 5 } },
  group_commitment_breached: { targetToActor: { affinity: -6, trust: -8, suspicion: 20 } },
};

export function relationshipEffectFor(resultCode: string): RelEffect {
  return EFFECTS[resultCode] ?? {};
}

export function relationshipEffectKindFor(resultCode: string): RelationshipEffectKind | undefined {
  if (resultCode.startsWith('gift_')) return 'gift';
  if (resultCode.startsWith('trade_')) return 'trade';
  if (resultCode.startsWith('teaching_')) return 'teaching';
  if (resultCode.startsWith('spar_')) return 'spar';
  if (resultCode.startsWith('steal_')) return 'theft';
  if (resultCode === 'group_commitment_fulfilled') return 'commitment_fulfillment';
  if (resultCode === 'group_commitment_breached') return 'commitment_breach';
  return undefined;
}

export function mergeDimDeltas(...deltas: (DimDelta | undefined)[]): DimDelta {
  const merged: DimDelta = {};
  for (const delta of deltas) {
    if (!delta) continue;
    for (const key of DIM_KEYS) {
      const value = delta[key];
      if (value !== undefined) merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

function policyRange(kind: RelationshipEffectKind, key: keyof Dims): [number, number] {
  return RELATIONSHIP_EVENT_POLICIES[kind].bounds?.[key] ?? RANGES[key];
}

function saturatedDelta(
  current: number,
  requested: number,
  range: [number, number],
  multiplier: number,
): number {
  if (requested === 0 || multiplier <= 0) return 0;
  const [lower, upper] = range;
  if (requested > 0) {
    if (current >= upper) return 0;
    const headroom = upper - current;
    const neutralSpan = Math.max(1, upper - Math.min(0, upper));
    const factor = Math.min(1, headroom / neutralSpan);
    const scaled = Math.max(1, Math.round(requested * multiplier * factor));
    return Math.min(headroom, scaled);
  }
  if (current <= lower) return 0;
  const headroom = current - lower;
  const neutralSpan = Math.max(1, Math.max(0, lower) - lower);
  const factor = Math.min(1, headroom / neutralSpan);
  const scaled = Math.max(1, Math.round(Math.abs(requested) * multiplier * factor));
  return -Math.min(headroom, scaled);
}

export type RelationshipEventResolution = {
  status: 'applied' | 'suppressed';
  reasonCode?: 'relationship_gain_cooldown' | 'relationship_saturated';
  appliedDelta: DimDelta;
  next: Dims;
  multiplier: number;
};

export function resolveRelationshipEvent(input: {
  current: Partial<Dims>;
  baseDelta: DimDelta;
  effectKind: RelationshipEffectKind;
  priorWindowCount: number;
}): RelationshipEventResolution {
  const current = applyDimDelta(input.current, {});
  const policy = RELATIONSHIP_EVENT_POLICIES[input.effectKind];
  if (input.priorWindowCount >= policy.maxBenefits) {
    return {
      status: 'suppressed',
      reasonCode: 'relationship_gain_cooldown',
      appliedDelta: {},
      next: current,
      multiplier: 0,
    };
  }
  const multiplier = policy.multipliers[input.priorWindowCount] ?? 1;
  const appliedDelta: DimDelta = {};
  for (const key of DIM_KEYS) {
    const requested = input.baseDelta[key] ?? 0;
    const applied = saturatedDelta(current[key], requested, policyRange(input.effectKind, key), multiplier);
    if (applied !== 0) appliedDelta[key] = applied;
  }
  if (Object.keys(appliedDelta).length === 0) {
    return {
      status: 'suppressed',
      reasonCode: 'relationship_saturated',
      appliedDelta,
      next: current,
      multiplier,
    };
  }
  return {
    status: 'applied',
    appliedDelta,
    next: applyDimDelta(current, appliedDelta),
    multiplier,
  };
}

// —— E：随游戏时间衰减（惰性，按游戏日补算）——
export const DECAY_PERIOD_DAYS = 30; // 每个太虚月结算一次缓慢衰减
export const DECAY_STEP = 0.02; // 每月 2%，一年约保留 78.5%

// 把一段时间未变动的关系，按经过的「整周期数」向 0 收敛。
// 负面情绪（仇恨=负好感、suspicion、fear）的衰减乘性格倍率：睚眦=0 永不忘、仁善>1 更快释怀；
// 正向情谊与人情（debt/trust/正 affinity）按基础比例自然淡化。绝对值收敛到 <1 即归 0。
export function decayDims(
  dims: Partial<Dims>,
  fromDay: number,
  toDay: number,
  innerTrait: string,
  outerTrait: string,
): Dims {
  const base = applyDimDelta(dims, {}); // 补全缺省维度并钳值
  const periods = Math.floor(Math.max(0, toDay - fromDay) / DECAY_PERIOD_DAYS);
  if (periods <= 0) return base;
  const grudgeMult = grudgeDecayMult(innerTrait, outerTrait);
  const isGrudge = (k: keyof Dims, v: number) =>
    k === 'suspicion' || k === 'fear' || (k === 'affinity' && v < 0);
  const decayOne = (v: number, mult: number): number => {
    if (v === 0 || mult === 0) return v;
    const step = Math.min(1, DECAY_STEP * mult);
    const decayed = v * Math.pow(1 - step, periods);
    return Math.abs(decayed) < 1 ? 0 : Math.round(decayed);
  };
  const out = {} as Dims;
  for (const k of DIM_KEYS) out[k] = decayOne(base[k], isGrudge(k, base[k]) ? grudgeMult : 1);
  return clampDims(out);
}

export function relationshipDimsAt(
  dims: Partial<Dims>,
  lastTouchedDay: number | undefined,
  currentDay: number,
  innerTrait: string,
  outerTrait: string,
  dimensionTouchedDays?: DimensionTouchedDays,
): Dims {
  if (dimensionTouchedDays === undefined) {
    if (lastTouchedDay === undefined) return applyDimDelta(dims, {});
    return decayDims(dims, lastTouchedDay, currentDay, innerTrait, outerTrait);
  }
  const base = applyDimDelta(dims, {});
  const projected = {} as Dims;
  for (const key of DIM_KEYS) {
    const fromDay = dimensionTouchedDays[key];
    projected[key] =
      fromDay === undefined
        ? base[key]
        : decayDims({ [key]: base[key] }, fromDay, currentDay, innerTrait, outerTrait)[key];
  }
  return clampDims(projected);
}

// Integer decay becomes path-dependent if an event touching trust also materializes and
// re-anchors unrelated suspicion/fear. Preserve each untouched raw value and decay anchor;
// only dimensions with an actual applied delta are materialized at the event day.
export function relationshipStorageAfterEvent(input: {
  stored: Partial<Dims>;
  lastTouchedDay?: number;
  dimensionTouchedDays?: DimensionTouchedDays;
  effectiveNext: Dims;
  appliedDelta: DimDelta;
  gameDay: number;
}): { dims: Dims; dimensionTouchedDays: Record<keyof Dims, number> } {
  const dims = applyDimDelta(input.stored, {});
  const touched = {} as Record<keyof Dims, number>;
  for (const key of DIM_KEYS) {
    touched[key] = input.dimensionTouchedDays?.[key] ?? input.lastTouchedDay ?? input.gameDay;
    if ((input.appliedDelta[key] ?? 0) !== 0) {
      dims[key] = input.effectiveNext[key];
      touched[key] = input.gameDay;
    }
  }
  return { dims: clampDims(dims), dimensionTouchedDays: touched };
}

// —— E：反套利。同一送礼者对同一对象，本周期内重复送礼的好感收益递减（1, 1/2, 1/3…）。
// priorGifts = 本衰减周期内已送出的次数。杜绝「按数量/售价刷好感」（鬼谷的空壳）。
export function giftAffinityMult(priorGifts: number): number {
  return 1 / (1 + Math.max(0, priorGifts));
}
