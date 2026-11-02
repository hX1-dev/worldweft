import type { ActionType } from './actionSchema';
import type { PurposeBoundIntendedActivity } from './purposeBoundLifeIntentContracts';

export const PURPOSE_BEHAVIOR_RELEASE_AUDIT_VERSION =
  'taixu.purpose-behavior-release-audit.v1' as const;
export const PURPOSE_BEHAVIOR_RELEASE_AUDIT_SAMPLE_LIMIT = 24 as const;
export const PURPOSE_BEHAVIOR_ROUND_TRIP_WINDOW_HOURS = 24 as const;

export type PurposeBehaviorViolationCode =
  | 'ungrounded_travel'
  | 'unexplained_round_trip'
  | 'arrival_without_follow_through'
  | 'duplicate_goal_without_source_change'
  | 'terminal_goal_continued'
  | 'purpose_source_missing'
  | 'completion_condition_missing'
  | 'audit_integrity_violation';

export type PurposeBehaviorCausalChangeKind =
  | 'need'
  | 'resource'
  | 'relationship'
  | 'duty'
  | 'world_event';

export type PurposeGoalCreatedObservation = {
  sequence: number;
  gameHour: number;
  actorId: string;
  goalId: string;
  cadenceKey?: string;
  purposeIntentDigest?: string;
  sourceRef?: string;
  sourceRevision?: string;
  sourceStateDigest?: string;
  targetLocationId?: string;
  intendedActivity?: PurposeBoundIntendedActivity;
  completionConditionDigest?: string;
};

export type PurposeGoalTerminalObservation = {
  sequence: number;
  gameHour: number;
  actorId: string;
  goalId: string;
  status: 'completed' | 'cancelled' | 'failed' | 'expired';
  reasonCode?: string;
};

export type PurposeActionSelectedObservation = {
  sequence: number;
  gameHour: number;
  actorId: string;
  actionId: string;
  actionType: ActionType;
  goalId?: string;
  purposeIntentDigest?: string;
  sourceRef?: string;
  sourceRevision?: string;
  intendedActivity?: PurposeBoundIntendedActivity;
  fromLocationId?: string;
  targetLocationId?: string;
};

export type PurposeActionTerminalObservation = {
  sequence: number;
  gameHour: number;
  actorId: string;
  actionId: string;
  status: 'arrived' | 'completed' | 'blocked' | 'cancelled' | 'rejected';
  reasonCode?: string;
  finalLocationId?: string;
};

export type PurposeCausalChangeObservation = {
  sequence: number;
  gameHour: number;
  actorId?: string;
  kind: PurposeBehaviorCausalChangeKind;
  sourceEventId: string;
  sourceRef: string;
  beforeDigest: string;
  afterDigest: string;
};

export type PurposeIntentionalIdleObservation = {
  sequence: number;
  gameHour: number;
  actorId: string;
  reasonCode: string;
  goalId?: string;
  sourceRef?: string;
};

export type PurposeBehaviorViolationSample = {
  code: PurposeBehaviorViolationCode;
  sequence: number;
  gameHour: number;
  reasonCode: string;
  actorId?: string;
  goalId?: string;
  actionId?: string;
};

export type PurposeBehaviorReleaseAuditSummary = {
  auditVersion: typeof PURPOSE_BEHAVIOR_RELEASE_AUDIT_VERSION;
  observationOnly: true;
  releaseStatus: 'pass' | 'fail';
  violations: Record<PurposeBehaviorViolationCode, number>;
  violationSamples: Record<PurposeBehaviorViolationCode, PurposeBehaviorViolationSample[]>;
  goals: {
    created: number;
    terminal: number;
    activeAtEnd: number;
  };
  actions: {
    selected: number;
    terminal: number;
    pendingAtEnd: number;
    byType: Record<string, number>;
  };
  travels: {
    selected: number;
    arrived: number;
    explicitTerminalBeforeArrival: number;
  };
  followThrough: {
    expected: number;
    completed: number;
    explainedTerminal: number;
    pendingAtEnd: number;
    unresolved: number;
  };
  roundTrips: {
    detected: number;
    explainedByCausalChange: number;
    unexplained: number;
  };
  causalChanges: {
    recorded: number;
    effective: number;
    byKind: Record<PurposeBehaviorCausalChangeKind, number>;
  };
  intentionalIdle: {
    total: number;
    byReason: Record<string, number>;
  };
  traceDigest: string;
};

