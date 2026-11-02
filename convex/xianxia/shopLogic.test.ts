import {
  existingShopSeedPatch,
  quoteShopPurchase,
  quoteShopSale,
  refreshShopState,
  resolveShopTrade,
  settleReservedShopTrade,
  type ShopState,
} from './shopLogic';
import type { ActorSnapshot } from './rules';

const shop = (overrides: Partial<ShopState> = {}): ShopState => ({
  shopId: 'lab_shop',
  name: '灰盒补给铺',
  merchantActorId: 'lab_merchant',
  mapId: 'xianxia_system_lab',
  locationId: 'system_lab_shop',
  restockSourceId: 'system_lab_sect_caravan',
  restockIntervalMs: 30_000,
  nextRestockAt: 30_000,
  walletSpiritStones: 20,
  walletCapacity: 40,
  walletRestockAmount: 4,
  stock: [
    { itemId: 'spirit_herb', qty: 1, capacity: 4, restockAmount: 1 },
    { itemId: 'qi_pill', qty: 1, capacity: 2, restockAmount: 1 },
  ],
  updatedAt: 0,
  ...overrides,
});

const actor = (inventory: NonNullable<ActorSnapshot['inventory']>): ActorSnapshot => ({
  actorId: 'buyer',
  name: '试验弟子',
  realm: 'qi_refining',
  realmStage: 1,
  cultivationXp: 0,
  mood: 0,
  health: 10,
  spirit: 5,
  reputation: 0,
  inventory,
});

const view = { affinity: 0, trust: 0, suspicion: 0, tags: [] as string[] };

describe('shop restock and scarcity', () => {
  test('lazy restock advances only complete periods and caps stock and wallet', () => {
    const refreshed = refreshShopState(shop(), 95_000);
    expect(refreshed.periods).toBe(3);
    expect(refreshed.shop.stock).toEqual([
      { itemId: 'spirit_herb', qty: 4, capacity: 4, restockAmount: 1 },
      { itemId: 'qi_pill', qty: 2, capacity: 2, restockAmount: 1 },
    ]);
    expect(refreshed.shop.walletSpiritStones).toBe(32);
    expect(refreshed.shop.nextRestockAt).toBe(120_000);
    expect(refreshShopState(refreshed.shop, 95_000).periods).toBe(0);
  });

  test('scarcity increases sale price while buyback remains below minimum sale price', () => {
    const scarce = quoteShopSale('spirit_herb', 1, 10, view);
    const abundant = quoteShopSale('spirit_herb', 10, 10, view);
    expect(scarce.scarcityMultiplier).toBe(1.5);
    expect(scarce.finalPrice).toBeGreaterThan(abundant.finalPrice);
    expect(quoteShopPurchase('spirit_herb', 0, 10).finalPrice).toBeLessThanOrEqual(
      Math.floor(8 * 0.7),
    );
  });

  test('repeated seed updates rules without refilling runtime stock or wallet', () => {
    const existing = shop({
      walletSpiritStones: 3,
      stock: [
        { itemId: 'spirit_herb', qty: 0, capacity: 4, restockAmount: 1 },
        { itemId: 'qi_pill', qty: 1, capacity: 2, restockAmount: 1 },
      ],
    });
    const patch = existingShopSeedPatch(existing, {
      ...shop(),
      walletCapacity: 60,
      stock: [
        { itemId: 'spirit_herb', qty: 4, capacity: 6, restockAmount: 2 },
        { itemId: 'qi_pill', qty: 2, capacity: 1, restockAmount: 1 },
      ],
    });
    expect(patch.stock).toEqual([
      { itemId: 'spirit_herb', qty: 0, capacity: 6, restockAmount: 2 },
      { itemId: 'qi_pill', qty: 1, capacity: 1, restockAmount: 1 },
    ]);
    expect(patch).not.toHaveProperty('walletSpiritStones');
    expect(patch).not.toHaveProperty('nextRestockAt');
  });
});

