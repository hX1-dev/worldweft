import { assembleRuntimeAgentTickResult } from './runtimeAgentTickResultPort';

describe('RuntimeAgentTickResultPort', () => {
  test('preserves the existing completed result shape, order and provider-zero evidence', () => {
    const source = {
      ticked: 2,
      results: [{ actorId: 'a' }, { actorId: 'b' }],
      scheduler: { actorIds: ['a', 'b'] },
      canary: { results: [] },
      productionPilot: { externalProviderCalls: 0, worldActionsCreated: 0 },
      shadow: { results: [{ actorId: 'a', externalProviderCalls: 0 }] },
      lease: { status: 'completed' as const, tickId: 'tick-1', owner: 'legacy' },
    };
    expect(assembleRuntimeAgentTickResult(source)).toBe(source);
  });
});
