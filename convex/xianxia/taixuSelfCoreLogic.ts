import {
  buildPersonaPolicy,
  buildPersonaPolicyFromDimensions,
  stableDigest,
  type PersonaPolicyDimensions,
  type PersonaPolicyV1,
  type PersonaSelfBindingV1,
} from './personaPolicyLogic';

export const TAIXU_SELF_CORE_VERSION = 'taixu.self-core.v1' as const;

export type TaixuSelfCoreFailureCode =
  | 'self_schema_invalid'
  | 'self_actor_mismatch'
  | 'self_revision_conflict'
  | 'self_source_missing'
  | 'self_forbidden_world_fact'
  | 'self_dimension_out_of_range'
  | 'self_digest_mismatch'
  | 'self_supersede_invalid'
  | 'self_stale_decision';

export type TaixuSelfCoreV1 = {
  contractVersion: typeof TAIXU_SELF_CORE_VERSION;
  actorId: string;
  revision: number;
  supersedesRevision?: number;
  authoredFrom: string[];
  identity: {
    name: string;
    role: string;
    selfSummary: string;
  };
  values: {
    weights: {
      survival: number;
      commitments: number;
      compassion: number;
      autonomy: number;
      cultivation: number;
      relationships: number;
      reputation: number;
      resourceStewardship: number;
    };
    bottomLines: string[];
  };
  dispositions: PersonaPolicyDimensions;
  expression: {
    register: 'plain' | 'warm' | 'formal' | 'reserved' | 'direct';
    brevity: number;
    forbiddenClaims: string[];
    allowedPhraseTags: string[];
  };
  status: 'draft' | 'active' | 'superseded';
  digest: string;
};

export type CreateTaixuSelfCoreInput = Omit<TaixuSelfCoreV1, 'contractVersion' | 'dispositions' | 'digest'> & {
  innerTrait?: string;
  outerTrait?: string;
};

export class TaixuSelfCoreError extends Error {
  constructor(readonly code: TaixuSelfCoreFailureCode) {
    super(code);
    this.name = 'TaixuSelfCoreError';
  }
}

const SELF_KEYS = [
  'contractVersion',
  'actorId',
  'revision',
  'supersedesRevision',
  'authoredFrom',
  'identity',
  'values',
  'dispositions',
  'expression',
  'status',
  'digest',
] as const;
const IDENTITY_KEYS = ['name', 'role', 'selfSummary'] as const;
const VALUES_KEYS = ['weights', 'bottomLines'] as const;
const VALUE_WEIGHT_KEYS = [
  'survival',
  'commitments',
  'compassion',
  'autonomy',
  'cultivation',
  'relationships',
  'reputation',
  'resourceStewardship',
] as const;
const DISPOSITION_KEYS = [
  'riskTolerance',
  'helpingBias',
  'commitmentBias',
  'conflictBias',
  'socialBias',
  'cultivationBias',
  'persistenceBias',
  'evidenceBias',
  'resourceReserveBias',
] as const;
const EXPRESSION_KEYS = [
  'register',
  'brevity',
  'forbiddenClaims',
  'allowedPhraseTags',
] as const;
const FORBIDDEN_SELF_KEYS = new Set([
  'currentHealth',
  'health',
  'maxHealth',
  'inventory',
  'location',
  'currentLocationId',
  'relationship',
  'relationshipTruth',
  'candidate',
  'permission',
  'permissions',
  'secret',
  'secrets',
]);
const EXPRESSION_REGISTERS = new Set(['plain', 'warm', 'formal', 'reserved', 'direct']);

export function createTaixuSelfCore(input: CreateTaixuSelfCoreInput): TaixuSelfCoreV1 {
  return createTaixuSelfCoreWithDispositions(
    input,
    buildPersonaPolicy(input.innerTrait, input.outerTrait).dimensions,
  );
}

