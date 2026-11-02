import { type Infer, v } from 'convex/values';
import { stableObservationDigest } from './lifeObservation';
import type { SocialOutcomeReceipt } from './socialOutcomeContracts';

export const SOCIAL_CONSEQUENCE_VERSION = 'taixu.social-consequence.v1' as const;

export const socialConsequenceKindValidator = v.union(
  v.literal('aid_received'),
  v.literal('gratitude_due'),
  v.literal('reliability_evidence'),
  v.literal('grievance_created'),
  v.literal('boundary_or_refusal'),
);
export type SocialConsequenceKind = Infer<typeof socialConsequenceKindValidator>;

export const socialConsequenceSourceKindValidator = v.union(
  v.literal('social_outcome'),
  v.literal('action_terminal'),
);
export type SocialConsequenceSourceKind = Infer<typeof socialConsequenceSourceKindValidator>;

export const reliabilityEvidenceDirectionValidator = v.union(
  v.literal('supports'),
  v.literal('contradicts'),
);
export type ReliabilityEvidenceDirection = Infer<typeof reliabilityEvidenceDirectionValidator>;

export const socialConsequenceStatusValidator = v.union(
  v.literal('active'),
  v.literal('fulfilled'),
  v.literal('breached'),
  v.literal('expired'),
  v.literal('cancelled'),
  v.literal('superseded'),
);
export type SocialConsequenceStatus = Infer<typeof socialConsequenceStatusValidator>;

export type SocialConsequenceDraft = {
  contractVersion: typeof SOCIAL_CONSEQUENCE_VERSION;
  consequenceId: string;
  revision: 1;
  sourceOutcomeId: string;
  sourceOutcomeRevision: number;
  sourceKind: SocialConsequenceSourceKind;
  sourceActionId: string;
  sourceEventId: string;
  sourceWarrantId?: string;
  sourceRevision: string;
  scopeKey: string;
  kind: SocialConsequenceKind;
  evidenceDirection?: ReliabilityEvidenceDirection;
  subjectActorId: string;
  counterpartActorIds: string[];
  audience: 'private' | 'participants' | 'local_public';
  intensityBand: 'meaningful';
  status: 'active';
  remainingProjectionBudget: 0 | 1;
  dueGameHour?: number;
  expiresGameHour: number;
  createdGameHour: number;
};

const AID_EXPIRY_HOURS = 30 * 24;
const GRATITUDE_DUE_DELAY_HOURS = 24;
const RELIABILITY_EVIDENCE_EXPIRY_HOURS = 90 * 24;
const GRIEVANCE_EXPIRY_HOURS = 30 * 24;
const BOUNDARY_EXPIRY_HOURS = 7 * 24;

export type SocialConsequenceTerminalEvent = {
  _id: string;
  worldId: string;
  type: string;
  actorIds: string[];
  targetActorIds?: string[];
  actionId?: string;
  facts?: unknown;
};

export type GrievanceActionTerminal = {
  actionId: string;
  actionType: string;
  actorId: string;
  targetActorId?: string;
  executionActionId: string;
  executionActorId: string;
  executionTargetActorId?: string;
  event: SocialConsequenceTerminalEvent;
  gameHour: number;
};

export type BoundaryRefusalEvidence = {
  conversationId: string;
  actionId: string;
  event: SocialConsequenceTerminalEvent;
  speakerActorId: string;
  addressedActorIds: string[];
  speechAct: string;
};

export type GrievanceProjectionSourceEvidence = {
  consequence: {
    sourceKind: SocialConsequenceSourceKind;
    sourceActionId: string;
    sourceEventId: string;
    sourceOutcomeId: string;
    sourceOutcomeRevision: number;
    sourceWarrantId?: string;
    sourceRevision: string;
    subjectActorId: string;
    counterpartActorIds: string[];
  };
  action: {
    id: string;
    type: string;
    status: string;
    actorId: string;
    targetActorId?: string;
  } | null;
  event: SocialConsequenceTerminalEvent | null;
  assaultEvidence: Array<{
    sourceEventId: string;
    fromActorId: string;
    toActorId: string;
    effectKind: string;
  }>;
};

/**
 * LWSE-1a deliberately recognizes one narrow, physically verified result.
 * It does not backfill old rows or infer help from speech, relationship values,
 * actor proximity, or a generic successful conversation.
 */
