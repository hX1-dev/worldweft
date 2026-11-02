import { MS_PER_GAME_HOUR } from './timeLogic';
import type {
  HerbTradeTerms,
  EventCompensationTerms,
  NegotiationTerms,
  NegotiationOperation,
  NegotiationProposalStatus,
  NegotiationStatus,
  RequestDeadlineTerms,
} from './negotiationContracts';

export const NEGOTIATION_TTL_MS = 6 * MS_PER_GAME_HOUR;
export const NEGOTIATION_MAX_PROPOSALS = 6;
export const NEGOTIATION_MAX_HERB_QTY = 20;
export const NEGOTIATION_MAX_PAYMENT_QTY = 999;
export const NEGOTIATION_MAX_REQUEST_EXTENSION_HOURS = 72;
export const NEGOTIATION_MAX_COMPENSATION_STONES = 24;
export const NEGOTIATION_COMPENSATION_WINDOW_GAME_HOURS = 7 * 24;

export type NegotiationSessionView = {
  status: NegotiationStatus;
  actorAId: string;
  actorBId: string;
  currentResponderActorId?: string;
  currentProposalId: string;
  revision: number;
  expiresAt: number;
};

export type NegotiationProposalView = {
  proposalId: string;
  status: NegotiationProposalStatus;
  revision: number;
  proposerActorId: string;
  recipientActorId: string;
};

export type NegotiationFailure = { ok: false; reasonCode: string; reason: string };

export type RequestDeadlineView = {
  issuerActorId: string;
  assigneeActorId: string;
  status: string;
  expiresAt: number;
  originalExpiresAt?: number;
  deadlineExtensionCount?: number;
};

export type EventCompensationSourceView = {
  harmEventId: string;
  encounterId: string;
  attackerActorId: string;
  defenderActorId: string;
  encounterStatus: string;
  winnerActorId?: string;
  defeatedActorId?: string;
  terminalEventId?: string;
  compensationNegotiationId?: string;
  eventType: string;
  eventActorIds: string[];
  eventTargetActorIds: string[];
  eventEncounterId?: string;
  eventTargetActorId?: string;
  eventDamage?: number;
  eventDefeated?: boolean;
  eventGameHour: number;
  payerAvailableSpiritStones: number;
};

export function orderedNegotiationActors(actorId: string, targetActorId: string) {
  return actorId.localeCompare(targetActorId) <= 0
    ? { actorAId: actorId, actorBId: targetActorId }
    : { actorAId: targetActorId, actorBId: actorId };
}

export function parseHerbTradeTerms(
  value: unknown,
  actorIds: readonly [string, string],
): { ok: true; terms: HerbTradeTerms } | NegotiationFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('negotiation_terms_invalid', '议价条款必须是结构化对象。');
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    'kind',
    'sellerActorId',
    'buyerActorId',
    'itemId',
    'itemQty',
    'paymentItemId',
    'paymentQty',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    return failure('negotiation_terms_invalid', '议价条款包含不支持的字段。');
  }
  if (
    raw.kind !== 'herb_trade' ||
    raw.itemId !== 'spirit_herb' ||
    raw.paymentItemId !== 'spirit_stone' ||
    typeof raw.sellerActorId !== 'string' ||
    typeof raw.buyerActorId !== 'string' ||
    !boundedInteger(raw.itemQty, 1, NEGOTIATION_MAX_HERB_QTY) ||
    !boundedInteger(raw.paymentQty, 1, NEGOTIATION_MAX_PAYMENT_QTY)
  ) {
    return failure('negotiation_terms_invalid', '首版只支持有界灵草与灵石交换。');
  }
  const participants = new Set(actorIds);
  if (
    raw.sellerActorId === raw.buyerActorId ||
    !participants.has(raw.sellerActorId) ||
    !participants.has(raw.buyerActorId) ||
    new Set([raw.sellerActorId, raw.buyerActorId]).size !== participants.size
  ) {
    return failure(
      'negotiation_terms_participant_mismatch',
      '买卖双方必须恰好是当前会话的两名参与者。',
    );
  }
  return {
    ok: true,
    terms: {
      kind: 'herb_trade',
      sellerActorId: raw.sellerActorId,
      buyerActorId: raw.buyerActorId,
      itemId: 'spirit_herb',
      itemQty: raw.itemQty as number,
      paymentItemId: 'spirit_stone',
      paymentQty: raw.paymentQty as number,
    },
  };
}

