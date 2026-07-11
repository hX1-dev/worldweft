// 拒绝系统的「纯逻辑层」（Stage 2 · M3）。不依赖 Convex，可被 Jest 直接单测。
//
// 核心立意（§8.2）：拒绝 ≠ 失败。失败是「试了但没成」，拒绝是「对方根本不愿」。
// 由规则层据「对方如何看你」(target→actor 的多维关系) + 你的声望 + 物品敏感度，给出
// 结构化 reasonCode + 人类可读 visibleReason，而非 LLM 随口说不。
// 这是一道 PRE-resolver 闸门：先判愿不愿，再谈成不成。只管社会性回绝，动作本身的
// 条件(境界/心境/物品有无)仍由 rules.ts 裁决，互不重复。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §8、§9.4。

export type TargetView = {
  affinity: number;
  trust: number;
  suspicion: number;
  debt: number;
  fear: number;
  tags?: string[];
};

export type RefusalInput = {
  actionType: string;
  targetView: TargetView; // target 如何看 actor（target→actor 关系）
  actorReputation: number;
  itemSensitive?: boolean; // 本次涉及的物品是否敏感（§9.4）
};

export type RefusalResult = { refused: boolean; reasonCode?: string; reason?: string };

// 敏感物品购买门槛（§9.4）。
const SENSITIVE = { minTrust: 20, maxSuspicion: 30, minReputation: -10 };
// 交易硬拒阈值（§9.3）。
const TRADE = { refuseSuspicion: 70, refuseTrust: -30 };
// 鬼谷仿造 · F「善恶外包社会」：声名狼藉者，纵无私怨也无人愿与之交易（与 rules 的传功 rep≤-50 一致）。
const NOTORIOUS_REPUTATION = -50;

function refuse(reasonCode: string, reason: string): RefusalResult {
  return { refused: true, reasonCode, reason };
}

export function evaluateRefusal(input: RefusalInput): RefusalResult {
  const v = input.targetView;
  const tags = v.tags ?? [];

  // 黑名单：针对角色的动作一票否决。
  if (tags.includes('blacklisted')) {
    return refuse('blacklisted', '对方视你为不受欢迎之人，断然回绝。');
  }

  // 交易：怀疑过高 / 信任极差 / 声名狼藉 → 不愿做这笔买卖。
  if (input.actionType === 'trade') {
    if (v.suspicion >= TRADE.refuseSuspicion) {
      return refuse('suspicion_too_high', '对方满腹狐疑，不愿与你交易。');
    }
    if (v.trust <= TRADE.refuseTrust) {
      return refuse('trust_too_low', '对方对你全无信任，拒绝交易。');
    }
    // F：善恶外包社会——恶行累积致声名狼藉，纵是陌生人也避之不及（无须私怨）。
    if (input.actorReputation <= NOTORIOUS_REPUTATION) {
      return refuse('notorious', '你声名狼藉，对方避之唯恐不及，不愿与你交易。');
    }
  }

  // 敏感物品（交易/赠礼涉及）：非有钱即可得，须信任够、怀疑低、声望不差。
  if (input.itemSensitive && (input.actionType === 'trade' || input.actionType === 'gift')) {
    if (
      v.trust < SENSITIVE.minTrust ||
      v.suspicion > SENSITIVE.maxSuspicion ||
      input.actorReputation < SENSITIVE.minReputation
    ) {
      return refuse('sensitive_item_denied', '这等紧要之物，岂能轻易予你。');
    }
  }

  return { refused: false };
}
