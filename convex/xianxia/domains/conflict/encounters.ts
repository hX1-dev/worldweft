import type { Doc } from '../../../_generated/dataModel';

export function encounterHasPair(
  encounter: Doc<'combatEncounters'>,
  firstActorId: string,
  secondActorId: string,
) {
  const participants = new Set([encounter.attackerActorId, encounter.defenderActorId]);
  return participants.has(firstActorId) && participants.has(secondActorId);
}

export function combatOpponent(encounter: Doc<'combatEncounters'>, actorId: string) {
  if (encounter.attackerActorId === actorId) return encounter.defenderActorId;
  if (encounter.defenderActorId === actorId) return encounter.attackerActorId;
  return null;
}
