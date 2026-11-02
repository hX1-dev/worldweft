/**
 * Pure boundary for the already-derived completed tick view. It deliberately
 * has no runtime dependencies or mutation capability.
 */
export function assembleRuntimeAgentTickResult<T extends { lease: { status: 'completed' } }>(
  result: T,
): T {
  return result;
}
