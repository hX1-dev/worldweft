import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { BeliefEvidenceVerdict, ClaimTruthStatus } from './conversationContracts';
import { initialBeliefState, reviseBelief } from './beliefRevisionLogic';

export type ClaimProvenance = {
  subjectClaimId: string;
  topicId: string;
  subjectActorIds: string[];
  kind: 'claim' | 'rumor';
  truthStatus: ClaimTruthStatus;
  evidence?: Doc<'beliefEvidence'>;
};

export async function registerBeliefEvidence(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    subjectClaimId: string;
    topicId: string;
    subjectActorIds: string[];
    sourceEventId: Id<'worldEvents'>;
    verdict: BeliefEvidenceVerdict;
    now: number;
  },
) {
  const claim = await ctx.db
    .query('socialClaims')
    .withIndex('byClaim', (q) =>
      q.eq('worldId', args.worldId).eq('claimId', args.subjectClaimId),
    )
    .first();
  if (!claim) throw new Error('belief_evidence_claim_not_found');
  const event = await ctx.db.get(args.sourceEventId);
  if (
    !event ||
    event.worldId !== args.worldId ||
    event.visibility === 'rumor' ||
    event.type === 'conversation_utterance' ||
    event.type === 'group_conversation_utterance' ||
    !!(event.facts as { claimId?: string } | undefined)?.claimId
  ) {
    throw new Error('belief_evidence_event_not_authoritative');
  }
  const claimTopicId = claim.topicId;
  const claimSubjects = normalized(claim.subjectActorIds ?? [claim.assertedByActorId]);
  const subjects = normalized(args.subjectActorIds);
  if (claimTopicId !== args.topicId) throw new Error('belief_evidence_topic_mismatch');
  if (!sameStrings(claimSubjects, subjects)) throw new Error('belief_evidence_subject_mismatch');
  const eventSubjects = normalized([
    ...event.actorIds,
    ...(event.targetActorIds ?? []),
  ]);
  if (!subjects.every((actorId) => eventSubjects.includes(actorId))) {
    throw new Error('belief_evidence_event_subject_mismatch');
  }
  const evidenceId = `evidence:${args.subjectClaimId}:${String(args.sourceEventId)}`;
  const existing = await ctx.db
    .query('beliefEvidence')
    .withIndex('byEvidence', (q) =>
      q.eq('worldId', args.worldId).eq('evidenceId', evidenceId),
    )
    .first();
  if (existing) {
    if (
      existing.verdict !== args.verdict ||
      existing.topicId !== args.topicId ||
      !sameStrings(existing.subjectActorIds, subjects)
    ) {
      throw new Error('belief_evidence_conflict');
    }
    return existing;
  }
  const id = await ctx.db.insert('beliefEvidence', {
    worldId: args.worldId,
    evidenceId,
    subjectClaimId: args.subjectClaimId,
    topicId: args.topicId,
    subjectActorIds: subjects,
    sourceEventId: args.sourceEventId,
    verdict: args.verdict,
    createdAt: args.now,
  });
  return (await ctx.db.get(id))!;
}

export async function commitClaimBeliefs(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    claimId: string;
    utteranceId: Id<'conversationUtterances'>;
    clarificationEventId: Id<'worldEvents'>;
    sourceActorId: string;
    summary: string;
    recipientActorIds: string[];
    provenance: ClaimProvenance;
    now: number;
  },
) {
  const results = [];
  for (const actorId of normalized(args.recipientActorIds)) {
    results.push(await commitBeliefForActor(ctx, { ...args, actorId }));
  }
  return results;
}

