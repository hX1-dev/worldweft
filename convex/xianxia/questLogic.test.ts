import {
  REQUEST_INITIAL_REVISION,
  REQUEST_REOFFER_COOLDOWN_GAME_HOURS,
  canSettleQuestForLifeState,
  canTransitionRequest,
  chooseQuestPlan,
  isExpired,
  isQuestPublisherEligible,
  isQuestRecipientEligible,
  isRequirementMet,
  nextRequestRevision,
  requestReofferAllowed,
  requestRevision,
  requestRevisionMatches,
  requestExpiresAtHour,
  requestRequirementReady,
} from './questLogic';

// Stage 2 · M6 + W3b + W4b-D 委托纯逻辑单测：完成条件 / 过期 / 轮换发派 + 任务变化。

describe('request revision 与自动重发冷却', () => {
  test('旧行缺 revision 按 1 读取，并只接受精确 expected revision', () => {
    expect(requestRevision({})).toBe(REQUEST_INITIAL_REVISION);
    expect(nextRequestRevision({})).toBe(2);
    expect(requestRevisionMatches({}, 1)).toBe(true);
    expect(requestRevisionMatches({ revision: 3 }, 2)).toBe(false);
    expect(requestRevisionMatches({ revision: 3 }, 3)).toBe(true);
  });

  test('同一 pair 终态后 24 游戏小时内不得自动重发', () => {
    const terminalAtGameHour = 120;
    expect(requestReofferAllowed(143.999, [{ terminalAtGameHour }])).toBe(false);
    expect(
      requestReofferAllowed(
        terminalAtGameHour + REQUEST_REOFFER_COOLDOWN_GAME_HOURS,
        [{ terminalAtGameHour }],
      ),
    ).toBe(true);
    expect(requestReofferAllowed(121, [{}, { terminalAtGameHour: 80 }])).toBe(true);
  });
});

describe('委托生命状态门禁', () => {
  test('失能长老不发布，失能弟子不领取', () => {
    expect(isQuestPublisherEligible({ role: 'elder', health: 8 })).toBe(true);
    expect(isQuestPublisherEligible({ role: 'elder', health: 0 })).toBe(false);
    expect(isQuestRecipientEligible({ role: 'outer_disciple', health: 8 })).toBe(true);
    expect(isQuestRecipientEligible({ role: 'outer_disciple', health: 0 })).toBe(false);
  });

  test('受托人或仍存在的发起人失能时均不结算', () => {
    expect(canSettleQuestForLifeState({ health: 8 }, { health: 8 })).toBe(true);
    expect(canSettleQuestForLifeState({ health: 0 }, { health: 8 })).toBe(false);
    expect(canSettleQuestForLifeState({ health: 8 }, { health: 0 })).toBe(false);
  });
});

describe('isRequirementMet', () => {
  test('collect_item：持有足量才算完成', () => {
    const a = { inventory: [{ itemId: 'spirit_herb', qty: 2 }] };
    expect(isRequirementMet('collect_item', { itemId: 'spirit_herb', qty: 1 }, a)).toBe(true);
    expect(isRequirementMet('collect_item', { itemId: 'spirit_herb', qty: 3 }, a)).toBe(false);
    expect(isRequirementMet('collect_item', { itemId: 'talisman', qty: 1 }, a)).toBe(false);
  });

  test('explore_location：到达指定地点才算完成', () => {
    expect(
      isRequirementMet(
        'explore_location',
        { locationId: 'secret_realm_gate' },
        { currentLocationId: 'secret_realm_gate' },
      ),
    ).toBe(true);
    expect(
      isRequirementMet(
        'explore_location',
        { locationId: 'secret_realm_gate' },
        { currentLocationId: 'market' },
      ),
    ).toBe(false);
  });

  test('缺参数 / 未知类型 → 未完成', () => {
    expect(isRequirementMet('collect_item', {}, { inventory: [] })).toBe(false);
    // @ts-expect-error 故意传未知类型
    expect(isRequirementMet('unknown', {}, {})).toBe(false);
  });
});

describe('isExpired / requestExpiresAtHour（游戏小时）', () => {
  test('所有非终态委托都可过期，终态不可再次过期', () => {
    expect(isExpired({ status: 'offered', expiresAt: 100 }, 200)).toBe(true);
    expect(isExpired({ status: 'accepted', expiresAt: 100 }, 200)).toBe(true);
    expect(isExpired({ status: 'ready_to_turn_in', expiresAt: 100 }, 200)).toBe(true);
    expect(isExpired({ status: 'offered', expiresAt: 300 }, 200)).toBe(false);
    expect(isExpired({ status: 'completed', expiresAt: 100 }, 200)).toBe(false);
    expect(isExpired({ status: 'declined', expiresAt: 100 }, 200)).toBe(false);
  });

  test('有效期 = 当前游戏小时 + 7 游戏日', () => {
    expect(requestExpiresAtHour(50)).toBe(50 + 7 * 24);
  });
});

describe('显式委托状态机', () => {
  test('只允许 offer→accept/decline、accept→ready、ready→complete 或 collect 回退', () => {
    expect(canTransitionRequest('offered', 'accepted')).toBe(true);
    expect(canTransitionRequest('offered', 'declined')).toBe(true);
    expect(canTransitionRequest('accepted', 'ready_to_turn_in')).toBe(true);
    expect(canTransitionRequest('ready_to_turn_in', 'completed')).toBe(true);
    expect(canTransitionRequest('ready_to_turn_in', 'accepted')).toBe(true);
    expect(canTransitionRequest('offered', 'completed')).toBe(false);
    expect(canTransitionRequest('completed', 'accepted')).toBe(false);
  });

  test('探索到访一旦记录即可回到发起者处交付；采集物必须仍在背包', () => {
    expect(
      requestRequirementReady(
        'explore_location',
        { locationId: 'secret_realm_gate' },
        { currentLocationId: 'sect_hall' },
        123,
      ),
    ).toBe(true);
    expect(
      requestRequirementReady(
        'collect_item',
        { itemId: 'spirit_herb', qty: 1 },
        { inventory: [] },
        123,
      ),
    ).toBe(false);
  });
});

describe('chooseQuestPlan（W4b-D 轮换 + 变化）', () => {
  const three = [
    { actorId: 'han_li', trust: 10 },
    { actorId: 'li_fei', trust: 8 },
    { actorId: 'nan_gong', trust: 6 },
  ];

  test('多名合格弟子时随游戏日轮换，不永远同一人', () => {
    const picks = [0, 1, 2, 3].map((d) => chooseQuestPlan(three, d)?.assigneeActorId);
    expect(new Set(picks).size).toBeGreaterThan(1); // 不是同一人
    expect(picks[0]).toBe(picks[3]); // 周期性、确定
  });

  test('信任不足者被排除；全不达标 → null', () => {
    expect(chooseQuestPlan([{ actorId: 'x', trust: 1 }], 0)).toBeNull();
  });

  test('任务类型按游戏日交替（采药 / 探秘境），且规则可完成', () => {
    expect(chooseQuestPlan(three, 0)?.type).toBe('collect_item');
    expect(chooseQuestPlan(three, 1)?.type).toBe('explore_location');
    expect(chooseQuestPlan(three, 0)?.requirements).toMatchObject({ itemId: 'spirit_herb' });
    expect(chooseQuestPlan(three, 1)?.requirements).toMatchObject({
      locationId: 'secret_realm_gate',
    });
  });
});
