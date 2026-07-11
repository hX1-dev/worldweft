import {
  clampGodotRange,
  evaluateGodotSpatialState,
  godotLocationForTile,
  godotTileDistance,
  godotTileTouchesLocation,
  roundGodotDistance,
} from './godotSpatial';

describe('Godot spatial policy', () => {
  const bounded = {
    id: 'bounded',
    bounds: { x1: 10, y1: 10, x2: 20, y2: 20 },
    entryPoints: [{ x: 10, y: 15 }],
  };
  const entryOnly = {
    id: 'entry',
    entryPoints: [{ x: 30, y: 30 }],
  };

  test('clamps bridge interaction range and rounds reported distances', () => {
    expect(clampGodotRange(undefined)).toBe(5);
    expect(clampGodotRange(0)).toBe(1);
    expect(clampGodotRange(99)).toBe(12);
    expect(roundGodotDistance(godotTileDistance({ x: 0, y: 0 }, { x: 1, y: 1 }))).toBe(1.41);
  });

  test('matches bounds first, then the nearest in-range entry point', () => {
    expect(godotTileTouchesLocation({ x: 15, y: 15 }, bounded, 1)).toBe(true);
    expect(godotLocationForTile({ x: 15, y: 15 }, [entryOnly, bounded], 2)?.id).toBe('bounded');
    expect(godotLocationForTile({ x: 28, y: 30 }, [bounded, entryOnly], 3)?.id).toBe('entry');
    expect(godotLocationForTile({ x: 50, y: 50 }, [bounded, entryOnly], 3)).toBeNull();
  });

  test('rejects target state that changed after preparation', () => {
    const current = {
      type: 'talk',
      actorId: 'player',
      targetActorId: 'merchant',
      mapId: 'qinglan',
      locationId: 'tea_stall',
      actorTile: { x: 12, y: 12 },
      actorProfile: { mapId: 'qinglan', currentLocationId: 'tea_stall' },
      targetResident: {
        mapId: 'qinglan',
        currentLocationId: 'tea_stall',
        displayTile: { x: 13, y: 12 },
      },
      location: {
        mapId: 'qinglan',
        bounds: { x1: 10, y1: 10, x2: 20, y2: 20 },
        entryPoints: [{ x: 10, y: 15 }],
      },
    };
    expect(evaluateGodotSpatialState(current)).toBeNull();
    expect(
      evaluateGodotSpatialState({
        ...current,
        actorProfile: { mapId: 'qinglan', currentLocationId: 'medicine_shop' },
      }),
    ).toMatchObject({ resultCode: 'actor_not_at_location' });
    expect(
      evaluateGodotSpatialState({
        ...current,
        targetResident: { ...current.targetResident, currentLocationId: 'west_gate' },
      }),
    ).toMatchObject({ resultCode: 'target_not_present' });
    expect(
      evaluateGodotSpatialState({
        ...current,
        targetResident: { ...current.targetResident, displayTile: { x: 40, y: 40 } },
      }),
    ).toMatchObject({ resultCode: 'target_out_of_range' });
  });

  test('allows arrive without prior semantic location but rechecks current geometry', () => {
    const arrive = {
      type: 'arrive',
      actorId: 'player',
      mapId: 'qinglan',
      locationId: 'tea_stall',
      actorTile: { x: 12, y: 12 },
      actorProfile: { mapId: 'qinglan', currentLocationId: 'west_gate' },
      location: {
        mapId: 'qinglan',
        bounds: { x1: 10, y1: 10, x2: 20, y2: 20 },
        entryPoints: [{ x: 10, y: 15 }],
      },
    };
    expect(evaluateGodotSpatialState(arrive)).toBeNull();
    expect(
      evaluateGodotSpatialState({ ...arrive, actorTile: { x: 60, y: 60 } }),
    ).toMatchObject({ resultCode: 'location_out_of_range' });
  });
});
