import type { AutonomyCandidateV3 } from './autonomyDecisionContracts';
import type { AgentContext, AgentProposal } from './agentLogic';
import {
  type PersonalGoalBacklogEntry,
  type PersonalGoalCandidate,
  type PersonalGoalKind,
} from './personalGoalContracts';
import { PERSONAL_GOAL_BACKLOG_LIMIT } from './personalGoalConstants';

type GoalCandidateInput = {
  candidate: AutonomyCandidateV3;
  proposal: AgentProposal;
};

export function personalGoalCandidateForProposal(
  context: AgentContext,
  input: GoalCandidateInput,
): PersonalGoalCandidate | null {
  if (stringParam(input.proposal.params ?? {}, 'purposeBoundIntentDigest')) return null;
  return legacyPersonalGoalCandidateForProposal(context, input);
}

/**
 * Portable-kernel entry point. Purpose-v2 candidates must arrive with the
 * host-precomputed, fully validated projection; raw purpose params fail closed
 * here so the kernel does not absorb host-domain validators and planners.
 */
export function personalGoalCandidateForKernel(
  context: AgentContext,
  input: GoalCandidateInput,
  precomputed?: PersonalGoalCandidate,
): PersonalGoalCandidate | null {
  if (precomputed) return precomputed;
  const requestedPurposeDigest = stringParam(
    input.proposal.params ?? {},
    'purposeBoundIntentDigest',
  );
  if (requestedPurposeDigest) return null;
  return legacyPersonalGoalCandidateForProposal(context, input);
}

function legacyPersonalGoalCandidateForProposal(
  context: AgentContext,
  input: GoalCandidateInput,
): PersonalGoalCandidate | null {
  const { candidate, proposal } = input;
  const params = proposal.params ?? {};
  const requestId = stringParam(params, 'requestId');
  const commitmentId = stringParam(params, 'commitmentId');
  const kind = personalGoalKind(candidate.planner, proposal, requestId, commitmentId);
  if (!kind) return null;
  const sourceRef = personalGoalSourceRef(
    context,
    kind,
    proposal,
    requestId,
    commitmentId,
  );
  if (!sourceRef) return null;
  const progress = personalGoalProgress(context, kind, sourceRef, proposal);
  return {
    candidateId: candidate.candidateId,
    goalKey: `${kind}:${sourceRef}`.slice(0, 240),
    kind,
    sourceRef,
    targetRef: candidate.targetRef,
    intent: proposal.intent.slice(0, 240),
    progressScore: progress.score,
    progressKey: progress.key.slice(0, 240),
  };
}

export function boundedPersonalGoalBacklog(
  candidates: PersonalGoalCandidate[],
  selectedGoalKey?: string,
): PersonalGoalBacklogEntry[] {
  const seen = new Set<string>();
  const backlog: PersonalGoalBacklogEntry[] = [];
  for (const candidate of candidates) {
    if (candidate.goalKey === selectedGoalKey || seen.has(candidate.goalKey)) continue;
    seen.add(candidate.goalKey);
    backlog.push({
      candidateId: candidate.candidateId,
      goalKey: candidate.goalKey,
      kind: candidate.kind,
      sourceRef: candidate.sourceRef,
      targetRef: candidate.targetRef,
      intent: candidate.intent,
      purposeIntent: candidate.purposeIntent,
      purposeIntentDigest: candidate.purposeIntentDigest,
      purposeCadenceKey: candidate.purposeCadenceKey,
    });
    if (backlog.length === PERSONAL_GOAL_BACKLOG_LIMIT) break;
  }
  return backlog;
}

function personalGoalKind(
  planner: string,
  proposal: AgentProposal,
  requestId?: string,
  commitmentId?: string,
): PersonalGoalKind | null {
  if (
    stringParam(proposal.params ?? {}, 'worldPressureResponse') === 'withdraw'
  ) {
    return 'avoid_threat';
  }
  if (requestId || commitmentId) return 'commitment';
  if (proposal.type === 'flee') return 'avoid_threat';
  if (
    proposal.type === 'rest' ||
    proposal.type === 'use_item' ||
    planner === 'survival' ||
    planner === 'self_care' ||
    planner === 'rest'
  ) {
    return 'recovery';
  }
  if (
    proposal.type === 'cultivate' ||
    proposal.type === 'breakthrough' ||
    proposal.type === 'request_teaching'
  ) {
    return 'cultivation';
  }
  if (
    proposal.type === 'talk' ||
    proposal.type === 'group_talk' ||
    proposal.type === 'group_decide' ||
    proposal.type === 'negotiate' ||
    proposal.type === 'gift' ||
    proposal.type === 'accept_request' ||
    proposal.type === 'decline_request' ||
    proposal.type === 'turn_in_request'
  ) {
    return 'relationship';
  }
  if (
    proposal.type === 'gather' ||
    proposal.type === 'trade' ||
    proposal.type === 'explore' ||
    proposal.type === 'travel'
  ) {
    return 'livelihood';
  }
  return null;
}