export function deriveAidSocialConsequenceDrafts(
  receipt: SocialOutcomeReceipt,
): SocialConsequenceDraft[] {
  if (
    receipt.status !== 'resolved' ||
    receipt.intendedOutcome !== 'thank_apologize_or_repair' ||
    receipt.terminalResultCode !== 'gift_accepted' ||
    receipt.terminalReasonCode !== 'social_outcome_repair_gift_accepted' ||
    receipt.targetActorIds.length !== 1 ||
    receipt.targetActorIds[0] === receipt.actorId ||
    !positiveInteger(receipt.revision) || receipt.revision < 2 ||
    !nonempty(receipt.outcomeId) ||
    !nonempty(receipt.warrantId) ||
    !nonempty(receipt.sourceRevision) ||
    !nonempty(receipt.terminalActionId) ||
    !nonempty(receipt.terminalEventId) ||
    !nonnegativeInteger(receipt.terminalGameHour)
  ) return [];

  const subjectActorId = receipt.targetActorIds[0];
  const counterpartActorIds = [receipt.actorId];
  const createdGameHour = receipt.terminalGameHour!;
  const common = {
    contractVersion: SOCIAL_CONSEQUENCE_VERSION,
    revision: 1 as const,
    sourceOutcomeId: receipt.outcomeId,
    sourceOutcomeRevision: receipt.revision,
    sourceKind: 'social_outcome' as const,
    sourceActionId: receipt.terminalActionId!,
    sourceEventId: receipt.terminalEventId!,
    sourceWarrantId: receipt.warrantId,
    sourceRevision: receipt.sourceRevision,
    subjectActorId,
    counterpartActorIds,
    audience: receipt.audience,
    intensityBand: 'meaningful' as const,
    status: 'active' as const,
    expiresGameHour: createdGameHour + AID_EXPIRY_HOURS,
    createdGameHour,
  };

  return (['aid_received', 'gratitude_due'] as const).map((kind) => ({
    ...common,
    consequenceId: consequenceId({
      sourceOutcomeId: receipt.outcomeId,
      sourceOutcomeRevision: receipt.revision,
      kind,
      subjectActorId,
      counterpartActorIds,
    }),
    scopeKey: consequenceScopeKey({
      sourceOutcomeId: receipt.outcomeId,
      kind,
      subjectActorId,
      counterpartActorIds,
    }),
    kind,
    remainingProjectionBudget: kind === 'gratitude_due' ? 1 as const : 0 as const,
    ...(kind === 'gratitude_due'
      ? { dueGameHour: createdGameHour + GRATITUDE_DUE_DELAY_HOURS }
      : {}),
  }));
}

/**
 * LWSE-1b recognizes only the authoritative execution terminal of an existing
 * group commitment. A receipt that merely claims this exact terminal is
 * fail-closed: its event must prove the same donor, recipient and commitment.
 */
export function deriveReliabilitySocialConsequenceDrafts(
  receipt: SocialOutcomeReceipt,
  terminalEvent: SocialConsequenceTerminalEvent | null,
): SocialConsequenceDraft[] {
  const direction = reliabilityDirection(receipt);
  if (!direction) return [];
  if (!terminalEvent || !validReliabilityTerminalEvent(receipt, terminalEvent, direction)) {
    throw new Error('social_consequence_terminal_evidence_invalid');
  }
  const facts = terminalEvent.facts as Record<string, unknown>;
  const subjectActorId = facts.donorActorId as string;
  const counterpartActorIds = [facts.recipientActorId as string];
  const createdGameHour = receipt.terminalGameHour!;
  const kind = 'reliability_evidence' as const;
  return [{
    contractVersion: SOCIAL_CONSEQUENCE_VERSION,
    consequenceId: consequenceId({
      sourceOutcomeId: receipt.outcomeId,
      sourceOutcomeRevision: receipt.revision,
      kind,
      evidenceDirection: direction,
      subjectActorId,
      counterpartActorIds,
    }),
    revision: 1,
    sourceOutcomeId: receipt.outcomeId,
    sourceOutcomeRevision: receipt.revision,
    sourceKind: 'social_outcome',
    sourceActionId: receipt.terminalActionId!,
    sourceEventId: receipt.terminalEventId!,
    sourceWarrantId: receipt.warrantId,
    sourceRevision: receipt.sourceRevision,
    scopeKey: consequenceScopeKey({
      sourceOutcomeId: receipt.outcomeId,
      kind,
      evidenceDirection: direction,
      subjectActorId,
      counterpartActorIds,
    }),
    kind,
    evidenceDirection: direction,
    subjectActorId,
    counterpartActorIds,
    audience: receipt.audience,
    intensityBand: 'meaningful',
    status: 'active',
    remainingProjectionBudget: 0,
    expiresGameHour: createdGameHour + RELIABILITY_EVIDENCE_EXPIRY_HOURS,
    createdGameHour,
  }];
}

