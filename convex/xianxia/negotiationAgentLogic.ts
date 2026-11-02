import { itemBaseValue } from './items';
import {
  NEGOTIATION_MAX_COMPENSATION_STONES,
  NEGOTIATION_MAX_PROPOSALS,
  validateEventCompensationSettlement,
  type EventCompensationSourceView,
} from './negotiationLogic';
import type { AgentContext, AgentProposal } from './agentLogic';
import type {
  EventCompensationTerms,
  HerbTradeTerms,
  RequestDeadlineTerms,
} from './negotiationContracts';

export const HERB_TRADE_MIN_UNIT_PRICE = 6;
export const HERB_TRADE_MAX_UNIT_PRICE = 12;

export type HerbTradeOpportunity = {
  kind: 'herb_trade';
  sellerActorId: string;
  buyerActorId: string;
  itemQty: number;
  openingPaymentQty: number;
};

export type RequestDeadlineOpportunity = {
  kind: 'request_deadline';
  requestId: string;
  issuerActorId: string;
  assigneeActorId: string;
  baseExpiresAtGameHour: number;
  openingExtensionGameHours: number;
};

export type EventCompensationOpportunity = {
  kind: 'event_compensation';
  harmEventId: string;
  encounterId: string;
  payerActorId: string;
  payeeActorId: string;
  harmDamage: number;
  openingPaymentQty: number;
};

export type ActiveHerbTradeNegotiation = {
  negotiationId: string;
  proposalId: string;
  revision: number;
  proposerActorId: string;
  recipientActorId: string;
  terms: HerbTradeTerms;
  priorOffers: Array<{ proposerActorId: string; paymentQty?: number }>;
};

export type NegotiationModelCandidate = {
  candidateId: string;
  operation: 'open' | 'counter' | 'accept' | 'reject';
  summary: string;
  proposal: AgentProposal;
};

export function sellerReservationUnitPrice(input: {
  sellerHerbQty: number;
  tradeQty: number;
  relationship: number;
}) {
  const scarcity =
    input.sellerHerbQty <= input.tradeQty
      ? 2
      : input.sellerHerbQty === input.tradeQty + 1
        ? 1
        : 0;
  const relationship = input.relationship >= 30 ? -1 : input.relationship <= -20 ? 1 : 0;
  return clamp(itemBaseValue('spirit_herb') + scarcity + relationship);
}

export function buyerMaximumUnitPrice(input: {
  buyerHerbQty: number;
  relationship: number;
}) {
  const need = input.buyerHerbQty <= 0 ? 2 : input.buyerHerbQty === 1 ? 1 : -1;
  const relationship = input.relationship >= 30 ? 1 : input.relationship <= -20 ? -1 : 0;
  return clamp(itemBaseValue('spirit_herb') + need + relationship);
}

export function buildHerbTradeOpportunity(input: {
  selfActorId: string;
  otherActorId: string;
  selfInventory: Array<{ itemId: string; qty: number }>;
  otherInventory: Array<{ itemId: string; qty: number }>;
  relationship: number;
}): HerbTradeOpportunity | null {
  const selfHerbs = qty(input.selfInventory, 'spirit_herb');
  const selfStones = qty(input.selfInventory, 'spirit_stone');
  const otherHerbs = qty(input.otherInventory, 'spirit_herb');
  const otherStones = qty(input.otherInventory, 'spirit_stone');
  const itemQty = 1;

  if (selfHerbs >= itemQty) {
    const reserve = sellerReservationUnitPrice({
      sellerHerbQty: selfHerbs,
      tradeQty: itemQty,
      relationship: input.relationship,
    });
    if (otherStones >= reserve) {
      return {
        kind: 'herb_trade',
        sellerActorId: input.selfActorId,
        buyerActorId: input.otherActorId,
        itemQty,
        openingPaymentQty: Math.min(otherStones, reserve + 3),
      };
    }
  }
  if (selfStones >= HERB_TRADE_MIN_UNIT_PRICE && otherHerbs >= itemQty) {
    const maximum = Math.min(
      selfStones,
      buyerMaximumUnitPrice({ buyerHerbQty: selfHerbs, relationship: input.relationship }),
    );
    if (maximum >= HERB_TRADE_MIN_UNIT_PRICE) {
      return {
        kind: 'herb_trade',
        sellerActorId: input.otherActorId,
        buyerActorId: input.selfActorId,
        itemQty,
        openingPaymentQty: Math.max(HERB_TRADE_MIN_UNIT_PRICE, maximum - 2),
      };
    }
  }
  return null;
}

