import {
  GODOT_BRIDGE_HARDENING_VERSIONS,
  GODOT_BRIDGE_CONTRACT_VERSION,
  GODOT_ACTION_EXECUTION_PROTOCOL_VERSION,
  GODOT_MOVEMENT_PROTOCOL_VERSION,
  GodotBridgeContractError,
  parseGodotBridgeFailure,
  parseGodotJsonText,
  validateGodotActionBody,
  validateGodotActionExecutionReportBody,
  validateGodotCapabilitiesBody,
  validateGodotMovementReportBody,
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
      movementProtocol: 1,
      actionExecutionProtocol: 1,
    });
    expect(GODOT_MOVEMENT_PROTOCOL_VERSION).toBe(1);
    expect(GODOT_ACTION_EXECUTION_PROTOCOL_VERSION).toBe(1);
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

  test('accepts only a bounded semantic inspect target', () => {
    const inspect = {
      ...validTalk,
      type: 'inspect',
      targetActorId: undefined,
      mapId: 'qinglan_valley_gate',
      locationId: 'creek_bridge',
      actorTile: { x: 24, y: 18 },
      params: { interactionId: 'bridge_inscription' },
    };
    expect(validateGodotActionBody(inspect)).toMatchObject({
      type: 'inspect',
      params: { interactionId: 'bridge_inscription' },
    });
    expect(() =>
      validateGodotActionBody({
        ...inspect,
        params: {
          interactionId: 'bridge_inscription',
          observation: '客户端伪造内容',
        },
      }),
    ).toThrow('unknown_field');
    expect(() =>
      validateGodotActionBody({
        ...inspect,
        actorTile: undefined,
      }),
    ).toThrow('missing_actor_tile');
  });

  test('validates per-action params and bounded utility requests', () => {
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'request_teaching',
        params: { topic: 'cultivation_fundamentals' },
      }),
    ).toMatchObject({
      type: 'request_teaching',
      params: { topic: 'cultivation_fundamentals' },
    });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'request_teaching',
        params: { topic: 'x'.repeat(81) },
      }),
    ).toThrow('text_too_long');
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'decline_request',
        params: { requestId: 'request:1', expectedRevision: 3 },
      }),
    ).toMatchObject({
      type: 'decline_request',
      params: { requestId: 'request:1', expectedRevision: 3 },
    });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'decline_request',
        params: { requestId: 'request:1' },
      }),
    ).toThrow('request_revision_required');
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'group_talk',
        targetActorId: undefined,
        params: {
          operation: 'start',
          participantActorIds: ['godot_player', 'disciple_a', 'disciple_b'],
          observerActorIds: ['guard'],
          topicId: 'herb_dispute',
        },
      }),
    ).toMatchObject({
      type: 'group_talk',
      params: { operation: 'start', participantActorIds: ['godot_player', 'disciple_a', 'disciple_b'] },
    });
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'group_talk',
        targetActorId: undefined,
        params: {
          operation: 'speak',
          groupConversationId: 'group_conversation:1',
          turnId: 'group_conversation:1:turn:2',
          expectedTurnNumber: 2,
          speechAct: 'inform',
          utteranceText: '我看见他取走了最后一株灵草。',
          addressedActorIds: ['disciple_a', 'disciple_b'],
          referencedFactIds: ['event_1'],
          referencedBeliefIds: [],
        },
      }),
    ).toMatchObject({ type: 'group_talk', params: { operation: 'speak', expectedTurnNumber: 2 } });
    expect(() => validateGodotActionBody({
      ...validTalk,
      type: 'group_talk',
      targetActorId: undefined,
      params: { operation: 'start', participantActorIds: ['godot_player', 'disciple_a'] },
    })).toThrow('invalid_group_participants');
    expect(() => validateGodotActionBody({
      ...validTalk,
      type: 'group_talk',
      targetActorId: undefined,
      params: { operation: 'speak', groupConversationId: 'g', expectedTurnNumber: 2, speechAct: 'invent_fact', turnId: 't', utteranceText: 'x' },
    })).toThrow('invalid_speech_act');
    expect(validateGodotActionBody({
      ...validTalk,
      type: 'group_decide',
      targetActorId: undefined,
      params: {
        operation: 'vote',
        groupConversationId: 'group_conversation:1',
        proposalId: 'group_proposal:1',
        choice: 'approve',
      },
    })).toMatchObject({
      type: 'group_decide',
      params: { operation: 'vote', proposalId: 'group_proposal:1', choice: 'approve' },
    });
    expect(() => validateGodotActionBody({
      ...validTalk,
      type: 'group_decide',
      targetActorId: undefined,
      params: { operation: 'vote', groupConversationId: 'g', proposalId: 'p', choice: 'yes' },
    })).toThrow('invalid_group_vote');
    expect(
      validateGodotActionBody({
        ...validTalk,
        params: {
          conversationId: 'conversation:abc',
          turnId: 'conversation:abc:turn:2',
          expectedTurnNumber: 2,
          speechAct: 'inform',
          utteranceText: '我亲眼看见了这件事。',
          addressedActorIds: ['qinglan:merchant'],
          referencedFactIds: ['event_123'],
          referencedBeliefIds: [],
        },
      }),
    ).toMatchObject({
      type: 'talk',
      params: {
        conversationId: 'conversation:abc',
        expectedTurnNumber: 2,
        speechAct: 'inform',
        referencedFactIds: ['event_123'],
      },
    });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        params: {
          conversationId: 'conversation:abc',
          speechAct: 'rewrite_world',
        },
      }),
    ).toThrow('invalid_speech_act');
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        params: {
          conversationId: 'conversation:abc',
          referencedFactIds: Array.from({ length: 9 }, (_, index) => `event_${index}`),
        },
      }),
    ).toThrow('array_too_large');
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'cultivate',
        targetActorId: undefined,
        params: { cultivationMode: 'spirit_stone' },
      }),
    ).toMatchObject({
      type: 'cultivate',
      params: { cultivationMode: 'spirit_stone' },
    });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'cultivate',
        targetActorId: undefined,
        params: { cultivationMode: 'infinite_qi' },
      }),
    ).toThrow('invalid_cultivation_mode');
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
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'use_item',
        targetActorId: undefined,
        locationId: undefined,
        actorTile: undefined,
        params: { itemId: 'healing_pill' },
      }),
    ).toMatchObject({
      type: 'use_item',
      params: { itemId: 'healing_pill' },
    });
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'turn_in_request',
        params: { requestId: 'request_123' },
      }),
    ).toMatchObject({ type: 'turn_in_request', params: { requestId: 'request_123' } });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'use_item',
        targetActorId: undefined,
        locationId: undefined,
        actorTile: undefined,
        params: {},
      }),
    ).toThrow('invalid_string');
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'use_item',
        targetActorId: undefined,
        locationId: undefined,
        actorTile: undefined,
        params: { itemId: 'healing_pill', healAmount: 999 },
      }),
    ).toThrow('unknown_field');
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'use_item',
        params: { itemId: 'healing_pill' },
      }),
    ).toThrow('use_item_self_only');
    expect(() => validateGodotTickBody({ limit: 1.5 })).toThrow('invalid_integer');
    expect(validateGodotTickBody({ limit: 2, tickId: 'godot:tick:lease-1' })).toMatchObject({
      limit: 2,
      tickId: 'godot:tick:lease-1',
    });
    expect(() => validateGodotCapabilitiesBody({ actorTile: { x: NaN, y: 2 } })).toThrow(
      'invalid_number',
    );
  });

  test('accepts structured travel targets and movement execution reports', () => {
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'travel',
        targetActorId: undefined,
        locationId: undefined,
        actorTile: undefined,
        targetId: undefined,
        params: {
          movementTarget: { kind: 'point', tile: { x: 14, y: 11 } },
          decisionSource: 'test',
        },
      }),
    ).toMatchObject({
      type: 'travel',
      params: {
        movementTarget: { kind: 'point', tile: { x: 14, y: 11 } },
        decisionSource: 'test',
      },
    });
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'arrive',
        targetActorId: undefined,
        mapId: 'qinglan_valley_gate',
        locationId: 'valley_west_entry',
        params: { portalId: 'west_return_portal' },
      }),
    ).toMatchObject({
      type: 'arrive',
      params: { portalId: 'west_return_portal' },
    });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'arrive',
        targetActorId: undefined,
        params: { portalId: 'west_return_portal', toTile: { x: 8, y: 20 } },
      }),
    ).toThrow('unknown_field');
    expect(
      validateGodotMovementReportBody({
        commandId: 'movement-command-1',
        revision: 2,
        actorId: 'qinglan_valley_gate:resting_disciple',
        status: 'moving',
        positionTiles: { x: 13.25, y: 10.5 },
        reportedAt: 1_720_000_000_000,
      }),
    ).toMatchObject({ status: 'moving', revision: 2 });
    expect(() =>
      validateGodotMovementReportBody({
        commandId: 'movement-command-1',
        revision: 1.5,
        actorId: 'qinglan_valley_gate:resting_disciple',
        status: 'teleported',
        positionTiles: { x: 13, y: 10 },
        reportedAt: 1,
      }),
    ).toThrow();
  });

  test('validates bounded structured negotiation actions', () => {
    const terms = {
      kind: 'herb_trade',
      sellerActorId: 'qinglan:merchant',
      buyerActorId: 'godot_player',
      itemId: 'spirit_herb',
      itemQty: 2,
      paymentItemId: 'spirit_stone',
      paymentQty: 10,
    };
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'negotiate',
        params: {
          operation: 'open',
          conversationId: 'conversation:abc',
          turnId: 'conversation:abc:turn:2',
          expectedTurnNumber: 2,
          utteranceText: '2株灵草换10枚灵石。',
          terms,
        },
      }),
    ).toMatchObject({ type: 'negotiate', params: { operation: 'open', terms } });
    const deadlineTerms = {
      kind: 'request_deadline',
      requestId: 'request:abc',
      issuerActorId: 'qinglan:elder',
      assigneeActorId: 'godot_player',
      baseExpiresAtGameHour: 168,
      extensionGameHours: 24,
    };
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'negotiate',
        params: {
          operation: 'open',
          conversationId: 'conversation:deadline',
          turnId: 'conversation:deadline:turn:2',
          expectedTurnNumber: 2,
          utteranceText: '请延期24个游戏小时。',
          terms: deadlineTerms,
        },
      }),
    ).toMatchObject({
      type: 'negotiate',
      params: { operation: 'open', terms: deadlineTerms },
    });
    const compensationTerms = {
      kind: 'event_compensation',
      harmEventId: 'event:harm',
      encounterId: 'encounter:harm',
      payerActorId: 'qinglan:attacker',
      payeeActorId: 'godot_player',
      harmDamage: 3,
      paymentItemId: 'spirit_stone',
      paymentQty: 8,
    };
    expect(
      validateGodotActionBody({
        ...validTalk,
        type: 'negotiate',
        params: {
          operation: 'open',
          conversationId: 'conversation:compensation',
          turnId: 'conversation:compensation:turn:2',
          expectedTurnNumber: 2,
          utteranceText: '为先前的击倒赔偿8枚灵石。',
          terms: compensationTerms,
        },
      }),
    ).toMatchObject({
      type: 'negotiate',
      params: { operation: 'open', terms: compensationTerms },
    });
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'negotiate',
        params: {
          operation: 'open',
          conversationId: 'conversation:compensation',
          turnId: 'conversation:compensation:turn:2',
          expectedTurnNumber: 2,
          utteranceText: '非法赔偿。',
          terms: { ...compensationTerms, paymentQty: 25 },
        },
      }),
    ).toThrow('invalid_number');
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'negotiate',
        params: {
          operation: 'counter',
          conversationId: 'conversation:abc',
          negotiationId: 'negotiation:abc',
          expectedRevision: 1,
          turnId: 'conversation:abc:turn:3',
          expectedTurnNumber: 3,
          utteranceText: '非法超量报价。',
          terms: { ...terms, itemQty: 21 },
        },
      }),
    ).toThrow('invalid_number');
    expect(() =>
      validateGodotActionBody({
        ...validTalk,
        type: 'negotiate',
        params: {
          operation: 'accept',
          conversationId: 'conversation:abc',
          negotiationId: 'negotiation:abc',
          turnId: 'conversation:abc:turn:3',
          expectedTurnNumber: 3,
          utteranceText: '接受。',
        },
      }),
    ).toThrow('missing_negotiation_revision');
  });

  test('validates bounded action execution reports with body evidence', () => {
    expect(
      validateGodotActionExecutionReportBody({
        executionId: 'action-execution-1',
        revision: 3,
        actorId: 'godot_player',
        executorId: 'lab-session-1',
        status: 'acting',
        mapId: 'xianxia_system_lab',
        positionTiles: { x: 6.25, y: 4 },
        reasonCode: 'animation_started',
        reportedAt: 1_720_000_000_000,
      }),
    ).toMatchObject({
      revision: 3,
      status: 'acting',
      executorId: 'lab-session-1',
      mapId: 'xianxia_system_lab',
    });
    expect(() =>
      validateGodotActionExecutionReportBody({
        executionId: 'action-execution-1',
        revision: 3,
        actorId: 'godot_player',
        executorId: 'lab-session-1',
        status: 'completed',
        mapId: 'xianxia_system_lab',
        reportedAt: 1,
      }),
    ).toThrow('missing_position');
    expect(() =>
      validateGodotActionExecutionReportBody({
        executionId: 'action-execution-1',
        revision: 3,
        actorId: 'godot_player',
        executorId: 'lab-session-1',
        status: 'blocked',
        mapId: 'xianxia_system_lab',
        positionTiles: { x: 6, y: 4 },
        reasonCode: 'Not Allowed!',
        reportedAt: 1,
      }),
    ).toThrow('invalid_reason_code');
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