/**
 * LWSE-1c recognizes only the server-owned completion of the ordinary hostile
 * attack body. It intentionally does not infer grievance from speech, spar,
 * flee counter-damage, a pending execution, or an arbitrary event row.
 */
export function deriveGrievanceSocialConsequenceDraft(
  terminal: GrievanceActionTerminal,
): SocialConsequenceDraft | null {
  const { event } = terminal;
  const facts = plainObject(event.facts) ? event.facts : null;
  const defeated = facts?.defeated;
  const eligibleEvent =
    (event.type === 'combat_attack_resolved' && facts?.resultCode === 'combat_attack_hit' && defeated === false) ||
    (event.type === 'combatant_defeated' && facts?.resultCode === 'combat_target_defeated' && defeated === true);
  if (!eligibleEvent) return null;
  if (
    terminal.actionType !== 'attack' ||
    terminal.actionId !== terminal.executionActionId ||
    terminal.actionId !== event.actionId ||
    terminal.actorId !== terminal.executionActorId ||
    terminal.targetActorId !== terminal.executionTargetActorId ||
    terminal.actorId === terminal.targetActorId ||
    event.actorIds.length !== 1 || event.actorIds[0] !== terminal.actorId ||
    event.targetActorIds?.length !== 1 || event.targetActorIds[0] !== terminal.targetActorId ||
    facts?.targetActorId !== terminal.targetActorId ||
    !positiveInteger(facts?.damage as number) ||
    !nonnegativeInteger(terminal.gameHour)
  ) throw new Error('social_consequence_terminal_evidence_invalid');

  const subjectActorId = terminal.targetActorId!;
  const counterpartActorIds = [terminal.actorId];
  const kind = 'grievance_created' as const;
  const sourceOutcomeId = `action_terminal:${terminal.actionId}:${event._id}`;
  const sourceRevision = grievanceActionTerminalSourceRevision({
    eventId: event._id,
    actionId: terminal.actionId,
    resultCode: String(facts.resultCode),
    targetActorId: String(facts.targetActorId),
    damage: Number(facts.damage),
    defeated: facts.defeated === true,
  });
  return {
    contractVersion: SOCIAL_CONSEQUENCE_VERSION,
    consequenceId: consequenceId({
      sourceOutcomeId, sourceOutcomeRevision: 1, kind, subjectActorId, counterpartActorIds,
    }),
    revision: 1,
    sourceOutcomeId,
    sourceOutcomeRevision: 1,
    sourceKind: 'action_terminal',
    sourceActionId: terminal.actionId,
    sourceEventId: event._id,
    sourceRevision,
    scopeKey: consequenceScopeKey({ sourceOutcomeId, kind, subjectActorId, counterpartActorIds }),
    kind,
    subjectActorId,
    counterpartActorIds,
    audience: 'private',
    intensityBand: 'meaningful',
    status: 'active',
    remainingProjectionBudget: 1,
    expiresGameHour: terminal.gameHour + GRIEVANCE_EXPIRY_HOURS,
    createdGameHour: terminal.gameHour,
  };
}

export function grievanceActionTerminalSourceRevision(input: {
  eventId: string;
  actionId: string;
  resultCode: string;
  targetActorId: string;
  damage: number;
  defeated: boolean;
}) {
  return `event_facts:${stableObservationDigest(input)}`;
}

/**
 * Validates that a grievance owner, hostile action, terminal event and the
 * existing relationship evidence are four views of one exact source event.
 * The assault row is corroboration, not a second future-candidate source.
 */
