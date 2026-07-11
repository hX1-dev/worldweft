import {
  clampDims,
  applyDimDelta,
  relationshipEffectFor,
  decayDims,
  giftAffinityMult,
  DECAY_PERIOD_DAYS,
  DEFAULT_DIMS,
  type Dims,
} from './relationshipLogic';

// Stage 2 · M2 多维关系纯逻辑单测：钳值范围、叠加、事件→双向维度映射（§7）。

describe('clampDims / applyDimDelta', () => {
  test('各维度钳进自己的范围（suspicion/fear 不为负）', () => {
    const d: Dims = { affinity: 200, trust: -300, suspicion: -10, debt: 50, fear: 999 };
    expect(clampDims(d)).toEqual({ affinity: 100, trust: -100, suspicion: 0, debt: 50, fear: 100 });
  });

  test('稀疏关系：未交互默认全 0，叠加只动给定维度', () => {
    const r = applyDimDelta({}, { affinity: 6, debt: 5 });
    expect(r).toEqual({ ...DEFAULT_DIMS, affinity: 6, debt: 5 });
  });

  test('在已有关系上累加并钳值', () => {
    const r = applyDimDelta({ affinity: 98, suspicion: 90 }, { affinity: 6, suspicion: 20 });
    expect(r.affinity).toBe(100); // 钳顶
    expect(r.suspicion).toBe(100);
  });
});

describe('relationshipEffectFor（事件→双向关系，§7）', () => {
  test('赠礼被收：受礼者(target)对送礼者(actor)增好感+承情', () => {
    const e = relationshipEffectFor('gift_accepted');
    expect(e.targetToActor).toMatchObject({ affinity: 6, debt: 5, trust: 1 });
    expect(e.actorToTarget).toBeUndefined();
  });

  test('偷被发现：受害者(target)对小偷(actor)怀疑↑信任↓', () => {
    const e = relationshipEffectFor('steal_failed_detected');
    expect(e.targetToActor!.suspicion).toBeGreaterThan(0);
    expect(e.targetToActor!.trust).toBeLessThan(0);
  });

  test('偷成功且无人知 → 不改任何关系（§7：未被发现）', () => {
    expect(relationshipEffectFor('steal_success_undetected')).toEqual({});
  });

  test('求教获允：弟子(actor)对师父(target)增信任+承情', () => {
    const e = relationshipEffectFor('teaching_granted');
    expect(e.actorToTarget).toMatchObject({ trust: 3, debt: 8 });
  });

  test('切磋败者对胜者生畏', () => {
    expect(relationshipEffectFor('spar_actor_win').targetToActor!.fear).toBeGreaterThan(0);
    expect(relationshipEffectFor('spar_actor_lose').actorToTarget!.fear).toBeGreaterThan(0);
  });

  test('未映射的 resultCode → 空（不改额外维度）', () => {
    expect(relationshipEffectFor('talk_warmed')).toEqual({});
    expect(relationshipEffectFor('whatever')).toEqual({});
  });
});

describe('decayDims（关系随游戏时间向 0 遗忘，鬼谷仿造 · E）', () => {
  const D2 = DECAY_PERIOD_DAYS * 2;

  test('不足一个周期 → 原样不变', () => {
    const d: Dims = { affinity: 80, trust: 40, suspicion: 30, debt: 20, fear: 10 };
    expect(decayDims(d, 0, DECAY_PERIOD_DAYS - 1, '中庸', '义气')).toEqual(d);
  });

  test('正向情谊随周期自然淡化（向 0 收敛）', () => {
    const r = decayDims({ affinity: 100 }, 0, D2, '中庸', '义气');
    expect(r.affinity).toBeGreaterThan(0);
    expect(r.affinity).toBeLessThan(100);
  });

  test('睚眦：仇恨/怀疑永不淡化，但人情仍会淡', () => {
    const r = decayDims({ affinity: -100, suspicion: 50, debt: 40 }, 0, D2, '中庸', '睚眦');
    expect(r.affinity).toBe(-100); // 记仇不忘
    expect(r.suspicion).toBe(50); // 怀疑不消
    expect(r.debt).toBeLessThan(40); // 人情照淡
  });

  test('仁善比常人更快释怀（同样时间，怀疑衰减更多）', () => {
    const ren = decayDims({ suspicion: 50 }, 0, DECAY_PERIOD_DAYS, '仁善', '义气');
    const mid = decayDims({ suspicion: 50 }, 0, DECAY_PERIOD_DAYS, '中庸', '义气');
    expect(ren.suspicion).toBeLessThan(mid.suspicion);
  });

  test('微弱残留收敛到 0（不无限拖尾）', () => {
    const r = decayDims({ affinity: 3 }, 0, DECAY_PERIOD_DAYS * 10, '中庸', '义气');
    expect(r.affinity).toBe(0);
  });
});

describe('giftAffinityMult（反套利递减，鬼谷仿造 · E）', () => {
  test('首次足额，重复递减', () => {
    expect(giftAffinityMult(0)).toBe(1);
    expect(giftAffinityMult(1)).toBeCloseTo(0.5);
    expect(giftAffinityMult(2)).toBeCloseTo(1 / 3);
  });
  test('负数兜底当 0 次', () => {
    expect(giftAffinityMult(-5)).toBe(1);
  });
});
