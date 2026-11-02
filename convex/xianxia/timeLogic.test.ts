import {
  gameTimeAt,
  phaseOf,
  phaseModifiers,
  phaseLabel,
  MS_PER_GAME_HOUR,
} from './timeLogic';

// World Foundation · W3a 世界时钟纯逻辑单测：真实流逝→游戏时间、阶段边界、昼夜修正。

const H = MS_PER_GAME_HOUR;
const T0 = 1_000_000_000_000;

describe('gameTimeAt（真实流逝 → 游戏时间）', () => {
  test('起点 = 第 1 日 0 时', () => {
    expect(gameTimeAt(T0, T0)).toMatchObject({ day: 1, hour: 0 });
  });
  test('过 5 个时辰 → 第 1 日 5 时（清晨）', () => {
    expect(gameTimeAt(T0 + 5 * H, T0)).toMatchObject({ day: 1, hour: 5, phase: 'dawn' });
  });
  test('过 26 个时辰 → 第 2 日 2 时', () => {
    expect(gameTimeAt(T0 + 26 * H, T0)).toMatchObject({ day: 2, hour: 2 });
  });
  test('startedAt 之前 → 第 1 日 0 时（不为负）', () => {
    expect(gameTimeAt(T0 - 99999, T0)).toMatchObject({ day: 1, hour: 0 });
  });
});

describe('phaseOf（昼夜阶段边界）', () => {
  test('晨/昼/暮/夜', () => {
    expect(phaseOf(6)).toBe('dawn');
    expect(phaseOf(12)).toBe('day');
    expect(phaseOf(18)).toBe('dusk');
    expect(phaseOf(22)).toBe('night');
    expect(phaseOf(2)).toBe('night'); // 凌晨仍是夜
  });
  test('边界：5=晨起、8=昼起、17=暮起、20=夜起', () => {
    expect(phaseOf(5)).toBe('dawn');
    expect(phaseOf(8)).toBe('day');
    expect(phaseOf(17)).toBe('dusk');
    expect(phaseOf(20)).toBe('night');
  });
});

describe('phaseModifiers（最小修正草案）', () => {
  test('清晨修炼小幅加成', () => {
    expect(phaseModifiers('dawn').cultivationXpBonus).toBeGreaterThan(0);
  });
  test('夜晚偷窃更隐蔽、被抓更重、探索更险', () => {
    const n = phaseModifiers('night');
    expect(n.stealStealthBonus).toBeGreaterThan(0);
    expect(n.stealPenaltyMult).toBeGreaterThan(1);
    expect(n.exploreRiskBonus).toBeGreaterThan(0);
  });
  test('白天/黄昏中性（不影响）', () => {
    for (const p of ['day', 'dusk'] as const) {
      expect(phaseModifiers(p)).toEqual({
        cultivationXpBonus: 0,
        stealStealthBonus: 0,
        stealPenaltyMult: 1,
        exploreRiskBonus: 0,
      });
    }
  });
});

describe('phaseLabel', () => {
  test('中文时段名', () => {
    expect(phaseLabel('dawn')).toBe('清晨');
    expect(phaseLabel('night')).toBe('夜晚');
  });
});
