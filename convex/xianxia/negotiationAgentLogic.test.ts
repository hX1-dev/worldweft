import type { AgentContext } from './agentLogic';
import {
  buildEventCompensationOpportunity,
  buildHerbTradeOpportunity,
  buildRequestDeadlineOpportunity,
  buyerMaximumUnitPrice,
  planHerbTradeNegotiation,
  planNegotiation,
  sellerReservationUnitPrice,
} from './negotiationAgentLogic';

const base: AgentContext = {
  self: {
    actorId: 'seller', name: '卖方', role: 'outer_disciple', realm: 'qi_refining', realmStage: 1,
    cultivationXp: 0, mood: 0, health: 10, spirit: 5, reputation: 0,
    currentLocationId: 'market', inventory: [{ itemId: 'spirit_herb', qty: 3 }],
  },
  others: [{ actorId: 'buyer', name: '买方', realm: 'qi_refining', relationship: 0 }],
  recentEvents: [],
  availableActions: ['talk', 'negotiate'],
  activeConversation: {
    conversationId: 'conversation:1', topicId: '灵草交易', otherActorId: 'buyer', otherActorName: '买方',
    currentSpeakerActorId: 'seller', turnNumber: 1, maxTurns: 12, expiresAt: Date.now() + 10000,
    recentTurns: [], visibleFacts: [], beliefs: [],
  },
};

describe('C013b herb trade utility boundaries', () => {
  test('seller reserve rises with scarcity and hostility but falls for a trusted counterpart', () => {
    expect(sellerReservationUnitPrice({ sellerHerbQty: 3, tradeQty: 1, relationship: 0 })).toBe(8);
    expect(sellerReservationUnitPrice({ sellerHerbQty: 1, tradeQty: 1, relationship: -30 })).toBe(11);
    expect(sellerReservationUnitPrice({ sellerHerbQty: 1, tradeQty: 1, relationship: 40 })).toBe(9);
  });

  test('buyer maximum reflects need, relationship and bounded catalog value', () => {
    expect(buyerMaximumUnitPrice({ buyerHerbQty: 0, relationship: 0 })).toBe(10);
    expect(buyerMaximumUnitPrice({ buyerHerbQty: 2, relationship: -30 })).toBe(6);
    expect(buyerMaximumUnitPrice({ buyerHerbQty: 0, relationship: 40 })).toBe(11);
  });

  test('server derives one feasible opening without exposing counterpart inventory', () => {
    expect(buildHerbTradeOpportunity({
      selfActorId: 'seller', otherActorId: 'buyer',
      selfInventory: [{ itemId: 'spirit_herb', qty: 3 }],
      otherInventory: [{ itemId: 'spirit_stone', qty: 20 }], relationship: 0,
    })).toEqual({ kind: 'herb_trade', sellerActorId: 'seller', buyerActorId: 'buyer', itemQty: 1, openingPaymentQty: 11 });
    expect(buildHerbTradeOpportunity({
      selfActorId: 'seller', otherActorId: 'buyer',
      selfInventory: [{ itemId: 'spirit_herb', qty: 1 }],
      otherInventory: [{ itemId: 'spirit_stone', qty: 5 }], relationship: 0,
    })).toBeNull();
  });
});

