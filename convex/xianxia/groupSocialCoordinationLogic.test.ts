import {
  buildGroupSocialCoordinationCandidates,
  buildGroupSocialCoordinationProposals,
} from './groupSocialCoordinationLogic';
import { createGroupSocialInitiationReceipt } from './groupSocialInitiationContracts';
import { deriveGroupSocialOpportunities } from './groupSocialOpportunityLogic';
import { buildPiNpcEligibleCandidateBundle } from './autonomyDecisionTraceLogic';
import type { AgentContext } from './agentLogic';
import { buildUnifiedLifeSocialCandidateBundle } from './unifiedLifeSocialCandidateLogic';

function opportunity() {
  const [value] = deriveGroupSocialOpportunities({
    now: 1_000,
    nowGameHour: 30,
    actorId: 'steward',
    mapId: 'world',
    locationId: 'hall',
    location: {
      allowedActions: ['group_talk', 'group_decide'], dangerLevel: 0, capacity: 8, occupiedCapacity: 0,
    },
    actors: [
      { actorId: 'steward', role: 'steward', mapId: 'world', locationId: 'hall', aliveAndCapable: true, busy: false },
      { actorId: 'disciple', role: 'outer_disciple', mapId: 'world', locationId: 'hall', aliveAndCapable: true, busy: false },
      { actorId: 'merchant', role: 'merchant', mapId: 'world', locationId: 'hall', aliveAndCapable: true, busy: false },
    ],
    requests: [{
      requestId: 'r1', revision: 1, status: 'accepted', type: 'collect_item',
      issuerActorId: 'steward', assigneeActorId: 'disciple', itemId: 'spirit_herb',
    }],
    events: [], resources: [],
  });
  return value;
}

