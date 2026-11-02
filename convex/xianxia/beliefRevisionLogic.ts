import type {
  BeliefEvidenceVerdict,
  BeliefKind,
  ClaimTruthStatus,
  SpeechAct,
} from './conversationContracts';

export const INITIAL_RUMOR_CONFIDENCE = 0.35;
export const INITIAL_CLAIM_CONFIDENCE = 0.55;
export const INITIAL_SUPPORTED_CONFIDENCE = 0.7;

export type BeliefRevisionInput = {
  kind: BeliefKind;
  confidence: number;
  truthStatus?: ClaimTruthStatus;
  revision?: number;
};

export type BeliefRevisionPlan = {
  revision: number;
  kind: BeliefKind;
  confidence: number;
  truthStatus: ClaimTruthStatus;
};

export type KnowledgeReferenceAccess = {
  eventVisibility: 'public' | 'local' | 'private' | 'witnessed' | 'rumor';
  eventType: string;
  eventContainsClaim: boolean;
  principal: boolean;
  memories: Array<{ source: 'direct' | 'witness' | 'present' | 'rumor'; distorted: boolean }>;
};

export function authoritativeFactAccess(input: KnowledgeReferenceAccess):
  | { ok: true }
  | { ok: false; reasonCode: 'conversation_fact_not_authoritative' | 'conversation_fact_not_visible' } {
  if (
    input.eventVisibility === 'rumor' ||
    input.eventContainsClaim ||
    input.eventType === 'conversation_utterance' ||
    input.eventType === 'group_conversation_utterance'
  ) {
    return { ok: false, reasonCode: 'conversation_fact_not_authoritative' };
  }
  if (input.eventVisibility === 'public' || input.principal) return { ok: true };
  if (input.memories.some((memory) => memory.source !== 'rumor' && !memory.distorted)) {
    return { ok: true };
  }
  return {
    ok: false,
    reasonCode: input.memories.length > 0
      ? 'conversation_fact_not_authoritative'
      : 'conversation_fact_not_visible',
  };
}

export function initialBeliefState(input: {
  kind: 'claim' | 'rumor';
  supported: boolean;
}): Omit<BeliefRevisionPlan, 'revision'> {
  if (input.kind === 'rumor') {
    return { kind: 'rumor', confidence: INITIAL_RUMOR_CONFIDENCE, truthStatus: 'unknown' };
  }
  if (input.supported) {
    return { kind: 'claim', confidence: INITIAL_SUPPORTED_CONFIDENCE, truthStatus: 'supported' };
  }
  return { kind: 'claim', confidence: INITIAL_CLAIM_CONFIDENCE, truthStatus: 'unknown' };
}

export function reviseBelief(
  current: BeliefRevisionInput | undefined,
  verdict: BeliefEvidenceVerdict,
): BeliefRevisionPlan {
  const confidence = clamp01(current?.confidence ?? INITIAL_CLAIM_CONFIDENCE);
  const revision = Math.max(0, Math.floor(current?.revision ?? 0)) + 1;
  if (verdict === 'confirm') {
    return { revision, kind: 'belief', confidence: Math.max(0.85, confidence), truthStatus: 'supported' };
  }
  if (verdict === 'refute') {
    return { revision, kind: 'belief', confidence: Math.min(0.15, confidence), truthStatus: 'contradicted' };
  }
  return {
    revision,
    kind: current?.kind ?? 'belief',
    confidence: clamp01(Math.max(0.2, confidence - 0.15)),
    truthStatus: 'unknown',
  };
}

export function validateEvidenceUse(input: {
  speechAct: SpeechAct;
  factCount: number;
  beliefCount: number;
  currentTopicId: string;
  beliefTopicId?: string;
  beliefSubjectClaimId?: string;
  evidenceTopicId?: string;
  evidenceSubjectClaimId?: string;
  evidenceFound: boolean;
}): { ok: true } | { ok: false; reasonCode: string } {
  if (input.factCount === 0 || input.beliefCount === 0) return { ok: true };
  if (input.speechAct !== 'clarify') {
    return { ok: false, reasonCode: 'conversation_evidence_requires_clarify' };
  }
  if (input.factCount !== 1 || input.beliefCount !== 1) {
    return { ok: false, reasonCode: 'conversation_evidence_arity_invalid' };
  }
  if (!input.evidenceFound) {
    return { ok: false, reasonCode: 'conversation_evidence_not_registered' };
  }
  if (
    !input.beliefTopicId ||
    !input.evidenceTopicId ||
    input.beliefTopicId !== input.currentTopicId ||
    input.evidenceTopicId !== input.currentTopicId
  ) {
    return { ok: false, reasonCode: 'conversation_evidence_topic_mismatch' };
  }
  if (
    !input.beliefSubjectClaimId ||
    !input.evidenceSubjectClaimId ||
    input.beliefSubjectClaimId !== input.evidenceSubjectClaimId
  ) {
    return { ok: false, reasonCode: 'conversation_evidence_subject_mismatch' };
  }
  return { ok: true };
}

export type BeliefFollowup = {
  speechAct: 'ask' | 'respond' | 'refuse';
  reasonCode: 'rumor_unverified' | 'evidence_confirmed' | 'evidence_refuted' | 'claim_unverified';
};

export function planBeliefFollowup(input: {
  kind: BeliefKind;
  truthStatus?: ClaimTruthStatus;
}): BeliefFollowup {
  if (input.truthStatus === 'supported') {
    return { speechAct: 'respond', reasonCode: 'evidence_confirmed' };
  }
  if (input.truthStatus === 'contradicted') {
    return { speechAct: 'refuse', reasonCode: 'evidence_refuted' };
  }
  if (input.kind === 'rumor') {
    return { speechAct: 'ask', reasonCode: 'rumor_unverified' };
  }
  return { speechAct: 'ask', reasonCode: 'claim_unverified' };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
