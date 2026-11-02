import type { ActionResult } from './actionSchema';
import { itemBaseValue, itemName } from './items';
import { quotePrice, type PriceQuote, type SellerView } from './priceLogic';
import type { ActorSnapshot } from './rules';

export type ShopStockLine = {
  itemId: string;
  qty: number;
  capacity: number;
  restockAmount: number;
};

export type ShopState = {
  shopId: string;
  name: string;
  merchantActorId: string;
  mapId: string;
  locationId: string;
  restockSourceId: string;
  restockIntervalMs: number;
  nextRestockAt?: number;
  walletSpiritStones: number;
  walletCapacity: number;
  walletRestockAmount: number;
  stock: ShopStockLine[];
  updatedAt: number;
};

export type ShopRefreshResult = {
  shop: ShopState;
  periods: number;
  changed: boolean;
  walletAdded: number;
  stockAdded: Array<{ itemId: string; qty: number }>;
};

export type ShopSeedConfig = Pick<
  ShopState,
  | 'name'
  | 'merchantActorId'
  | 'mapId'
  | 'locationId'
  | 'restockSourceId'
  | 'restockIntervalMs'
  | 'walletCapacity'
  | 'walletRestockAmount'
  | 'stock'
>;

/** Static seed reconciliation that never refills runtime stock or wallet. */
export function existingShopSeedPatch(existing: ShopState, configured: ShopSeedConfig) {
  return {
    name: configured.name,
    merchantActorId: configured.merchantActorId,
    mapId: configured.mapId,
    locationId: configured.locationId,
    restockSourceId: configured.restockSourceId,
    restockIntervalMs: configured.restockIntervalMs,
    walletCapacity: configured.walletCapacity,
    walletRestockAmount: configured.walletRestockAmount,
    stock: existing.stock.map((line) => {
      const rule = configured.stock.find((candidate) => candidate.itemId === line.itemId);
      return rule
        ? {
            ...line,
            capacity: rule.capacity,
            restockAmount: rule.restockAmount,
            qty: Math.min(line.qty, rule.capacity),
          }
        : line;
    }),
  };
}

export function refreshShopState(shop: ShopState, now: number): ShopRefreshResult {
  const interval = positiveInteger(shop.restockIntervalMs);
  if (!interval || shop.nextRestockAt === undefined || shop.nextRestockAt > now) {
    const nextRestockAt =
      shop.nextRestockAt === undefined && interval ? now + interval : shop.nextRestockAt;
    return {
      shop: nextRestockAt === shop.nextRestockAt ? shop : { ...shop, nextRestockAt, updatedAt: now },
      periods: 0,
      changed: nextRestockAt !== shop.nextRestockAt,
      walletAdded: 0,
      stockAdded: [],
    };
  }
  const periods = Math.floor((now - shop.nextRestockAt) / interval) + 1;
  const stockAdded: Array<{ itemId: string; qty: number }> = [];
  const stock = shop.stock.map((line) => {
    const capacity = boundedNonNegativeInteger(line.capacity);
    const qty = Math.min(capacity, boundedNonNegativeInteger(line.qty));
    const add = Math.min(
      capacity - qty,
      boundedNonNegativeInteger(line.restockAmount) * periods,
    );
    if (add > 0) stockAdded.push({ itemId: line.itemId, qty: add });
    return { ...line, qty: qty + add, capacity };
  });
  const walletCapacity = boundedNonNegativeInteger(shop.walletCapacity);
  const walletBefore = Math.min(walletCapacity, boundedNonNegativeInteger(shop.walletSpiritStones));
  const walletAdded = Math.min(
    walletCapacity - walletBefore,
    boundedNonNegativeInteger(shop.walletRestockAmount) * periods,
  );
  const nextRestockAt = shop.nextRestockAt + periods * interval;
  return {
    shop: {
      ...shop,
      stock,
      walletSpiritStones: walletBefore + walletAdded,
      walletCapacity,
      nextRestockAt,
      updatedAt: now,
    },
    periods,
    changed: stockAdded.length > 0 || walletAdded > 0 || nextRestockAt !== shop.nextRestockAt,
    walletAdded,
    stockAdded,
  };
}

export function shopScarcityMultiplier(qty: number, capacity: number) {
  const ratio = stockRatio(qty, capacity);
  if (ratio <= 0.2) return 1.5;
  if (ratio <= 0.5) return 1.25;
  if (ratio <= 0.75) return 1.1;
  return 1;
}

