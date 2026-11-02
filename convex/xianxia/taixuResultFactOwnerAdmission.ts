import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { autonomyDecisionTraceRowToTrace } from './autonomyDecisionTrace';
import {
  isValidTaixuResultAdoptionState,
  type TaixuResultAdoptionStateV1,
} from './taixuResultSelectiveMemoryAdoptionLogic';
import {
  admitTaixuResultFromFactOwner,
  type TaixuResultAdmissionFence,
} from './taixuResultFactOwnerAdmissionLogic';
import {
  TAIXU_EMBODIMENT_RECEIPT_VERSION,
  type TaixuGodotAuthorityReceipt,
} from './taixuEmbodimentReceiptLogic';

const receiptValidator = v.object({
  contractVersion: v.literal('taixu.embodiment-receipt.v1'),
  authority: v.literal('godot'),
  receiptId: v.string(),
  actorId: v.string(),
  decisionId: v.string(),
  candidateId: v.string(),
  revision: v.number(),
  actionRecordId: v.string(),
  executionId: v.string(),
  status: v.union(v.literal('arrived'), v.literal('blocked'), v.literal('cancelled')),
  terminalSourceRef: v.string(),
  reportedAt: v.number(),
});

type VerifiedAdmissionArgs = {
  worldId: Id<'worlds'>;
  traceId: Id<'autonomyDecisionTraces'>;
  actionRecordId: Id<'actionRecords'>;
  executionId: Id<'actionExecutions'>;
  terminalEventId: Id<'worldEvents'>;
  receipt: TaixuGodotAuthorityReceipt;
  expectedRevision?: number;
};

/** Constructs the H5 terminal receipt exclusively from canonical server rows. */
export function buildServerTaixuH5TerminalReceipt(input: {
  trace: {
    contractVersion: string;
    decisionId: string;
    actorId: string;
    candidates: Array<{ candidateId: string; status: string }>;
  };
  action: { id: string; actorId: string; candidateId?: string };
  execution: { id: string; actorId: string; actionRecordId: string; revision: number };
  event: { id: string; actionId?: string; createdAt: number };
}): TaixuGodotAuthorityReceipt {
  if (
    input.trace.contractVersion !== 'taixu.autonomy-decision.v3' ||
    !input.action.candidateId ||
    input.trace.actorId !== input.action.actorId ||
    input.action.actorId !== input.execution.actorId ||
    input.execution.actionRecordId !== input.action.id ||
    input.event.actionId !== input.action.id ||
    !Number.isSafeInteger(input.execution.revision) || input.execution.revision <= 0 ||
    !Number.isSafeInteger(input.event.createdAt) || input.event.createdAt < 0 ||
    !input.trace.candidates.some((candidate) =>
      candidate.candidateId === input.action.candidateId && candidate.status === 'eligible',
    )
  ) {
    throw new Error('taixu_result_admission_terminal_binding_invalid');
  }
  return {
    contractVersion: TAIXU_EMBODIMENT_RECEIPT_VERSION,
    authority: 'godot',
    receiptId: `taixu-h5:${input.execution.id}:${input.event.id}`,
    actorId: input.action.actorId,
    decisionId: input.trace.decisionId,
    candidateId: input.action.candidateId,
    revision: input.execution.revision,
    actionRecordId: input.action.id,
    executionId: input.execution.id,
    status: 'arrived',
    terminalSourceRef: `world-event:${input.event.id}`,
    reportedAt: input.event.createdAt,
  };
}

/**
 * Private transaction helper shared by the legacy internal entry and the one
 * canonical terminal mutation. It never calls another mutation and persists
 * only actor-owned H6 state plus the exact receipt/event fence.
 */
