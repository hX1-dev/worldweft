import {
  traceProposalDecisionSource,
  traceResultDecisionSource,
} from './runtimeAgentDecisionRoutingPort';

describe('RuntimeAgentDecisionRoutingPort', () => {
  it('retains existing explicit event, utility and llm proposal labels', () => {
    for (const decisionSource of ['event', 'utility', 'llm'] as const) {
      expect(traceProposalDecisionSource({ params: { decisionSource } }, 'fallback')).toBe(decisionSource);
    }
  });

  it('retains fallback and rule semantics for malformed or absent labels', () => {
    expect(traceProposalDecisionSource({ params: { decisionSource: 'forged' } }, 'fallback')).toBe('fallback');
    expect(traceResultDecisionSource({ skipped: 'llm_unavailable' })).toBe('llm');
    expect(traceResultDecisionSource({ skipped: 'body_busy' })).toBe('rule');
  });

  it('does not let a proposal impersonate an existing fallback source', () => {
    expect(traceResultDecisionSource({ decisionSource: 'fallback', proposal: { params: {} } })).toBe('fallback');
    expect(traceResultDecisionSource({ decisionSource: 'rule', proposal: { params: { decisionSource: 'utility' } } })).toBe('utility');
  });
});
