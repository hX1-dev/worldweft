import { findConversationNeed, planRoutineIntent, homeZone } from './routineLogic';
import type { AgentContext } from './agentLogic';

// World Foundation · W4a/W4b：需求驱动 + 对话纪律 + 本分日程 + 冷却 + skip。

const KNOWN = [
  {
    locationId: 'mountain_gate',
    name: '山门',
    allowedActions: ['cultivate', 'talk', 'spar', 'gift'],
  },
  { locationId: 'market', name: '坊市', allowedActions: ['talk', 'trade', 'gift'] },
];

function ctx(over: Partial<AgentContext> = {}): AgentContext {
  return {
    self: {
      actorId: 'han_li',
      name: '韩立',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 3,
      cultivationXp: 40,
      mood: 1,
      health: 8,
      spirit: 7,
      reputation: 0,
      currentLocationId: 'mountain_gate',
      inventory: [],
    },
    others: [],
    recentEvents: [],
    availableActions: ['cultivate', 'talk', 'gift'],
    knownLocations: KNOWN,
    ...over,
  };
}

describe('findConversationNeed（对话纪律 + 冷却）', () => {
  test('无人在旁 → 无需求', () => {
    expect(findConversationNeed(ctx())).toBeNull();
  });

  test('附近深交（好感≥25）→ 叙旧', () => {
    const c = ctx({
      others: [{ actorId: 'b', name: 'B', realm: 'qi_refining', relationship: 40 }],
    });
    expect(findConversationNeed(c)?.targetActorId).toBe('b');
  });

  test('本游戏日已叙谈过 → 不再触发（冷却）', () => {
    const c = ctx({
      others: [{ actorId: 'b', name: 'B', realm: 'qi_refining', relationship: 40 }],
      recentlyTalked: ['b'],
    });
    expect(findConversationNeed(c)).toBeNull();
  });

  test('委托发起人在场未谈过 → 回报；已谈过则跳过', () => {
    const others = [{ actorId: 'mo', name: '墨长老', realm: 'golden_core', relationship: 5 }];
    const req = [{ type: 'collect_item', issuerActorId: 'mo', summary: '采灵草' }];
    expect(findConversationNeed(ctx({ others, activeRequests: req }))?.targetActorId).toBe('mo');
    expect(
      findConversationNeed(ctx({ others, activeRequests: req, recentlyTalked: ['mo'] })),
    ).toBeNull();
  });

  test('A：远处好友不在 others 里（上层已按地点过滤）→ 不触发 talk', () => {
    // others 只含同地点者；远处好友根本不传进来
    expect(findConversationNeed(ctx({ others: [] }))).toBeNull();
  });
});

describe('planRoutineIntent（本分日程 / skip / defer）', () => {
  test('失能者在归位、对话和本分动作之前直接 skip', () => {
    const c = ctx({
      self: { ...ctx().self, health: 0, currentLocationId: undefined },
      others: [{ actorId: 'b', name: 'B', realm: 'qi_refining', relationship: 40 }],
      activeRequests: [{ type: 'collect_item', issuerActorId: 'b', summary: '采灵草' }],
    });
    expect(planRoutineIntent(c)).toEqual({
      kind: 'skip',
      reason: 'actor_incapacitated',
    });
  });

  test('途中（无 location）→ 回本分之地 travel', () => {
    const c = ctx({ self: { ...ctx().self, currentLocationId: undefined } });
    const d = planRoutineIntent(c);
    expect(d).toMatchObject({ kind: 'act' });
    if (d.kind === 'act')
      expect(d.proposal).toMatchObject({ type: 'travel', targetId: 'mountain_gate' });
  });

  test('有对话需求 → act talk', () => {
    const c = ctx({
      others: [{ actorId: 'b', name: 'B', realm: 'qi_refining', relationship: 40 }],
    });
    const d = planRoutineIntent(c);
    expect(d.kind).toBe('act');
    if (d.kind === 'act') expect(d.proposal.type).toBe('talk');
  });

  test('已在非本分地点 → 先回本分之地', () => {
    const c = ctx({
      self: { ...ctx().self, actorId: 'mo', role: 'elder', currentLocationId: 'secret_realm_gate' },
      knownLocations: [
        ...KNOWN,
        { locationId: 'secret_realm_gate', name: '秘境入口', allowedActions: ['explore'] },
      ],
      availableActions: ['explore'],
    });
    const d = planRoutineIntent(c);
    expect(d).toMatchObject({ kind: 'act' });
    if (d.kind === 'act')
      expect(d.proposal).toMatchObject({ type: 'travel', targetId: 'mountain_gate' });
  });

  test('自由弟子无需求、此地可作为 → defer（交 LLM 添变化）', () => {
    expect(planRoutineIntent(ctx()).kind).toBe('defer');
  });

  test('C：商贩在坊市无客 → skip，不提交 cultivate', () => {
    const c = ctx({
      self: {
        ...ctx().self,
        actorId: 'liu',
        name: '柳巧儿',
        role: 'merchant',
        currentLocationId: 'market',
      },
      availableActions: ['trade', 'gift'], // 商贩在坊市的非社交动作都需目标
    });
    const d = planRoutineIntent(c);
    expect(d).toMatchObject({ kind: 'skip', reason: 'awaiting_customer' });
  });

  test('守卫无事 → skip（on_watch），不乱动', () => {
    const c = ctx({
      self: { ...ctx().self, actorId: 'chen', role: 'guard', currentLocationId: 'alchemy_room' },
      availableActions: ['talk'],
    });
    expect(planRoutineIntent(c)).toMatchObject({ kind: 'skip', reason: 'on_watch' });
  });

  test('长老无事 → 闭关 cultivate', () => {
    const c = ctx({
      self: { ...ctx().self, actorId: 'mo', role: 'elder' },
      availableActions: ['cultivate', 'talk'],
    });
    const d = planRoutineIntent(c);
    expect(d.kind).toBe('act');
    if (d.kind === 'act') expect(d.proposal.type).toBe('cultivate');
  });

  test('长老达到跨境门槛时不被固定修炼遮住，可交给 Agent 选择突破', () => {
    const c = ctx({
      self: {
        ...ctx().self,
        actorId: 'mo',
        role: 'elder',
        realm: 'golden_core',
        realmStage: 3,
        cultivationXp: 999,
      },
      availableActions: ['cultivate', 'breakthrough', 'talk'],
      readyToBreakthrough: true,
    });
    expect(planRoutineIntent(c)).toEqual({ kind: 'defer' });
  });
});

describe('homeZone', () => {
  test('各身份有本分之地', () => {
    expect(homeZone('merchant')).toBe('market');
    expect(homeZone('guard')).toBe('alchemy_room');
    expect(homeZone('outer_disciple')).toBe('mountain_gate');
  });
});
