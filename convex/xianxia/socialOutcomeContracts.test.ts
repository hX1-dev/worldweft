import {
  createSocialOutcomeReceipt,
  prepareSocialOutcomeBinding,
  resolveSocialOutcome,
  socialOutcomeScopeBlocked,
  transitionSocialOutcomeReceipt,
} from './socialOutcomeContracts';
import {
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
  type SocialOpportunityCandidate,
  type SocialWarrant,
  type SocialWarrantOutcome,
} from './socialWarrantContracts';

const outcomeKinds: Record<SocialWarrantOutcome, SocialWarrant['kind']> = {
  request_aid: 'care_or_aid',
  respond_to_request: 'active_obligation',
  trade_or_coordinate: 'resource_coordination',
  ask_or_verify: 'knowledge_gap',
  teach_or_advise: 'teaching_or_advice',
  maintain_bond: 'relationship_maintenance',
  thank_apologize_or_repair: 'gratitude_or_repair',
  mediate_or_negotiate: 'conflict_resolution',
  join_shared_activity: 'shared_activity',
  reach_group_decision: 'collective_event',
};

function warrant(outcome: SocialWarrantOutcome = 'request_aid'): SocialWarrant {
  const group = outcome === 'reach_group_decision' || outcome === 'join_shared_activity';
  return {
    contractVersion: 'taixu.social-warrant.v1',
    warrantId: `warrant:${outcome}`,
    actorId: 'actor_a',
    kind: outcomeKinds[outcome],
    sourceRef: `source:${outcome}`,
    sourceRevision: 'rev:1',
    intendedOutcome: outcome,
    eligibleTargetActorIds: group ? ['actor_b', 'actor_c'] : ['actor_b'],
    topicRefs: [`topic:${outcome}`],
    audience: group ? 'participants' : 'private',
    urgencyBand: 'routine',
    createdAt: 10,
    expiresAt: 20,
  };
}

function candidate(outcome: SocialWarrantOutcome = 'request_aid'): SocialOpportunityCandidate {
  const group = outcome === 'reach_group_decision' || outcome === 'join_shared_activity';
  const activity = group
    ? 'group_decide'
    : outcome === 'ask_or_verify' || outcome === 'teach_or_advise'
      ? 'teach'
      : outcome === 'trade_or_coordinate' || outcome === 'mediate_or_negotiate'
        ? 'negotiate'
        : outcome === 'thank_apologize_or_repair'
          ? 'gift'
          : 'talk';
  return {
    contractVersion: 'taixu.social-opportunity-candidate.v1',
    candidateId: `candidate:${outcome}`,
    warrantId: `warrant:${outcome}`,
    mode: group ? 'start_group_conversation' : 'start_direct_conversation',
    targetActorIds: group ? ['actor_b', 'actor_c'] : ['actor_b'],
    meetingLocationId: group ? 'location:hall' : undefined,
    intendedActivity: activity,
    summary: outcome,
  };
}

function binding(outcome: SocialWarrantOutcome = 'request_aid') {
  const w = warrant(outcome);
  const c = candidate(outcome);
  const actionType = c.intendedActivity === 'teach'
    ? 'request_teaching'
    : c.intendedActivity === 'group_decide'
      ? 'group_talk'
      : c.intendedActivity;
  const result = prepareSocialOutcomeBinding({
    actorId: 'actor_a',
    targetActorIds: c.targetActorIds,
    actionType,
    warrant: w,
    candidate: c,
    warrantDigest: socialWarrantDigest(w),
    candidateDigest: socialOpportunityCandidateDigest(c),
    warrantCandidateDigest: socialWarrantCandidateDigest(w, c),
  });
  if (!result.ok) throw new Error(result.reasonCode);
  return result.binding;
}

