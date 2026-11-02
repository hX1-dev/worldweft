export type AgentTickRoundRobinSelection = {
  actorIds: string[];
  eligibleCount: number;
  startAfterActorId?: string;
  nextAfterActorId?: string;
  wrapped: boolean;
};

export function isGodotControlledActorId(actorId: string) {
  return actorId === 'godot_player' || actorId.startsWith('godot_smoke_');
}

export function isAutonomousAgentEligible(profile: {
  actorId: string;
  health: number;
  lifeStatus?: 'alive' | 'deceased';
}) {
  return !isGodotControlledActorId(profile.actorId) &&
    !isActorDeceased(profile) &&
    !isActorIncapacitated(profile.health);
}

export function shouldRunAutonomousAgentTick(
  worldAutoTickEnabled: boolean,
  environmentOptIn: string | undefined,
) {
  return worldAutoTickEnabled && environmentOptIn === '1';
}

export function selectBoundedRoundRobinActorIds(
  afterActorIds: string[],
  beginningActorIds: string[],
  requestedLimit: number,
) {
  const ordered = [];
  const seen = new Set<string>();
  for (const actorId of [...afterActorIds, ...beginningActorIds]) {
    if (seen.has(actorId) || isGodotControlledActorId(actorId)) continue;
    seen.add(actorId);
    ordered.push(actorId);
  }
  const limit = Math.min(ordered.length, Math.max(1, Math.floor(requestedLimit)));
  return ordered.slice(0, limit);
}

export function selectRoundRobinActorIds(
  actorIds: string[],
  afterActorId: string | undefined,
  requestedLimit: number,
): AgentTickRoundRobinSelection {
  const eligible = [...new Set(actorIds)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (eligible.length === 0) {
    return {
      actorIds: [],
      eligibleCount: 0,
      startAfterActorId: afterActorId,
      nextAfterActorId: afterActorId,
      wrapped: false,
    };
  }

  const limit = Math.min(eligible.length, Math.max(1, Math.floor(requestedLimit)));
  let startIndex = 0;
  if (afterActorId) {
    const exactIndex = eligible.indexOf(afterActorId);
    if (exactIndex >= 0) {
      startIndex = (exactIndex + 1) % eligible.length;
    } else {
      const nextIndex = eligible.findIndex((actorId) => actorId > afterActorId);
      startIndex = nextIndex >= 0 ? nextIndex : 0;
    }
  }

  const selected = Array.from(
    { length: limit },
    (_, offset) => eligible[(startIndex + offset) % eligible.length],
  );
  return {
    actorIds: selected,
    eligibleCount: eligible.length,
    startAfterActorId: afterActorId,
    nextAfterActorId: selected.at(-1),
    wrapped: startIndex + limit > eligible.length,
  };
}
import {
  isActorDeceased,
  isActorIncapacitated,
} from './lifeStateLogic';
