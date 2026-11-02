import { type Infer, v } from 'convex/values';

export const socialModelCallStatusValidator = v.union(
  v.literal('reserved'),
  v.literal('calling'),
  v.literal('succeeded'),
  v.literal('invalid_output'),
  v.literal('failed'),
  v.literal('timed_out'),
  v.literal('cancelled'),
  v.literal('blocked'),
  v.literal('lease_expired'),
);
export type SocialModelCallStatus = Infer<typeof socialModelCallStatusValidator>;

export const SOCIAL_MODEL_ACTIVE_STATUSES = ['reserved', 'calling'] as const;
export const SOCIAL_MODEL_FAILURE_STATUSES = [
  'invalid_output',
  'failed',
  'timed_out',
] as const;

