import {
  resolveValleyInspection,
  validateValleyInspectionArrival,
  type ValleyInspectionTarget,
} from './valleyInspectLogic';

const actorId = 'qinglan_valley_gate:resting_disciple';

function target(): ValleyInspectionTarget {
  const resolved = resolveValleyInspection('bridge_inscription');
  if (!resolved.ok) throw new Error('bridge inspection fixture is missing');
  return resolved.target;
}

function validInput() {
  const inspection = target();
  return {
    actorId,
    target: inspection,
    profile: {
      mapId: inspection.mapId,
      currentLocationId: inspection.locationId,
    },
    resident: {
      actorId,
      mapId: inspection.mapId,
      currentLocationId: inspection.locationId,
      displayTile: inspection.tile,
    },
    command: {
      actorId,
      mapId: inspection.mapId,
      status: 'arrived',
      requestedTarget: {
        kind: 'interactable',
        interactionId: inspection.interactionId,
      },
      acceptedTile: inspection.tile,
      lastTile: inspection.tile,
      resolvedLocationId: inspection.locationId,
    },
    reportedTile: inspection.tile,
  };
}

describe('valley inspect contract', () => {
  test('resolves only server-authored inspect payloads', () => {
    expect(resolveValleyInspection('bridge_inscription')).toMatchObject({
      ok: true,
      target: {
        observationId: 'valley_bridge_inscription_v1',
        observationRevision: 1,
        locationId: 'creek_bridge',
        tile: { x: 24, y: 18 },
      },
    });
    expect(resolveValleyInspection('west_return_portal')).toEqual({
      ok: false,
      reasonCode: 'inspect_action_forbidden',
    });
    expect(resolveValleyInspection('invented_relic')).toEqual({
      ok: false,
      reasonCode: 'inspect_target_unknown',
    });
  });

  test('requires the same arrived interactable command and exact authoritative body', () => {
    expect(validateValleyInspectionArrival(validInput())).toEqual({ ok: true });

    const wrongSource = validInput();
    wrongSource.profile.currentLocationId = 'sealed_shrine';
    expect(validateValleyInspectionArrival(wrongSource)).toEqual({
      ok: false,
      reasonCode: 'inspect_source_mismatch',
    });

    const wrongTarget = validInput();
    wrongTarget.command.requestedTarget.interactionId = 'sealed_shrine_door';
    expect(validateValleyInspectionArrival(wrongTarget)).toEqual({
      ok: false,
      reasonCode: 'inspect_not_reached',
    });

    const moving = validInput();
    moving.command.status = 'moving';
    expect(validateValleyInspectionArrival(moving)).toEqual({
      ok: false,
      reasonCode: 'inspect_not_reached',
    });

    const mismatchedBody = validInput();
    mismatchedBody.reportedTile = { x: 24.26, y: 18 };
    expect(validateValleyInspectionArrival(mismatchedBody)).toEqual({
      ok: false,
      reasonCode: 'inspect_body_mismatch',
    });
  });
});