describe('C021b0e social outcome contracts', () => {
  test('binds canonical warrant/candidate/action and rejects every swapped fence', () => {
    const w = warrant();
    const c = candidate();
    const valid = prepareSocialOutcomeBinding({
      actorId: 'actor_a', targetActorIds: ['actor_b'], actionType: 'talk', warrant: w, candidate: c,
      warrantDigest: socialWarrantDigest(w), candidateDigest: socialOpportunityCandidateDigest(c),
      warrantCandidateDigest: socialWarrantCandidateDigest(w, c),
    });
    expect(valid).toMatchObject({ ok: true, binding: { intendedOutcome: 'request_aid', activity: 'talk' } });
    for (const changed of [
      { actorId: 'other' },
      { targetActorIds: ['other'] },
      { actionType: 'gift' },
      { warrantDigest: 'bad' },
      { candidateDigest: 'bad' },
      { warrantCandidateDigest: 'bad' },
    ]) {
      expect(prepareSocialOutcomeBinding({
        actorId: 'actor_a', targetActorIds: ['actor_b'], actionType: 'talk', warrant: w, candidate: c,
        warrantDigest: socialWarrantDigest(w), candidateDigest: socialOpportunityCandidateDigest(c),
        warrantCandidateDigest: socialWarrantCandidateDigest(w, c), ...changed,
      })).toEqual({ ok: false, reasonCode: 'social_outcome_binding_invalid' });
    }
  });

  test.each([
    ['request_aid', { resultCode: 'conversation_ended', conversationStatus: 'resolved', speech: [
      { speakerActorId: 'actor_a', speechAct: 'request' }, { speakerActorId: 'actor_b', speechAct: 'respond' },
    ] }],
    ['respond_to_request', { resultCode: 'request_completed' }],
    ['trade_or_coordinate', { resultCode: 'negotiation_settled' }],
    ['ask_or_verify', { resultCode: 'conversation_ended', conversationStatus: 'resolved', knowledgeDeliveryCount: 1, speech: [
      { speakerActorId: 'actor_b', speechAct: 'clarify', referencedFactIds: ['event:1'] },
    ] }],
    ['teach_or_advise', { resultCode: 'teaching_granted' }],
    ['maintain_bond', { resultCode: 'conversation_ended', conversationStatus: 'resolved', speech: [
      { speakerActorId: 'actor_a', speechAct: 'request' }, { speakerActorId: 'actor_b', speechAct: 'respond' },
    ] }],
    ['thank_apologize_or_repair', { resultCode: 'gift_accepted' }],
    ['mediate_or_negotiate', { resultCode: 'negotiation_settled' }],
    ['join_shared_activity', { resultCode: 'group_conversation_ended', groupConversationStatus: 'resolved', participantTurnCount: 3 }],
    ['reach_group_decision', { resultCode: 'group_commitment_fulfilled', commitmentStatus: 'fulfilled' }],
  ] as const)('resolves the real terminal policy for %s', (outcome, evidence) => {
    expect(resolveSocialOutcome(binding(outcome), evidence).status).toBe('resolved');
  });

  test('paired knowledge, repair and group counterfactuals cannot turn talk/open/pending into success', () => {
    for (const outcome of Object.keys(outcomeKinds) as SocialWarrantOutcome[]) {
      const group = outcome === 'join_shared_activity' || outcome === 'reach_group_decision';
      expect(resolveSocialOutcome(binding(outcome), {
        resultCode: group ? 'group_conversation_started' : 'conversation_started',
        conversationStatus: group ? undefined : 'active',
        groupConversationStatus: group ? 'active' : undefined,
      }).status).toBe('pending');
    }
    expect(resolveSocialOutcome(binding('ask_or_verify'), {
      resultCode: 'conversation_ended', conversationStatus: 'resolved', knowledgeDeliveryCount: 0,
      speech: [{ speakerActorId: 'actor_b', speechAct: 'inform' }],
    })).toEqual({ status: 'failed', reasonCode: 'social_outcome_knowledge_unproven' });
    expect(resolveSocialOutcome(binding('thank_apologize_or_repair'), {
      resultCode: 'conversation_ended', conversationStatus: 'resolved',
      speech: [{ speakerActorId: 'actor_a', speechAct: 'request' }, { speakerActorId: 'actor_b', speechAct: 'refuse' }],
    }).status).toBe('failed');
    expect(resolveSocialOutcome(binding('reach_group_decision'), {
      resultCode: 'group_proposal_committed', commitmentStatus: 'pending', groupConversationStatus: 'active',
    }).status).toBe('pending');
    expect(resolveSocialOutcome(binding('reach_group_decision'), {
      resultCode: 'group_commitment_breached', commitmentStatus: 'breached',
    }).status).toBe('failed');
  });

  test('terminal transition is once-only, conflict-safe and sets semantic cooldown', () => {
    const receipt = createSocialOutcomeReceipt({
      binding: binding('request_aid'), openedByActionId: 'action:1', openedEventId: 'event:1',
      createdGameHour: 10, conversationId: 'conversation:1',
    });
    const input = {
      receipt,
      evidence: { resultCode: 'conversation_ended', conversationStatus: 'resolved', speech: [
        { speakerActorId: 'actor_a', speechAct: 'request' },
      ] },
      terminalActionId: 'action:2', terminalEventId: 'event:2', terminalGameHour: 12,
    } as const;
    const first = transitionSocialOutcomeReceipt(input);
    expect(first).toMatchObject({ ok: true, replay: false, receipt: { status: 'resolved', cooldownUntilGameHour: 180 } });
    if (!first.ok) throw new Error(first.reasonCode);
    expect(transitionSocialOutcomeReceipt({ ...input, receipt: first.receipt })).toMatchObject({ ok: true, replay: true });
    expect(transitionSocialOutcomeReceipt({
      ...input, receipt: first.receipt, terminalEventId: 'event:other',
    })).toEqual({ ok: false, reasonCode: 'social_outcome_terminal_conflict' });
    expect(socialOutcomeScopeBlocked(first.receipt, 179)).toBe(true);
    expect(socialOutcomeScopeBlocked(first.receipt, 180)).toBe(false);
  });
});