export function validateTaixuSelfCore(
  value: unknown,
  expected: { actorId?: string; revision?: number; digest?: string } = {},
): TaixuSelfCoreV1 {
  assertNoForbiddenWorldFact(value);
  const self = objectRecord(value);
  assertExactKeys(self, SELF_KEYS);
  if (self.contractVersion !== TAIXU_SELF_CORE_VERSION) schemaFailure();
  if (!nonEmptyString(self.actorId)) schemaFailure();
  if (!positiveInteger(self.revision)) schemaFailure();
  validateSupersedes(self.revision, self.supersedesRevision);
  if (!stringList(self.authoredFrom) || self.authoredFrom.length === 0) {
    throw new TaixuSelfCoreError('self_source_missing');
  }
  const identity = objectRecord(self.identity);
  assertExactKeys(identity, IDENTITY_KEYS);
  if (![identity.name, identity.role, identity.selfSummary].every(nonEmptyString)) schemaFailure();
  const values = objectRecord(self.values);
  assertExactKeys(values, VALUES_KEYS);
  const weights = objectRecord(values.weights);
  assertExactKeys(weights, VALUE_WEIGHT_KEYS);
  for (const key of VALUE_WEIGHT_KEYS) assertBoundedNumber(weights[key], -100, 100);
  if (!stringList(values.bottomLines)) schemaFailure();
  const dispositions = objectRecord(self.dispositions);
  assertExactKeys(dispositions, DISPOSITION_KEYS);
  for (const key of DISPOSITION_KEYS) {
    const bounds = key === 'riskTolerance' ? [0, 100] : [-60, 60];
    if (!boundedNumber(dispositions[key], bounds[0], bounds[1])) {
      throw new TaixuSelfCoreError('self_dimension_out_of_range');
    }
  }
  const expression = objectRecord(self.expression);
  assertExactKeys(expression, EXPRESSION_KEYS);
  if (!EXPRESSION_REGISTERS.has(String(expression.register))) schemaFailure();
  assertBoundedNumber(expression.brevity, 0, 100);
  if (!stringList(expression.forbiddenClaims) || !stringList(expression.allowedPhraseTags)) {
    schemaFailure();
  }
  if (!['draft', 'active', 'superseded'].includes(String(self.status))) schemaFailure();
  if (expected.actorId !== undefined && self.actorId !== expected.actorId) {
    throw new TaixuSelfCoreError('self_actor_mismatch');
  }
  if (expected.revision !== undefined && self.revision !== expected.revision) {
    throw new TaixuSelfCoreError('self_revision_conflict');
  }
  if (!nonEmptyString(self.digest)) schemaFailure();
  const { digest: _digest, ...semantic } = self;
  const computedDigest = stableDigest(semantic);
  if (self.digest !== computedDigest || (expected.digest !== undefined && self.digest !== expected.digest)) {
    throw new TaixuSelfCoreError('self_digest_mismatch');
  }
  return self as TaixuSelfCoreV1;
}

export function assertTaixuSelfSupersede(
  currentValue: unknown,
  nextValue: unknown,
  expectedCurrentRevision: number,
): TaixuSelfCoreV1 {
  const current = validateTaixuSelfCore(currentValue, { revision: expectedCurrentRevision });
  const next = validateTaixuSelfCore(nextValue, { actorId: current.actorId });
  if (
    current.status !== 'active' ||
    next.status !== 'active' ||
    next.revision !== current.revision + 1 ||
    next.supersedesRevision !== current.revision
  ) {
    throw new TaixuSelfCoreError('self_supersede_invalid');
  }
  return next;
}

export function buildTaixuSelfRollback(input: {
  active: unknown;
  target: unknown;
  authoredFrom: string[];
}): TaixuSelfCoreV1 {
  const active = validateTaixuSelfCore(input.active);
  const target = validateTaixuSelfCore(input.target, { actorId: active.actorId });
  if (active.status !== 'active' || input.authoredFrom.length === 0) {
    throw new TaixuSelfCoreError(
      input.authoredFrom.length === 0 ? 'self_source_missing' : 'self_supersede_invalid',
    );
  }
  return createTaixuSelfCoreWithDispositions(
    {
      actorId: active.actorId,
      revision: active.revision + 1,
      supersedesRevision: active.revision,
      authoredFrom: [...input.authoredFrom],
      identity: target.identity,
      values: target.values,
      expression: target.expression,
      status: 'active',
    },
    target.dispositions,
  );
}

export function taixuSelfDecisionBinding(
  value: unknown,
  expectedActorId: string,
): PersonaSelfBindingV1 {
  const self = validateTaixuSelfCore(value, { actorId: expectedActorId });
  if (self.status !== 'active') throw new TaixuSelfCoreError('self_supersede_invalid');
  return {
    selfContractVersion: TAIXU_SELF_CORE_VERSION,
    actorId: self.actorId,
    revision: self.revision,
    digest: self.digest,
    sourceRefs: [...self.authoredFrom].sort((left, right) => left.localeCompare(right)),
  };
}

export function personaPolicyForTaixuSelf(
  value: unknown,
  expectedActorId: string,
): PersonaPolicyV1 {
  const self = validateTaixuSelfCore(value, { actorId: expectedActorId });
  return buildPersonaPolicyFromDimensions(
    decisionDispositionsForTaixuSelf(self),
    taixuSelfDecisionBinding(self, expectedActorId),
  );
}

/**
 * Stable Self stores both legacy trait dispositions and explicitly authored
 * value weights. Decision policy blends the two so authored values actually
 * affect same-lane preferences without replacing the established trait model.
 */
