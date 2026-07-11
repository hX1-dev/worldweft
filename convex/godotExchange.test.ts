import { buildGiftOptions, buildTradeOptions, optionParams } from './godotExchange';

describe('godotExchange', () => {
  test('buildGiftOptions returns Convex-authored display previews without mutating durable state', () => {
    const options = buildGiftOptions(
      [
        { itemId: 'spirit_stone', qty: 3 },
        { itemId: 'spirit_herb', qty: 0 },
      ],
      [{ itemId: 'spirit_stone', qty: 1 }],
    );

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      label: '灵石 x1',
      params: { itemId: 'spirit_stone' },
      itemId: 'spirit_stone',
      itemName: '灵石',
      qtyAvailable: 3,
      inventoryDeltaPreview: {
        deltas: [
          { owner: 'actor', itemId: 'spirit_stone', itemName: '灵石', before: 3, delta: -1, after: 2 },
          { owner: 'target', itemId: 'spirit_stone', itemName: '灵石', before: 1, delta: 1, after: 2 },
        ],
      },
      confirmationPreview: {
        actionType: 'gift',
        presentationSource: 'rule_template',
        previewOnly: true,
        summary: 'Give 灵石 x1.',
        primaryLine: 'Gift 灵石 to the selected target.',
        inventoryLine: 'You 灵石 3 -> 2 (-1) | Target 灵石 1 -> 2 (+1)',
        durableEffectNotes: ['actionRecords row', 'worldEvents row', 'possible relationship and memory updates'],
        policy: {
          convexAuthored: true,
          godotMayDisplayOnly: true,
          durableStateUnchanged: true,
          submitPath: 'POST /godot/action',
        },
      },
    });
    expect(optionParams(options[0])).toEqual({ itemId: 'spirit_stone' });
  });

  test('buildTradeOptions returns quantity-aware Convex terms and selected params', () => {
    const options = buildTradeOptions(
      [
        { itemId: 'spirit_stone', qty: 42 },
        { itemId: 'spirit_herb', qty: 1 },
      ],
      [
        { itemId: 'spirit_herb', qty: 5 },
        { itemId: 'spirit_stone', qty: 4 },
        { itemId: 'mystery_thing', qty: 2 },
      ],
      { affinity: 0, trust: 0, suspicion: 0 },
    );

    expect(options.map((option) => option.requestedQty)).toEqual([1, 2, 3]);
    const option = options[1];
    expect(option).toMatchObject({
      label: '灵草 x2 · 16 灵石',
      params: {
        offeredItemId: 'spirit_stone',
        offeredQty: 16,
        requestedItemId: 'spirit_herb',
        requestedQty: 2,
      },
      requestedItemName: '灵草',
      requestedQtyAvailable: 5,
      quantityChoiceIndex: 1,
      quantityChoiceCount: 3,
      maxSelectableQty: 3,
      priceSpiritStones: 16,
      unitPriceSpiritStones: 8,
      buyerSpiritStones: 42,
      affordable: true,
      quote: {
        basePrice: 16,
        finalPrice: 16,
        unitBasePrice: 8,
        unitFinalPrice: 8,
        requestedQty: 2,
      },
      quantityChoices: [
        { requestedQty: 1, offeredQty: 8, totalPriceSpiritStones: 8, unitPriceSpiritStones: 8 },
        { requestedQty: 2, offeredQty: 16, totalPriceSpiritStones: 16, unitPriceSpiritStones: 8 },
        { requestedQty: 3, offeredQty: 24, totalPriceSpiritStones: 24, unitPriceSpiritStones: 8 },
      ],
      exchangeTerms: [
        { from: 'actor', to: 'target', itemId: 'spirit_stone', itemName: '灵石', qty: 16 },
        { from: 'target', to: 'actor', itemId: 'spirit_herb', itemName: '灵草', qty: 2 },
      ],
      inventoryDeltaPreview: {
        deltas: [
          { owner: 'actor', itemId: 'spirit_stone', itemName: '灵石', before: 42, delta: -16, after: 26 },
          { owner: 'actor', itemId: 'spirit_herb', itemName: '灵草', before: 1, delta: 2, after: 3 },
          { owner: 'target', itemId: 'spirit_stone', itemName: '灵石', before: 4, delta: 16, after: 20 },
          { owner: 'target', itemId: 'spirit_herb', itemName: '灵草', before: 5, delta: -2, after: 3 },
        ],
      },
      confirmationPreview: {
        actionType: 'trade',
        presentationSource: 'rule_template',
        previewOnly: true,
        summary: 'Buy 灵草 x2 for 16 spirit stone(s).',
        primaryLine: '灵草 x2 for 16 spirit stone(s).',
        balanceLine: 'Balance 42 -> 26.',
        termsLine: 'You -> Target: 灵石 x16 | Target -> You: 灵草 x2',
        inventoryLine:
          'You 灵石 42 -> 26 (-16) | You 灵草 1 -> 3 (+2) | Target 灵石 4 -> 20 (+16) | Target 灵草 5 -> 3 (-2)',
        durableEffectNotes: [
          'actionRecords row',
          'worldEvents row',
          'inventory transfer resolved by Convex rules',
          'possible relationship and memory updates',
        ],
        policy: {
          convexAuthored: true,
          godotMayDisplayOnly: true,
          durableStateUnchanged: true,
          submitPath: 'POST /godot/action',
        },
      },
    });
    expect(optionParams(option)).toEqual({
      offeredItemId: 'spirit_stone',
      offeredQty: 16,
      requestedItemId: 'spirit_herb',
      requestedQty: 2,
    });
  });

  test('trade options filter unaffordable and zero-value seller items', () => {
    const options = buildTradeOptions(
      [{ itemId: 'spirit_stone', qty: 7 }],
      [
        { itemId: 'spirit_herb', qty: 5 },
        { itemId: 'mystery_thing', qty: 5 },
      ],
      { affinity: 0, trust: 0, suspicion: 0 },
    );

    expect(options).toHaveLength(0);
  });
});
