import { stableDigest } from './personaPolicyLogic';

export const TAIXU_EVIDENCE_MEMORY_VERSION = 'taixu.evidence-memory.v1' as const;
export const TAIXU_CONTEXT_COMPILER_VERSION = 'taixu.context-compiler.v1' as const;
export const TAIXU_CONTEXT_MAX_CARDS = 8;
export const TAIXU_CONTEXT_MAX_BYTES = 4096;
export const TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS = 240;

export type TaixuEvidenceFailureCode =
  | 'evidence_schema_invalid'
  | 'evidence_actor_mismatch'
  | 'evidence_source_missing'
  | 'evidence_visibility_denied'
  | 'evidence_time_invalid'
  | 'evidence_digest_mismatch'
  | 'evidence_supersede_invalid'
  | 'context_query_invalid'
  | 'context_budget_exceeded';

export type TaixuEvidenceSourceKind =
  | 'direct_observation'
  | 'world_fact'
  | 'conversation'
  | 'relationship_event'
  | 'rumor';

export type TaixuEvidencePolarity = 'supported' | 'contradicted' | 'unknown';
export type TaixuEvidenceVisibility = 'public' | 'actor_private' | 'secret';

export type TaixuEvidenceCardV1 = {
  contractVersion: typeof TAIXU_EVIDENCE_MEMORY_VERSION;
  actorId: string;
  source: {
    kind: TaixuEvidenceSourceKind;
    id: string;
    revision: number;
    supersedesRevision?: number;
  };
  visibility: TaixuEvidenceVisibility;
  observedAtSemanticTime: number;
  subject: string;
  topic: string;
  polarity: TaixuEvidencePolarity;
  reliability: number;
  importance: number;
  summary: string;
  digest: string;
};

export type CreateTaixuEvidenceCardInput = Omit<
  TaixuEvidenceCardV1,
  'contractVersion' | 'digest'
>;

export type TaixuContextQueryV1 = {
  actorId: string;
  semanticTime: number;
  topics: string[];
  subject?: string;
  maxCards?: number;
};

export type TaixuContextExclusionReason =
  | TaixuEvidenceFailureCode
  | 'evidence_topic_mismatch'
  | 'evidence_duplicate_revision'
  | 'evidence_superseded'
  | 'context_card_limit';

export type TaixuCompiledEvidenceV1 = {
  contractVersion: typeof TAIXU_CONTEXT_COMPILER_VERSION;
  actorId: string;
  queryDigest: string;
  included: Array<{
    card: TaixuEvidenceCardV1;
    reason: {
      relevance: number;
      recency: number;
      reliability: number;
      importance: number;
      tieBreakDigest: string;
    };
  }>;
  excluded: Array<{
    sourceRef: string;
    reason: TaixuContextExclusionReason;
  }>;
  buckets: Record<TaixuEvidencePolarity, string[]>;
  evidenceSection: string;
  byteLength: number;
  digest: string;
};

export class TaixuEvidenceContextError extends Error {
  constructor(readonly code: TaixuEvidenceFailureCode) {
    super(code);
    this.name = 'TaixuEvidenceContextError';
  }
}

const CARD_KEYS = [
  'contractVersion',
  'actorId',
  'source',
  'visibility',
  'observedAtSemanticTime',
  'subject',
  'topic',
  'polarity',
  'reliability',
  'importance',
  'summary',
  'digest',
] as const;
const SOURCE_KEYS = ['kind', 'id', 'revision', 'supersedesRevision'] as const;
const QUERY_KEYS = ['actorId', 'semanticTime', 'topics', 'subject', 'maxCards'] as const;
const SOURCE_KINDS = new Set<TaixuEvidenceSourceKind>([
  'direct_observation',
  'world_fact',
  'conversation',
  'relationship_event',
  'rumor',
]);
const VISIBILITIES = new Set<TaixuEvidenceVisibility>(['public', 'actor_private', 'secret']);
const POLARITIES = new Set<TaixuEvidencePolarity>(['supported', 'contradicted', 'unknown']);
const BUCKET_ORDER: TaixuEvidencePolarity[] = ['supported', 'contradicted', 'unknown'];

