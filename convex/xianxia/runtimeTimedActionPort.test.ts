import {
  admitAttack,
  admitFlee,
  admitLoot,
  admitTradeEnvelope,
  admitGiftEnvelope,
  admitRequestTeachingEnvelope,
  admitSpar,
  admitStealEnvelope,
  admitUseItem,
  admitBreakthrough,
  admitExplore,
  admitTimedAction,
  completedActionResultCode,
  prepareTimedActionSettlement,
  receiptForTimedActionSettlement,
  timedActionIdempotencyKey,
} from './runtimeTimedActionPort';

const base = {
  source: 'action_execution',
  actionType: 'gather',
  executionStatus: 'acting' as const,
  reportedStatus: 'completed',
  executionId: 'execution:1',
  actionRecordId: 'action:1',
  actorId: 'actor:1',
  executorId: 'godot:1',
  revision: 4,
  idempotencyKey: timedActionIdempotencyKey('execution:1', 4),
};

describe('TimedActionExecutionPort', () => {
  test('admits only a current, co-located attack target without settling combat', () => {
    expect(admitAttack({
      actorId: 'actor:1', targetActorId: 'actor:2', target: { name: '敌手' },
      attackAllowed: true, sameLocation: true,
    })).toEqual({ ok: true });
    expect(admitAttack({
      actorId: 'actor:1', targetActorId: 'actor:2', target: { name: '敌手' },
      attackAllowed: true, sameLocation: false,
    })).toMatchObject({ ok: false, result: { resultCode: 'target_not_present', effects: {} } });
  });

  test('keeps flee bound to the current encounter opponent', () => {
    expect(admitFlee({ hasEncounter: false, sameLocation: false })).toMatchObject({ ok: false, result: { resultCode: 'flee_not_in_combat' } });
    expect(admitFlee({ hasEncounter: true, opponent: { actorId: 'actor:2', name: '敌手' }, sameLocation: true })).toEqual({ ok: true, opponent: { actorId: 'actor:2', name: '敌手' } });
  });

  test('admits loot only from an unprotected defeated target and never transfers it', () => {
    expect(admitLoot({
      actorId: 'actor:1', targetActorId: 'actor:2', itemId: 'spirit_herb',
      target: { name: '敌手', incapacitated: true }, sameLocation: true,
      defeatEncounterId: 'combat:1', priorityAllowed: false, itemAvailable: true,
    })).toMatchObject({ ok: false, result: { resultCode: 'loot_protected' } });
    expect(admitLoot({
      actorId: 'actor:1', targetActorId: 'actor:2', itemId: 'spirit_herb',
      target: { name: '敌手', incapacitated: true }, sameLocation: true,
      defeatEncounterId: 'combat:1', priorityAllowed: true, itemAvailable: true,
    })).toMatchObject({ ok: true, encounterId: 'combat:1', itemId: 'spirit_herb' });
  });

  test('keeps trade admission separate from price and transfer settlement', () => {
    expect(admitTradeEnvelope({
      actorId: 'actor:1', targetActorId: 'actor:1', offeredItemId: 'spirit_stone',
      requestedItemId: 'spirit_herb', locationAllowsTrade: true,
    })).toMatchObject({ ok: false, result: { resultCode: 'trade_self_target' } });
    expect(admitTradeEnvelope({
      actorId: 'actor:1', targetActorId: 'actor:2', offeredItemId: 'spirit_stone',
      requestedItemId: 'spirit_herb', locationAllowsTrade: true,
    })).toEqual({ ok: true });
  });

  test('keeps gift admission source-free until the execution terminal', () => {
    expect(admitGiftEnvelope({ actorId: 'actor:1', actorName: '青岚', targetActorId: 'actor:2', itemId: 'spirit_herb', locationAllowsGift: true, owned: 0, unreserved: 0 })).toMatchObject({ ok: false, result: { resultCode: 'item_not_owned', reason: '青岚并无「spirit_herb」，无以为赠。' } });
    expect(admitGiftEnvelope({ actorId: 'actor:1', targetActorId: 'actor:2', itemId: 'spirit_herb', locationAllowsGift: true, owned: 1, unreserved: 0 })).toMatchObject({ ok: false, result: { resultCode: 'gift_item_reserved' } });
    expect(admitGiftEnvelope({ actorId: 'actor:1', targetActorId: 'actor:2', itemId: 'spirit_herb', locationAllowsGift: true, owned: 1, unreserved: 1 })).toEqual({ ok: true, itemId: 'spirit_herb' });
  });

  test('keeps request-teaching admission source-free until the execution terminal', () => {
    expect(admitRequestTeachingEnvelope({ actorId: 'actor:1', targetActorId: 'actor:1', teachingTopic: 'cultivation_fundamentals', locationAllowsTeaching: true })).toMatchObject({ ok: false, result: { resultCode: 'teaching_self_target' } });
    expect(admitRequestTeachingEnvelope({ actorId: 'actor:1', targetActorId: 'actor:2', teachingTopic: 'cultivation_fundamentals', locationAllowsTeaching: true, cooldownFailure: { resultCode: 'teaching_daily_cooldown', reason: '冷却' } })).toMatchObject({ ok: false, result: { resultCode: 'teaching_daily_cooldown' } });
    expect(admitRequestTeachingEnvelope({ actorId: 'actor:1', targetActorId: 'actor:2', teachingTopic: 'cultivation_fundamentals', locationAllowsTeaching: true })).toEqual({ ok: true, teachingTopic: 'cultivation_fundamentals' });
  });

  test('keeps spar admission separate from combat resolution', () => {
    const rejected = { status: 'rejected' as const, resultCode: 'master_not_qualified', reason: '境界不足', effects: {}, eventType: 'action_rejected' as const, visibility: 'local' as const };
    expect(admitSpar({ candidate: rejected })).toEqual({ ok: false, result: rejected });
    expect(admitSpar({ candidate: { ...rejected, status: 'applied', resultCode: 'spar_started' } })).toEqual({ ok: true });
  });

  test('keeps steal admission separate from transfer and adjudication', () => {
    expect(admitStealEnvelope({ locationPresent: true, targetName: '敌手', targetHasItem: true })).toMatchObject({ ok: false, result: { resultCode: 'missing_param' } });
    expect(admitStealEnvelope({ itemId: 'spirit_herb', locationPresent: true, targetName: '敌手', targetHasItem: false })).toMatchObject({ ok: false, result: { resultCode: 'target_lacks_item' } });
    expect(admitStealEnvelope({ itemId: 'spirit_herb', locationPresent: true, targetName: '敌手', targetHasItem: true })).toEqual({ ok: true, itemId: 'spirit_herb' });
  });

  test('keeps personal progress admission separate from item and breakthrough settlement', () => {
    expect(admitUseItem({ targetActorId: 'actor:2', itemId: 'healing_pill' })).toMatchObject({ ok: false, result: { resultCode: 'use_item_self_only' } });
    expect(admitUseItem({ itemId: 'healing_pill' })).toEqual({ ok: true, itemId: 'healing_pill' });
    expect(admitBreakthrough({ recoveryFailure: { resultCode: 'breakthrough_recovery_active', reason: '恢复中' }, candidate: { status: 'applied', resultCode: 'x', reason: 'x', effects: {}, eventType: 'x', visibility: 'local' } })).toMatchObject({ ok: false, result: { resultCode: 'breakthrough_recovery_active' } });
  });

  test('keeps the ordinary explore candidate source byte-for-byte intact and fails closed without a location', () => {
    const candidate = {
      status: 'applied' as const,
      resultCode: 'exploration_resource',
      reason: '寻得见闻。',
      effects: { cultivationXp: 7, mood: 1 },
      eventType: 'exploration_resolved',
      visibility: 'local' as const,
    };
    expect(admitExplore({ locationKnown: true, candidate })).toBe(candidate);
    expect(admitExplore({ locationKnown: false, candidate })).toMatchObject({
      status: 'rejected', resultCode: 'unknown_location', effects: {},
    });
  });

  test('admits timed actions from latest facts without settling their effects', () => {
    const admitted = admitTimedAction({
      actionType: 'cultivate',
      profileName: '青岚',
      profileMapId: 'world',
      candidate: { status: 'applied', resultCode: 'cultivate_ready', reason: 'ready', effects: {}, eventType: 'ignored', visibility: 'local' },
      location: { locationId: 'cave', name: '静室' },
      cultivationMode: 'ambient',
      resourceAvailable: true,
    });
    expect(admitted).toMatchObject({
      result: { status: 'applied', resultCode: 'action_execution_started', effects: {} },
      execution: { actionType: 'cultivate', locationId: 'cave', durationMs: 8_000 },
    });
  });

  test('rejects stale gather facts before it can create a second reservation', () => {
    const rejected = admitTimedAction({
      actionType: 'gather',
      profileName: '青岚',
      profileMapId: 'world',
      resourceNodeId: 'herb:1',
      location: { locationId: 'grove', allowsGather: true },
      resourceNode: { name: '灵草丛', mapId: 'world', locationId: 'grove' },
      accessAllowed: true,
      withinGodotRange: true,
      stock: 1,
      availableStock: 0,
    });
    expect(rejected).toMatchObject({ result: { status: 'rejected', resultCode: 'resource_fully_reserved' } });
    expect(rejected.execution).toBeUndefined();
  });

  test('keeps old non-terminal and replay reports result-free until a completed result is present', () => {
    type LegacyReport =
      | { ok: false; code: string }
      | { ok: true; execution: { status: 'acting' } }
      | { ok: true; execution: { status: 'completed' }; result?: undefined }
      | { ok: true; execution: { status: 'completed' }; result: { resultCode: string } };
    const reports: LegacyReport[] = [
      { ok: false, code: 'execution_not_found' },
      { ok: true, execution: { status: 'acting' } },
      { ok: true, execution: { status: 'completed' } },
      { ok: true, execution: { status: 'completed' }, result: { resultCode: 'trade_completed' } },
    ];
    expect(reports.map(completedActionResultCode)).toEqual([
      undefined,
      undefined,
      undefined,
      'trade_completed',
    ]);
  });

  test('completed is a source-bound settlement request, not an applied outcome', () => {
    const prepared = prepareTimedActionSettlement(base);
    expect(prepared).toEqual({ ok: true, request: expect.objectContaining({ actionType: 'gather', revision: 4 }) });
    if (!prepared.ok) throw new Error('expected request');
    const receipt = receiptForTimedActionSettlement({
      request: prepared.request,
      executionTerminal: 'completed',
      result: { status: 'interrupted', resultCode: 'resource_changed', reason: 'changed', effects: {}, eventType: 'action_execution_interrupted', visibility: 'local' },
      idempotentReplay: false,
    });
    expect(receipt).toMatchObject({ executionTerminal: 'completed', domainOutcome: 'failed', idempotentReplay: false });
  });

  test.each([
    ['wrong source', { source: 'executor' }, 'timed_action_source_invalid'],
    ['wrong revision', { revision: 0 }, 'timed_action_revision_invalid'],
    ['wrong key', { idempotencyKey: 'forged' }, 'timed_action_idempotency_invalid'],
    ['nonterminal report', { reportedStatus: 'acting' }, 'timed_action_not_ready'],
    ['terminal execution', { executionStatus: 'completed' }, 'timed_action_not_ready'],
  ])('%s fails closed', (_label, override, reasonCode) => {
    expect(prepareTimedActionSettlement({ ...base, ...override })).toEqual({ ok: false, reasonCode });
  });

  test('replay and restart retain the same receipt identity without granting a second effect', () => {
    const prepared = prepareTimedActionSettlement(base);
    if (!prepared.ok) throw new Error('expected request');
    const result = { status: 'applied' as const, resultCode: 'gather_completed', reason: 'done', effects: { items: [{ to: 'actor:1', itemId: 'spirit_herb', qty: 1 }] }, eventType: 'gather_completed', visibility: 'local' as const };
    const first = receiptForTimedActionSettlement({ request: prepared.request, executionTerminal: 'completed', result, idempotentReplay: false });
    const replay = receiptForTimedActionSettlement({ request: prepared.request, executionTerminal: 'completed', result, idempotentReplay: true });
    expect(replay.receiptKey).toBe(first.receiptKey);
    expect(replay).toMatchObject({ domainOutcome: 'applied', idempotentReplay: true });
  });

  test('preserves rejected and no-effect as Domain Writer outcomes', () => {
    const prepared = prepareTimedActionSettlement({ ...base, actionType: 'rest' });
    if (!prepared.ok) throw new Error('expected request');
    expect(receiptForTimedActionSettlement({
      request: prepared.request,
      executionTerminal: 'blocked',
      result: { status: 'rejected', resultCode: 'resource_forbidden', reason: 'no', effects: {}, eventType: 'blocked', visibility: 'local' },
      idempotentReplay: false,
    }).domainOutcome).toBe('rejected');
    expect(receiptForTimedActionSettlement({
      request: prepared.request,
      executionTerminal: 'completed',
      result: { status: 'applied', resultCode: 'rest_completed', reason: 'already rested', effects: { fatigue: 0 }, eventType: 'rest_completed', visibility: 'local' },
      idempotentReplay: false,
    }).domainOutcome).toBe('no_effect');
  });
});