export function buildRequestDeadlineOpportunity(input: {
  selfActorId: string;
  otherActorId: string;
  topicId: string;
  nowGameHour: number;
  request?: {
    requestId: string;
    issuerActorId: string;
    assigneeActorId: string;
    status: string;
    expiresAt: number;
    deadlineExtensionCount?: number;
  };
}): RequestDeadlineOpportunity | null {
  const request = input.request;
  if (
    !request ||
    !isRequestDeadlineTopic(input.topicId) ||
    request.assigneeActorId !== input.selfActorId ||
    request.issuerActorId !== input.otherActorId ||
    !['accepted', 'ready_to_turn_in'].includes(request.status) ||
    (request.deadlineExtensionCount ?? 0) >= 1 ||
    request.expiresAt <= input.nowGameHour ||
    request.expiresAt - input.nowGameHour > 24
  ) {
    return null;
  }
  return {
    kind: 'request_deadline',
    requestId: request.requestId,
    issuerActorId: request.issuerActorId,
    assigneeActorId: request.assigneeActorId,
    baseExpiresAtGameHour: request.expiresAt,
    openingExtensionGameHours: 48,
  };
}

export function buildEventCompensationOpportunity(input: {
  selfActorId: string;
  otherActorId: string;
  topicId: string;
  nowGameHour: number;
  source: EventCompensationSourceView;
}): EventCompensationOpportunity | null {
  const floor = input.source.eventDamage ? input.source.eventDamage * 2 : 0;
  if (
    !isEventCompensationTopic(input.topicId) ||
    input.selfActorId !== input.source.defenderActorId ||
    input.otherActorId !== input.source.attackerActorId ||
    floor < 1 ||
    floor > NEGOTIATION_MAX_COMPENSATION_STONES ||
    input.source.payerAvailableSpiritStones < floor
  ) {
    return null;
  }
  const terms: EventCompensationTerms = {
    kind: 'event_compensation',
    harmEventId: input.source.harmEventId,
    encounterId: input.source.encounterId,
    payerActorId: input.source.attackerActorId,
    payeeActorId: input.source.defenderActorId,
    harmDamage: input.source.eventDamage!,
    paymentItemId: 'spirit_stone',
    paymentQty: floor,
  };
  if (!validateEventCompensationSettlement(terms, input.source, input.nowGameHour).ok) {
    return null;
  }
  return {
    kind: 'event_compensation',
    harmEventId: terms.harmEventId,
    encounterId: terms.encounterId,
    payerActorId: terms.payerActorId,
    payeeActorId: terms.payeeActorId,
    harmDamage: terms.harmDamage,
    openingPaymentQty: Math.min(
      input.source.payerAvailableSpiritStones,
      terms.harmDamage * 3 + 4,
      NEGOTIATION_MAX_COMPENSATION_STONES,
    ),
  };
}

export function planNegotiation(ctx: AgentContext): AgentProposal | null {
  if (ctx.activeNegotiation?.terms.kind === 'event_compensation') {
    return planEventCompensationNegotiation(ctx);
  }
  if (ctx.negotiationOpportunity?.kind === 'event_compensation') {
    return planEventCompensationNegotiation(ctx);
  }
  if (ctx.activeNegotiation?.terms.kind === 'request_deadline') {
    return planRequestDeadlineNegotiation(ctx);
  }
  if (ctx.negotiationOpportunity?.kind === 'request_deadline') {
    return planRequestDeadlineNegotiation(ctx);
  }
  return planHerbTradeNegotiation(ctx);
}