export function createTaixuEvidenceCard(
  input: CreateTaixuEvidenceCardInput,
): TaixuEvidenceCardV1 {
  const semantic = {
    contractVersion: TAIXU_EVIDENCE_MEMORY_VERSION,
    actorId: input.actorId,
    source: { ...input.source },
    visibility: input.visibility,
    observedAtSemanticTime: input.observedAtSemanticTime,
    subject: input.subject,
    topic: input.topic,
    polarity: input.polarity,
    reliability: input.reliability,
    importance: input.importance,
    summary: input.summary,
  };
  return validateTaixuEvidenceCard({ ...semantic, digest: stableDigest(semantic) });
}

export function validateTaixuEvidenceCard(
  value: unknown,
  expected: { actorId?: string; semanticTime?: number; digest?: string } = {},
): TaixuEvidenceCardV1 {
  const card = objectRecord(value);
  assertExactKeys(card, CARD_KEYS, []);
  if (card.contractVersion !== TAIXU_EVIDENCE_MEMORY_VERSION) schemaFailure();
  if (!boundedString(card.actorId, 128)) schemaFailure();
  if (expected.actorId !== undefined && card.actorId !== expected.actorId) {
    throw new TaixuEvidenceContextError('evidence_actor_mismatch');
  }

  if (!card.source || typeof card.source !== 'object' || Array.isArray(card.source)) {
    throw new TaixuEvidenceContextError('evidence_source_missing');
  }
  const source = objectRecord(card.source);
  assertExactKeys(source, SOURCE_KEYS, ['supersedesRevision']);
  if (!SOURCE_KINDS.has(source.kind as TaixuEvidenceSourceKind) || !boundedString(source.id, 128)) {
    throw new TaixuEvidenceContextError('evidence_source_missing');
  }
  if (!positiveInteger(source.revision)) schemaFailure();
  validateSupersedeRevision(source.revision, source.supersedesRevision);

  if (!VISIBILITIES.has(card.visibility as TaixuEvidenceVisibility)) schemaFailure();
  if (!nonNegativeInteger(card.observedAtSemanticTime)) {
    throw new TaixuEvidenceContextError('evidence_time_invalid');
  }
  if (
    expected.semanticTime !== undefined &&
    card.observedAtSemanticTime > expected.semanticTime
  ) {
    throw new TaixuEvidenceContextError('evidence_time_invalid');
  }
  if (!boundedString(card.subject, 128) || !boundedString(card.topic, 128)) schemaFailure();
  if (!POLARITIES.has(card.polarity as TaixuEvidencePolarity)) schemaFailure();
  if (!boundedInteger(card.reliability, 0, 100) || !boundedInteger(card.importance, 0, 100)) {
    schemaFailure();
  }
  if (
    !boundedString(card.summary, 2048) ||
    codePointLength(card.summary) > TAIXU_EVIDENCE_SUMMARY_MAX_CODE_POINTS
  ) {
    schemaFailure();
  }
  if (!boundedString(card.digest, 256)) schemaFailure();
  const { digest: _digest, ...semantic } = card;
  const computedDigest = stableDigest(semantic);
  if (
    card.digest !== computedDigest ||
    (expected.digest !== undefined && card.digest !== expected.digest)
  ) {
    throw new TaixuEvidenceContextError('evidence_digest_mismatch');
  }
  return card as TaixuEvidenceCardV1;
}

export function assertTaixuEvidenceSupersede(
  currentValue: unknown,
  nextValue: unknown,
): TaixuEvidenceCardV1 {
  const current = validateTaixuEvidenceCard(currentValue);
  const next = validateTaixuEvidenceCard(nextValue, { actorId: current.actorId });
  if (
    sourceIdentity(current) !== sourceIdentity(next) ||
    next.source.revision !== current.source.revision + 1 ||
    next.source.supersedesRevision !== current.source.revision
  ) {
    throw new TaixuEvidenceContextError('evidence_supersede_invalid');
  }
  return next;
}

