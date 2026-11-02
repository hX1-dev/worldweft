import { INNER_TRAITS, OUTER_TRAITS } from './personalityLogic';
import {
  buildPersonaPolicy,
  evaluatePersonaCandidate,
} from './personaPolicyLogic';
import {
  assertTaixuSelfDecisionFresh,
  assertTaixuSelfSupersede,
  buildTaixuSelfRollback,
  createTaixuSelfCore,
  personaPolicyForTaixuSelf,
  taixuSelfDecisionBinding,
  validateTaixuSelfCore,
  type CreateTaixuSelfCoreInput,
} from './taixuSelfCoreLogic';

function selfInput(
  overrides: Partial<CreateTaixuSelfCoreInput> = {},
): CreateTaixuSelfCoreInput {
  return {
    actorId: 'disciple_a',
    revision: 1,
    authoredFrom: ['creator:fixture', 'character_creation:disciple_a'],
    identity: {
      name: '清河',
      role: '外门弟子',
      selfSummary: '谨慎务实，也愿意照看同门。',
    },
    values: {
      weights: {
        survival: 90,
        commitments: 70,
        compassion: 55,
        autonomy: 45,
        cultivation: 65,
        relationships: 60,
        reputation: 25,
        resourceStewardship: 50,
      },
      bottomLines: ['不冒充规则裁决者', '不凭空声称拥有物品'],
    },
    expression: {
      register: 'reserved',
      brevity: 65,
      forbiddenClaims: ['已修改世界事实'],
      allowedPhraseTags: ['谨慎', '简短'],
    },
    status: 'active',
    innerTrait: '正直',
    outerTrait: '义气',
    ...overrides,
  };
}

describe('H1 taixu.self-core.v1 pure logic', () => {
  test('canonical digest and binding are replay-stable', () => {
    const first = createTaixuSelfCore(selfInput());
    const replay = createTaixuSelfCore(selfInput({
      authoredFrom: ['creator:fixture', 'character_creation:disciple_a'],
    }));
    expect(first).toEqual(replay);
    expect(first.digest).toMatch(/^stable64:[0-9a-f]{16}$/);
    expect(validateTaixuSelfCore(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(taixuSelfDecisionBinding(first, 'disciple_a')).toEqual({
      selfContractVersion: 'taixu.self-core.v1',
      actorId: 'disciple_a',
      revision: 1,
      digest: first.digest,
      sourceRefs: ['character_creation:disciple_a', 'creator:fixture'],
    });
  });

  test('all 7×12 trait combinations freeze the single authoritative dispositions mapping', () => {
    for (const innerTrait of INNER_TRAITS) {
      for (const outerTrait of OUTER_TRAITS) {
        const self = createTaixuSelfCore(selfInput({ innerTrait, outerTrait }));
        expect(self.dispositions).toEqual(buildPersonaPolicy(innerTrait, outerTrait).dimensions);
      }
    }
  });

  test.each([
    ['self_forbidden_world_fact', (self: ReturnType<typeof createTaixuSelfCore>) => ({ ...self, currentHealth: 8 })],
    ['self_forbidden_world_fact', (self: ReturnType<typeof createTaixuSelfCore>) => ({
      ...self,
      expression: { ...self.expression, secret: '不应进入 Self' },
    })],
    ['self_source_missing', (self: ReturnType<typeof createTaixuSelfCore>) => ({ ...self, authoredFrom: [] })],
    ['self_dimension_out_of_range', (self: ReturnType<typeof createTaixuSelfCore>) => ({
      ...self,
      dispositions: { ...self.dispositions, helpingBias: 61 },
    })],
    ['self_digest_mismatch', (self: ReturnType<typeof createTaixuSelfCore>) => ({ ...self, digest: 'stable64:0000000000000000' })],
  ])('rejects %s without accepting partial state', (code, mutate) => {
    const self = createTaixuSelfCore(selfInput());
    expect(() => validateTaixuSelfCore(mutate(self))).toThrow(code);
  });

  test('actor, revision and supersede mismatches fail closed', () => {
    const current = createTaixuSelfCore(selfInput());
    expect(() => validateTaixuSelfCore(current, { actorId: 'disciple_b' }))
      .toThrow('self_actor_mismatch');
    expect(() => validateTaixuSelfCore(current, { revision: 2 }))
      .toThrow('self_revision_conflict');

    const next = createTaixuSelfCore(selfInput({
      revision: 2,
      supersedesRevision: 1,
      authoredFrom: ['creator:update:2'],
    }));
    expect(assertTaixuSelfSupersede(current, next, 1)).toEqual(next);
    const skipped = createTaixuSelfCore(selfInput({
      revision: 3,
      supersedesRevision: 2,
      authoredFrom: ['creator:update:3'],
    }));
    expect(() => assertTaixuSelfSupersede(current, skipped, 1))
      .toThrow('self_supersede_invalid');
  });

  test('rollback creates a sourced new revision without overwriting either input', () => {
    const target = createTaixuSelfCore(selfInput());
    const active = createTaixuSelfCore(selfInput({
      revision: 2,
      supersedesRevision: 1,
      authoredFrom: ['creator:update:2'],
      innerTrait: '利己',
      outerTrait: '任我',
    }));
    const before = JSON.stringify({ target, active });
    const rollback = buildTaixuSelfRollback({
      active,
      target,
      authoredFrom: ['creator:rollback:receipt-3'],
    });
    expect(rollback).toMatchObject({
      revision: 3,
      supersedesRevision: 2,
      authoredFrom: ['creator:rollback:receipt-3'],
      status: 'active',
      dispositions: target.dispositions,
    });
    expect(JSON.stringify({ target, active })).toBe(before);
  });

  test('expression policy changes digest but cannot change mechanical scoring or ordering', () => {
    const reserved = createTaixuSelfCore(selfInput());
    const warm = createTaixuSelfCore(selfInput({
      expression: {
        register: 'warm',
        brevity: 30,
        forbiddenClaims: ['已修改世界事实'],
        allowedPhraseTags: ['亲切', '详尽'],
      },
    }));
    const descriptors = [
      { actionType: 'help', helping: 100, disposition: 'accept' as const },
      { actionType: 'decline', helping: 10, disposition: 'decline' as const },
    ];
    const reservedPolicy = personaPolicyForTaixuSelf(reserved, 'disciple_a');
    const warmPolicy = personaPolicyForTaixuSelf(warm, 'disciple_a');
    expect(reserved.digest).not.toBe(warm.digest);
    expect(descriptors.map((descriptor) => evaluatePersonaCandidate(reservedPolicy, descriptor).personaFit))
      .toEqual(descriptors.map((descriptor) => evaluatePersonaCandidate(warmPolicy, descriptor).personaFit));
  });

  test('a decision binding rejects a different active Self revision', () => {
    const first = createTaixuSelfCore(selfInput());
    const second = createTaixuSelfCore(selfInput({
      revision: 2,
      supersedesRevision: 1,
      authoredFrom: ['creator:update:2'],
    }));
    const binding = taixuSelfDecisionBinding(first, 'disciple_a');
    expect(() => assertTaixuSelfDecisionFresh(binding, second)).toThrow('self_stale_decision');
    expect(() => assertTaixuSelfDecisionFresh(binding, first)).not.toThrow();
  });
});
