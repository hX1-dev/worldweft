import { healingAmount, itemBaseValue, itemName } from './xianxia/items';
import { quotePrice } from './xianxia/priceLogic';
import {
  quoteShopPurchase,
  quoteShopSale,
  type ShopState,
} from './xianxia/shopLogic';

export type InventoryItem = { itemId: string; qty: number };

export function buildGiftOptions(actorInventory: InventoryItem[], targetInventory: InventoryItem[]) {
  return actorInventory
    .filter((item) => item.qty > 0)
    .slice(0, 6)
    .map((item) => {
      const deltas = inventoryDeltaPreview([
        {
          owner: 'actor',
          itemId: item.itemId,
          before: item.qty,
          delta: -1,
        },
        {
          owner: 'target',
          itemId: item.itemId,
          before: inventoryQty(targetInventory, item.itemId),
          delta: 1,
        },
      ]);
      return {
        label: `${itemName(item.itemId)} x1`,
        params: { itemId: item.itemId },
        itemId: item.itemId,
        itemName: itemName(item.itemId),
        qtyAvailable: item.qty,
        inventoryDeltaPreview: deltas,
        confirmationPreview: confirmationPreview({
          actionType: 'gift',
          summary: `Give ${itemName(item.itemId)} x1.`,
          primaryLine: `Gift ${itemName(item.itemId)} to the selected target.`,
          inventoryPreview: deltas,
          durableEffectNotes: [
            'actionRecords row',
            'worldEvents row',
            'possible relationship and memory updates',
          ],
        }),
      };
    });
}

export function buildHealingItemOptions(
  actorInventory: InventoryItem[],
  currentHealth: number,
  maxHealth: number,
) {
  const boundedMax = Math.max(1, maxHealth);
  const boundedHealth = Math.max(0, Math.min(boundedMax, currentHealth));
  return actorInventory
    .filter((item) => item.qty > 0 && healingAmount(item.itemId) !== null)
    .slice(0, 6)
    .map((item) => {
      const healValue = healingAmount(item.itemId)!;
      const effectiveHeal = Math.max(0, Math.min(healValue, boundedMax - boundedHealth));
      const inventoryPreview = inventoryDeltaPreview([
        {
          owner: 'actor',
          itemId: item.itemId,
          before: item.qty,
          delta: -1,
        },
      ]);
      return {
        label: `${itemName(item.itemId)} x1 · +${effectiveHeal} health`,
        params: { itemId: item.itemId },
        itemId: item.itemId,
        itemName: itemName(item.itemId),
        qtyAvailable: item.qty,
        healValue,
        effectiveHeal,
        currentHealth: boundedHealth,
        maxHealth: boundedMax,
        inventoryDeltaPreview: inventoryPreview,
        confirmationPreview: confirmationPreview({
          actionType: 'use_item',
          summary: `Use ${itemName(item.itemId)} x1 to restore ${effectiveHeal} health.`,
          primaryLine: `Consume ${itemName(item.itemId)} x1.`,
          balanceLine: `Health ${boundedHealth} -> ${boundedHealth + effectiveHeal}/${boundedMax}.`,
          inventoryPreview,
          durableEffectNotes: [
            'actionRecords row',
            'private worldEvents row',
            'inventory -1 and effective health delta resolved atomically by Convex',
          ],
        }),
      };
    });
}

