import {
  boundedObservedWorldPressures,
  selectHerbMiasmaScope,
  shouldResolveWorldPressure,
  worldDirectorStartGate,
} from './worldPressureLogic';

describe('bounded world director pure policy', () => {
  test('selects the first deterministic same-location spirit-herb scope', () => {
    expect(
      selectHerbMiasmaScope([
        { resourceNodeId: 'z', mapId: 'b', locationId: 'hill', itemId: 'spirit_herb' },
        { resourceNodeId: 'c', mapId: 'a', locationId: 'slope', itemId: 'ore' },
        { resourceNodeId: 'b', mapId: 'a', locationId: 'slope', itemId: 'spirit_herb' },
        { resourceNodeId: 'a', mapId: 'a', locationId: 'slope', itemId: 'spirit_herb' },
      ]),
    ).toEqual({
      mapId: 'a',
      locationId: 'slope',
      affectedResourceNodeIds: ['a', 'b'],
    });
  });

  test('honors map scope and refuses when no compatible herb source exists', () => {
    const nodes = [
      { resourceNodeId: 'herb', mapId: 'a', locationId: 'slope', itemId: 'spirit_herb' },
    ];
    expect(selectHerbMiasmaScope(nodes, 'b')).toBeNull();
    expect(selectHerbMiasmaScope(nodes, 'a')?.affectedResourceNodeIds).toEqual(['herb']);
  });

  test.each([
    [{ enabled: false, activePressureCount: 0, nowGameHour: 10 }, 'disabled'],
    [{ enabled: true, activePressureCount: 1, nowGameHour: 10 }, 'active_pressure'],
    [
      { enabled: true, activePressureCount: 0, nowGameHour: 10, nextEligibleGameHour: 11 },
      'cooldown',
    ],
  ] as const)('rejects disabled, active and cooldown gates', (input, reason) => {
    expect(worldDirectorStartGate(input)).toEqual({ ok: false, reason });
  });

  test('expired active pressure resolves even when new starts may be disabled', () => {
    expect(shouldResolveWorldPressure({ status: 'active', endsAtGameHour: 12 }, 12)).toBe(true);
    expect(shouldResolveWorldPressure({ status: 'active', endsAtGameHour: 12 }, 11)).toBe(false);
  });

  test('observation is bounded and deterministically ranks severity then expiry', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      pressureId: `p${index}`,
      severity: 50 + (index % 3),
      endsAtGameHour: 20 - index,
    }));
    expect(boundedObservedWorldPressures(rows).map((row) => row.pressureId)).toEqual([
      'p5',
      'p2',
      'p4',
      'p1',
    ]);
  });
});
