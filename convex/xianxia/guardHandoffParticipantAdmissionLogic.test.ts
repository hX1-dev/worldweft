import { buildLifeSocialReview, type LifeSocialReviewSource } from './lifeSocialReviewLogic';
import { buildGuardHandoffProposal, scheduleGuardHandoffPlan } from './guardHandoffLogic';
import {
  withGuardHandoffAuthorityReceiptDigest,
  type GuardHandoffParticipantAuthorityReceipt,
} from './guardHandoffParticipantAdmissionContracts';
import { admitGuardHandoffParticipant } from './guardHandoffParticipantAdmissionLogic';

const NOW = 1_000_000;
const SOURCE: LifeSocialReviewSource = {
  kind: 'group_duty_open', sourceRef: 'group-commitment:duty-1',
  sourceRevision: 'commitment:pending:900000', sourceDigest: 'stable64:source',
  occurredGameHour: 50, visibility: 'participants', subjectActorIds: ['han_li', 'lin_xiaoman'],
};

function scheduledPlan() {
  const review = buildLifeSocialReview({
    actorId: 'han_li', actorCreatedGameHour: 0,
    window: { windowId: 'life-rhythm:weekly:1', windowDigest: 'stable64:window', cadence: 'weekly', periodIndex: 1, windowStartGameHour: 0, windowEndGameHour: 168 },
    sources: [SOURCE],
  });
  const built = buildGuardHandoffProposal({
    review, reviewSource: SOURCE, latestOwnerSource: SOURCE,
    commitment: { commitmentId: 'duty-1', status: 'pending', donorActorId: 'han_li', recipientActorId: 'lin_xiaoman' },
    outgoing: actor('han_li'), incoming: actor('lin_xiaoman'),
    handoffLocation: { mapId: 'graybox', locationId: 'north-gate', exists: true, reachableByExistingTravelBody: true }, now: NOW,
  });
  if (!built.ok) throw new Error(built.reasonCode);
  const scheduled = scheduleGuardHandoffPlan({ plan: built.plan, now: NOW + 1 });
  if (!scheduled.ok) throw new Error(scheduled.reasonCode);
  return scheduled.plan;
}

function actor(actorId: string) {
  return { actorId, role: 'guard', dutyState: 'on_watch', aliveAndCapable: true, busy: false, homeZoneId: 'north-gate', currentLocationId: 'north-gate' };
}

function receipt(plan = scheduledPlan(), actorId = 'han_li'): GuardHandoffParticipantAuthorityReceipt {
  const participant = plan.participants.find((entry) => entry.actorId === actorId);
  if (!participant || !plan.scheduleDigest) throw new Error('fixture_invalid');
  const fact = { sourceRef: 'future-authority:fixture', sourceRevision: 'v1', sourceDigest: 'stable64:future-authority' };
  return withGuardHandoffAuthorityReceiptDigest({
    contractVersion: 'taixu.guard-handoff-participant-authority.v1', receiptKind: 'guard_duty_home_authority',
    planId: plan.planId, planRevision: plan.revision, scheduleDigest: plan.scheduleDigest,
    handoffFactsDigest: plan.handoffFactsDigest, participantActorId: actorId, participantRole: participant.role,
    role: 'guard', homeZoneId: 'north-gate', dutyState: 'on_watch', mapId: 'graybox', currentLocationId: 'north-gate',
    aliveAndCapable: true, busy: false, roleFact: fact, homeZoneFact: fact, dutyFact: fact, locationFact: fact, capabilityFact: fact,
  });
}

describe('LWSE-3d P9a guard handoff participant admission', () => {
  test('requires an independently bound authority receipt and is deterministic when one exists', () => {
    const plan = scheduledPlan();
    expect(admitGuardHandoffParticipant({ plan, participantActorId: 'han_li' }))
      .toEqual({ ok: false, reasonCode: 'guard_handoff_authority_receipt_missing' });
    const input = { plan, participantActorId: 'han_li', authorityReceipt: receipt(plan) };
    const first = admitGuardHandoffParticipant(input);
    const second = admitGuardHandoffParticipant(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, admission: { participantActorId: 'han_li', participantRole: 'outgoing' } });
  });

  test.each([
    ['wrong actor', (plan: ReturnType<typeof scheduledPlan>) => ({ ...receipt(plan), participantActorId: 'lin_xiaoman' })],
    ['wrong home', (plan: ReturnType<typeof scheduledPlan>) => ({ ...receipt(plan), homeZoneId: 'west-gate' })],
    ['wrong duty', (plan: ReturnType<typeof scheduledPlan>) => ({ ...receipt(plan), dutyState: 'resting' })],
    ['busy', (plan: ReturnType<typeof scheduledPlan>) => ({ ...receipt(plan), busy: true })],
  ])('fails closed for %s authority drift', (_name, mutate) => {
    const plan = scheduledPlan();
    const raw = mutate(plan);
    const stale = withGuardHandoffAuthorityReceiptDigest(
      withoutDigest(raw as GuardHandoffParticipantAuthorityReceipt),
    );
    expect(admitGuardHandoffParticipant({ plan, participantActorId: 'han_li', authorityReceipt: stale }).ok).toBe(false);
  });

  test('rejects stale plan bindings and unknown participants without a world consequence', () => {
    const plan = scheduledPlan();
    const base = receipt(plan);
    const stale = withGuardHandoffAuthorityReceiptDigest({ ...withoutDigest(base), planRevision: base.planRevision + 1 });
    expect(admitGuardHandoffParticipant({ plan, participantActorId: 'han_li', authorityReceipt: stale }))
      .toEqual({ ok: false, reasonCode: 'guard_handoff_authority_stale' });
    expect(admitGuardHandoffParticipant({ plan, participantActorId: 'unknown', authorityReceipt: base }))
      .toEqual({ ok: false, reasonCode: 'guard_handoff_participant_missing' });
  });
});

function withoutDigest(receipt: GuardHandoffParticipantAuthorityReceipt) {
  const { receiptDigest: _receiptDigest, ...semantic } = receipt;
  return semantic;
}