async function commitBeliefForActor(
  ctx: MutationCtx,
  args: {
    worldId: Id<'worlds'>;
    claimId: string;
    utteranceId: Id<'conversationUtterances'>;
    clarificationEventId: Id<'worldEvents'>;
    sourceActorId: string;
    summary: string;
    actorId: string;
    provenance: ClaimProvenance;
    now: number;
  },
) {
  const beliefSeriesId = `belief-series:${args.provenance.subjectClaimId}:${args.actorId}`;
  const current = await currentBelief(ctx, args.worldId, args.actorId, beliefSeriesId, args.provenance.subjectClaimId);
  const evidence = args.provenance.evidence;
  let applicationId: string | undefined;
  if (evidence) {
    applicationId = `belief-application:${beliefSeriesId}:${evidence.evidenceId}`;
    const existingApplication = await ctx.db
      .query('beliefEvidenceApplications')
      .withIndex('byApplication', (q) =>
        q.eq('worldId', args.worldId).eq('applicationId', applicationId!),
      )
      .first();
    if (existingApplication) {
      return { applied: false as const, beliefId: existingApplication.resultingBeliefId, applicationId };
    }
  } else if (current?.sourceClaimId === args.claimId) {
    return { applied: false as const, beliefId: current.beliefId };
  }

  const revisionState = evidence
    ? reviseBelief(current ? {
        kind: current.kind,
        confidence: current.confidence,
        truthStatus: current.truthStatus,
        revision: current.revision ?? 1,
      } : undefined, evidence.verdict)
    : nextDeliveryState(current, args.provenance.kind, args.provenance.truthStatus);
  const beliefId = `${beliefSeriesId}:r${revisionState.revision}`;
  if (current) {
    await ctx.db.patch(current._id, {
      active: false,
      validity: 'superseded',
      supersededByBeliefId: beliefId,
      updatedAt: args.now,
    });
  }
  await ctx.db.insert('actorBeliefs', {
    worldId: args.worldId,
    beliefId,
    actorId: args.actorId,
    kind: revisionState.kind,
    sourceClaimId: args.claimId,
    sourceUtteranceId: args.utteranceId,
    sourceEventId: args.clarificationEventId,
    sourceActorId: args.sourceActorId,
    summary: args.summary,
    confidence: revisionState.confidence,
    active: true,
    beliefSeriesId,
    subjectClaimId: args.provenance.subjectClaimId,
    topicId: args.provenance.topicId,
    subjectActorIds: args.provenance.subjectActorIds,
    revision: revisionState.revision,
    validity: 'active',
    truthStatus: revisionState.truthStatus,
    supersedesBeliefId: current?.beliefId,
    evidenceEventId: evidence ? String(evidence.sourceEventId) : undefined,
    evidenceVerdict: evidence?.verdict,
    createdAt: args.now,
    updatedAt: args.now,
  });
  if (evidence && applicationId) {
    await ctx.db.insert('beliefEvidenceApplications', {
      worldId: args.worldId,
      applicationId,
      actorId: args.actorId,
      beliefSeriesId,
      subjectClaimId: args.provenance.subjectClaimId,
      evidenceId: evidence.evidenceId,
      evidenceEventId: evidence.sourceEventId,
      verdict: evidence.verdict,
      priorBeliefId: current?.beliefId,
      resultingBeliefId: beliefId,
      revision: revisionState.revision,
      clarificationClaimId: args.claimId,
      clarificationEventId: args.clarificationEventId,
      appliedAt: args.now,
    });
  }
  return { applied: true as const, beliefId, applicationId };
}

function nextDeliveryState(
  current: Doc<'actorBeliefs'> | null,
  incomingKind: 'claim' | 'rumor',
  _incomingTruthStatus: ClaimTruthStatus,
) {
  const revision = (current?.revision ?? (current ? 1 : 0)) + 1;
  if (current?.truthStatus === 'supported' || current?.truthStatus === 'contradicted') {
    return {
      revision,
      kind: current.kind,
      confidence: current.confidence,
      truthStatus: current.truthStatus,
    };
  }
  const initial = initialBeliefState({
    kind: incomingKind,
    // A listener receives the speaker's claim, not the speaker's private fact
    // access. Only an explicit evidence application may mark their belief as
    // supported or contradicted.
    supported: false,
  });
  return { revision, ...initial };
}

async function currentBelief(
  ctx: MutationCtx,
  worldId: Id<'worlds'>,
  actorId: string,
  beliefSeriesId: string,
  subjectClaimId: string,
) {
  const indexed = await ctx.db
    .query('actorBeliefs')
    .withIndex('byActorSeries', (q) =>
      q
        .eq('worldId', worldId)
        .eq('actorId', actorId)
        .eq('beliefSeriesId', beliefSeriesId)
        .eq('active', true),
    )
    .first();
  if (indexed) return indexed;
  const rows = await ctx.db
    .query('actorBeliefs')
    .withIndex('byActor', (q) => q.eq('worldId', worldId).eq('actorId', actorId))
    .collect();
  return rows
    .filter((row) => row.active && (row.subjectClaimId ?? row.sourceClaimId) === subjectClaimId)
    .sort((a, b) => (b.revision ?? 1) - (a.revision ?? 1))[0] ?? null;
}

function normalized(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function sameStrings(a: string[], b: string[]) {
  const left = normalized(a);
  const right = normalized(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
