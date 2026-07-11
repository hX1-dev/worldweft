import { itemBaseValue, itemName } from './xianxia/items';
import { quotePrice } from './xianxia/priceLogic';

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
    owner: 'actor' | 'target';
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
    from: 'actor' | 'target';
    to: 'actor' | 'target';
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
    from: 'actor' | 'target';
    to: 'actor' | 'target';
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

function ownerLabel(owner: 'actor' | 'target') {
  return owner === 'actor' ? 'You' : 'Target';
}