export function grievanceProjectionSourceEvidenceValid(
  input: GrievanceProjectionSourceEvidence,
) {
  const { consequence, action, event } = input;
  if (
    consequence.sourceKind !== 'action_terminal' ||
    consequence.sourceWarrantId !== undefined ||
    consequence.sourceOutcomeRevision !== 1 ||
    consequence.counterpartActorIds.length !== 1 ||
    consequence.counterpartActorIds[0] === consequence.subjectActorId ||
    !action || !event ||
    action.id !== consequence.sourceActionId ||
    action.type !== 'attack' ||
    action.status !== 'applied' ||
    action.actorId !== consequence.counterpartActorIds[0] ||
    action.targetActorId !== consequence.subjectActorId ||
    event._id !== consequence.sourceEventId ||
    event.actionId !== consequence.sourceActionId ||
    event.actorIds.length !== 1 ||
    event.actorIds[0] !== consequence.counterpartActorIds[0] ||
    event.targetActorIds?.length !== 1 ||
    event.targetActorIds[0] !== consequence.subjectActorId ||
    !plainObject(event.facts)
  ) return false;
  const facts = event.facts;
  const eligibleEvent =
    (event.type === 'combat_attack_resolved' &&
      facts.resultCode === 'combat_attack_hit' && facts.defeated === false) ||
    (event.type === 'combatant_defeated' &&
      facts.resultCode === 'combat_target_defeated' && facts.defeated === true);
  if (
    !eligibleEvent ||
    facts.targetActorId !== consequence.subjectActorId ||
    !positiveInteger(facts.damage as number) ||
    consequence.sourceOutcomeId !==
      `action_terminal:${consequence.sourceActionId}:${consequence.sourceEventId}` ||
    consequence.sourceRevision !== grievanceActionTerminalSourceRevision({
      eventId: event._id,
      actionId: consequence.sourceActionId,
      resultCode: String(facts.resultCode),
      targetActorId: String(facts.targetActorId),
      damage: Number(facts.damage),
      defeated: facts.defeated === true,
    })
  ) return false;
  const exactAssault = input.assaultEvidence.filter((row) =>
    row.sourceEventId === consequence.sourceEventId &&
    row.fromActorId === consequence.subjectActorId &&
    row.toActorId === consequence.counterpartActorIds[0] &&
    row.effectKind === 'assault');
  return exactAssault.length === 1;
}

/** A refusal is a bounded consent boundary, never negative relationship
 * evidence by itself. The exact refusal utterance must be persisted and owned
 * by the same conversation and participants before the owner can be emitted. */
export function deriveBoundarySocialConsequenceDraft(
  receipt: SocialOutcomeReceipt,
  evidence: BoundaryRefusalEvidence | null,
): SocialConsequenceDraft | null {
  const eligible =
    receipt.status === 'failed' &&
    receipt.intendedOutcome === 'thank_apologize_or_repair' &&
    receipt.terminalResultCode === 'conversation_ended' &&
    receipt.terminalReasonCode === 'social_outcome_repair_refused';
  if (!eligible) return null;
  if (
    !evidence ||
    receipt.targetActorIds.length !== 1 ||
    evidence.conversationId !== receipt.conversationId ||
    evidence.speechAct !== 'refuse' ||
    evidence.speakerActorId !== receipt.targetActorIds[0] ||
    evidence.addressedActorIds.length !== 1 || evidence.addressedActorIds[0] !== receipt.actorId ||
    evidence.actionId !== evidence.event.actionId ||
    evidence.event.actorIds.length !== 1 || evidence.event.actorIds[0] !== evidence.speakerActorId ||
    evidence.event.targetActorIds?.length !== 1 || evidence.event.targetActorIds[0] !== receipt.actorId ||
    !plainObject(evidence.event.facts) ||
    evidence.event.facts.conversationId !== evidence.conversationId ||
    evidence.event.facts.speechAct !== 'refuse' ||
    !positiveInteger(receipt.revision) || receipt.revision < 2 ||
    !nonempty(receipt.warrantId) || !nonempty(receipt.sourceRevision) ||
    !nonnegativeInteger(receipt.terminalGameHour)
  ) throw new Error('lwse_1c_boundary_evidence_missing');
  const subjectActorId = evidence.speakerActorId;
  const counterpartActorIds = [receipt.actorId];
  const kind = 'boundary_or_refusal' as const;
  const createdGameHour = receipt.terminalGameHour!;
  return {
    contractVersion: SOCIAL_CONSEQUENCE_VERSION,
    consequenceId: consequenceId({
      sourceOutcomeId: receipt.outcomeId, sourceOutcomeRevision: receipt.revision,
      kind, subjectActorId, counterpartActorIds,
    }),
    revision: 1,
    sourceOutcomeId: receipt.outcomeId,
    sourceOutcomeRevision: receipt.revision,
    sourceKind: 'social_outcome',
    sourceActionId: evidence.actionId,
    sourceEventId: evidence.event._id,
    sourceWarrantId: receipt.warrantId,
    sourceRevision: receipt.sourceRevision,
    scopeKey: consequenceScopeKey({
      sourceOutcomeId: receipt.outcomeId, kind, subjectActorId, counterpartActorIds,
    }),
    kind,
    subjectActorId,
    counterpartActorIds,
    audience: receipt.audience,
    intensityBand: 'meaningful',
    status: 'active',
    remainingProjectionBudget: 0,
    expiresGameHour: createdGameHour + BOUNDARY_EXPIRY_HOURS,
    createdGameHour,
  };
}

