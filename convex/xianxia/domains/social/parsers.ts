import type { GroupVoteChoice } from '../../groupDecisionContracts';

export function parseSocialInvitationActivity(value: unknown) {
  return value === 'talk' ||
    value === 'gift' ||
    value === 'trade' ||
    value === 'teach' ||
    value === 'negotiate'
    ? value
    : undefined;
}

export function parseGroupVoteChoice(value: unknown): GroupVoteChoice | undefined {
  return value === 'approve' || value === 'oppose' || value === 'abstain'
    ? value
    : undefined;
}
