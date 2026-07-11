// 物品目录（纯数据，无 Convex 依赖，可单测）。
// 给第一阶段的裸 itemId 挂上「中文名 + 品类 + 价值 + 简单加成」，为坊市经济、
// 武器探索/切磋加成、小法器单一效果做地基。
//
// 依据：xianxia-world-concept-pack/docs/taixu-world-setting.md §8（灵石/丹药/武器/小法器）
//       与 taixu-stage-2-social-system.md §9（价格表、敏感物品；itemId 与现有代码兼容）。
// 原则（§8.5）：一个小法器只做一件事，数值小，不升级、不强化、不做套装。
//
// baseValue 单位是「灵石」（spirit_stone 自身 baseValue=1，即通货）。
// Stage 2 的价格系统会在此 baseValue 上叠加 关系/怀疑/熟客 修正，本阶段只立目录。

export type ItemKind = 'currency' | 'pill' | 'herb' | 'talisman' | 'weapon' | 'minor_artifact';

export type ItemDef = {
  id: string;
  name: string; // 中文显示名
  kind: ItemKind;
  baseValue: number; // 以灵石计
  sensitive?: boolean; // 敏感物品：非有钱即可买（Stage 2 §9.4）
  // 武器（§8.4）：影响探索安全与未来切磋战力。
  combatBonus?: number;
  exploreSafetyBonus?: number;
  // 小法器（§8.5）：单一被动效果 + 小数值。
  effect?: string;
  value?: number;
  desc?: string;
};

// 键 = itemId（沿用现有代码 healing_pill/spirit_herb/talisman，并补齐概念包命名物）。
export const ITEM_CATALOG: Record<string, ItemDef> = {
  // —— 通货 ——
  spirit_stone: { id: 'spirit_stone', name: '灵石', kind: 'currency', baseValue: 1, desc: '基础交易货币。' },

  // —— 丹药（只作物品，不炼丹，§5.2/§8.2）——
  healing_pill: { id: 'healing_pill', name: '疗伤丹', kind: 'pill', baseValue: 10, effect: 'heal', value: 3 },
  qi_pill: { id: 'qi_pill', name: '聚气丹', kind: 'pill', baseValue: 12, effect: 'cultivation', value: 10 },
  calm_pill: { id: 'calm_pill', name: '宁心丹', kind: 'pill', baseValue: 10, effect: 'mood', value: 1 },

  // —— 资源 ——
  spirit_herb: { id: 'spirit_herb', name: '灵草', kind: 'herb', baseValue: 8, desc: '探索机缘所得，可售可赠，亦为未来炼丹之材。' },
  talisman: { id: 'talisman', name: '符箓', kind: 'talisman', baseValue: 12, desc: '一次性符箓。' },

  // —— 武器（简单加成，§8.4）——
  wood_sword: { id: 'wood_sword', name: '木剑', kind: 'weapon', baseValue: 6, combatBonus: 1, exploreSafetyBonus: 0 },
  iron_sword: { id: 'iron_sword', name: '铁剑', kind: 'weapon', baseValue: 14, combatBonus: 2, exploreSafetyBonus: 1 },
  azure_sword: { id: 'azure_sword', name: '青锋剑', kind: 'weapon', baseValue: 30, combatBonus: 3, exploreSafetyBonus: 1 },

  // —— 小法器（单一效果，§8.5）——
  light_charm: { id: 'light_charm', name: '轻身符佩', kind: 'minor_artifact', baseValue: 25, effect: 'move_speed_bonus', value: 0.1 },
  qi_pendant: { id: 'qi_pendant', name: '聚气玉坠', kind: 'minor_artifact', baseValue: 28, effect: 'cultivation_bonus', value: 0.1 },
  calm_bell: { id: 'calm_bell', name: '宁心铃', kind: 'minor_artifact', baseValue: 22, effect: 'mood_guard', value: 0.1 },
  protective_charm: { id: 'protective_charm', name: '护身符', kind: 'minor_artifact', baseValue: 30, effect: 'explore_loss_reduce', value: 0.2, sensitive: true },
  spirit_compass: { id: 'spirit_compass', name: '寻灵盘', kind: 'minor_artifact', baseValue: 26, effect: 'explore_find_bonus', value: 0.1 },
};

export function itemDef(itemId: string): ItemDef | undefined {
  return ITEM_CATALOG[itemId];
}

// 显示名（未知物回退到 id，绝不抛错——历史库里可能有目录外的裸 id）。
export function itemName(itemId: string): string {
  return ITEM_CATALOG[itemId]?.name ?? itemId;
}

// 基础灵石估值（未知物回退 0，交易/赠礼价值判断用）。
export function itemBaseValue(itemId: string): number {
  return ITEM_CATALOG[itemId]?.baseValue ?? 0;
}

export function isSensitive(itemId: string): boolean {
  return ITEM_CATALOG[itemId]?.sensitive === true;
}
