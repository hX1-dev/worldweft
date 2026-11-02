import {
  inventoryHasUnreservedTargetItem,
  lootPriorityAllows,
  resolveAttackDamage,
  resolveFlee,
} from './conflictLogic';

const actor = (overrides: Partial<any> = {}) => ({
  actorId: 'a',
  name: '甲',
  realm: 'qi_refining',
  realmStage: 3,
  mood: 0,
  health: 10,
  spirit: 5,
  ...overrides,
});

describe('C010 conflict rules', () => {
  test('attack damage is deterministic and bounded to two through four', () => {
    expect(resolveAttackDamage({ attacker: actor(), defender: actor({ actorId: 'b' }), roll: 0 })).toBe(2);
    expect(resolveAttackDamage({ attacker: actor(), defender: actor({ actorId: 'b' }), roll: 0.5 })).toBe(3);
    expect(resolveAttackDamage({ attacker: actor({ realm: 'golden_core' }), defender: actor({ actorId: 'b' }), roll: 0.99 })).toBe(4);
  });

  test('flee chance remains bounded and the roll, not the model, decides', () => {
    expect(resolveFlee({ fleeing: actor(), opponent: actor({ actorId: 'b' }), roll: 0.54 })).toEqual({ escaped: true, chance: 0.55 });
    expect(resolveFlee({ fleeing: actor(), opponent: actor({ actorId: 'b' }), roll: 0.56 })).toEqual({ escaped: false, chance: 0.55 });
    expect(resolveFlee({ fleeing: actor({ realm: 'deity_transformation' }), opponent: actor({ actorId: 'b' }), roll: 0.84 }).chance).toBe(0.85);
  });

  test('loot priority expires but never blocks the victor', () => {
    expect(lootPriorityAllows({ actorId: 'winner', lootOwnerActorId: 'winner', lootProtectedUntil: 100, now: 0 })).toBe(true);
    expect(lootPriorityAllows({ actorId: 'other', lootOwnerActorId: 'winner', lootProtectedUntil: 100, now: 99 })).toBe(false);
    expect(lootPriorityAllows({ actorId: 'other', lootOwnerActorId: 'winner', lootProtectedUntil: 100, now: 100 })).toBe(true);
  });

  test('target inventory reservation protects the last item', () => {
    const inventory = [{ itemId: 'spirit_herb', qty: 1 }];
    expect(inventoryHasUnreservedTargetItem(inventory, 'spirit_herb', 0)).toBe(true);
    expect(inventoryHasUnreservedTargetItem(inventory, 'spirit_herb', 1)).toBe(false);
  });
});