export function decisionDispositionsForTaixuSelf(
  value: unknown,
): PersonaPolicyDimensions {
  const self = validateTaixuSelfCore(value);
  const weights = self.values.weights;
  const authored: PersonaPolicyDimensions = {
    riskTolerance: clampDimension(
      50 + (weights.autonomy - weights.survival) * 0.6,
      0,
      100,
    ),
    helpingBias: clampDimension(weights.compassion - 50),
    commitmentBias: clampDimension(weights.commitments - 50),
    conflictBias: clampDimension(
      (weights.autonomy - weights.compassion) * 0.5,
    ),
    socialBias: clampDimension(weights.relationships - 50),
    cultivationBias: clampDimension(weights.cultivation - 50),
    persistenceBias: clampDimension(
      Math.max(weights.commitments, weights.cultivation, weights.autonomy) - 50,
    ),
    evidenceBias: clampDimension(weights.reputation - 50),
    resourceReserveBias: clampDimension(weights.resourceStewardship - 50),
  };
  return {
    riskTolerance: Math.round((self.dispositions.riskTolerance + authored.riskTolerance) / 2),
    helpingBias: blendBias(self.dispositions.helpingBias, authored.helpingBias),
    commitmentBias: blendBias(self.dispositions.commitmentBias, authored.commitmentBias),
    conflictBias: blendBias(self.dispositions.conflictBias, authored.conflictBias),
    socialBias: blendBias(self.dispositions.socialBias, authored.socialBias),
    cultivationBias: blendBias(self.dispositions.cultivationBias, authored.cultivationBias),
    persistenceBias: blendBias(self.dispositions.persistenceBias, authored.persistenceBias),
    evidenceBias: blendBias(self.dispositions.evidenceBias, authored.evidenceBias),
    resourceReserveBias: blendBias(
      self.dispositions.resourceReserveBias,
      authored.resourceReserveBias,
    ),
  };
}

function blendBias(left: number, right: number) {
  return clampDimension(Math.round((left + right) / 2));
}

function clampDimension(value: number, minimum = -60, maximum = 60) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function assertTaixuSelfDecisionFresh(
  binding: PersonaSelfBindingV1,
  activeValue: unknown,
) {
  let active: TaixuSelfCoreV1;
  try {
    active = validateTaixuSelfCore(activeValue, { actorId: binding.actorId });
  } catch {
    throw new TaixuSelfCoreError('self_stale_decision');
  }
  if (
    active.status !== 'active' ||
    binding.selfContractVersion !== TAIXU_SELF_CORE_VERSION ||
    binding.revision !== active.revision ||
    binding.digest !== active.digest
  ) {
    throw new TaixuSelfCoreError('self_stale_decision');
  }
}

function createTaixuSelfCoreWithDispositions(
  input: CreateTaixuSelfCoreInput,
  dispositions: PersonaPolicyDimensions,
): TaixuSelfCoreV1 {
  const semantic = {
    contractVersion: TAIXU_SELF_CORE_VERSION,
    actorId: input.actorId,
    revision: input.revision,
    supersedesRevision: input.supersedesRevision,
    authoredFrom: [...input.authoredFrom],
    identity: { ...input.identity },
    values: {
      weights: { ...input.values.weights },
      bottomLines: [...input.values.bottomLines],
    },
    dispositions: { ...dispositions },
    expression: {
      ...input.expression,
      forbiddenClaims: [...input.expression.forbiddenClaims],
      allowedPhraseTags: [...input.expression.allowedPhraseTags],
    },
    status: input.status,
  };
  return validateTaixuSelfCore({ ...semantic, digest: stableDigest(semantic) });
}

function validateSupersedes(revision: unknown, supersedesRevision: unknown) {
  if (revision === 1 && supersedesRevision !== undefined) {
    throw new TaixuSelfCoreError('self_supersede_invalid');
  }
  if (
    typeof revision === 'number' &&
    revision > 1 &&
    (!positiveInteger(supersedesRevision) || supersedesRevision !== revision - 1)
  ) {
    throw new TaixuSelfCoreError('self_supersede_invalid');
  }
}

function assertNoForbiddenWorldFact(value: unknown) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenWorldFact(item);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_SELF_KEYS.has(key)) {
      throw new TaixuSelfCoreError('self_forbidden_world_fact');
    }
    assertNoForbiddenWorldFact(nested);
  }
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) schemaFailure();
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  if (Object.keys(record).some((key) => !allowedSet.has(key))) schemaFailure();
  if (allowed.some((key) => key !== 'supersedesRevision' && !(key in record))) schemaFailure();
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 32 && value.every(nonEmptyString);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function boundedNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function assertBoundedNumber(value: unknown, minimum: number, maximum: number) {
  if (!boundedNumber(value, minimum, maximum)) schemaFailure();
}

function schemaFailure(): never {
  throw new TaixuSelfCoreError('self_schema_invalid');
}
