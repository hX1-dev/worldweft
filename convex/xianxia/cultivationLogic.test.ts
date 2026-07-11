import {
  autoCultivationGain,
  proposeBonds,
  BOND_THRESHOLD,
  type BondPair,
} from './cultivationLogic';

// 自主成长纯逻辑单测（鬼谷仿造 · G）：背景修为涓流、运行时关系缔结。

const gain = (over: Partial<Parameters<typeof autoCultivationGain>[0]> = {}) =>
  autoCultivationGain({
    spiritualEnergy: 3,
    spiritRoot: 'wood',
    realm: 'qi_refining',
    innerTrait: '中庸',
    outerTrait: '名声',
    phaseBonus: 0,
    ...over,
  });

describe('autoCultivationGain（背景修为涓流）', () => {
  test('人人至少有 1 点进益（守职者也不停滞）', () => {
    expect(gain({ spiritualEnergy: 0 })).toBeGreaterThanOrEqual(1);
  });

  test('地灵气越足，精进越快', () => {
    expect(gain({ spiritualEnergy: 5 })).toBeGreaterThan(gain({ spiritualEnergy: 1 }));
  });

  test('杂灵根比正灵根稍慢', () => {
    expect(gain({ spiritRoot: 'mixed', spiritualEnergy: 6 })).toBeLessThan(
      gain({ spiritRoot: 'metal', spiritualEnergy: 6 }),
    );
  });

  test('境界越高，被动精进越慢（平衡阀门）', () => {
    expect(gain({ realm: 'golden_core', spiritualEnergy: 6 })).toBeLessThan(
      gain({ realm: 'qi_refining', spiritualEnergy: 6 }),
    );
  });

  test('逐权位者比无所谓声名者更勤', () => {
    expect(gain({ outerTrait: '权力', spiritualEnergy: 6 })).toBeGreaterThanOrEqual(
      gain({ outerTrait: '名声', spiritualEnergy: 6 }),
    );
  });

  test('清晨灵气清明，略有加成', () => {
    expect(gain({ phaseBonus: 2, spiritualEnergy: 6 })).toBeGreaterThanOrEqual(
      gain({ phaseBonus: 0, spiritualEnergy: 6 }),
    );
  });
});

describe('proposeBonds（运行时关系缔结）', () => {
  const pair = (over: Partial<BondPair> = {}): BondPair => ({
    a: '甲',
    b: '乙',
    affinityAB: 80,
    affinityBA: 80,
    aInner: '中庸',
    aOuter: '义气',
    bInner: '中庸',
    bOuter: '中庸',
    existingTags: [],
    ...over,
  });

  test('双向好感不足门槛 → 不缔结', () => {
    expect(proposeBonds([pair({ affinityAB: BOND_THRESHOLD - 1 })])).toHaveLength(0);
    expect(proposeBonds([pair({ affinityBA: BOND_THRESHOLD - 1 })])).toHaveLength(0);
  });

  test('情种/忠贞 + 非血亲 → 道侣', () => {
    expect(proposeBonds([pair({ aOuter: '情种' })])[0].kind).toBe('道侣');
    expect(proposeBonds([pair({ aOuter: '忠贞' })])[0].kind).toBe('道侣');
  });

  test('血亲不结道侣（即便一方多情，退而义结金兰/师徒）', () => {
    const r = proposeBonds([pair({ aOuter: '情种', bOuter: '义气', existingTags: ['血亲'] })]);
    expect(r[0].kind).not.toBe('道侣');
  });

  test('传承之心 → 师徒；义气 → 结义', () => {
    expect(proposeBonds([pair({ aOuter: '传承' })])[0].kind).toBe('师徒');
    expect(proposeBonds([pair({ aOuter: '义气', bOuter: '中庸' })])[0].kind).toBe('结义');
  });

  test('已有缔结关系 → 不再重复', () => {
    expect(proposeBonds([pair({ aOuter: '情种', existingTags: ['道侣'] })])).toHaveLength(0);
  });

  test('双方性格都平淡无缔结倾向 → 不强行结缘', () => {
    expect(proposeBonds([pair({ aOuter: '名声', bOuter: '权力' })])).toHaveLength(0);
  });
});
