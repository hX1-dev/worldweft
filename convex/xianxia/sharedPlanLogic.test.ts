import { buildLifeSocialReview, type LifeSocialReviewSource } from './lifeSocialReviewLogic';
import {
  buildSharedGatherPlanProposal,
  buildSharedGuardHandoffPlanProposal,
  isValidSharedGatherPlan,
  isValidSharedGuardHandoffPlan,
  projectSharedPlanParticipantIntent,
  reconcileSharedGatherPlan,
  respondToSharedPlan,
  sharedPlanSourceRevision,
  type SharedGatherActorFacts,
  type SharedGatherPlanReceipt,
} from './sharedPlanLogic';
import type { GuardHandoffProposalInput } from './guardHandoffLogic';

const NOW = 1_000_000;
const SOURCE: LifeSocialReviewSource = {
  kind: 'group_duty_open',
  sourceRef: 'group-commitment:duty-1',
  sourceRevision: 'commitment:pending:900000',
  sourceDigest: 'stable64:source',
  occurredGameHour: 50,
  visibility: 'participants',
  subjectActorIds: ['han_li', 'lin_xiaoman'],
};

function actor(actorId: string, itemQuantity = 0): SharedGatherActorFacts {
  return {
    actorId,
    aliveAndCapable: true,
    busy: false,
    mapId: 'graybox',
    currentLocationId: actorId === 'han_li' ? 'quiet_retreat' : 'herb_field',
    gatherAllowed: true,
    itemQuantity,
  };
}

function review(sources: LifeSocialReviewSource[] = [SOURCE], cadence: 'daily' | 'weekly' = 'weekly') {
  return buildLifeSocialReview({
    actorId: 'han_li',
    actorCreatedGameHour: 0,
    window: {
      windowId: `life-rhythm:${cadence}:1`,
      windowDigest: 'stable64:window',
      cadence,
      periodIndex: 1,
      windowStartGameHour: 0,
      windowEndGameHour: cadence === 'weekly' ? 168 : 24,
    },
    sources,
  });
}

function proposal(overrides: Partial<Parameters<typeof buildSharedGatherPlanProposal>[0]> = {}) {
  return buildSharedGatherPlanProposal({
    review: review(),
    reviewSource: SOURCE,
    latestOwnerSource: SOURCE,
    commitment: {
      commitmentId: 'duty-1',
      status: 'pending',
      donorActorId: 'han_li',
      recipientActorId: 'lin_xiaoman',
    },
    proposer: actor('han_li'),
    invitee: actor('lin_xiaoman'),
    resource: {
      resourceNodeId: 'dew_patch',
      sourceRevision: 'resource:2:2:1000000',
      mapId: 'graybox',
      locationId: 'herb_field',
      itemId: 'spirit_herb',
      available: 2,
      gatherAllowed: true,
      proposerAccess: true,
      inviteeAccess: true,
    },
    nowGameHour: 168,
    now: NOW,
    ...overrides,
  });
}

function acceptedPlan(): SharedGatherPlanReceipt {
  const built = proposal();
  if (!built.ok) throw new Error(built.reasonCode);
  const accepted = respondToSharedPlan({
    plan: built.plan,
    actorId: 'lin_xiaoman',
    expectedRevision: 1,
    response: 'accept',
    nowGameHour: 169,
    now: NOW + 1,
  });
  if (!accepted.ok) throw new Error(accepted.reasonCode);
  return accepted.plan;
}

