#!/usr/bin/env node

import {
  AgentSoakBudget,
  actorContextDelta,
  actorContextSnapshot,
  readAgentSoakConfig,
  relationshipEffects,
} from './agent_soak_policy.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const defaults = readAgentSoakConfig({});
assert(defaults.ticks === 3, 'default soak tick count');
assert(defaults.tickLimit === 4, 'default tick actor limit');
assert(defaults.requireMemoryDelta === false, 'default memory delta is observational');

const long = readAgentSoakConfig({
  GODOT_SOAK_TICKS: '24',
  GODOT_SOAK_DELAY_MS: '250',
  GODOT_SOAK_CONTEXT_ACTORS: '12',
  GODOT_SOAK_MAX_RUNTIME_MS: '600000',
  GODOT_SOAK_REQUIRE_MEMORY_DELTA: 'true',
  GODOT_SOAK_REQUIRE_RELATIONSHIP_DELTA: '1',
});
assert(long.ticks === 24, 'long soak supports 24 ticks');
assert(long.contextActors === 12, 'long soak supports bounded actor coverage');
assert(long.requireMemoryDelta, 'long soak can require memory delta');
assert(long.requireRelationshipDelta, 'long soak can require relationship delta');

const clamped = readAgentSoakConfig({
  GODOT_SOAK_TICKS: '999',
  GODOT_SOAK_TICK_LIMIT: '-2',
  GODOT_SOAK_REQUEST_TIMEOUT_MS: '999999',
});
assert(clamped.ticks === 60, 'ticks clamp at 60');
assert(clamped.tickLimit === 1, 'tick limit clamps at 1');
assert(clamped.requestTimeoutMs === 120000, 'request timeout clamps at 120 seconds');

let now = 1000;
const budget = new AgentSoakBudget(
  readAgentSoakConfig({
    GODOT_SOAK_MAX_RUNTIME_MS: '10000',
    GODOT_SOAK_MAX_RESPONSE_BYTES: '50000',
    GODOT_SOAK_MAX_TOTAL_RESPONSE_BYTES: '65536',
  }),
  () => now,
);
budget.observeResponse('/godot/tick', 30000);
budget.observeResponse('/godot/regionState', 30000);
assert(budget.summary().responseBytes === 60000, 'budget tracks response bytes');

let failed = false;
try {
  budget.observeResponse('/godot/replay', 6000);
} catch (error) {
  failed = String(error).includes('cumulative response budget');
}
assert(failed, 'budget rejects cumulative response overflow');

now = 12000;
failed = false;
try {
  budget.assertRuntime('/godot/actorContext');
} catch (error) {
  failed = String(error).includes('wall-clock budget');
}
assert(failed, 'budget rejects wall-clock overflow');

const before = actorContextSnapshot({
  memories: [{ id: 'memory-old' }],
  recentActions: [{ actionRecordId: 'action-old' }],
  recentEvents: [{ worldEventId: 'event-old' }],
  relationship: {
    viewerToActor: { affinity: 1, trust: 2, suspicion: 0, tags: [] },
    actorToViewer: { affinity: 0, trust: 0, suspicion: 0, tags: [] },
  },
});
const after = actorContextSnapshot({
  memories: [{ id: 'memory-new' }, { id: 'memory-old' }],
  recentActions: [{ actionRecordId: 'action-new' }],
  recentEvents: [{ worldEventId: 'event-new' }],
  relationship: {
    viewerToActor: { affinity: 3, trust: 2, suspicion: 0, tags: ['met'] },
    actorToViewer: { affinity: 0, trust: 0, suspicion: 0, tags: [] },
  },
});
const delta = actorContextDelta(before, after);
assert(delta.addedMemoryIds.join(',') === 'memory-new', 'memory ids produce a stable delta');
assert(delta.addedActionRecordIds.join(',') === 'action-new', 'action ids produce a stable delta');
assert(delta.addedWorldEventIds.join(',') === 'event-new', 'event ids produce a stable delta');
assert(delta.relationshipDimensionsChanged === 2, 'relationship dimensions report changes');

const relationshipDeltas = relationshipEffects({
  relationships: [
    { targetActorId: 'resident-a', delta: 2 },
    { targetActorId: '', delta: 9 },
    { targetActorId: 'resident-b', delta: 'invalid' },
  ],
});
assert(relationshipDeltas.length === 1, 'only structured relationship effects are counted');
assert(relationshipDeltas[0].delta === 2, 'relationship delta preserves rule value');

console.log('Agent soak policy check passed.');