describe('C021b0d provider0 group coordination proposals', () => {
  test('fresh source offers invite without exposing actor selection', () => {
    const value = opportunity();
    const proposals = buildGroupSocialCoordinationProposals({
      actorId: 'steward', currentLocationId: 'hall', allowed: true, opportunities: [value], active: [],
    });
    expect(proposals).toEqual([expect.objectContaining({
      type: 'group_talk',
      params: expect.objectContaining({
        operation: 'invite',
        candidateId: value.candidate.candidateId,
        warrantId: value.warrant.warrantId,
        socialOpportunityCandidateId: value.candidate.candidateId,
      }),
    })]);
    expect(proposals[0].params).not.toHaveProperty('participantActorIds');
  });

  test('pending invitee gets accept/decline while ready host gets only start', () => {
    const value = opportunity();
    const created = createGroupSocialInitiationReceipt({ opportunity: value, meetingMapId: 'world', now: 1_000 });
    const pending = buildGroupSocialCoordinationProposals({
      actorId: 'disciple', currentLocationId: 'hall', allowed: true, opportunities: [],
      active: [{ receipt: created.receipt, members: created.members, canRespond: true, canStart: false }],
    });
    expect(pending.map((proposal) => proposal.params?.response)).toEqual(['accept', 'decline']);

    const readyReceipt = { ...created.receipt, revision: 3, status: 'ready' as const };
    const readyMembers = created.members.map((member) => ({ ...member, response: 'accepted' as const }));
    const ready = buildGroupSocialCoordinationProposals({
      actorId: 'steward', currentLocationId: 'hall', allowed: true, opportunities: [],
      active: [{ receipt: readyReceipt, members: readyMembers, canRespond: false, canStart: true }],
    });
    expect(ready).toEqual([expect.objectContaining({
      params: expect.objectContaining({
        operation: 'start', initiationId: readyReceipt.initiationId, expectedRevision: 3,
        socialOpportunityCandidateId: readyReceipt.candidateId,
      }),
    })]);
  });

  test('blocked runtime and missing role permission generate no action', () => {
    const value = opportunity();
    expect(buildGroupSocialCoordinationProposals({
      actorId: 'steward', currentLocationId: 'hall', allowed: false, opportunities: [value], active: [],
    })).toEqual([]);
    const created = createGroupSocialInitiationReceipt({ opportunity: value, meetingMapId: 'world', now: 1_000 });
    expect(buildGroupSocialCoordinationProposals({
      actorId: 'disciple', currentLocationId: 'hall', allowed: true, opportunities: [],
      active: [{
        receipt: created.receipt, members: created.members, canRespond: false, canStart: false,
        blockedReasonCode: 'group_social_participant_moved',
      }],
    })).toEqual([]);
  });

  test('provider0/Pi candidate bundle exposes the server-built group intent', () => {
    const value = opportunity();
    const input = {
      actorId: 'steward', currentLocationId: 'hall', allowed: true, opportunities: [value], active: [],
    };
    const proposals = buildGroupSocialCoordinationProposals(input);
    const unified = buildUnifiedLifeSocialCandidateBundle({
      purposeFactsDigest: 'stable64:group-fixture',
      purposeCandidates: [],
      invitationCandidates: [],
      groupCandidates: buildGroupSocialCoordinationCandidates(input),
    });
    const context: AgentContext = {
      lifeObservation: { observationRevision: 'taixu.life-observation.v1:group-fixture' } as AgentContext['lifeObservation'],
      purposeBoundLifeIntentV2: true,
      self: {
        actorId: 'steward', name: '执事', role: 'steward', realm: 'qi_refining', realmStage: 1,
        cultivationXp: 0, mood: 0, health: 10, maxHealth: 10, fatigue: 0, spirit: 0,
        reputation: 0, currentLocationId: 'hall', inventory: [],
      },
      currentLocationName: '议事堂', others: [], recentEvents: [],
      availableActions: ['group_talk', 'group_decide'], knownLocations: [],
      groupSocialCoordinationProposals: proposals,
      purposeBoundLifeCandidateBundle: {
        purposeFactsDigest: unified.purposeFactsDigest,
        candidateSetDigest: unified.candidateSetDigest,
        candidates: unified.candidates,
      },
    };
    const bundle = buildPiNpcEligibleCandidateBundle(context, 1_000);
    const groupOptions = bundle.options.filter((option) => option.proposal.type === 'group_talk');
    expect(groupOptions).toEqual([
      expect.objectContaining({ proposal: expect.objectContaining({
        type: 'group_talk', params: expect.objectContaining({ operation: 'invite' }),
      }) }),
    ]);
    expect(groupOptions).toHaveLength(1);
  });

  test('accept and decline remain two distinct bounded candidates', () => {
    const value = opportunity();
    const created = createGroupSocialInitiationReceipt({ opportunity: value, meetingMapId: 'world', now: 1_000 });
    const proposals = buildGroupSocialCoordinationProposals({
      actorId: 'disciple', currentLocationId: 'hall', allowed: true, opportunities: [],
      active: [{ receipt: created.receipt, members: created.members, canRespond: true, canStart: false }],
    });
    const context: AgentContext = {
      lifeObservation: { observationRevision: 'taixu.life-observation.v1:consent-fixture' } as AgentContext['lifeObservation'],
      self: {
        actorId: 'disciple', name: '弟子', role: 'outer_disciple', realm: 'qi_refining', realmStage: 1,
        cultivationXp: 0, mood: 0, health: 10, maxHealth: 10, fatigue: 0, spirit: 0,
        reputation: 0, currentLocationId: 'hall', inventory: [],
      },
      others: [], recentEvents: [], availableActions: ['group_talk', 'group_decide'], knownLocations: [],
      groupSocialCoordinationProposals: proposals,
    };
    const responses = buildPiNpcEligibleCandidateBundle(context, 1_000).options
      .map((option) => option.proposal.params?.response)
      .filter(Boolean)
      .sort();
    expect(responses).toEqual(['accept', 'decline']);
  });
});
