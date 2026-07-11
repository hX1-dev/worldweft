import {
  GODOT_BRIDGE_HARDENING_VERSIONS,
  GODOT_BRIDGE_CONTRACT_VERSION,
  GodotBridgeContractError,
  parseGodotBridgeFailure,
  parseGodotJsonText,
  validateGodotActionBody,
  validateGodotCapabilitiesBody,
  validateGodotTickBody,
} from './godotBridgeContract';

const validTalk = {
  worldId: 'world',
  actorId: 'godot_player',
  clientActionId: 'godot:test:talk:1',
  type: 'talk',
  targetActorId: 'qinglan:merchant',
  mapId: 'qinglan',
  locationId: 'market',
  actorTile: { x: 12, y: 8 },
  interactionRangeTiles: 5,
  intent: 'Ask about the market.',
  params: {},
  metadata: { clientEvent: 'action_menu' },
};

describe('godot bridge contract', () => {
  test('advertises the production hardening profile explicitly', () => {
    expect(GODOT_BRIDGE_HARDENING_VERSIONS).toEqual({
      spatialAdjudication: 1,
      viewerProjection: 1,
      tickLease: 1,
      memoryFanoutJob: 1,
      durableSchema: 1,
    });
  });

  test('parses only bounded JSON objects', () => {
    expect(parseGodotJsonText('{"ok":true}')).toEqual({ ok: true });
    expect(() => parseGodotJsonText('{bad')).toThrow('malformed_json');
    expect(() => parseGodotJsonText('[]')).toThrow('invalid_json_body');
    expect(() => parseGodotJsonText('{"metadata":{"__proto__":1}}')).toThrow(
      'unsafe_object_key',
    );
  });

  test('accepts a known semantic action and rejects drift', () => {
    expect(validateGodotActionBody(validTalk)).toMatchObject({
      type: 'talk',
      clientActionId: 'godot:test:talk:1',
      actorTile: { x: 12, y: 8 },
    });
    expect(() => validateGodotActionBody({ ...validTalk, type: 'dance' })).toThrow(
      'unknown_action_type',
    );
    expect(() =>
      validateGodotActionBody({ ...validTalk, clientActionId: undefined }),
    ).toThrow('missing_client_action_id');
    expect(() => validateGodotActionBody({ ...validTalk, facts: { invented: true } })).toThrow(
      'unknown_field',
    );
    expect(() =>
      validateGodotActionBody({ ...validTalk, actorTile: { x: '12', y: 8 } }),
    ).toThrow('invalid_number');
    expect(() =>
      validateGodotActionBody({ ...validTalk, metadata: { durableState: 'write' } }),
    ).toThrow('unknown_field');
  });

  test('validates per-action params and bounded utility requests', () => {
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'trade',
        params: {
          offeredItemId: 'spirit_stone',
          offeredQty: 8,
          requestedItemId: 'spirit_herb',
          requestedQty: 1,
        },
      }),
    ).toMatchObject({ type: 'trade' });
    expect(() =>
      validateGodotActionBody({ ...validTalk, type: 'gift', params: { itemId: 7 } }),
    ).toThrow('invalid_string');
    expect(() => validateGodotTickBody({ limit: 1.5 })).toThrow('invalid_integer');
    expect(validateGodotTickBody({ limit: 2, tickId: 'godot:tick:lease-1' })).toMatchObject({
      limit: 2,
      tickId: 'godot:tick:lease-1',
    });
    expect(() => validateGodotCapabilitiesBody({ actorTile: { x: NaN, y: 2 } })).toThrow(
      'invalid_number',
    );
  });

  test('maps contract and cross-function idempotency errors to stable responses', () => {
    expect(GODOT_BRIDGE_CONTRACT_VERSION).toBe('godot_bridge_v1');
    const local = new GodotBridgeContractError(400, 'bad_field', 'Bad field.');
    expect(parseGodotBridgeFailure(local)).toEqual({
      status: 400,
      errorCode: 'bad_field',
      message: 'Bad field.',
      details: undefined,
    });
    expect(
      parseGodotBridgeFailure(
        new Error('Uncaught Error: action_idempotency_conflict: key was reused'),
      ),
    ).toMatchObject({ status: 409, errorCode: 'action_idempotency_conflict' });
    expect(
      parseGodotBridgeFailure(new Error('Uncaught Error: Failed to parse cursor')),
    ).toEqual({
      status: 400,
      errorCode: 'invalid_pagination_cursor',
      message: 'Pagination cursor is invalid or no longer usable.',
    });
  });
});