export function buildTradeOptions(
  actorInventory: InventoryItem[],
  targetInventory: InventoryItem[],
  sellerView: { affinity: number; trust: number; suspicion: number; tags?: string[] },
) {
  const spiritStones = actorInventory.find((item) => item.itemId === 'spirit_stone')?.qty ?? 0;
  return targetInventory
    .filter((item) => item.qty > 0 && item.itemId !== 'spirit_stone' && itemBaseValue(item.itemId) > 0)
    .flatMap((item) => {
      const quote = quotePrice(itemBaseValue(item.itemId), sellerView);
      const quantityChoices = tradeQuantityChoices(item.qty, spiritStones, quote.finalPrice);
      const quantityChoicePreview = quantityChoices.map((qty) => ({
        requestedQty: qty,
        offeredQty: quote.finalPrice * qty,
        totalPriceSpiritStones: quote.finalPrice * qty,
        unitPriceSpiritStones: quote.finalPrice,
        label: `x${qty} · ${quote.finalPrice * qty} 灵石`,
      }));
      const maxSelectableQty = quantityChoices.length > 0 ? Math.max(...quantityChoices) : 0;
      return quantityChoices.map((requestedQty) => {
        const totalPrice = quote.finalPrice * requestedQty;
        const exchangeTerms = [
          {
            from: 'actor' as const,
            to: 'target' as const,
            itemId: 'spirit_stone',
            itemName: itemName('spirit_stone'),
            qty: totalPrice,
          },
          {
            from: 'target' as const,
            to: 'actor' as const,
            itemId: item.itemId,
            itemName: itemName(item.itemId),
            qty: requestedQty,
          },
        ];
        const inventoryPreview = inventoryDeltaPreview([
          {
            owner: 'actor',
            itemId: 'spirit_stone',
            before: spiritStones,
            delta: -totalPrice,
          },
          {
            owner: 'actor',
            itemId: item.itemId,
            before: inventoryQty(actorInventory, item.itemId),
            delta: requestedQty,
          },
          {
            owner: 'target',
            itemId: 'spirit_stone',
            before: inventoryQty(targetInventory, 'spirit_stone'),
            delta: totalPrice,
          },
          {
            owner: 'target',
            itemId: item.itemId,
            before: item.qty,
            delta: -requestedQty,
          },
        ]);
        return {
          label: `${itemName(item.itemId)} x${requestedQty} · ${totalPrice} 灵石`,
          params: {
            offeredItemId: 'spirit_stone',
            offeredQty: totalPrice,
            requestedItemId: item.itemId,
            requestedQty,
          },
          offeredItemId: 'spirit_stone',
          offeredQty: totalPrice,
          requestedItemId: item.itemId,
          requestedQty,
          requestedItemName: itemName(item.itemId),
          requestedQtyAvailable: item.qty,
          quantityChoices: quantityChoicePreview,
          quantityChoiceIndex: quantityChoices.indexOf(requestedQty),
          quantityChoiceCount: quantityChoices.length,
          maxSelectableQty,
          priceSpiritStones: totalPrice,
          unitPriceSpiritStones: quote.finalPrice,
          buyerSpiritStones: spiritStones,
          affordable: spiritStones >= totalPrice,
          quote: {
            ...quote,
            basePrice: quote.basePrice * requestedQty,
            finalPrice: totalPrice,
            unitBasePrice: quote.basePrice,
            unitFinalPrice: quote.finalPrice,
            requestedQty,
          },
          exchangeTerms,
          inventoryDeltaPreview: inventoryPreview,
          confirmationPreview: confirmationPreview({
            actionType: 'trade',
            summary: `Buy ${itemName(item.itemId)} x${requestedQty} for ${totalPrice} spirit stone(s).`,
            primaryLine: `${itemName(item.itemId)} x${requestedQty} for ${totalPrice} spirit stone(s).`,
            balanceLine: `Balance ${spiritStones} -> ${Math.max(0, spiritStones - totalPrice)}.`,
            exchangeTerms,
            inventoryPreview,
            durableEffectNotes: [
              'actionRecords row',
              'worldEvents row',
              'inventory transfer resolved by Convex rules',
              'possible relationship and memory updates',
            ],
          }),
        };
      });
    })
    .filter((option) => option.affordable)
    .slice(0, 6);
}