export function parseRequestDeadlineTerms(
  value: unknown,
  actorIds: readonly [string, string],
): { ok: true; terms: RequestDeadlineTerms } | NegotiationFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('negotiation_terms_invalid', '延期条款必须是结构化对象。');
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    'kind',
    'requestId',
    'issuerActorId',
    'assigneeActorId',
    'baseExpiresAtGameHour',
    'extensionGameHours',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    return failure('negotiation_terms_invalid', '延期条款包含不支持的字段。');
  }
  if (
    raw.kind !== 'request_deadline' ||
    typeof raw.requestId !== 'string' ||
    raw.requestId.length === 0 ||
    typeof raw.issuerActorId !== 'string' ||
    typeof raw.assigneeActorId !== 'string' ||
    !boundedInteger(raw.baseExpiresAtGameHour, 0, Number.MAX_SAFE_INTEGER) ||
    !boundedInteger(raw.extensionGameHours, 1, NEGOTIATION_MAX_REQUEST_EXTENSION_HOURS)
  ) {
    return failure(
      'negotiation_request_extension_invalid',
      `延期必须是 1..${NEGOTIATION_MAX_REQUEST_EXTENSION_HOURS} 个整数游戏小时。`,
    );
  }
  const participants = new Set(actorIds);
  if (
    raw.issuerActorId === raw.assigneeActorId ||
    !participants.has(raw.issuerActorId) ||
    !participants.has(raw.assigneeActorId) ||
    new Set([raw.issuerActorId, raw.assigneeActorId]).size !== participants.size
  ) {
    return failure(
      'negotiation_terms_participant_mismatch',
      '委托发起者与受托人必须恰好是当前会话的两名参与者。',
    );
  }
  return {
    ok: true,
    terms: {
      kind: 'request_deadline',
      requestId: raw.requestId,
      issuerActorId: raw.issuerActorId,
      assigneeActorId: raw.assigneeActorId,
      baseExpiresAtGameHour: raw.baseExpiresAtGameHour as number,
      extensionGameHours: raw.extensionGameHours as number,
    },
  };
}

export function parseEventCompensationTerms(
  value: unknown,
  actorIds: readonly [string, string],
): { ok: true; terms: EventCompensationTerms } | NegotiationFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failure('negotiation_terms_invalid', '赔偿条款必须是结构化对象。');
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    'kind',
    'harmEventId',
    'encounterId',
    'payerActorId',
    'payeeActorId',
    'harmDamage',
    'paymentItemId',
    'paymentQty',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    return failure('negotiation_terms_invalid', '赔偿条款包含不支持的字段。');
  }
  if (
    raw.kind !== 'event_compensation' ||
    typeof raw.harmEventId !== 'string' ||
    raw.harmEventId.length === 0 ||
    typeof raw.encounterId !== 'string' ||
    raw.encounterId.length === 0 ||
    typeof raw.payerActorId !== 'string' ||
    typeof raw.payeeActorId !== 'string' ||
    !boundedInteger(raw.harmDamage, 1, 100) ||
    raw.paymentItemId !== 'spirit_stone' ||
    !boundedInteger(raw.paymentQty, 1, NEGOTIATION_MAX_COMPENSATION_STONES)
  ) {
    return failure(
      'negotiation_compensation_amount_invalid',
      `赔偿只支持 1..${NEGOTIATION_MAX_COMPENSATION_STONES} 枚灵石的有界整数金额。`,
    );
  }
  const participants = new Set(actorIds);
  if (
    raw.payerActorId === raw.payeeActorId ||
    !participants.has(raw.payerActorId) ||
    !participants.has(raw.payeeActorId) ||
    new Set([raw.payerActorId, raw.payeeActorId]).size !== participants.size
  ) {
    return failure(
      'negotiation_terms_participant_mismatch',
      '赔偿人与受偿人必须恰好是当前会话的两名参与者。',
    );
  }
  return {
    ok: true,
    terms: {
      kind: 'event_compensation',
      harmEventId: raw.harmEventId,
      encounterId: raw.encounterId,
      payerActorId: raw.payerActorId,
      payeeActorId: raw.payeeActorId,
      harmDamage: raw.harmDamage as number,
      paymentItemId: 'spirit_stone',
      paymentQty: raw.paymentQty as number,
    },
  };
}

