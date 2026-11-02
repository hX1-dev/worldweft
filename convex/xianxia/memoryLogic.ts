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
  interaction_inspected: 3,
  action_refused: 4, // 被回绝也值得记（影响日后态度）
  request_resolved: 5, // 完成委托（§10.2）
  request_offered: 3,
  request_accepted: 4,
  request_declined: 4,
  // C015c: these production paths already call generateMemories. Keeping them
  // out of the catalog made durable social consequences disappear from actor
  // memory even though their WorldEvents and relationship effects survived.
  negotiation_settled: 5,
  negotiation_rejected: 4,
  group_proposal_opened: 3,
  group_vote_recorded: 3,
  group_commitment_fulfilled: 5,
  group_commitment_breached: 7,
  // C021b0e: ordinary conversation terminals are otherwise intentionally not
  // memorable. A derived, once-only outcome event preserves only the causal
  // result rather than every line of dialogue.
  social_outcome_resolved: 4,
  social_outcome_failed: 4,
  social_outcome_closed: 3,
  combat_attack_resolved: 7,
  combatant_defeated: 8,
  combatant_fled: 5,
  combat_flee_failed: 6,
  combat_loot_completed: 7,
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

export const MAX_ACTIVE_EPISODIC_MEMORIES = 24;
export const MAX_PROMPT_SOCIAL_SUMMARIES = 3;

export type MemoryLifecycle = 'active' | 'archived';

export type CompactionMemory = {
  id: string;
  salience: number;
  createdAt: number;
  expiresAt: number;
  lifecycle?: MemoryLifecycle;
};

export type MemoryCompactionPlan = {
  archiveIds: string[];
  activeIds: string[];
  expiredArchiveCount: number;
  overflowArchiveCount: number;
};

// Existing rows predate lifecycle and are treated as active. Expired memories are
// always archived. If the remaining set is still over capacity, the least salient
// and oldest experiences leave the prompt first; id makes ties replay-stable.
export function planMemoryCompaction(
  memories: CompactionMemory[],
  nowGameHour: number,
  activeCap = MAX_ACTIVE_EPISODIC_MEMORIES,
): MemoryCompactionPlan {
  if (!Number.isFinite(nowGameHour) || nowGameHour < 0) {
    throw new Error('memory_game_hour_invalid');
  }
  if (!Number.isInteger(activeCap) || activeCap < 0) {
    throw new Error('memory_active_cap_invalid');
  }

  const active = memories.filter((memory) => memory.lifecycle !== 'archived');
  const expired = active.filter((memory) => memory.expiresAt <= nowGameHour);
  const unexpired = active.filter((memory) => memory.expiresAt > nowGameHour);
  const overflowCount = Math.max(0, unexpired.length - activeCap);
  const overflow = [...unexpired]
    .sort(
      (left, right) =>
        left.salience - right.salience ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    )
    .slice(0, overflowCount);
  const archiveIds = new Set([...expired, ...overflow].map((memory) => memory.id));
  return {
    archiveIds: [...archiveIds].sort(),
    activeIds: active
      .filter((memory) => !archiveIds.has(memory.id))
      .map((memory) => memory.id)
      .sort(),
    expiredArchiveCount: expired.length,
    overflowArchiveCount: overflow.length,
  };
}

export function primaryMemorySubject(aboutActorIds: string[]): string {
  return [...new Set(aboutActorIds)].sort()[0] ?? '_world';
}

export type SocialSummaryMemory = {
  sourceEventId: string;
  type: string;
  salience: number;
  createdAt: number;
  source?: 'direct' | 'witness' | 'present' | 'rumor';
  distorted?: boolean;
};

export type ExistingSocialSummary = {
  memoryCount: number;
  sourceEventIds: string[];
  eventTypes: string[];
  sourceKinds: Array<'direct' | 'witness' | 'present' | 'rumor'>;
  firstOccurredAt: number;
  lastOccurredAt: number;
  highestSalience: number;
  containsDistortion: boolean;
  revision: number;
};

export type MergedSocialSummary = ExistingSocialSummary & { summary: string };

export function mergeSocialSummary(
  subjectActorId: string,
  existing: ExistingSocialSummary | undefined,
  memories: SocialSummaryMemory[],
): MergedSocialSummary {
  if (memories.length === 0) throw new Error('memory_summary_empty');
  const sourceEventIds = [
    ...new Set([...(existing?.sourceEventIds ?? []), ...memories.map((memory) => memory.sourceEventId)]),
  ].sort();
  const eventTypes = [
    ...new Set([...(existing?.eventTypes ?? []), ...memories.map((memory) => memory.type)]),
  ].sort();
  const sourceKinds = [
    ...new Set([
      ...(existing?.sourceKinds ?? []),
      ...memories.map((memory) => memory.source ?? 'direct'),
    ]),
  ].sort() as ExistingSocialSummary['sourceKinds'];
  const firstOccurredAt = Math.min(
    existing?.firstOccurredAt ?? Number.POSITIVE_INFINITY,
    ...memories.map((memory) => memory.createdAt),
  );
  const lastOccurredAt = Math.max(
    existing?.lastOccurredAt ?? Number.NEGATIVE_INFINITY,
    ...memories.map((memory) => memory.createdAt),
  );
  const memoryCount = (existing?.memoryCount ?? 0) + memories.length;
  const highestSalience = Math.max(
    existing?.highestSalience ?? 0,
    ...memories.map((memory) => memory.salience),
  );
  const containsDistortion =
    (existing?.containsDistortion ?? false) || memories.some((memory) => memory.distorted === true);
  const subject = subjectActorId === '_world' ? '世界与公共事务' : `角色 ${subjectActorId}`;
  const summary = `${subject}相关的 ${memoryCount} 段归档经历；事件=${eventTypes.join('/') || 'unknown'}；来源=${sourceKinds.join('/') || 'direct'}；最高显著度=${highestSalience}`;
  return {
    memoryCount,
    sourceEventIds,
    eventTypes,
    sourceKinds,
    firstOccurredAt,
    lastOccurredAt,
    highestSalience,
    containsDistortion,
    revision: (existing?.revision ?? 0) + 1,
    summary,
  };
}
