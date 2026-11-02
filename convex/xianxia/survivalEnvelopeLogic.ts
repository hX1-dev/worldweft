import { normalizeFatigue } from './fatigueLogic';
import { healingAmount } from './items';

export const SURVIVAL_SERIOUS_HEALTH_RATIO = 0.5;
export const SURVIVAL_EXHAUSTION_FATIGUE = 80;
export const AUTONOMY_HEALING_ITEM_RESERVE = 1;
export const AUTONOMY_SPIRIT_STONE_RESERVE = 10;

type InventoryEntry = { itemId: string; qty: number };
type KnownLocation = {
  locationId: string;
  name: string;
  allowedActions: string[];
};
type ShopOffer = {
  shopId: string;
  shopName: string;
  targetActorId: string;
  direction: 'buy' | 'sell';
  itemId: string;
  qty: number;
  totalPrice: number;
};

export type SurvivalEnvelopeInput = {
  health: number;
  maxHealth?: number;
  fatigue?: number;
  currentLocationId?: string;
  inventory: InventoryEntry[];
  availableActions: string[];
  knownLocations?: KnownLocation[];
  shopOffers?: ShopOffer[];
  combat?: {
    activeEncounterId?: string;
    opponentActorId?: string;
    opponentName?: string;
    opponentHealth?: number;
  };
};

export type SurvivalEnvelopeDecision =
  | { kind: 'pass' }
  | { kind: 'wait'; reasonCode: string }
  | { kind: 'flee'; opponentName?: string }
  | { kind: 'attack'; opponentActorId: string; opponentName?: string }
  | { kind: 'use_item'; itemId: string }
  | { kind: 'rest'; locationId: string; locationName: string }
  | { kind: 'travel_rest'; locationId: string; locationName: string }
  | {
      kind: 'buy_healing';
      targetActorId: string;
      shopId: string;
      shopName: string;
      itemId: string;
      quantity: number;
      totalPrice: number;
    }
  | { kind: 'travel_healing'; locationId: string; locationName: string };

export type SurvivalEnvelope = {
  state: 'incapacitated' | 'danger' | 'recovery' | 'stable';
  urgency: number;
  reasonCodes: string[];
  decision: SurvivalEnvelopeDecision;
};

export type AutonomousReserveProposal = {
  type: string;
  params?: Record<string, unknown>;
};

export type AutonomousReserveGate =
  | { ok: true }
  | {
      ok: false;
      reasonCode:
        | 'survival_healing_reserve_protected'
        | 'survival_spirit_stone_reserve_protected';
    };