export type ShopSaleQuote = PriceQuote & { stockRatio: number };

export function quoteShopSale(
  itemId: string,
  qty: number,
  capacity: number,
  sellerView: SellerView,
): ShopSaleQuote {
  const scarcityMultiplier = shopScarcityMultiplier(qty, capacity);
  return {
    ...quotePrice(itemBaseValue(itemId), sellerView, {
      scarcityMultiplier,
      ceilingMultiplier: 2.5,
    }),
    stockRatio: stockRatio(qty, capacity),
  };
}

export type ShopPurchaseQuote = {
  basePrice: number;
  demandMultiplier: number;
  buybackMultiplier: number;
  stockRatio: number;
  finalPrice: number;
};

export function quoteShopPurchase(itemId: string, qty: number, capacity: number): ShopPurchaseQuote {
  const ratio = stockRatio(qty, capacity);
  const demandMultiplier = ratio <= 0.2 ? 1.2 : ratio <= 0.5 ? 1 : ratio <= 0.75 ? 0.9 : 0.8;
  const basePrice = itemBaseValue(itemId);
  const buybackMultiplier = 0.45 * demandMultiplier;
  return {
    basePrice,
    demandMultiplier,
    buybackMultiplier,
    stockRatio: ratio,
    finalPrice: basePrice > 0 ? Math.max(1, Math.round(basePrice * buybackMultiplier)) : 0,
  };
}

export type ShopTradeFacts = {
  resultCode: string;
  shopId: string;
  direction: 'buy' | 'sell';
  itemId: string;
  qty: number;
  unitPrice: number;
  stockBefore: number;
  stockAfter: number;
  walletBefore: number;
  walletAfter: number;
  remittedSpiritStones: number;
  restockSourceId: string;
};

export type ShopTradeResolution = {
  result: ActionResult;
  shop: ShopState;
  facts?: ShopTradeFacts;
};

/**
 * Applies a quote that was frozen when an ActionExecution reservation started.
 * It deliberately does not re-price from current scarcity: completion either
 * honors the frozen quote or fails without changing the shop.
 */
export function settleReservedShopTrade(input: {
  actor: ActorSnapshot;
  shop: ShopState;
  direction: 'buy' | 'sell';
  itemId: string;
  qty: number;
  unitPrice: number;
  totalPrice: number;
}): ShopTradeResolution {
  const { actor, shop, direction, itemId, qty, unitPrice, totalPrice } = input;
  if (
    !exactPositiveQty(qty) ||
    !Number.isInteger(unitPrice) ||
    unitPrice <= 0 ||
    totalPrice !== unitPrice * qty
  ) {
    return unchanged(
      shop,
      reject('shop_reservation_lost', '冻结的商店交易报价或数量已经无效。'),
    );
  }
  const lineIndex = shop.stock.findIndex((line) => line.itemId === itemId);
  if (lineIndex < 0) {
    return unchanged(shop, reject('shop_reservation_lost', `商店已不再经营「${itemId}」。`));
  }
  const line = shop.stock[lineIndex];
  const walletBefore = shop.walletSpiritStones;
  if (direction === 'buy') {
    if (line.qty < qty || inventoryQty(actor, 'spirit_stone') < totalPrice) {
      return unchanged(shop, reject('shop_reservation_lost', '预约的商品或付款已经不存在。'));
    }
    const walletAfter = Math.min(shop.walletCapacity, walletBefore + totalPrice);
    const remittedSpiritStones = Math.max(0, walletBefore + totalPrice - walletAfter);
    const next = {
      ...shop,
      stock: shop.stock.map((candidate, index) =>
        index === lineIndex ? { ...candidate, qty: candidate.qty - qty } : candidate,
      ),
      walletSpiritStones: walletAfter,
    };
    return {
      shop: next,
      result: applied(
        'trade_completed',
        `${actor.name}在${shop.name}以 ${totalPrice} 枚灵石购得${qty}件「${itemName(itemId)}」。`,
        {
          items: [
            { from: actor.actorId, itemId: 'spirit_stone', qty: totalPrice },
            { to: actor.actorId, itemId, qty },
          ],
        },
      ),
      facts: {
        resultCode: 'trade_completed',
        shopId: shop.shopId,
        direction,
        itemId,
        qty,
        unitPrice,
        stockBefore: line.qty,
        stockAfter: line.qty - qty,
        walletBefore,
        walletAfter,
        remittedSpiritStones,
        restockSourceId: shop.restockSourceId,
      },
    };
  }
  if (
    line.qty + qty > line.capacity ||
    shop.walletSpiritStones < totalPrice ||
    inventoryQty(actor, itemId) < qty
  ) {
    return unchanged(shop, reject('shop_reservation_lost', '预约的货架容量、店铺资金或商品已经不存在。'));
  }
  const next = {
    ...shop,
    stock: shop.stock.map((candidate, index) =>
      index === lineIndex ? { ...candidate, qty: candidate.qty + qty } : candidate,
    ),
    walletSpiritStones: walletBefore - totalPrice,
  };
  return {
    shop: next,
    result: applied(
      'trade_completed',
      `${actor.name}向${shop.name}售出${qty}件「${itemName(itemId)}」，获得 ${totalPrice} 枚灵石。`,
      {
        items: [
          { from: actor.actorId, itemId, qty },
          { to: actor.actorId, itemId: 'spirit_stone', qty: totalPrice },
        ],
      },
    ),
    facts: {
      resultCode: 'trade_completed',
      shopId: shop.shopId,
      direction,
      itemId,
      qty,
      unitPrice,
      stockBefore: line.qty,
      stockAfter: line.qty + qty,
      walletBefore,
      walletAfter: walletBefore - totalPrice,
      remittedSpiritStones: 0,
      restockSourceId: shop.restockSourceId,
    },
  };
}