export function parseNegotiationTerms(
  value: unknown,
  actorIds: readonly [string, string],
): { ok: true; terms: NegotiationTerms } | NegotiationFailure {
  const kind =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>).kind
      : undefined;
  if (kind === 'request_deadline') return parseRequestDeadlineTerms(value, actorIds);
  if (kind === 'event_compensation') return parseEventCompensationTerms(value, actorIds);
  return parseHerbTradeTerms(value, actorIds);
}

export function negotiationUtteranceMatchesTerms(text: string, terms: HerbTradeTerms) {
  return (
    mentionedQuantities(text, /(\d{1,4})\s*(?:枚)?\s*灵石/gu).every(
      (quantity) => quantity === terms.paymentQty,
    ) &&
    mentionedQuantities(
      text,
      /(\d{1,3})\s*(?:株|份|件)?\s*(?:灵草|spirit_herb)/giu,
    ).every((quantity) => quantity === terms.itemQty)
  );
}

export function requestDeadlineUtteranceMatchesTerms(
  text: string,
  terms: RequestDeadlineTerms,
) {
  return mentionedQuantities(
    text,
    /(\d{1,3})\s*(?:个)?\s*(?:游戏)?\s*(?:时辰|小时)/gu,
  ).every((quantity) => quantity === terms.extensionGameHours);
}

export function negotiationTermsMatchUtterance(text: string, terms: NegotiationTerms) {
  if (terms.kind === 'herb_trade') return negotiationUtteranceMatchesTerms(text, terms);
  if (terms.kind === 'request_deadline') return requestDeadlineUtteranceMatchesTerms(text, terms);
  return eventCompensationUtteranceMatchesTerms(text, terms);
}

export function eventCompensationUtteranceMatchesTerms(
  text: string,
  terms: EventCompensationTerms,
) {
  return mentionedQuantities(text, /(\d{1,3})\s*(?:枚)?\s*灵石/gu).every(
    (quantity) => quantity === terms.paymentQty,
  );
}

export function validateRequestDeadlineSettlement(
  terms: RequestDeadlineTerms,
  request: RequestDeadlineView,
  nowGameHour: number,
): { ok: true; nextExpiresAt: number } | NegotiationFailure {
  if (
    request.issuerActorId !== terms.issuerActorId ||
    request.assigneeActorId !== terms.assigneeActorId
  ) {
    return failure(
      'negotiation_request_participant_mismatch',
      '延期条款与委托的发起者或受托人不一致。',
    );
  }
  if (!['accepted', 'ready_to_turn_in'].includes(request.status)) {
    return failure('negotiation_request_not_accepted', '只有已接受且尚未完成的委托可以延期。');
  }
  if (nowGameHour >= request.expiresAt) {
    return failure('negotiation_request_expired', '这桩委托已经到期，不能通过协商复活。');
  }
  if ((request.deadlineExtensionCount ?? 0) >= 1) {
    return failure(
      'negotiation_request_deadline_already_extended',
      '这桩委托已经成功延期过一次。',
    );
  }
  if (request.expiresAt !== terms.baseExpiresAtGameHour) {
    return failure(
      'negotiation_request_deadline_changed',
      '委托期限已经变化，旧延期条款失效。',
    );
  }
  const originalExpiresAt = request.originalExpiresAt ?? request.expiresAt;
  const nextExpiresAt = terms.baseExpiresAtGameHour + terms.extensionGameHours;
  if (
    nextExpiresAt <= request.expiresAt ||
    nextExpiresAt > originalExpiresAt + NEGOTIATION_MAX_REQUEST_EXTENSION_HOURS
  ) {
    return failure(
      'negotiation_request_extension_invalid',
      `每桩委托总计最多延长 ${NEGOTIATION_MAX_REQUEST_EXTENSION_HOURS} 个游戏小时。`,
    );
  }
  return { ok: true, nextExpiresAt };
}