type GoalState = PurposeGoalCreatedObservation & {
  terminal?: PurposeGoalTerminalObservation;
};

type ActionState = PurposeActionSelectedObservation & {
  groundedTravel: boolean;
  terminal?: PurposeActionTerminalObservation;
};

type OpenArrival = {
  actorId: string;
  goalId: string;
  travelActionId: string;
  arrivedSequence: number;
  arrivedGameHour: number;
  fromLocationId: string;
  targetLocationId: string;
  intendedActivity: PurposeBoundIntendedActivity;
  activityActionId?: string;
};

type ArrivedTravel = {
  actorId: string;
  goalId: string;
  actionId: string;
  selectedSequence: number;
  arrivedSequence: number;
  arrivedGameHour: number;
  fromLocationId: string;
  targetLocationId: string;
};

const VIOLATION_CODES: readonly PurposeBehaviorViolationCode[] = [
  'ungrounded_travel',
  'unexplained_round_trip',
  'arrival_without_follow_through',
  'duplicate_goal_without_source_change',
  'terminal_goal_continued',
  'purpose_source_missing',
  'completion_condition_missing',
  'audit_integrity_violation',
];

const CAUSAL_CHANGE_KINDS: readonly PurposeBehaviorCausalChangeKind[] = [
  'need',
  'resource',
  'relationship',
  'duty',
  'world_event',
];

