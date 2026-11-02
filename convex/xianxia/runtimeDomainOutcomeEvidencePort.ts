export type DomainOutcomeEvidenceDomain =
  | 'resource'
  | 'duty'
  | 'relationship'
  | 'memory';
export type DomainOutcomeEvidenceSource =
  | 'action_execution'
  | 'conversation_session'
  | 'group_pair_duty';
export type DomainOutcomeEvidence = 'applied' | 'rejected' | 'failed' | 'no_effect';

export type DomainOutcomeEvidenceReceipt = {
  domain: DomainOutcomeEvidenceDomain;
  source: DomainOutcomeEvidenceSource;
  sourceRef: string;
  sourceRevision: number;
  idempotencyKey: string;
  effectReceiptRef: string;
  outcome: DomainOutcomeEvidence;
  replay: boolean;
  receiptKey: string;
};

export function domainOutcomeEvidenceIdempotencyKey(
  domain: DomainOutcomeEvidenceDomain,
  sourceRef: string,
  sourceRevision: number,
) {
  return `domain-outcome:${domain}:${sourceRef}:revision:${sourceRevision}`;
}

/**
 * A common receipt envelope, not a common effect writer. Domain writers own
 * resource, duty, relationship and memory settlement before this projection.
 */
export function projectDomainOutcomeEvidence(input: {
  domain: DomainOutcomeEvidenceDomain;
  source: string;
  sourceRef: string;
  sourceRevision: number;
  idempotencyKey: string;
  effectReceiptRef: string;
  outcome: DomainOutcomeEvidence;
  replay: boolean;
}): DomainOutcomeEvidenceReceipt | undefined {
  if (
    !validBinding(input.domain, input.source) ||
    !identifier(input.sourceRef) ||
    !identifier(input.effectReceiptRef) ||
    !Number.isSafeInteger(input.sourceRevision) ||
    input.sourceRevision < 1
  ) return undefined;
  const expected = domainOutcomeEvidenceIdempotencyKey(
    input.domain,
    input.sourceRef,
    input.sourceRevision,
  );
  if (input.idempotencyKey !== expected) return undefined;
  return {
    domain: input.domain,
    source: input.source,
    sourceRef: input.sourceRef,
    sourceRevision: input.sourceRevision,
    idempotencyKey: expected,
    effectReceiptRef: input.effectReceiptRef,
    outcome: input.outcome,
    replay: input.replay,
    receiptKey: expected,
  };
}

function validBinding(
  domain: DomainOutcomeEvidenceDomain,
  source: string,
): source is DomainOutcomeEvidenceSource {
  if (domain === 'resource') return source === 'action_execution';
  if (domain === 'duty') return source === 'group_pair_duty';
  return source === 'conversation_session' || source === 'group_pair_duty';
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}
