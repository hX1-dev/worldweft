import {
  assertGodotSmokeActorId,
  godotSmokeCleanupPageLimit,
  nextGodotSmokeCleanupPhase,
} from './godotTestingPolicy';

describe('Godot testing fixture policy', () => {
  test('accepts only the restricted smoke actor namespace', () => {
    expect(() => assertGodotSmokeActorId('godot_smoke_candidate', 'prime')).not.toThrow();
    expect(() => assertGodotSmokeActorId('godot_player', 'prime')).toThrow(
      'prime only accepts godot_smoke_* actors.',
    );
    expect(() => assertGodotSmokeActorId('npc_admin', 'prime')).toThrow(
      'prime only accepts godot_smoke_* actors.',
    );
  });

  test('keeps cleanup work in bounded ordered phases', () => {
    expect(nextGodotSmokeCleanupPhase('profile')).toBe('relationships_from');
    expect(nextGodotSmokeCleanupPhase('relationships_from')).toBe('relationships_to');
    expect(nextGodotSmokeCleanupPhase('relationships_to')).toBe('memories');
    expect(nextGodotSmokeCleanupPhase('memories')).toBe('requests_assignee');
    expect(nextGodotSmokeCleanupPhase('requests_assignee')).toBe('requests_issuer');
    expect(nextGodotSmokeCleanupPhase('requests_issuer')).toBeUndefined();
    expect(godotSmokeCleanupPageLimit(undefined)).toBe(50);
    expect(godotSmokeCleanupPageLimit(100)).toBe(100);
    expect(() => godotSmokeCleanupPageLimit(0)).toThrow('integer from 1 to 100');
    expect(() => godotSmokeCleanupPageLimit(1.5)).toThrow('integer from 1 to 100');
  });
});