export function evaluateSurvivalEnvelope(input: SurvivalEnvelopeInput): SurvivalEnvelope {
  const maxHealth = Math.max(1, Math.floor(input.maxHealth ?? 10));
  const health = Math.max(0, Math.min(maxHealth, Math.floor(input.health)));
  const healthRatio = health / maxHealth;
  const fatigue = normalizeFatigue(input.fatigue);
  const actions = new Set(input.availableActions);
  const healingItemId = firstHealingItemId(input.inventory);
  const combat = input.combat;
  const activeCombat = Boolean(
    combat?.activeEncounterId && combat.opponentActorId,
  );

  if (health <= 0) {
    return {
      state: 'incapacitated',
      urgency: 100,
      reasonCodes: ['survival_incapacitated'],
      decision: { kind: 'wait', reasonCode: 'survival_incapacitated' },
    };
  }

  if (activeCombat && combat?.opponentActorId) {
    const opponentAdvantage =
      typeof combat.opponentHealth === 'number' &&
      combat.opponentHealth >= health + 3;
    const highRisk =
      healthRatio <= SURVIVAL_SERIOUS_HEALTH_RATIO ||
      fatigue >= SURVIVAL_EXHAUSTION_FATIGUE ||
      opponentAdvantage;
    const reasons = [
      'survival_active_combat',
      ...(healthRatio <= SURVIVAL_SERIOUS_HEALTH_RATIO
        ? ['survival_serious_injury']
        : []),
      ...(fatigue >= SURVIVAL_EXHAUSTION_FATIGUE
        ? ['survival_exhausted']
        : []),
      ...(opponentAdvantage ? ['survival_opponent_advantage'] : []),
    ];
    if (highRisk && actions.has('flee')) {
      return {
        state: 'danger',
        urgency: 100,
        reasonCodes: reasons,
        decision: { kind: 'flee', opponentName: combat.opponentName },
      };
    }
    if (
      highRisk &&
      healthRatio <= SURVIVAL_SERIOUS_HEALTH_RATIO &&
      healingItemId &&
      actions.has('use_item')
    ) {
      return {
        state: 'danger',
        urgency: 95,
        reasonCodes: [...reasons, 'survival_escape_unavailable'],
        decision: { kind: 'use_item', itemId: healingItemId },
      };
    }
    if (actions.has('attack')) {
      return {
        state: 'danger',
        urgency: highRisk ? 90 : 85,
        reasonCodes: highRisk
          ? [...reasons, 'survival_escape_and_healing_unavailable']
          : reasons,
        decision: {
          kind: 'attack',
          opponentActorId: combat.opponentActorId,
          opponentName: combat.opponentName,
        },
      };
    }
    if (actions.has('flee')) {
      return {
        state: 'danger',
        urgency: 90,
        reasonCodes: reasons,
        decision: { kind: 'flee', opponentName: combat.opponentName },
      };
    }
    return {
      state: 'danger',
      urgency: 100,
      reasonCodes: [...reasons, 'survival_no_escape_or_defense'],
      decision: {
        kind: 'wait',
        reasonCode: 'survival_no_escape_or_defense',
      },
    };
  }

  if (healthRatio <= SURVIVAL_SERIOUS_HEALTH_RATIO) {
    const reasons = ['survival_serious_injury'];
    if (healingItemId && actions.has('use_item')) {
      return {
        state: 'recovery',
        urgency: 90,
        reasonCodes: reasons,
        decision: { kind: 'use_item', itemId: healingItemId },
      };
    }
    const spiritStones = inventoryQuantity(input.inventory, 'spirit_stone');
    const healingOffer = [...(input.shopOffers ?? [])]
      .filter(
        (offer) =>
          offer.direction === 'buy' &&
          offer.qty > 0 &&
          offer.totalPrice > 0 &&
          healingAmount(offer.itemId) !== null &&
          offer.totalPrice <= spiritStones,
      )
      .sort(
        (left, right) =>
          left.totalPrice - right.totalPrice ||
          left.shopId.localeCompare(right.shopId) ||
          left.itemId.localeCompare(right.itemId),
      )[0];
    if (healingOffer && actions.has('trade')) {
      return {
        state: 'recovery',
        urgency: 88,
        reasonCodes: [...reasons, 'survival_healing_purchase_available'],
        decision: {
          kind: 'buy_healing',
          targetActorId: healingOffer.targetActorId,
          shopId: healingOffer.shopId,
          shopName: healingOffer.shopName,
          itemId: healingOffer.itemId,
          quantity: healingOffer.qty,
          totalPrice: healingOffer.totalPrice,
        },
      };
    }
    const tradeLocation = [...(input.knownLocations ?? [])]
      .filter(
        (location) =>
          location.locationId !== input.currentLocationId &&
          location.allowedActions.includes('trade'),
      )
      .sort((left, right) => left.locationId.localeCompare(right.locationId))[0];
    if (tradeLocation && spiritStones > 0) {
      return {
        state: 'recovery',
        urgency: 85,
        reasonCodes: [...reasons, 'survival_seek_healing_supply'],
        decision: {
          kind: 'travel_healing',
          locationId: tradeLocation.locationId,
          locationName: tradeLocation.name,
        },
      };
    }
    return {
      state: 'recovery',
      urgency: 90,
      reasonCodes: [...reasons, 'survival_healing_unavailable'],
      decision: {
        kind: 'wait',
        reasonCode: 'survival_healing_unavailable',
      },
    };
  }

  if (fatigue >= 60) {
    const restLocations = [...(input.knownLocations ?? [])]
      .filter((location) => location.allowedActions.includes('rest'))
      .sort((left, right) => left.locationId.localeCompare(right.locationId));
    const restLocation =
      restLocations.find(
        (location) => location.locationId === input.currentLocationId,
      ) ?? restLocations[0];
    const urgency = Math.min(89, 60 + Math.max(0, fatigue - 60));
    if (!restLocation) {
      return {
        state: 'recovery',
        urgency,
        reasonCodes: ['survival_fatigued', 'survival_rest_unavailable'],
        decision: {
          kind: 'wait',
          reasonCode: 'survival_rest_unavailable',
        },
      };
    }
    if (restLocation.locationId !== input.currentLocationId) {
      return {
        state: 'recovery',
        urgency,
        reasonCodes: ['survival_fatigued'],
        decision: {
          kind: 'travel_rest',
          locationId: restLocation.locationId,
          locationName: restLocation.name,
        },
      };
    }
    if (actions.has('rest')) {
      return {
        state: 'recovery',
        urgency,
        reasonCodes: ['survival_fatigued'],
        decision: {
          kind: 'rest',
          locationId: restLocation.locationId,
          locationName: restLocation.name,
        },
      };
    }
    return {
      state: 'recovery',
      urgency,
      reasonCodes: ['survival_fatigued', 'survival_rest_unavailable'],
      decision: {
        kind: 'wait',
        reasonCode: 'survival_rest_unavailable',
      },
    };
  }

  return {
    state: 'stable',
    urgency: 0,
    reasonCodes: ['survival_stable'],
    decision: { kind: 'pass' },
  };
}

