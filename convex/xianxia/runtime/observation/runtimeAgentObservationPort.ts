import type { LifeObservationV1 } from '../../lifeObservation';
import {
  buildAuthoritativeDecisionSnapshot,
  type AuthoritativeDecisionSnapshot,
} from '../../runtimeDecisionSnapshot';

/**
 * C1a keeps the existing observation builder authoritative while moving the
 * read-only snapshot binding out of the wake orchestrator.  It owns no row,
 * candidate, decision or action and therefore cannot change their digests.
 */
export function bindRuntimeAgentObservation(input: {
  observation: LifeObservationV1;
  candidateSetDigest?: string;
  activeExecution?: { executionId: string };
  activeConversation?: { conversationId: string };
  activeGroupConversation?: { groupConversationId: string };
  now: number;
}): {
  observation: LifeObservationV1;
  authoritativeDecisionSnapshot?: AuthoritativeDecisionSnapshot;
} {
  if (!input.candidateSetDigest) return { observation: input.observation };
  return {
    observation: input.observation,
    authoritativeDecisionSnapshot: buildAuthoritativeDecisionSnapshot({
      observation: input.observation,
      candidateSetDigest: input.candidateSetDigest,
      activeExecution: input.activeExecution,
      activeConversation: input.activeConversation,
      activeGroupConversation: input.activeGroupConversation,
      now: input.now,
    }),
  };
}