// C016c live model boundary: the service derives resource/revision-safe choices;
// the model may select among them and phrase the choice, but cannot invent terms.
export function buildNegotiationModelCandidates(
  ctx: AgentContext,
): NegotiationModelCandidate[] {
  const baseline = planNegotiation(ctx);
  if (!baseline || baseline.type !== 'negotiate') return [];
  const baselineOperation = operationOf(baseline);
  if (!baselineOperation) return [];
  const candidates = new Map<string, AgentProposal>();
  candidates.set(baselineOperation, baseline);

  const active = ctx.activeNegotiation;
  if (active && active.recipientActorId === ctx.self.actorId && baselineOperation !== 'reject') {
    candidates.set('accept', negotiationResponseFor(ctx, active, 'accept'));
    candidates.set('reject', negotiationResponseFor(ctx, active, 'reject'));
  }

  return [...candidates.entries()].map(([operation, proposal]) => ({
    candidateId: `negotiation:${operation}`,
    operation: operation as NegotiationModelCandidate['operation'],
    summary: negotiationCandidateSummary(proposal),
    proposal,
  }));
}

export function planEventCompensationNegotiation(ctx: AgentContext): AgentProposal | null {
  const conversation = ctx.activeConversation;
  if (
    !conversation ||
    conversation.currentSpeakerActorId !== ctx.self.actorId ||
    !ctx.availableActions.includes('negotiate') ||
    !isEventCompensationTopic(conversation.topicId)
  ) {
    return null;
  }
  const active = ctx.activeNegotiation;
  if (!active) {
    const opportunity = ctx.negotiationOpportunity;
    if (!opportunity || opportunity.kind !== 'event_compensation') return null;
    const terms = eventCompensationTermsFor(opportunity, opportunity.openingPaymentQty);
    const expectedTurnNumber = conversation.turnNumber + 1;
    return {
      type: 'negotiate',
      targetActorId: conversation.otherActorId,
      locationId: ctx.self.currentLocationId,
      source: 'agent',
      intent: '依据已发生且可核验的击倒事件提出一次有界灵石赔偿要求',
      params: {
        operation: 'open',
        conversationId: conversation.conversationId,
        turnId: turnId(conversation.conversationId, expectedTurnNumber),
        expectedTurnNumber,
        utteranceText: eventCompensationOfferText(terms, 'open'),
        referencedFactIds: [terms.harmEventId],
        referencedBeliefIds: [],
        terms,
      },
    };
  }
  if (
    active.terms.kind !== 'event_compensation' ||
    active.recipientActorId !== ctx.self.actorId
  ) {
    return null;
  }
  const terms = active.terms;
  const selfIsPayer = ctx.self.actorId === terms.payerActorId;
  const selfIsPayee = ctx.self.actorId === terms.payeeActorId;
  if (!selfIsPayer && !selfIsPayee) return null;
  const payerFunds = selfIsPayer ? qty(ctx.self.inventory, 'spirit_stone') : Number.MAX_SAFE_INTEGER;
  if (selfIsPayer && payerFunds < terms.paymentQty) {
    return eventCompensationResponse(ctx, active, 'reject', undefined, '自身没有履行当前赔偿条款所需的灵石');
  }
  const relationship = ctx.negotiationRelationship ?? 0;
  const relationshipAdjustment = relationship >= 30 ? 2 : relationship <= -20 ? -2 : 0;
  const boundaryPayment = selfIsPayer
    ? Math.max(1, Math.min(payerFunds, terms.harmDamage * 2 + 2 + relationshipAdjustment))
    : Math.min(NEGOTIATION_MAX_COMPENSATION_STONES, terms.harmDamage * 2);
  const acceptable = selfIsPayer
    ? terms.paymentQty <= boundaryPayment
    : terms.paymentQty >= boundaryPayment;
  if (acceptable) {
    return eventCompensationResponse(ctx, active, 'accept', undefined, '当前赔偿金额达到自身可接受边界');
  }
  const repeatedOwnBoundary = active.priorOffers.some(
    (offer) =>
      offer.proposerActorId === ctx.self.actorId && offer.paymentQty === boundaryPayment,
  );
  if (active.revision >= NEGOTIATION_MAX_PROPOSALS || repeatedOwnBoundary) {
    return eventCompensationResponse(ctx, active, 'reject', undefined, '赔偿金额没有继续靠近自身边界');
  }
  return eventCompensationResponse(
    ctx,
    active,
    'counter',
    { ...terms, paymentQty: boundaryPayment },
    '当前赔偿金额越过自身边界，提出一次有界反价',
  );
}

