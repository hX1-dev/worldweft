import { evaluateRefusal, type TargetView } from './refusalLogic';

// Stage 2 · M3 拒绝系统纯逻辑单测：黑名单/交易怀疑/敏感物品门槛/边界/放行。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §8、§9.4。

const view = (o: Partial<TargetView> = {}): TargetView => ({
  affinity: 0,
  trust: 0,
  suspicion: 0,
  debt: 0,
  fear: 0,
  ...o,
});

describe('evaluateRefusal', () => {
  test('黑名单 → 一票否决', () => {
    const r = evaluateRefusal({ actionType: 'trade', targetView: view({ tags: ['blacklisted'] }), actorReputation: 50 });
    expect(r.refused).toBe(true);
    expect(r.reasonCode).toBe('blacklisted');
  });

  test('交易：怀疑过高 → suspicion_too_high', () => {
    const r = evaluateRefusal({ actionType: 'trade', targetView: view({ suspicion: 75 }), actorReputation: 0 });
    expect(r).toMatchObject({ refused: true, reasonCode: 'suspicion_too_high' });
  });

  test('交易：信任极差 → trust_too_low', () => {
    const r = evaluateRefusal({ actionType: 'trade', targetView: view({ trust: -40 }), actorReputation: 0 });
    expect(r).toMatchObject({ refused: true, reasonCode: 'trust_too_low' });
  });

  test('敏感物品：信任不足 → sensitive_item_denied', () => {
    const r = evaluateRefusal({
      actionType: 'trade',
      targetView: view({ trust: 10 }), // < 20
      actorReputation: 0,
      itemSensitive: true,
    });
    expect(r).toMatchObject({ refused: true, reasonCode: 'sensitive_item_denied' });
  });

  test('敏感物品：声望太低 → 拒', () => {
    const r = evaluateRefusal({
      actionType: 'gift',
      targetView: view({ trust: 50, suspicion: 0 }),
      actorReputation: -20, // < -10
      itemSensitive: true,
    });
    expect(r.refused).toBe(true);
  });

  test('敏感物品：信任够/怀疑低/声望可 → 放行', () => {
    const r = evaluateRefusal({
      actionType: 'trade',
      targetView: view({ trust: 20, suspicion: 30 }), // 恰好达标边界
      actorReputation: -10,
      itemSensitive: true,
    });
    expect(r.refused).toBe(false);
  });

  test('普通物品交易、关系正常 → 放行', () => {
    expect(evaluateRefusal({ actionType: 'trade', targetView: view({ trust: 5 }), actorReputation: 0 }).refused).toBe(
      false,
    );
  });

  test('F：声名狼藉(rep≤-50) → 交易被拒 notorious（纵无私怨）', () => {
    const r = evaluateRefusal({ actionType: 'trade', targetView: view({ trust: 5 }), actorReputation: -50 });
    expect(r).toMatchObject({ refused: true, reasonCode: 'notorious' });
  });

  test('F：声名狼藉只挡交易，不挡 talk（善恶外包社会，不是一票否决）', () => {
    expect(
      evaluateRefusal({ actionType: 'talk', targetView: view({ trust: 5 }), actorReputation: -60 }).refused,
    ).toBe(false);
  });

  test('非交易/赠礼动作不受敏感物品门槛影响', () => {
    // talk 即便 itemSensitive 也不应被敏感门槛拒（该字段对它无意义）
    expect(
      evaluateRefusal({ actionType: 'talk', targetView: view({ trust: 0 }), actorReputation: -50, itemSensitive: true })
        .refused,
    ).toBe(false);
  });
});
