import {
  clamp,
  realmRank,
  resolveBreakthrough,
  resolveCultivate,
  resolveExplore,
  resolveGift,
  resolveRequestTeaching,
  resolveSpar,
  resolveSteal,
  resolveTalk,
  resolveTrade,
  seededRoll,
  type ActorSnapshot,
  type LocationSnapshot,
} from './rules';
import { phaseModifiers } from './timeLogic';

const actor: ActorSnapshot = {
  actorId: 'test_cultivator',
  name: '测试散修',
  realm: 'qi_refining',
  realmStage: 1,
  cultivationXp: 0,
  mood: 0,
  health: 8,
  spirit: 7,
  reputation: 0,
  currentLocationId: 'mountain_gate',
  inventory: [{ itemId: 'healing_pill', qty: 1 }],
};

const peer: ActorSnapshot = { ...actor, actorId: 'peer', name: '同门', inventory: [] };
const master: ActorSnapshot = { ...actor, actorId: 'elder', name: '长老', realm: 'golden_core', inventory: [] };
const merchant: ActorSnapshot = {
  ...actor,
  actorId: 'merchant',
  name: '商贩',
  inventory: [{ itemId: 'talisman', qty: 1 }],
};

const mountainGate: LocationSnapshot = {
  locationId: 'mountain_gate',
  name: '山门',
  kind: 'mountain_gate',
  dangerLevel: 0,
  spiritualEnergy: 3,
  allowedActions: ['cultivate', 'talk', 'request_teaching', 'spar'],
};
const secretGate: LocationSnapshot = {
  ...mountainGate,
  locationId: 'secret_realm_gate',
  name: '秘境入口',
  kind: 'secret_realm_gate',
  dangerLevel: 3,
  allowedActions: ['explore', 'steal'],
};

describe('resolveCultivate', () => {
  it('普通成功：base+灵气+掷点', () => {
    const r = resolveCultivate({ actor, location: mountainGate, roll: 0.5 });
    expect(r.status).toBe('applied');
    expect(r.resultCode).toBe('cultivation_success');
    expect(r.effects.cultivationXp).toBe(10); // 5 + 3 + floor(0.5*4)=2
  });
  it('地点不允许 → 拒绝', () => {
    const market: LocationSnapshot = { ...mountainGate, allowedActions: ['trade'] };
    expect(resolveCultivate({ actor, location: market, roll: 0.5 }).resultCode).toBe('location_forbids_cultivate');
  });
  it('心境过低 → 拒绝', () => {
    expect(resolveCultivate({ actor: { ...actor, mood: -3 }, location: mountainGate, roll: 0.5 }).resultCode).toBe('mood_too_low');
  });
  it('顿悟 / 走火入魔', () => {
    expect(resolveCultivate({ actor, location: mountainGate, roll: 0.97 }).resultCode).toBe('cultivation_breakthrough_insight');
    expect(resolveCultivate({ actor, location: mountainGate, roll: 0.01 }).resultCode).toBe('cultivation_deviation');
  });
});

describe('resolveBreakthrough', () => {
  const ready = { ...actor, cultivationXp: 100, mood: 0 }; // 练气1（境内），阈值 = 55
  const peak = { ...actor, realm: 'qi_refining', realmStage: 9, cultivationXp: 999 }; // 练气9（跨境大关）

  it('修为不足 → 拒绝', () => {
    const r = resolveBreakthrough({ actor: { ...actor, cultivationXp: 10 }, location: mountainGate, roll: 0.1, mishapRoll: 0.9 });
    expect(r.resultCode).toBe('insufficient_cultivation');
  });
  it('境内升层：一路直达，高 roll 也成功、不伤身，local 可见', () => {
    const r = resolveBreakthrough({ actor: ready, location: mountainGate, roll: 0.99, mishapRoll: 0.99 });
    expect(r.resultCode).toBe('breakthrough_success');
    expect(r.effects.realmChange).toEqual({ realm: 'qi_refining', realmStage: 2, cultivationXp: 45 });
    expect(r.effects.health).toBeUndefined(); // 境内升层不伤气血
    expect(r.visibility).toBe('local');
  });
  it('跨境大关成功：练气9 → 筑基，public 可见', () => {
    const r = resolveBreakthrough({ actor: peak, location: mountainGate, roll: 0.01, mishapRoll: 0.9 });
    expect(r.resultCode).toBe('breakthrough_success');
    expect(r.effects.realmChange?.realm).toBe('foundation_building');
    expect(r.effects.realmChange?.realmStage).toBe(1);
    expect(r.visibility).toBe('public');
  });
  it('跨境失败：掉修为、伤身（仅大关才有）', () => {
    const r = resolveBreakthrough({ actor: peak, location: mountainGate, roll: 0.99, mishapRoll: 0.9 });
    expect(r.resultCode).toBe('breakthrough_failed');
    expect(r.effects.cultivationXp).toBeLessThan(0);
  });
  it('跨境走火入魔（失败且 mishap 低）：重伤', () => {
    const r = resolveBreakthrough({ actor: peak, location: mountainGate, roll: 0.99, mishapRoll: 0.1 });
    expect(r.resultCode).toBe('breakthrough_deviation');
    expect(r.effects.health).toBe(-3);
  });
});

