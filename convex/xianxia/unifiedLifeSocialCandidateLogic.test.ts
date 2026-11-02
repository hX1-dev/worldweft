import type { AgentContext, AgentProposal } from './agentLogic';
import {
  buildPiNpcEligibleCandidateBundle,
  revalidatePiNpcEligibleCandidate,
} from './autonomyDecisionTraceLogic';
import type { GroupSocialCoordinationCandidate } from './groupSocialCoordinationLogic';
import type { SocialInvitationCoordinationCandidate } from './socialInvitationCoordinationLogic';
import {
  UNIFIED_LIFE_SOCIAL_CANDIDATE_LIMIT,
  buildUnifiedLifeSocialCandidateBundle,
} from './unifiedLifeSocialCandidateLogic';

type Candidate = NonNullable<AgentContext['purposeBoundLifeCandidateBundle']>['candidates'][number];

function proposal(type: AgentProposal['type'], intent: string): AgentProposal {
  return { type, intent, source: 'agent' };
}

function purpose(candidateId: string, legacyOrder: number, type: AgentProposal['type'] = 'cultivate'): Candidate {
  return {
    planner: legacyOrder >= 500 ? 'social_warrant' : 'purpose',
    candidateId,
    legacyOrder,
    proposal: proposal(type, candidateId),
  };
}

function invitation(candidateId: string, intent = candidateId): SocialInvitationCoordinationCandidate {
  return {
    planner: 'social_coordination',
    candidateId,
    legacyOrder: 2,
    proposal: proposal('invite_social', intent),
  };
}

function group(candidateId: string, intent = candidateId): GroupSocialCoordinationCandidate {
  return {
    planner: 'group_coordination',
    candidateId,
    legacyOrder: 150,
    proposal: proposal('group_talk', intent),
  };
}

describe('C021f F2 unified life/social candidate composition', () => {
  test('is deterministic, deduplicated and bounded to the Pi limit', () => {
    const purposeCandidates = Array.from(
      { length: 12 },
      (_, index) => purpose(`life:${index}`, 300 + index * 10),
    );
    const first = buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world',
      purposeCandidates,
      invitationCandidates: [invitation('invite:remote')],
      groupCandidates: [group('group:shared')],
    });
    const replay = buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world',
      purposeCandidates: [...purposeCandidates].reverse(),
      invitationCandidates: [invitation('invite:remote')],
      groupCandidates: [group('group:shared')],
    });

    expect(first).toEqual(replay);
    expect(first.candidateSetDigest).toMatch(/^stable64:/);
    expect(first.candidates).toHaveLength(UNIFIED_LIFE_SOCIAL_CANDIDATE_LIMIT);
    expect(first.candidates.map((candidate) => candidate.candidateId)).toEqual(expect.arrayContaining([
      'invite:remote',
      'group:shared',
    ]));
  });

  test('reserves one routine social candidate without displacing a higher-priority life fact', () => {
    const first = buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world',
      purposeCandidates: [
        purpose('recovery', 0, 'rest'),
        ...Array.from({ length: 11 }, (_, index) => purpose(`life:${index}`, 600 + index * 10)),
        purpose('relationship:maintenance', 500, 'talk'),
      ],
      invitationCandidates: [],
      groupCandidates: [],
    });

    expect(first.candidates).toHaveLength(UNIFIED_LIFE_SOCIAL_CANDIDATE_LIMIT);
    expect(first.candidates.map((candidate) => candidate.candidateId)).toEqual(expect.arrayContaining([
      'recovery',
      'relationship:maintenance',
    ]));
    expect(first.candidates.map((candidate) => candidate.candidateId)).not.toContain('life:10');
  });

  test('deduplicates the same protocol proposal but rejects a candidate-id collision', () => {
    const duplicateProposal = group('group:first', 'same-proposal');
    const deduped = buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world',
      purposeCandidates: [],
      invitationCandidates: [],
      groupCandidates: [duplicateProposal, group('group:second', 'same-proposal')],
    });
    expect(deduped.candidates.map((candidate) => candidate.candidateId)).toEqual(['group:first']);

    expect(() => buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world',
      purposeCandidates: [purpose('collision', 300, 'cultivate')],
      invitationCandidates: [{
        ...invitation('collision'),
        proposal: proposal('invite_social', 'different-proposal'),
      }],
      groupCandidates: [],
    })).toThrow('unified_life_social_candidate_id_collision');
  });

  test('Pi observes one merged surface and rejects a removed coordination candidate on fresh facts', () => {
    const merged = buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world',
      purposeCandidates: [purpose('direct:care', 0, 'talk')],
      invitationCandidates: [invitation('invite:remote')],
      groupCandidates: [group('group:shared')],
    });
    const context = piContext(merged.candidates);
    const before = buildPiNpcEligibleCandidateBundle(context, 1);
    expect(before.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ planner: 'purpose', intentKind: 'talk' }),
      expect.objectContaining({ planner: 'social_coordination', intentKind: 'invite_social' }),
      expect.objectContaining({ planner: 'group_coordination', intentKind: 'group_talk' }),
    ]));
    const selected = before.options.find(
      (option) => option.proposal.type === 'invite_social',
    );
    if (!selected) throw new Error('unified_test_invitation_missing');

    const fresh = piContext(buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:world:revised',
      purposeCandidates: [purpose('direct:care', 0, 'talk')],
      invitationCandidates: [],
      groupCandidates: [group('group:shared')],
    }).candidates);
    expect(revalidatePiNpcEligibleCandidate({
      actorId: 'actor:a',
      candidateId: selected.candidate.candidateId,
      proposalFingerprint: selected.proposalFingerprint,
      freshContext: fresh,
      now: 2,
    })).toMatchObject({ ok: false, reasonCode: 'stale_or_invalid_candidate' });
  });
});

function piContext(candidates: Candidate[]): AgentContext {
  return {
    lifeObservation: { observationRevision: 'stable64:observation' } as AgentContext['lifeObservation'],
    purposeBoundLifeIntentV2: true,
    self: {
      actorId: 'actor:a',
      name: '甲',
      role: 'outer_disciple',
      realm: 'qi_refining',
      realmStage: 1,
      cultivationXp: 0,
      mood: 5,
      health: 10,
      maxHealth: 10,
      fatigue: 0,
      spirit: 5,
      reputation: 0,
      currentLocationId: 'meeting_hall',
      inventory: [],
    },
    others: [],
    recentEvents: [],
    availableActions: ['talk', 'invite_social', 'group_talk'],
    knownLocations: [],
    purposeBoundLifeCandidateBundle: {
      purposeFactsDigest: 'stable64:merged',
      candidates,
    },
  };
}
