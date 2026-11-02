import { stableObservationDigest } from './lifeObservation';
import type { LifeRhythmCadence } from './lifeRhythmWindowLogic';

export const LIFE_SOCIAL_REVIEW_VERSION = 'taixu.life-social-review.v1' as const;
export const MAX_LIFE_SOCIAL_REVIEW_SOURCES = 8;
export const MAX_LIFE_SOCIAL_REVIEWS_PER_TICK = 16;
export const MAX_LIFE_SOCIAL_REVIEW_ACTORS = 32;

export const LIFE_SOCIAL_REVIEW_SOURCE_KINDS = [
  'personal_goal_open',
  'personal_goal_terminal',
  'action_terminal',
  'group_duty_open',
  'group_duty_terminal',
  'social_session_terminal',
  'group_session_terminal',
  'social_consequence_open',
  'social_consequence_terminal',
] as const;

export type LifeSocialReviewSourceKind = (typeof LIFE_SOCIAL_REVIEW_SOURCE_KINDS)[number];
export type LifeSocialReviewVisibility = 'actor_private' | 'participants';

export type LifeSocialReviewSource = {
  kind: LifeSocialReviewSourceKind;
  sourceRef: string;
  sourceRevision: string;
  sourceDigest: string;
  occurredGameHour: number;
  visibility: LifeSocialReviewVisibility;
  subjectActorIds: string[];
};

export type LifeSocialReviewWindow = {
  windowId: string;
  windowDigest: string;
  cadence: LifeRhythmCadence;
  periodIndex: number;
  windowStartGameHour: number;
  windowEndGameHour: number;
};

export type LifeSocialReviewReceipt = {
  contractVersion: typeof LIFE_SOCIAL_REVIEW_VERSION;
  reviewId: string;
  actorId: string;
  windowId: string;
  windowDigest: string;
  cadence: LifeRhythmCadence;
  periodIndex: number;
  windowStartGameHour: number;
  windowEndGameHour: number;
  status: 'quiet' | 'factual';
  sourceRefs: LifeSocialReviewSource[];
  sourceSetDigest: string;
  sourcesTruncated: boolean;
  providerCalls: 0;
  createdWorldActions: 0;
  createdSocialCandidates: 0;
  createdRelationshipChanges: 0;
  createdMemories: 0;
  reviewDigest: string;
};

const DAILY_KINDS = new Set<LifeSocialReviewSourceKind>([
  'personal_goal_open',
  'personal_goal_terminal',
  'action_terminal',
  'group_duty_open',
  'group_duty_terminal',
]);

const WEEKLY_KINDS = new Set<LifeSocialReviewSourceKind>([
  'social_session_terminal',
  'group_session_terminal',
  'group_duty_open',
  'group_duty_terminal',
  'social_consequence_open',
  'social_consequence_terminal',
]);

const OPEN_KINDS = new Set<LifeSocialReviewSourceKind>([
  'personal_goal_open',
  'group_duty_open',
  'social_consequence_open',
]);

/**
 * Builds one immutable actor/window review. It performs no world writes and
 * treats every source as a reference to an existing fact owner, never as an
 * action permission or a natural-language memory.
 */
export function buildLifeSocialReview(input: {
  actorId: string;
  actorCreatedGameHour: number;
  actorDeceasedGameHour?: number;
  window: LifeSocialReviewWindow;
  sources: readonly LifeSocialReviewSource[];
  scanTruncated?: boolean;
}): LifeSocialReviewReceipt {
  const actorId = nonEmpty(input.actorId, 'life_social_review_actor_ineligible');
  const window = validateWindow(input.window);
  const actorCreatedGameHour = nonNegativeInteger(
    input.actorCreatedGameHour,
    'life_social_review_actor_ineligible',
  );
  const actorDeceasedGameHour = input.actorDeceasedGameHour === undefined
    ? undefined
    : nonNegativeInteger(input.actorDeceasedGameHour, 'life_social_review_actor_ineligible');
  if (
    actorCreatedGameHour >= window.windowEndGameHour ||
    (actorDeceasedGameHour !== undefined && actorDeceasedGameHour < window.windowEndGameHour)
  ) {
    throw new Error('life_social_review_actor_ineligible');
  }

  const byRef = new Map<string, LifeSocialReviewSource>();
  for (const raw of input.sources) {
    const source = normalizeSource(raw);
    if (!sourceAllowedForCadence(source.kind, window.cadence)) continue;
    if (!source.subjectActorIds.includes(actorId)) continue;
    if (!sourceOccursInWindow(source, window)) continue;
    const prior = byRef.get(source.sourceRef);
    if (prior && stableObservationDigest(prior) !== stableObservationDigest(source)) {
      throw new Error('life_social_review_source_conflict');
    }
    if (!prior) byRef.set(source.sourceRef, source);
  }
  const eligible = [...byRef.values()].sort((left, right) =>
    sourcePriority(window.cadence, left.kind) - sourcePriority(window.cadence, right.kind) ||
    right.occurredGameHour - left.occurredGameHour ||
    left.sourceRef.localeCompare(right.sourceRef));
  const sourceRefs = eligible.slice(0, MAX_LIFE_SOCIAL_REVIEW_SOURCES);
  const sourcesTruncated = Boolean(input.scanTruncated) ||
    eligible.length > MAX_LIFE_SOCIAL_REVIEW_SOURCES;
  const sourceSetDigest = stableObservationDigest(sourceRefs);
  const semantic = {
    contractVersion: LIFE_SOCIAL_REVIEW_VERSION,
    reviewId: `life-social-review:${window.windowId}:${actorId}`,
    actorId,
    windowId: window.windowId,
    windowDigest: window.windowDigest,
    cadence: window.cadence,
    periodIndex: window.periodIndex,
    windowStartGameHour: window.windowStartGameHour,
    windowEndGameHour: window.windowEndGameHour,
    status: sourceRefs.length === 0 ? 'quiet' as const : 'factual' as const,
    sourceRefs,
    sourceSetDigest,
    sourcesTruncated,
    providerCalls: 0 as const,
    createdWorldActions: 0 as const,
    createdSocialCandidates: 0 as const,
    createdRelationshipChanges: 0 as const,
    createdMemories: 0 as const,
  };
  return { ...semantic, reviewDigest: stableObservationDigest(semantic) };
}

