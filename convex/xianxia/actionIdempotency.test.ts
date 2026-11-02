import {
  actionIdempotencyFingerprint,
  agentActionClientId,
  stableJson,
} from './actionIdempotency';

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

  test('use_item fingerprint binds the selected inventory item and self-only shape', () => {
    const base = {
      type: 'use_item',
      actorId: 'player',
      source: 'human',
      params: { itemId: 'healing_pill' },
      metadata: { mapId: 'qinglan' },
    };
    expect(actionIdempotencyFingerprint(base)).not.toBe(
      actionIdempotencyFingerprint({ ...base, params: { itemId: 'qi_pill' } }),
    );
    expect(actionIdempotencyFingerprint(base)).not.toBe(
      actionIdempotencyFingerprint({ ...base, targetActorId: 'player' }),
    );
  });

  test('gather fingerprint binds the selected finite resource node', () => {
    const base = {
      type: 'gather',
      actorId: 'player',
      locationId: 'herb_patch',
      source: 'human',
      params: { resourceNodeId: 'dew_patch_a' },
      metadata: { mapId: 'xianxia_system_lab' },
    };
    expect(actionIdempotencyFingerprint(base)).not.toBe(
      actionIdempotencyFingerprint({
        ...base,
        params: { resourceNodeId: 'dew_patch_b' },
      }),
    );
  });

  test('cultivate fingerprint binds the selected resource mode', () => {
    const base = {
      type: 'cultivate',
      actorId: 'player',
      locationId: 'cultivation_pad',
      source: 'human',
      params: { cultivationMode: 'ambient' },
      metadata: { mapId: 'xianxia_system_lab' },
    };
    expect(actionIdempotencyFingerprint(base)).not.toBe(
      actionIdempotencyFingerprint({
        ...base,
        params: { cultivationMode: 'spirit_stone' },
      }),
    );
  });

  test('agent action keys bind actor suffixes beyond the old truncation boundary', () => {
    const sharedActorPrefix = `disciple:${'a'.repeat(140)}`;
    const turnId = 'pi-npc:turn:fixed';
    const left = agentActionClientId(turnId, `${sharedActorPrefix}:east`);
    const right = agentActionClientId(turnId, `${sharedActorPrefix}:west`);

    expect(left).not.toBe(right);
    expect(left).toMatch(/^agent:turn:v2:[0-9a-f]{32}$/);
    expect(left.length).toBeLessThan(64);
  });

  test('agent action keys preserve the exact legacy shape when no truncation occurred', () => {
    expect(agentActionClientId('pi-npc:turn:7', 'disciple:a')).toBe(
      'agent:pi-npc:turn:7:disciple:a',
    );
  });

  test('agent action keys bind the full turn revision instead of its first 96 characters', () => {
    const sharedTurnPrefix = `pi-npc:${'turn'.repeat(40)}`;
    const actorId = `long-actor:${'x'.repeat(120)}`;
    const revisionOne = agentActionClientId(
      `${sharedTurnPrefix}:revision:1`,
      actorId,
    );
    const revisionTwo = agentActionClientId(
      `${sharedTurnPrefix}:revision:2`,
      actorId,
    );

    expect(revisionOne).not.toBe(revisionTwo);
    expect(agentActionClientId(`${sharedTurnPrefix}:revision:1`, actorId)).toBe(
      revisionOne,
    );
  });
});
