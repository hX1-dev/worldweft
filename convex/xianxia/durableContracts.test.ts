import {
  normalizeDurableActionMetadata,
  toDurableActionResult,
  versionDurableEventFacts,
} from './durableContracts';

describe('durable xianxia contracts', () => {
  test('versions event facts without changing adjudicated fields', () => {
    expect(
      versionDurableEventFacts({ resultCode: 'conversation_started', source: 'godot' }),
    ).toEqual({
      schemaVersion: 1,
      resultCode: 'conversation_started',
      source: 'godot',
    });
  });

  test('stores only bounded action metadata fields', () => {
    expect(
      normalizeDurableActionMetadata({
        client: 'godot',
        mapId: 'qinglan',
        actorTile: { x: 4, y: 9, invented: true },
        interactionRangeTiles: 5,
        preparedAt: 123,
        test: 'bridge-smoke',
        durableState: { reputation: 999 },
      }),
    ).toEqual({
      schemaVersion: 1,
      client: 'godot',
      mapId: 'qinglan',
      actorTile: { x: 4, y: 9 },
      interactionRangeTiles: 5,
      preparedAt: 123,
      test: 'bridge-smoke',
    });
  });

  test('versions a resolved action result and keeps debug reproducibility data', () => {
    expect(
      toDurableActionResult(
        {
          status: 'applied',
          resultCode: 'arrived_location',
          reason: 'Arrived.',
          effects: {
            locationChange: {
              toMapId: 'qinglan',
              toLocationId: 'market_main_street',
            },
          },
          eventType: 'actor_arrived_location',
          visibility: 'local',
        },
        { seed: 'seed-1', roll: 0.25 },
      ),
    ).toMatchObject({
      schemaVersion: 1,
      status: 'applied',
      resultCode: 'arrived_location',
      debug: { seed: 'seed-1', roll: 0.25 },
    });
  });
});
