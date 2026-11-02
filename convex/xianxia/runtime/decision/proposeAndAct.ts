import { v } from 'convex/values';
import { internalAction } from '../../../_generated/server';
import { internal } from '../../../_generated/api';
import { chatCompletion } from '../../../util/llm';
import { ACTOR_INCAPACITATED_SKIP_REASON, assertAgentProviderCallAllowed, buildAgentMessages, buildValleyMovementMessages, parseProposal, parseValleyMovementDecision, evaluateAgentAutonomousReserveGate, planGatherIntent, planShopTradeIntent, planGroupConversationTurnIntent, planGroupDecisionIntent, planSurvivalEnvelope, planValleyAutonomy, planStrategicIntent, applyAgentCultivationMode, type AgentContext, type AgentProposal } from '../../agentLogic';
import type { ActionType } from '../../actionSchema';
import { planRoutineIntent } from '../../routineLogic';
import { isActorDeceased, isActorIncapacitated } from '../../lifeStateLogic';
import { planNegotiation } from '../../negotiationAgentLogic';
import { socialLlmSwitches } from '../../socialModelPolicy';
import { personalGoalPlanForPurposeGoalContinuation, resolvePurposeGoalContinuation } from '../../purposeBoundLifeGoalLogic';
import { purposeGoalInterruptionForProposal, purposeGoalRevalidationDeferredBySession, resolveActivePurposeGoal } from '../../purposeGoalCadenceLogic';
import { autonomousAgentLlmEnabled, buildPersonalGoalPlanForProposal, buildAutonomyDecisionTrace, selectPersonaPreferredProposal } from '../../autonomyDecisionTraceLogic';
import type { AutonomyDecisionSource } from '../../autonomyDecisionContracts';
import { traceProposalDecisionSource, traceResultDecisionSource } from '../../runtimeAgentDecisionRoutingPort';
import { modelSelectedExistingProposal } from '../../runtimeAgentModelSelectionPort';
import type { ActivePersonalGoal, PersonalGoalPlan } from '../../personalGoalContracts';
import type { ProposeResult, SubmitResult } from '../agentContracts';
import { buildRuntimeAgentAdmission } from '../admission/runtimeAgentAdmission';

