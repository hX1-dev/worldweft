import { modelSelectedExistingProposal } from './runtimeAgentModelSelectionPort';

describe('RuntimeAgentModelSelectionPort', () => {
  const proposal = { type: 'cultivate' };

  it('accepts only the existing server proposal type', () => {
    expect(modelSelectedExistingProposal('{"type":"cultivate"}', proposal)).toBe(true);
    expect(modelSelectedExistingProposal('{"type":"gather"}', proposal)).toBe(false);
  });

  it('fails closed for absent, empty, malformed or unrelated output', () => {
    expect(modelSelectedExistingProposal('', proposal)).toBe(false);
    expect(modelSelectedExistingProposal('{', proposal)).toBe(false);
    expect(modelSelectedExistingProposal('{"proposal":{"type":"cultivate"}}', proposal)).toBe(false);
    expect(modelSelectedExistingProposal('{"type":"cultivate"}', null)).toBe(false);
  });
});