export function resolveShopTrade(input: {
  actor: ActorSnapshot;
  shop: ShopState;
  offeredItemId: string;
  offeredQty?: number;
  requestedItemId: string;
  requestedQty?: number;
  sellerView: SellerView;
}): ShopTradeResolution {
  const { actor, shop, offeredItemId, requestedItemId } = input;
  if (offeredItemId === 'spirit_stone' && requestedItemId !== 'spirit_stone') {
    const quantity = exactPositiveQty(input.requestedQty);
    if (!quantity) return unchanged(shop, reject('shop_quantity_invalid', '购买数量必须是 1–99 的整数。'));
    const lineIndex = shop.stock.findIndex((line) => line.itemId === requestedItemId);
    if (lineIndex < 0 || itemBaseValue(requestedItemId) <= 0) {
      return unchanged(shop, reject('shop_item_not_stocked', `${shop.name}并不经营「${requestedItemId}」。`));
    }
    const line = shop.stock[lineIndex];
    if (line.qty < quantity) {
      return unchanged(shop, reject('shop_out_of_stock', `${shop.name}的「${itemName(requestedItemId)}」库存不足。`));
    }
    const quote = quoteShopSale(requestedItemId, line.qty, line.capacity, input.sellerView);
    const total = quote.finalPrice * quantity;
    if (input.offeredQty !== undefined && input.offeredQty !== total) {
      return unchanged(shop, reject('shop_quote_changed', `当前报价已变为 ${total} 枚灵石，请按新报价确认。`));
    }
    if (inventoryQty(actor, 'spirit_stone') < total) {
      return unchanged(shop, reject('insufficient_funds', `${actor.name}需要 ${total} 枚灵石才能完成购买。`));
    }
    const walletBefore = shop.walletSpiritStones;
    const walletAfter = Math.min(shop.walletCapacity, walletBefore + total);
    const remittedSpiritStones = Math.max(0, walletBefore + total - walletAfter);
    const stock = shop.stock.map((candidate, index) =>
      index === lineIndex ? { ...candidate, qty: candidate.qty - quantity } : candidate,
    );
    const next = { ...shop, stock, walletSpiritStones: walletAfter };
    return {
      shop: next,
      result: applied(
        'trade_completed',
        `${actor.name}在${shop.name}以 ${total} 枚灵石购得${quantity}件「${itemName(requestedItemId)}」。`,
        {
          items: [
            { from: actor.actorId, itemId: 'spirit_stone', qty: total },
            { to: actor.actorId, itemId: requestedItemId, qty: quantity },
          ],
        },
      ),
      facts: {
        resultCode: 'trade_completed',
        shopId: shop.shopId,
        direction: 'buy',
        itemId: requestedItemId,
        qty: quantity,
        unitPrice: quote.finalPrice,
        stockBefore: line.qty,
        stockAfter: line.qty - quantity,
        walletBefore,
        walletAfter,
        remittedSpiritStones,
        restockSourceId: shop.restockSourceId,
      },
    };
  }

  if (requestedItemId === 'spirit_stone' && offeredItemId !== 'spirit_stone') {
    const quantity = exactPositiveQty(input.offeredQty);
    if (!quantity) return unchanged(shop, reject('shop_quantity_invalid', '出售数量必须是 1–99 的整数。'));
    const lineIndex = shop.stock.findIndex((line) => line.itemId === offeredItemId);
    if (lineIndex < 0 || itemBaseValue(offeredItemId) <= 0) {
      return unchanged(shop, reject('shop_item_not_stocked', `${shop.name}不收购「${offeredItemId}」。`));
    }
    const line = shop.stock[lineIndex];
    if (line.qty + quantity > line.capacity) {
      return unchanged(shop, reject('shop_stock_full', `${shop.name}的「${itemName(offeredItemId)}」货架已满。`));
    }
    if (inventoryQty(actor, offeredItemId) < quantity) {
      return unchanged(shop, reject('actor_lacks_item', `${actor.name}没有足够的「${itemName(offeredItemId)}」可出售。`));
    }
    const quote = quoteShopPurchase(offeredItemId, line.qty, line.capacity);
    const total = quote.finalPrice * quantity;
    if (input.requestedQty !== undefined && input.requestedQty !== total) {
      return unchanged(shop, reject('shop_quote_changed', `当前收购价已变为 ${total} 枚灵石，请按新报价确认。`));
    }
    if (shop.walletSpiritStones < total) {
      return unchanged(shop, reject('shop_insufficient_funds', `${shop.name}当前只有 ${shop.walletSpiritStones} 枚灵石，无法收购。`));
    }
    const walletBefore = shop.walletSpiritStones;
    const stock = shop.stock.map((candidate, index) =>
      index === lineIndex ? { ...candidate, qty: candidate.qty + quantity } : candidate,
    );
    const next = { ...shop, stock, walletSpiritStones: walletBefore - total };
    return {
      shop: next,
      result: applied(
        'trade_completed',
        `${actor.name}向${shop.name}售出${quantity}件「${itemName(offeredItemId)}」，获得 ${total} 枚灵石。`,
        {
          items: [
            { from: actor.actorId, itemId: offeredItemId, qty: quantity },
            { to: actor.actorId, itemId: 'spirit_stone', qty: total },
          ],
        },
      ),
      facts: {
        resultCode: 'trade_completed',
        shopId: shop.shopId,
        direction: 'sell',
        itemId: offeredItemId,
        qty: quantity,
        unitPrice: quote.finalPrice,
        stockBefore: line.qty,
        stockAfter: line.qty + quantity,
        walletBefore,
        walletAfter: walletBefore - total,
        remittedSpiritStones: 0,
        restockSourceId: shop.restockSourceId,
      },
    };
  }

  return unchanged(
    shop,
    reject('shop_trade_mode_invalid', '商店首版只接受灵石购买，或以物品换取灵石。'),
  );
}

function stockRatio(qty: number, capacity: number) {
  return capacity > 0 ? Math.max(0, Math.min(1, qty / capacity)) : 0;
}

function inventoryQty(actor: ActorSnapshot, itemId: string) {
  return actor.inventory?.find((item) => item.itemId === itemId)?.qty ?? 0;
}

function exactPositiveQty(value: number | undefined) {
  const resolved = value === undefined ? 1 : value;
  return Number.isInteger(resolved) && resolved >= 1 && resolved <= 99 ? resolved : null;
}

function positiveInteger(value: number) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function boundedNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function reject(resultCode: string, reason: string): ActionResult {
  return { status: 'rejected', resultCode, reason, effects: {}, eventType: 'action_refused', visibility: 'local' };
}

function applied(resultCode: string, reason: string, effects: ActionResult['effects']): ActionResult {
  return { status: 'applied', resultCode, reason, effects, eventType: 'shop_trade_completed', visibility: 'local' };
}

function unchanged(shop: ShopState, result: ActionResult): ShopTradeResolution {
  return { shop, result };
}
