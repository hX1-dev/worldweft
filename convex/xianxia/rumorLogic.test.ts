import { propagateEvent, eventSalience } from './rumorLogic';
import type { RumorActor, RumorEvent } from './rumorLogic';

// M8 传闻传播纯逻辑单测。覆盖五种可见性 + 道听途说的确定性扩散与走样。
// 依据：docs/xianxia-phase-two-plan.md M8、blueprint §12.4。

// 一个小世界：韩立在丹房偷丹，守卫在场，长老在山门，散修在坊市。
const actors: RumorActor[] = [
  { actorId: 'npc_hanli', currentLocationId: 'alchemy_room', reputation: -30 },
  { actorId: 'guard_1', currentLocationId: 'alchemy_room', reputation: 10 },
  { actorId: 'elder_1', currentLocationId: 'mountain_gate', reputation: 60 },
  { actorId: 'rogue_1', currentLocationId: 'market', reputation: 0 },
];

function baseEvent(overrides: Partial<RumorEvent>): RumorEvent {
  return {
    eventId: 'event_steal_001',
    type: 'steal_resolved',
    visibility: 'local',
    actorIds: ['npc_hanli'],
    locationId: 'alchemy_room',
    summary: '韩立潜入丹房，盗走筑基丹。',
    ...overrides,
  };
}

const know = (ds: ReturnType<typeof propagateEvent>) => new Set(ds.map((d) => d.actorId));

describe('propagateEvent — 可见性', () => {
  test('private：只有当事人知道', () => {
    const ds = propagateEvent(baseEvent({ visibility: 'private' }), actors);
    expect(know(ds)).toEqual(new Set(['npc_hanli']));
    expect(ds[0]).toMatchObject({ source: 'direct', distorted: false });
  });

  test('witnessed：当事人 + 明确目击者，皆未走样', () => {
    const ds = propagateEvent(
      baseEvent({ visibility: 'witnessed', witnessActorIds: ['guard_1'] }),
      actors,
    );
    expect(know(ds)).toEqual(new Set(['npc_hanli', 'guard_1']));
    expect(ds.find((d) => d.actorId === 'guard_1')).toMatchObject({
      source: 'witness',
      distorted: false,
    });
    // 不在场的长老/散修不应知道
    expect(know(ds).has('elder_1')).toBe(false);
  });

  test('local：同地点在场者知道，外地者不知道', () => {
    const ds = propagateEvent(baseEvent({ visibility: 'local' }), actors);
    expect(know(ds)).toEqual(new Set(['npc_hanli', 'guard_1']));
    expect(ds.find((d) => d.actorId === 'guard_1')?.source).toBe('present');
  });

  test('public：所有人皆知', () => {
    const ds = propagateEvent(baseEvent({ visibility: 'public' }), actors);
    expect(know(ds)).toEqual(new Set(['npc_hanli', 'guard_1', 'elder_1', 'rogue_1']));
    expect(ds.every((d) => !d.distorted)).toBe(true);
  });
});

describe('propagateEvent — rumor 扩散', () => {
  test('种子知情者（在场/目击）未走样，其余人按概率二手获知', () => {
    const ds = propagateEvent(
      baseEvent({ visibility: 'rumor', witnessActorIds: ['guard_1'] }),
      actors,
    );
    // 当事人 + 目击守卫一定是一手、未走样
    expect(ds.find((d) => d.actorId === 'npc_hanli')).toMatchObject({ source: 'direct' });
    expect(ds.find((d) => d.actorId === 'guard_1')).toMatchObject({
      source: 'witness',
      distorted: false,
    });
    // 偷窃显著度高，远处的人有机会道听途说
    const secondhand = ds.filter((d) => d.source === 'rumor');
    expect(secondhand.length).toBeGreaterThan(0);
    for (const d of secondhand) {
      // 走样者带「据传」前缀，未走样者保留原文
      if (d.distorted) expect(d.summary.startsWith('据传，')).toBe(true);
      else expect(d.summary).toBe('韩立潜入丹房，盗走筑基丹。');
    }
  });

  test('确定性：同一事件两次传播结果完全一致', () => {
    const e = baseEvent({ visibility: 'rumor' });
    expect(propagateEvent(e, actors)).toEqual(propagateEvent(e, actors));
  });

  test('低显著度日常事件扩散更窄', () => {
    const gossip = propagateEvent(
      baseEvent({ eventId: 'e_talk', type: 'conversation_started', visibility: 'rumor' }),
      actors,
    );
    const juicy = propagateEvent(baseEvent({ visibility: 'rumor' }), actors);
    expect(know(gossip).size).toBeLessThanOrEqual(know(juicy).size);
  });
});

describe('eventSalience', () => {
  test('偷窃/突破比日常交谈更值得传', () => {
    expect(eventSalience('steal_resolved')).toBeGreaterThan(eventSalience('conversation_started'));
    expect(eventSalience('breakthrough_resolved')).toBeGreaterThan(eventSalience('trade_completed'));
  });
});
