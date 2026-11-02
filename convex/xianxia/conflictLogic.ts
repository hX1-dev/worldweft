import { clamp, realmRank, type ActorSnapshot } from './rules';

export const ATTACK_EXECUTION_DURATION_MS = 4_000;
export const FLEE_EXECUTION_DURATION_MS = 3_000;
export const LOOT_EXECUTION_DURATION_MS = 3_000;
export const LOOT_PROTECTION_MS = 60_000;
export const GUARD_ATTACK_REPUTATION_DELTA = -6;
export const GUARD_LOOT_REPUTATION_DELTA = -4;

export type CombatParticipant = Pick<
  ActorSnapshot,
  'actorId' | 'name' | 'realm' | 'realmStage' | 'mood' | 'health' | 'spirit'
>;

export function hostileCombatPower(actor: CombatParticipant) {
  return (
    realmRank(actor.realm) * 100 +
    actor.realmStage * 10 +
    clamp(actor.mood, -10, 10) +
    clamp(actor.health, 0, 20) +
    clamp(actor.spirit, -10, 20) * 2
  );
}

/** Damage is deliberately low and bounded. The model never supplies it. */
export function resolveAttackDamage(input: {
  attacker: CombatParticipant;
  defender: CombatParticipant;
  roll: number;
}) {
  const advantage = hostileCombatPower(input.attacker) - hostileCombatPower(input.defender);
  const base = input.roll >= 0.67 ? 4 : input.roll >= 0.25 ? 3 : 2;
  const modifier = advantage >= 60 ? 1 : advantage <= -60 ? -1 : 0;
  return clamp(base + modifier, 2, 4);
}

export function resolveFlee(input: {
  fleeing: CombatParticipant;
  opponent: CombatParticipant;
  roll: number;
}) {
  const powerDelta = hostileCombatPower(input.fleeing) - hostileCombatPower(input.opponent);
  const chance = clamp(0.55 + powerDelta / 400, 0.2, 0.85);
  return { escaped: input.roll < chance, chance };
}

export function lootPriorityAllows(input: {
  actorId: string;
  lootOwnerActorId?: string;
  lootProtectedUntil?: number;
  now: number;
}) {
  return (
    !input.lootOwnerActorId ||
    input.lootOwnerActorId === input.actorId ||
    (input.lootProtectedUntil ?? 0) <= input.now
  );
}

export function inventoryHasUnreservedTargetItem(
  inventory: readonly { itemId: string; qty: number }[] | undefined,
  itemId: string,
  reserved: number,
) {
  const owned = inventory?.find((item) => item.itemId === itemId)?.qty ?? 0;
  return owned - Math.max(0, reserved) >= 1;
}