describe('LWSE-3c source-bound shared gather plan', () => {
  test('builds one bounded proposal only from an exact current weekly duty review', () => {
    const built = proposal();
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan).toMatchObject({
      contractVersion: 'taixu.shared-plan.v1',
      kind: 'shared_gather',
      status: 'proposed',
      revision: 1,
      proposerActorId: 'han_li',
      inviteeActorId: 'lin_xiaoman',
      resourceNodeId: 'dew_patch',
      providerCalls: 0,
      createdWorldActions: 0,
    });
    expect(built.plan.participants.map((entry) => entry.status)).toEqual(['accepted', 'invited']);
    expect(isValidSharedGatherPlan(built.plan)).toBe(true);
  });

  test.each([
    ['quiet', { review: review([]) }],
    ['daily', { review: review([SOURCE], 'daily') }],
    ['stale owner', { latestOwnerSource: { ...SOURCE, sourceRevision: 'commitment:pending:new' } }],
    ['terminal duty', { commitment: { commitmentId: 'duty-1', status: 'fulfilled', donorActorId: 'han_li', recipientActorId: 'lin_xiaoman' } }],
    ['stock below two', { resource: { resourceNodeId: 'dew_patch', sourceRevision: 'resource:1', mapId: 'graybox', locationId: 'herb_field', itemId: 'spirit_herb', available: 1, gatherAllowed: true, proposerAccess: true, inviteeAccess: true } }],
  ])('rejects %s without creating a plan', (_name, overrides) => {
    expect(proposal(overrides as never).ok).toBe(false);
  });

  test('decline is terminal and never exposes a candidate', () => {
    const built = proposal();
    if (!built.ok) throw new Error(built.reasonCode);
    const declined = respondToSharedPlan({
      plan: built.plan,
      actorId: 'lin_xiaoman',
      expectedRevision: 1,
      response: 'decline',
      nowGameHour: 169,
      now: NOW + 1,
    });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.plan.status).toBe('declined');
    expect(projectSharedPlanParticipantIntent({
      plan: declined.plan,
      actorId: 'han_li',
      sourceCurrent: true,
      actorAliveAndCapable: true,
      actorBusy: false,
      resourceAvailable: 2,
      resourceAccess: true,
    })).toMatchObject({ ok: false, reasonCode: 'shared_plan_not_scheduled' });
  });

  test('accept projects actor-scoped purpose intents without creating an action', () => {
    const plan = acceptedPlan();
    expect(plan.status).toBe('scheduled');
    for (const actorId of ['han_li', 'lin_xiaoman']) {
      const projected = projectSharedPlanParticipantIntent({
        plan,
        actorId,
        sourceCurrent: true,
        actorAliveAndCapable: true,
        actorBusy: false,
        resourceAvailable: 2,
        resourceAccess: true,
      });
      expect(projected.ok).toBe(true);
      if (!projected.ok) continue;
      expect(projected.intent).toMatchObject({
        purposeKind: 'obligation',
        sourceRef: `shared_plan:${plan.planId}`,
        sourceRevision: sharedPlanSourceRevision(plan),
        targetLocationId: 'herb_field',
        intendedActivity: 'gather',
      });
      expect(projected.proposalParams).toMatchObject({
        sharedPlanId: plan.planId,
        sharedPlanParticipantActorId: actorId,
        resourceNodeId: 'dew_patch',
      });
    }
  });

  test('one completed participant keeps plan active; exact second terminal completes it', () => {
    const plan = acceptedPlan();
    const sourceRevision = sharedPlanSourceRevision(plan);
    const first = reconcileSharedGatherPlan({
      plan,
      sourceCurrent: true,
      nowGameHour: 170,
      now: NOW + 2,
      participantGoals: [
        completed('han_li', sourceRevision),
        active('lin_xiaoman', sourceRevision),
      ],
    });
    expect(first.changed).toBe(true);
    expect(first.plan.status).toBe('active');
    const second = reconcileSharedGatherPlan({
      plan: first.plan,
      sourceCurrent: true,
      nowGameHour: 171,
      now: NOW + 3,
      participantGoals: [
        completed('han_li', sourceRevision),
        completed('lin_xiaoman', sourceRevision),
      ],
    });
    expect(second.plan.status).toBe('completed');
    expect(second.plan.participants.every((entry) => entry.status === 'completed')).toBe(true);
    expect(reconcileSharedGatherPlan({
      plan: second.plan,
      sourceCurrent: true,
      nowGameHour: 172,
      now: NOW + 4,
      participantGoals: [],
    })).toEqual({ changed: false, plan: second.plan });
  });

  test('resource or body failure becomes one honest terminal and never rolls back completed facts', () => {
    const plan = acceptedPlan();
    const sourceRevision = sharedPlanSourceRevision(plan);
    const failed = reconcileSharedGatherPlan({
      plan,
      sourceCurrent: true,
      nowGameHour: 170,
      now: NOW + 2,
      participantGoals: [
        completed('han_li', sourceRevision),
        {
          ...active('lin_xiaoman', sourceRevision),
          status: 'failed',
          terminalReasonCode: 'resource_changed',
        },
      ],
    });
    expect(failed.plan).toMatchObject({ status: 'failed', terminalReasonCode: 'resource_changed' });
    expect(failed.plan.participants.find((entry) => entry.actorId === 'han_li')?.status).toBe('completed');
  });

  test('resource access revocation fails unfinished participants and preserves completed facts', () => {
    const plan = acceptedPlan();
    const completedPlan = reconcileSharedGatherPlan({
      plan,
      sourceCurrent: true,
      nowGameHour: 170,
      now: NOW + 2,
      participantGoals: [
        completed('han_li', sharedPlanSourceRevision(plan)),
        active('lin_xiaoman', sharedPlanSourceRevision(plan)),
      ],
    }).plan;
    const failed = reconcileSharedGatherPlan({
      plan: completedPlan,
      sourceCurrent: true,
      resourceFailureReasonCode: 'shared_plan_resource_access_revoked',
      nowGameHour: 171,
      now: NOW + 3,
      participantGoals: [],
    });
    expect(failed.plan).toMatchObject({
      status: 'failed',
      terminalReasonCode: 'shared_plan_resource_access_revoked',
    });
    expect(failed.plan.participants.map((entry) => [entry.actorId, entry.status])).toEqual([
      ['han_li', 'completed'],
      ['lin_xiaoman', 'failed'],
    ]);
    expect(reconcileSharedGatherPlan({
      plan: failed.plan,
      sourceCurrent: true,
      nowGameHour: 172,
      now: NOW + 4,
      participantGoals: [],
    })).toEqual({ changed: false, plan: failed.plan });
  });
});