export function compileTaixuEvidenceContext(input: {
  query: TaixuContextQueryV1;
  cards: unknown[];
}): TaixuCompiledEvidenceV1 {
  const query = validateQuery(input.query);
  if (!Array.isArray(input.cards)) {
    throw new TaixuEvidenceContextError('context_query_invalid');
  }
  const excluded: TaixuCompiledEvidenceV1['excluded'] = [];
  const valid: Array<{ card: TaixuEvidenceCardV1; inputIndex: number }> = [];

  input.cards.forEach((value, inputIndex) => {
    try {
      const card = validateTaixuEvidenceCard(value, {
        actorId: query.actorId,
        semanticTime: query.semanticTime,
      });
      if (card.visibility === 'secret') {
        excluded.push({ sourceRef: evidenceSourceRef(card), reason: 'evidence_visibility_denied' });
      } else if (!query.topics.includes(card.topic) || (query.subject && card.subject !== query.subject)) {
        excluded.push({ sourceRef: evidenceSourceRef(card), reason: 'evidence_topic_mismatch' });
      } else {
        valid.push({ card, inputIndex });
      }
    } catch (error) {
      const reason = error instanceof TaixuEvidenceContextError
        ? error.code
        : 'evidence_schema_invalid';
      excluded.push({ sourceRef: rawSourceRef(value, inputIndex), reason });
    }
  });

  const unique = removeDuplicateOrConflictingRevisions(valid, excluded);
  const supersededDigests = new Set<string>();
  for (const { card } of unique) {
    if (card.source.supersedesRevision !== undefined) {
      const older = unique.find(({ card: candidate }) =>
        sourceIdentity(candidate) === sourceIdentity(card) &&
        candidate.source.revision === card.source.supersedesRevision,
      );
      if (older) supersededDigests.add(older.card.digest);
    }
  }

  const active = unique.filter(({ card }) => {
    if (!supersededDigests.has(card.digest)) return true;
    excluded.push({ sourceRef: evidenceSourceRef(card), reason: 'evidence_superseded' });
    return false;
  });
  active.sort((left, right) => compareRank(rankCard(left.card, query), rankCard(right.card, query)));

  const maxCards = query.maxCards ?? TAIXU_CONTEXT_MAX_CARDS;
  const selected = active.slice(0, maxCards);
  for (const { card } of active.slice(maxCards)) {
    excluded.push({ sourceRef: evidenceSourceRef(card), reason: 'context_card_limit' });
  }

  const included = selected.map(({ card }) => ({ card, reason: rankCard(card, query) }));
  let evidenceSection = renderEvidenceSection(included.map(({ card }) => card));
  while (utf8ByteLength(evidenceSection) > TAIXU_CONTEXT_MAX_BYTES && included.length > 0) {
    const removed = included.pop();
    if (removed) {
      excluded.push({
        sourceRef: evidenceSourceRef(removed.card),
        reason: 'context_budget_exceeded',
      });
    }
    evidenceSection = renderEvidenceSection(included.map(({ card }) => card));
  }
  if (utf8ByteLength(evidenceSection) > TAIXU_CONTEXT_MAX_BYTES) {
    throw new TaixuEvidenceContextError('context_budget_exceeded');
  }

  excluded.sort((left, right) =>
    left.sourceRef.localeCompare(right.sourceRef) || left.reason.localeCompare(right.reason),
  );
  const buckets = buildBuckets(included.map(({ card }) => card));
  const queryDigest = stableDigest(query);
  const semantic = {
    contractVersion: TAIXU_CONTEXT_COMPILER_VERSION,
    actorId: query.actorId,
    queryDigest,
    included,
    buckets,
    evidenceSection,
    byteLength: utf8ByteLength(evidenceSection),
  };
  return {
    ...semantic,
    excluded,
    digest: stableDigest(semantic),
  };
}

function validateQuery(value: unknown): TaixuContextQueryV1 {
  try {
    const query = objectRecord(value);
    assertExactKeys(query, QUERY_KEYS, ['subject', 'maxCards']);
    if (!boundedString(query.actorId, 128) || !nonNegativeInteger(query.semanticTime)) {
      throw new Error('invalid');
    }
    const rawTopics = query.topics;
    if (!Array.isArray(rawTopics) || rawTopics.length === 0 || rawTopics.length > 32) {
      throw new Error('invalid');
    }
    const topics: string[] = [];
    for (const topic of rawTopics) {
      if (!boundedString(topic, 128)) throw new Error('invalid');
      topics.push(topic);
    }
    if (new Set(topics).size !== topics.length) throw new Error('invalid');
    if (query.subject !== undefined && !boundedString(query.subject, 128)) {
      throw new Error('invalid');
    }
    if (
      query.maxCards !== undefined &&
      !boundedInteger(query.maxCards, 0, TAIXU_CONTEXT_MAX_CARDS)
    ) {
      throw new Error('invalid');
    }
    return {
      actorId: query.actorId,
      semanticTime: query.semanticTime,
      topics,
      ...(query.subject === undefined ? {} : { subject: query.subject }),
      ...(query.maxCards === undefined ? {} : { maxCards: query.maxCards }),
    } as TaixuContextQueryV1;
  } catch {
    throw new TaixuEvidenceContextError('context_query_invalid');
  }
}

