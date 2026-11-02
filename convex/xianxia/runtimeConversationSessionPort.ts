import type { ActionResult } from './actionSchema';
import { parseSpeechAct } from './conversationLogic';
import type { SpeechAct } from './conversationContracts';

export type ConversationSessionOperation =
  | 'invite'
  | 'accept'
  | 'refuse'
  | 'speech'
  | 'close'
  | 'expired';

export type ConversationSessionReceipt = {
  source: 'action_record';
  operation: ConversationSessionOperation;
  actionRecordId: string;
  actorId: string;
  sessionRef: string;
  sourceRevision: number;
  idempotencyKey: string;
  resultCode: string;
  domainOutcome: 'applied' | 'rejected' | 'failed' | 'no_effect';
  receiptKey: string;
};

/**
 * C2's narrow talk-admission seam.  It admits only the shape of an existing
 * session continuation; ActionGateway still verifies actors, location and
 * current session state before any conversation write.
 */
export type TalkAdmission =
  | { kind: 'start' }
  | {
      kind: 'speech';
      conversationId: string;
      turnId: string;
      expectedTurnNumber: number;
      speechAct: SpeechAct;
      utteranceText: string;
    }
  | { kind: 'rejected'; result: ActionResult };

export function admitTalk(input: {
  conversationId?: string;
  turnId?: string;
  expectedTurnNumber?: number;
  speechAct: unknown;
  utteranceText?: string;
}): TalkAdmission {
  if (!input.conversationId) return { kind: 'start' };
  const speechAct = parseSpeechAct(input.speechAct);
  if (!speechAct || !input.turnId || input.expectedTurnNumber === undefined || !input.utteranceText) {
    return {
      kind: 'rejected',
      result: {
        status: 'rejected',
        resultCode: 'missing_param',
        reason: '继续会话需要 conversationId、turnId、expectedTurnNumber、speechAct 与 utteranceText。',
        effects: {},
        eventType: 'action_rejected',
        visibility: 'private',
      },
    };
  }
  return {
    kind: 'speech',
    conversationId: input.conversationId,
    turnId: input.turnId,
    expectedTurnNumber: input.expectedTurnNumber,
    speechAct,
    utteranceText: input.utteranceText,
  };
}

export function conversationSessionIdempotencyKey(
  actionRecordId: string,
  sourceRevision: number,
) {
  return `conversation-session:${actionRecordId}:revision:${sourceRevision}`;
}

/**
 * This projects an already-authoritative invitation/session result. It never
 * writes relationship, memory, warrant, or session facts.
 */
export function receiptForConversationSession(input: {
  source: string;
  operation: ConversationSessionOperation;
  actionRecordId: string;
  actorId: string;
  sessionRef: string;
  sourceRevision: number;
  idempotencyKey: string;
  result: ActionResult;
}): ConversationSessionReceipt | undefined {
  if (
    input.source !== 'action_record' ||
    !input.actionRecordId ||
    !input.actorId ||
    !input.sessionRef ||
    !Number.isSafeInteger(input.sourceRevision) ||
    input.sourceRevision < 1
  ) {
    return undefined;
  }
  const expectedKey = conversationSessionIdempotencyKey(
    input.actionRecordId,
    input.sourceRevision,
  );
  if (input.idempotencyKey !== expectedKey) return undefined;
  return {
    source: 'action_record',
    operation: input.operation,
    actionRecordId: input.actionRecordId,
    actorId: input.actorId,
    sessionRef: input.sessionRef,
    sourceRevision: input.sourceRevision,
    idempotencyKey: expectedKey,
    resultCode: input.result.resultCode,
    domainOutcome: input.result.status === 'rejected'
      ? 'rejected'
      : input.result.status === 'interrupted'
        ? 'failed'
        : 'no_effect',
    receiptKey: `${expectedKey}:${input.operation}`,
  };
}