describe('resolveTalk', () => {
  it('关系过差 → 拒绝', () => {
    expect(resolveTalk({ actor, target: peer, relationship: -60, roll: 0.5 }).resultCode).toBe('relationship_too_hostile');
  });
  it('相谈尚欢：关系+2', () => {
    const r = resolveTalk({ actor, target: peer, relationship: 0, roll: 0.5 });
    expect(r.status).toBe('applied');
    expect(r.effects.relationships).toEqual([{ targetActorId: 'peer', delta: 2 }]);
  });
  it('冷场（roll<0.2）：无关系变化', () => {
    const r = resolveTalk({ actor, target: peer, relationship: 0, roll: 0.1 });
    expect(r.effects.relationships).toEqual([]);
  });
});

describe('resolveSpar', () => {
  it('境界差距过大 → 拒绝', () => {
    expect(resolveSpar({ actor, target: master, relationship: 0, roll: 0.5 }).resultCode).toBe('realm_gap_too_large');
  });
  it('胜（高掷点）/ 负（低掷点）/ 平（中）', () => {
    expect(resolveSpar({ actor, target: peer, relationship: 0, roll: 0.9 }).resultCode).toBe('spar_actor_win');
    expect(resolveSpar({ actor, target: peer, relationship: 0, roll: 0.1 }).resultCode).toBe('spar_actor_lose');
    expect(resolveSpar({ actor, target: peer, relationship: 0, roll: 0.5 }).resultCode).toBe('spar_draw');
  });
  it('胜：声望+3，public 可见', () => {
    const r = resolveSpar({ actor, target: peer, relationship: 0, roll: 0.9 });
    expect(r.effects.reputation).toBe(3);
    expect(r.visibility).toBe('public');
  });
});

describe('resolveExplore', () => {
  it('地点不允许 → 拒绝', () => {
    expect(resolveExplore({ actor, location: mountainGate, roll: 0.9 }).resultCode).toBe('location_forbids_explore');
  });
  it('危险 / 无事 / 传闻 / 机缘', () => {
    expect(resolveExplore({ actor, location: secretGate, roll: 0.05 }).resultCode).toBe('exploration_danger');
    expect(resolveExplore({ actor, location: secretGate, roll: 0.3 }).resultCode).toBe('exploration_nothing');
    expect(resolveExplore({ actor, location: secretGate, roll: 0.6 }).resultCode).toBe('exploration_rumor');
    const lucky = resolveExplore({ actor, location: secretGate, roll: 0.9 });
    expect(lucky.resultCode).toBe('exploration_resource');
    expect(lucky.effects.items).toEqual([{ to: 'test_cultivator', itemId: 'spirit_herb', qty: 1 }]);
  });
});

describe('resolveRequestTeaching', () => {
  it('师长境界不足 → 拒绝', () => {
    expect(resolveRequestTeaching({ actor, master: peer, relationship: 50, roll: 0.5 }).resultCode).toBe('master_not_qualified');
  });
  it('无交情 → 拒绝', () => {
    expect(resolveRequestTeaching({ actor, master, relationship: -1, roll: 0.5 }).resultCode).toBe('relationship_insufficient');
  });
  it('成功传授：得修为，关系+5', () => {
    const r = resolveRequestTeaching({ actor, master, relationship: 10, roll: 0.5 });
    expect(r.resultCode).toBe('teaching_granted');
    expect(r.effects.cultivationXp).toBe(12); // 8 + rank(golden_core=2)*2
    expect(r.effects.relationships).toEqual([{ targetActorId: 'elder', delta: 5 }]);
  });
  it('被婉拒（roll<0.25）', () => {
    expect(resolveRequestTeaching({ actor, master, relationship: 10, roll: 0.1 }).resultCode).toBe('teaching_refused');
  });
});