function removeDuplicateOrConflictingRevisions(
  values: Array<{ card: TaixuEvidenceCardV1; inputIndex: number }>,
  excluded: TaixuCompiledEvidenceV1['excluded'],
) {
  const groups = new Map<string, Array<{ card: TaixuEvidenceCardV1; inputIndex: number }>>();
  for (const value of values) {
    const key = evidenceSourceRef(value.card);
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  const result: Array<{ card: TaixuEvidenceCardV1; inputIndex: number }> = [];
  for (const [sourceRef, group] of groups) {
    const digests = new Set(group.map(({ card }) => card.digest));
    if (digests.size > 1) {
      excluded.push({ sourceRef, reason: 'evidence_supersede_invalid' });
      continue;
    }
    result.push(group[0]);
    for (let index = 1; index < group.length; index += 1) {
      excluded.push({ sourceRef, reason: 'evidence_duplicate_revision' });
    }
  }
  return result;
}

function rankCard(card: TaixuEvidenceCardV1, query: TaixuContextQueryV1) {
  const topicIndex = query.topics.indexOf(card.topic);
  return {
    relevance: (query.subject === undefined || query.subject === card.subject ? 100 : 0) +
      (query.topics.length - topicIndex),
    recency: card.observedAtSemanticTime,
    reliability: card.reliability,
    importance: card.importance,
    tieBreakDigest: card.digest,
  };
}

function compareRank(
  left: ReturnType<typeof rankCard>,
  right: ReturnType<typeof rankCard>,
) {
  return right.relevance - left.relevance ||
    right.recency - left.recency ||
    right.reliability - left.reliability ||
    right.importance - left.importance ||
    left.tieBreakDigest.localeCompare(right.tieBreakDigest);
}

function buildBuckets(cards: TaixuEvidenceCardV1[]) {
  const buckets: Record<TaixuEvidencePolarity, string[]> = {
    supported: [],
    contradicted: [],
    unknown: [],
  };
  for (const card of cards) buckets[card.polarity].push(card.digest);
  return buckets;
}

function renderEvidenceSection(cards: TaixuEvidenceCardV1[]) {
  const lines: string[] = [];
  for (const bucket of BUCKET_ORDER) {
    const bucketCards = cards.filter((card) => card.polarity === bucket);
    if (bucketCards.length === 0) continue;
    lines.push(`[${bucket}]`);
    for (const card of bucketCards) {
      lines.push(
        `- source=${evidenceSourceRef(card)} observed=${card.observedAtSemanticTime} ` +
        `reliability=${card.reliability} importance=${card.importance} ` +
        `subject=${card.subject} topic=${card.topic} summary=${card.summary}`,
      );
    }
  }
  return lines.join('\n');
}

function sourceIdentity(card: TaixuEvidenceCardV1) {
  return `${card.source.kind}:${card.source.id}`;
}

function evidenceSourceRef(card: TaixuEvidenceCardV1) {
  return `${sourceIdentity(card)}@${card.source.revision}`;
}

function rawSourceRef(value: unknown, inputIndex: number) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = (value as Record<string, unknown>).source;
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const record = source as Record<string, unknown>;
      if (typeof record.kind === 'string' && typeof record.id === 'string') {
        return `${record.kind}:${record.id}@${String(record.revision ?? '?')}`;
      }
    }
  }
  return `input:${inputIndex}`;
}

function validateSupersedeRevision(revision: unknown, supersedesRevision: unknown) {
  if (revision === 1 && supersedesRevision !== undefined) {
    throw new TaixuEvidenceContextError('evidence_supersede_invalid');
  }
  if (
    typeof revision === 'number' &&
    revision > 1 &&
    (!positiveInteger(supersedesRevision) || supersedesRevision !== revision - 1)
  ) {
    throw new TaixuEvidenceContextError('evidence_supersede_invalid');
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) schemaFailure();
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[],
) {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) schemaFailure();
  if (allowed.some((key) => !optionalSet.has(key) && !(key in record))) schemaFailure();
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function schemaFailure(): never {
  throw new TaixuEvidenceContextError('evidence_schema_invalid');
}
