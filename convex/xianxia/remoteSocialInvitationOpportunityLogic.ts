import { stableObservationDigest } from './lifeObservation';
import {
  SOCIAL_WARRANT_VERSION,
  socialWarrantDigest,
  validateSocialWarrant,
  type SocialWarrant,
} from './socialWarrantContracts';

export const REMOTE_SOCIAL_INVITATION_SOURCE_VERSION =
  'taixu.remote-social-invitation-source.v1' as const;
export const REMOTE_SOCIAL_INVITATION_LIMIT = 3 as const;

export type RemoteSocialInvitationOpportunity = {
  contractVersion: typeof REMOTE_SOCIAL_INVITATION_SOURCE_VERSION;
  targetActorId: string;
  targetLocationId: string;
  warrant: SocialWarrant;
  warrantDigest: string;
  candidateId: string;
  intendedActivity: 'talk';
  summary: string;
};

export type RemoteSocialInvitationInput = {
  actorId: string;
  actorMapId: string;
  actorLocationId?: string;
  actorAliveAndCapable: boolean;
  actorBusy: boolean;
  nowGameHour: number;
  activeInvitationWarrantIds?: string[];
  requests: Array<{
    requestId: string;
    revision: number;
    status: 'offered' | 'accepted' | 'ready_to_turn_in';
    issuerActorId: string;
    issuerMapId?: string;
    issuerLocationId?: string;
    issuerAliveAndCapable: boolean;
    issuerBusy: boolean;
    summary: string;
  }>;
};

/**
 * Derive only cross-location, request-bound invitations. Proximity, a bare
 * relationship score, or an elapsed cooldown can never create an entry here.
 */
export function deriveRemoteSocialInvitationOpportunities(
  input: RemoteSocialInvitationInput,
): RemoteSocialInvitationOpportunity[] {
  if (
    !input.actorAliveAndCapable ||
    input.actorBusy ||
    !input.actorLocationId ||
    !Number.isSafeInteger(input.nowGameHour) ||
    input.nowGameHour < 0
  ) {
    return [];
  }
  const activeWarrants = new Set(input.activeInvitationWarrantIds ?? []);
  const entries: RemoteSocialInvitationOpportunity[] = [];
  for (const request of [...input.requests].sort(compareRequests)) {
    if (
      request.status === 'offered' ||
      !request.issuerAliveAndCapable ||
      request.issuerBusy ||
      !request.issuerLocationId ||
      request.issuerLocationId === input.actorLocationId ||
      (request.issuerMapId ?? 'world') !== input.actorMapId ||
      request.issuerActorId === input.actorId
    ) {
      continue;
    }
    const sourceRef = `request:${request.requestId}`;
    const sourceRevision = `request:rev:${request.revision}`;
    const warrantSeed = stableObservationDigest({
      actorId: input.actorId,
      targetActorId: request.issuerActorId,
      sourceRef,
      sourceRevision,
    });
    const warrant: SocialWarrant = {
      contractVersion: SOCIAL_WARRANT_VERSION,
      warrantId: `social_warrant:${warrantSeed.slice('stable64:'.length)}`,
      actorId: input.actorId,
      kind: 'active_obligation',
      sourceRef,
      sourceRevision,
      intendedOutcome: 'respond_to_request',
      eligibleTargetActorIds: [request.issuerActorId],
      topicRefs: [sourceRef],
      audience: 'private',
      urgencyBand: request.status === 'ready_to_turn_in' ? 'important' : 'routine',
      createdAt: input.nowGameHour,
      expiresAt: input.nowGameHour + 24,
    };
    const validation = validateSocialWarrant(warrant);
    if (!validation.ok || activeWarrants.has(warrant.warrantId)) continue;
    const digest = socialWarrantDigest(validation.warrant);
    entries.push({
      contractVersion: REMOTE_SOCIAL_INVITATION_SOURCE_VERSION,
      targetActorId: request.issuerActorId,
      targetLocationId: request.issuerLocationId,
      warrant: validation.warrant,
      warrantDigest: digest,
      candidateId: `social_invite:${stableObservationDigest({
        warrantDigest: digest,
        targetActorId: request.issuerActorId,
      }).slice('stable64:'.length)}`,
      intendedActivity: 'talk',
      summary: `为履行当前委托，邀请${request.issuerActorId}在安全地点会面：${request.summary}`.slice(
        0,
        120,
      ),
    });
    if (entries.length >= REMOTE_SOCIAL_INVITATION_LIMIT) break;
  }
  return entries;
}

function compareRequests(
  left: RemoteSocialInvitationInput['requests'][number],
  right: RemoteSocialInvitationInput['requests'][number],
) {
  return (
    Number(right.status === 'ready_to_turn_in') -
      Number(left.status === 'ready_to_turn_in') ||
    left.requestId.localeCompare(right.requestId) ||
    left.issuerActorId.localeCompare(right.issuerActorId)
  );
}
