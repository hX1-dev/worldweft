import {
  majorityQuorum,
  chooseRelationshipVote,
  chooseUntriedRecipient,
  resolveGroupVote,
  validateOwnedHerbProposal,
} from './groupDecisionLogic';

describe('C014b group proposal and quorum', () => {
  test('majority quorum is deterministic for 3..5 participants', () => {
    expect([3, 4, 5].map(majorityQuorum)).toEqual([2, 3, 3]);
  });

  test('proposal requires an owning participant and another participant recipient', () => {
    const base = {
      actorId: 'a', recipientActorId: 'b', participantActorIds: ['a', 'b', 'c'],
      observerActorIds: ['o'], availableHerbs: 1,
    };
    expect(validateOwnedHerbProposal(base)).toMatchObject({ ok: true, quorum: 2 });
    expect(validateOwnedHerbProposal({ ...base, actorId: 'o' })).toMatchObject({ ok: false, reasonCode: 'group_proposal_actor_ineligible' });
    expect(validateOwnedHerbProposal({ ...base, recipientActorId: 'a' })).toMatchObject({ ok: false, reasonCode: 'group_proposal_recipient_invalid' });
    expect(validateOwnedHerbProposal({ ...base, availableHerbs: 0 })).toMatchObject({ ok: false, reasonCode: 'group_proposal_resource_unavailable' });
  });

  test('approves at quorum and rejects when quorum becomes impossible', () => {
    const participants = ['a', 'b', 'c', 'd'];
    expect(resolveGroupVote({ participantActorIds: participants, voterActorId: 'c', choice: 'approve', priorVotes: [
      { actorId: 'a', choice: 'approve' }, { actorId: 'b', choice: 'approve' },
    ] })).toMatchObject({ ok: true, outcome: 'committed', approvals: 3 });
    expect(resolveGroupVote({ participantActorIds: participants, voterActorId: 'c', choice: 'abstain', priorVotes: [
      { actorId: 'a', choice: 'oppose' }, { actorId: 'b', choice: 'oppose' },
    ] })).toMatchObject({ ok: true, outcome: 'rejected', remaining: 1 });
  });

  test('observer and duplicate voter cannot create a write plan', () => {
    expect(resolveGroupVote({ participantActorIds: ['a', 'b', 'c'], voterActorId: 'o', choice: 'approve', priorVotes: [] }))
      .toMatchObject({ ok: false, reasonCode: 'group_proposal_actor_ineligible' });
    expect(resolveGroupVote({ participantActorIds: ['a', 'b', 'c'], voterActorId: 'a', choice: 'approve', priorVotes: [{ actorId: 'a', choice: 'oppose' }] }))
      .toMatchObject({ ok: false, reasonCode: 'group_vote_duplicate' });
  });

  test('derives a vote only from self-interest and the voter-to-recipient relationship', () => {
    expect(chooseRelationshipVote({ actorId: 'donor', donorActorId: 'donor', recipientActorId: 'r' })).toMatchObject({ choice: 'approve', basis: 'donor_interest' });
    expect(chooseRelationshipVote({ actorId: 'r', donorActorId: 'donor', recipientActorId: 'r', relationshipToRecipient: -100 })).toMatchObject({ choice: 'approve', basis: 'recipient_interest' });
    expect(chooseRelationshipVote({ actorId: 'a', donorActorId: 'donor', recipientActorId: 'r', relationshipToRecipient: 15 })).toMatchObject({ choice: 'approve', relationshipBand: 'supportive' });
    expect(chooseRelationshipVote({
      actorId: 'a', donorActorId: 'donor', recipientActorId: 'r',
      relationshipToRecipient: 0, trustToRecipient: 5, debtToRecipient: 5,
    })).toMatchObject({ choice: 'approve', basis: 'supports_recipient', relationshipBand: 'supportive' });
    expect(chooseRelationshipVote({
      actorId: 'a', donorActorId: 'donor', recipientActorId: 'r',
      relationshipToRecipient: 0, trustToRecipient: 5, debtToRecipient: 5, suspicionToRecipient: 20,
    })).toMatchObject({ choice: 'oppose', basis: 'distrusts_recipient', relationshipBand: 'distrustful' });
    expect(chooseRelationshipVote({
      actorId: 'a', donorActorId: 'donor', recipientActorId: 'r',
      relationshipToRecipient: 0, trustToRecipient: 5, debtToRecipient: 4,
    })).toMatchObject({ choice: 'abstain', relationshipBand: 'neutral' });
    expect(chooseRelationshipVote({ actorId: 'a', donorActorId: 'donor', recipientActorId: 'r', relationshipToRecipient: -15 })).toMatchObject({ choice: 'oppose', relationshipBand: 'distrustful' });
    expect(chooseRelationshipVote({ actorId: 'a', donorActorId: 'donor', recipientActorId: 'r', relationshipToRecipient: 14 })).toMatchObject({ choice: 'abstain' });
    expect(chooseRelationshipVote({ actorId: 'a', donorActorId: 'donor', recipientActorId: 'r', relationshipToRecipient: -14 })).toMatchObject({ choice: 'abstain' });
  });

  test('a single prior-harm relationship changes the pivotal trace even when both proposals reject', () => {
    const participants = ['donor', 'recipient', 'pivotal', 'other'];
    const fixedVotes = [
      { actorId: 'donor', choice: 'approve' as const },
      { actorId: 'recipient', choice: 'approve' as const },
    ];
    const neutral = chooseRelationshipVote({
      actorId: 'pivotal',
      donorActorId: 'donor',
      recipientActorId: 'recipient',
      relationshipToRecipient: 0,
    });
    const harmed = chooseRelationshipVote({
      actorId: 'pivotal',
      donorActorId: 'donor',
      recipientActorId: 'recipient',
      relationshipToRecipient: -18,
    });
    expect(neutral).toMatchObject({ choice: 'abstain', basis: 'neutral_to_recipient' });
    expect(harmed).toMatchObject({ choice: 'oppose', basis: 'distrusts_recipient' });
    for (const pivotal of [neutral, harmed]) {
      expect(resolveGroupVote({
        participantActorIds: participants,
        voterActorId: 'other',
        choice: 'abstain',
        priorVotes: [...fixedVotes, { actorId: 'pivotal', choice: pivotal.choice }],
      })).toMatchObject({ ok: true, outcome: 'rejected', approvals: 2 });
    }
  });

  test('mediation tries each participant recipient at most once in stable order', () => {
    expect(chooseUntriedRecipient({ donorActorId: 'd', participantActorIds: ['d', 'c', 'a', 'b'], attemptedRecipientActorIds: ['a'] })).toBe('b');
    expect(chooseUntriedRecipient({ donorActorId: 'd', participantActorIds: ['d', 'c', 'a', 'b'], attemptedRecipientActorIds: ['a', 'b', 'c'] })).toBeUndefined();
  });
});
