import { type Infer, v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';
import {
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
  validateSocialOpportunityCandidate,
  validateSocialWarrant,
  type SocialOpportunityActivity,
  type SocialWarrant,
  type SocialWarrantOutcome,
} from './socialWarrantContracts';

export const SOCIAL_OUTCOME_VERSION = 'taixu.social-outcome.v1' as const;

export const socialOutcomeStatusValidator = v.union(
  v.literal('pending'),
  v.literal('resolved'),
  v.literal('failed'),
  v.literal('cancelled'),
  v.literal('expired'),
);
export type SocialOutcomeStatus = Infer<typeof socialOutcomeStatusValidator>;

export type SocialOutcomeBinding = {
  contractVersion: typeof SOCIAL_OUTCOME_VERSION;
  outcomeId: string;
  scopeKey: string;
  actorId: string;
  targetActorIds: string[];
  sourceRef: string;
  sourceRevision: string;
  intendedOutcome: SocialWarrantOutcome;
  activity: SocialOpportunityActivity;
  topicRefs: string[];
  audience: SocialWarrant['audience'];
  warrantId: string;
  warrantDigest: string;
  candidateId: string;
  candidateDigest: string;
  warrantCandidateDigest: string;
};

export type SocialOutcomeReceipt = SocialOutcomeBinding & {
  revision: number;
  status: SocialOutcomeStatus;
  openedByActionId: string;
  openedEventId: string;
  conversationId?: string;
  groupConversationId?: string;
  terminalActionId?: string;
  terminalEventId?: string;
  outcomeEventId?: string;
  terminalResultCode?: string;
  terminalReasonCode?: string;
  cooldownUntilGameHour?: number;
  createdGameHour: number;
  terminalGameHour?: number;
};

export type SocialOutcomeSpeechEvidence = {
  speakerActorId: string;
  speechAct: string;
  referencedFactIds?: readonly string[];
  referencedBeliefIds?: readonly string[];
  claimTruthStatus?: 'unknown' | 'supported' | 'contradicted';
};

export type SocialOutcomeTerminalEvidence = {
  resultCode: string;
  eventType?: string;
  conversationStatus?: string;
  groupConversationStatus?: string;
  speech?: readonly SocialOutcomeSpeechEvidence[];
  knowledgeDeliveryCount?: number;
  groupProposalStatus?: string;
  commitmentStatus?: string;
  participantTurnCount?: number;
};

export type SocialOutcomeResolution = {
  status: SocialOutcomeStatus;
  reasonCode: string;
};

export type SocialOutcomeFailureReason =
  | 'social_outcome_binding_invalid'
  | 'social_outcome_scope_active'
  | 'social_outcome_cooldown_active'
  | 'social_outcome_not_pending'
  | 'social_outcome_terminal_mismatch'
  | 'social_outcome_terminal_conflict'
  | 'social_outcome_terminal_unsatisfied'
  | 'social_outcome_knowledge_unproven';

export function prepareSocialOutcomeBinding(input: {
  actorId: string;
  targetActorIds: string[];
  actionType: string;
  warrant: unknown;
  candidate: unknown;
  warrantDigest: unknown;
  candidateDigest: unknown;
  warrantCandidateDigest: unknown;
}): { ok: true; binding: SocialOutcomeBinding } | { ok: false; reasonCode: SocialOutcomeFailureReason } {
  const warrant = validateSocialWarrant(input.warrant);
  if (!warrant.ok) return invalidBinding();
  const candidate = validateSocialOpportunityCandidate(input.candidate, warrant.warrant);
  if (!candidate.ok) return invalidBinding();
  const normalizedTargets = canonicalStrings(input.targetActorIds);
  if (
    input.actorId !== warrant.warrant.actorId ||
    !sameStrings(normalizedTargets, candidate.candidate.targetActorIds) ||
    input.warrantDigest !== socialWarrantDigest(warrant.warrant) ||
    input.candidateDigest !== socialOpportunityCandidateDigest(candidate.candidate) ||
    input.warrantCandidateDigest !==
      socialWarrantCandidateDigest(warrant.warrant, candidate.candidate) ||
    actionActivity(input.actionType) !== candidate.candidate.intendedActivity
  ) {
    return invalidBinding();
  }
  const topicRefs = canonicalStrings(warrant.warrant.topicRefs);
  const group = candidate.candidate.mode === 'start_group_conversation';
  const scopeKey = group
    ? `social_outcome_scope:group:${stableObservationDigest({
        sourceRef: warrant.warrant.sourceRef,
        intendedOutcome: warrant.warrant.intendedOutcome,
        topicRefs,
      })}`
    : `social_outcome_scope:direct:${stableObservationDigest({
        actorId: input.actorId,
        targetActorIds: normalizedTargets,
        sourceRef: warrant.warrant.sourceRef,
        intendedOutcome: warrant.warrant.intendedOutcome,
        topicRefs,
      })}`;
  return {
    ok: true,
    binding: {
      contractVersion: SOCIAL_OUTCOME_VERSION,
      outcomeId: `social_outcome:${stableObservationDigest({
        warrantDigest: input.warrantDigest,
        candidateDigest: input.candidateDigest,
      })}`,
      scopeKey,
      actorId: input.actorId,
      targetActorIds: normalizedTargets,
      sourceRef: warrant.warrant.sourceRef,
      sourceRevision: warrant.warrant.sourceRevision,
      intendedOutcome: warrant.warrant.intendedOutcome,
      activity: candidate.candidate.intendedActivity,
      topicRefs,
      audience: warrant.warrant.audience,
      warrantId: warrant.warrant.warrantId,
      warrantDigest: input.warrantDigest,
      candidateId: candidate.candidate.candidateId,
      candidateDigest: input.candidateDigest,
      warrantCandidateDigest: input.warrantCandidateDigest,
    },
  };
}

export function createSocialOutcomeReceipt(input: {
  binding: SocialOutcomeBinding;
  openedByActionId: string;
  openedEventId: string;
  createdGameHour: number;
  conversationId?: string;
  groupConversationId?: string;
}): SocialOutcomeReceipt {
  if (!nonNegative(input.createdGameHour)) throw new Error('social_outcome_game_hour_invalid');
  return {
    ...input.binding,
    revision: 1,
    status: 'pending',
    openedByActionId: input.openedByActionId,
    openedEventId: input.openedEventId,
    conversationId: input.conversationId,
    groupConversationId: input.groupConversationId,
    createdGameHour: Math.floor(input.createdGameHour),
  };
}

export function resolveSocialOutcome(
  binding: Pick<SocialOutcomeBinding, 'actorId' | 'targetActorIds' | 'intendedOutcome'>,
  evidence: SocialOutcomeTerminalEvidence,
): SocialOutcomeResolution {
  const common = commonTerminal(evidence);
  if (common) return common;
  if (isPendingEvidence(evidence)) {
    return { status: 'pending', reasonCode: 'social_outcome_pending' };
  }
  const speech = evidence.speech ?? [];
  const targetSet = new Set(binding.targetActorIds);
  const actorSpeech = speech.filter((entry) => entry.speakerActorId === binding.actorId);
  const targetSpeech = speech.filter((entry) => targetSet.has(entry.speakerActorId));
  const resolvedConversation = evidence.conversationStatus === 'resolved';
  const resolvedGroup = evidence.groupConversationStatus === 'resolved';
  const hasKnowledge = (evidence.knowledgeDeliveryCount ?? 0) > 0;
  switch (binding.intendedOutcome) {
    case 'request_aid':
      if (['gift_accepted', 'trade_completed', 'teaching_granted'].includes(evidence.resultCode)) {
        return resolved('social_outcome_aid_action_completed');
      }
      if (resolvedConversation && actorSpeech.some((entry) => entry.speechAct === 'request')) {
        return resolved('social_outcome_aid_requested');
      }
      return unsatisfied();
    case 'respond_to_request':
      if (['request_completed', 'request_declined'].includes(evidence.resultCode)) {
        return resolved(`social_outcome_${evidence.resultCode}`);
      }
      if (resolvedConversation && targetSpeech.some((entry) => ['respond', 'refuse'].includes(entry.speechAct))) {
        return resolved('social_outcome_request_answered');
      }
      return unsatisfied();
    case 'trade_or_coordinate':
      if (['trade_completed', 'negotiation_settled'].includes(evidence.resultCode)) {
        return resolved('social_outcome_exchange_settled');
      }
      if (['trade_refused', 'negotiation_rejected', 'negotiation_withdrawn'].includes(evidence.resultCode)) {
        return failed('social_outcome_exchange_refused');
      }
      return pendingOrUnsatisfied(evidence);
    case 'ask_or_verify':
      if (evidence.resultCode === 'teaching_granted') return resolved('social_outcome_knowledge_received');
      if (
        resolvedConversation &&
        hasKnowledge &&
        targetSpeech.some((entry) => ['inform', 'clarify'].includes(entry.speechAct))
      ) return resolved('social_outcome_knowledge_verified');
      if (resolvedConversation && targetSpeech.some((entry) => entry.speechAct === 'refuse')) {
        return failed('social_outcome_knowledge_refused');
      }
      return hasKnowledge ? unsatisfied() : knowledgeUnproven();
    case 'teach_or_advise':
      if (evidence.resultCode === 'teaching_granted') return resolved('social_outcome_teaching_completed');
      if (
        resolvedConversation &&
        hasKnowledge &&
        actorSpeech.some((entry) => ['inform', 'clarify'].includes(entry.speechAct))
      ) return resolved('social_outcome_advice_delivered');
      if (evidence.resultCode === 'teaching_refused') return failed('social_outcome_teaching_refused');
      return hasKnowledge ? unsatisfied() : knowledgeUnproven();
    case 'maintain_bond': {
      if (evidence.resultCode === 'gift_accepted') return resolved('social_outcome_bond_gift_completed');
      const speakers = new Set(speech.map((entry) => entry.speakerActorId));
      if (resolvedConversation && speakers.has(binding.actorId) && binding.targetActorIds.every((id) => speakers.has(id))) {
        return resolved('social_outcome_bond_exchange_completed');
      }
      return unsatisfied();
    }
    case 'thank_apologize_or_repair':
      if (evidence.resultCode === 'gift_accepted') return resolved('social_outcome_repair_gift_accepted');
      if (
        resolvedConversation &&
        actorSpeech.some((entry) => ['request', 'inform'].includes(entry.speechAct)) &&
        targetSpeech.some((entry) => entry.speechAct === 'respond')
      ) return resolved('social_outcome_repair_acknowledged');
      if (resolvedConversation && targetSpeech.some((entry) => entry.speechAct === 'refuse')) {
        return failed('social_outcome_repair_refused');
      }
      return unsatisfied();
    case 'mediate_or_negotiate':
      if (['negotiation_settled', 'group_commitment_fulfilled'].includes(evidence.resultCode)) {
        return resolved('social_outcome_mediation_settled');
      }
      if (evidence.groupProposalStatus === 'rejected') {
        return resolved('social_outcome_no_consensus_recorded');
      }
      if (['negotiation_rejected', 'group_commitment_breached'].includes(evidence.resultCode)) {
        return failed('social_outcome_mediation_failed');
      }
      return pendingOrUnsatisfied(evidence);
    case 'join_shared_activity':
      if (evidence.resultCode === 'group_commitment_fulfilled') {
        return resolved('social_outcome_shared_commitment_completed');
      }
      if (resolvedGroup && (evidence.participantTurnCount ?? 0) > 0) {
        return resolved('social_outcome_shared_activity_completed');
      }
      return unsatisfied();
    case 'reach_group_decision':
      if (evidence.resultCode === 'group_commitment_fulfilled') {
        return resolved('social_outcome_group_commitment_fulfilled');
      }
      if (evidence.groupProposalStatus === 'rejected') {
        return resolved('social_outcome_group_proposal_rejected');
      }
      if (evidence.resultCode === 'group_commitment_breached') {
        return failed('social_outcome_group_commitment_breached');
      }
      return pendingOrUnsatisfied(evidence);
  }
}

export function transitionSocialOutcomeReceipt(input: {
  receipt: SocialOutcomeReceipt;
  evidence: SocialOutcomeTerminalEvidence;
  terminalActionId: string;
  terminalEventId: string;
  terminalGameHour: number;
}):
  | { ok: true; replay: boolean; receipt: SocialOutcomeReceipt }
  | { ok: false; reasonCode: SocialOutcomeFailureReason } {
  const { receipt } = input;
  if (receipt.status !== 'pending') {
    if (
      receipt.terminalActionId === input.terminalActionId &&
      receipt.terminalEventId === input.terminalEventId &&
      receipt.terminalResultCode === input.evidence.resultCode
    ) return { ok: true, replay: true, receipt };
    return { ok: false, reasonCode: 'social_outcome_terminal_conflict' };
  }
  if (!nonNegative(input.terminalGameHour)) {
    return { ok: false, reasonCode: 'social_outcome_terminal_mismatch' };
  }
  const resolution = resolveSocialOutcome(receipt, input.evidence);
  if (resolution.status === 'pending') {
    return { ok: false, reasonCode: 'social_outcome_terminal_unsatisfied' };
  }
  return {
    ok: true,
    replay: false,
    receipt: {
      ...receipt,
      revision: receipt.revision + 1,
      status: resolution.status,
      terminalActionId: input.terminalActionId,
      terminalEventId: input.terminalEventId,
      terminalResultCode: input.evidence.resultCode,
      terminalReasonCode: resolution.reasonCode,
      cooldownUntilGameHour:
        Math.floor(input.terminalGameHour) + socialOutcomeCooldownHours(resolution.status),
      terminalGameHour: Math.floor(input.terminalGameHour),
    },
  };
}

export function socialOutcomeCooldownHours(status: Exclude<SocialOutcomeStatus, 'pending'>) {
  if (status === 'resolved') return 7 * 24;
  if (status === 'failed') return 24;
  return 6;
}

export function socialOutcomeScopeBlocked(
  receipt: Pick<SocialOutcomeReceipt, 'status' | 'cooldownUntilGameHour'>,
  nowGameHour: number,
) {
  return receipt.status === 'pending' || (receipt.cooldownUntilGameHour ?? 0) > nowGameHour;
}

function actionActivity(actionType: string): SocialOpportunityActivity | undefined {
  if (actionType === 'talk' || actionType === 'gift' || actionType === 'trade' || actionType === 'negotiate') {
    return actionType;
  }
  if (actionType === 'request_teaching') return 'teach';
  if (actionType === 'group_talk' || actionType === 'group_decide') return 'group_decide';
  return undefined;
}

function commonTerminal(evidence: SocialOutcomeTerminalEvidence): SocialOutcomeResolution | undefined {
  if (evidence.conversationStatus === 'expired' || evidence.groupConversationStatus === 'expired' || /expired/u.test(evidence.resultCode)) {
    return { status: 'expired', reasonCode: 'social_outcome_expired' };
  }
  if (evidence.conversationStatus === 'cancelled' || evidence.groupConversationStatus === 'cancelled' || /cancelled/u.test(evidence.resultCode)) {
    return { status: 'cancelled', reasonCode: 'social_outcome_cancelled' };
  }
  return undefined;
}

function pendingOrUnsatisfied(evidence: SocialOutcomeTerminalEvidence): SocialOutcomeResolution {
  if (isPendingEvidence(evidence)) {
    return { status: 'pending', reasonCode: 'social_outcome_pending' };
  }
  return unsatisfied();
}

function isPendingEvidence(evidence: SocialOutcomeTerminalEvidence) {
  return [
    'conversation_started',
    'group_conversation_started',
    'group_proposal_opened',
    'group_proposal_committed',
    'negotiation_opened',
    'negotiation_countered',
  ].includes(evidence.resultCode) ||
    (evidence.resultCode === 'group_vote_recorded' &&
      evidence.groupProposalStatus !== 'rejected') ||
    evidence.conversationStatus === 'active' ||
    evidence.groupConversationStatus === 'active' ||
    evidence.commitmentStatus === 'pending';
}

function resolved(reasonCode: string): SocialOutcomeResolution {
  return { status: 'resolved', reasonCode };
}

function failed(reasonCode: string): SocialOutcomeResolution {
  return { status: 'failed', reasonCode };
}

function unsatisfied(): SocialOutcomeResolution {
  return { status: 'failed', reasonCode: 'social_outcome_terminal_unsatisfied' };
}

function knowledgeUnproven(): SocialOutcomeResolution {
  return { status: 'failed', reasonCode: 'social_outcome_knowledge_unproven' };
}

function invalidBinding() {
  return { ok: false as const, reasonCode: 'social_outcome_binding_invalid' as const };
}

function canonicalStrings(values: string[]) {
  return [...new Set(values)].sort();
}

function sameStrings(left: string[], right: string[]) {
  const normalizedRight = canonicalStrings(right);
  return left.length === normalizedRight.length && left.every((value, index) => value === normalizedRight[index]);
}

function nonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}
