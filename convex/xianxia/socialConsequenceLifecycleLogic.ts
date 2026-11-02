import { stableObservationDigest } from './lifeObservation';
import type { SocialConsequenceStatus } from './socialConsequenceContracts';

export const SOCIAL_CONSEQUENCE_LIFECYCLE_VERSION =
  'taixu.social-consequence-lifecycle.v1' as const;
export const MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK = 32;
export const SOCIAL_CONSEQUENCE_EXPIRED_REASON = 'social_consequence_expired' as const;

export type SocialConsequenceLifecycleFact = {
  consequenceId: string;
  revision: number;
  status: SocialConsequenceStatus;
  remainingProjectionBudget: number;
  expiresGameHour: number;
  terminalGameHour?: number;
  terminalReasonCode?: string;
};

export type SocialConsequenceExpiryTransition = {
  consequenceId: string;
  previousRevision: number;
  revision: number;
  previousProjectionBudget: number;
  remainingProjectionBudget: 0;
  status: 'expired';
  terminalGameHour: number;
  terminalReasonCode: typeof SOCIAL_CONSEQUENCE_EXPIRED_REASON;
};

export type SocialConsequenceLifecyclePlan = {
  contractVersion: typeof SOCIAL_CONSEQUENCE_LIFECYCLE_VERSION;
  gameHour: number;
  transitions: SocialConsequenceExpiryTransition[];
  remainingDue: number;
  caughtUp: boolean;
  transitionDigest: string;
};

/**
 * Plans the bounded, deterministic invalidation of active consequence owners.
 * The caller persists the patch in one transaction; this function never
 * invents fulfilled/cancelled/superseded semantics from elapsed time.
 */
export function planSocialConsequenceLifecycle(input: {
  gameHour: number;
  consequences: readonly SocialConsequenceLifecycleFact[];
  limit?: number;
}): SocialConsequenceLifecyclePlan {
  const gameHour = assertGameHour(input.gameHour);
  const limit = input.limit ?? MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SOCIAL_CONSEQUENCE_EXPIRATIONS_PER_TICK) {
    throw new Error('social_consequence_lifecycle_invalid_limit');
  }
  const canonical = [...input.consequences]
    .map(validateLifecycleFact)
    .sort((left, right) =>
      left.expiresGameHour - right.expiresGameHour ||
      left.consequenceId.localeCompare(right.consequenceId));
  const seen = new Set<string>();
  for (const row of canonical) {
    if (seen.has(row.consequenceId)) {
      throw new Error('social_consequence_lifecycle_invalid_row');
    }
    seen.add(row.consequenceId);
  }
  const due = canonical.filter((row) =>
    row.status === 'active' && gameHour >= row.expiresGameHour);
  const transitions = due.slice(0, limit).map((row): SocialConsequenceExpiryTransition => ({
    consequenceId: row.consequenceId,
    previousRevision: row.revision,
    revision: row.revision + 1,
    previousProjectionBudget: row.remainingProjectionBudget,
    remainingProjectionBudget: 0,
    status: 'expired',
    terminalGameHour: row.expiresGameHour,
    terminalReasonCode: SOCIAL_CONSEQUENCE_EXPIRED_REASON,
  }));
  const remainingDue = Math.max(0, due.length - transitions.length);
  return {
    contractVersion: SOCIAL_CONSEQUENCE_LIFECYCLE_VERSION,
    gameHour,
    transitions,
    remainingDue,
    caughtUp: remainingDue === 0,
    transitionDigest: stableObservationDigest({
      contractVersion: SOCIAL_CONSEQUENCE_LIFECYCLE_VERSION,
      gameHour,
      transitions,
      remainingDue,
    }),
  };
}

function validateLifecycleFact(
  row: SocialConsequenceLifecycleFact,
): SocialConsequenceLifecycleFact {
  if (
    typeof row.consequenceId !== 'string' || row.consequenceId.length === 0 ||
    !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    !Number.isSafeInteger(row.remainingProjectionBudget) || row.remainingProjectionBudget < 0 ||
    !Number.isSafeInteger(row.expiresGameHour) || row.expiresGameHour < 0
  ) throw new Error('social_consequence_lifecycle_invalid_row');
  const hasTerminalGameHour = row.terminalGameHour !== undefined;
  const hasTerminalReason = row.terminalReasonCode !== undefined;
  if (hasTerminalGameHour !== hasTerminalReason) {
    throw new Error('social_consequence_lifecycle_terminal_metadata_conflict');
  }
  if (row.status === 'active' && hasTerminalGameHour) {
    throw new Error('social_consequence_lifecycle_terminal_metadata_conflict');
  }
  if (row.status === 'expired') {
    if (
      row.terminalGameHour !== row.expiresGameHour ||
      row.terminalReasonCode !== SOCIAL_CONSEQUENCE_EXPIRED_REASON
    ) throw new Error('social_consequence_lifecycle_terminal_metadata_conflict');
  }
  return { ...row };
}

function assertGameHour(gameHour: number) {
  if (!Number.isSafeInteger(gameHour) || gameHour < 0) {
    throw new Error('social_consequence_lifecycle_invalid_now');
  }
  return gameHour;
}