export function effectiveSocialConsequenceStatus(
  consequence: { status: SocialConsequenceStatus; expiresGameHour: number },
  gameHour: number,
): SocialConsequenceStatus {
  if (consequence.status === 'active' && gameHour >= consequence.expiresGameHour) {
    return 'expired';
  }
  return consequence.status;
}

function consequenceId(input: {
  sourceOutcomeId: string;
  sourceOutcomeRevision: number;
  kind: SocialConsequenceKind;
  evidenceDirection?: ReliabilityEvidenceDirection;
  subjectActorId: string;
  counterpartActorIds: string[];
}) {
  return `social_consequence:${stableObservationDigest({
    sourceOutcomeId: input.sourceOutcomeId,
    sourceOutcomeRevision: input.sourceOutcomeRevision,
    kind: input.kind,
    ...(input.evidenceDirection ? { evidenceDirection: input.evidenceDirection } : {}),
    subjectActorId: input.subjectActorId,
    counterpartActorIds: canonicalStrings(input.counterpartActorIds),
  })}`;
}

function consequenceScopeKey(input: {
  sourceOutcomeId: string;
  kind: SocialConsequenceKind;
  evidenceDirection?: ReliabilityEvidenceDirection;
  subjectActorId: string;
  counterpartActorIds: string[];
}) {
  return `social_consequence_scope:${stableObservationDigest({
    sourceOutcomeId: input.sourceOutcomeId,
    kind: input.kind,
    ...(input.evidenceDirection ? { evidenceDirection: input.evidenceDirection } : {}),
    subjectActorId: input.subjectActorId,
    counterpartActorIds: canonicalStrings(input.counterpartActorIds),
  })}`;
}

function reliabilityDirection(
  receipt: SocialOutcomeReceipt,
): ReliabilityEvidenceDirection | undefined {
  if (
    receipt.intendedOutcome !== 'reach_group_decision' ||
    !positiveInteger(receipt.revision) || receipt.revision < 2 ||
    !nonempty(receipt.outcomeId) ||
    !nonempty(receipt.warrantId) ||
    !nonempty(receipt.sourceRevision) ||
    !nonempty(receipt.terminalActionId) ||
    !nonempty(receipt.terminalEventId) ||
    !nonnegativeInteger(receipt.terminalGameHour)
  ) return undefined;
  if (
    receipt.status === 'resolved' &&
    receipt.terminalResultCode === 'group_commitment_fulfilled' &&
    receipt.terminalReasonCode === 'social_outcome_group_commitment_fulfilled'
  ) return 'supports';
  if (
    receipt.status === 'failed' &&
    receipt.terminalResultCode === 'group_commitment_breached' &&
    receipt.terminalReasonCode === 'social_outcome_group_commitment_breached'
  ) return 'contradicts';
  return undefined;
}

function validReliabilityTerminalEvent(
  receipt: SocialOutcomeReceipt,
  event: SocialConsequenceTerminalEvent,
  direction: ReliabilityEvidenceDirection,
) {
  const expected = direction === 'supports'
    ? { result: 'group_commitment_fulfilled', status: 'fulfilled' }
    : { result: 'group_commitment_breached', status: 'breached' };
  if (
    event._id !== receipt.terminalEventId ||
    event.type !== expected.result ||
    event.actionId !== receipt.terminalActionId ||
    !plainObject(event.facts)
  ) return false;
  const facts = event.facts;
  if (
    facts.resultCode !== expected.result ||
    facts.kind !== 'owned_herb_allocation' ||
    facts.operation !== 'execute' ||
    facts.commitmentStatus !== expected.status ||
    !nonemptyString(facts.commitmentId) ||
    !nonemptyString(facts.donorActorId) ||
    !nonemptyString(facts.recipientActorId) ||
    facts.donorActorId === facts.recipientActorId ||
    event.actorIds.length !== 1 ||
    event.actorIds[0] !== facts.donorActorId ||
    event.targetActorIds?.length !== 1 ||
    event.targetActorIds[0] !== facts.recipientActorId
  ) return false;
  const participants = new Set([receipt.actorId, ...receipt.targetActorIds]);
  return participants.has(facts.donorActorId) && participants.has(facts.recipientActorId);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function canonicalStrings(values: string[]) {
  return [...new Set(values)].sort();
}

function nonempty(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function positiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function nonnegativeInteger(value: number | undefined): value is number {
  return Number.isInteger(value) && value! >= 0;
}