export function createPurposeBehaviorReleaseAudit() {
  const violations = zeroViolationRecord();
  const violationSamples = Object.fromEntries(
    VIOLATION_CODES.map((code) => [code, [] as PurposeBehaviorViolationSample[]]),
  ) as PurposeBehaviorReleaseAuditSummary['violationSamples'];
  const goals = new Map<string, GoalState>();
  const activeGoalByActor = new Map<string, string>();
  const lastGoalByCadence = new Map<string, GoalState>();
  const actions = new Map<string, ActionState>();
  const openArrivals = new Map<string, OpenArrival>();
  const lastArrivedTravelByActor = new Map<string, ArrivedTravel>();
  const causalChanges: PurposeCausalChangeObservation[] = [];
  const causalEventIds = new Set<string>();
  const actionTypes: Record<string, number> = {};
  const idleReasons: Record<string, number> = {};
  const causalKinds = zeroCausalKindRecord();
  const digest = new AuditDigest();
  let lastSequence = -1;
  let lastGameHour = Number.NEGATIVE_INFINITY;
  let finalized: PurposeBehaviorReleaseAuditSummary | undefined;
  const totals = {
    goalsCreated: 0,
    goalsTerminal: 0,
    actionsSelected: 0,
    actionsTerminal: 0,
    travelsSelected: 0,
    travelsArrived: 0,
    travelExplicitTerminalBeforeArrival: 0,
    followThroughExpected: 0,
    followThroughCompleted: 0,
    followThroughExplainedTerminal: 0,
    followThroughPendingAtEnd: 0,
    followThroughUnresolved: 0,
    roundTrips: 0,
    roundTripsExplained: 0,
    roundTripsUnexplained: 0,
    causalChangesRecorded: 0,
    causalChangesEffective: 0,
    intentionalIdle: 0,
  };

  const recordViolation = (
    code: PurposeBehaviorViolationCode,
    observation: {
      sequence: number;
      gameHour: number;
      actorId?: string;
      goalId?: string;
      actionId?: string;
    },
    reasonCode: string,
  ) => {
    violations[code] += 1;
    const samples = violationSamples[code];
    if (samples.length < PURPOSE_BEHAVIOR_RELEASE_AUDIT_SAMPLE_LIMIT) {
      samples.push({ code, ...observation, reasonCode });
    }
  };

  const beginObservation = (
    kind: string,
    input: { sequence: number; gameHour: number; actorId?: string },
    digestFields: unknown[],
  ) => {
    assertNotFinalized(finalized);
    digest.update(`${kind}:${digestFields.map(digestValue).join(':')}`);
    if (
      !Number.isInteger(input.sequence) ||
      input.sequence < 0 ||
      !Number.isFinite(input.gameHour)
    ) {
      recordViolation('audit_integrity_violation', input, 'invalid_observation_clock');
      return false;
    }
    if (input.sequence <= lastSequence || input.gameHour < lastGameHour) {
      recordViolation('audit_integrity_violation', input, 'observation_order_regressed');
      return false;
    }
    lastSequence = input.sequence;
    lastGameHour = input.gameHour;
    return true;
  };

  const recordGoalCreated = (input: PurposeGoalCreatedObservation) => {
    if (!beginObservation('goal_created', input, goalCreatedDigestFields(input))) return;
    if (goals.has(input.goalId)) {
      recordViolation('audit_integrity_violation', input, 'duplicate_goal_id');
      return;
    }
    if (!input.actorId || !input.goalId) {
      recordViolation('audit_integrity_violation', input, 'goal_identity_missing');
      return;
    }
    if (!input.sourceRef || !input.sourceRevision) {
      recordViolation('purpose_source_missing', input, 'goal_source_missing');
    }
    if (!input.intendedActivity || !input.completionConditionDigest) {
      recordViolation(
        'completion_condition_missing',
        input,
        'goal_completion_condition_missing',
      );
    }
    if (!input.cadenceKey || !input.purposeIntentDigest || !input.sourceStateDigest) {
      recordViolation('audit_integrity_violation', input, 'goal_purpose_identity_missing');
    }
    const existingActive = activeGoalByActor.get(input.actorId);
    if (existingActive) {
      recordViolation('audit_integrity_violation', input, 'multiple_active_goals');
    } else {
      activeGoalByActor.set(input.actorId, input.goalId);
    }
    if (input.cadenceKey) {
      const cadenceIdentity = `${input.actorId}\u0000${input.cadenceKey}`;
      const previous = lastGoalByCadence.get(cadenceIdentity);
      if (
        previous &&
        previous.goalId !== input.goalId &&
        previous.sourceRef === input.sourceRef &&
        previous.sourceRevision === input.sourceRevision &&
        previous.sourceStateDigest === input.sourceStateDigest
      ) {
        recordViolation(
          'duplicate_goal_without_source_change',
          input,
          'same_cadence_and_source_snapshot',
        );
      }
      lastGoalByCadence.set(cadenceIdentity, { ...input });
    }
    goals.set(input.goalId, { ...input });
    totals.goalsCreated += 1;
  };

  const recordGoalTerminal = (input: PurposeGoalTerminalObservation) => {
    if (!beginObservation('goal_terminal', input, goalTerminalDigestFields(input))) return;
    const goal = goals.get(input.goalId);
    if (!goal) {
      recordViolation('audit_integrity_violation', input, 'terminal_goal_not_created');
      return;
    }
    if (goal.actorId !== input.actorId) {
      recordViolation('audit_integrity_violation', input, 'terminal_goal_actor_mismatch');
      return;
    }
    if (goal.terminal) {
      recordViolation('audit_integrity_violation', input, 'duplicate_goal_terminal');
      return;
    }
    goal.terminal = { ...input };
    if (activeGoalByActor.get(input.actorId) === input.goalId) {
      activeGoalByActor.delete(input.actorId);
    }
    totals.goalsTerminal += 1;
    const open = openArrivals.get(input.goalId);
    if (!open) return;
    if (
      input.status !== 'completed' &&
      nonEmpty(input.reasonCode)
    ) {
      totals.followThroughExplainedTerminal += 1;
      openArrivals.delete(input.goalId);
      return;
    }
    recordUnresolvedArrival(open, input, 'goal_terminal_without_activity');
  };

  const recordActionSelected = (input: PurposeActionSelectedObservation) => {
    if (!beginObservation('action_selected', input, actionSelectedDigestFields(input))) return;
    if (actions.has(input.actionId)) {
      recordViolation('audit_integrity_violation', input, 'duplicate_action_id');
      return;
    }
    if (!input.actorId || !input.actionId) {
      recordViolation('audit_integrity_violation', input, 'action_identity_missing');
      return;
    }
    totals.actionsSelected += 1;
    actionTypes[input.actionType] = (actionTypes[input.actionType] ?? 0) + 1;
    const goal = input.goalId ? goals.get(input.goalId) : undefined;
    if (input.goalId && !goal) {
      recordViolation('audit_integrity_violation', input, 'action_goal_not_created');
    }
    if (goal?.terminal) {
      recordViolation('terminal_goal_continued', input, 'action_after_goal_terminal');
    }
    if (goal && goal.actorId !== input.actorId) {
      recordViolation('audit_integrity_violation', input, 'action_goal_actor_mismatch');
    }
    let groundedTravel = input.actionType !== 'travel';
    if (input.actionType === 'travel') {
      totals.travelsSelected += 1;
      if (!input.sourceRef || !input.sourceRevision) {
        recordViolation('purpose_source_missing', input, 'travel_source_missing');
      }
      const mismatchReasons = travelGroundingMismatches(input, goal);
      groundedTravel = mismatchReasons.length === 0;
      if (!groundedTravel) {
        recordViolation(
          'ungrounded_travel',
          input,
          `travel_grounding_mismatch:${mismatchReasons.join(',')}`,
        );
      }
    }
    const action: ActionState = { ...input, groundedTravel };
    actions.set(input.actionId, action);
    const open = input.goalId ? openArrivals.get(input.goalId) : undefined;
    if (
      open &&
      input.actionType !== 'travel' &&
      input.actionType === open.intendedActivity &&
      input.actorId === open.actorId
    ) {
      open.activityActionId = input.actionId;
    }
  };

  const recordActionTerminal = (input: PurposeActionTerminalObservation) => {
    if (!beginObservation('action_terminal', input, actionTerminalDigestFields(input))) return;
    const action = actions.get(input.actionId);
    if (!action) {
      recordViolation('audit_integrity_violation', input, 'terminal_action_not_selected');
      return;
    }
    if (action.actorId !== input.actorId) {
      recordViolation('audit_integrity_violation', input, 'terminal_action_actor_mismatch');
      return;
    }
    if (action.terminal) {
      recordViolation('audit_integrity_violation', input, 'duplicate_action_terminal');
      return;
    }
    action.terminal = { ...input };
    totals.actionsTerminal += 1;
    if (action.actionType === 'travel') {
      recordTravelTerminal(action, input);
      return;
    }
    recordActivityTerminal(action, input);
  };

  const recordTravelTerminal = (
    action: ActionState,
    terminal: PurposeActionTerminalObservation,
  ) => {
    if (terminal.status !== 'arrived') {
      if (!nonEmpty(terminal.reasonCode)) {
        recordViolation(
          'audit_integrity_violation',
          terminal,
          'travel_terminal_reason_missing',
        );
      } else {
        totals.travelExplicitTerminalBeforeArrival += 1;
      }
      return;
    }
    if (!action.groundedTravel || !action.goalId) return;
    const goal = goals.get(action.goalId);
    if (
      !goal ||
      !goal.intendedActivity ||
      !action.fromLocationId ||
      !action.targetLocationId ||
      terminal.finalLocationId !== action.targetLocationId
    ) {
      recordViolation('audit_integrity_violation', terminal, 'arrival_geometry_or_goal_missing');
      return;
    }
    const previousOpen = openArrivals.get(action.goalId);
    if (previousOpen) {
      recordUnresolvedArrival(previousOpen, terminal, 'arrival_superseded_by_new_travel');
    }
    const open: OpenArrival = {
      actorId: action.actorId,
      goalId: action.goalId,
      travelActionId: action.actionId,
      arrivedSequence: terminal.sequence,
      arrivedGameHour: terminal.gameHour,
      fromLocationId: action.fromLocationId,
      targetLocationId: action.targetLocationId,
      intendedActivity: goal.intendedActivity,
    };
    openArrivals.set(action.goalId, open);
    totals.travelsArrived += 1;
    totals.followThroughExpected += 1;
    const arrived: ArrivedTravel = {
      actorId: action.actorId,
      goalId: action.goalId,
      actionId: action.actionId,
      selectedSequence: action.sequence,
      arrivedSequence: terminal.sequence,
      arrivedGameHour: terminal.gameHour,
      fromLocationId: action.fromLocationId,
      targetLocationId: action.targetLocationId,
    };
    const previous = lastArrivedTravelByActor.get(action.actorId);
    const completesRoundTrip =
      previous &&
      arrived.arrivedGameHour - previous.arrivedGameHour <=
        PURPOSE_BEHAVIOR_ROUND_TRIP_WINDOW_HOURS &&
      previous.fromLocationId === arrived.targetLocationId &&
      previous.targetLocationId === arrived.fromLocationId;
    if (completesRoundTrip) {
      totals.roundTrips += 1;
      const explained = causalChanges.some(
        (change) =>
          change.sequence > previous.selectedSequence &&
          change.sequence <= arrived.arrivedSequence &&
          (change.actorId === undefined || change.actorId === action.actorId),
      );
      if (explained) {
        totals.roundTripsExplained += 1;
      } else {
        totals.roundTripsUnexplained += 1;
        recordViolation(
          'unexplained_round_trip',
          terminal,
          `round_trip_without_causal_change:${previous.actionId}`,
        );
      }
      // A-B-A is one round trip. Do not reuse its return leg as the outbound
      // half of an overlapping B-A-B; the next arrival starts a fresh pair.
      lastArrivedTravelByActor.delete(action.actorId);
    } else {
      lastArrivedTravelByActor.set(action.actorId, arrived);
    }
  };

  const recordActivityTerminal = (
    action: ActionState,
    terminal: PurposeActionTerminalObservation,
  ) => {
    const open = action.goalId ? openArrivals.get(action.goalId) : undefined;
    if (
      !open ||
      open.activityActionId !== action.actionId ||
      action.actionType !== open.intendedActivity
    ) {
      return;
    }
    if (terminal.status === 'completed') {
      totals.followThroughCompleted += 1;
      openArrivals.delete(open.goalId);
      return;
    }
    if (nonEmpty(terminal.reasonCode)) {
      totals.followThroughExplainedTerminal += 1;
      openArrivals.delete(open.goalId);
      return;
    }
    recordViolation('audit_integrity_violation', terminal, 'activity_terminal_reason_missing');
  };

  const recordCausalChange = (input: PurposeCausalChangeObservation) => {
    if (!beginObservation('causal_change', input, causalChangeDigestFields(input))) return;
    totals.causalChangesRecorded += 1;
    if (!input.sourceEventId || !input.sourceRef) {
      recordViolation('audit_integrity_violation', input, 'causal_change_source_missing');
      return;
    }
    if (causalEventIds.has(input.sourceEventId)) {
      recordViolation('audit_integrity_violation', input, 'duplicate_causal_event');
      return;
    }
    causalEventIds.add(input.sourceEventId);
    if (
      !input.beforeDigest ||
      !input.afterDigest ||
      input.beforeDigest === input.afterDigest
    ) {
      return;
    }
    causalChanges.push({ ...input });
    totals.causalChangesEffective += 1;
    causalKinds[input.kind] += 1;
  };

  const recordIntentionalIdle = (input: PurposeIntentionalIdleObservation) => {
    if (!beginObservation('intentional_idle', input, intentionalIdleDigestFields(input))) return;
    if (!input.actorId || !input.reasonCode) {
      recordViolation('audit_integrity_violation', input, 'intentional_idle_reason_missing');
      return;
    }
    totals.intentionalIdle += 1;
    idleReasons[input.reasonCode] = (idleReasons[input.reasonCode] ?? 0) + 1;
    if (!input.goalId) return;
    const open = openArrivals.get(input.goalId);
    const goal = goals.get(input.goalId);
    if (
      !open ||
      !goal ||
      open.actorId !== input.actorId ||
      open.intendedActivity !== 'intentional_idle' ||
      (input.sourceRef !== undefined && input.sourceRef !== goal.sourceRef)
    ) {
      recordViolation(
        'audit_integrity_violation',
        input,
        'intentional_idle_goal_mismatch',
      );
      return;
    }
    totals.followThroughCompleted += 1;
    openArrivals.delete(input.goalId);
  };

  const recordUnresolvedArrival = (
    open: OpenArrival,
    observation: { sequence: number; gameHour: number; actorId?: string; actionId?: string },
    reasonCode: string,
  ) => {
    totals.followThroughUnresolved += 1;
    recordViolation(
      'arrival_without_follow_through',
      { ...observation, actorId: open.actorId, goalId: open.goalId },
      reasonCode,
    );
    openArrivals.delete(open.goalId);
  };

  const finish = (): PurposeBehaviorReleaseAuditSummary => {
    if (finalized) return finalized;
    for (const open of [...openArrivals.values()].sort(compareOpenArrivals)) {
      const activity = open.activityActionId ? actions.get(open.activityActionId) : undefined;
      if (activity && !activity.terminal) totals.followThroughPendingAtEnd += 1;
      recordUnresolvedArrival(
        open,
        {
          sequence: Math.max(lastSequence, open.arrivedSequence),
          gameHour: Math.max(lastGameHour, open.arrivedGameHour),
          actorId: open.actorId,
          actionId: open.activityActionId ?? open.travelActionId,
        },
        activity && !activity.terminal
          ? 'activity_pending_at_release_end'
          : 'activity_missing_at_release_end',
      );
    }
    const pendingActions = [...actions.values()].filter((action) => !action.terminal).length;
    const releaseStatus = VIOLATION_CODES.some((code) => violations[code] > 0)
      ? 'fail'
      : 'pass';
    finalized = {
      auditVersion: PURPOSE_BEHAVIOR_RELEASE_AUDIT_VERSION,
      observationOnly: true,
      releaseStatus,
      violations: { ...violations },
      violationSamples: Object.fromEntries(
        VIOLATION_CODES.map((code) => [code, [...violationSamples[code]]]),
      ) as PurposeBehaviorReleaseAuditSummary['violationSamples'],
      goals: {
        created: totals.goalsCreated,
        terminal: totals.goalsTerminal,
        activeAtEnd: [...goals.values()].filter((goal) => !goal.terminal).length,
      },
      actions: {
        selected: totals.actionsSelected,
        terminal: totals.actionsTerminal,
        pendingAtEnd: pendingActions,
        byType: sortRecord(actionTypes),
      },
      travels: {
        selected: totals.travelsSelected,
        arrived: totals.travelsArrived,
        explicitTerminalBeforeArrival: totals.travelExplicitTerminalBeforeArrival,
      },
      followThrough: {
        expected: totals.followThroughExpected,
        completed: totals.followThroughCompleted,
        explainedTerminal: totals.followThroughExplainedTerminal,
        pendingAtEnd: totals.followThroughPendingAtEnd,
        unresolved: totals.followThroughUnresolved,
      },
      roundTrips: {
        detected: totals.roundTrips,
        explainedByCausalChange: totals.roundTripsExplained,
        unexplained: totals.roundTripsUnexplained,
      },
      causalChanges: {
        recorded: totals.causalChangesRecorded,
        effective: totals.causalChangesEffective,
        byKind: { ...causalKinds },
      },
      intentionalIdle: {
        total: totals.intentionalIdle,
        byReason: sortRecord(idleReasons),
      },
      traceDigest: digest.digest(),
    };
    return finalized;
  };

  return {
    recordGoalCreated,
    recordGoalTerminal,
    recordActionSelected,
    recordActionTerminal,
    recordCausalChange,
    recordIntentionalIdle,
    finish,
  };
}