describe('C013b production negotiation planner', () => {
  test('opens only on a relevant topic and assigned speaker turn', () => {
    const opportunity = { kind: 'herb_trade' as const, sellerActorId: 'seller', buyerActorId: 'buyer', itemQty: 1, openingPaymentQty: 11 };
    expect(planHerbTradeNegotiation({ ...base, negotiationOpportunity: opportunity })).toMatchObject({
      type: 'negotiate', params: { operation: 'open', terms: { paymentQty: 11 } },
    });
    expect(planHerbTradeNegotiation({
      ...base, negotiationOpportunity: opportunity,
      activeConversation: { ...base.activeConversation!, topicId: '天气' },
    })).toBeNull();
    expect(planHerbTradeNegotiation({
      ...base, negotiationOpportunity: opportunity,
      activeConversation: { ...base.activeConversation!, currentSpeakerActorId: 'buyer' },
    })).toBeNull();
  });

  test('buyer counters above its maximum then seller accepts an overlapping boundary', () => {
    const offer = {
      negotiationId: 'negotiation:1', proposalId: 'proposal:1', revision: 1,
      proposerActorId: 'seller', recipientActorId: 'buyer',
      terms: { kind: 'herb_trade' as const, sellerActorId: 'seller', buyerActorId: 'buyer', itemId: 'spirit_herb' as const, itemQty: 1, paymentItemId: 'spirit_stone' as const, paymentQty: 11 },
      priorOffers: [{ proposerActorId: 'seller', paymentQty: 11 }],
    };
    const buyer = {
      ...base,
      self: { ...base.self, actorId: 'buyer', name: '买方', inventory: [{ itemId: 'spirit_stone', qty: 20 }] },
      activeConversation: { ...base.activeConversation!, otherActorId: 'seller', otherActorName: '卖方', currentSpeakerActorId: 'buyer', turnNumber: 2 },
      activeNegotiation: offer,
      negotiationRelationship: 0,
    } satisfies AgentContext;
    expect(planHerbTradeNegotiation(buyer)).toMatchObject({ params: { operation: 'counter', terms: { paymentQty: 10 } } });
    const seller = {
      ...base,
      activeConversation: { ...base.activeConversation!, currentSpeakerActorId: 'seller', turnNumber: 3 },
      activeNegotiation: { ...offer, revision: 2, proposalId: 'proposal:2', proposerActorId: 'buyer', recipientActorId: 'seller', terms: { ...offer.terms, paymentQty: 10 }, priorOffers: [...offer.priorOffers, { proposerActorId: 'buyer', paymentQty: 10 }] },
      negotiationRelationship: 0,
    } satisfies AgentContext;
    expect(planHerbTradeNegotiation(seller)).toMatchObject({ params: { operation: 'accept', expectedRevision: 2 } });
  });

  test('repeated reservation boundary ends an incompatible negotiation instead of oscillating', () => {
    const hostileBuyer = {
      ...base,
      self: { ...base.self, actorId: 'buyer', name: '买方', inventory: [{ itemId: 'spirit_stone', qty: 20 }, { itemId: 'spirit_herb', qty: 2 }] },
      activeConversation: { ...base.activeConversation!, otherActorId: 'seller', otherActorName: '卖方', currentSpeakerActorId: 'buyer', turnNumber: 4 },
      activeNegotiation: {
        negotiationId: 'negotiation:2', proposalId: 'proposal:3', revision: 3,
        proposerActorId: 'seller', recipientActorId: 'buyer',
        terms: { kind: 'herb_trade' as const, sellerActorId: 'seller', buyerActorId: 'buyer', itemId: 'spirit_herb' as const, itemQty: 1, paymentItemId: 'spirit_stone' as const, paymentQty: 11 },
        priorOffers: [
          { proposerActorId: 'seller', paymentQty: 13 },
          { proposerActorId: 'buyer', paymentQty: 6 },
          { proposerActorId: 'seller', paymentQty: 11 },
        ],
      },
      negotiationRelationship: -30,
    } satisfies AgentContext;
    expect(planHerbTradeNegotiation(hostileBuyer)).toMatchObject({ params: { operation: 'reject' } });
  });

  test('rejects when its own obligation is no longer available', () => {
    const buyer = {
      ...base,
      self: { ...base.self, actorId: 'buyer', name: '买方', inventory: [] },
      activeConversation: { ...base.activeConversation!, otherActorId: 'seller', currentSpeakerActorId: 'buyer' },
      activeNegotiation: {
        negotiationId: 'negotiation:3', proposalId: 'proposal:1', revision: 1,
        proposerActorId: 'seller', recipientActorId: 'buyer',
        terms: { kind: 'herb_trade' as const, sellerActorId: 'seller', buyerActorId: 'buyer', itemId: 'spirit_herb' as const, itemQty: 1, paymentItemId: 'spirit_stone' as const, paymentQty: 8 },
        priorOffers: [{ proposerActorId: 'seller', paymentQty: 8 }],
      },
    } satisfies AgentContext;
    expect(planHerbTradeNegotiation(buyer)).toMatchObject({ params: { operation: 'reject' } });
  });
});