export function validateEventCompensationSettlement(
  terms: EventCompensationTerms,
  source: EventCompensationSourceView,
  nowGameHour: number,
): { ok: true } | NegotiationFailure {
  if (
    source.harmEventId !== terms.harmEventId ||
    source.encounterId !== terms.encounterId ||
    source.terminalEventId !== terms.harmEventId ||
    source.attackerActorId !== terms.payerActorId ||
    source.defenderActorId !== terms.payeeActorId ||
    source.encounterStatus !== 'defender_defeated' ||
    source.winnerActorId !== terms.payerActorId ||
    source.defeatedActorId !== terms.payeeActorId ||
    source.eventType !== 'combatant_defeated' ||
    !source.eventActorIds.includes(terms.payerActorId) ||
    !source.eventTargetActorIds.includes(terms.payeeActorId) ||
    source.eventEncounterId !== terms.encounterId ||
    source.eventTargetActorId !== terms.payeeActorId ||
    source.eventDamage !== terms.harmDamage ||
    source.eventDefeated !== true
  ) {
    return failure(
      'negotiation_compensation_source_mismatch',
      '赔偿条款与服务端的击倒事件、遭遇或当事人不一致。',
    );
  }
  if (source.compensationNegotiationId) {
    return failure(
      'negotiation_compensation_already_settled',
      '这次冲突事件已经完成过一次赔偿结算。',
    );
  }
  if (
    source.eventGameHour > nowGameHour ||
    nowGameHour - source.eventGameHour > NEGOTIATION_COMPENSATION_WINDOW_GAME_HOURS
  ) {
    return failure(
      'negotiation_compensation_expired',
      '这次冲突已超过七个场景游戏日的赔偿协商期。',
    );
  }
  if (source.payerAvailableSpiritStones < terms.paymentQty) {
    return failure(
      'negotiation_compensation_funds_unavailable',
      '责任方没有足够未预约灵石履行当前赔偿条款。',
    );
  }
  return { ok: true };
}

export function validateNegotiationResponse(
  session: NegotiationSessionView,
  proposal: NegotiationProposalView,
  input: { actorId: string; operation: Exclude<NegotiationOperation, 'open'>; revision: number; now: number },
):
  | {
      ok: true;
      nextSessionStatus: NegotiationStatus;
      nextProposalStatus: NegotiationProposalStatus;
      nextResponderActorId?: string;
    }
  | NegotiationFailure {
  if (!['opened', 'active'].includes(session.status) || proposal.status !== 'active') {
    return failure('negotiation_not_active', '这轮议价已经结束。');
  }
  if (input.now >= session.expiresAt) {
    return failure('negotiation_expired', '这轮议价已经超时。');
  }
  if (
    input.revision !== session.revision ||
    proposal.revision !== session.revision ||
    proposal.proposalId !== session.currentProposalId
  ) {
    return failure('negotiation_revision_stale', '这份报价已被更新，不能按旧 revision 回应。');
  }
  if (input.operation === 'withdraw') {
    if (input.actorId !== proposal.proposerActorId) {
      return failure('negotiation_not_proposer', '只有当前报价的提出者可以撤回。');
    }
    return { ok: true, nextSessionStatus: 'withdrawn', nextProposalStatus: 'withdrawn' };
  }
  if (
    input.actorId !== proposal.recipientActorId ||
    input.actorId !== session.currentResponderActorId
  ) {
    return failure('negotiation_wrong_responder', '只有当前报价的指定接收者可以回应。');
  }
  if (input.operation === 'counter') {
    if (session.revision >= NEGOTIATION_MAX_PROPOSALS) {
      return failure('negotiation_revision_limit', '这轮议价已达到反提议上限。');
    }
    return {
      ok: true,
      nextSessionStatus: 'active',
      nextProposalStatus: 'superseded',
      nextResponderActorId: proposal.proposerActorId,
    };
  }
  if (input.operation === 'accept') {
    return { ok: true, nextSessionStatus: 'settled', nextProposalStatus: 'accepted' };
  }
  return { ok: true, nextSessionStatus: 'rejected', nextProposalStatus: 'rejected' };
}

export function inventoryAvailable(
  inventory: Array<{ itemId: string; qty: number }>,
  itemId: string,
  qty: number,
  reserved: number,
) {
  const owned = inventory.find((item) => item.itemId === itemId)?.qty ?? 0;
  return Number.isInteger(owned) && Number.isInteger(reserved) && owned - reserved >= qty;
}

function mentionedQuantities(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

function boundedInteger(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function failure(reasonCode: string, reason: string): NegotiationFailure {
  return { ok: false, reasonCode, reason };
}
