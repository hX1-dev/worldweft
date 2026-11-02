/**
 * C1c only verifies whether a model repeated the type of an already-authorized
 * server proposal. It cannot construct, repair, or admit a proposal.
 */
export function modelSelectedExistingProposal(
  content: string,
  proposal: { type: string } | null,
): boolean {
  if (!proposal || !content.trim()) return false;
  try {
    const value = JSON.parse(content) as { type?: unknown };
    return value.type === proposal.type;
  } catch {
    return false;
  }
}
