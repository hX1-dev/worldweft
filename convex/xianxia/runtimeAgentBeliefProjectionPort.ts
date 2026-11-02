import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/**
 * Read-only runtime seam for the already-authoritative belief/evidence rows.
 * It exposes no mutation or provider capability.
 */
export async function projectRuntimeAgentBeliefs(
  ctx: Pick<QueryCtx, 'db'>,
  worldId: Id<'worlds'>,
  actorId: string,
  topicId: string,
  beliefs: Doc<'actorBeliefs'>[],
) {
  const current = beliefs.filter(
    (belief) =>
      belief.active &&
      (!belief.validity || belief.validity === 'active') &&
      (!belief.topicId || belief.topicId === topicId),
  );
  return await Promise.all(
    current.map(async (belief) => {
      const subjectClaimId = belief.subjectClaimId ?? belief.sourceClaimId;
      const beliefSeriesId = belief.beliefSeriesId ?? `belief-series:${subjectClaimId}:${actorId}`;
      const [evidenceRows, applications] = await Promise.all([
        ctx.db
          .query('beliefEvidence')
          .withIndex('byClaim', (q) =>
            q.eq('worldId', worldId).eq('subjectClaimId', subjectClaimId),
          )
          .collect(),
        ctx.db
          .query('beliefEvidenceApplications')
          .withIndex('bySeries', (q) =>
            q.eq('worldId', worldId).eq('beliefSeriesId', beliefSeriesId),
          )
          .collect(),
      ]);
      const appliedEvidenceIds = new Set(applications.map((application) => application.evidenceId));
      let availableEvidence: Doc<'beliefEvidence'> | undefined;
      for (const evidence of evidenceRows.sort((a, b) => a.createdAt - b.createdAt)) {
        if (appliedEvidenceIds.has(evidence.evidenceId) || evidence.topicId !== topicId) continue;
        const event = await ctx.db.get(evidence.sourceEventId);
        if (!event || event.worldId !== worldId) continue;
        const principal =
          event.actorIds.includes(actorId) ||
          (event.targetActorIds ?? []).includes(actorId) ||
          (event.witnessActorIds ?? []).includes(actorId);
        if (!principal && event.visibility !== 'public') {
          const memories = await ctx.db
            .query('shortMemories')
            .withIndex('bySourceEvent', (q) =>
              q.eq('worldId', worldId).eq('sourceEventId', String(event._id)),
            )
            .take(128);
          if (
            !memories.some(
              (memory) =>
                memory.actorId === actorId &&
                memory.source !== 'rumor' &&
                !(memory.distorted ?? false),
            )
          )
            continue;
        }
        availableEvidence = evidence;
        break;
      }
      return {
        beliefId: belief.beliefId,
        kind: belief.kind,
        summary: belief.summary,
        sourceActorId: belief.sourceActorId,
        truthStatus: belief.truthStatus,
        revision: belief.revision,
        availableEvidenceEventId: availableEvidence
          ? String(availableEvidence.sourceEventId)
          : undefined,
        availableEvidenceVerdict: availableEvidence?.verdict,
      };
    }),
  );
}