describe('resolveGift', () => {
  it('无此物 → 拒绝', () => {
    expect(resolveGift({ actor, target: peer, itemId: 'no_such', relationship: 0, roll: 0.5 }).resultCode).toBe('item_not_owned');
  });
  it('接受：物品转移；关系方向交由 relationshipEffectFor（受礼者→送礼者）', () => {
    const r = resolveGift({ actor, target: peer, itemId: 'healing_pill', relationship: 0, roll: 0.5 });
    expect(r.resultCode).toBe('gift_accepted');
    // W4b-E：resolveGift 不再写「送礼者→受礼者」的好感（方向不自然）。
    expect(r.effects.relationships).toBeUndefined();
    expect(r.effects.items).toEqual([{ from: 'test_cultivator', to: 'peer', itemId: 'healing_pill', qty: 1 }]);
  });
  it('敌对者拒收：无转移', () => {
    const r = resolveGift({ actor, target: peer, itemId: 'healing_pill', relationship: -70, roll: 0.1 });
    expect(r.resultCode).toBe('gift_rejected');
    expect(r.effects.items).toBeUndefined();
  });
});

describe('昼夜修正（W3a）', () => {
  const dawn = phaseModifiers('dawn');
  const night = phaseModifiers('night');

  it('清晨修炼比中性多得修为', () => {
    const base = resolveCultivate({ actor, location: mountainGate, roll: 0.5 });
    const atDawn = resolveCultivate({ actor, location: mountainGate, roll: 0.5, phaseMods: dawn });
    expect(atDawn.effects.cultivationXp!).toBeGreaterThan(base.effects.cultivationXp!);
  });

  it('夜探更险：同一掷点，白天无事、夜里遇险', () => {
    // roll=0.15：中性危险阈 0.1（不触发）→ 无事；夜里阈 0.2（触发）→ 遇险
    expect(resolveExplore({ actor, location: secretGate, roll: 0.15 }).resultCode).toBe('exploration_nothing');
    expect(resolveExplore({ actor, location: secretGate, roll: 0.15, phaseMods: night }).resultCode).toBe(
      'exploration_danger',
    );
  });

  it('夜色更隐蔽：同一掷点，白天败露、夜里未被发觉', () => {
    const thief = { ...actor, actorId: 'thief', name: '夜行人', spirit: 5 };
    const mark = { ...merchant, spirit: 9 };
    const args = { actor: thief, target: mark, location: secretGate, itemId: 'talisman', roll: 0.5 };
    // detectionRoll=0.4：中性 0.4<0.5 被发现；夜里阈 0.35，0.4 不再被发现
    expect(resolveSteal({ ...args, detectionRoll: 0.4 }).resultCode).toBe('steal_failed_detected');
    expect(resolveSteal({ ...args, detectionRoll: 0.4, phaseMods: night }).resultCode).toBe(
      'steal_failed_undetected',
    );
  });

  it('夜里被抓惩罚更重', () => {
    const thief = { ...actor, actorId: 'thief', name: '夜行人', spirit: 5 };
    const mark = { ...merchant, spirit: 9 };
    const args = { actor: thief, target: mark, location: secretGate, itemId: 'talisman', roll: 0.5, detectionRoll: 0.2 };
    const day = resolveSteal(args); // 都被发现（0.2<0.35）
    const nite = resolveSteal({ ...args, phaseMods: night });
    expect(day.resultCode).toBe('steal_failed_detected');
    expect(nite.resultCode).toBe('steal_failed_detected');
    expect(nite.effects.reputation!).toBeLessThan(day.effects.reputation!);
  });
});

