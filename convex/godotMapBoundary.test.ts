import {
  GODOT_LEGACY_MAPLESS_EVENT_POLICY,
  clampGodotPageLimit,
  godotActionRecordMapId,
  godotMapMatches,
  godotPageInfo,
} from './godotMapBoundary';

describe('Godot map/query boundary', () => {
  test('requires exact map ownership and explicitly excludes mapless legacy rows', () => {
    expect(GODOT_LEGACY_MAPLESS_EVENT_POLICY).toBe('exclude');
    expect(godotMapMatches('qinglan', 'qinglan')).toBe(true);
    expect(godotMapMatches('other', 'qinglan')).toBe(false);
    expect(godotMapMatches(undefined, 'qinglan')).toBe(false);
  });

  test('reads explicit action map before legacy metadata fallback', () => {
    expect(godotActionRecordMapId({ mapId: 'qinglan', metadata: { mapId: 'other' } })).toBe(
      'qinglan',
    );
    expect(godotActionRecordMapId({ metadata: { mapId: 'legacy-map' } })).toBe('legacy-map');
    expect(godotActionRecordMapId({ metadata: {} })).toBeUndefined();
  });

  test('publishes deterministic continuation metadata', () => {
    expect(
      godotPageInfo({ limit: 10, returned: 10, isDone: false, continueCursor: 'cursor-2' }),
    ).toEqual({
      limit: 10,
      returned: 10,
      isDone: false,
      truncated: true,
      continueCursor: 'cursor-2',
    });
    expect(
      godotPageInfo({ limit: 10, returned: 3, isDone: true, continueCursor: 'ignored' }),
    ).toMatchObject({ isDone: true, truncated: false, continueCursor: null });
    expect(clampGodotPageLimit(1000, 12)).toBe(50);
  });
});