export async function admitVerifiedTaixuResultTx(
  ctx: MutationCtx,
  args: VerifiedAdmissionArgs,
) {
  const [traceRow, action, execution, event, stateRow, fenceRow] = await Promise.all([
    ctx.db.get(args.traceId),
    ctx.db.get(args.actionRecordId),
    ctx.db.get(args.executionId),
    ctx.db.get(args.terminalEventId),
    ctx.db.query('taixuResultAdoptionStates').withIndex('byActor', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.receipt.actorId),
    ).unique(),
    ctx.db.query('taixuResultAdmissionReceipts').withIndex('byActorTerminalEvent', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.receipt.actorId).eq('terminalEventId', args.terminalEventId),
    ).unique(),
  ]);
  if (!traceRow || !action || !execution || !event) {
    throw new Error('taixu_result_admission_source_missing');
  }
  // Preserve the fail-closed boundary while making a canonical-row drift
  // diagnosable. The pure admission code intentionally has one aggregate
  // terminal failure, but the transaction owner knows which row is stale.
  if (action.status !== 'applied') {
    throw new Error(`taixu_result_admission_action_terminal_invalid:${action.status}`);
  }
  if (execution.status !== 'completed') {
    throw new Error(`taixu_result_admission_execution_terminal_invalid:${execution.status}`);
  }
  const current = stateRow
    ? parseStoredState(stateRow.stateJson, stateRow.stateDigest, stateRow.actorId, stateRow.revision)
    : undefined;
  const priorFence = fenceRow ? rowToFence(fenceRow) : undefined;
  const result = admitTaixuResultFromFactOwner({
    snapshot: {
      worldId: String(args.worldId),
      traceId: String(traceRow._id),
      trace: autonomyDecisionTraceRowToTrace(traceRow) as never,
      action: {
        id: String(action._id), worldId: String(action.worldId), actorId: action.actorId,
        status: action.status, candidateId: action.chosenCandidateId,
      },
      execution: {
        id: String(execution._id), worldId: String(execution.worldId), actorId: execution.actorId,
        actionRecordId: String(execution.actionRecordId), revision: execution.revision,
        status: execution.status,
        terminalEventId: execution.terminalEventId ? String(execution.terminalEventId) : undefined,
      },
      event: {
        id: String(event._id), worldId: String(event.worldId), actionId: event.actionId,
        actorIds: event.actorIds, targetActorIds: event.targetActorIds,
        witnessActorIds: event.witnessActorIds, type: event.type,
        visibility: event.visibility, createdAt: event.createdAt,
      },
    },
    receipt: args.receipt,
    current,
    expectedRevision: args.expectedRevision ?? (current?.revision ?? 0),
    priorFence,
  });
  if (result.kind === 'rejected') {
    throw new Error(`taixu_result_admission_${result.reasonCode}`);
  }
  if (result.kind === 'replayed') {
    return { kind: result.kind, revision: result.state.revision };
  }
  if (args.receipt.status !== 'arrived') {
    throw new Error('taixu_result_admission_receipt_not_arrived');
  }

  const statePatch = {
    revision: result.state.revision,
    stateJson: JSON.stringify(result.state),
    stateDigest: result.state.digest,
    updatedAt: event.createdAt,
  };
  if (stateRow) await ctx.db.patch(stateRow._id, statePatch);
  else await ctx.db.insert('taixuResultAdoptionStates', {
    worldId: args.worldId,
    actorId: args.receipt.actorId,
    ...statePatch,
  });
  await ctx.db.insert('taixuResultAdmissionReceipts', {
    worldId: args.worldId,
    actorId: args.receipt.actorId,
    terminalEventId: args.terminalEventId,
    receiptId: result.fence.receiptId,
    receiptRevision: result.fence.receiptRevision,
    contractVersion: args.receipt.contractVersion,
    authority: args.receipt.authority,
    decisionId: args.receipt.decisionId,
    candidateId: args.receipt.candidateId,
    status: args.receipt.status,
    terminalSourceRef: args.receipt.terminalSourceRef,
    reportedAt: args.receipt.reportedAt,
    traceId: args.traceId,
    actionRecordId: args.actionRecordId,
    executionId: args.executionId,
    visibility: result.fence.visibility,
    evidenceDigest: result.fence.evidenceDigest,
    stateRevision: result.state.revision,
    createdAt: event.createdAt,
  });
  return { kind: result.kind, revision: result.state.revision };
}

