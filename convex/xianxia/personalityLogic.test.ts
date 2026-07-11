import {
  INNER_TRAITS,
  OUTER_TRAITS,
  alignmentOf,
  affinityGainMult,
  grudgeDecayMult,
  avengeKinds,
  cultivationDriveMult,
  personaFragment,
} from './personalityLogic';

// 性格双轴纯逻辑单测（鬼谷仿造 · D）：阵营轴、好感/仇恨修正、报仇归属、修炼驱动、叙事片段。

describe('性格集合', () => {
  test('内在 7 种、外在 12 种', () => {
    expect(INNER_TRAITS).toHaveLength(7);
    expect(OUTER_TRAITS).toHaveLength(12);
  });
});

describe('alignmentOf（内在 → 正/中/魔）', () => {
  test('正道：无私/正直/仁善', () => {
    expect(alignmentOf('无私')).toBe('righteous');
    expect(alignmentOf('仁善')).toBe('righteous');
  });
  test('中立：中庸/利己', () => {
    expect(alignmentOf('中庸')).toBe('neutral');
    expect(alignmentOf('利己')).toBe('neutral');
  });
  test('魔道：狂邪/邪恶', () => {
    expect(alignmentOf('狂邪')).toBe('demonic');
    expect(alignmentOf('邪恶')).toBe('demonic');
  });
  test('未知性格兜底为中立', () => {
    expect(alignmentOf('不存在')).toBe('neutral');
  });
});

describe('affinityGainMult（好感增量调节）', () => {
  test('孤僻慢热减半', () => {
    expect(affinityGainMult('孤僻')).toBe(0.5);
  });
  test('其余与未知默认 1', () => {
    expect(affinityGainMult('义气')).toBe(1);
    expect(affinityGainMult('不存在')).toBe(1);
  });
});

describe('grudgeDecayMult（负面情绪衰减倍率）', () => {
  test('睚眦永不忘（0）', () => {
    expect(grudgeDecayMult('中庸', '睚眦')).toBe(0);
  });
  test('仁善更快释怀（>1）', () => {
    expect(grudgeDecayMult('仁善', '义气')).toBeGreaterThan(1);
  });
  test('睚眦优先于仁善（既仁善又睚眦仍不忘）', () => {
    expect(grudgeDecayMult('仁善', '睚眦')).toBe(0);
  });
  test('默认 1', () => {
    expect(grudgeDecayMult('中庸', '义气')).toBe(1);
  });
});

describe('avengeKinds（替谁报仇）', () => {
  test('天伦护血亲、义气护友、护短护徒', () => {
    expect(avengeKinds('天伦')).toEqual(['kin']);
    expect(avengeKinds('义气')).toEqual(['friend']);
    expect(avengeKinds('护短')).toEqual(['disciple']);
  });
  test('爱家护配偶亦护血亲', () => {
    expect(avengeKinds('爱家')).toContain('spouse');
    expect(avengeKinds('爱家')).toContain('kin');
  });
  test('任我等不替人出头', () => {
    expect(avengeKinds('任我')).toEqual([]);
    expect(avengeKinds('不存在')).toEqual([]);
  });
});

describe('cultivationDriveMult（自主修炼驱动）', () => {
  test('逐权位者更勤奋', () => {
    expect(cultivationDriveMult('中庸', '权力')).toBeGreaterThan(1);
  });
  test('多情者略分心（但不低于下限）', () => {
    expect(cultivationDriveMult('中庸', '情种')).toBeLessThan(1);
    expect(cultivationDriveMult('中庸', '情种')).toBeGreaterThanOrEqual(0.5);
  });
  test('普通组合为 1', () => {
    expect(cultivationDriveMult('中庸', '名声')).toBe(1);
  });
});

describe('personaFragment（注入 LLM 的性格叙事）', () => {
  test('含内外两段、以分号连接', () => {
    const f = personaFragment('仁善', '传承');
    expect(f).toContain('宽厚');
    expect(f).toContain('传功');
    expect(f).toContain('；');
  });
  test('未知性格返回空串（不污染 prompt）', () => {
    expect(personaFragment('不存在', '不存在')).toBe('');
  });
});