function personalGoalSourceRef(
  context: AgentContext,
  kind: PersonalGoalKind,
  proposal: AgentProposal,
  requestId?: string,
  commitmentId?: string,
) {
  const params = proposal.params ?? {};
  const pressureId = stringParam(params, 'worldPressureId');
  if (pressureId) {
    return pressureId.startsWith('pressure:') ? pressureId : `pressure:${pressureId}`;
  }
  if (requestId) return `request:${requestId}`;
  if (commitmentId) return `commitment:${commitmentId}`;
  if (kind === 'recovery') return `body:${context.self.actorId}`;
  if (kind === 'cultivation') return `cultivation:${context.self.actorId}`;
  if (kind === 'avoid_threat') {
    return context.combat?.activeEncounterId
      ? `encounter:${context.combat.activeEncounterId}`
      : undefined;
  }
  if (kind === 'relationship') {
    const actorId = proposal.targetActorId;
    if (actorId) return `actor:${actorId}`;
    const negotiationId = stringParam(params, 'negotiationId');
    if (negotiationId) return `negotiation:${negotiationId}`;
    const conversationId = stringParam(params, 'conversationId');
    if (conversationId) return `conversation:${conversationId}`;
    const groupConversationId = stringParam(params, 'groupConversationId');
    if (groupConversationId) return `group:${groupConversationId}`;
    return undefined;
  }
  const resourceNodeId = stringParam(params, 'resourceNodeId');
  if (resourceNodeId) return `resource:${resourceNodeId}`;
  const shopId = stringParam(params, 'shopId');
  if (shopId) return `shop:${shopId}`;
  if (proposal.targetActorId) return `actor:${proposal.targetActorId}`;
  const locationId = proposal.targetId ?? proposal.locationId ?? context.self.currentLocationId;
  return locationId ? `location:${locationId}` : undefined;
}

export function personalGoalProgress(
  context: AgentContext,
  kind: PersonalGoalKind,
  sourceRef: string,
  proposal: AgentProposal,
) {
  const here = context.self.currentLocationId ?? 'unknown';
  if (kind === 'recovery') {
    const health = Math.max(0, context.self.health);
    const fatigue = Math.max(0, Math.min(100, context.self.fatigue ?? 0));
    return {
      score: health * 100 + (100 - fatigue),
      key: `body:${health}:${fatigue}:${here}`,
    };
  }
  if (kind === 'commitment' && sourceRef.startsWith('request:')) {
    const requestId = sourceRef.slice('request:'.length);
    const request = (context.activeRequests ?? []).find(
      (candidate) => candidate.requestId === requestId,
    );
    const stage =
      request?.status === 'ready_to_turn_in'
        ? 200
        : request?.status === 'accepted'
          ? 100
          : request?.status === 'offered'
            ? 0
            : -100;
    const owned = request?.itemId
      ? Math.min(
          request.qty ?? 1,
          context.self.inventory.find((item) => item.itemId === request.itemId)?.qty ?? 0,
        )
      : 0;
    const atTarget =
      request?.locationId === here || request?.issuerLocationId === here ? 1 : 0;
    return {
      score: stage + owned * 10 + atTarget,
      key: `request:${request?.status ?? 'missing'}:${owned}:${atTarget}:${here}`,
    };
  }
  if (kind === 'cultivation') {
    const score =
      context.self.realmStage * 100_000 +
      context.self.cultivationXp * 10 +
      context.self.spirit;
    return {
      score,
      key: `cultivation:${context.self.realm}:${context.self.realmStage}:${context.self.cultivationXp}:${context.self.spirit}:${here}`,
    };
  }
  if (kind === 'relationship') {
    const target = proposal.targetActorId
      ? context.others.find((actor) => actor.actorId === proposal.targetActorId)
      : undefined;
    const score = target
      ? target.relationship * 100 +
        (target.trust ?? 0) -
        (target.suspicion ?? 0) -
        (target.fear ?? 0)
      : 0;
    return {
      score,
      key: `relationship:${target?.actorId ?? sourceRef}:${score}:${here}`,
    };
  }
  if (kind === 'avoid_threat') {
    const pressureId = sourceRef.startsWith('pressure:')
      ? sourceRef.slice('pressure:'.length)
      : undefined;
    const active = pressureId
      ? context.worldPressures?.some((pressure) => pressure.pressureId === pressureId)
        ? 0
        : 1
      : context.combat?.activeEncounterId
        ? 0
        : 1;
    return {
      score: active,
      key: `threat:${pressureId ?? context.combat?.activeEncounterId ?? 'cleared'}:${active}:${here}`,
    };
  }
  const params = proposal.params ?? {};
  const itemId = stringParam(params, 'itemId') ?? stringParam(params, 'requestedItemId');
  const owned = itemId
    ? context.self.inventory.find((item) => item.itemId === itemId)?.qty ?? 0
    : 0;
  return {
    score: owned,
    key: `livelihood:${sourceRef}:${itemId ?? 'none'}:${owned}:${here}`,
  };
}

function stringParam(params: Record<string, unknown>, key: string) {
  const value = params[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
