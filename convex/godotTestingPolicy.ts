export function assertGodotSmokeActorId(actorId: string, operation: string) {
  if (!actorId.startsWith('godot_smoke_')) {
    throw new Error(`${operation} only accepts godot_smoke_* actors.`);
  }
}

export const GODOT_SMOKE_CLEANUP_PHASES = [
  'profile',
  'relationships_from',
  'relationships_to',
  'memories',
  'requests_assignee',
  'requests_issuer',
] as const;

export type GodotSmokeCleanupPhase = (typeof GODOT_SMOKE_CLEANUP_PHASES)[number];

export function nextGodotSmokeCleanupPhase(phase: GodotSmokeCleanupPhase) {
  const index = GODOT_SMOKE_CLEANUP_PHASES.indexOf(phase);
  return GODOT_SMOKE_CLEANUP_PHASES[index + 1] as GodotSmokeCleanupPhase | undefined;
}

export function godotSmokeCleanupPageLimit(value: number | undefined) {
  if (value === undefined) return 50;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('cleanupGodotSmokeFixture limit must be an integer from 1 to 100.');
  }
  return value;
}
