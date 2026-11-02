import type { AgentContext } from './agentLogic';
import type { GroupSocialCoordinationCandidate } from './groupSocialCoordinationLogic';
import type { SocialInvitationCoordinationCandidate } from './socialInvitationCoordinationLogic';
import { stableObservationDigest } from './lifeObservation';

export const UNIFIED_LIFE_SOCIAL_CANDIDATE_VERSION =
  'taixu.unified-life-social-candidate.v1' as const;
export const UNIFIED_LIFE_SOCIAL_CANDIDATE_LIMIT = 12 as const;

type Candidate = NonNullable<AgentContext['purposeBoundLifeCandidateBundle']>['candidates'][number];

export type UnifiedLifeSocialCandidateBundle = {
  contractVersion: typeof UNIFIED_LIFE_SOCIAL_CANDIDATE_VERSION;
  purposeFactsDigest: string;
  candidateSetDigest: string;
  candidates: Candidate[];
};

/**
 * Creates the sole host-side candidate surface consumed by Pi. All inputs have
 * already been validated by their source-specific builders; this function only
 * establishes deterministic composition, boundedness and duplicate fences.
 */
export function buildUnifiedLifeSocialCandidateBundle(input: {
  purposeFactsDigest: string;
  purposeCandidates: readonly Candidate[];
  invitationCandidates: readonly SocialInvitationCoordinationCandidate[];
  groupCandidates: readonly GroupSocialCoordinationCandidate[];
}): UnifiedLifeSocialCandidateBundle {
  const entries = [
    ...input.purposeCandidates.map((candidate) => ({ candidate, source: 'purpose' as const })),
    ...input.invitationCandidates.map((candidate) => ({
      candidate: coordinationCandidate(candidate),
      source: 'invitation' as const,
    })),
    ...input.groupCandidates.map((candidate) => ({
      candidate: coordinationCandidate(candidate),
      source: 'group' as const,
    })),
  ];
  const unique = dedupe(entries)
    .sort(compareEntries);
  const bounded = reserveRoutineSocial(unique);
  const candidateSetDigest = stableObservationDigest(
    bounded.map((entry) => candidateIdentity(entry.candidate)),
  );
  return {
    contractVersion: UNIFIED_LIFE_SOCIAL_CANDIDATE_VERSION,
    purposeFactsDigest: stableObservationDigest({
      version: UNIFIED_LIFE_SOCIAL_CANDIDATE_VERSION,
      purposeFactsDigest: input.purposeFactsDigest,
      candidates: bounded.map((entry) => candidateIdentity(entry.candidate)),
    }),
    candidateSetDigest,
    candidates: bounded.map((entry) => entry.candidate),
  };
}

function coordinationCandidate(
  candidate: SocialInvitationCoordinationCandidate | GroupSocialCoordinationCandidate,
): Candidate {
  return {
    planner: candidate.planner,
    candidateId: candidate.candidateId,
    legacyOrder: candidate.legacyOrder,
    proposal: candidate.proposal,
  };
}

type Entry = {
  candidate: Candidate;
  source: 'purpose' | 'invitation' | 'group';
};

function dedupe(entries: Entry[]) {
  const byCandidateId = new Map<string, Entry>();
  const byProposal = new Map<string, Entry>();
  for (const entry of entries) {
    const identity = candidateIdentity(entry.candidate);
    const existing = byCandidateId.get(entry.candidate.candidateId);
    if (existing && stableObservationDigest(candidateIdentity(existing.candidate)) !== stableObservationDigest(identity)) {
      throw new Error('unified_life_social_candidate_id_collision');
    }
    if (existing) continue;
    const proposalKey = stableObservationDigest(entry.candidate.proposal);
    const sameProposal = byProposal.get(proposalKey);
    if (sameProposal) continue;
    byCandidateId.set(entry.candidate.candidateId, entry);
    byProposal.set(proposalKey, entry);
  }
  return [...byCandidateId.values()];
}

function reserveRoutineSocial(entries: Entry[]) {
  const initiallyBounded = entries.slice(0, UNIFIED_LIFE_SOCIAL_CANDIDATE_LIMIT);
  if (initiallyBounded.some((entry) => isRoutineSocial(entry))) return initiallyBounded;
  const social = entries.find(isRoutineSocial);
  if (!social) return initiallyBounded;
  const replacementIndex = [...initiallyBounded]
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => priority(entry) >= priority(social))
    .sort((left, right) =>
      priority(right.entry) - priority(left.entry) ||
      right.entry.candidate.candidateId.localeCompare(left.entry.candidate.candidateId),
    )[0]?.index;
  if (replacementIndex === undefined) return initiallyBounded;
  return initiallyBounded
    .map((entry, index) => (index === replacementIndex ? social : entry))
    .sort(compareEntries);
}

function compareEntries(left: Entry, right: Entry) {
  return (
    priority(left) - priority(right) ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId)
  );
}

function priority(entry: Entry) {
  if (entry.source === 'invitation') return 100;
  if (entry.source === 'group') return 150;
  return entry.candidate.legacyOrder;
}

function isRoutineSocial(entry: Entry) {
  if (entry.source === 'invitation' || entry.source === 'group') return false;
  const type = entry.candidate.proposal.type;
  return (
    entry.candidate.planner === 'social_warrant' &&
    (type === 'talk' || type === 'gift' || type === 'request_teaching') &&
    entry.candidate.legacyOrder >= 500
  );
}

function candidateIdentity(candidate: Candidate) {
  return {
    candidateId: candidate.candidateId,
    planner: candidate.planner,
    legacyOrder: candidate.legacyOrder,
    proposal: candidate.proposal,
    personalGoalCandidate: candidate.personalGoalCandidate,
    socialConsequenceProjection: candidate.socialConsequenceProjection,
  };
}
