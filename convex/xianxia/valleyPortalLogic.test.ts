import {
  resolveValleyPortal,
  selectPortalDestinationTile,
  validateValleyPortalArrival,
} from './valleyPortalLogic';

const actorId = 'qinglan_valley_gate:resting_disciple';
const west = resolveValleyPortal('west_return_portal');
if (!west.ok) throw new Error('west portal fixture missing');
const westPortal = west.portal;

function validArrival() {
  return {
    actorId,
    portal: westPortal,
    profile: {
      mapId: 'qinglan_valley_gate',
      currentLocationId: 'valley_west_entry',
    },
    resident: {
      actorId,
      mapId: 'qinglan_valley_gate',
      currentLocationId: 'valley_west_entry',
      displayTile: { x: 1, y: 18 },
    },
    command: {
      actorId,
      mapId: 'qinglan_valley_gate',
      status: 'arrived',
      requestedTarget: {
        kind: 'interactable',
        interactionId: 'west_return_portal',
      },
      acceptedTile: { x: 1, y: 18 },
      lastTile: { x: 1.1, y: 18 },
      resolvedLocationId: 'valley_west_entry',
    },
    reportedTile: { x: 1, y: 18 },
  } as const;
}

describe('valley portal contract', () => {
  test('only the west return portal has an explicit destination', () => {
    expect(west).toEqual({
      ok: true,
      portal: {
        portalId: 'west_return_portal',
        sourceMapId: 'qinglan_valley_gate',
        sourceLocationId: 'valley_west_entry',
        sourceTile: { x: 1, y: 18 },
        destinationMapId: 'qinglan',
        destinationLocationId: 'market_west_gate',
      },
    });
    expect(resolveValleyPortal('mist_gate_portal')).toEqual({
      ok: false,
      reasonCode: 'portal_destination_unavailable',
    });
    expect(resolveValleyPortal('not-a-portal')).toEqual({
      ok: false,
      reasonCode: 'portal_unknown',
    });
  });

  test('requires the same actor, source, exact body and arrived interactable command', () => {
    expect(validateValleyPortalArrival(validArrival())).toEqual({ ok: true });
    expect(
      validateValleyPortalArrival({
        ...validArrival(),
        profile: { mapId: 'qinglan', currentLocationId: 'market_west_gate' },
      }),
    ).toEqual({ ok: false, reasonCode: 'portal_source_mismatch' });
    expect(
      validateValleyPortalArrival({
        ...validArrival(),
        command: { ...validArrival().command, status: 'moving' },
      }),
    ).toEqual({ ok: false, reasonCode: 'portal_not_reached' });
    expect(
      validateValleyPortalArrival({
        ...validArrival(),
        command: {
          ...validArrival().command,
          requestedTarget: { kind: 'location', locationId: 'valley_west_entry' },
        },
      }),
    ).toEqual({ ok: false, reasonCode: 'portal_not_reached' });
    expect(
      validateValleyPortalArrival({
        ...validArrival(),
        reportedTile: { x: 1.5, y: 18 },
      }),
    ).toEqual({ ok: false, reasonCode: 'portal_body_mismatch' });
  });

  test('chooses the first walkable unoccupied destination entry deterministically', () => {
    const entries = [
      { x: 8, y: 20 },
      { x: 18, y: 20 },
      { x: 20, y: 20 },
    ];
    expect(
      selectPortalDestinationTile(entries, [{ x: 8, y: 20 }], (tile) => tile.x !== 20),
    ).toEqual({ x: 18, y: 20 });
    expect(
      selectPortalDestinationTile(
        entries,
        [
          { x: 8, y: 20 },
          { x: 18, y: 20 },
        ],
        (tile) => tile.x !== 20,
      ),
    ).toBeNull();
  });
});
