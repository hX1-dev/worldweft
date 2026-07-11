import {
  deriveGrudges,
  isEnemyView,
  shouldSeekRevenge,
  type AllyRelation,
} from './grudgeLogic';

// 仇恨链纯逻辑单测（鬼谷仿造 · F）：二次仇恨派生（按性格出头）、仇敌判定、复仇意念。

const ally = (over: Partial<AllyRelation>): AllyRelation => ({
  actorId: 'X',
  kind: 'friend',
  innerTrait: '中庸',
  outerTrait: '义气',
  ...over,
});

describe('deriveGrudges（受害亲友的二次仇恨）', () => {
  test('义气者替挚友记恨加害者（好感↓怀疑↑）', () => {
    const seeds = deriveGrudges('凶手', [ally({ actorId: '友', kind: 'friend', outerTrait: '义气' })], 1);
    expect(seeds).toHaveLength(1);
    expect(seeds[0].actorId).toBe('友');
    expect(seeds[0].delta.affinity).toBeLessThan(0);
    expect(seeds[0].delta.suspicion!).toBeGreaterThan(0);
  });

  test('性格不为此类出头则不记恨（义气者不为「血亲」类自动出头）', () => {
    const seeds = deriveGrudges('凶手', [ally({ kind: 'kin', outerTrait: '义气' })], 1);
    expect(seeds).toHaveLength(0);
  });

  test('天伦护血亲、护短护门徒、爱家护道侣', () => {
    expect(deriveGrudges('凶手', [ally({ kind: 'kin', outerTrait: '天伦' })], 1)).toHaveLength(1);
    expect(deriveGrudges('凶手', [ally({ kind: 'disciple', outerTrait: '护短' })], 1)).toHaveLength(1);
    expect(deriveGrudges('凶手', [ally({ kind: 'spouse', outerTrait: '爱家' })], 1)).toHaveLength(1);
  });

  test('泛泛之交(other)不出头', () => {
    expect(deriveGrudges('凶手', [ally({ kind: 'other', outerTrait: '义气' })], 1)).toHaveLength(0);
  });

  test('加害者本人不会替受害者记恨自己', () => {
    expect(deriveGrudges('凶手', [ally({ actorId: '凶手', outerTrait: '义气' })], 1)).toHaveLength(0);
  });

  test('严重度越高仇恨越深', () => {
    const light = deriveGrudges('凶手', [ally({ outerTrait: '义气' })], 0.2)[0];
    const heavy = deriveGrudges('凶手', [ally({ outerTrait: '义气' })], 1)[0];
    expect(Math.abs(heavy.delta.affinity!)).toBeGreaterThan(Math.abs(light.delta.affinity!));
  });

  test('severity 钳到 (0,1]，最小幅度也≥1', () => {
    const s = deriveGrudges('凶手', [ally({ outerTrait: '义气' })], 0.0001)[0];
    expect(Math.abs(s.delta.affinity!)).toBeGreaterThanOrEqual(1);
  });
});

describe('isEnemyView / shouldSeekRevenge', () => {
  test('好感极低或怀疑极高 → 仇敌', () => {
    expect(isEnemyView({ affinity: -70, suspicion: 0 })).toBe(true);
    expect(isEnemyView({ affinity: 0, suspicion: 80 })).toBe(true);
    expect(isEnemyView({ affinity: -10, suspicion: 10 })).toBe(false);
  });

  test('非仇敌一律不寻仇', () => {
    expect(shouldSeekRevenge({ affinity: -10, suspicion: 0 }, '狂邪', '睚眦')).toBe(false);
  });

  test('睚眦/狂邪/邪恶 → 主动寻仇', () => {
    expect(shouldSeekRevenge({ affinity: -65, suspicion: 0 }, '中庸', '睚眦')).toBe(true);
    expect(shouldSeekRevenge({ affinity: -65, suspicion: 0 }, '狂邪', '义气')).toBe(true);
  });

  test('仁善/无私 → 不寻仇（倾向化解）', () => {
    expect(shouldSeekRevenge({ affinity: -90, suspicion: 0 }, '仁善', '义气')).toBe(false);
  });

  test('常人须积怨极深(≤-80)方寻仇', () => {
    expect(shouldSeekRevenge({ affinity: -65, suspicion: 0 }, '中庸', '义气')).toBe(false);
    expect(shouldSeekRevenge({ affinity: -85, suspicion: 0 }, '中庸', '义气')).toBe(true);
  });
});