// 单个角色：产意图 → 提交。LLM 失败或输出非法都会被 parseProposal 兜底，不会卡住。
export const proposeAndAct = internalAction({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    decisionId: v.optional(v.string()),
    // Optional logical instant (fixtures and soaks); ordinary callers use the wall clock.
    now: v.optional(v.number()),
    // provider=0 contract: no model call for this turn even if deployment switches are on.
    providerPolicy: v.optional(v.literal('disabled')),
  },
  handler: async (ctx, args): Promise<ProposeResult> => {
    const decisionNow = args.now ?? Date.now();
    if (!Number.isFinite(decisionNow) || decisionNow < 0) {
      throw new Error('agent_decision_now_invalid');
    }
    await ctx.runMutation(internal.xianxia.personalGoals.preparePersonalGoal, {
      worldId: args.worldId,
      actorId: args.actorId,
      now: decisionNow,
    });
    const context = await ctx.runQuery(internal.xianxia.agent.agentContext, {
      worldId: args.worldId,
      actorId: args.actorId,
      now: decisionNow,
      autonomyIntentVersion: 'purpose_v2',
    });
    if (!context) return { actorId: args.actorId, skipped: 'no_profile' };
    const traceEnabled = !context.self.actorId.startsWith('qinglan_valley_gate:');
    const personalGoalEnabled = traceEnabled;
    let personalGoalPlan: PersonalGoalPlan | undefined;
    let selectedPersonalGoal: ActivePersonalGoal | undefined;
    let personaExceptionReason: string | undefined;
    let personaExceptionSourceIds: string[] = [];
    const recordTrace = async (input: {
      selectedProposal?: AgentProposal;
      decisionSource: AutonomyDecisionSource;
      idleReasonCode?: string;
      providerAttempted?: boolean;
      exceptionReason?: string;
      exceptionSourceIds?: string[];
    }) => {
      if (!traceEnabled) return {};
      const builtTrace = buildAutonomyDecisionTrace({
        context,
        now: decisionNow,
        selectedProposal: input.selectedProposal,
        decisionSource: input.decisionSource,
        idleReasonCode: input.idleReasonCode,
        exceptionReason:
          input.exceptionReason ??
          personaExceptionReason ??
          (input.providerAttempted === true && input.decisionSource === 'fallback'
            ? 'provider_attempt_failed'
            : input.providerAttempted === false && input.decisionSource === 'fallback'
              ? 'provider_disabled'
              : undefined),
        exceptionSourceIds: input.exceptionSourceIds ?? personaExceptionSourceIds,
      });
      const trace = builtTrace;
      const recorded = await ctx.runMutation(
        internal.xianxia.autonomyDecisionTrace.recordAutonomyDecisionTrace,
        { worldId: args.worldId, trace },
      );
      return {
        decisionTrace: recorded.trace,
        decisionTraceId: recorded.traceId,
        decisionTraceReplay: recorded.idempotentReplay,
      };
    };
    const attachTrace = async (
      result: ProposeResult,
      sourceOverride?: AutonomyDecisionSource,
    ): Promise<ProposeResult> => {
      if (result.decisionTrace && result.decisionTraceId) return result;
      const selectedProposal = 'proposal' in result ? result.proposal : undefined;
      const source = sourceOverride ?? traceResultDecisionSource({
        decisionSource: 'decisionSource' in result ? result.decisionSource : undefined,
        skipped: 'skipped' in result ? result.skipped : undefined,
        proposal: selectedProposal,
      });
      const traceAttachment = await recordTrace({
        selectedProposal,
        decisionSource: source,
        idleReasonCode: 'skipped' in result ? result.skipped : undefined,
        providerAttempted: result.providerAttempted,
      });
      return {
        ...result,
        ...traceAttachment,
      };
    };
    // 死亡/失能者在任何规划或 provider 调用之前退出。
    if (isActorDeceased(context.self)) {
      return await attachTrace({ actorId: args.actorId, skipped: 'actor_deceased' });
    }
    if (isActorIncapacitated(context.self.health)) {
      return await attachTrace({
        actorId: args.actorId,
        skipped: ACTOR_INCAPACITATED_SKIP_REASON,
      });
    }
    if (context.activeExecution) {
      return await attachTrace({ actorId: args.actorId, skipped: 'action_execution_active' });
    }
    if (context.personalGoal?.lastActionRecordId) {
      return await attachTrace({
        actorId: args.actorId,
        skipped: 'personal_goal_action_pending',
        personalGoal: context.personalGoal,
      });
    }

    const persistIdle = async (reasonCode: string) => {
      if (!personalGoalEnabled) return;
      await ctx.runMutation(internal.xianxia.personalGoals.selectPersonalGoal, {
        worldId: args.worldId,
        actorId: args.actorId,
        observationRevision:
          context.lifeObservation?.observationRevision ?? `missing:${args.actorId}`,
        backlog: [],
        idleReasonCode: reasonCode,
        now: decisionNow,
      });
    };

    let proposal: AgentProposal | null = null;
    let decisionSource: 'rule' | 'llm' | 'fallback' = 'rule';
    let providerAttempted = false;
    const providerDisabled = args.providerPolicy === 'disabled';
    const socialRuntimeRequested =
      !providerDisabled && socialLlmSwitches(process.env).deploymentEnabled;
    const autonomousLlmEnabled =
      !providerDisabled && autonomousAgentLlmEnabled(process.env.XIANXIA_AGENT_LLM_ENABLED);
    const runConversationProvider = async (): Promise<ProposeResult> => {
      assertAgentProviderCallAllowed(args.providerPolicy);
      return (await ctx.runAction(internal.xianxia.conversationModel.runConversationModelTurn, {
        worldId: args.worldId,
        actorId: args.actorId,
        decisionId: args.decisionId,
      })) as ProposeResult;
    };
    const survivalPlan = planSurvivalEnvelope(context);
    if (survivalPlan.kind === 'wait') {
      return await attachTrace({
        actorId: args.actorId,
        skipped: survivalPlan.reasonCode,
      });
    }
    const mandatorySurvival =
      survivalPlan.kind === 'act' &&
      !(
        survivalPlan.envelope.state === 'danger' &&
        survivalPlan.envelope.urgency === 85 &&
        survivalPlan.envelope.decision.kind === 'attack'
      )
        ? survivalPlan.proposal
        : undefined;
    if (
      !mandatorySurvival &&
      context.personalGoal?.purposeIntentDigest &&
      context.personalGoal.purposeStage &&
      !purposeGoalRevalidationDeferredBySession(context)
    ) {
      const activeResolution = resolveActivePurposeGoal(
        context,
        context.personalGoal,
      );
      if (!activeResolution.ok) {
        await ctx.runMutation(
          internal.xianxia.personalGoals.failPurposePersonalGoal,
          {
            worldId: args.worldId,
            actorId: args.actorId,
            goalId: context.personalGoal.goalId,
            intentDigest: context.personalGoal.purposeIntentDigest,
            reasonCode: activeResolution.reasonCode,
            now: decisionNow,
          },
        );
        return await attachTrace({
          actorId: args.actorId,
          skipped: activeResolution.reasonCode,
        });
      }
    }
    if (mandatorySurvival) {
      proposal = mandatorySurvival;
    }
    if (
      !proposal &&
      context.personalGoal?.purposeStage === 'activity_ready' &&
      context.personalGoal.purposeIntentDigest
    ) {
      const continuation = resolvePurposeGoalContinuation(
        context,
        context.personalGoal,
      );
      if (!continuation.ok) {
        await ctx.runMutation(
          internal.xianxia.personalGoals.failPurposePersonalGoal,
          {
            worldId: args.worldId,
            actorId: args.actorId,
            goalId: context.personalGoal.goalId,
            intentDigest: context.personalGoal.purposeIntentDigest,
            reasonCode: continuation.reasonCode,
            now: decisionNow,
          },
        );
        return await attachTrace({
          actorId: args.actorId,
          skipped: continuation.reasonCode,
        });
      }
      proposal = continuation.proposal;
      personalGoalPlan = personalGoalPlanForPurposeGoalContinuation({
        goal: context.personalGoal,
        continuation,
      });
    }
    if (!proposal && context.activeGroupConversation) {
      proposal = planGroupDecisionIntent(context);
      if (
        !proposal &&
        context.activeGroupDecision?.mediationExhausted &&
        context.self.inventory.some((item) => item.itemId === 'spirit_herb' && item.qty > 0)
      ) {
        return await attachTrace({
          actorId: args.actorId,
          skipped: 'group_mediation_exhausted',
        });
      }
      if (
        !proposal &&
        socialRuntimeRequested &&
        context.activeGroupConversation.role === 'participant' &&
        context.activeGroupConversation.currentSpeakerActorId === context.self.actorId
      ) {
        const modelResult = await runConversationProvider();
        return await attachTrace(modelResult, 'llm');
      }
      proposal ??= planGroupConversationTurnIntent(context);
      if (!proposal) {
        return await attachTrace({
          actorId: args.actorId,
          skipped: 'group_floor_or_vote_wait',
        });
      }
    }
    if (!proposal && context.activeConversation && socialRuntimeRequested) {
      const modelResult = await runConversationProvider();
      return await attachTrace(modelResult, 'llm');
    }
    if (!proposal && context.activeConversation) {
      proposal = planNegotiation(context);
    }
    if (!proposal && context.activeConversation) {
      // Keep the provider=0 boundary adjacent to the final conversation-model
      // call. Earlier deterministic negotiation planning may run, but an
      // unresolved conversation must fail closed for Pi NPC turns.
      if (providerDisabled) {
        return await attachTrace(
          {
            actorId: args.actorId,
            skipped: 'provider_disabled',
            providerAttempted: false,
          },
          'fallback',
        );
      }
      const modelResult = await runConversationProvider();
      return await attachTrace(modelResult);
    }
    if (
      !proposal &&
      !context.activeConversation &&
      !context.activeGroupConversation &&
      !context.self.actorId.startsWith('qinglan_valley_gate:')
    ) {
      const personaChoice = selectPersonaPreferredProposal(context, decisionNow);
      if (personaChoice) {
        proposal = personaChoice.proposal;
        personalGoalPlan = personaChoice.personalGoalPlan;
        personaExceptionReason = personaChoice.exceptionReason;
        personaExceptionSourceIds = personaChoice.exceptionSourceIds;
      }
    }
    if (!proposal) proposal = planGatherIntent(context);
    if (!proposal) proposal = planShopTradeIntent(context);
    const valleyPlan = planValleyAutonomy(context, decisionNow);
    if (!proposal && valleyPlan?.kind === 'skip') {
      return await attachTrace({ actorId: args.actorId, skipped: valleyPlan.reason });
    }
    if (!proposal && valleyPlan?.kind === 'act') proposal = valleyPlan.proposal;
    if (!proposal && valleyPlan?.kind === 'llm') {
      if (providerDisabled) {
        return await attachTrace(
          {
            actorId: args.actorId,
            skipped: 'provider_disabled',
            providerAttempted: false,
          },
          'fallback',
        );
      }
      const candidateCount = (context.knownLocations ?? []).filter(
        (location) => location.locationId !== context.self.currentLocationId,
      ).length;
      if (valleyPlan.requireMove && candidateCount < 2) {
        return await attachTrace({
          actorId: args.actorId,
          skipped: 'insufficient_movement_candidates',
        });
      }
      const { system, user } = buildValleyMovementMessages(context, {
        requireMove: valleyPlan.requireMove,
      });
      let modelUnavailable = true;
      for (let attempt = 0; attempt < 2 && !proposal; attempt += 1) {
        try {
          assertAgentProviderCallAllowed(args.providerPolicy);
          const response = await chatCompletion({
            messages: [
              { role: 'system', content: system },
              {
                role: 'user',
                content:
                  attempt === 0
                    ? user
                    : `${user}\n上次输出未通过结构或目标校验，请严格按 JSON 格式重新选择。`,
              },
            ],
            max_tokens: 220,
            temperature: 0.55,
            response_format: { type: 'json_object' },
          });
          modelUnavailable = false;
          const decision = parseValleyMovementDecision(response.content, context, {
            requireMove: valleyPlan.requireMove,
          });
          if (decision?.kind === 'wait') {
            return await attachTrace(
              { actorId: args.actorId, skipped: `llm_wait:${decision.reason}` },
              'llm',
            );
          }
          if (decision?.kind === 'move') {
            proposal = decision.proposal;
            decisionSource = 'llm';
          }
        } catch (error) {
          console.error(`valley agent ${args.actorId} LLM attempt ${attempt + 1} failed:`, error);
        }
      }
      if (!proposal) {
        return await attachTrace(
          {
            actorId: args.actorId,
            skipped: modelUnavailable ? 'llm_unavailable' : 'llm_invalid_output',
          },
          'llm',
        );
      }
    }

    if (!proposal && !valleyPlan) {
      // M7：先看有无明确目标（履行委托 / 为目标 travel）。有则直接采用，省一次 LLM。
      proposal = planStrategicIntent(context);
      // W4a/W4b：再按本分日程定夺——有对话需求才说话；无合法事可做就守职 skip（不空转）。
      const hasOfferedRequest = (context.activeRequests ?? []).some(
        (request) => request.status === 'offered',
      );
      if (!proposal && !hasOfferedRequest) {
        const routine = planRoutineIntent(context);
        if (routine.kind === 'skip') {
          await persistIdle(routine.reason);
          return await attachTrace({ actorId: args.actorId, skipped: routine.reason });
        }
        if (routine.kind === 'act') proposal = routine.proposal;
        // routine.kind === 'defer' → 落到下面让 LLM 添变化（仅自由弟子会到这）
      }
    }
    if (!proposal && !valleyPlan) {
      // 自由弟子的非社交变化：LLM 在**不含 talk** 的可用动作里选（talk 只由需求触发）。
      const noTalk: AgentContext = {
        ...context,
        availableActions: context.availableActions.filter((a: ActionType) => a !== 'talk'),
      };
      const { system, user } = buildAgentMessages(noTalk);
      let content = '';
      if (autonomousLlmEnabled) {
        providerAttempted = true;
        try {
          assertAgentProviderCallAllowed(args.providerPolicy);
          const res = await chatCompletion({
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            max_tokens: 200,
            temperature: 0.7,
            response_format: { type: 'json_object' },
          });
          content = res.content;
        } catch (e) {
          console.error(`agent ${args.actorId} LLM 失败，兜底：`, e);
        }
      }
      proposal = parseProposal(content, noTalk);
      decisionSource = modelSelectedExistingProposal(content, proposal) ? 'llm' : 'fallback';
      // W4b-C：没有任何合法动作 → 守本分，不提交必被拒的动作。
      if (!proposal) {
        await persistIdle('no_meaningful_action');
        return await attachTrace(
          {
            actorId: args.actorId,
            skipped: 'no_meaningful_action',
            providerAttempted,
          },
          decisionSource,
        );
      }
    }
    if (!proposal) {
      await persistIdle('no_meaningful_action');
      return await attachTrace({ actorId: args.actorId, skipped: 'no_meaningful_action' });
    }
    proposal = applyAgentCultivationMode(proposal, context);
    const reserveGate = evaluateAgentAutonomousReserveGate(context, proposal);
    if (!reserveGate.ok) {
      await persistIdle(reserveGate.reasonCode);
      return await attachTrace({
        actorId: args.actorId,
        skipped: reserveGate.reasonCode,
      });
    }
    if (personalGoalEnabled) {
      personalGoalPlan ??= buildPersonalGoalPlanForProposal(context, decisionNow, proposal);
      const preservesGoalDuringBoundedSocialSession = Boolean(
        context.personalGoal?.purposeIntentDigest &&
          !mandatorySurvival &&
          (context.activeConversation || context.activeGroupConversation) &&
          !personalGoalPlan.selected,
      );
      if (!preservesGoalDuringBoundedSocialSession) {
        const interruption = context.personalGoal?.purposeIntentDigest
          ? purposeGoalInterruptionForProposal({
              context,
              proposal,
              selected: personalGoalPlan.selected,
            })
          : undefined;
        const goalState = await ctx.runMutation(
          internal.xianxia.personalGoals.selectPersonalGoal,
          {
            worldId: args.worldId,
            actorId: args.actorId,
            observationRevision:
              context.lifeObservation?.observationRevision ?? `missing:${args.actorId}`,
            selected: personalGoalPlan.selected,
            backlog: personalGoalPlan.backlog,
            idleReasonCode: personalGoalPlan.selected
              ? undefined
              : `one_shot_action:${proposal.type}`,
            interruption,
            now: decisionNow,
          },
        );
        if (goalState.state === 'active') selectedPersonalGoal = goalState.goal;
        if (goalState.state === 'committed') {
          return await attachTrace({
            actorId: args.actorId,
            skipped: goalState.reasonCode,
            personalGoal: goalState.goal,
          });
        }
        if (goalState.state === 'cadence_wait') {
          return await attachTrace({
            actorId: args.actorId,
            skipped: goalState.reasonCode,
          });
        }
      } else {
        // A current conversation owns this immediate social turn but does not
        // invalidate or replace the actor's unrelated purpose goal. The goal
        // is revalidated from fresh facts after the bounded session ends.
        selectedPersonalGoal = undefined;
      }
    }
    // Persist the immutable choice before the action commit. A replay conflict
    // must stop here instead of producing an action that cannot be audited.
    const traceAttachment = await recordTrace({
      selectedProposal: proposal,
      decisionSource: traceProposalDecisionSource(proposal, decisionSource),
      providerAttempted,
    });
    // 统一经 gm.act 提交：steal 会先走弱 GM 裁决，其余直接落地。
    const result: SubmitResult = await ctx.runAction(
      internal.xianxia.gm.actInternal,
      buildRuntimeAgentAdmission({
      worldId: args.worldId,
      actorId: args.actorId,
      proposal,
      decisionId: args.decisionId,
      providerDisabled,
      selectedPersonalGoal,
      }),
    );
    if (selectedPersonalGoal) {
      await ctx.runMutation(internal.xianxia.personalGoals.recordPersonalGoalAttempt, {
        worldId: args.worldId,
        actorId: args.actorId,
        goalId: selectedPersonalGoal.goalId,
        actionRecordId: result.actionRecordId,
        actionType: proposal.type,
        resultStatus: result.status,
        resultCode: result.resultCode,
        now: Date.now(),
      });
    }
    return {
      actorId: args.actorId,
      proposal,
      result,
      decisionSource,
      providerAttempted,
      personalGoal: selectedPersonalGoal,
      ...traceAttachment,
    };
  },
});