/**
 * The only runtime caller: after server revalidation has written the terminal
 * action/execution/event, derive the H5 receipt from those canonical rows.
 * The bridge report never supplies receipt material.
 */
export async function admitServerVerifiedTaixuTerminalResultTx(
  ctx: MutationCtx,
  args: Omit<VerifiedAdmissionArgs, 'receipt' | 'expectedRevision'>,
) {
  const [traceRow, action, execution, event] = await Promise.all([
    ctx.db.get(args.traceId),
    ctx.db.get(args.actionRecordId),
    ctx.db.get(args.executionId),
    ctx.db.get(args.terminalEventId),
  ]);
  if (!traceRow || !action || !execution || !event) {
    throw new Error('taixu_result_admission_source_missing');
  }
  const trace = autonomyDecisionTraceRowToTrace(traceRow);
  if (
    trace.contractVersion !== 'taixu.autonomy-decision.v3' ||
    action.autonomyDecisionTraceId !== args.traceId ||
    (execution as typeof execution & {
      autonomyDecisionTraceId?: Id<'autonomyDecisionTraces'>;
    }).autonomyDecisionTraceId !== args.traceId ||
    !action.chosenCandidateId ||
    !trace.candidates.some((candidate) =>
      candidate.candidateId === action.chosenCandidateId && candidate.status === 'eligible',
    )
  ) {
    throw new Error('taixu_result_admission_terminal_binding_invalid');
  }
  const receipt = buildServerTaixuH5TerminalReceipt({
    trace,
    action: {
      id: String(action._id),
      actorId: action.actorId,
      candidateId: action.chosenCandidateId,
    },
    execution: {
      id: String(execution._id),
      actorId: execution.actorId,
      actionRecordId: String(execution.actionRecordId),
      revision: execution.revision,
    },
    event: {
      id: String(event._id),
      actionId: event.actionId,
      createdAt: event.createdAt,
    },
  });
  return await admitVerifiedTaixuResultTx(ctx, { ...args, receipt });
}

/** Internal-only compatibility entry; runtime code uses the helper above. */
export const admitVerifiedTaixuResult = internalMutation({
  args: {
    worldId: v.id('worlds'),
    traceId: v.id('autonomyDecisionTraces'),
    actionRecordId: v.id('actionRecords'),
    executionId: v.id('actionExecutions'),
    terminalEventId: v.id('worldEvents'),
    receipt: receiptValidator,
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => await admitVerifiedTaixuResultTx(ctx, args),
});

function parseStoredState(value: string, digest: string, actorId: string, revision: number): TaixuResultAdoptionStateV1 {
  let state: unknown;
  try {
    state = JSON.parse(value);
  } catch {
    throw new Error('taixu_result_admission_state_corrupt');
  }
  const candidate = state as TaixuResultAdoptionStateV1;
  if (!isValidTaixuResultAdoptionState(candidate) || candidate.digest !== digest || candidate.actorId !== actorId || candidate.revision !== revision) {
    throw new Error('taixu_result_admission_state_corrupt');
  }
  return candidate;
}

function rowToFence(row: {
  terminalEventId: unknown;
  receiptId: string;
  receiptRevision: number;
  traceId: unknown;
  actionRecordId: unknown;
  executionId: unknown;
  visibility: 'public' | 'actor_private';
  evidenceDigest: string;
  stateRevision: number;
}): TaixuResultAdmissionFence {
  return {
    terminalEventId: String(row.terminalEventId), receiptId: row.receiptId,
    receiptRevision: row.receiptRevision, traceId: String(row.traceId),
    actionRecordId: String(row.actionRecordId), executionId: String(row.executionId),
    visibility: row.visibility, evidenceDigest: row.evidenceDigest,
    stateRevision: row.stateRevision,
  };
}