export function buildShopTradeOptions(
  actorInventory: InventoryItem[],
  shop: ShopState,
  sellerView: { affinity: number; trust: number; suspicion: number; tags?: string[] },
) {
  const spiritStones = inventoryQty(actorInventory, 'spirit_stone');
  const buy = shop.stock.flatMap((line) => {
    if (line.qty <= 0 || itemBaseValue(line.itemId) <= 0) return [];
    const quote = quoteShopSale(line.itemId, line.qty, line.capacity, sellerView);
    const quantityChoices = tradeQuantityChoices(line.qty, spiritStones, quote.finalPrice);
    return quantityChoices.map((requestedQty) => {
      const totalPrice = quote.finalPrice * requestedQty;
      const inventoryPreview = inventoryDeltaPreview([
        { owner: 'actor', itemId: 'spirit_stone', before: spiritStones, delta: -totalPrice },
        {
          owner: 'actor',
          itemId: line.itemId,
          before: inventoryQty(actorInventory, line.itemId),
          delta: requestedQty,
        },
        { owner: 'shop', itemId: line.itemId, before: line.qty, delta: -requestedQty },
      ]);
      const exchangeTerms = [
        {
          from: 'actor' as const,
          to: 'shop' as const,
          itemId: 'spirit_stone',
          itemName: itemName('spirit_stone'),
          qty: totalPrice,
        },
        {
          from: 'shop' as const,
          to: 'actor' as const,
          itemId: line.itemId,
          itemName: itemName(line.itemId),
          qty: requestedQty,
        },
      ];
      return {
        label: `Buy ${itemName(line.itemId)} x${requestedQty} · ${totalPrice} 灵石`,
        direction: 'buy' as const,
        params: {
          offeredItemId: 'spirit_stone',
          offeredQty: totalPrice,
          requestedItemId: line.itemId,
          requestedQty,
        },
        itemId: line.itemId,
        qty: requestedQty,
        priceSpiritStones: totalPrice,
        unitPriceSpiritStones: quote.finalPrice,
        quote,
        shop: shopSummary(shop, line.itemId),
        exchangeTerms,
        inventoryDeltaPreview: inventoryPreview,
        confirmationPreview: confirmationPreview({
          actionType: 'trade',
          summary: `Buy ${itemName(line.itemId)} x${requestedQty} for ${totalPrice} spirit stone(s).`,
          primaryLine: `${shop.name}: ${itemName(line.itemId)} x${requestedQty}.`,
          balanceLine: `Balance ${spiritStones} -> ${spiritStones - totalPrice}; shop stock ${line.qty} -> ${line.qty - requestedQty}.`,
          exchangeTerms,
          inventoryPreview,
          durableEffectNotes: [
            'actionRecords row',
            'worldEvents row with shop stock and wallet facts',
            `restock source ${shop.restockSourceId}`,
            'actor inventory and shop state settle atomically in Convex',
          ],
        }),
      };
    });
  });
  const sell = shop.stock.flatMap((line) => {
    const owned = inventoryQty(actorInventory, line.itemId);
    if (owned <= 0 || line.qty >= line.capacity || itemBaseValue(line.itemId) <= 0) return [];
    const quote = quoteShopPurchase(line.itemId, line.qty, line.capacity);
    if (quote.finalPrice <= 0 || shop.walletSpiritStones < quote.finalPrice) return [];
    const inventoryPreview = inventoryDeltaPreview([
      { owner: 'actor', itemId: line.itemId, before: owned, delta: -1 },
      {
        owner: 'actor',
        itemId: 'spirit_stone',
        before: spiritStones,
        delta: quote.finalPrice,
      },
      { owner: 'shop', itemId: line.itemId, before: line.qty, delta: 1 },
    ]);
    const exchangeTerms = [
      {
        from: 'actor' as const,
        to: 'shop' as const,
        itemId: line.itemId,
        itemName: itemName(line.itemId),
        qty: 1,
      },
      {
        from: 'shop' as const,
        to: 'actor' as const,
        itemId: 'spirit_stone',
        itemName: itemName('spirit_stone'),
        qty: quote.finalPrice,
      },
    ];
    return [
      {
        label: `Sell ${itemName(line.itemId)} x1 · ${quote.finalPrice} 灵石`,
        direction: 'sell' as const,
        params: {
          offeredItemId: line.itemId,
          offeredQty: 1,
          requestedItemId: 'spirit_stone',
          requestedQty: quote.finalPrice,
        },
        itemId: line.itemId,
        qty: 1,
        priceSpiritStones: quote.finalPrice,
        unitPriceSpiritStones: quote.finalPrice,
        quote,
        shop: shopSummary(shop, line.itemId),
        exchangeTerms,
        inventoryDeltaPreview: inventoryPreview,
        confirmationPreview: confirmationPreview({
          actionType: 'trade',
          summary: `Sell ${itemName(line.itemId)} x1 for ${quote.finalPrice} spirit stone(s).`,
          primaryLine: `${shop.name} buys ${itemName(line.itemId)} x1.`,
          balanceLine: `Balance ${spiritStones} -> ${spiritStones + quote.finalPrice}; shop stock ${line.qty} -> ${line.qty + 1}.`,
          exchangeTerms,
          inventoryPreview,
          durableEffectNotes: [
            'actionRecords row',
            'worldEvents row with shop stock and wallet facts',
            'shop wallet funds the payout',
            'actor inventory and shop state settle atomically in Convex',
          ],
        }),
      },
    ];
  });
  return [...sell, ...buy].slice(0, 12);
}

