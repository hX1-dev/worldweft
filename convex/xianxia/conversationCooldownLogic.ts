import { MS_PER_GAME_HOUR } from './timeLogic';
import { orderedConversationActors } from './conversationLogic';

export const CONVERSATION_ACTOR_COOLDOWN_MS = 1 * MS_PER_GAME_HOUR;
export const CONVERSATION_PAIR_COOLDOWN_MS = 6 * MS_PER_GAME_HOUR;
export const CONVERSATION_TOPIC_COOLDOWN_MS = 24 * MS_PER_GAME_HOUR;

export type ConversationCooldownScope = 'actor' | 'pair' | 'topic';

export type ConversationCooldownEntry = {
  cooldownKey: string;
  scope: ConversationCooldownScope;
  actorId?: string;
  targetActorId?: string;
  topicId?: string;
  nextAllowedAt: number;
};

export type ConversationCooldownFailure = {
  ok: false;
  reasonCode:
    | 'conversation_actor_cooldown'
    | 'conversation_target_cooldown'
    | 'conversation_pair_cooldown'
    | 'conversation_topic_cooldown';
  reason: string;
  nextAllowedAt: number;
  cooldownKey: string;
};

export function conversationActorCooldownKey(actorId: string) {
  return `talk:actor:${JSON.stringify(actorId)}`;
}

export function conversationPairCooldownKey(actorId: string, targetActorId: string) {
  const pair = orderedConversationActors(actorId, targetActorId);
  return `talk:pair:${JSON.stringify([pair.actorAId, pair.actorBId])}`;
}

export function conversationTopicCooldownKey(
  actorId: string,
  targetActorId: string,
  topicId: string,
) {
  const pair = orderedConversationActors(actorId, targetActorId);
  return `talk:topic:${JSON.stringify([pair.actorAId, pair.actorBId, topicId])}`;
}

export function conversationCooldownEntries(args: {
  actorId: string;
  targetActorId: string;
  topicId: string;
  startedAt: number;
}): ConversationCooldownEntry[] {
  const pair = orderedConversationActors(args.actorId, args.targetActorId);
  return [
    {
      cooldownKey: conversationActorCooldownKey(args.actorId),
      scope: 'actor',
      actorId: args.actorId,
      nextAllowedAt: args.startedAt + CONVERSATION_ACTOR_COOLDOWN_MS,
    },
    {
      cooldownKey: conversationActorCooldownKey(args.targetActorId),
      scope: 'actor',
      actorId: args.targetActorId,
      nextAllowedAt: args.startedAt + CONVERSATION_ACTOR_COOLDOWN_MS,
    },
    {
      cooldownKey: conversationPairCooldownKey(args.actorId, args.targetActorId),
      scope: 'pair',
      actorId: pair.actorAId,
      targetActorId: pair.actorBId,
      nextAllowedAt: args.startedAt + CONVERSATION_PAIR_COOLDOWN_MS,
    },
    {
      cooldownKey: conversationTopicCooldownKey(args.actorId, args.targetActorId, args.topicId),
      scope: 'topic',
      actorId: pair.actorAId,
      targetActorId: pair.actorBId,
      topicId: args.topicId,
      nextAllowedAt: args.startedAt + CONVERSATION_TOPIC_COOLDOWN_MS,
    },
  ];
}

export function evaluateConversationCooldown(args: {
  actorId: string;
  targetActorId: string;
  topicId: string;
  now: number;
  cooldowns: ReadonlyMap<string, { nextAllowedAt: number }>;
}): { ok: true } | ConversationCooldownFailure {
  const candidates: Array<{
    key: string;
    reasonCode: ConversationCooldownFailure['reasonCode'];
    reason: string;
  }> = [
    {
      key: conversationActorCooldownKey(args.actorId),
      reasonCode: 'conversation_actor_cooldown',
      reason: '发起者刚参与过交谈，需要稍候再开启新会话。',
    },
    {
      key: conversationActorCooldownKey(args.targetActorId),
      reasonCode: 'conversation_target_cooldown',
      reason: '对方刚参与过交谈，需要稍候再开启新会话。',
    },
    {
      key: conversationPairCooldownKey(args.actorId, args.targetActorId),
      reasonCode: 'conversation_pair_cooldown',
      reason: '双方刚结束一次交谈，不能立刻换个入口重新刷取关系。',
    },
    {
      key: conversationTopicCooldownKey(args.actorId, args.targetActorId, args.topicId),
      reasonCode: 'conversation_topic_cooldown',
      reason: '双方最近已经谈过这个话题，重复寒暄不会再次生效。',
    },
  ];
  for (const candidate of candidates) {
    const cooldown = args.cooldowns.get(candidate.key);
    if (cooldown && args.now < cooldown.nextAllowedAt) {
      return {
        ok: false,
        reasonCode: candidate.reasonCode,
        reason: candidate.reason,
        nextAllowedAt: cooldown.nextAllowedAt,
        cooldownKey: candidate.key,
      };
    }
  }
  return { ok: true };
}
