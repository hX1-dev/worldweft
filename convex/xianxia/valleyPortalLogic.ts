import { QINGLAN_VALLEY_GATE_DATA } from '../../data/qinglanValleyGate.generated';
import { QINGLAN_VALLEY_GATE_MAP_ID } from './valleyMovementContracts';

export const VALLEY_PORTAL_ARRIVAL_TOLERANCE_TILES = 0.25;

export type PortalTile = { x: number; y: number };

export type AvailableValleyPortal = {
  portalId: string;
  sourceMapId: typeof QINGLAN_VALLEY_GATE_MAP_ID;
  sourceLocationId: string;
  sourceTile: PortalTile;
  destinationMapId: string;
  destinationLocationId: string;
};

export type ValleyPortalLookup =
  | { ok: true; portal: AvailableValleyPortal }
  | { ok: false; reasonCode: 'portal_unknown' | 'portal_destination_unavailable' };

export type PortalArrivalCommand = {
  actorId: string;
  mapId: string;
  status: string;
  requestedTarget: unknown;
  acceptedTile: PortalTile;
  lastTile: PortalTile;
  resolvedLocationId?: string;
};

export function resolveValleyPortal(portalId: string): ValleyPortalLookup {
  const interaction = QINGLAN_VALLEY_GATE_DATA.interactions.find(
    (entry) => entry.id === portalId,
  );
  if (!interaction || interaction.kind !== 'portal') {
    return { ok: false, reasonCode: 'portal_unknown' };
  }
  if (
    !('portal' in interaction) ||
    interaction.portal.status !== 'available' ||
    !('destinationMapId' in interaction.portal) ||
    !('destinationLocationId' in interaction.portal)
  ) {
    return { ok: false, reasonCode: 'portal_destination_unavailable' };
  }
  return {
    ok: true,
    portal: {
      portalId: interaction.id,
      sourceMapId: QINGLAN_VALLEY_GATE_MAP_ID,
      sourceLocationId: interaction.locationId,
      sourceTile: interaction.tile,
      destinationMapId: interaction.portal.destinationMapId,
      destinationLocationId: interaction.portal.destinationLocationId,
    },
  };
}

export function validateValleyPortalArrival(args: {
  actorId: string;
  portal: AvailableValleyPortal;
  profile: { mapId?: string; currentLocationId?: string };
  resident: {
    actorId: string;
    mapId: string;
    currentLocationId: string;
    displayTile: PortalTile;
  } | null;
  command: PortalArrivalCommand | null;
  reportedTile?: PortalTile;
}):
  | { ok: true }
  | {
      ok: false;
      reasonCode: 'portal_source_mismatch' | 'portal_not_reached' | 'portal_body_mismatch';
    } {
  const { portal, profile, resident, command } = args;
  if (
    profile.mapId !== portal.sourceMapId ||
    profile.currentLocationId !== portal.sourceLocationId ||
    !resident ||
    resident.actorId !== args.actorId ||
    resident.mapId !== portal.sourceMapId ||
    resident.currentLocationId !== portal.sourceLocationId
  ) {
    return { ok: false, reasonCode: 'portal_source_mismatch' };
  }

  const requestedTarget = objectOrEmpty(command?.requestedTarget);
  if (
    !command ||
    command.actorId !== args.actorId ||
    command.mapId !== portal.sourceMapId ||
    command.status !== 'arrived' ||
    requestedTarget.kind !== 'interactable' ||
    requestedTarget.interactionId !== portal.portalId ||
    command.resolvedLocationId !== portal.sourceLocationId ||
    tileDistance(command.acceptedTile, portal.sourceTile) >
      VALLEY_PORTAL_ARRIVAL_TOLERANCE_TILES ||
    tileDistance(command.lastTile, portal.sourceTile) >
      VALLEY_PORTAL_ARRIVAL_TOLERANCE_TILES
  ) {
    return { ok: false, reasonCode: 'portal_not_reached' };
  }

  if (
    tileDistance(resident.displayTile, portal.sourceTile) >
      VALLEY_PORTAL_ARRIVAL_TOLERANCE_TILES ||
    !args.reportedTile ||
    tileDistance(args.reportedTile, resident.displayTile) >
      VALLEY_PORTAL_ARRIVAL_TOLERANCE_TILES
  ) {
    return { ok: false, reasonCode: 'portal_body_mismatch' };
  }
  return { ok: true };
}

export function selectPortalDestinationTile(
  entryPoints: readonly PortalTile[],
  occupiedTiles: readonly PortalTile[],
  isWalkable: (tile: PortalTile) => boolean = () => true,
): PortalTile | null {
  for (const entry of entryPoints) {
    if (!isFiniteTile(entry) || !isWalkable(entry)) continue;
    const occupied = occupiedTiles.some(
      (tile) => tileDistance(entry, tile) <= VALLEY_PORTAL_ARRIVAL_TOLERANCE_TILES,
    );
    if (!occupied) return { x: entry.x, y: entry.y };
  }
  return null;
}

export function tileDistance(left: PortalTile, right: PortalTile) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isFiniteTile(tile: PortalTile) {
  return Number.isFinite(tile.x) && Number.isFinite(tile.y);
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