export function planHerbTradeNegotiation(ctx: AgentContext): AgentProposal | null {
  const conversation = ctx.activeConversation;
  if (
    !conversation ||
    conversation.currentSpeakerActorId !== ctx.self.actorId ||
    !ctx.availableActions.includes('negotiate')
  ) {
    return null;
  }
  const expectedTurnNumber = conversation.turnNumber + 1;
  const common = {
    targetActorId: conversation.otherActorId,
    locationId: ctx.self.currentLocationId,
    source: 'agent' as const,
  };
  const active = ctx.activeNegotiation;
  if (!active) {
    const opportunity = ctx.negotiationOpportunity;
    if (!opportunity || opportunity.kind !== 'herb_trade' || !isHerbTradeTopic(conversation.topicId)) return null;
    const terms = termsFor(opportunity, opportunity.openingPaymentQty);
    return {
      type: 'negotiate',
      ...common,
      intent: `依据库存和自身保留价提出灵草交易报价`,
      params: {
        operation: 'open',
        conversationId: conversation.conversationId,
        turnId: turnId(conversation.conversationId, expectedTurnNumber),
        expectedTurnNumber,
        utteranceText: offerText(terms, 'open'),
        referencedFactIds: [],
        referencedBeliefIds: [],
        terms,
      },
    };
  }
  if (active.recipientActorId !== ctx.self.actorId) return null;
  if (active.terms.kind !== 'herb_trade') return null;

  const terms = active.terms;
  const selfHerbs = qty(ctx.self.inventory, 'spirit_herb');
  const selfStones = qty(ctx.self.inventory, 'spirit_stone');
  const relationship = ctx.negotiationRelationship ?? 0;
  const selfIsSeller = terms.sellerActorId === ctx.self.actorId;
  const selfIsBuyer = terms.buyerActorId === ctx.self.actorId;
  if (!selfIsSeller && !selfIsBuyer) return null;

  const cannotPerform = selfIsSeller
    ? selfHerbs < terms.itemQty
    : selfStones < terms.paymentQty;
  if (cannotPerform) {
    return response(ctx, active, 'reject', undefined, '自身已没有履行当前条款所需的资源');
  }

  const boundaryPayment = selfIsSeller
    ? sellerReservationUnitPrice({
        sellerHerbQty: selfHerbs,
        tradeQty: terms.itemQty,
        relationship,
      }) * terms.itemQty
    : Math.min(
        selfStones,
        buyerMaximumUnitPrice({ buyerHerbQty: selfHerbs, relationship }) * terms.itemQty,
      );
  const acceptable = selfIsSeller
    ? terms.paymentQty >= boundaryPayment
    : terms.paymentQty <= boundaryPayment;
  if (acceptable) {
    return response(ctx, active, 'accept', undefined, '当前报价达到自身可接受边界');
  }

  const repeatedOwnBoundary = active.priorOffers.some(
    (offer) =>
      offer.proposerActorId === ctx.self.actorId && offer.paymentQty === boundaryPayment,
  );
  if (active.revision >= NEGOTIATION_MAX_PROPOSALS || repeatedOwnBoundary) {
    return response(
      ctx,
      active,
      'reject',
      undefined,
      repeatedOwnBoundary ? '双方报价没有继续靠近' : '议价已达到轮次上限',
    );
  }
  const counterTerms: HerbTradeTerms = { ...terms, paymentQty: boundaryPayment };
  return response(ctx, active, 'counter', counterTerms, '当前报价越过自身边界，提出一次有界反价');
}