describe('resolveTrade（M4 价格）', () => {
  const sv = (o: Partial<{ affinity: number; trust: number; suspicion: number; tags: string[] }> = {}) => ({
    affinity: 0,
    trust: 0,
    suspicion: 0,
    ...o,
  });
  // talisman base 12 / spirit_herb base 8 / healing_pill base 10。
  const shop: ActorSnapshot = {
    ...merchant,
    inventory: [
      { itemId: 'talisman', qty: 1 },
      { itemId: 'spirit_herb', qty: 3 },
    ],
  };
  const buyer: ActorSnapshot = {
    ...actor,
    inventory: [
      { itemId: 'healing_pill', qty: 1 },
      { itemId: 'spirit_stone', qty: 50 },
    ],
  };

  it('一方无货 → 拒绝', () => {
    expect(resolveTrade({ actor: buyer, target: shop, offeredItemId: 'gold', requestedItemId: 'talisman', sellerView: sv() }).resultCode).toBe('actor_lacks_item');
    expect(resolveTrade({ actor: buyer, target: shop, offeredItemId: 'healing_pill', requestedItemId: 'gold', sellerView: sv() }).resultCode).toBe('merchant_lacks_item');
  });

  it('以物易物：价值足够(丹10≥草8) → 成交', () => {
    const r = resolveTrade({ actor: buyer, target: shop, offeredItemId: 'healing_pill', requestedItemId: 'spirit_herb', sellerView: sv() });
    expect(r.resultCode).toBe('trade_completed');
    expect(r.effects.items).toHaveLength(2);
  });

  it('以物易物：出价太低(丹10<符12) → trade_refused', () => {
    expect(resolveTrade({ actor: buyer, target: shop, offeredItemId: 'healing_pill', requestedItemId: 'talisman', sellerView: sv() }).resultCode).toBe('trade_refused');
  });

  it('灵石购买：中性关系按原价(12)成交', () => {
    const r = resolveTrade({ actor: buyer, target: shop, offeredItemId: 'spirit_stone', requestedItemId: 'talisman', sellerView: sv() });
    expect(r.resultCode).toBe('trade_completed');
    expect(r.effects.items?.find((i) => i.itemId === 'spirit_stone')?.qty).toBe(12);
  });

  it('灵石购买多件：按数量扣灵石并转移目标物品', () => {
    const r = resolveTrade({
      actor: buyer,
      target: shop,
      offeredItemId: 'spirit_stone',
      requestedItemId: 'spirit_herb',
      requestedQty: 2,
      sellerView: sv(),
    });
    expect(r.resultCode).toBe('trade_completed');
    expect(r.effects.items?.find((i) => i.itemId === 'spirit_stone')?.qty).toBe(16);
    expect(r.effects.items?.find((i) => i.itemId === 'spirit_herb')?.qty).toBe(2);
  });

  it('目标库存不足以覆盖多件数量 → merchant_lacks_item', () => {
    expect(
      resolveTrade({
        actor: buyer,
        target: shop,
        offeredItemId: 'spirit_stone',
        requestedItemId: 'talisman',
        requestedQty: 2,
        sellerView: sv(),
      }).resultCode,
    ).toBe('merchant_lacks_item');
  });

  it('可疑买家 → 报价更高', () => {
    const r = resolveTrade({ actor: buyer, target: shop, offeredItemId: 'spirit_stone', requestedItemId: 'talisman', sellerView: sv({ suspicion: 45 }) });
    expect(r.effects.items!.find((i) => i.itemId === 'spirit_stone')!.qty).toBeGreaterThan(12);
  });

  it('熟客 → 报价更低', () => {
    const r = resolveTrade({ actor: buyer, target: shop, offeredItemId: 'spirit_stone', requestedItemId: 'talisman', sellerView: sv({ trust: 60, tags: ['regular_customer'] }) });
    expect(r.effects.items!.find((i) => i.itemId === 'spirit_stone')!.qty).toBeLessThan(12);
  });

  it('灵石不足 → insufficient_funds', () => {
    const poor: ActorSnapshot = { ...actor, inventory: [{ itemId: 'spirit_stone', qty: 5 }] };
    expect(resolveTrade({ actor: poor, target: shop, offeredItemId: 'spirit_stone', requestedItemId: 'talisman', sellerView: sv() }).resultCode).toBe('insufficient_funds');
  });
});

describe('resolveSteal', () => {
  it('目标无此物 → 拒绝', () => {
    expect(resolveSteal({ actor, target: merchant, location: secretGate, itemId: 'gold', roll: 0.1, detectionRoll: 0.9 }).resultCode).toBe('target_lacks_item');
  });
  it('得手且未被发现：物品转移、private', () => {
    const r = resolveSteal({ actor, target: merchant, location: mountainGate, itemId: 'talisman', roll: 0.1, detectionRoll: 0.9 });
    expect(r.resultCode).toBe('steal_success_undetected');
    expect(r.effects.items).toEqual([{ from: 'merchant', to: 'test_cultivator', itemId: 'talisman', qty: 1 }]);
    expect(r.visibility).toBe('private');
  });
  it('失败被发现：声望-5、witnessed', () => {
    const r = resolveSteal({ actor, target: merchant, location: mountainGate, itemId: 'talisman', roll: 0.95, detectionRoll: 0.1 });
    expect(r.resultCode).toBe('steal_failed_detected');
    expect(r.effects.reputation).toBe(-5);
    expect(r.visibility).toBe('witnessed');
  });
});

describe('seededRoll & clamp & realmRank', () => {
  it('seededRoll 确定且在 [0,1)', () => {
    expect(seededRoll('a')).toBe(seededRoll('a'));
    expect(seededRoll('a')).toBeGreaterThanOrEqual(0);
    expect(seededRoll('a')).toBeLessThan(1);
    expect(seededRoll('a')).not.toBe(seededRoll('b'));
  });
  it('clamp 夹值', () => {
    expect(clamp(200, -100, 100)).toBe(100);
    expect(clamp(-200, -100, 100)).toBe(-100);
  });
  it('realmRank 次序', () => {
    expect(realmRank('qi_refining')).toBeLessThan(realmRank('golden_core'));
    expect(realmRank('unknown')).toBe(0);
  });
});
