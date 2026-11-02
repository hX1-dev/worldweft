import type { GroupVoteChoice } from './groupDecisionContracts';

export const GROUP_PROPOSAL_KIND = 'owned_herb_allocation' as const;
export const GROUP_PROPOSAL_ITEM_ID = 'spirit_herb' as const;
export const GROUP_PROPOSAL_ITEM_QTY = 1 as const;
export const GROUP_PROPOSAL_TTL_MS = 5 * 60 * 1000;
export const GROUP_PROPOSAL_MAX_PER_SESSION = 3;

export type GroupDecisionFailure = { ok: false; reasonCode: string; reason: string };
export type GroupVoteDecisionBasis =
  | 'donor_interest'
  | 'recipient_interest'
  | 'supports_recipient'
  | 'distrusts_recipient'
  | 'neutral_to_recipient';

export function majorityQuorum(participantCount: number): number {
  if (!Number.isInteger(participantCount) || participantCount < 3 || participantCount > 5) {
    throw new Error('group_decision_invariant: participant count must be 3..5');
  }
  return Math.floor(participantCount / 2) + 1;
}

export function validateOwnedHerbProposal(input: {
  actorId: string;
  recipientActorId: string;
  participantActorIds: string[];
  observerActorIds: string[];
  availableHerbs: number;
}): { ok: true; quorum: number; participantActorIds: string[] } | GroupDecisionFailure {
  const participants = [...new Set(input.participantActorIds)].sort((a, b) => a.localeCompare(b));
  if (
    participants.length !== input.participantActorIds.length ||
    participants.length < 3 ||
    participants.length > 5 ||
    !participants.includes(input.actorId) ||
    input.observerActorIds.includes(input.actorId)
  ) {
    return failure('group_proposal_actor_ineligible', '只有该会话的发言参与者可以提出分配。');
  }
  if (
    input.recipientActorId === input.actorId ||
    !participants.includes(input.recipientActorId) ||
    input.observerActorIds.includes(input.recipientActorId)
  ) {
    return failure('group_proposal_recipient_invalid', '受赠者必须是另一名发言参与者。');
  }
  if (!Number.isInteger(input.availableHerbs) || input.availableHerbs < 1) {
    return failure('group_proposal_resource_unavailable', '提案者没有可用于分配的灵草。');
  }
  return { ok: true, quorum: majorityQuorum(participants.length), participantActorIds: participants };
}

export function resolveGroupVote(input: {
  participantActorIds: string[];
  voterActorId: string;
  choice: GroupVoteChoice;
  priorVotes: Array<{ actorId: string; choice: GroupVoteChoice }>;
}):
  | { ok: true; approvals: number; oppositions: number; abstentions: number; remaining: number; outcome: 'open' | 'committed' | 'rejected' }
  | GroupDecisionFailure {
  if (!input.participantActorIds.includes(input.voterActorId)) {
    return failure('group_proposal_actor_ineligible', '只有提案快照中的参与者可以投票。');
  }
  if (!['approve', 'oppose', 'abstain'].includes(input.choice)) {
    return failure('group_vote_invalid', '表决只能赞成、反对或弃权。');
  }
  if (input.priorVotes.some((vote) => vote.actorId === input.voterActorId)) {
    return failure('group_vote_duplicate', '每名参与者只能投票一次。');
  }
  const votes = [...input.priorVotes, { actorId: input.voterActorId, choice: input.choice }];
  const approvals = votes.filter((vote) => vote.choice === 'approve').length;
  const oppositions = votes.filter((vote) => vote.choice === 'oppose').length;
  const abstentions = votes.filter((vote) => vote.choice === 'abstain').length;
  const remaining = input.participantActorIds.length - votes.length;
  const quorum = majorityQuorum(input.participantActorIds.length);
  const outcome = approvals >= quorum
    ? 'committed'
    : approvals + remaining < quorum
      ? 'rejected'
      : 'open';
  return { ok: true, approvals, oppositions, abstentions, remaining, outcome };
}

export function chooseRelationshipVote(input: {
  actorId: string;
  donorActorId: string;
  recipientActorId: string;
  relationshipToRecipient?: number;
  trustToRecipient?: number;
  suspicionToRecipient?: number;
  debtToRecipient?: number;
}): { choice: GroupVoteChoice; basis: GroupVoteDecisionBasis; relationshipBand: 'self' | 'supportive' | 'neutral' | 'distrustful' } {
  if (input.actorId === input.donorActorId) {
    return { choice: 'approve', basis: 'donor_interest', relationshipBand: 'self' };
  }
  if (input.actorId === input.recipientActorId) {
    return { choice: 'approve', basis: 'recipient_interest', relationshipBand: 'self' };
  }
  const relationship = input.relationshipToRecipient ?? 0;
  const trust = input.trustToRecipient ?? 0;
  const suspicion = input.suspicionToRecipient ?? 0;
  const debt = input.debtToRecipient ?? 0;
  if (relationship <= -15 || suspicion >= 20) {
    return { choice: 'oppose', basis: 'distrusts_recipient', relationshipBand: 'distrustful' };
  }
  if (relationship >= 15 || (trust >= 5 && debt >= 5)) {
    return { choice: 'approve', basis: 'supports_recipient', relationshipBand: 'supportive' };
  }
  return { choice: 'abstain', basis: 'neutral_to_recipient', relationshipBand: 'neutral' };
}

export function chooseUntriedRecipient(input: {
  donorActorId: string;
  participantActorIds: string[];
  attemptedRecipientActorIds: string[];
}): string | undefined {
  const attempted = new Set(input.attemptedRecipientActorIds);
  return [...new Set(input.participantActorIds)]
    .sort((a, b) => a.localeCompare(b))
    .find((actorId) => actorId !== input.donorActorId && !attempted.has(actorId));
}

function failure(reasonCode: string, reason: string): GroupDecisionFailure {
  return { ok: false, reasonCode, reason };
}