export function assertPurposeBehaviorReleaseReady(
  summary: PurposeBehaviorReleaseAuditSummary,
) {
  if (
    summary.auditVersion !== PURPOSE_BEHAVIOR_RELEASE_AUDIT_VERSION ||
    summary.observationOnly !== true
  ) {
    throw new Error('purpose_behavior_release_audit_contract_mismatch');
  }
  const blocking = VIOLATION_CODES.filter((code) => summary.violations[code] !== 0);
  if (summary.releaseStatus !== 'pass' || blocking.length > 0) {
    throw new Error(`purpose_behavior_release_gate_failed:${blocking.join(',')}`);
  }
  return summary;
}

function travelGroundingMismatches(
  action: PurposeActionSelectedObservation,
  goal: GoalState | undefined,
) {
  const reasons: string[] = [];
  if (!action.goalId || !goal) reasons.push('goal');
  if (goal?.terminal) reasons.push('terminal_goal');
  if (goal && goal.actorId !== action.actorId) reasons.push('actor');
  if (!action.sourceRef || action.sourceRef !== goal?.sourceRef) reasons.push('source');
  if (!action.sourceRevision || action.sourceRevision !== goal?.sourceRevision) {
    reasons.push('source_revision');
  }
  if (
    !action.purposeIntentDigest ||
    action.purposeIntentDigest !== goal?.purposeIntentDigest
  ) {
    reasons.push('intent');
  }
  if (!action.intendedActivity || action.intendedActivity !== goal?.intendedActivity) {
    reasons.push('activity');
  }
  if (
    !action.targetLocationId ||
    action.targetLocationId !== goal?.targetLocationId
  ) {
    reasons.push('target');
  }
  if (!action.fromLocationId) reasons.push('origin');
  return reasons;
}

