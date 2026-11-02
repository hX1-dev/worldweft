import type { AutonomyDecisionSource } from './autonomyDecisionContracts';

export type DecisionSourceProposal = {
  params?: Record<string, unknown>;
};

function requestedDecisionSource(proposal?: DecisionSourceProposal):
  | 'event'
  | 'utility'
  | 'llm'
  | undefined {
  const requested = proposal?.params?.decisionSource;
  return requested === 'event' || requested === 'utility' || requested === 'llm'
    ? requested
    : undefined;
}

/** Pure C1b source normalization; it cannot select a candidate or invoke a provider. */
export function traceProposalDecisionSource(
  proposal: DecisionSourceProposal | undefined,
  fallback: AutonomyDecisionSource,
): AutonomyDecisionSource {
  return requestedDecisionSource(proposal) ?? fallback;
}

export function traceResultDecisionSource(input: {
  decisionSource?: AutonomyDecisionSource;
  skipped?: string;
  proposal?: DecisionSourceProposal;
}): AutonomyDecisionSource {
  if (input.decisionSource) {
    return traceProposalDecisionSource(input.proposal, input.decisionSource);
  }
  return requestedDecisionSource(input.proposal) ??
    (input.skipped?.startsWith('llm_') ? 'llm' : 'rule');
}