describe('C013c1 production request deadline planner', () => {
  const opportunity = {
    kind: 'request_deadline' as const,
    requestId: 'request-1',
    issuerActorId: 'issuer',
    assigneeActorId: 'assignee',
    baseExpiresAtGameHour: 120,
    openingExtensionGameHours: 48,
  };

  test('only an urgent accepted request on a deadline topic creates an opening', () => {
    expect(
      buildRequestDeadlineOpportunity({
        selfActorId: 'assignee',
        otherActorId: 'issuer',
        topicId: '委托延期',
        nowGameHour: 100,
        request: {
          requestId: 'request-1', issuerActorId: 'issuer', assigneeActorId: 'assignee',
          status: 'accepted', expiresAt: 120, deadlineExtensionCount: 0,
        },
      }),
    ).toEqual(opportunity);
    expect(
      buildRequestDeadlineOpportunity({
        selfActorId: 'assignee', otherActorId: 'issuer', topicId: '委托延期', nowGameHour: 80,
        request: {
          requestId: 'request-1', issuerActorId: 'issuer', assigneeActorId: 'assignee',
          status: 'accepted', expiresAt: 120, deadlineExtensionCount: 0,
        },
      }),
    ).toBeNull();
  });

  test('assignee opens 48, neutral issuer counters 24, and assignee accepts', () => {
    const assigneeBase = {
      ...base,
      self: { ...base.self, actorId: 'assignee', name: '受托人' },
      activeConversation: {
        ...base.activeConversation!, topicId: '委托延期', otherActorId: 'issuer',
        otherActorName: '发起者', currentSpeakerActorId: 'assignee', turnNumber: 1,
      },
      negotiationOpportunity: opportunity,
    } satisfies AgentContext;
    expect(planNegotiation(assigneeBase)).toMatchObject({
      params: { operation: 'open', terms: { kind: 'request_deadline', extensionGameHours: 48 } },
    });
    const opening = {
      negotiationId: 'negotiation:deadline', proposalId: 'proposal:1', revision: 1,
      proposerActorId: 'assignee', recipientActorId: 'issuer',
      terms: {
        kind: 'request_deadline' as const, requestId: 'request-1', issuerActorId: 'issuer',
        assigneeActorId: 'assignee', baseExpiresAtGameHour: 120, extensionGameHours: 48,
      },
      priorOffers: [{ proposerActorId: 'assignee', extensionGameHours: 48 }],
    };
    const issuer = {
      ...base,
      self: { ...base.self, actorId: 'issuer', name: '发起者' },
      activeConversation: {
        ...base.activeConversation!, topicId: '委托延期', otherActorId: 'assignee',
        otherActorName: '受托人', currentSpeakerActorId: 'issuer', turnNumber: 2,
      },
      activeNegotiation: opening,
      negotiationRelationship: 0,
    } satisfies AgentContext;
    expect(planNegotiation(issuer)).toMatchObject({
      params: { operation: 'counter', terms: { extensionGameHours: 24 } },
    });
    const assignee = {
      ...assigneeBase,
      activeConversation: { ...assigneeBase.activeConversation!, turnNumber: 3 },
      activeNegotiation: {
        ...opening, proposalId: 'proposal:2', revision: 2, proposerActorId: 'issuer',
        recipientActorId: 'assignee', terms: { ...opening.terms, extensionGameHours: 24 },
        priorOffers: [...opening.priorOffers, { proposerActorId: 'issuer', extensionGameHours: 24 }],
      },
      negotiationOpportunity: undefined,
    } satisfies AgentContext;
    expect(planNegotiation(assignee)).toMatchObject({
      params: { operation: 'accept', expectedRevision: 2 },
    });
  });
});

