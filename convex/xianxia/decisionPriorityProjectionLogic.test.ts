import type { AgentContext, AgentProposal } from './agentLogic';
import {
  decisionPriorityProjectionDigest,
  validateDecisionPriorityProjection,
} from './decisionPriorityContracts';
import {
  highestDecisionPriorityLane,
  projectDecisionCandidatePriority,
} from './decisionPriorityProjectionLogic';
import { buildGroupSocialCoordinationCandidates } from './groupSocialCoordinationLogic';
import { deriveGroupSocialOpportunities } from './groupSocialOpportunityLogic';
import { deriveRemoteSocialInvitationOpportunities } from './remoteSocialInvitationOpportunityLogic';

describe('C021g g1 typed decision-priority projection', () => {
  test('projects a server-verified accepted request proposal into L2', () => {
    const context = baseContext('priority:accepted-request');
    context.activeRequests = [{
      requestId: 'accepted-request', revision: 3, status: 'accepted',
      type: 'explore_location', locationId: 'quiet_retreat', summary: '查看静修处。',
    }];
    expect(projectDecisionCandidatePriority({
      context,
      candidateId: 'request-travel',
      planner: 'quest',
      proposal: {
        type: 'travel', targetId: 'quiet_retreat', source: 'agent',
        params: { requestId: 'accepted-request', expectedRevision: 3 },
        intent: '履行已经接受的委托。',
      },
    })).toMatchObject({
      priorityLane: 'L2_hard_obligation',
      causeKind: 'obligation',
      whyNowCode: 'accepted_obligation_active',
      sources: [{
        sourceRef: 'request:accepted-request',
        sourceRevision: 'request:accepted-request:rev:3',
      }],
    });
  });

  test('keeps a dawn duty meeting in L5 instead of upgrading every group candidate', () => {
    const actorId = 'priority:steward';
    const context = baseContext(actorId, 'steward');
    const opportunities = deriveGroupSocialOpportunities(groupInput(actorId, 6, false, 'steward'));
    const duty = opportunities.find((entry) => entry.sourceKind === 'duty_meeting');
    expect(duty).toBeDefined();
    const proposal = buildGroupSocialCoordinationCandidates({
      actorId,
      currentLocationId: 'herb_field',
      allowed: true,
      opportunities: duty ? [duty] : [],
      active: [],
      priorityProjectionV1: true,
    })[0]?.proposal;
    expect(proposal).toBeDefined();
    const projected = projectDecisionCandidatePriority({
      context,
      candidateId: 'duty-meeting',
      planner: 'group_coordination',
      proposal: proposal as AgentProposal,
    });
    expect(projected).toMatchObject({ priorityLane: 'L5_routine', causeKind: 'group_event' });
  });

});

function baseContext(actorId: string, role = 'outer_disciple'): AgentContext {
  return {
    lifeObservation: {
      observationRevision: `taixu.life_observation.v2:${actorId}:1`,
    } as AgentContext['lifeObservation'],
    purposeBoundLifeIntentV2: true,
    decisionPriorityProjectionV1: true,
    currentGameHour: 20,
    self: {
      actorId, name: actorId, role, realm: 'qi_refining', realmStage: 1,
      cultivationXp: 0, mood: 5, health: 10, maxHealth: 10, fatigue: 0,
      spirit: 5, reputation: 0, currentLocationId: 'herb_field', inventory: [],
    },
    others: [
      { actorId: `${actorId}:friend`, name: '同门', role: 'outer_disciple', realm: 'qi_refining', relationship: 40 },
      { actorId: `${actorId}:steward`, name: '执事', role: 'steward', realm: 'qi_refining', relationship: 20 },
    ],
    recentEvents: [],
    availableActions: ['gather', 'rest', 'talk', 'invite_social', 'group_talk'],
    knownLocations: [
      { locationId: 'herb_field', name: '药圃', allowedActions: ['gather', 'rest', 'talk', 'group_talk'], dangerLevel: 0 },
      { locationId: 'quiet_retreat', name: '静修处', allowedActions: ['talk', 'rest'], dangerLevel: 0 },
    ],
    purposeResourceNodes: [{
      resourceNodeId: `${actorId}:dew`, name: '朝露草', locationId: 'herb_field',
      itemId: 'spirit_herb', available: 1, sourceRevision: `${actorId}:dew:1`,
    }],
  };
}

function remoteObligation(actorId: string, revision: number) {
  return deriveRemoteSocialInvitationOpportunities({
    actorId,
    actorMapId: 'priority-map',
    actorLocationId: 'herb_field',
    actorAliveAndCapable: true,
    actorBusy: false,
    nowGameHour: 20,
    requests: [{
      requestId: `${actorId}:request`, revision, status: 'accepted' as const,
      issuerActorId: `${actorId}:elder`, issuerMapId: 'priority-map',
      issuerLocationId: 'quiet_retreat', issuerAliveAndCapable: true, issuerBusy: false,
      summary: '回报采药委托。',
    }],
  });
}

function groupInput(actorId: string, nowGameHour: number, withEvent = true, role = 'outer_disciple') {
  return {
    now: 1,
    nowGameHour,
    actorId,
    mapId: 'priority-map',
    locationId: 'herb_field',
    location: { allowedActions: ['group_talk', 'group_decide'], dangerLevel: 0, capacity: 8, occupiedCapacity: 0 },
    actors: [
      { actorId, role, mapId: 'priority-map', locationId: 'herb_field', aliveAndCapable: true, busy: false },
      { actorId: `${actorId}:friend`, role: 'outer_disciple', mapId: 'priority-map', locationId: 'herb_field', aliveAndCapable: true, busy: false },
      { actorId: `${actorId}:steward`, role: 'steward', mapId: 'priority-map', locationId: 'herb_field', aliveAndCapable: true, busy: false },
    ],
    requests: [],
    resources: [],
    events: withEvent ? [{
      eventId: `${actorId}:shared-loss`, eventType: 'resource_loss', createdAt: 0,
      visibility: 'witnessed' as const, actorIds: [actorId], targetActorIds: [`${actorId}:friend`],
      witnessActorIds: [`${actorId}:steward`], mapId: 'priority-map', locationId: 'herb_field',
    }] : [],
  };
}

function projectionFixture(id: string, priorityLane: 'L2_hard_obligation' | 'L4_meaningful_opportunity') {
  return {
    id,
    priorityProjection: validateDecisionPriorityProjection({
      contractVersion: 'taixu.candidate-priority-projection.v1', actorId: 'actor', candidateId: id,
      priorityLane, causeKind: priorityLane === 'L2_hard_obligation' ? 'obligation' : 'livelihood',
      sources: [{ sourceRef: `source:${id}`, sourceRevision: 'rev:1' }],
      whyNowCode: 'test', urgencyBand: 'normal', costOfDelay: 10,
      goalContinuity: 10, switchingCost: 10, expectedOutcomeCode: 'test',
    }),
  };
}
