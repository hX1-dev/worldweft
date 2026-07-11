// NPC 行为白名单（Stage 2 · M1 §2.3）的「纯逻辑层」。
// 不依赖 Convex，可被 Jest 直接单测；接线在 agent.ts（少提案）与 actions.ts（硬校验）。
//
// 目的：让固定 NPC（掌柜/守卫/执事）和长老不再像通用弟子那样到处探索/偷取/切磋——
// 只能发起本职允许的动作。更复杂的「社会性拒绝」（trust/suspicion/黑名单 → 结构化拒绝）
// 留给 M3 拒绝系统（依赖 M2 多维关系）。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §2.3、
//       taixu-world-setting.md §11（NPC 行动白名单）。

// 弟子全套：第一阶段实建的 8 动作 + 突破。自由 Agent 也用这套。
const DISCIPLE_KIT = [
  'cultivate',
  'talk',
  'trade',
  'gift',
  'explore',
  'request_teaching',
  'spar',
  'steal',
  'breakthrough',
];

// role → 可「发起」的动作白名单（被动承受的动作如被求教/被赠礼不在此列）。
// 固定 NPC 主要是世界功能角色：掌柜管交易、守卫管秩序、执事管赏罚、长老受求教。
export const ROLE_ACTIONS: Record<string, string[]> = {
  elder: ['cultivate', 'talk', 'gift', 'breakthrough'],
  steward: ['cultivate', 'talk', 'gift'],
  guard: ['cultivate', 'talk'],
  merchant: ['talk', 'trade', 'gift'],
  outer_disciple: DISCIPLE_KIT,
  inner_disciple: DISCIPLE_KIT,
  sword_disciple: DISCIPLE_KIT,
};

// 未知 role 回退到弟子全套（保守：宁可放行，也不要因 role 漏配把角色卡死）。
export function allowedActionsForRole(role: string): string[] {
  return ROLE_ACTIONS[role] ?? DISCIPLE_KIT;
}

export function roleAllows(role: string, actionType: string): boolean {
  return allowedActionsForRole(role).includes(actionType);
}
