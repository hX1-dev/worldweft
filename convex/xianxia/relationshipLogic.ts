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

// 一桩动作结果 → 双向关系维度变化（§7）。未列出的 resultCode 不改额外维度（仅 affinity
// 仍由 rules.ts 的 value delta 处理）。actor=行动者，target=对象。
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
};

export function relationshipEffectFor(resultCode: string): RelEffect {
  return EFFECTS[resultCode] ?? {};
}

// —— E：随游戏时间衰减（惰性，按游戏日补算）——
export const DECAY_PERIOD_DAYS = 360; // 太虚历一年为一个衰减周期
export const DECAY_STEP = 0.15; // 每周期向 0 收敛的基础比例

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

// —— E：反套利。同一送礼者对同一对象，本周期内重复送礼的好感收益递减（1, 1/2, 1/3…）。
// priorGifts = 本衰减周期内已送出的次数。杜绝「按数量/售价刷好感」（鬼谷的空壳）。
export function giftAffinityMult(priorGifts: number): number {
  return 1 / (1 + Math.max(0, priorGifts));
}
