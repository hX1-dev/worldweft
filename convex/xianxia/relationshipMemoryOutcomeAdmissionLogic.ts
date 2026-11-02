import {
  projectDomainOutcomeEvidence,
  type DomainOutcomeEvidenceReceipt,
  type DomainOutcomeEvidenceSource,
} from './runtimeDomainOutcomeEvidencePort';

export type RelationshipMemoryWriterDomain = 'relationship' | 'memory';

export type RelationshipMemoryOutcomeAdmission = {
  status: 'admitted' | 'no_effect';
  reasonCode: 'domain_outcome_applied' | 'domain_outcome_no_effect';
  domain: RelationshipMemoryWriterDomain;
  outcome: DomainOutcomeEvidenceReceipt['outcome'];
  receiptKey: string;
  replay: boolean;
};

/**
 * Thin admission shared by two independent Domain Writers. It validates a
 * common evidence envelope but never applies either relationship or memory.
 */
export function admitRelationshipMemoryOutcome(input: {
  receipt: DomainOutcomeEvidenceReceipt;
  expected: {
    domain: RelationshipMemoryWriterDomain;
    source: DomainOutcomeEvidenceSource;
    sourceRef: string;
    sourceRevision: number;
    effectReceiptRef: string;
  };
}): RelationshipMemoryOutcomeAdmission | undefined {
  const receipt = projectDomainOutcomeEvidence(input.receipt);
  if (
    !receipt ||
    receipt.receiptKey !== input.receipt.receiptKey ||
    receipt.domain !== input.expected.domain ||
    receipt.source !== input.expected.source ||
    receipt.sourceRef !== input.expected.sourceRef ||
    receipt.sourceRevision !== input.expected.sourceRevision ||
    receipt.effectReceiptRef !== input.expected.effectReceiptRef
  ) return undefined;
  const applied = receipt.outcome === 'applied';
  return {
    status: applied ? 'admitted' : 'no_effect',
    reasonCode: applied ? 'domain_outcome_applied' : 'domain_outcome_no_effect',
    domain: input.expected.domain,
    outcome: receipt.outcome,
    receiptKey: receipt.receiptKey,
    replay: receipt.replay,
  };
}
