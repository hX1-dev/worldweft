import type { AgentProposal } from './agentLogic';
import { buildGroupSocialCoordinationProposals } from './groupSocialCoordinationLogic';
import {
  deriveGroupSocialOpportunities,
  type GroupSocialActorFact,
  type GroupSocialEventFact,
  type GroupSocialOpportunity,
  type GroupSocialRequestFact,
  type GroupSocialResourceFact,
} from './groupSocialOpportunityLogic';
import {
  deriveRemoteSocialInvitationOpportunities,
  type RemoteSocialInvitationOpportunity,
} from './remoteSocialInvitationOpportunityLogic';
import {
  deriveSameLocationSocialSources,
  type SameLocationSocialDerivationInput,
  type SameLocationSocialSource,
} from './sameLocationSocialOpportunityLogic';

export const PURPOSE_BOUND_LIFE_SOCIAL_PROJECTION_VERSION =
  'taixu.purpose-bound-life-social-projection.v1' as const;

export type PurposeBoundLifeSocialProjectionInput = {
  now: number;
  nowGameHour: number;
  currentGameDay: number;
  mapId: string;
  actor: SameLocationSocialDerivationInput['actor'] & {
    aliveAndCapable: boolean;
    busy: boolean;
  };
  targets: SameLocationSocialDerivationInput['targets'];
  requests: SameLocationSocialDerivationInput['requests'];
  remoteRequests: Parameters<typeof deriveRemoteSocialInvitationOpportunities>[0]['requests'];
  beliefs: SameLocationSocialDerivationInput['beliefs'];
  memories: SameLocationSocialDerivationInput['memories'];
  maintenanceMinRelationship?: number;
  maintenanceDebtDays?: number;
  maintenanceGiftMinRelationship?: number;
  maintenanceDebtDaysByRelationship?: SameLocationSocialDerivationInput['maintenanceDebtDaysByRelationship'];
  group: {
    location?: Parameters<typeof deriveGroupSocialOpportunities>[0]['location'];
    actors: GroupSocialActorFact[];
    requests: GroupSocialRequestFact[];
    events: GroupSocialEventFact[];
    resources: GroupSocialResourceFact[];
    activeSourceRevisions?: string[];
    coordinationAllowed: boolean;
  };
  activeInvitationWarrantIds?: string[];
  disclosureDeniedSourceRefs?: string[];
};

export type PurposeBoundLifeSocialProjection = {
  contractVersion: typeof PURPOSE_BOUND_LIFE_SOCIAL_PROJECTION_VERSION;
  sameLocationSources: SameLocationSocialSource[];
  remoteInvitationOpportunities: RemoteSocialInvitationOpportunity[];
  groupOpportunities: GroupSocialOpportunity[];
  groupCoordinationProposals: AgentProposal[];
};

/**
 * Pure host projection from bounded world facts into the already-frozen social
 * builders. It creates neither an action nor a social result, and it never
 * invents a target that was absent from the input snapshot.
 */
export function projectPurposeBoundLifeSocialFacts(
  input: PurposeBoundLifeSocialProjectionInput,
): PurposeBoundLifeSocialProjection {
  const denied = new Set(input.disclosureDeniedSourceRefs ?? []);
  const sameLocationSources = deriveSameLocationSocialSources({
    nowGameHour: input.nowGameHour,
    currentGameDay: input.currentGameDay,
    actor: input.actor,
    targets: input.targets,
    requests: input.requests,
    beliefs: input.beliefs,
    memories: input.memories,
    maintenanceMinRelationship: input.maintenanceMinRelationship,
    maintenanceDebtDays: input.maintenanceDebtDays,
    maintenanceGiftMinRelationship: input.maintenanceGiftMinRelationship,
    maintenanceDebtDaysByRelationship: input.maintenanceDebtDaysByRelationship,
  }).map((source) => ({
    ...source,
    disclosureAllowed:
      source.disclosureAllowed && !denied.has(source.sourceRef),
  }));
  const remoteInvitationOpportunities = deriveRemoteSocialInvitationOpportunities({
    actorId: input.actor.actorId,
    actorMapId: input.mapId,
    actorLocationId: input.actor.locationId,
    actorAliveAndCapable: input.actor.aliveAndCapable,
    actorBusy: input.actor.busy,
    nowGameHour: input.nowGameHour,
    activeInvitationWarrantIds: input.activeInvitationWarrantIds,
    requests: input.remoteRequests,
  });
  const groupOpportunities = deriveGroupSocialOpportunities({
    now: input.now,
    nowGameHour: input.nowGameHour,
    actorId: input.actor.actorId,
    mapId: input.mapId,
    locationId: input.actor.locationId,
    location: input.group.location,
    actors: input.group.actors,
    requests: input.group.requests,
    events: input.group.events,
    resources: input.group.resources,
    activeSourceRevisions: input.group.activeSourceRevisions,
  });
  return {
    contractVersion: PURPOSE_BOUND_LIFE_SOCIAL_PROJECTION_VERSION,
    sameLocationSources,
    remoteInvitationOpportunities,
    groupOpportunities,
    groupCoordinationProposals: buildGroupSocialCoordinationProposals({
      actorId: input.actor.actorId,
      currentLocationId: input.actor.locationId,
      allowed: input.group.coordinationAllowed,
      opportunities: groupOpportunities,
      active: [],
    }),
  };
}