export function planRequestDeadlineNegotiation(ctx: AgentContext): AgentProposal | null {
  const conversation = ctx.activeConversation;
  if (
    !conversation ||
    conversation.currentSpeakerActorId !== ctx.self.actorId ||
    !ctx.availableActions.includes('negotiate') ||
    !isRequestDeadlineTopic(conversation.topicId)
  ) {
    return null;
  }
  const common = {
    targetActorId: conversation.otherActorId,
    locationId: ctx.self.currentLocationId,
    source: 'agent' as const,
  };
  const active = ctx.activeNegotiation;
  if (!active) {
    const opportunity = ctx.negotiationOpportunity;
    if (!opportunity || opportunity.kind !== 'request_deadline') return null;
    const terms = requestDeadlineTermsFor(
      opportunity,
      opportunity.openingExtensionGameHours,
    );
    const expectedTurnNumber = conversation.turnNumber + 1;
    return {
      type: 'negotiate',
      ...common,
      intent: '委托期限将近，提出一次有界延期请求',
      params: {
        operation: 'open',
        conversationId: conversation.conversationId,
        turnId: turnId(conversation.conversationId, expectedTurnNumber),
        expectedTurnNumber,
        utteranceText: requestDeadlineOfferText(terms, 'open'),
        referencedFactIds: [],
        referencedBeliefIds: [],
        terms,
      },
    };
  }
  if (
    active.terms.kind !== 'request_deadline' ||
    active.recipientActorId !== ctx.self.actorId
  ) {
    return null;
  }
  const terms = active.terms;
  if (ctx.self.actorId === terms.assigneeActorId) {
    return requestDeadlineResponse(ctx, active, 'accept', undefined, '延期仍能帮助完成委托');
  }
  if (ctx.self.actorId !== terms.issuerActorId) return null;
  const relationship = ctx.negotiationRelationship ?? 0;
  if (relationship <= -20) {
    return requestDeadlineResponse(ctx, active, 'reject', undefined, '关系不足以承担延期承诺');
  }
  const maximum = relationship >= 30 ? 48 : 24;
  if (terms.extensionGameHours <= maximum) {
    return requestDeadlineResponse(ctx, active, 'accept', undefined, '延期未超过自身承诺上限');
  }
  const repeatedOwnBoundary = active.priorOffers.some(
    (offer) =>
      offer.proposerActorId === ctx.self.actorId &&
      offer.extensionGameHours === maximum,
  );
  if (active.revision >= NEGOTIATION_MAX_PROPOSALS || repeatedOwnBoundary) {
    return requestDeadlineResponse(ctx, active, 'reject', undefined, '延期边界没有继续靠近');
  }
  return requestDeadlineResponse(
    ctx,
    active,
    'counter',
    { ...terms, extensionGameHours: maximum },
    '请求超出承诺上限，提出有界延期',
  );
}

function response(
  ctx: AgentContext,
  active: NonNullable<AgentContext['activeNegotiation']>,
  operation: 'counter' | 'accept' | 'reject',
  terms: HerbTradeTerms | undefined,
  intent: string,
): AgentProposal {
  const conversation = ctx.activeConversation!;
  const expectedTurnNumber = conversation.turnNumber + 1;
  const canonical =
    terms ?? (active.terms.kind === 'herb_trade' ? active.terms : undefined);
  if (!canonical) throw new Error('agent_negotiation_invariant: herb terms expected');
  return {
    type: 'negotiate',
    targetActorId: conversation.otherActorId,
    locationId: ctx.self.currentLocationId,
    intent,
    params: {
      operation,
      conversationId: conversation.conversationId,
      negotiationId: active.negotiationId,
      expectedRevision: active.revision,
      turnId: turnId(conversation.conversationId, expectedTurnNumber),
      expectedTurnNumber,
      utteranceText: offerText(canonical, operation),
      referencedFactIds: [],
      referencedBeliefIds: [],
      ...(terms ? { terms } : {}),
    },
    source: 'agent',
  };
}

