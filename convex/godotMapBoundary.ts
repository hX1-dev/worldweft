export const GODOT_LEGACY_MAPLESS_EVENT_POLICY = 'exclude' as const;

export function godotMapMatches(rowMapId: unknown, requestedMapId: string) {
  return typeof rowMapId === 'string' && rowMapId === requestedMapId;
}

export function godotActionRecordMapId(record: {
  mapId?: unknown;
  metadata?: unknown;
}) {
  if (typeof record.mapId === 'string') return record.mapId;
  if (record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)) {
    const mapId = (record.metadata as Record<string, unknown>).mapId;
    return typeof mapId === 'string' ? mapId : undefined;
  }
  return undefined;
}

export function godotPageInfo(args: {
  limit: number;
  returned: number;
  isDone: boolean;
  continueCursor: string;
}) {
  return {
    limit: args.limit,
    returned: args.returned,
    isDone: args.isDone,
    truncated: !args.isDone,
    continueCursor: args.isDone ? null : args.continueCursor,
  };
}

export function clampGodotPageLimit(value: number | undefined, fallback: number) {
  return Math.max(1, Math.min(50, Math.floor(value ?? fallback)));
}
