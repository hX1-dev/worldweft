import { quotePrice, relationshipMultiplier, suspicionMultiplier, type SellerView } from './priceLogic';

// Stage 2 · M4 价格纯逻辑单测：关系/怀疑/熟客修正 + 钳值 + 报价拆解。

const v = (o: Partial<SellerView> = {}): SellerView => ({ affinity: 0, trust: 0, suspicion: 0, ...o });

describe('修正系数', () => {
  test('高信任让利', () => {
    expect(relationshipMultiplier(v({ trust: 60 }))).toBe(0.85);
    expect(relationshipMultiplier(v({ affinity: 35 }))).toBe(0.95);
  });
  test('信任/好感差则加价', () => {
    expect(relationshipMultiplier(v({ trust: -30 }))).toBe(1.25);
    expect(relationshipMultiplier(v({ affinity: -25 }))).toBe(1.15);
  });
  test('怀疑越高越贵', () => {
    expect(suspicionMultiplier(v({ suspicion: 10 }))).toBe(1.0);
    expect(suspicionMultiplier(v({ suspicion: 25 }))).toBe(1.15);
    expect(suspicionMultiplier(v({ suspicion: 50 }))).toBe(1.3);
  });
});

describe('quotePrice', () => {
  test('陌生人按原价（base=12）', () => {
    expect(quotePrice(12, v()).finalPrice).toBe(12);
  });

  test('熟客 + 高信任 → 更便宜', () => {
    const q = quotePrice(12, v({ trust: 60, tags: ['regular_customer'] }));
    expect(q.finalPrice).toBeLessThan(12);
    expect(q.relationshipMultiplier).toBe(0.85);
    expect(q.regularMultiplier).toBe(0.95);
  });

  test('可疑者 → 更贵', () => {
    expect(quotePrice(12, v({ suspicion: 45 })).finalPrice).toBeGreaterThan(12);
  });

  test('钳值：不低于 0.7×base、不高于 2.0×base', () => {
    const cheap = quotePrice(100, v({ trust: 100, tags: ['regular_customer'] }));
    expect(cheap.finalPrice).toBeGreaterThanOrEqual(70);
    const dear = quotePrice(100, v({ trust: -100, suspicion: 60, affinity: -100 }));
    expect(dear.finalPrice).toBeLessThanOrEqual(200);
  });

  test('回传拆解供解释', () => {
    const q = quotePrice(10, v({ suspicion: 25 }));
    expect(q).toMatchObject({ basePrice: 10, suspicionMultiplier: 1.15 });
    expect(typeof q.finalPrice).toBe('number');
  });
});
