import {
  applyCultivationEnhancements,
  availableCultivationModes,
  chooseAgentCultivationMode,
  clampCultivationEnergy,
  cultivationResourceForMode,
  hasCultivationPendant,
  parseCultivationMode,
} from './cultivationResourceLogic';

describe('cultivation resource logic', () => {
  test('defaults missing mode to ambient and rejects unknown values', () => {
    expect(parseCultivationMode(undefined)).toBe('ambient');
    expect(parseCultivationMode('spirit_stone')).toBe('spirit_stone');
    expect(parseCultivationMode('qi_pill')).toBe('qi_pill');
    expect(parseCultivationMode('free_power')).toBeNull();
    expect(parseCultivationMode(1)).toBeNull();
  });

  test('clamps location spiritual energy to 0..10', () => {
    expect(clampCultivationEnergy(-9)).toBe(0);
    expect(clampCultivationEnergy(5)).toBe(5);
    expect(clampCultivationEnergy(99)).toBe(10);
    expect(clampCultivationEnergy(Number.NaN)).toBe(0);
  });

  test('uses catalog-backed pill bonus and fixed spirit-stone bonus', () => {
    expect(cultivationResourceForMode('ambient')).toBeNull();
    expect(cultivationResourceForMode('spirit_stone')).toEqual({
      itemId: 'spirit_stone',
      quantity: 1,
      bonusXp: 3,
    });
    expect(cultivationResourceForMode('qi_pill')).toEqual({
      itemId: 'qi_pill',
      quantity: 1,
      bonusXp: 10,
    });
  });

  test('applies one non-stacking pendant bonus after the selected resource bonus', () => {
    expect(applyCultivationEnhancements(8, 'ambient', false)).toBe(8);
    expect(applyCultivationEnhancements(8, 'spirit_stone', false)).toBe(11);
    expect(applyCultivationEnhancements(8, 'qi_pill', false)).toBe(18);
    expect(applyCultivationEnhancements(8, 'ambient', true)).toBe(9);
    expect(applyCultivationEnhancements(8, 'spirit_stone', true)).toBe(12);
    expect(
      hasCultivationPendant([
        { itemId: 'qi_pendant', qty: 5 },
        { itemId: 'qi_pendant', qty: 4 },
      ]),
    ).toBe(true);
    expect(applyCultivationEnhancements(1, 'ambient', true)).toBe(2);
  });

  test('only exposes actually owned paid modes', () => {
    expect(availableCultivationModes([])).toEqual(['ambient']);
    expect(availableCultivationModes([{ itemId: 'spirit_stone', qty: 1 }])).toEqual([
      'ambient',
      'spirit_stone',
    ]);
    expect(
      availableCultivationModes([
        { itemId: 'spirit_stone', qty: 1 },
        { itemId: 'qi_pill', qty: 1 },
      ]),
    ).toEqual(['ambient', 'spirit_stone', 'qi_pill']);
  });

  test('deterministic agent preserves eleven stones and never auto-consumes pills', () => {
    expect(
      chooseAgentCultivationMode({
        spiritualEnergy: 5,
        inventory: [{ itemId: 'spirit_stone', qty: 12 }],
      }),
    ).toBe('spirit_stone');
    expect(
      chooseAgentCultivationMode({
        spiritualEnergy: 10,
        inventory: [{ itemId: 'qi_pill', qty: 20 }],
      }),
    ).toBe('ambient');
    expect(
      chooseAgentCultivationMode({
        spiritualEnergy: 4,
        inventory: [{ itemId: 'spirit_stone', qty: 99 }],
      }),
    ).toBe('ambient');
  });
});
