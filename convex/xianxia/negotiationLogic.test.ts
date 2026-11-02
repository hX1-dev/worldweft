import {
  NEGOTIATION_MAX_PROPOSALS,
  inventoryAvailable,
  eventCompensationUtteranceMatchesTerms,
  negotiationUtteranceMatchesTerms,
  orderedNegotiationActors,
  parseHerbTradeTerms,
  parseRequestDeadlineTerms,
  parseEventCompensationTerms,
  requestDeadlineUtteranceMatchesTerms,
  validateNegotiationResponse,
  validateRequestDeadlineSettlement,
  validateEventCompensationSettlement,
} from './negotiationLogic';

const terms = {
  kind: 'herb_trade' as const,
  sellerActorId: 'seller',
  buyerActorId: 'buyer',
  itemId: 'spirit_herb' as const,
  itemQty: 2,
  paymentItemId: 'spirit_stone' as const,
  paymentQty: 7,
};

const session = {
  status: 'active' as const,
  actorAId: 'buyer',
  actorBId: 'seller',
  currentResponderActorId: 'buyer',
  currentProposalId: 'proposal-1',
  revision: 1,
  expiresAt: 10_000,
};
const proposal = {
  proposalId: 'proposal-1',
  status: 'active' as const,
  revision: 1,
  proposerActorId: 'seller',
  recipientActorId: 'buyer',
};