function requestDeadlineResponse(
  ctx: AgentContext,
  active: NonNullable<AgentContext['activeNegotiation']>,
  operation: 'counter' | 'accept' | 'reject',
  terms: RequestDeadlineTerms | undefined,
  intent: string,
): AgentProposal {
  const conversation = ctx.activeConversation!;
  const expectedTurnNumber = conversation.turnNumber + 1;
  const canonical =
    terms ?? (active.terms.kind === 'request_deadline' ? active.terms : undefined);
  if (!canonical) throw new Error('agent_negotiation_invariant: request deadline terms expected');
  return {
    type: 'negotiate',
    targetActorId: conversation.otherActorId,
    locationId: ctx.self.currentLocationId,
    intent,
    params: {
      operation,
      conversationId: conversation.conversationId,
      negotiationId: active.negotiationId,
      expectedRevision: active.revision,
      turnId: turnId(conversation.conversationId, expectedTurnNumber),
      expectedTurnNumber,
      utteranceText: requestDeadlineOfferText(canonical, operation),
      referencedFactIds: [],
      referencedBeliefIds: [],
      ...(terms ? { terms } : {}),
    },
    source: 'agent',
  };
}

function eventCompensationResponse(
  ctx: AgentContext,
  active: NonNullable<AgentContext['activeNegotiation']>,
  operation: 'counter' | 'accept' | 'reject',
  terms: EventCompensationTerms | undefined,
  intent: string,
): AgentProposal {
  const conversation = ctx.activeConversation!;
  const expectedTurnNumber = conversation.turnNumber + 1;
  const canonical =
    terms ?? (active.terms.kind === 'event_compensation' ? active.terms : undefined);
  if (!canonical) throw new Error('agent_negotiation_invariant: event compensation terms expected');
  return {
    type: 'negotiate',
    targetActorId: conversation.otherActorId,
    locationId: ctx.self.currentLocationId,
    intent,
    params: {
      operation,
      conversationId: conversation.conversationId,
      negotiationId: active.negotiationId,
      expectedRevision: active.revision,
      turnId: turnId(conversation.conversationId, expectedTurnNumber),
      expectedTurnNumber,
      utteranceText: eventCompensationOfferText(canonical, operation),
      referencedFactIds: [canonical.harmEventId],
      referencedBeliefIds: [],
      ...(terms ? { terms } : {}),
    },
    source: 'agent',
  };
}

function negotiationResponseFor(
  ctx: AgentContext,
  active: NonNullable<AgentContext['activeNegotiation']>,
  operation: 'accept' | 'reject',
): AgentProposal {
  if (active.terms.kind === 'request_deadline') {
    return requestDeadlineResponse(ctx, active, operation, undefined, `真实模型选择${operation}`);
  }
  if (active.terms.kind === 'event_compensation') {
    return eventCompensationResponse(ctx, active, operation, undefined, `真实模型选择${operation}`);
  }
  return response(ctx, active, operation, undefined, `真实模型选择${operation}`);
}

function operationOf(proposal: AgentProposal) {
  const operation = proposal.params?.operation;
  return operation === 'open' ||
    operation === 'counter' ||
    operation === 'accept' ||
    operation === 'reject'
    ? operation
    : null;
}

function negotiationCandidateSummary(proposal: AgentProposal) {
  const operation = operationOf(proposal);
  const terms = proposal.params?.terms;
  return JSON.stringify({
    operation,
    ...(terms ? { terms } : {}),
    currentTerms:
      !terms && (operation === 'accept' || operation === 'reject')
        ? '保持当前 proposal 条款'
        : undefined,
  });
}

