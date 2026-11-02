import {
  WORLD_PRESSURE_LIMITS,
  type WorldPressureStatus,
} from './worldPressureContracts';

export type PressureResourceNode = {
  resourceNodeId: string;
  mapId: string;
  locationId: string;
  itemId: string;
};

export type WorldPressureScope = {
  mapId: string;
  locationId: string;
  affectedResourceNodeIds: string[];
};

export function selectHerbMiasmaScope(
  nodes: PressureResourceNode[],
  requestedMapId?: string,
): WorldPressureScope | null {
  const compatible = nodes
    .filter(
      (node) =>
        node.itemId === 'spirit_herb' &&
        (!requestedMapId || node.mapId === requestedMapId),
    )
    .sort(
      (left, right) =>
        left.mapId.localeCompare(right.mapId) ||
        left.locationId.localeCompare(right.locationId) ||
        left.resourceNodeId.localeCompare(right.resourceNodeId),
    );
  const first = compatible[0];
  if (!first) return null;
  return {
    mapId: first.mapId,
    locationId: first.locationId,
    affectedResourceNodeIds: compatible
      .filter(
        (node) =>
          node.mapId === first.mapId && node.locationId === first.locationId,
      )
      .slice(0, WORLD_PRESSURE_LIMITS.affectedResourceNodes)
      .map((node) => node.resourceNodeId),
  };
}

export function shouldResolveWorldPressure(
  pressure: { status: WorldPressureStatus; endsAtGameHour: number },
  nowGameHour: number,
) {
  return pressure.status === 'active' && nowGameHour >= pressure.endsAtGameHour;
}

export function worldDirectorStartGate(input: {
  enabled: boolean;
  activePressureCount: number;
  nowGameHour: number;
  nextEligibleGameHour?: number;
}):
  | { ok: true }
  | {
      ok: false;
      reason: 'disabled' | 'active_pressure' | 'cooldown';
    } {
  if (!input.enabled) return { ok: false, reason: 'disabled' };
  if (input.activePressureCount >= WORLD_PRESSURE_LIMITS.activePerWorld) {
    return { ok: false, reason: 'active_pressure' };
  }
  if (
    input.nextEligibleGameHour !== undefined &&
    input.nowGameHour < input.nextEligibleGameHour
  ) {
    return { ok: false, reason: 'cooldown' };
  }
  return { ok: true };
}

export function boundedObservedWorldPressures<T extends {
  pressureId: string;
  severity: number;
  endsAtGameHour: number;
}>(pressures: T[]): T[] {
  return [...pressures]
    .sort(
      (left, right) =>
        right.severity - left.severity ||
        left.endsAtGameHour - right.endsAtGameHour ||
        left.pressureId.localeCompare(right.pressureId),
    )
    .slice(0, WORLD_PRESSURE_LIMITS.observedPerActor);
}
