import type { LifeObservationV1 } from './lifeObservation';
import { buildAuthoritativeDecisionSnapshot } from './runtimeDecisionSnapshot';
import { bindRuntimeAgentObservation } from './runtimeAgentObservationPort';

const observation = {
  contractVersion: 'taixu.life_observation.v2',
  actorId: 'han-li',
  semanticTime: { gameHour: 1, gameDay: 0 },
  self: {
    identity: { name: 'Han Li', role: 'disciple', realm: 'qi_refining', realmStage: 1 },
    body: { health: 10, maxHealth: 10, fatigue: 0, spirit: 1, mood: 0, incapacitated: false },
    inventory: [],
    duties: [],
  },
  place: { danger: {} },
  nearbyActors: [],
  worldPressures: [],
  relationships: [],
  factEventIds: [],
  backgroundSummaries: [],
  obligations: [],
  observationRevision: 'taixu.life_observation.v2:fixed',
  targetRefs: [],
  beliefs: [],
  memories: [],
  capabilities: [],
  executionScope: { mapId: 'lab' },
  bounds: {
    inventory: { limit: 32, included: 0, total: 0, truncated: false },
    nearbyActors: { limit: 24, included: 0, total: 0, truncated: false },
    relationships: { limit: 48, included: 0, total: 0, truncated: false },
    memories: { limit: 12, included: 0, total: 0, truncated: false },
    beliefs: { limit: 16, included: 0, total: 0, truncated: false },
    backgroundSummaries: { limit: 4, included: 0, total: 0, truncated: false },
    obligations: { limit: 24, included: 0, total: 0, truncated: false },
    targetRefs: { limit: 32, included: 0, total: 0, truncated: false },
    capabilities: { limit: 48, included: 0, total: 0, truncated: false },
    worldPressures: { limit: 4, included: 0, total: 0, truncated: false },
  },
  semanticDigest: 'semantic:fixed',
  observationDigest: 'observation:fixed',
} satisfies LifeObservationV1;

describe('RuntimeAgentObservationPort', () => {
  it('preserves the existing observation and authoritative snapshot bytes', () => {
    const input = {
      observation,
      candidateSetDigest: 'candidate:fixed',
      activeExecution: { executionId: 'execution:1' },
      now: 100,
    };
    const bound = bindRuntimeAgentObservation(input);
    expect(bound.observation).toBe(observation);
    expect(bound.authoritativeDecisionSnapshot).toEqual(
      buildAuthoritativeDecisionSnapshot(input),
    );
  });

  it('does not manufacture a snapshot without the existing candidate digest', () => {
    expect(bindRuntimeAgentObservation({ observation, now: 100 })).toEqual({ observation });
  });
});
