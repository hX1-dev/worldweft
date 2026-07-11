import {
  isGodotControlledActorId,
  selectBoundedRoundRobinActorIds,
  selectRoundRobinActorIds,
} from './agentTickScheduler';

describe('agent tick round-robin scheduler', () => {
  test('covers every eligible actor across bounded batches before repeating', () => {
    const actors = ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'];
    const first = selectRoundRobinActorIds(actors, undefined, 4);
    const second = selectRoundRobinActorIds(actors, first.nextAfterActorId, 4);
    const third = selectRoundRobinActorIds(actors, second.nextAfterActorId, 4);

    expect(first.actorIds).toEqual(['a', 'b', 'c', 'd']);
    expect(second.actorIds).toEqual(['e', 'f', 'g', 'h']);
    expect(third.actorIds).toEqual(['i', 'a', 'b', 'c']);
    expect(third.wrapped).toBe(true);
    expect(new Set([...first.actorIds, ...second.actorIds, ...third.actorIds])).toEqual(
      new Set(actors),
    );
  });

  test('resumes at the next lexical actor when the cursor actor was removed', () => {
    const result = selectRoundRobinActorIds(['a', 'b', 'd', 'e'], 'c', 2);

    expect(result.actorIds).toEqual(['d', 'e']);
    expect(result.nextAfterActorId).toBe('e');
  });

  test('deduplicates actors and never repeats inside an oversized batch', () => {
    const result = selectRoundRobinActorIds(['b', 'a', 'b'], undefined, 8);

    expect(result.actorIds).toEqual(['a', 'b']);
    expect(result.eligibleCount).toBe(2);
  });

  test('identifies Godot-controlled actors before reservation', () => {
    expect(isGodotControlledActorId('godot_player')).toBe(true);
    expect(isGodotControlledActorId('godot_smoke_fixture')).toBe(true);
    expect(isGodotControlledActorId('qinglan:resident')).toBe(false);
  });

  test('selects from bounded after/wrap windows without scanning all actors', () => {
    const actors = Array.from({ length: 120 }, (_, index) =>
      `npc_${String(index).padStart(3, '0')}`,
    );
    expect(
      selectBoundedRoundRobinActorIds(
        actors.slice(118),
        ['godot_player', 'godot_smoke_scale', ...actors.slice(0, 8)],
        5,
      ),
    ).toEqual(['npc_118', 'npc_119', 'npc_000', 'npc_001', 'npc_002']);
  });
});
