import {
  clampDims,
  applyDimDelta,
  relationshipEffectFor,
  decayDims,
  giftAffinityMult,
  mergeDimDeltas,
  relationshipDimsAt,
  relationshipStorageAfterEvent,
  relationshipEffectKindFor,
  resolveRelationshipEvent,
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
  test('普通交谈只证明交流发生，不直接改变任何持久关系', () => {
    expect(relationshipEffectFor('conversation_started')).toEqual({});
  });

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

  test('群议守诺与违约只改变受诺者对承诺者的有向关系', () => {
    expect(relationshipEffectFor('group_commitment_fulfilled')).toEqual({
      targetToActor: { affinity: 3, trust: 5, debt: 5 },
    });
    expect(relationshipEffectFor('group_commitment_breached')).toEqual({
      targetToActor: { affinity: -6, trust: -8, suspicion: 20 },
    });
  });

  test('未映射的 resultCode → 空（不改额外维度）', () => {
    expect(relationshipEffectFor('talk_warmed')).toEqual({});
    expect(relationshipEffectFor('whatever')).toEqual({});
  });
});

describe('C015b event-sourced relationship policy', () => {
  test('maps production result codes to one stable effect family', () => {
    expect(relationshipEffectKindFor('conversation_started')).toBeUndefined();
    expect(relationshipEffectKindFor('gift_accepted')).toBe('gift');
    expect(relationshipEffectKindFor('steal_failed_detected')).toBe('theft');
    expect(relationshipEffectKindFor('group_commitment_fulfilled')).toBe('commitment_fulfillment');
    expect(relationshipEffectKindFor('group_commitment_breached')).toBe('commitment_breach');
    expect(relationshipEffectKindFor('request_completed')).toBeUndefined();
  });

  test('merges the rule affinity and multidimensional reaction before one directional application', () => {
    expect(mergeDimDeltas({ affinity: 2 }, { affinity: 1, trust: 3 }, undefined)).toEqual({
      affinity: 3,
      trust: 3,
    });
  });

  test('legacy routine-talk rows remain bounded and readable without being a production mapping', () => {
    const first = resolveRelationshipEvent({
      current: {}, baseDelta: { affinity: 2, trust: 1 }, effectKind: 'routine_talk', priorWindowCount: 0,
    });
    const repeat = resolveRelationshipEvent({
      current: first.next, baseDelta: { affinity: 2, trust: 1 }, effectKind: 'routine_talk', priorWindowCount: 1,
    });
    expect(first).toMatchObject({ status: 'applied', appliedDelta: { affinity: 2, trust: 1 } });
    expect(repeat).toMatchObject({
      status: 'suppressed', reasonCode: 'relationship_gain_cooldown', appliedDelta: {}, next: first.next,
    });
  });

  test('second weekly gift is halved and the third is suppressed', () => {
    const first = resolveRelationshipEvent({
      current: {}, baseDelta: { affinity: 6, trust: 1, debt: 5 }, effectKind: 'gift', priorWindowCount: 0,
    });
    const second = resolveRelationshipEvent({
      current: first.next, baseDelta: { affinity: 6, trust: 1, debt: 5 }, effectKind: 'gift', priorWindowCount: 1,
    });
    const third = resolveRelationshipEvent({
      current: second.next, baseDelta: { affinity: 6, trust: 1, debt: 5 }, effectKind: 'gift', priorWindowCount: 2,
    });
    expect(first.appliedDelta).toEqual({ affinity: 6, trust: 1, debt: 5 });
    expect(second.appliedDelta).toEqual({ affinity: 3, trust: 1, debt: 2 });
    expect(third.reasonCode).toBe('relationship_gain_cooldown');
  });

  test('routine families saturate below global maximum while assault retains the full range', () => {
    const talk = resolveRelationshipEvent({
      current: { affinity: 40 }, baseDelta: { affinity: 2 }, effectKind: 'routine_talk', priorWindowCount: 0,
    });
    const assault = resolveRelationshipEvent({
      current: { affinity: -95 }, baseDelta: { affinity: -18 }, effectKind: 'assault', priorWindowCount: 0,
    });
    expect(talk).toMatchObject({ status: 'suppressed', reasonCode: 'relationship_saturated' });
    expect(assault.appliedDelta.affinity).toBeLessThan(0);
    expect(assault.next.affinity).toBeGreaterThanOrEqual(-100);
  });

  test('守诺与违约均有界，且方向不能被饱和规则反转', () => {
    const fulfilled = resolveRelationshipEvent({
      current: { affinity: 69, trust: 84, debt: 84 },
      baseDelta: relationshipEffectFor('group_commitment_fulfilled').targetToActor!,
      effectKind: 'commitment_fulfillment',
      priorWindowCount: 0,
    });
    const breached = resolveRelationshipEvent({
      current: { affinity: -84, trust: -84, suspicion: 84 },
      baseDelta: relationshipEffectFor('group_commitment_breached').targetToActor!,
      effectKind: 'commitment_breach',
      priorWindowCount: 0,
    });
    expect(fulfilled).toMatchObject({
      status: 'applied', next: { affinity: 70, trust: 85, debt: 85 },
    });
    expect(breached).toMatchObject({
      status: 'applied', next: { affinity: -85, trust: -85, suspicion: 85 },
    });
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
    const ren = decayDims({ suspicion: 50 }, 0, DECAY_PERIOD_DAYS * 3, '仁善', '义气');
    const mid = decayDims({ suspicion: 50 }, 0, DECAY_PERIOD_DAYS * 3, '中庸', '义气');
    expect(ren.suspicion).toBeLessThan(mid.suspicion);
  });

  test('微弱残留收敛到 0（不无限拖尾）', () => {
    const r = decayDims({ affinity: 3 }, 0, DECAY_PERIOD_DAYS * 80, '中庸', '义气');
    expect(r.affinity).toBe(0);
  });

  test('相同 base/day/traits 的读取投影完全可复现，29 日不抖、30 日才衰减', () => {
    const dims = { affinity: 80, trust: 40, suspicion: 30 };
    expect(relationshipDimsAt(dims, 0, 29, '中庸', '义气')).toMatchObject(dims);
    const first = relationshipDimsAt(dims, 0, 30, '中庸', '义气');
    const second = relationshipDimsAt(dims, 0, 30, '中庸', '义气');
    expect(first).toEqual(second);
    expect(first.affinity).toBeLessThan(80);
  });

  test('正面事件只重置实际变化维度，不改变怀疑的衰减锚点', () => {
    const stored = { affinity: 0, trust: 0, suspicion: 20, debt: 0, fear: 0 };
    const current = relationshipDimsAt(stored, 0, 90, '中庸', '义气');
    const resolution = resolveRelationshipEvent({
      current,
      baseDelta: { trust: 5, debt: 5 },
      effectKind: 'quest_completion',
      priorWindowCount: 0,
    });
    const storage = relationshipStorageAfterEvent({
      stored,
      lastTouchedDay: 0,
      effectiveNext: resolution.next,
      appliedDelta: resolution.appliedDelta,
      gameDay: 90,
    });
    expect(storage.dims.suspicion).toBe(20);
    expect(storage.dimensionTouchedDays.suspicion).toBe(0);
    expect(storage.dims.trust).toBe(5);
    expect(storage.dimensionTouchedDays.trust).toBe(90);
    expect(
      relationshipDimsAt(
        storage.dims,
        90,
        180,
        '中庸',
        '义气',
        storage.dimensionTouchedDays,
      ).suspicion,
    ).toBe(decayDims({ suspicion: 20 }, 0, 180, '中庸', '义气').suspicion);
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