export function sameLifeSocialReview(
  left: LifeSocialReviewReceipt,
  right: LifeSocialReviewReceipt,
) {
  return stableObservationDigest(left) === stableObservationDigest(right);
}

export function isValidLifeSocialReview(receipt: LifeSocialReviewReceipt) {
  const { reviewDigest, ...semantic } = receipt;
  return receipt.sourceSetDigest === stableObservationDigest(receipt.sourceRefs) &&
    reviewDigest === stableObservationDigest(semantic) &&
    receipt.sourceRefs.length <= MAX_LIFE_SOCIAL_REVIEW_SOURCES &&
    receipt.status === (receipt.sourceRefs.length === 0 ? 'quiet' : 'factual') &&
    receipt.providerCalls === 0 && receipt.createdWorldActions === 0 &&
    receipt.createdSocialCandidates === 0 && receipt.createdRelationshipChanges === 0 &&
    receipt.createdMemories === 0;
}

export function sourceAllowedForCadence(
  kind: LifeSocialReviewSourceKind,
  cadence: LifeRhythmCadence,
) {
  return (cadence === 'daily' ? DAILY_KINDS : WEEKLY_KINDS).has(kind);
}

function sourceOccursInWindow(
  source: LifeSocialReviewSource,
  window: LifeSocialReviewWindow,
) {
  if (OPEN_KINDS.has(source.kind)) {
    return source.occurredGameHour < window.windowEndGameHour;
  }
  return source.occurredGameHour >= window.windowStartGameHour &&
    source.occurredGameHour < window.windowEndGameHour;
}

function normalizeSource(source: LifeSocialReviewSource): LifeSocialReviewSource {
  if (!LIFE_SOCIAL_REVIEW_SOURCE_KINDS.includes(source.kind)) {
    throw new Error('life_social_review_source_invalid');
  }
  const subjectActorIds = [...new Set(source.subjectActorIds.map((actorId) =>
    nonEmpty(actorId, 'life_social_review_source_invalid')))].sort();
  if (subjectActorIds.length === 0) throw new Error('life_social_review_source_invalid');
  if (!['actor_private', 'participants'].includes(source.visibility)) {
    throw new Error('life_social_review_source_invalid');
  }
  return {
    kind: source.kind,
    sourceRef: nonEmpty(source.sourceRef, 'life_social_review_source_invalid'),
    sourceRevision: nonEmpty(source.sourceRevision, 'life_social_review_source_invalid'),
    sourceDigest: nonEmpty(source.sourceDigest, 'life_social_review_source_invalid'),
    occurredGameHour: nonNegativeInteger(
      source.occurredGameHour,
      'life_social_review_source_invalid',
    ),
    visibility: source.visibility,
    subjectActorIds,
  };
}

function validateWindow(window: LifeSocialReviewWindow): LifeSocialReviewWindow {
  if (!['daily', 'weekly'].includes(window.cadence)) {
    throw new Error('life_social_review_invalid_window');
  }
  nonEmpty(window.windowId, 'life_social_review_invalid_window');
  nonEmpty(window.windowDigest, 'life_social_review_invalid_window');
  nonNegativeInteger(window.windowStartGameHour, 'life_social_review_invalid_window');
  nonNegativeInteger(window.windowEndGameHour, 'life_social_review_invalid_window');
  if (!Number.isSafeInteger(window.periodIndex) || window.periodIndex < 1 ||
    window.windowEndGameHour <= window.windowStartGameHour) {
    throw new Error('life_social_review_invalid_window');
  }
  return window;
}

function sourcePriority(cadence: LifeRhythmCadence, kind: LifeSocialReviewSourceKind) {
  const order: LifeSocialReviewSourceKind[] = cadence === 'daily'
    ? [
        'group_duty_open', 'personal_goal_open', 'group_duty_terminal',
        'personal_goal_terminal', 'action_terminal',
      ]
    : [
        'group_duty_open', 'group_duty_terminal', 'social_consequence_open',
        'social_consequence_terminal', 'group_session_terminal', 'social_session_terminal',
      ];
  const index = order.indexOf(kind);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function nonNegativeInteger(value: number, reasonCode: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(reasonCode);
  return value;
}

function nonEmpty(value: string, reasonCode: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(reasonCode);
  return value;
}