function zeroViolationRecord() {
  return Object.fromEntries(VIOLATION_CODES.map((code) => [code, 0])) as Record<
    PurposeBehaviorViolationCode,
    number
  >;
}

function zeroCausalKindRecord() {
  return Object.fromEntries(CAUSAL_CHANGE_KINDS.map((kind) => [kind, 0])) as Record<
    PurposeBehaviorCausalChangeKind,
    number
  >;
}

function compareOpenArrivals(left: OpenArrival, right: OpenArrival) {
  return (
    left.arrivedSequence - right.arrivedSequence || left.goalId.localeCompare(right.goalId)
  );
}

function nonEmpty(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sortRecord(record: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function assertNotFinalized(finalized: PurposeBehaviorReleaseAuditSummary | undefined) {
  if (finalized) throw new Error('purpose_behavior_release_audit_already_finalized');
}

function digestValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  return String(value).replaceAll('\\', '\\\\').replaceAll(':', '\\:');
}

function goalCreatedDigestFields(input: PurposeGoalCreatedObservation) {
  return [
    input.sequence,
    input.gameHour,
    input.actorId,
    input.goalId,
    input.cadenceKey,
    input.purposeIntentDigest,
    input.sourceRef,
    input.sourceRevision,
    input.sourceStateDigest,
    input.targetLocationId,
    input.intendedActivity,
    input.completionConditionDigest,
  ];
}

function goalTerminalDigestFields(input: PurposeGoalTerminalObservation) {
  return [
    input.sequence,
    input.gameHour,
    input.actorId,
    input.goalId,
    input.status,
    input.reasonCode,
  ];
}

function actionSelectedDigestFields(input: PurposeActionSelectedObservation) {
  return [
    input.sequence,
    input.gameHour,
    input.actorId,
    input.actionId,
    input.actionType,
    input.goalId,
    input.purposeIntentDigest,
    input.sourceRef,
    input.sourceRevision,
    input.intendedActivity,
    input.fromLocationId,
    input.targetLocationId,
  ];
}

function actionTerminalDigestFields(input: PurposeActionTerminalObservation) {
  return [
    input.sequence,
    input.gameHour,
    input.actorId,
    input.actionId,
    input.status,
    input.reasonCode,
    input.finalLocationId,
  ];
}

function causalChangeDigestFields(input: PurposeCausalChangeObservation) {
  return [
    input.sequence,
    input.gameHour,
    input.actorId,
    input.kind,
    input.sourceEventId,
    input.sourceRef,
    input.beforeDigest,
    input.afterDigest,
  ];
}

function intentionalIdleDigestFields(input: PurposeIntentionalIdleObservation) {
  return [
    input.sequence,
    input.gameHour,
    input.actorId,
    input.reasonCode,
    input.goalId,
    input.sourceRef,
  ];
}

class AuditDigest {
  private left = 0x811c9dc5;
  private right = 0x9e3779b9;

  update(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      this.left = Math.imul(this.left ^ code, 0x01000193) >>> 0;
      this.right = Math.imul(this.right ^ code, 0x85ebca6b) >>> 0;
      this.right = (this.right ^ (this.right >>> 13)) >>> 0;
    }
  }

  digest() {
    return `stable64:${this.left.toString(16).padStart(8, '0')}${this.right
      .toString(16)
      .padStart(8, '0')}`;
  }
}
