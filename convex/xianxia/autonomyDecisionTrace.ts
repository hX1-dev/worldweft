import { v } from 'convex/values';
import { internalMutation, internalQuery } from '../_generated/server';
import {
  AUTONOMY_DECISION_CONTRACT_VERSION,
  AUTONOMY_DECISION_SURVIVAL_CONTRACT_VERSION,
  autonomyDecisionTraceValidator,
  type AutonomyCandidateV1,
  type AutonomyCandidateV2,
  type AutonomyCandidateV3,
  type AutonomyDecisionTrace,
  type AutonomyDecisionTraceV1,
  type AutonomyDecisionTraceV2,
  type AutonomyDecisionTraceV3,
} from './autonomyDecisionContracts';
import { evaluateAutonomyTraceReplay } from './autonomyDecisionTraceLogic';

export const recordAutonomyDecisionTrace = internalMutation({
  args: {
    worldId: v.id('worlds'),
    trace: autonomyDecisionTraceValidator,
  },
  handler: async (ctx, args) => {
    // decisionId is the durable idempotency key: autonomous turns derive it
    // from actor + observation revision.
    const existing = await ctx.db
      .query('autonomyDecisionTraces')
      .withIndex('byDecision', (q) =>
        q
          .eq('worldId', args.worldId)
          .eq('decisionId', args.trace.decisionId),
      )
      .unique();
    if (existing) {
      const existingTrace = autonomyDecisionTraceRowToTrace(existing);
      if (evaluateAutonomyTraceReplay(existingTrace, args.trace) === 'conflict') {
        throw new Error('autonomy_trace_revision_conflict');
      }
      return {
        traceId: existing._id,
        trace: existingTrace,
        idempotentReplay: true,
      };
    }
    const traceId = await ctx.db.insert('autonomyDecisionTraces', {
      worldId: args.worldId,
      ...args.trace,
    });
    return {
      traceId,
      trace: args.trace,
      idempotentReplay: false,
    };
  },
});

export const latestAutonomyDecisionTrace = internalQuery({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('autonomyDecisionTraces')
      .withIndex('byActorCreatedAt', (q) =>
        q.eq('worldId', args.worldId).eq('actorId', args.actorId),
      )
      .order('desc')
      .first();
    return row ? autonomyDecisionTraceRowToTrace(row) : null;
  },
});

export function autonomyDecisionTraceRowToTrace(row: {
  contractVersion: AutonomyDecisionTrace['contractVersion'];
  decisionId: string;
  actorId: string;
  observationRevision: string;
  candidates: Array<AutonomyCandidateV1 | AutonomyCandidateV2 | AutonomyCandidateV3>;
  chosenCandidateId?: string;
  decisionSource: AutonomyDecisionTrace['decisionSource'];
  outcome: AutonomyDecisionTrace['outcome'];
  idleReasonCode?: string;
  exceptionReason?: string;
  exceptionSourceIds?: string[];
  survivalEnvelope?: AutonomyDecisionTraceV2['survivalEnvelope'];
  personaPolicy?: AutonomyDecisionTraceV3['personaPolicy'];
  bounds: AutonomyDecisionTrace['bounds'];
  createdAt: number;
}): AutonomyDecisionTrace {
  const base = {
    contractVersion: row.contractVersion,
    decisionId: row.decisionId,
    actorId: row.actorId,
    observationRevision: row.observationRevision,
    candidates: row.candidates,
    chosenCandidateId: row.chosenCandidateId,
    decisionSource: row.decisionSource,
    outcome: row.outcome,
    idleReasonCode: row.idleReasonCode,
    exceptionReason: row.exceptionReason,
    exceptionSourceIds: row.exceptionSourceIds,
    bounds: row.bounds,
    createdAt: row.createdAt,
  };
  if (row.contractVersion === AUTONOMY_DECISION_CONTRACT_VERSION) {
    if (!row.survivalEnvelope || !row.personaPolicy || !row.exceptionSourceIds) {
      throw new Error('autonomy_trace_persona_policy_missing');
    }
    return {
      ...base,
      contractVersion: AUTONOMY_DECISION_CONTRACT_VERSION,
      candidates: row.candidates as AutonomyCandidateV3[],
      survivalEnvelope: row.survivalEnvelope,
      personaPolicy: row.personaPolicy,
      exceptionSourceIds: row.exceptionSourceIds,
    };
  }
  if (row.contractVersion === AUTONOMY_DECISION_SURVIVAL_CONTRACT_VERSION) {
    if (!row.survivalEnvelope) {
      throw new Error('autonomy_trace_survival_envelope_missing');
    }
    return {
      ...base,
      contractVersion: AUTONOMY_DECISION_SURVIVAL_CONTRACT_VERSION,
      candidates: row.candidates as AutonomyCandidateV2[],
      survivalEnvelope: row.survivalEnvelope,
    };
  }
  return {
    ...base,
    contractVersion: row.contractVersion,
    candidates: row.candidates as AutonomyCandidateV1[],
  } as AutonomyDecisionTraceV1;
}
