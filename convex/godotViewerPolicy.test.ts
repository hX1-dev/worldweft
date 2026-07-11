import {
  canGodotViewerReadEvent,
  canReadGodotActorPrivateState,
  godotReadProjection,
} from './godotViewerPolicy';

describe('Godot viewer-safe read policy', () => {
  const base = {
    _id: 'event-1',
    visibility: 'private' as const,
    actorIds: ['npc-a'],
    targetActorIds: ['npc-b'],
    witnessActorIds: ['guard'],
    locationId: 'tea-stall',
  };

  test('keeps private and witnessed facts with principals', () => {
    expect(canGodotViewerReadEvent(base, { viewerActorId: 'npc-a' })).toBe(true);
    expect(canGodotViewerReadEvent(base, { viewerActorId: 'outsider' })).toBe(false);
    expect(canGodotViewerReadEvent(base, { viewerActorId: 'guard' })).toBe(false);
    expect(
      canGodotViewerReadEvent(
        { ...base, visibility: 'witnessed', witnessActorIds: ['guard'] },
        { viewerActorId: 'guard' },
      ),
    ).toBe(true);
  });

  test('projects public, local, and learned rumor events without omniscience', () => {
    expect(
      canGodotViewerReadEvent(
        { ...base, visibility: 'public' },
        { viewerActorId: 'outsider' },
      ),
    ).toBe(true);
    expect(
      canGodotViewerReadEvent(
        { ...base, visibility: 'local' },
        { viewerActorId: 'outsider', viewerLocationId: 'tea-stall' },
      ),
    ).toBe(true);
    expect(
      canGodotViewerReadEvent(
        { ...base, visibility: 'local' },
        { viewerActorId: 'outsider', viewerLocationId: 'west-gate' },
      ),
    ).toBe(false);
    expect(
      canGodotViewerReadEvent(
        { ...base, visibility: 'rumor' },
        { viewerActorId: 'outsider', knownEventIds: new Set(['event-1']) },
      ),
    ).toBe(true);
  });

  test('reserves private actor state and unrestricted reads for self or debug', () => {
    expect(canReadGodotActorPrivateState('player', 'npc-a', false)).toBe(false);
    expect(canReadGodotActorPrivateState('npc-a', 'npc-a', false)).toBe(true);
    expect(canReadGodotActorPrivateState('player', 'npc-a', true)).toBe(true);
    expect(godotReadProjection(false)).toBe('player');
    expect(godotReadProjection(true)).toBe('debug');
  });
});
