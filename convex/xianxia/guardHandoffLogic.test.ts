import { describe, expect, it } from '@jest/globals';
import type {
  LifeSocialReviewReceipt,
  LifeSocialReviewSource,
} from './lifeSocialReviewLogic';
import {
  buildGuardHandoffProposal,
  evaluateGuardHandoffReadiness,
  reconcileGuardHandoffTerminal,
  scheduleGuardHandoffPlan,
} from './guardHandoffLogic';
import { sharedPlanGoalSourceRef } from './guardHandoffContracts';

const source: LifeSocialReviewSource = {
  kind: 'group_duty_open',
  sourceRef: 'group-commitment:night-watch',
  sourceRevision: 'commitment:pending:42',
  sourceDigest: 'stable64:night-watch',
  occurredGameHour: 42,
  visibility: 'participants',
  subjectActorIds: ['incoming', 'outgoing'],
};

function review(): LifeSocialReviewReceipt {
  return {
    contractVersion: 'taixu.life-social-review.v1',
    reviewId: 'life-social-review:weekly:outgoing',
    actorId: 'outgoing',
    windowId: 'weekly:1',
    windowDigest: 'stable64:weekly',
    cadence: 'weekly',
    periodIndex: 1,
    windowStartGameHour: 0,
    windowEndGameHour: 168,
    status: 'factual',
    sourceRefs: [source],
    sourceSetDigest: 'stable64:sources',
    sourcesTruncated: false,
    providerCalls: 0,
    createdWorldActions: 0,
    createdSocialCandidates: 0,
    createdRelationshipChanges: 0,
    createdMemories: 0,
    reviewDigest: 'stable64:review',
  };
}

function actor(actorId: string, currentLocationId: string) {
  return {
    actorId,
    role: 'guard',
    dutyState: 'on_watch',
    aliveAndCapable: true,
    busy: false,
    homeZoneId: 'north-gate',
    currentLocationId,
  };
}

function scheduledPlan() {
  const proposal = buildGuardHandoffProposal({
    review: review(),
    reviewSource: source,
    latestOwnerSource: source,
    commitment: {
      commitmentId: 'night-watch', status: 'pending',
      donorActorId: 'outgoing', recipientActorId: 'incoming',
    },
    outgoing: actor('outgoing', 'north-gate'),
    incoming: actor('incoming', 'market'),
    handoffLocation: {
      mapId: 'town', locationId: 'north-gate', exists: true,
      reachableByExistingTravelBody: true,
    },
    now: 100,
  });
  if (!proposal.ok) throw new Error(proposal.reasonCode);
  const scheduled = scheduleGuardHandoffPlan({ plan: proposal.plan, now: 101 });
  if (!scheduled.ok) throw new Error(scheduled.reasonCode);
  return scheduled.plan;
}

function readyAt(plan = scheduledPlan()) {
  const outgoing = evaluateGuardHandoffReadiness({
    plan,
    actor: actor('outgoing', 'north-gate'),
    evidence: {
      kind: 'already_at_handoff', planId: plan.planId, planRevision: plan.revision,
      handoffFactsDigest: plan.handoffFactsDigest,
      sourceRef: sharedPlanGoalSourceRef(plan.planId),
    },
  });
  const incoming = evaluateGuardHandoffReadiness({
    plan,
    actor: actor('incoming', 'north-gate'),
    evidence: {
      kind: 'body_arrived', actionType: 'travel', destinationLocationId: 'north-gate',
      planId: plan.planId, planRevision: plan.revision,
      handoffFactsDigest: plan.handoffFactsDigest,
      sourceRef: sharedPlanGoalSourceRef(plan.planId),
      actionRecordId: 'action:incoming', actionExecutionId: 'execution:incoming',
      terminalEventId: 'event:incoming-arrived',
    },
  });
  if (!outgoing.ok || !incoming.ok) throw new Error('expected valid readiness');
  return { plan, outgoing: outgoing.receipt, incoming: incoming.receipt };
}

