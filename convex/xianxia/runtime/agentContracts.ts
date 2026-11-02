import type { Id } from '../../_generated/dataModel';
import { type AgentProposal } from '../agentLogic';
import type { ActionResult } from '../actionSchema';
import { type AgentTickReservation } from '../agentTickScheduler';
import type { AutonomyDecisionTrace } from '../autonomyDecisionContracts';
import type { ActivePersonalGoal } from '../personalGoalContracts';
import type { WorldDirectorTickResult } from '../worldPressureContracts';

// submitAction 的返回形状（finalize 总是返回 result + 两个 id）。
export type SubmitResult = ActionResult & {
  eventId: Id<'worldEvents'>;
  actionRecordId: Id<'actionRecords'>;
};

// proposeAndAct 的返回（显式标注以打破 Convex 自引用类型循环 / TS7022）。
export type ProposeResult =
  // skipped 原因：no_profile / 守职不动（awaiting_customer/on_watch/on_duty…）/ no_meaningful_action
  | {
      actorId: string;
      skipped: string;
      decisionTrace?: AutonomyDecisionTrace;
      decisionTraceId?: Id<'autonomyDecisionTraces'>;
      decisionTraceReplay?: boolean;
      providerAttempted?: boolean;
      personalGoal?: ActivePersonalGoal;
      validatedObservationRevision?: string;
      selectedCandidateId?: string;
      selectedCandidateFingerprint?: string;
    }
  | {
      actorId: string;
      proposal: AgentProposal;
      result: SubmitResult;
      decisionSource: 'rule' | 'llm' | 'fallback';
      decisionTrace?: AutonomyDecisionTrace;
      decisionTraceId?: Id<'autonomyDecisionTraces'>;
      decisionTraceReplay?: boolean;
      providerAttempted?: boolean;
      personalGoal?: ActivePersonalGoal;
      validatedObservationRevision?: string;
      selectedCandidateId?: string;
      selectedCandidateFingerprint?: string;
    };

export type AgentTickLeaseView = {
  acquired: boolean;
  tickId: string;
  owner: string;
  status?: 'completed';
  reason?: string;
  activeTickId?: string;
  recoveredExpiredTickId?: string;
};

export type AcquireAgentTickLeaseResult =
  | {
      acquired: true;
      recoveredExpiredTickId?: string;
      lease: {
        tickId: string;
        mapId?: string;
        owner: string;
        acquiredAt: number;
        expiresAt: number;
      };
    }
  | {
      acquired: false;
      reason: 'tick_already_completed' | 'tick_already_active' | 'tick_lease_busy';
      activeLease?: { tickId: string };
    };

export type AgentTickResult = {
  ticked: number;
  results: AgentTickActorResult[];
  scheduler: AgentTickReservation;
  qinglan: { mapId: string; [key: string]: unknown };
  director?: WorldDirectorTickResult;
  lease: AgentTickLeaseView;
};

// 每名角色这一回合的结果，都来自规则层 proposeAndAct。
export type AgentTickActorResult = ProposeResult;
