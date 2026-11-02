import { QINGLAN_VALLEY_GATE_DATA } from '../../data/qinglanValleyGate.generated';
import { QINGLAN_VALLEY_GATE_MAP_ID } from './valleyMovementContracts';

export const VALLEY_INSPECT_TOLERANCE_TILES = 0.25;

export type InspectTile = { x: number; y: number };

export type ValleyInspectionTarget = {
  interactionId: string;
  interactionKind: string;
  mapId: typeof QINGLAN_VALLEY_GATE_MAP_ID;
  locationId: string;
  tile: InspectTile;
  observationId: string;
  observationRevision: number;
  observation: string;
};

export type ValleyInspectionLookup =
  | { ok: true; target: ValleyInspectionTarget }
  | {
      ok: false;
      reasonCode: 'inspect_target_unknown' | 'inspect_action_forbidden';
    };

export type InspectArrivalCommand = {
  actorId: string;
  mapId: string;
  status: string;
  requestedTarget: unknown;
  acceptedTile: InspectTile;
  lastTile: InspectTile;
  resolvedLocationId?: string;
};

export function resolveValleyInspection(interactionId: string): ValleyInspectionLookup {
  const interaction = QINGLAN_VALLEY_GATE_DATA.interactions.find(
    (entry) => entry.id === interactionId,
  );
  if (!interaction) return { ok: false, reasonCode: 'inspect_target_unknown' };
  if (!(interaction.actions as readonly string[]).includes('inspect')) {
    return { ok: false, reasonCode: 'inspect_action_forbidden' };
  }
  if (!('inspection' in interaction)) {
    return { ok: false, reasonCode: 'inspect_target_unknown' };
  }
  const inspection = interaction.inspection;
  if (
    !inspection ||
    typeof inspection.observationId !== 'string' ||
    !Number.isInteger(inspection.revision) ||
    inspection.revision < 1 ||
    typeof inspection.observation !== 'string' ||
    !inspection.observation.trim()
  ) {
    return { ok: false, reasonCode: 'inspect_target_unknown' };
  }
  return {
    ok: true,
    target: {
      interactionId: interaction.id,
      interactionKind: interaction.kind,
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      locationId: interaction.locationId,
      tile: interaction.tile,
      observationId: inspection.observationId,
      observationRevision: inspection.revision,
      observation: inspection.observation,
    },
  };
}

export function validateValleyInspectionArrival(args: {
  actorId: string;
  target: ValleyInspectionTarget;
  profile: { mapId?: string; currentLocationId?: string };
  resident: {
    actorId: string;
    mapId: string;
    currentLocationId: string;
    displayTile: InspectTile;
  } | null;
  command: InspectArrivalCommand | null;
  reportedTile?: InspectTile;
}):
  | { ok: true }
  | {
      ok: false;
      reasonCode:
        | 'inspect_source_mismatch'
        | 'inspect_not_reached'
        | 'inspect_body_mismatch';
    } {
  const { target, profile, resident, command } = args;
  if (
    profile.mapId !== target.mapId ||
    profile.currentLocationId !== target.locationId ||
    !resident ||
    resident.actorId !== args.actorId ||
    resident.mapId !== target.mapId ||
    resident.currentLocationId !== target.locationId
  ) {
    return { ok: false, reasonCode: 'inspect_source_mismatch' };
  }

  const requestedTarget = objectOrEmpty(command?.requestedTarget);
  if (
    !command ||
    command.actorId !== args.actorId ||
    command.mapId !== target.mapId ||
    command.status !== 'arrived' ||
    requestedTarget.kind !== 'interactable' ||
    requestedTarget.interactionId !== target.interactionId ||
    command.resolvedLocationId !== target.locationId ||
    tileDistance(command.acceptedTile, target.tile) > VALLEY_INSPECT_TOLERANCE_TILES ||
    tileDistance(command.lastTile, target.tile) > VALLEY_INSPECT_TOLERANCE_TILES
  ) {
    return { ok: false, reasonCode: 'inspect_not_reached' };
  }

  if (
    tileDistance(resident.displayTile, target.tile) > VALLEY_INSPECT_TOLERANCE_TILES ||
    !args.reportedTile ||
    tileDistance(args.reportedTile, resident.displayTile) > VALLEY_INSPECT_TOLERANCE_TILES
  ) {
    return { ok: false, reasonCode: 'inspect_body_mismatch' };
  }
  return { ok: true };
}

function tileDistance(left: InspectTile, right: InspectTile) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
