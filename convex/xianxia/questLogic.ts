// 轻量委托的「纯逻辑层」（Stage 2 · M6）。不依赖 Convex，可被 Jest 直接单测。
//
// 委托不是完整任务系统，而是 NPC 社会反应的一种（§12）：长老/掌柜据关系派事，
// 完成则改关系、发奖励。本模块只判「是否达成完成条件」，发奖/落库在 quests.ts。
// 第一版只做两类最可由档案快照核实的：collect_item（持有某物）、explore_location（到某地）。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §12。

export type RequestType = 'collect_item' | 'explore_location';

export type Requirements = {
  itemId?: string;
  qty?: number;
  locationId?: string;
};

export type AssigneeSnapshot = {
  inventory?: { itemId: string; qty: number }[];
  currentLocationId?: string;
};

function inventoryHas(inv: AssigneeSnapshot['inventory'], itemId: string, qty: number): boolean {
  const e = (inv ?? []).find((i) => i.itemId === itemId);
  return !!e && e.qty >= qty;
}

// 是否满足委托完成条件（纯判定）。
export function isRequirementMet(
  type: RequestType,
  req: Requirements,
  assignee: AssigneeSnapshot,
): boolean {
  if (type === 'collect_item') {
    return !!req.itemId && inventoryHas(assignee.inventory, req.itemId, req.qty ?? 1);
  }
  if (type === 'explore_location') {
    return !!req.locationId && assignee.currentLocationId === req.locationId;
  }
  return false;
}

// 委托有效期（游戏日，W3b 迁到太虚历）。expiresAt 以「游戏小时」计。
const REQUEST_TTL_GAME_DAYS = 7;
export function requestExpiresAtHour(nowGameHour: number): number {
  return nowGameHour + REQUEST_TTL_GAME_DAYS * 24;
}

// 是否已过期。expiresAt 与 nowGameHour 同为「游戏小时」。
export function isExpired(req: { expiresAt: number; status: string }, nowGameHour: number): boolean {
  return req.status === 'offered' && req.expiresAt <= nowGameHour;
}

// W4b-D：在合格弟子中确定性地轮换发派，并让任务类型有变化——不再永远同一人采灵草。
// eligible 已由上层剔除「已有 active request」者；这里只负责挑人 + 选任务。
const MIN_TRUST_TO_ASSIGN = 3;
export type QuestPlan = { assigneeActorId: string; type: RequestType; requirements: Requirements };

export function chooseQuestPlan(
  eligible: { actorId: string; trust: number }[],
  gameDay: number,
): QuestPlan | null {
  // 信任达标者，按 actorId 稳定排序后用游戏日轮换（确定性、可测、不长期偏袒一人）。
  const ok = eligible
    .filter((e) => e.trust >= MIN_TRUST_TO_ASSIGN)
    .sort((a, b) => (a.actorId < b.actorId ? -1 : a.actorId > b.actorId ? 1 : 0));
  if (ok.length === 0) return null;
  const assigneeActorId = ok[((gameDay % ok.length) + ok.length) % ok.length].actorId;

  // 任务类型按游戏日交替（采药 / 探秘境），都从现有地点/物品能力出发、规则可完成。
  const type: RequestType = gameDay % 2 === 0 ? 'collect_item' : 'explore_location';
  const requirements: Requirements =
    type === 'collect_item' ? { itemId: 'spirit_herb', qty: 1 } : { locationId: 'secret_realm_gate' };
  return { assigneeActorId, type, requirements };
}
