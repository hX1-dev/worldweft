import type { AgentContext, AgentProposal, PurposeResourceOutlook } from './agentLogic';
import { validatePurposeBoundLifeIntentV2 } from './purposeBoundLifeIntentContracts';

// A gather trip projected to find nothing left keeps its place among the
// candidates, with the outlook attached so a model can see why, but it ranks
// below every candidate that answers a real need.
export const RESOURCE_CONTENDED_NEED_SCORE = 5 as const;
export const RESOURCE_CONTENDED_WHY_NOW_CODE = 'resource_contended_on_arrival' as const;

export function projectPurposeResourceOutlook(input: {
  stock: number;
  reserved: number;
  capacity: number;
  claimantsAhead: number;
  heldForRequests?: number;
  nowGameHour: number;
  etaGameHours: number;
  nextRefreshGameHour?: number;
  refreshPeriodGameHours?: number;
  lastOutcome?: PurposeResourceOutlook['lastOutcome'];
}): PurposeResourceOutlook {
  const stock = wholeAtLeastZero(input.stock);
  const reserved = wholeAtLeastZero(input.reserved);
  const claimantsAhead = wholeAtLeastZero(input.claimantsAhead);
  const heldForRequests = wholeAtLeastZero(input.heldForRequests ?? 0);
  const etaGameHours = Math.max(0, finiteOr(input.etaGameHours, 0));
  const arrival = finiteOr(input.nowGameHour, 0) + etaGameHours;
  const period = finiteOr(input.refreshPeriodGameHours, 0);
  const nextRefresh = input.nextRefreshGameHour;
  const refreshes =
    nextRefresh !== undefined && Number.isFinite(nextRefresh) && period > 0 && nextRefresh <= arrival
      ? Math.floor((arrival - nextRefresh) / period) + 1
      : 0;
  // A refresh only adds while the patch is below capacity.
  const projectedStock = Math.max(stock, Math.min(wholeAtLeastZero(input.capacity), stock + refreshes));
  return {
    inTransitActorCount: claimantsAhead,
    heldForRequestCount: heldForRequests,
    etaGameHours,
    expectedAvailableOnArrival: Math.max(
      0,
      projectedStock - reserved - claimantsAhead - heldForRequests,
    ),
    ...(input.lastOutcome ? { lastOutcome: { ...input.lastOutcome } } : {}),
  };
}

export function isContendedResourceOutlook(outlook: PurposeResourceOutlook | undefined) {
  return outlook !== undefined && outlook.expectedAvailableOnArrival < 1;
}

export function purposeResourceOutlookForProposal(
  context: AgentContext,
  proposal: AgentProposal | undefined,
): PurposeResourceOutlook | undefined {
  const params = proposal?.params;
  if (!params) return undefined;
  const purpose = validatePurposeBoundLifeIntentV2(params.purposeBoundIntent);
  if (!purpose.ok || purpose.intent.intendedActivity !== 'gather') return undefined;
  const resourceNodeId = typeof params.resourceNodeId === 'string' ? params.resourceNodeId : undefined;
  if (!resourceNodeId) return undefined;
  return context.purposeResourceNodes?.find((node) => node.resourceNodeId === resourceNodeId)
    ?.outlook;
}

// Whoever has already set out keeps going: the outlook only steers those
// deciding whether to start.
export function isContendedGatherForNewChoice(
  context: AgentContext,
  proposal: AgentProposal | undefined,
) {
  if (!isContendedResourceOutlook(purposeResourceOutlookForProposal(context, proposal))) {
    return false;
  }
  const purpose = validatePurposeBoundLifeIntentV2(proposal?.params?.purposeBoundIntent);
  if (!purpose.ok) return false;
  const activeSourceRef =
    context.personalGoal?.purposeIntent?.sourceRef ?? context.personalGoal?.sourceRef;
  return activeSourceRef !== purpose.intent.sourceRef;
}

export function purposeResourceOutlookSummary(outlook: PurposeResourceOutlook) {
  const parts = [
    `另有${outlook.inTransitActorCount}人已动身`,
    ...(outlook.heldForRequestCount > 0 ? [`${outlook.heldForRequestCount}份已被委托预留`] : []),
    `预计到达时剩${outlook.expectedAvailableOnArrival}份`,
  ];
  if (outlook.lastOutcome) {
    const when =
      outlook.lastOutcome.hoursAgo < 1 ? '刚才' : `${Math.round(outlook.lastOutcome.hoursAgo)}小时前`;
    parts.push(`你上次来此${lastOutcomeText(outlook.lastOutcome)}（${when}）`);
  }
  return `（${parts.join('，')}）`;
}

function lastOutcomeText(lastOutcome: NonNullable<PurposeResourceOutlook['lastOutcome']>) {
  if (lastOutcome.status === 'completed') return '采到了';
  if (lastOutcome.status === 'failed') {
    return lastOutcome.reasonCode === 'purpose_goal_source_missing' ? '扑空' : '没有采成';
  }
  if (lastOutcome.status === 'cancelled') return '中途作罢';
  return '未及完成';
}

function wholeAtLeastZero(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function finiteOr(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}
