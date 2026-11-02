import { existingProfileSeedPatch, type ProfileSeed } from './seedLogic';

const seed: ProfileSeed = {
  actorId: 'test_actor',
  name: '测试角色',
  role: 'outer_disciple',
  realm: 'qi_refining',
  realmStage: 1,
  spiritRoot: 'mixed',
  innerTrait: '中庸',
  outerTrait: '任我',
  cultivationXp: 0,
  mood: 0,
  health: 10,
  maxHealth: 10,
  spirit: 5,
  reputation: 0,
  inventory: [{ itemId: 'healing_pill', qty: 1 }],
  mapId: 'world',
  currentLocationId: 'mountain_gate',
  currentIntent: '等待',
  persona: '谨慎',
};

describe('seed runtime preservation', () => {
  test('重复 seed 不补回已消耗的库存', () => {
    expect(existingProfileSeedPatch({ maxHealth: 10, inventory: [] }, seed)).not.toHaveProperty(
      'inventory',
    );
  });

  test('旧档缺少库存或 maxHealth 时允许一次性回填', () => {
    expect(existingProfileSeedPatch({}, seed)).toMatchObject({
      inventory: [{ itemId: 'healing_pill', qty: 1 }],
      maxHealth: 10,
    });
  });

  test('旧档当前气血高于种子基线时不会回填出 health > maxHealth', () => {
    const lowerBaseline = { ...seed, health: 8, maxHealth: 8 };

    expect(existingProfileSeedPatch({ health: 10, inventory: [] }, lowerBaseline)).toMatchObject({
      maxHealth: 10,
    });
  });
});
