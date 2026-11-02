import type { LifeObservationV1 } from './lifeObservation';
import { stableObservationDigest } from './lifeObservation';

export const AUTHORITATIVE_DECISION_SNAPSHOT_VERSION =
  'taixu.runtime-decision-snapshot.v1' as const;

export type AuthoritativeDecisionSnapshot = {
  contractVersion: typeof AUTHORITATIVE_DECISION_SNAPSHOT_VERSION;
  actorId: string;
  observation: LifeObservationV1;
  observationRevision: string;
  candidateSetDigest: string;
  privacyDigest: string;
  busy: boolean;
  lease?: { leaseId: string; expiresAt: number };
  snapshotDigest: string;
};

/**
 * A read-only envelope over the existing agent query result. It deliberately
 * stores no world facts of its own: Observation and CandidateSet stay owned by
 * their current builders and are only bound together for later adapters.
 */
export function buildAuthoritativeDecisionSnapshot(input: {
  observation: LifeObservationV1;
  candidateSetDigest?: string;
  activeExecution?: { executionId: string };
  activeConversation?: { conversationId: string };
  activeGroupConversation?: { groupConversationId: string };
  lease?: { leaseId: string; expiresAt: number };
  now: number;
}): AuthoritativeDecisionSnapshot {
  const candidateSetDigest = input.candidateSetDigest;
  if (!candidateSetDigest || !input.observation.observationRevision) {
    throw new Error('authoritative_decision_snapshot_source_missing');
  }
  if (input.lease && input.lease.expiresAt <= input.now) {
    throw new Error('authoritative_decision_snapshot_lease_expired');
  }
  const busy = Boolean(
    input.activeExecution || input.activeConversation || input.activeGroupConversation,
  );
  const privacyDigest = stableObservationDigest({
    actorId: input.observation.actorId,
    targetRefs: input.observation.targetRefs,
    beliefs: input.observation.beliefs,
    memories: input.observation.memories,
    bounds: input.observation.bounds,
  });
  const snapshotDigest = stableObservationDigest({
    contractVersion: AUTHORITATIVE_DECISION_SNAPSHOT_VERSION,
    actorId: input.observation.actorId,
    observationRevision: input.observation.observationRevision,
    candidateSetDigest,
    privacyDigest,
    busy,
    lease: input.lease,
  });
  return {
    contractVersion: AUTHORITATIVE_DECISION_SNAPSHOT_VERSION,
    actorId: input.observation.actorId,
    observation: input.observation,
    observationRevision: input.observation.observationRevision,
    candidateSetDigest,
    privacyDigest,
    busy,
    lease: input.lease,
    snapshotDigest,
  };
}
