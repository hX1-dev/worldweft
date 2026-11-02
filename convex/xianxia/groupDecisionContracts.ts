import { type Infer, v } from 'convex/values';

export const groupProposalStatusValidator = v.union(
  v.literal('open'),
  v.literal('committed'),
  v.literal('rejected'),
  v.literal('expired'),
  v.literal('invalidated'),
);
export type GroupProposalStatus = Infer<typeof groupProposalStatusValidator>;

export const groupVoteChoiceValidator = v.union(
  v.literal('approve'),
  v.literal('oppose'),
  v.literal('abstain'),
);
export type GroupVoteChoice = Infer<typeof groupVoteChoiceValidator>;

export const groupCommitmentStatusValidator = v.union(
  v.literal('pending'),
  v.literal('fulfilled'),
  v.literal('breached'),
  v.literal('invalidated'),
);
export type GroupCommitmentStatus = Infer<typeof groupCommitmentStatusValidator>;