describe('guard handoff pure owner seam', () => {
  it('creates only a deterministic owner snapshot from the exact duty source', () => {
    const plan = scheduledPlan();

    expect(plan.status).toBe('scheduled');
    expect(plan.handoffFacts).toMatchObject({
      outgoingActorId: 'outgoing', incomingActorId: 'incoming',
      handoffLocationId: 'north-gate', outgoingDutyState: 'on_watch',
      incomingDutyState: 'on_watch',
    });
    expect(plan.providerCalls).toBe(0);
    expect(plan.createdWorldActions).toBe(0);
  });

  it('fails closed before proposal for a stale source, non-guard, or mismatched home zone', () => {
    const input = {
      review: review(), reviewSource: source,
      latestOwnerSource: { ...source, sourceDigest: 'stable64:drift' },
      commitment: {
        commitmentId: 'night-watch', status: 'pending',
        donorActorId: 'outgoing', recipientActorId: 'incoming',
      },
      outgoing: actor('outgoing', 'north-gate'),
      incoming: actor('incoming', 'market'),
      handoffLocation: {
        mapId: 'town', locationId: 'north-gate', exists: true,
        reachableByExistingTravelBody: true,
      },
      now: 100,
    };
    expect(buildGuardHandoffProposal(input)).toEqual({
      ok: false, reasonCode: 'guard_handoff_source_stale',
    });
    expect(buildGuardHandoffProposal({
      ...input, latestOwnerSource: source,
      incoming: { ...input.incoming, role: 'merchant' },
    })).toEqual({ ok: false, reasonCode: 'guard_handoff_role_or_location_stale' });
    expect(buildGuardHandoffProposal({
      ...input, latestOwnerSource: source,
      incoming: { ...input.incoming, homeZoneId: 'west-gate' },
    })).toEqual({ ok: false, reasonCode: 'guard_handoff_role_or_location_stale' });
  });

  it('requires plan-bound body evidence or server-verified already-at-location readiness', () => {
    const plan = scheduledPlan();
    const localDuty = evaluateGuardHandoffReadiness({
      plan,
      actor: actor('outgoing', 'north-gate'),
      evidence: {
        kind: 'already_at_handoff', planId: plan.planId, planRevision: plan.revision,
        handoffFactsDigest: plan.handoffFactsDigest, sourceRef: 'duty:outgoing',
      },
    });
    expect(localDuty).toEqual({ ok: false, reasonCode: 'guard_handoff_source_stale' });

    const missingBodyTerminal = evaluateGuardHandoffReadiness({
      plan,
      actor: actor('incoming', 'north-gate'),
      evidence: {
        kind: 'body_arrived', actionType: 'travel', destinationLocationId: 'north-gate',
        planId: plan.planId, planRevision: plan.revision,
        handoffFactsDigest: plan.handoffFactsDigest,
        sourceRef: sharedPlanGoalSourceRef(plan.planId),
      },
    });
    expect(missingBodyTerminal).toEqual({
      ok: false, reasonCode: 'guard_handoff_receipt_missing',
    });
  });

  it('completes once only when both distinct exact readiness receipts exist', () => {
    const { plan, outgoing, incoming } = readyAt();
    const completed = reconcileGuardHandoffTerminal({
      plan, sourceCurrent: true, outgoing: actor('outgoing', 'north-gate'),
      incoming: actor('incoming', 'north-gate'), receipts: [outgoing, incoming], now: 102,
    });
    expect(completed.changed).toBe(true);
    expect(completed.plan.status).toBe('completed');
    expect(completed.reasonCode).toBe('guard_handoff_completed');

    const replay = reconcileGuardHandoffTerminal({
      plan: completed.plan, sourceCurrent: true, outgoing: actor('outgoing', 'north-gate'),
      incoming: actor('incoming', 'north-gate'), receipts: [outgoing, incoming], now: 103,
    });
    expect(replay).toMatchObject({ changed: false, reasonCode: 'guard_handoff_terminal_replay' });
    expect(replay.plan).toBe(completed.plan);
  });

  it('fails exactly once when a required receipt is missing or current duty facts drift', () => {
    const { plan, outgoing } = readyAt();
    const missing = reconcileGuardHandoffTerminal({
      plan, sourceCurrent: true, outgoing: actor('outgoing', 'north-gate'),
      incoming: actor('incoming', 'north-gate'), receipts: [outgoing],
      finalizeWhenIncomplete: true, now: 102,
    });
    expect(missing).toMatchObject({
      changed: true, reasonCode: 'guard_handoff_receipt_missing',
      plan: { status: 'failed' },
    });
    const drift = reconcileGuardHandoffTerminal({
      plan: scheduledPlan(), sourceCurrent: true, outgoing: actor('outgoing', 'north-gate'),
      incoming: { ...actor('incoming', 'north-gate'), busy: true },
      receipts: [], now: 102,
    });
    expect(drift).toMatchObject({
      changed: true, reasonCode: 'guard_handoff_role_or_location_stale',
      plan: { status: 'failed' },
    });
  });
});
