import { stableObservationDigest } from './lifeObservation';

export const SOCIAL_CONSEQUENCE_PROJECTION_VERSION =
  'taixu.social-consequence-projection.v1' as const;

export type SocialConsequenceProjectionV1 = {
  contractVersion: typeof SOCIAL_CONSEQUENCE_PROJECTION_VERSION;
  consequenceId: string;
  consequenceRevision: number;
  sourceOutcomeId: string;
  sourceOutcomeRevision: number;
  sourceEventId: string;
  sourceRevision: string;
  kind: 'gratitude_due' | 'grievance_created';
  projectionDigest: string;
};

export function socialConsequenceProjectionSourceRef(consequenceId: string) {
  return `consequence:${consequenceId}`;
}

export function socialConsequenceProjectionSourceRevision(input: {
  consequenceId: string;
  consequenceRevision: number;
  sourceOutcomeId: string;
  sourceOutcomeRevision: number;
  sourceRevision: string;
  status: string;
  remainingProjectionBudget: number;
  dueGameHour?: number;
  expiresGameHour: number;
}) {
  return `consequence_revision:${stableObservationDigest({
    contractVersion: SOCIAL_CONSEQUENCE_PROJECTION_VERSION,
    ...input,
  })}`;
}

export function socialConsequenceProjectionIdentity(input: {
  consequenceId: string;
  consequenceRevision: number;
  sourceOutcomeId: string;
  sourceOutcomeRevision: number;
  sourceEventId: string;
  sourceRevision: string;
  kind: SocialConsequenceProjectionV1['kind'];
}): SocialConsequenceProjectionV1 {
  return {
    contractVersion: SOCIAL_CONSEQUENCE_PROJECTION_VERSION,
    ...input,
    projectionDigest: stableObservationDigest({
      contractVersion: SOCIAL_CONSEQUENCE_PROJECTION_VERSION,
      ...input,
    }),
  };
}

export function validateSocialConsequenceProjection(
  value: unknown,
): value is SocialConsequenceProjectionV1 {
  if (!plainObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    'consequenceId',
    'consequenceRevision',
    'contractVersion',
    'kind',
    'projectionDigest',
    'sourceEventId',
    'sourceOutcomeId',
    'sourceOutcomeRevision',
    'sourceRevision',
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return false;
  }
  if (
    value.contractVersion !== SOCIAL_CONSEQUENCE_PROJECTION_VERSION ||
    !['gratitude_due', 'grievance_created'].includes(String(value.kind)) ||
    !nonempty(value.consequenceId) ||
    !positiveInteger(value.consequenceRevision) ||
    !nonempty(value.sourceOutcomeId) ||
    !positiveInteger(value.sourceOutcomeRevision) ||
    !nonempty(value.sourceEventId) ||
    !nonempty(value.sourceRevision) ||
    !nonempty(value.projectionDigest)
  ) return false;
  const kind = value.kind as SocialConsequenceProjectionV1['kind'];
  const expectedIdentity = socialConsequenceProjectionIdentity({
    consequenceId: value.consequenceId,
    consequenceRevision: value.consequenceRevision,
    sourceOutcomeId: value.sourceOutcomeId,
    sourceOutcomeRevision: value.sourceOutcomeRevision,
    sourceEventId: value.sourceEventId,
    sourceRevision: value.sourceRevision,
    kind,
  });
  return expectedIdentity.projectionDigest === value.projectionDigest;
}

export function socialConsequenceProjectionFromProposalParams(
  params: Record<string, unknown> | undefined,
) {
  if (!params) return undefined;
  const consequenceId = params.socialConsequenceId;
  const sourceOutcomeId = params.socialConsequenceSourceOutcomeId;
  const projectionDigest = params.socialConsequenceProjectionDigest;
  if (
    typeof consequenceId !== 'string' ||
    typeof sourceOutcomeId !== 'string' ||
    typeof projectionDigest !== 'string'
  ) return undefined;
  return { consequenceId, sourceOutcomeId, projectionDigest };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}