function termsFor(opportunity: HerbTradeOpportunity, paymentQty: number): HerbTradeTerms {
  return {
    kind: 'herb_trade',
    sellerActorId: opportunity.sellerActorId,
    buyerActorId: opportunity.buyerActorId,
    itemId: 'spirit_herb',
    itemQty: opportunity.itemQty,
    paymentItemId: 'spirit_stone',
    paymentQty,
  };
}

function requestDeadlineTermsFor(
  opportunity: RequestDeadlineOpportunity,
  extensionGameHours: number,
): RequestDeadlineTerms {
  return {
    kind: 'request_deadline',
    requestId: opportunity.requestId,
    issuerActorId: opportunity.issuerActorId,
    assigneeActorId: opportunity.assigneeActorId,
    baseExpiresAtGameHour: opportunity.baseExpiresAtGameHour,
    extensionGameHours,
  };
}

function eventCompensationTermsFor(
  opportunity: EventCompensationOpportunity,
  paymentQty: number,
): EventCompensationTerms {
  return {
    kind: 'event_compensation',
    harmEventId: opportunity.harmEventId,
    encounterId: opportunity.encounterId,
    payerActorId: opportunity.payerActorId,
    payeeActorId: opportunity.payeeActorId,
    harmDamage: opportunity.harmDamage,
    paymentItemId: 'spirit_stone',
    paymentQty,
  };
}

function offerText(terms: HerbTradeTerms, operation: 'open' | 'counter' | 'accept' | 'reject') {
  if (operation === 'reject') return '这份报价超出了我的底线，此次就不成交了。';
  if (operation === 'accept') {
    return `可以，就按${terms.paymentQty}枚灵石换${terms.itemQty}株灵草成交。`;
  }
  return operation === 'open'
    ? `我提议以${terms.itemQty}株灵草换${terms.paymentQty}枚灵石。`
    : `我反提以${terms.itemQty}株灵草换${terms.paymentQty}枚灵石。`;
}

function requestDeadlineOfferText(
  terms: RequestDeadlineTerms,
  operation: 'open' | 'counter' | 'accept' | 'reject',
) {
  if (operation === 'reject') return '这次不能再延后委托期限。';
  if (operation === 'accept') {
    return `可以，将这桩委托延期${terms.extensionGameHours}个游戏小时。`;
  }
  return operation === 'open'
    ? `我请求将这桩委托延期${terms.extensionGameHours}个游戏小时。`
    : `我反提将这桩委托延期${terms.extensionGameHours}个游戏小时。`;
}

function eventCompensationOfferText(
  terms: EventCompensationTerms,
  operation: 'open' | 'counter' | 'accept' | 'reject',
) {
  if (operation === 'reject') return '这份赔偿条件超出我的底线，此事暂且谈不拢。';
  if (operation === 'accept') return `可以，就以${terms.paymentQty}枚灵石了结这次击倒造成的损失。`;
  return operation === 'open'
    ? `你先前将我击倒，我要求${terms.paymentQty}枚灵石作为赔偿。`
    : `关于先前的击倒，我反提以${terms.paymentQty}枚灵石赔偿。`;
}

function turnId(conversationId: string, turnNumber: number) {
  return `${conversationId}:turn:${turnNumber}`;
}

function isHerbTradeTopic(topicId: string) {
  return /(灵草|交易|议价|herb_trade)/iu.test(topicId);
}

function isRequestDeadlineTopic(topicId: string) {
  return /(委托|延期|期限|request_deadline)/iu.test(topicId);
}

function isEventCompensationTopic(topicId: string) {
  return /(赔偿|冲突|击倒|赔罪|event_compensation)/iu.test(topicId);
}

function qty(inventory: Array<{ itemId: string; qty: number }>, itemId: string) {
  return inventory.find((item) => item.itemId === itemId)?.qty ?? 0;
}

function clamp(value: number) {
  return Math.max(HERB_TRADE_MIN_UNIT_PRICE, Math.min(HERB_TRADE_MAX_UNIT_PRICE, value));
}
