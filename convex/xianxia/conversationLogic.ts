import type { BeliefKind, ConversationStatus, SpeechAct } from './conversationContracts';

export const CONVERSATION_MAX_TURNS = 12;
export const CONVERSATION_TTL_MS = 10 * 60 * 1000;
export const CONVERSATION_MAX_UTTERANCE_CHARS = 600;
export const CONVERSATION_MAX_KNOWLEDGE_REFS = 8;

export type ConversationView = {
  conversationId: string;
  status: ConversationStatus;
  actorAId: string;
  actorBId: string;
  currentSpeakerActorId?: string;
  turnNumber: number;
  maxTurns: number;
  expiresAt: number;
};

export type ConversationTurnInput = {
  actorId: string;
  targetActorId?: string;
  turnId: string;
  expectedTurnNumber: number;
  speechAct: SpeechAct;
  utteranceText: string;
  addressedActorIds: string[];
  referencedFactIds: string[];
  referencedBeliefIds: string[];
  now: number;
};

export type ConversationFailure = { ok: false; reasonCode: string; reason: string };
export type ConversationTurnPlan = {
  ok: true;
  turnNumber: number;
  text: string;
  addressedActorIds: string[];
  referencedFactIds: string[];
  referencedBeliefIds: string[];
  nextSpeakerActorId?: string;
  terminalStatus?: 'resolved';
  terminalReasonCode?: 'conversation_ended' | 'conversation_turn_limit';
};

export function orderedConversationActors(actorId: string, targetActorId: string) {
  return actorId.localeCompare(targetActorId) <= 0
    ? { actorAId: actorId, actorBId: targetActorId }
    : { actorAId: targetActorId, actorBId: actorId };
}

export function conversationParticipants(session: ConversationView) {
  return [session.actorAId, session.actorBId];
}

export function validateConversationTurn(
  session: ConversationView,
  input: ConversationTurnInput,
  seenTurnIds: ReadonlySet<string> = new Set(),
): ConversationTurnPlan | ConversationFailure {
  if (session.status !== 'active') {
    return failure('conversation_not_active', '该会话当前不能继续发言。');
  }
  if (input.now >= session.expiresAt) {
    return failure('conversation_expired', '该会话已超过有效时间。');
  }
  const participants = conversationParticipants(session);
  if (!participants.includes(input.actorId)) {
    return failure('conversation_not_participant', '发言者不是该会话的参与者。');
  }
  const otherActorId = participants.find((actorId) => actorId !== input.actorId)!;
  if (input.targetActorId !== otherActorId) {
    return failure('conversation_target_mismatch', '本轮目标与会话中的另一位参与者不一致。');
  }
  if (session.currentSpeakerActorId !== input.actorId) {
    return failure('conversation_wrong_speaker', '当前发言权不属于该角色。');
  }
  if (seenTurnIds.has(input.turnId)) {
    return failure('conversation_duplicate_turn', '该 turnId 已经使用。');
  }
  const nextTurnNumber = session.turnNumber + 1;
  if (input.expectedTurnNumber !== nextTurnNumber) {
    return failure('conversation_turn_mismatch', '提交的轮次与服务端下一轮不一致。');
  }
  const text = input.utteranceText.trim();
  if (!text) return failure('conversation_utterance_empty', '发言内容不能为空。');
  if (text.length > CONVERSATION_MAX_UTTERANCE_CHARS) {
    return failure('conversation_utterance_too_long', '发言内容超过长度上限。');
  }
  const addressed = unique(input.addressedActorIds);
  if (
    addressed.length === 0 ||
    addressed.some((actorId) => actorId === input.actorId || !participants.includes(actorId))
  ) {
    return failure('conversation_address_invalid', '发言对象必须是会话中的其他参与者。');
  }
  const facts = unique(input.referencedFactIds);
  const beliefs = unique(input.referencedBeliefIds);
  if (
    facts.length > CONVERSATION_MAX_KNOWLEDGE_REFS ||
    beliefs.length > CONVERSATION_MAX_KNOWLEDGE_REFS
  ) {
    return failure('conversation_knowledge_limit', '单轮引用的事实或信念数量超过上限。');
  }
  const terminal = input.speechAct === 'end_topic' || nextTurnNumber >= session.maxTurns;
  return {
    ok: true,
    turnNumber: nextTurnNumber,
    text,
    addressedActorIds: addressed,
    referencedFactIds: facts,
    referencedBeliefIds: beliefs,
    nextSpeakerActorId: terminal ? undefined : otherActorId,
    terminalStatus: terminal ? 'resolved' : undefined,
    terminalReasonCode: terminal
      ? input.speechAct === 'end_topic'
        ? 'conversation_ended'
        : 'conversation_turn_limit'
      : undefined,
  };
}

export function claimBeliefKind(sourceKinds: BeliefKind[]): 'claim' | 'rumor' {
  // A listener hears an original assertion as a claim. Once any actor retells
  // an owned claim/belief, the next delivery is quotation-derived rumor; its
  // wording or number of relays can never make it a world fact.
  return sourceKinds.length > 0 ? 'rumor' : 'claim';
}

export function speechActCreatesClaim(speechAct: SpeechAct) {
  return speechAct === 'inform' || speechAct === 'clarify';
}

const SPEECH_ACTS: ReadonlySet<string> = new Set([
  'greet',
  'ask',
  'inform',
  'request',
  'respond',
  'refuse',
  'clarify',
  'end_topic',
]);

export function parseSpeechAct(value: unknown): SpeechAct | null {
  return typeof value === 'string' && SPEECH_ACTS.has(value) ? (value as SpeechAct) : null;
}

export function initialSpeechAct(intent?: string): SpeechAct {
  return intent?.trim() ? 'request' : 'greet';
}

export function initialUtterance(actorName: string, targetName: string, intent?: string) {
  const topic = intent?.trim();
  return topic
    ? `${targetName}，我想同你谈谈「${topic.slice(0, 80)}」。`
    : `${targetName}，近来可好？`;
}

function unique(values: string[]) {
  return [...new Set(values.filter((value) => value.trim()).map((value) => value.trim()))];
}

function failure(reasonCode: string, reason: string): ConversationFailure {
  return { ok: false, reasonCode, reason };
}
