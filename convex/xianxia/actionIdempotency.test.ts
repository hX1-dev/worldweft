import { actionIdempotencyFingerprint, stableJson } from './actionIdempotency';

describe('action idempotency contract', () => {
  test('canonicalizes semantic params independently of object key order', () => {
    const left = actionIdempotencyFingerprint({
      type: 'trade',
      actorId: 'player',
      targetActorId: 'merchant',
      locationId: 'market',
      source: 'human',
      params: { requestedQty: 2, nested: { b: 2, a: 1 } },
      metadata: { mapId: 'qinglan', preparedAt: 100, actorTile: { x: 1, y: 2 } },
    });
    const right = actionIdempotencyFingerprint({
      type: 'trade',
      actorId: 'player',
      targetActorId: 'merchant',
      locationId: 'market',
      source: 'human',
      params: { nested: { a: 1, b: 2 }, requestedQty: 2 },
      metadata: { actorTile: { y: 99, x: 99 }, preparedAt: 200, mapId: 'qinglan' },
    });
    expect(left).toBe(right);
  });

  test('changes when durable action semantics change', () => {
    const base = {
      type: 'gift',
      actorId: 'player',
      targetActorId: 'merchant',
      locationId: 'market',
      source: 'human',
      params: { itemId: 'spirit_stone' },
      metadata: { mapId: 'qinglan' },
    };
    expect(actionIdempotencyFingerprint(base)).not.toBe(
      actionIdempotencyFingerprint({ ...base, targetActorId: 'guard' }),
    );
    expect(actionIdempotencyFingerprint(base)).not.toBe(
      actionIdempotencyFingerprint({ ...base, params: { itemId: 'spirit_herb' } }),
    );
  });

  test('stableJson preserves array order and sorts object keys', () => {
    expect(stableJson({ z: [2, 1], a: { d: 4, c: 3 } })).toBe(
      '{"a":{"c":3,"d":4},"z":[2,1]}',
    );
  });
});
