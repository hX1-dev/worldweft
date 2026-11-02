import type { SpeechAct } from './conversationContracts';

export const GROUP_CONVERSATION_MIN_PARTICIPANTS = 3;
export const GROUP_CONVERSATION_MAX_PARTICIPANTS = 5;
export const GROUP_CONVERSATION_MAX_OBSERVERS = 8;
export const GROUP_CONVERSATION_MAX_TURNS = 15;
export const GROUP_CONVERSATION_TTL_MS = 10 * 60 * 1000;
export const GROUP_CONVERSATION_MAX_UTTERANCE_CHARS = 600;
export const GROUP_CONVERSATION_MAX_KNOWLEDGE_REFS = 8;

export type GroupConversationStatus = 'active' | 'resolved' | 'cancelled' | 'expired';

export type GroupConversationView = {
  status: GroupConversationStatus;
  participantActorIds: string[];
  observerActorIds: string[];
  currentSpeakerActorId?: string;
  turnNumber: number;
  maxTurns: number;
  expiresAt: number;
};

export type GroupConversationFailure = { ok: false; reasonCode: string; reason: string };

export type GroupConversationMembershipPlan = {
  ok: true;
  participantActorIds: string[];
  observerActorIds: string[];
  firstSpeakerActorId: string;
  nextSpeakerActorId: string;
};

export type GroupConversationTurnPlan = {
  ok: true;
  turnNumber: number;
  text: string;
  addressedActorIds: string[];
  referencedFactIds: string[];
  referencedBeliefIds: string[];
  listenerActorIds: string[];
  nextSpeakerActorId?: string;
  terminalStatus?: 'resolved';
  terminalReasonCode?: 'group_conversation_ended' | 'group_conversation_turn_limit';
};

export function planGroupConversationMembership(input: {
  actorId: string;
  participantActorIds: string[];
  observerActorIds?: string[];
}): GroupConversationMembershipPlan | GroupConversationFailure {
  const participants = normalized(input.participantActorIds);
  const observers = normalized(input.observerActorIds ?? []);
  if (
    participants.length < GROUP_CONVERSATION_MIN_PARTICIPANTS ||
    participants.length > GROUP_CONVERSATION_MAX_PARTICIPANTS
  ) {
    return failure(
      'group_participant_count_invalid',
      `群体会话必须有 ${GROUP_CONVERSATION_MIN_PARTICIPANTS}..${GROUP_CONVERSATION_MAX_PARTICIPANTS} 名参与者。`,
    );
  }
  if (
    !participants.includes(input.actorId) ||
    observers.length > GROUP_CONVERSATION_MAX_OBSERVERS ||
    observers.some((actorId) => participants.includes(actorId)) ||
    participants.length !== input.participantActorIds.length ||
    observers.length !== (input.observerActorIds ?? []).length
  ) {
    return failure('group_membership_invalid', '参与者与旁听者必须唯一、不重叠，且发起者必须参与。');
  }
  const firstSpeakerIndex = participants.indexOf(input.actorId);
  return {
    ok: true,
    participantActorIds: participants,
    observerActorIds: observers,
    firstSpeakerActorId: input.actorId,
    nextSpeakerActorId: participants[(firstSpeakerIndex + 1) % participants.length],
  };
}

export function validateGroupConversationTurn(
  session: GroupConversationView,
  input: {
    actorId: string;
    turnId: string;
    expectedTurnNumber: number;
    speechAct: SpeechAct;
    utteranceText: string;
    addressedActorIds: string[];
    referencedFactIds: string[];
    referencedBeliefIds: string[];
    now: number;
  },
  seenTurnIds: ReadonlySet<string> = new Set(),
): GroupConversationTurnPlan | GroupConversationFailure {
  if (session.status !== 'active') {
    return failure('group_conversation_not_active', '群体会话已经结束。');
  }
  if (input.now >= session.expiresAt) {
    return failure('group_conversation_expired', '群体会话已经超时。');
  }
  if (session.observerActorIds.includes(input.actorId)) {
    return failure('group_observer_cannot_speak', '旁听者没有发言权。');
  }
  if (!session.participantActorIds.includes(input.actorId)) {
    return failure('group_membership_invalid', '发言者不是该群体会话成员。');
  }
  if (session.currentSpeakerActorId !== input.actorId) {
    return failure('group_wrong_speaker', '当前发言权不属于该角色。');
  }
  if (seenTurnIds.has(input.turnId)) {
    return failure('group_duplicate_turn', '该群体 turnId 已使用。');
  }
  const turnNumber = session.turnNumber + 1;
  if (input.expectedTurnNumber !== turnNumber) {
    return failure('group_turn_mismatch', '提交轮次与服务端下一轮不一致。');
  }
  const text = input.utteranceText.trim();
  if (!text) return failure('conversation_utterance_empty', '发言内容不能为空。');
  if (text.length > GROUP_CONVERSATION_MAX_UTTERANCE_CHARS) {
    return failure('conversation_utterance_too_long', '发言内容超过长度上限。');
  }
  const addressed = normalized(input.addressedActorIds);
  if (
    addressed.length === 0 ||
    addressed.length !== input.addressedActorIds.length ||
    addressed.some(
      (actorId) =>
        actorId === input.actorId || !session.participantActorIds.includes(actorId),
    )
  ) {
    return failure('group_address_invalid', '直接发言对象必须是其他发言参与者。');
  }
  const facts = normalized(input.referencedFactIds);
  const beliefs = normalized(input.referencedBeliefIds);
  if (
    facts.length > GROUP_CONVERSATION_MAX_KNOWLEDGE_REFS ||
    beliefs.length > GROUP_CONVERSATION_MAX_KNOWLEDGE_REFS
  ) {
    return failure('conversation_knowledge_limit', '单轮知识引用超过上限。');
  }
  const terminal = input.speechAct === 'end_topic' || turnNumber >= session.maxTurns;
  const speakerIndex = session.participantActorIds.indexOf(input.actorId);
  return {
    ok: true,
    turnNumber,
    text,
    addressedActorIds: addressed,
    referencedFactIds: facts,
    referencedBeliefIds: beliefs,
    listenerActorIds: [
      ...session.participantActorIds.filter((actorId) => actorId !== input.actorId),
      ...session.observerActorIds,
    ],
    nextSpeakerActorId: terminal
      ? undefined
      : session.participantActorIds[(speakerIndex + 1) % session.participantActorIds.length],
    terminalStatus: terminal ? 'resolved' : undefined,
    terminalReasonCode: terminal
      ? input.speechAct === 'end_topic'
        ? 'group_conversation_ended'
        : 'group_conversation_turn_limit'
      : undefined,
  };
}

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function failure(reasonCode: string, reason: string): GroupConversationFailure {
  return { ok: false, reasonCode, reason };
}