function guardProposal(overrides: Partial<GuardHandoffProposalInput> = {}) {
  return buildSharedGuardHandoffPlanProposal({
    review: review(), reviewSource: SOURCE, latestOwnerSource: SOURCE,
    commitment: { commitmentId: 'duty-1', status: 'pending', donorActorId: 'han_li', recipientActorId: 'lin_xiaoman' },
    outgoing: { actorId: 'han_li', role: 'guard', dutyState: 'on_watch', aliveAndCapable: true, busy: false, homeZoneId: 'north-gate', currentLocationId: 'north-gate' },
    incoming: { actorId: 'lin_xiaoman', role: 'guard', dutyState: 'on_watch', aliveAndCapable: true, busy: false, homeZoneId: 'north-gate', currentLocationId: 'north-gate' },
    handoffLocation: { mapId: 'graybox', locationId: 'north-gate', exists: true, reachableByExistingTravelBody: true },
    nowGameHour: 168, now: NOW, ...overrides,
  });
}

describe('LWSE-3d P8 sharedPlans guard handoff owner lifecycle', () => {
  test('persists deterministic P7 facts as one proposed owner with no execution side effects', () => {
    const first = guardProposal();
    const second = guardProposal();
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan).toMatchObject({ kind: 'guard_handoff', status: 'proposed', providerCalls: 0, createdWorldActions: 0 });
    expect(first.plan.participants.map(({ actorId, role, status }) => [actorId, role, status])).toEqual([
      ['han_li', 'outgoing', 'accepted'], ['lin_xiaoman', 'incoming', 'invited'],
    ]);
    expect(isValidSharedGuardHandoffPlan(first.plan)).toBe(true);
  });

  test.each([
    ['daily', { review: review([SOURCE], 'daily') }],
    ['stale source', { latestOwnerSource: { ...SOURCE, sourceDigest: 'stable64:stale' } }],
    ['wrong location', { incoming: { actorId: 'lin_xiaoman', role: 'guard', dutyState: 'on_watch', aliveAndCapable: true, busy: false, homeZoneId: 'west-gate', currentLocationId: 'west-gate' } }],
  ])('fails closed for %s without an owner', (_name, overrides) => {
    expect(guardProposal(overrides as never).ok).toBe(false);
  });

  test('only the incoming guard can accept into scheduled, without goal, action, body, or event fields', () => {
    const built = guardProposal();
    if (!built.ok) throw new Error(built.reasonCode);
    expect(respondToSharedPlan({ plan: built.plan, actorId: 'han_li', expectedRevision: 1, response: 'accept', nowGameHour: 169, now: NOW + 1 }))
      .toEqual({ ok: false, reasonCode: 'shared_plan_response_forbidden' });
    const scheduled = respondToSharedPlan({ plan: built.plan, actorId: 'lin_xiaoman', expectedRevision: 1, response: 'accept', nowGameHour: 169, now: NOW + 1 });
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;
    expect(scheduled.plan).toMatchObject({ status: 'scheduled', revision: 2, providerCalls: 0, createdWorldActions: 0 });
    expect(scheduled.plan.participants.map((entry) => entry.status)).toEqual(['accepted', 'accepted']);
    expect(JSON.stringify(scheduled.plan)).not.toMatch(/personalGoal|actionRecord|actionExecution|terminalEvent|body/i);
  });

  test('decline is one terminal owner write and stale revision or source drift cannot schedule it', () => {
    const built = guardProposal();
    if (!built.ok) throw new Error(built.reasonCode);
    expect(respondToSharedPlan({ plan: built.plan, actorId: 'lin_xiaoman', expectedRevision: 2, response: 'accept', nowGameHour: 169, now: NOW + 1 }))
      .toEqual({ ok: false, reasonCode: 'shared_plan_revision_stale' });
    const stale = { ...built.plan, sourceDigest: 'stable64:drift' };
    expect(respondToSharedPlan({ plan: stale, actorId: 'lin_xiaoman', expectedRevision: 1, response: 'accept', nowGameHour: 169, now: NOW + 1 }))
      .toEqual({ ok: false, reasonCode: 'guard_handoff_affordance_missing' });
    const declined = respondToSharedPlan({ plan: built.plan, actorId: 'lin_xiaoman', expectedRevision: 1, response: 'decline', nowGameHour: 169, now: NOW + 1 });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.plan).toMatchObject({ status: 'declined', revision: 2, terminalReasonCode: 'shared_plan_declined' });
    expect(respondToSharedPlan({ plan: declined.plan, actorId: 'lin_xiaoman', expectedRevision: 2, response: 'decline', nowGameHour: 170, now: NOW + 2 }))
      .toEqual({ ok: false, reasonCode: 'shared_plan_not_pending' });
  });
});

function active(actorId: string, sourceRevision: string) {
  return {
    actorId,
    status: 'active' as const,
    sourceRef: `shared_plan:${acceptedPlan().planId}`,
    sourceRevision,
    intentDigest: 'stable64:intent',
    personalGoalId: `goal:${actorId}`,
    personalGoalRevision: 1,
  };
}

function completed(actorId: string, sourceRevision: string) {
  return {
    ...active(actorId, sourceRevision),
    status: 'completed' as const,
    actionType: 'gather',
    actionRecordId: `action:${actorId}`,
    actionExecutionId: `execution:${actorId}`,
    terminalEventId: `event:${actorId}`,
    resourceNodeId: 'dew_patch',
    itemId: 'spirit_herb',
    inventoryQuantity: 1,
  };
}
