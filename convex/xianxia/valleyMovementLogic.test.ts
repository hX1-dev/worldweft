import { QINGLAN_VALLEY_GATE_DATA } from '../../data/qinglanValleyGate.generated';
import {
  MOVEMENT_LEASE_MS,
  type MovementReport,
} from './valleyMovementContracts';
import {
  evaluateMovementReport,
  findValleyPath,
  isValleySegmentWalkable,
  isStaleMovementRevision,
  isValleyTileWalkable,
  nextMovementRevision,
  resolveValleyMovementTarget,
  valleyMaskTypeAt,
  type MovementCommandSnapshot,
  type ValleyMapData,
} from './valleyMovementLogic';

const DATA = QINGLAN_VALLEY_GATE_DATA as ValleyMapData;

describe('qinglan_valley_gate movement target resolver', () => {
  test('generated 48x36 mask is the only navigation authority', () => {
    expect(DATA).toMatchObject({
      mapId: 'qinglan_valley_gate',
      width: 48,
      height: 36,
      navigableTypes: ['walkable', 'grass', 'dock'],
    });
    expect(DATA.cells).toHaveLength(36);
    expect(DATA.cells.every((row) => row.length === 48)).toBe(true);
    expect(isValleyTileWalkable({ x: 4, y: 18 }, DATA)).toBe(true);
    expect(['collision', 'occlusion', 'water']).toContain(
      valleyMaskTypeAt({ x: 0, y: 0 }, DATA),
    );
  });

  test('location resolves deterministically to an unoccupied reachable stand tile', () => {
    const input = {
      actorId: 'qinglan_valley_gate:resting_disciple',
      revision: 1,
      currentTile: { x: 11, y: 10 },
      requestedTarget: { kind: 'location' as const, locationId: 'creek_bridge' },
      occupiedTiles: [{ x: 24, y: 18 }],
      data: DATA,
    };
    const first = resolveValleyMovementTarget(input);
    const second = resolveValleyMovementTarget(input);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.resolvedLocationId).toBe('creek_bridge');
    expect(first.acceptedTile).not.toEqual({ x: 24, y: 18 });
    expect(first.path.length).toBeGreaterThan(1);
    expect(first.path.every((tile) => isValleyTileWalkable(tile, DATA))).toBe(true);
  });

  test('semantic location selects the shortest reachable stand tile before tie-breaking', () => {
    const data: ValleyMapData = {
      ...tinyMap([['walkable', 'walkable', 'walkable', 'walkable', 'walkable']]),
      locations: [
        {
          id: 'linear_place',
          bounds: { x: 2, y: 0, width: 3, height: 1 },
          entryPoint: { x: 2, y: 0 },
        },
      ],
    };
    const base = {
      actorId: 'actor-a',
      revision: 1,
      currentTile: { x: 0, y: 0 },
      requestedTarget: { kind: 'location' as const, locationId: 'linear_place' },
      data,
    };

    expect(resolveValleyMovementTarget(base)).toMatchObject({
      ok: true,
      acceptedTile: { x: 2, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    });
    expect(
      resolveValleyMovementTarget({ ...base, occupiedTiles: [{ x: 2, y: 0 }] }),
    ).toMatchObject({ ok: true, acceptedTile: { x: 3, y: 0 } });
  });

  test('two actors reserve different stand tiles inside the same location', () => {
    const actorTiles = DATA.npcPoints.map((point) => ({
      actorId: `${DATA.mapId}:${point.id}`,
      tile: point.tile,
    }));
    const bridge = DATA.locations.find((location) => location.id === 'creek_bridge')!;
    const first = resolveValleyMovementTarget({
      actorId: 'qinglan_valley_gate:valley_guide',
      revision: 1,
      currentTile: { x: 4, y: 18 },
      requestedTarget: { kind: 'location', locationId: bridge.id },
      actorTiles,
      data: DATA,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = resolveValleyMovementTarget({
      actorId: 'qinglan_valley_gate:resting_disciple',
      revision: 1,
      currentTile: { x: 11, y: 10 },
      requestedTarget: { kind: 'location', locationId: bridge.id },
      actorTiles,
      occupiedTiles: [first.acceptedTile],
      data: DATA,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.acceptedTile).not.toEqual(first.acceptedTile);
    for (const tile of [first.acceptedTile, second.acceptedTile]) {
      expect(tile.x).toBeGreaterThanOrEqual(bridge.bounds.x);
      expect(tile.y).toBeGreaterThanOrEqual(bridge.bounds.y);
      expect(tile.x).toBeLessThan(bridge.bounds.x + bridge.bounds.width);
      expect(tile.y).toBeLessThan(bridge.bounds.y + bridge.bounds.height);
    }
  });

  test('self exclusion never erases another actor or reservation on the start tile', () => {
    const data = tinyMap([['walkable', 'walkable']]);
    const input = {
      actorId: 'actor-a',
      revision: 1,
      currentTile: { x: 0, y: 0 },
      requestedTarget: { kind: 'point' as const, tile: { x: 0, y: 0 } },
      data,
    };

    expect(
      resolveValleyMovementTarget({
        ...input,
        actorTiles: [
          { actorId: 'actor-a', tile: { x: 0, y: 0 } },
          { actorId: 'actor-b', tile: { x: 0, y: 0 } },
        ],
      }),
    ).toMatchObject({ ok: false, reasonCode: 'no_legal_target' });
    expect(
      resolveValleyMovementTarget({
        ...input,
        occupiedTiles: [{ x: 0, y: 0 }],
      }),
    ).toMatchObject({ ok: false, reasonCode: 'no_legal_target' });
  });

  test('zone is a compatibility alias for a semantic location', () => {
    const result = resolveValleyMovementTarget({
      actorId: 'qinglan_valley_gate:valley_guide',
      revision: 2,
      currentTile: { x: 4, y: 18 },
      requestedTarget: { kind: 'zone', zoneId: 'rest_clearing' },
      data: DATA,
    });
    expect(result).toMatchObject({ ok: true, resolvedLocationId: 'rest_clearing' });
  });

  test('actor target selects a legal 1-2 tile approach slot, not the occupied body', () => {
    const targetTile = { x: 20, y: 18 };
    const result = resolveValleyMovementTarget({
      actorId: 'qinglan_valley_gate:resting_disciple',
      revision: 3,
      currentTile: { x: 11, y: 10 },
      requestedTarget: {
        kind: 'actor',
        actorId: 'qinglan_valley_gate:bridge_guard',
        preferredDistanceTiles: 1,
      },
      actorTiles: [
        { actorId: 'qinglan_valley_gate:bridge_guard', tile: targetTile },
        { actorId: 'qinglan_valley_gate:resting_disciple', tile: { x: 11, y: 10 } },
      ],
      data: DATA,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.acceptedTile).not.toEqual(targetTile);
    const distance = Math.max(
      Math.abs(result.acceptedTile.x - targetTile.x),
      Math.abs(result.acceptedTile.y - targetTile.y),
    );
    expect(distance).toBeGreaterThanOrEqual(1);
    expect(distance).toBeLessThanOrEqual(2);
  });

  test('interactable resolves to its generated legal tile and semantic location', () => {
    const result = resolveValleyMovementTarget({
      actorId: 'qinglan_valley_gate:valley_guide',
      revision: 4,
      currentTile: { x: 4, y: 18 },
      requestedTarget: { kind: 'interactable', interactionId: 'bridge_inscription' },
      data: DATA,
    });
    expect(result).toMatchObject({ ok: true, resolvedLocationId: 'creek_bridge' });
    if (result.ok) expect(isValleyTileWalkable(result.acceptedTile, DATA)).toBe(true);
  });

  test('occupied interactable and legal point targets reject without snapping', () => {
    expect(
      resolveValleyMovementTarget({
        actorId: 'qinglan_valley_gate:valley_guide',
        revision: 5,
        currentTile: { x: 4, y: 18 },
        requestedTarget: {
          kind: 'interactable',
          interactionId: 'bridge_inscription',
        },
        occupiedTiles: [{ x: 24, y: 18 }],
        data: DATA,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'no_legal_target' });

    const data = tinyMap([['walkable', 'walkable', 'walkable']]);
    expect(
      resolveValleyMovementTarget({
        actorId: 'actor',
        revision: 1,
        currentTile: { x: 0, y: 0 },
        requestedTarget: { kind: 'point', tile: { x: 1, y: 0 } },
        occupiedTiles: [{ x: 1, y: 0 }],
        data,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'no_legal_target' });
  });

  test('point target is range-limited and snaps blocked cells by at most two tiles', () => {
    const custom = tinyMap([
      ['walkable', 'walkable', 'walkable', 'walkable'],
      ['walkable', 'collision', 'collision', 'walkable'],
      ['walkable', 'walkable', 'walkable', 'walkable'],
    ]);
    const snapped = resolveValleyMovementTarget({
      actorId: 'actor',
      revision: 1,
      currentTile: { x: 0, y: 1 },
      requestedTarget: { kind: 'point', tile: { x: 1, y: 1 } },
      data: custom,
    });
    expect(snapped.ok).toBe(true);
    if (snapped.ok) {
      expect(isValleyTileWalkable(snapped.acceptedTile, custom)).toBe(true);
      expect(Math.hypot(snapped.acceptedTile.x - 1, snapped.acceptedTile.y - 1)).toBe(1);
    }

    expect(
      resolveValleyMovementTarget({
        actorId: 'actor',
        revision: 2,
        currentTile: { x: 4, y: 18 },
        requestedTarget: { kind: 'point', tile: { x: 46, y: 18 } },
        data: DATA,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'point_too_far' });
  });

  test('unreachable target is rejected instead of receiving a fixed fallback route', () => {
    const custom = tinyMap([['walkable', 'collision', 'walkable']]);
    expect(
      resolveValleyMovementTarget({
        actorId: 'actor',
        revision: 1,
        currentTile: { x: 0, y: 0 },
        requestedTarget: { kind: 'point', tile: { x: 2, y: 0 } },
        data: custom,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'target_unreachable' });
    expect(findValleyPath({ x: 0, y: 0 }, { x: 2, y: 0 }, custom)).toEqual([]);
  });
});

describe('movement report state machine', () => {
  const issuedAt = 10_000;
  const baseCommand: MovementCommandSnapshot = {
    actorId: 'qinglan_valley_gate:valley_guide',
    revision: 7,
    status: 'pending',
    originTile: { x: 4, y: 18 },
    acceptedTile: { x: 6, y: 18 },
    lastTile: { x: 4, y: 18 },
    issuedAt,
    expiresAt: issuedAt + MOVEMENT_LEASE_MS,
  };

  test('requires pending -> accepted and extends a rolling 60 second lease', () => {
    const now = issuedAt + 500;
    const decision = evaluateMovementReport(
      baseCommand,
      report({ status: 'accepted', positionTiles: { x: 4, y: 18 } }),
      now,
      DATA,
    );
    expect(decision).toMatchObject({
      ok: true,
      patch: { status: 'accepted', expiresAt: now + MOVEMENT_LEASE_MS },
    });
    expect(
      evaluateMovementReport(
        baseCommand,
        report({ status: 'moving', positionTiles: { x: 4, y: 18 } }),
        now,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_transition' });
  });

  test('rejects stale revision, wrong actor and expired leases', () => {
    expect(
      evaluateMovementReport(
        baseCommand,
        { ...report({ status: 'accepted', positionTiles: { x: 4, y: 18 } }), revision: 6 },
        issuedAt + 100,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'stale_revision' });
    expect(
      evaluateMovementReport(
        baseCommand,
        {
          ...report({ status: 'accepted', positionTiles: { x: 4, y: 18 } }),
          actorId: 'other',
        },
        issuedAt + 100,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'actor_mismatch' });
    expect(
      evaluateMovementReport(
        baseCommand,
        report({ status: 'accepted', positionTiles: { x: 4, y: 18 } }),
        baseCommand.expiresAt,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'command_expired' });
  });

  test('checks speed, every crossed segment cell, and arrival tolerance', () => {
    const accepted: MovementCommandSnapshot = {
      ...baseCommand,
      status: 'accepted',
      lastReportedAt: issuedAt + 500,
    };
    expect(
      evaluateMovementReport(
        accepted,
        report({ status: 'moving', positionTiles: { x: 6, y: 18 } }),
        issuedAt + 550,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'speed_exceeded' });

    const blockedMap = tinyMap([['walkable', 'collision', 'walkable']]);
    const blockedCommand: MovementCommandSnapshot = {
      ...accepted,
      originTile: { x: 0, y: 0 },
      lastTile: { x: 0, y: 0 },
      acceptedTile: { x: 2, y: 0 },
    };
    expect(
      evaluateMovementReport(
        blockedCommand,
        report({ status: 'moving', positionTiles: { x: 2, y: 0 } }),
        issuedAt + 5_000,
        blockedMap,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_segment' });
    expect(isValleySegmentWalkable({ x: 0, y: 0 }, { x: 2, y: 0 }, blockedMap)).toBe(false);

    const blockedCorner = tinyMap([
      ['walkable', 'collision'],
      ['collision', 'walkable'],
    ]);
    expect(isValleySegmentWalkable({ x: 0, y: 0 }, { x: 1, y: 1 }, blockedCorner)).toBe(
      false,
    );

    expect(
      evaluateMovementReport(
        { ...accepted, lastTile: { x: 5, y: 18 } },
        report({ status: 'arrived', positionTiles: { x: 5.5, y: 18 } }),
        issuedAt + 2_000,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'not_at_destination' });
    expect(
      evaluateMovementReport(
        { ...accepted, lastTile: { x: 5, y: 18 } },
        report({ status: 'arrived', positionTiles: { x: 6, y: 18 } }),
        issuedAt + 2_000,
        DATA,
      ),
    ).toMatchObject({ ok: true, patch: { status: 'arrived' } });
  });

  test('uses bounded monotonic client sample time so HTTP queue compression cannot fake speeding', () => {
    const accepted: MovementCommandSnapshot = {
      ...baseCommand,
      status: 'accepted',
      lastTile: { x: 5, y: 18 },
      lastReportedAt: issuedAt + 500,
    };
    expect(
      evaluateMovementReport(
        accepted,
        {
          ...report({ status: 'moving', positionTiles: { x: 6, y: 18 } }),
          reportedAt: issuedAt + 650,
        },
        // Only 50ms of server receive time elapsed, but 150ms elapsed between
        // the body samples: 1 tile is below the 10 tile/s limit plus tolerance.
        issuedAt + 550,
        DATA,
      ),
    ).toMatchObject({
      ok: true,
      patch: { lastReportedAt: issuedAt + 650 },
    });
    expect(
      evaluateMovementReport(
        accepted,
        {
          ...report({ status: 'moving', positionTiles: { x: 5.1, y: 18 } }),
          reportedAt: issuedAt + 499,
        },
        issuedAt + 550,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_report_time' });
    expect(
      evaluateMovementReport(
        accepted,
        {
          ...report({ status: 'moving', positionTiles: { x: 5.1, y: 18 } }),
          reportedAt: issuedAt + 6_000,
        },
        issuedAt + 550,
        DATA,
      ),
    ).toMatchObject({ ok: false, code: 'invalid_report_time' });
  });

  test('revision allocation is monotonic regardless of input order', () => {
    expect(nextMovementRevision([{ revision: 4 }, { revision: 9 }, { revision: 2 }])).toBe(10);
    expect(nextMovementRevision([])).toBe(1);
    expect(isStaleMovementRevision(7, { revision: 7 }, { revision: 8 })).toBe(true);
    expect(isStaleMovementRevision(8, { revision: 8 }, { revision: 8 })).toBe(false);
  });

});

function report(
  patch: Pick<MovementReport, 'status' | 'positionTiles'>,
): MovementReport {
  return {
    commandId: 'command',
    revision: 7,
    actorId: 'qinglan_valley_gate:valley_guide',
    reportedAt: 0,
    ...patch,
  };
}

function tinyMap(cells: string[][]): ValleyMapData {
  return {
    mapId: 'test',
    width: cells[0].length,
    height: cells.length,
    tileSize: 32,
    navigableTypes: ['walkable', 'grass', 'dock'],
    cells,
    locations: [],
    npcPoints: [],
    interactions: [],
  };
}