export function evaluateAutonomousReserveGate(
  input: SurvivalEnvelopeInput,
  proposal: AutonomousReserveProposal,
): AutonomousReserveGate {
  const maxHealth = Math.max(1, Math.floor(input.maxHealth ?? 10));
  const seriousInjury =
    Math.max(0, input.health) / maxHealth <= SURVIVAL_SERIOUS_HEALTH_RATIO;
  const params = proposal.params ?? {};
  const healingItemId = outgoingItemId(proposal);
  if (healingItemId && healingAmount(healingItemId) !== null) {
    const quantity = outgoingQuantity(proposal);
    const remaining =
      inventoryQuantity(input.inventory, healingItemId) - quantity;
    const emergencySelfUse = proposal.type === 'use_item' && seriousInjury;
    if (!emergencySelfUse && remaining < AUTONOMY_HEALING_ITEM_RESERVE) {
      return { ok: false, reasonCode: 'survival_healing_reserve_protected' };
    }
  }

  const spiritStoneSpend = outgoingSpiritStoneQuantity(proposal);
  if (spiritStoneSpend > 0) {
    const emergencyHealingPurchase =
      proposal.type === 'trade' &&
      seriousInjury &&
      typeof params.requestedItemId === 'string' &&
      healingAmount(params.requestedItemId) !== null;
    const remaining =
      inventoryQuantity(input.inventory, 'spirit_stone') - spiritStoneSpend;
    if (
      !emergencyHealingPurchase &&
      remaining < AUTONOMY_SPIRIT_STONE_RESERVE
    ) {
      return {
        ok: false,
        reasonCode: 'survival_spirit_stone_reserve_protected',
      };
    }
  }
  return { ok: true };
}

export function survivalUrgencyForAction(
  input: SurvivalEnvelopeInput,
  actionType: string,
): { urgency: number; reasonCodes: string[] } {
  const envelope = evaluateSurvivalEnvelope(input);
  const preferredAction = decisionActionType(envelope.decision);
  if (preferredAction === actionType) {
    return {
      urgency: envelope.urgency,
      reasonCodes: envelope.reasonCodes,
    };
  }
  if (
    envelope.state === 'danger' &&
    (actionType === 'flee' ||
      actionType === 'attack' ||
      actionType === 'use_item')
  ) {
    return {
      urgency: Math.max(1, envelope.urgency - 10),
      reasonCodes: envelope.reasonCodes,
    };
  }
  return { urgency: 0, reasonCodes: [] };
}

function decisionActionType(decision: SurvivalEnvelopeDecision): string | null {
  if (decision.kind === 'pass' || decision.kind === 'wait') return null;
  if (decision.kind === 'travel_rest' || decision.kind === 'travel_healing') {
    return 'travel';
  }
  if (decision.kind === 'buy_healing') return 'trade';
  return decision.kind;
}

function firstHealingItemId(inventory: InventoryEntry[]) {
  return [...inventory]
    .filter((item) => item.qty > 0 && healingAmount(item.itemId) !== null)
    .sort((left, right) => left.itemId.localeCompare(right.itemId))[0]?.itemId;
}

function inventoryQuantity(inventory: InventoryEntry[], itemId: string) {
  const quantity = inventory.find((item) => item.itemId === itemId)?.qty ?? 0;
  return Number.isInteger(quantity) && quantity > 0 ? quantity : 0;
}

function outgoingItemId(proposal: AutonomousReserveProposal) {
  const params = proposal.params ?? {};
  if (proposal.type === 'use_item' || proposal.type === 'gift') {
    return typeof params.itemId === 'string' ? params.itemId : undefined;
  }
  if (proposal.type === 'trade') {
    return typeof params.offeredItemId === 'string'
      ? params.offeredItemId
      : undefined;
  }
  return undefined;
}

function outgoingQuantity(proposal: AutonomousReserveProposal) {
  const params = proposal.params ?? {};
  if (proposal.type === 'trade' && typeof params.offeredQty === 'number') {
    return Math.max(1, Math.floor(params.offeredQty));
  }
  return 1;
}

function outgoingSpiritStoneQuantity(proposal: AutonomousReserveProposal) {
  const params = proposal.params ?? {};
  if (
    proposal.type === 'cultivate' &&
    params.cultivationMode === 'spirit_stone'
  ) {
    return 1;
  }
  const itemId = outgoingItemId(proposal);
  return itemId === 'spirit_stone' ? outgoingQuantity(proposal) : 0;
}
