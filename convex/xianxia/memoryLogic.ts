// 短期记忆的「纯逻辑层」（Stage 2 · M5）。不依赖 Convex，可被 Jest 直接单测。
//
// 记忆必来自事件（§10.1），不是 LLM 凭空生成。本模块只回答三件事：
//   ① 这桩事值不值得记（§10.2）；② 有多重要(salience)；③ 该留多久(§10.4)。
// 「谁能看见/听说」复用已有的 rumorLogic.propagateEvent（按可见性 + 传闻扩散）。
// 依据：xianxia-world-concept-pack/docs/taixu-stage-2-social-system.md §10。

// 值得记的事件类型 → 显著度。普通修炼/闲聊/到达/无果探索不记（§10.2）。
const SALIENCE: Record<string, number> = {
  steal_resolved: 8,
  breakthrough_resolved: 7,
  spar_resolved: 5,
  teaching_resolved: 5,
  gift_given: 4,
  trade_completed: 3,
  exploration_resolved: 3,
  action_refused: 4, // 被回绝也值得记（影响日后态度）
  request_resolved: 5, // 完成委托（§10.2）
};

export function isMemorable(eventType: string): boolean {
  return eventType in SALIENCE;
}

export function memorySalience(eventType: string): number {
  return SALIENCE[eventType] ?? 0;
}

const HOURS_PER_DAY = 24;

// 保留时长（§10.4）：普通 3 / 重要 7 / 重大 14 —— 单位为**游戏日**（W3b 从真实时间迁到太虚历）。
export function memoryRetentionDays(salience: number): number {
  return salience >= 7 ? 14 : salience >= 4 ? 7 : 3;
}

// 记忆的过期点，以「游戏小时」计：当前游戏小时 + 保留游戏日 × 24。
export function memoryExpiresAtHour(nowGameHour: number, salience: number): number {
  return nowGameHour + memoryRetentionDays(salience) * HOURS_PER_DAY;
}

// 是否已过期。expiresAt 与 nowGameHour 同为「游戏小时」。
export function isExpired(memory: { expiresAt: number }, nowGameHour: number): boolean {
  return memory.expiresAt <= nowGameHour;
}