function shopSummary(shop: ShopState, itemId: string) {
  const line = shop.stock.find((candidate) => candidate.itemId === itemId)!;
  return {
    shopId: shop.shopId,
    name: shop.name,
    walletSpiritStones: shop.walletSpiritStones,
    walletCapacity: shop.walletCapacity,
    restockSourceId: shop.restockSourceId,
    restockIntervalMs: shop.restockIntervalMs,
    nextRestockAt: shop.nextRestockAt,
    stock: line.qty,
    capacity: line.capacity,
  };
}

export function optionParams(option: { params?: Record<string, unknown> } | undefined) {
  return option?.params;
}

function tradeQuantityChoices(stock: number, buyerSpiritStones: number, unitPrice: number) {
  const affordableQty = unitPrice > 0 ? Math.floor(buyerSpiritStones / unitPrice) : 0;
  const maxQty = Math.max(1, Math.min(stock, affordableQty, 3));
  const choices = new Set<number>([1]);
  if (maxQty >= 2) choices.add(2);
  if (maxQty >= 3) choices.add(maxQty);
  return [...choices].filter((qty) => qty <= stock && qty * unitPrice <= buyerSpiritStones);
}

function inventoryQty(inventory: InventoryItem[], itemId: string) {
  return inventory.find((item) => item.itemId === itemId)?.qty ?? 0;
}

function inventoryDeltaPreview(
  deltas: Array<{
    owner: 'actor' | 'target' | 'shop';
    itemId: string;
    before: number;
    delta: number;
  }>,
) {
  return {
    deltas: deltas.map((delta) => ({
      ...delta,
      itemName: itemName(delta.itemId),
      after: Math.max(0, delta.before + delta.delta),
    })),
  };
}

function confirmationPreview(args: {
  actionType: string;
  summary: string;
  primaryLine: string;
  balanceLine?: string;
  exchangeTerms?: Array<{
    from: 'actor' | 'target' | 'shop';
    to: 'actor' | 'target' | 'shop';
    itemName: string;
    qty: number;
  }>;
  inventoryPreview: ReturnType<typeof inventoryDeltaPreview>;
  durableEffectNotes: string[];
}) {
  return {
    actionType: args.actionType,
    presentationSource: 'rule_template',
    previewOnly: true,
    summary: args.summary,
    primaryLine: args.primaryLine,
    balanceLine: args.balanceLine,
    termsLine: args.exchangeTerms ? exchangeTermsLine(args.exchangeTerms) : undefined,
    inventoryLine: inventoryDeltaLine(args.inventoryPreview),
    durableEffectNotes: args.durableEffectNotes,
    policy: {
      convexAuthored: true,
      godotMayDisplayOnly: true,
      durableStateUnchanged: true,
      submitPath: 'POST /godot/action',
    },
  };
}

function exchangeTermsLine(
  terms: Array<{
    from: 'actor' | 'target' | 'shop';
    to: 'actor' | 'target' | 'shop';
    itemName: string;
    qty: number;
  }>,
) {
  return terms
    .map((term) => `${ownerLabel(term.from)} -> ${ownerLabel(term.to)}: ${term.itemName} x${term.qty}`)
    .join(' | ');
}

function inventoryDeltaLine(preview: ReturnType<typeof inventoryDeltaPreview>) {
  return preview.deltas
    .map((delta) => {
      const sign = delta.delta > 0 ? '+' : '';
      return `${ownerLabel(delta.owner)} ${delta.itemName} ${delta.before} -> ${delta.after} (${sign}${delta.delta})`;
    })
    .join(' | ');
}

function ownerLabel(owner: 'actor' | 'target' | 'shop') {
  return owner === 'actor' ? 'You' : owner === 'shop' ? 'Shop' : 'Target';
}
