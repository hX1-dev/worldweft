// 坊市价格的「纯逻辑层」（Stage 2 · M4）。不依赖 Convex，可被 Jest 直接单测。
//
// 轻量价格（§9）：在物品 baseValue（灵石计，见 items.ts）上叠加关系修正，让「熟客更便宜、
// 可疑者更贵或被拒」。怀疑≥70 的硬拒由 M3 拒绝系统处理，这里只管能成交时的报价。
// 报价拆解（basePrice/各修正/finalPrice）回传，供 §13.2 价格解释与事件 facts。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §9.3。

// 卖家如何看买家（seller→buyer 关系）。
export type SellerView = { affinity: number; trust: number; suspicion: number; tags?: string[] };

const FLOOR = 0.7;
const CEIL = 2.0;

// 关系修正（§9.3）：信任/好感高则让利，差则加价。
export function relationshipMultiplier(v: SellerView): number {
  if (v.trust >= 50 || v.affinity >= 60) return 0.85;
  if (v.trust >= 20 || v.affinity >= 30) return 0.95;
  if (v.trust <= -20) return 1.25;
  if (v.affinity <= -20) return 1.15;
  return 1.0;
}

// 怀疑修正（§9.3）：越疑越贵（≥70 已被 M3 拒，不会到这）。
export function suspicionMultiplier(v: SellerView): number {
  if (v.suspicion >= 40) return 1.3;
  if (v.suspicion >= 20) return 1.15;
  return 1.0;
}

// 熟客额外让利。
export function regularMultiplier(tags?: string[]): number {
  return (tags ?? []).includes('regular_customer') ? 0.95 : 1.0;
}

export type PriceQuote = {
  basePrice: number;
  relationshipMultiplier: number;
  suspicionMultiplier: number;
  regularMultiplier: number;
  finalPrice: number;
};

// 报价 = basePrice × 关系 × 怀疑 × 熟客，再钳进 [0.7, 2.0]×base，取整。
export function quotePrice(basePrice: number, v: SellerView): PriceQuote {
  const rel = relationshipMultiplier(v);
  const susp = suspicionMultiplier(v);
  const reg = regularMultiplier(v.tags);
  const raw = basePrice * rel * susp * reg;
  const clamped = Math.max(basePrice * FLOOR, Math.min(basePrice * CEIL, raw));
  return {
    basePrice,
    relationshipMultiplier: rel,
    suspicionMultiplier: susp,
    regularMultiplier: reg,
    finalPrice: Math.round(clamped),
  };
}
