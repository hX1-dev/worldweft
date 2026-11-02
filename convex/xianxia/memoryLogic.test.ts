import {
  isMemorable,
  memorySalience,
  memoryRetentionDays,
  memoryExpiresAtHour,
  isExpired,
  MAX_ACTIVE_EPISODIC_MEMORIES,
  mergeSocialSummary,
  planMemoryCompaction,
  primaryMemorySubject,
} from './memoryLogic';

// Stage 2 · M5 + W3b 短期记忆纯逻辑单测：值不值得记 / 显著度 / 保留时长（游戏日）。

describe('isMemorable / memorySalience', () => {
  test('社会性大事值得记，日常不记', () => {
    expect(isMemorable('steal_resolved')).toBe(true);
    expect(isMemorable('gift_given')).toBe(true);
    expect(isMemorable('trade_completed')).toBe(true);
    expect(isMemorable('cultivation_completed')).toBe(false);
    expect(isMemorable('actor_arrived_location')).toBe(false);
    expect(isMemorable('conversation_started')).toBe(false);
  });

  test('偷取/突破比交易更显著', () => {
    expect(memorySalience('steal_resolved')).toBeGreaterThan(memorySalience('trade_completed'));
    expect(memorySalience('breakthrough_resolved')).toBeGreaterThan(memorySalience('gift_given'));
    expect(memorySalience('cultivation_completed')).toBe(0);
  });

  test('协商、群体承诺和敌对冲突会进入长期社会记忆', () => {
    expect(memorySalience('negotiation_settled')).toBe(5);
    expect(memorySalience('negotiation_rejected')).toBe(4);
    expect(memorySalience('group_vote_recorded')).toBe(3);
    expect(memorySalience('group_commitment_fulfilled')).toBe(5);
    expect(memorySalience('group_commitment_breached')).toBe(7);
    expect(memorySalience('combat_attack_resolved')).toBe(7);
    expect(memorySalience('combatant_defeated')).toBe(8);
    expect(memorySalience('combat_loot_completed')).toBe(7);
  });
});

describe('有界 episodic compaction', () => {
  test('先归档过期，再按低显著度、旧时间和稳定 id 收到 24 条', () => {
    const memories = Array.from({ length: 30 }, (_, index) => ({
      id: `memory-${String(index).padStart(2, '0')}`,
      salience: index < 10 ? 3 : 5,
      createdAt: index,
      expiresAt: index === 29 ? 99 : 200,
    }));
    const plan = planMemoryCompaction(memories, 100);
    expect(plan.expiredArchiveCount).toBe(1);
    expect(plan.overflowArchiveCount).toBe(5);
    expect(plan.activeIds).toHaveLength(MAX_ACTIVE_EPISODIC_MEMORIES);
    expect(plan.archiveIds).toEqual([
      'memory-00',
      'memory-01',
      'memory-02',
      'memory-03',
      'memory-04',
      'memory-29',
    ]);
  });

  test('已 archived 的条目不会二次计入', () => {
    const plan = planMemoryCompaction([
      { id: 'old', salience: 3, createdAt: 1, expiresAt: 2, lifecycle: 'archived' },
      { id: 'current', salience: 4, createdAt: 2, expiresAt: 200 },
    ], 100);
    expect(plan.archiveIds).toEqual([]);
    expect(plan.activeIds).toEqual(['current']);
  });

  test('非法游戏小时稳定拒绝', () => {
    expect(() => planMemoryCompaction([], -1)).toThrow('memory_game_hour_invalid');
  });
});

describe('social summary', () => {
  test('主要对象按 actorId 稳定选择，无对象落到 world', () => {
    expect(primaryMemorySubject(['b', 'a', 'a'])).toBe('a');
    expect(primaryMemorySubject([])).toBe('_world');
  });

  test('合并保留来源、类型、时间、失真与 revision', () => {
    const first = mergeSocialSummary('actor-b', undefined, [{
      sourceEventId: 'event-2',
      type: 'request_declined',
      salience: 4,
      createdAt: 20,
      source: 'direct',
    }]);
    const second = mergeSocialSummary('actor-b', first, [{
      sourceEventId: 'event-1',
      type: 'request_offered',
      salience: 3,
      createdAt: 10,
      source: 'rumor',
      distorted: true,
    }]);
    expect(second.memoryCount).toBe(2);
    expect(second.sourceEventIds).toEqual(['event-1', 'event-2']);
    expect(second.eventTypes).toEqual(['request_declined', 'request_offered']);
    expect(second.sourceKinds).toEqual(['direct', 'rumor']);
    expect(second.firstOccurredAt).toBe(10);
    expect(second.lastOccurredAt).toBe(20);
    expect(second.highestSalience).toBe(4);
    expect(second.containsDistortion).toBe(true);
    expect(second.revision).toBe(2);
    expect(second.summary).toContain('2 段归档经历');
  });
});

describe('保留时长 / 过期判定（W3b 游戏日/游戏小时）', () => {
  const H = 24; // 1 游戏日 = 24 游戏小时

  test('越重大留越久（3/7/14 游戏日）', () => {
    expect(memoryRetentionDays(3)).toBe(3); // 普通
    expect(memoryRetentionDays(5)).toBe(7); // 重要
    expect(memoryRetentionDays(8)).toBe(14); // 重大
  });

  test('过期点 = 当前游戏小时 + 保留游戏日×24', () => {
    expect(memoryExpiresAtHour(100, 8)).toBe(100 + 14 * H);
    expect(memoryExpiresAtHour(100, 3)).toBe(100 + 3 * H);
  });

  test('过期判定（以游戏小时比较）', () => {
    const m = { expiresAt: 100 + 3 * H };
    expect(isExpired(m, 100 + 1 * H)).toBe(false); // 才过 1 游戏日
    expect(isExpired(m, 100 + 4 * H)).toBe(true); // 过了 4 游戏日
  });
});