describe('C013a structured herb trade terms', () => {
  test('accepts only exact participants, fixed resources and bounded integer quantities', () => {
    expect(parseHerbTradeTerms(terms, ['buyer', 'seller'])).toEqual({ ok: true, terms });
    expect(
      parseHerbTradeTerms({ ...terms, sellerActorId: 'stranger' }, ['buyer', 'seller']),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_terms_participant_mismatch' });
    for (const invalid of [
      { ...terms, itemId: 'qi_pill' },
      { ...terms, itemQty: 0 },
      { ...terms, paymentQty: 1.5 },
      { ...terms, hiddenReward: 99 },
    ]) {
      expect(parseHerbTradeTerms(invalid, ['buyer', 'seller'])).toMatchObject({
        ok: false,
        reasonCode: 'negotiation_terms_invalid',
      });
    }
    expect(orderedNegotiationActors('seller', 'buyer')).toEqual({
      actorAId: 'buyer',
      actorBId: 'seller',
    });
  });

  test('rejects explicit numeric utterance contradictions while allowing nonnumeric phrasing', () => {
    expect(negotiationUtteranceMatchesTerms('两株灵草换七枚灵石，如何？', terms)).toBe(true);
    expect(negotiationUtteranceMatchesTerms('2株灵草换7枚灵石，如何？', terms)).toBe(true);
    expect(negotiationUtteranceMatchesTerms('2株灵草换999枚灵石。', terms)).toBe(false);
    expect(negotiationUtteranceMatchesTerms('1株灵草换7枚灵石。', terms)).toBe(false);
  });

  test('unreserved inventory is the only available balance', () => {
    expect(inventoryAvailable([{ itemId: 'spirit_herb', qty: 2 }], 'spirit_herb', 1, 1)).toBe(true);
    expect(inventoryAvailable([{ itemId: 'spirit_herb', qty: 2 }], 'spirit_herb', 2, 1)).toBe(false);
  });
});

describe('C013a alternating offer state machine', () => {
  test.each([
    ['counter', 'active', 'superseded'],
    ['accept', 'settled', 'accepted'],
    ['reject', 'rejected', 'rejected'],
  ] as const)('%s is controlled by the current recipient', (operation, sessionStatus, proposalStatus) => {
    expect(
      validateNegotiationResponse(session, proposal, {
        actorId: 'buyer',
        operation,
        revision: 1,
        now: 100,
      }),
    ).toMatchObject({
      ok: true,
      nextSessionStatus: sessionStatus,
      nextProposalStatus: proposalStatus,
    });
  });

  test('only proposer withdraws, and stale/wrong/expired/terminal responses fail closed', () => {
    expect(
      validateNegotiationResponse(session, proposal, {
        actorId: 'seller',
        operation: 'withdraw',
        revision: 1,
        now: 100,
      }),
    ).toMatchObject({ ok: true, nextSessionStatus: 'withdrawn' });
    expect(
      validateNegotiationResponse(session, proposal, {
        actorId: 'buyer',
        operation: 'withdraw',
        revision: 1,
        now: 100,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_not_proposer' });
    expect(
      validateNegotiationResponse(session, proposal, {
        actorId: 'buyer',
        operation: 'accept',
        revision: 2,
        now: 100,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_revision_stale' });
    expect(
      validateNegotiationResponse(session, proposal, {
        actorId: 'seller',
        operation: 'accept',
        revision: 1,
        now: 100,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_wrong_responder' });
    expect(
      validateNegotiationResponse(session, proposal, {
        actorId: 'buyer',
        operation: 'accept',
        revision: 1,
        now: 10_000,
      }),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_expired' });
    expect(
      validateNegotiationResponse(
        { ...session, status: 'settled' },
        { ...proposal, status: 'accepted' },
        { actorId: 'buyer', operation: 'accept', revision: 1, now: 100 },
      ),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_not_active' });
  });

  test('counter proposal count is bounded', () => {
    expect(
      validateNegotiationResponse(
        { ...session, revision: NEGOTIATION_MAX_PROPOSALS },
        { ...proposal, revision: NEGOTIATION_MAX_PROPOSALS },
        {
          actorId: 'buyer',
          operation: 'counter',
          revision: NEGOTIATION_MAX_PROPOSALS,
          now: 100,
        },
      ),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_revision_limit' });
  });
});

describe('C013c1 structured request deadline terms', () => {
  const deadlineTerms = {
    kind: 'request_deadline' as const,
    requestId: 'request-1',
    issuerActorId: 'issuer',
    assigneeActorId: 'assignee',
    baseExpiresAtGameHour: 200,
    extensionGameHours: 24,
  };
  const request = {
    issuerActorId: 'issuer',
    assigneeActorId: 'assignee',
    status: 'accepted',
    expiresAt: 200,
    originalExpiresAt: 200,
    deadlineExtensionCount: 0,
  };

  test('accepts only exact participants, stable base and 1..72 integer game hours', () => {
    expect(parseRequestDeadlineTerms(deadlineTerms, ['assignee', 'issuer'])).toEqual({
      ok: true,
      terms: deadlineTerms,
    });
    for (const invalid of [
      { ...deadlineTerms, issuerActorId: 'stranger' },
      { ...deadlineTerms, extensionGameHours: 0 },
      { ...deadlineTerms, extensionGameHours: 73 },
      { ...deadlineTerms, extensionGameHours: 1.5 },
      { ...deadlineTerms, hiddenReward: 1 },
    ]) {
      expect(parseRequestDeadlineTerms(invalid, ['assignee', 'issuer'])).toMatchObject({
        ok: false,
      });
    }
  });

  test('numeric deadline wording must match structured extension', () => {
    expect(requestDeadlineUtteranceMatchesTerms('请延期24个游戏小时。', deadlineTerms)).toBe(true);
    expect(requestDeadlineUtteranceMatchesTerms('请宽限些时日。', deadlineTerms)).toBe(true);
    expect(requestDeadlineUtteranceMatchesTerms('请延期48个游戏小时。', deadlineTerms)).toBe(false);
  });

  test('settlement is bounded, cannot revive or repeat, and rejects a changed base', () => {
    expect(validateRequestDeadlineSettlement(deadlineTerms, request, 190)).toEqual({
      ok: true,
      nextExpiresAt: 224,
    });
    expect(
      validateRequestDeadlineSettlement(deadlineTerms, { ...request, expiresAt: 201 }, 190),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_request_deadline_changed' });
    expect(
      validateRequestDeadlineSettlement(
        deadlineTerms,
        { ...request, deadlineExtensionCount: 1 },
        190,
      ),
    ).toMatchObject({
      ok: false,
      reasonCode: 'negotiation_request_deadline_already_extended',
    });
    expect(validateRequestDeadlineSettlement(deadlineTerms, request, 200)).toMatchObject({
      ok: false,
      reasonCode: 'negotiation_request_expired',
    });
    expect(
      validateRequestDeadlineSettlement(deadlineTerms, { ...request, status: 'completed' }, 190),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_request_not_accepted' });
  });
});

describe('C013c2 structured conflict compensation terms', () => {
  const compensationTerms = {
    kind: 'event_compensation' as const,
    harmEventId: 'event-harm-1',
    encounterId: 'combat-1',
    payerActorId: 'attacker',
    payeeActorId: 'defender',
    harmDamage: 3,
    paymentItemId: 'spirit_stone' as const,
    paymentQty: 8,
  };
  const source = {
    harmEventId: 'event-harm-1',
    encounterId: 'combat-1',
    attackerActorId: 'attacker',
    defenderActorId: 'defender',
    encounterStatus: 'defender_defeated',
    winnerActorId: 'attacker',
    defeatedActorId: 'defender',
    terminalEventId: 'event-harm-1',
    eventType: 'combatant_defeated',
    eventActorIds: ['attacker'],
    eventTargetActorIds: ['defender'],
    eventEncounterId: 'combat-1',
    eventTargetActorId: 'defender',
    eventDamage: 3,
    eventDefeated: true,
    eventGameHour: 100,
    payerAvailableSpiritStones: 20,
  };

  test('accepts only exact participants, immutable harm subject and 1..24 integer stones', () => {
    expect(parseEventCompensationTerms(compensationTerms, ['attacker', 'defender'])).toEqual({
      ok: true,
      terms: compensationTerms,
    });
    for (const invalid of [
      { ...compensationTerms, payerActorId: 'stranger' },
      { ...compensationTerms, paymentItemId: 'qi_pill' },
      { ...compensationTerms, paymentQty: 0 },
      { ...compensationTerms, paymentQty: 25 },
      { ...compensationTerms, paymentQty: 1.5 },
      { ...compensationTerms, hiddenForgiveness: true },
    ]) {
      expect(parseEventCompensationTerms(invalid, ['attacker', 'defender'])).toMatchObject({
        ok: false,
      });
    }
  });

  test('numeric compensation wording must match structured spirit stones', () => {
    expect(eventCompensationUtteranceMatchesTerms('请赔偿8枚灵石。', compensationTerms)).toBe(true);
    expect(eventCompensationUtteranceMatchesTerms('请对此事作出赔偿。', compensationTerms)).toBe(true);
    expect(eventCompensationUtteranceMatchesTerms('请赔偿12枚灵石。', compensationTerms)).toBe(false);
  });

  test('settlement requires the exact unexpired defeat event, one marker and real funds', () => {
    expect(validateEventCompensationSettlement(compensationTerms, source, 120)).toEqual({ ok: true });
    expect(
      validateEventCompensationSettlement(
        compensationTerms,
        { ...source, eventDamage: 4 },
        120,
      ),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_compensation_source_mismatch' });
    expect(
      validateEventCompensationSettlement(
        compensationTerms,
        { ...source, compensationNegotiationId: 'negotiation-old' },
        120,
      ),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_compensation_already_settled' });
    expect(validateEventCompensationSettlement(compensationTerms, source, 269)).toMatchObject({
      ok: false,
      reasonCode: 'negotiation_compensation_expired',
    });
    expect(
      validateEventCompensationSettlement(
        compensationTerms,
        { ...source, payerAvailableSpiritStones: 7 },
        120,
      ),
    ).toMatchObject({ ok: false, reasonCode: 'negotiation_compensation_funds_unavailable' });
  });
});