describe('C013c2 production event compensation planner', () => {
  const source = {
    harmEventId: 'event:harm',
    encounterId: 'encounter:harm',
    attackerActorId: 'payer',
    defenderActorId: 'payee',
    encounterStatus: 'defender_defeated',
    winnerActorId: 'payer',
    defeatedActorId: 'payee',
    terminalEventId: 'event:harm',
    eventType: 'combatant_defeated',
    eventActorIds: ['payer'],
    eventTargetActorIds: ['payee'],
    eventEncounterId: 'encounter:harm',
    eventTargetActorId: 'payee',
    eventDamage: 3,
    eventDefeated: true,
    eventGameHour: 100,
    payerAvailableSpiritStones: 24,
  };

  test('only the defeated payee can open from an exact recent terminal event with enough funds', () => {
    expect(buildEventCompensationOpportunity({
      selfActorId: 'payee', otherActorId: 'payer', topicId: '冲突赔偿',
      nowGameHour: 120, source,
    })).toEqual({
      kind: 'event_compensation', harmEventId: 'event:harm', encounterId: 'encounter:harm',
      payerActorId: 'payer', payeeActorId: 'payee', harmDamage: 3, openingPaymentQty: 13,
    });
    expect(buildEventCompensationOpportunity({
      selfActorId: 'payer', otherActorId: 'payee', topicId: '冲突赔偿',
      nowGameHour: 120, source,
    })).toBeNull();
    expect(buildEventCompensationOpportunity({
      selfActorId: 'payee', otherActorId: 'payer', topicId: '天气',
      nowGameHour: 120, source,
    })).toBeNull();
    expect(buildEventCompensationOpportunity({
      selfActorId: 'payee', otherActorId: 'payer', topicId: '冲突赔偿',
      nowGameHour: 120, source: { ...source, payerAvailableSpiritStones: 5 },
    })).toBeNull();
  });

  test('payee opens 13, neutral payer counters 8, and payee accepts its damage floor', () => {
    const payeeBase = {
      ...base,
      self: { ...base.self, actorId: 'payee', name: '受害者', inventory: [] },
      activeConversation: {
        ...base.activeConversation!, topicId: '冲突赔偿', otherActorId: 'payer',
        otherActorName: '伤人者', currentSpeakerActorId: 'payee', turnNumber: 1,
      },
      negotiationOpportunity: buildEventCompensationOpportunity({
        selfActorId: 'payee', otherActorId: 'payer', topicId: '冲突赔偿',
        nowGameHour: 120, source,
      })!,
    } satisfies AgentContext;
    expect(planNegotiation(payeeBase)).toMatchObject({
      params: { operation: 'open', terms: { kind: 'event_compensation', paymentQty: 13 } },
    });
    const opening = {
      negotiationId: 'negotiation:compensation', proposalId: 'proposal:1', revision: 1,
      proposerActorId: 'payee', recipientActorId: 'payer',
      terms: {
        kind: 'event_compensation' as const, harmEventId: 'event:harm',
        encounterId: 'encounter:harm', payerActorId: 'payer', payeeActorId: 'payee',
        harmDamage: 3, paymentItemId: 'spirit_stone' as const, paymentQty: 13,
      },
      priorOffers: [{ proposerActorId: 'payee', paymentQty: 13 }],
    };
    const payer = {
      ...base,
      self: { ...base.self, actorId: 'payer', name: '伤人者', inventory: [{ itemId: 'spirit_stone', qty: 24 }] },
      activeConversation: {
        ...base.activeConversation!, topicId: '冲突赔偿', otherActorId: 'payee',
        otherActorName: '受害者', currentSpeakerActorId: 'payer', turnNumber: 2,
      },
      activeNegotiation: opening,
      negotiationRelationship: 0,
    } satisfies AgentContext;
    expect(planNegotiation(payer)).toMatchObject({
      params: { operation: 'counter', terms: { paymentQty: 8 } },
    });
    const payee = {
      ...payeeBase,
      activeConversation: { ...payeeBase.activeConversation!, turnNumber: 3 },
      activeNegotiation: {
        ...opening, proposalId: 'proposal:2', revision: 2, proposerActorId: 'payer',
        recipientActorId: 'payee', terms: { ...opening.terms, paymentQty: 8 },
        priorOffers: [...opening.priorOffers, { proposerActorId: 'payer', paymentQty: 8 }],
      },
      negotiationOpportunity: undefined,
    } satisfies AgentContext;
    expect(planNegotiation(payee)).toMatchObject({
      params: { operation: 'accept', expectedRevision: 2 },
    });
  });

  test('hostile payer still accepts the exact damage floor without oscillating', () => {
    const active = {
      negotiationId: 'negotiation:hostile', proposalId: 'proposal:3', revision: 3,
      proposerActorId: 'payee', recipientActorId: 'payer',
      terms: {
        kind: 'event_compensation' as const, harmEventId: 'event:harm',
        encounterId: 'encounter:harm', payerActorId: 'payer', payeeActorId: 'payee',
        harmDamage: 3, paymentItemId: 'spirit_stone' as const, paymentQty: 6,
      },
      priorOffers: [
        { proposerActorId: 'payee', paymentQty: 13 },
        { proposerActorId: 'payer', paymentQty: 6 },
        { proposerActorId: 'payee', paymentQty: 6 },
      ],
    };
    const payer = {
      ...base,
      self: { ...base.self, actorId: 'payer', inventory: [{ itemId: 'spirit_stone', qty: 24 }] },
      activeConversation: {
        ...base.activeConversation!, topicId: '冲突赔偿', otherActorId: 'payee',
        currentSpeakerActorId: 'payer', turnNumber: 4,
      },
      activeNegotiation: active,
      negotiationRelationship: -30,
    } satisfies AgentContext;
    expect(planNegotiation(payer)).toMatchObject({ params: { operation: 'accept' } });
  });
});