describe('shop atomic trade resolution', () => {
  test('buy transfers only actor balances and updates real shop stock and wallet', () => {
    const resolved = resolveShopTrade({
      actor: actor([{ itemId: 'spirit_stone', qty: 30 }]),
      shop: shop(),
      offeredItemId: 'spirit_stone',
      requestedItemId: 'qi_pill',
      sellerView: view,
    });
    expect(resolved.result.resultCode).toBe('trade_completed');
    expect(resolved.shop.stock.find((line) => line.itemId === 'qi_pill')?.qty).toBe(0);
    expect(resolved.shop.walletSpiritStones).toBeGreaterThan(20);
    expect(resolved.facts).toMatchObject({ direction: 'buy', stockBefore: 1, stockAfter: 0 });
  });

  test('payment beyond wallet capacity is explicitly remitted to the named source', () => {
    const resolved = resolveShopTrade({
      actor: actor([{ itemId: 'spirit_stone', qty: 30 }]),
      shop: shop({ walletSpiritStones: 39, walletCapacity: 40 }),
      offeredItemId: 'spirit_stone',
      requestedItemId: 'qi_pill',
      sellerView: view,
    });
    expect(resolved.shop.walletSpiritStones).toBe(40);
    expect(resolved.facts?.remittedSpiritStones).toBeGreaterThan(0);
    expect(resolved.facts?.restockSourceId).toBe('system_lab_sect_caravan');
  });

  test('sell consumes actor item, pays from shop wallet, and fills the shelf', () => {
    const resolved = resolveShopTrade({
      actor: actor([{ itemId: 'spirit_herb', qty: 2 }]),
      shop: shop(),
      offeredItemId: 'spirit_herb',
      offeredQty: 2,
      requestedItemId: 'spirit_stone',
      sellerView: view,
    });
    expect(resolved.result.resultCode).toBe('trade_completed');
    expect(resolved.shop.stock[0].qty).toBe(3);
    expect(resolved.shop.walletSpiritStones).toBeLessThan(20);
    expect(resolved.facts).toMatchObject({ direction: 'sell', qty: 2 });
  });

  test.each([
    [{ offeredItemId: 'spirit_stone', requestedItemId: 'qi_pill', requestedQty: 0 }, 'shop_quantity_invalid'],
    [{ offeredItemId: 'spirit_stone', requestedItemId: 'qi_pill', requestedQty: 2 }, 'shop_out_of_stock'],
    [{ offeredItemId: 'spirit_herb', offeredQty: 4, requestedItemId: 'spirit_stone' }, 'shop_stock_full'],
    [{ offeredItemId: 'qi_pill', requestedItemId: 'spirit_herb' }, 'shop_trade_mode_invalid'],
  ])('rejects invalid or impossible trade without changing shop', (params, code) => {
    const original = shop();
    const resolved = resolveShopTrade({
      actor: actor([
        { itemId: 'spirit_stone', qty: 100 },
        { itemId: 'spirit_herb', qty: 10 },
        { itemId: 'qi_pill', qty: 10 },
      ]),
      shop: original,
      sellerView: view,
      ...params,
    });
    expect(resolved.result.resultCode).toBe(code);
    expect(resolved.shop).toBe(original);
  });

  test('stale explicit quote is rejected', () => {
    expect(
      resolveShopTrade({
        actor: actor([{ itemId: 'spirit_stone', qty: 30 }]),
        shop: shop(),
        offeredItemId: 'spirit_stone',
        offeredQty: 1,
        requestedItemId: 'qi_pill',
        sellerView: view,
      }).result.resultCode,
    ).toBe('shop_quote_changed');
  });
});

describe('C016e3b frozen shop settlement', () => {
  test('honors a frozen buy quote even if current scarcity would produce another quote', () => {
    const reserved = settleReservedShopTrade({
      actor: actor([{ itemId: 'spirit_stone', qty: 30 }]),
      shop: shop({ stock: [{ itemId: 'qi_pill', qty: 1, capacity: 10, restockAmount: 1 }] }),
      direction: 'buy',
      itemId: 'qi_pill',
      qty: 1,
      unitPrice: 10,
      totalPrice: 10,
    });
    expect(reserved.result.resultCode).toBe('trade_completed');
    expect(reserved.facts).toMatchObject({ unitPrice: 10, stockBefore: 1, stockAfter: 0 });
  });

  test('fails closed when reserved stock, wallet, capacity or actor balance is gone', () => {
    const buy = settleReservedShopTrade({
      actor: actor([{ itemId: 'spirit_stone', qty: 30 }]),
      shop: shop({ stock: [{ itemId: 'qi_pill', qty: 0, capacity: 1, restockAmount: 1 }] }),
      direction: 'buy', itemId: 'qi_pill', qty: 1, unitPrice: 10, totalPrice: 10,
    });
    const sell = settleReservedShopTrade({
      actor: actor([{ itemId: 'spirit_herb', qty: 1 }]),
      shop: shop({ walletSpiritStones: 0 }),
      direction: 'sell', itemId: 'spirit_herb', qty: 1, unitPrice: 4, totalPrice: 4,
    });
    expect(buy.result.resultCode).toBe('shop_reservation_lost');
    expect(sell.result.resultCode).toBe('shop_reservation_lost');
  });
});
