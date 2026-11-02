import { v } from 'convex/values';
import { internalQuery } from '../../../_generated/server';
import { ownedHealingItemId, isAgentInteractionTargetEligible, type AgentContext } from '../../agentLogic';
import type { ActionType } from '../../actionSchema';
import { readGameHour } from '../../config';
import { MS_PER_GAME_HOUR } from '../../timeLogic';
import { personaFragment } from '../../personalityLogic';
import { QINGLAN_VALLEY_GATE_DATA } from '../../../../data/qinglanValleyGate.generated';
import { ACTIVE_ACTION_EXECUTION_STATUSES } from '../../actionExecutionContracts';
import { normalizeFatigue } from '../../fatigueLogic';
import { availableCultivationModes } from '../../cultivationResourceLogic';
import { quoteShopPurchase, quoteShopSale, refreshShopState } from '../../shopLogic';
import { buildEventCompensationOpportunity, buildHerbTradeOpportunity, buildRequestDeadlineOpportunity } from '../../negotiationAgentLogic';
import { termsFromProposal } from '../../negotiations';
import { relationshipDimsAt } from '../../relationshipLogic';
import { evaluateTradeActionCooldown } from '../../tradeLogic';
import { evaluateGiftActionCooldown } from '../../giftLogic';
import { requestRevision } from '../../questLogic';
import { buildLifeObservation, stableObservationDigest } from '../../lifeObservation';
import { bindRuntimeAgentObservation } from '../../runtimeAgentObservationPort';
import { buildPurposeBoundLifeCandidateBundle } from '../../purposeBoundLifeCandidateLogic';
import { buildSameLocationSocialOpportunityBundle, deriveSameLocationSocialSources, sameLocationSocialSourceDigest } from '../../sameLocationSocialOpportunityLogic';
import { prepareSocialOutcomeBinding } from '../../socialOutcomeContracts';
import { socialOutcomeScopeAvailable, socialOutcomeSourceAvailable } from '../../socialOutcomeReceipts';
import { isSocialActorBusy, loadAcceptedSocialInvitationSource, loadPendingSocialInvitationSource } from '../../socialInvitations';
import { deriveRemoteSocialInvitationOpportunities } from '../../remoteSocialInvitationOpportunityLogic';
import { loadActorGroupSocialCoordination, loadGroupSocialOpportunities } from '../../groupSocialInitiations';
import { buildGroupSocialCoordinationCandidates } from '../../groupSocialCoordinationLogic';
import { composeRuntimeAgentCandidateSource } from '../../runtimeAgentCandidateSourcePort';
import { loadActorSharedPlanSources } from '../../sharedPlans';
import { PURPOSE_GOAL_CADENCE_HISTORY_LIMIT } from '../../purposeGoalCadenceLogic';
import { projectRuntimeAgentBeliefs } from '../../runtimeAgentBeliefProjectionPort';
import { loadRuntimeAgentActionRead, loadRuntimeAgentCombatRead, loadRuntimeAgentContextBootstrap, loadRuntimeAgentMemoryRead, loadRuntimeAgentSocialRead } from '../../runtimeAgentContextReadPort';
import { personalGoalRowToActiveGoal } from '../../personalGoals';
import { boundedObservedWorldPressures } from '../../worldPressureLogic';
import { refreshResourceStock, resourceAccessAllowed } from '../../resourceNodeLogic';
import { projectGratitudeDueConsequences, projectGrievanceCreatedConsequences } from '../../socialConsequenceProjectionLogic';
import { grievanceProjectionSourceEvidenceValid } from '../../socialConsequenceContracts';
import { MAX_KNOWN_LOCATIONS, MAX_ACTIVE_REQUESTS, MAX_RESOURCE_NODES, VALLEY_MAP_ID, isGodotSmokeActor, memoryTouchesGodotSmoke, sessionRecipientsExhausted } from '../agentHelpers';

// 组装某角色的决策上下文（单次一致快照）。
export const agentContext = internalQuery({
  args: {
    worldId: v.id('worlds'),
    actorId: v.string(),
    now: v.number(),
    autonomyIntentVersion: v.optional(
      v.union(v.literal('legacy_v1'), v.literal('purpose_v2')),
    ),
  },
  handler: async (ctx, args): Promise<AgentContext | null> => {
    const bootstrap = await loadRuntimeAgentContextBootstrap(ctx, args);
    if (!bootstrap) return null;
    const {
      purposeIntentV2, self, resultHabitPreferences, activePersonalGoalRow, selfMapId,
      incapacitated, activeExecution, activeConversationDoc, activeGroupMembership,
      activeGroupConversationDoc, gt, nowGameHour, nowGameDay,
    } = bootstrap;
    const recentPurposeGoalRows = purposeIntentV2
      ? await ctx.db
          .query('personalGoals')
          .withIndex('byActorRevision', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', args.actorId),
          )
          .order('desc')
          .take(PURPOSE_GOAL_CADENCE_HISTORY_LIMIT)
      : [];
    const personalGoalCadences: NonNullable<AgentContext['personalGoalCadences']> = [];
    for (const goal of recentPurposeGoalRows) {
      if (
        !goal.purposeIntent ||
        !goal.purposeCadenceKey ||
        goal.status === 'active' ||
        goal.status === 'idle' ||
        goal.terminalGameHour === undefined ||
        goal.nextEligibleGameHour === undefined ||
        goal.nextEligibleGameHour <= nowGameHour ||
        !goal.terminalReasonCode
      ) {
        continue;
      }
      personalGoalCadences.push({
        goalId: goal.goalId,
        cadenceKey: goal.purposeCadenceKey,
        sourceRef: goal.purposeIntent.sourceRef,
        sourceRevision: goal.purposeIntent.sourceRevision,
        purposeKind: goal.purposeIntent.purposeKind,
        intendedActivity: goal.purposeIntent.intendedActivity,
        terminalStatus: goal.status,
        terminalReasonCode: goal.terminalReasonCode,
        terminalGameHour: goal.terminalGameHour,
        nextEligibleGameHour: goal.nextEligibleGameHour,
      });
    }
    const socialRead = await loadRuntimeAgentSocialRead(ctx, {
      worldId: args.worldId, self, selfMapId, nowGameDay, isSmokeActor: isGodotSmokeActor,
    });
    const { effectiveRelationships, relationshipByActor, relationshipRowByActor, relationshipViewFor, others } = socialRead;
    // 关系驱动的对话不能因为同地点分页恰好截断了挚友而消失。最多精确补载
    // 4 名正向关系最高的角色；仍逐一复核地图、地点、生命状态与测试角色边界。
    const valuedRelationshipTargets = [...effectiveRelationships]
      .filter(({ dims }) => dims.affinity >= 25)
      .sort(
        (a, b) =>
          b.dims.affinity - a.dims.affinity || a.row.toActorId.localeCompare(b.row.toActorId),
      )
      .slice(0, 4);
    for (const relationship of valuedRelationshipTargets) {
      if (others.some((other) => other.actorId === relationship.row.toActorId)) continue;
      const target = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', relationship.row.toActorId),
        )
        .first();
      if (
        !target ||
        target.actorId === self.actorId ||
        isGodotSmokeActor(target.actorId) ||
        !isAgentInteractionTargetEligible(target) ||
        (target.mapId ?? 'world') !== selfMapId ||
        !self.currentLocationId ||
        target.currentLocationId !== self.currentLocationId
      ) {
        continue;
      }
      others.push({
        actorId: target.actorId,
        name: target.name,
        role: target.role,
        realm: target.realm,
        ...relationshipViewFor(target.actorId),
      });
    }

    const actionRead = await loadRuntimeAgentActionRead(ctx, {
      worldId: args.worldId, now: args.now, self, selfMapId, incapacitated,
    });
    const { locationOnSameMap, roleKit, availableActions, maxHealth, breakthroughReady } = actionRead;

    const combatRead = await loadRuntimeAgentCombatRead(ctx, {
      worldId: args.worldId, now: args.now, self, selfMapId, incapacitated, locationOnSameMap,
    });
    const { activeCombatEncounter, opponentActorId, opponent, lootTargets } = combatRead;
    if (activeCombatEncounter && !availableActions.includes('flee')) availableActions.push('flee');
    if (lootTargets.some((target) => target.priorityAllowed && target.items.length > 0)) {
      if (!availableActions.includes('loot')) availableActions.push('loot');
    }

    // M5 知识过滤（directive E）：agent 只看「自己听说/记得」的事，不再读全局事件。
    // W3b：过期以当前游戏小时为基准；W4a：顺带取当前昼夜阶段供「按时辰生活」。
    const memoryRead = await loadRuntimeAgentMemoryRead(ctx, {
      worldId: args.worldId, actorId: self.actorId, nowGameHour,
      isSmokeActor: isGodotSmokeActor, touchesSmoke: memoryTouchesGodotSmoke,
    });
    const { mems, socialSummaryRows, observationBeliefRows, memorySourceEventById, socialSummaries } = memoryRead;
    let recentEvents = memoryRead.recentEvents;
    let recentMapEventTypes: string[] = [];
    if (selfMapId === VALLEY_MAP_ID) {
      const localEvents = await ctx.db
        .query('worldEvents')
        .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', VALLEY_MAP_ID))
        .order('desc')
        .take(8);
      recentEvents = [
        ...new Set([...localEvents.map((event) => event.summary), ...recentEvents]),
      ].slice(0, 8);
      recentMapEventTypes = localEvents.map((event) => event.type);
    }
    let activeConversation: AgentContext['activeConversation'];
    let activeGroupConversation: AgentContext['activeGroupConversation'];
    let activeGroupDecision: AgentContext['activeGroupDecision'];
    let activeNegotiation: AgentContext['activeNegotiation'];
    let negotiationOpportunity: AgentContext['negotiationOpportunity'];
    let negotiationRelationship: number | undefined;
    if (activeConversationDoc) {
      const otherActorId =
        activeConversationDoc.actorAId === self.actorId
          ? activeConversationDoc.actorBId
          : activeConversationDoc.actorAId;
      const other = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', otherActorId))
        .first();
      const turns = await ctx.db
        .query('conversationUtterances')
        .withIndex('byConversationTurn', (q) =>
          q.eq('worldId', args.worldId).eq('conversationId', activeConversationDoc.conversationId),
        )
        .order('desc')
        .take(8);
      const beliefs = await ctx.db
        .query('actorBeliefs')
        .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', self.actorId))
        .order('desc')
        .take(12);
      activeConversation = {
        conversationId: activeConversationDoc.conversationId,
        topicId: activeConversationDoc.topicId,
        otherActorId,
        otherActorName: other?.name ?? otherActorId,
        currentSpeakerActorId: activeConversationDoc.currentSpeakerActorId,
        turnNumber: activeConversationDoc.turnNumber,
        maxTurns: activeConversationDoc.maxTurns,
        expiresAt: activeConversationDoc.expiresAt,
        recentTurns: turns.reverse().map((turn) => ({
          turnNumber: turn.turnNumber,
          speakerActorId: turn.speakerActorId,
          speechAct: turn.speechAct,
          utteranceText: turn.utteranceText,
        })),
        visibleFacts: mems
          .filter(
            (memory) =>
              memory.expiresAt > nowGameHour &&
              memory.source !== 'rumor' &&
              !(memory.distorted ?? false),
          )
          .slice(0, 8)
          .map((memory) => ({
            eventId: memory.sourceEventId,
            summary: memory.summary,
            source: memory.source ?? 'direct',
          })),
        beliefs: await projectRuntimeAgentBeliefs(
          ctx,
          args.worldId,
          self.actorId,
          activeConversationDoc.topicId,
          beliefs,
        ),
      };
      if (!incapacitated && !availableActions.includes('talk')) availableActions.push('talk');
      if (
        !incapacitated &&
        roleKit.includes('negotiate') &&
        !availableActions.includes('negotiate')
      ) {
        availableActions.push('negotiate');
      }
      negotiationRelationship = relationshipByActor.get(otherActorId) ?? 0;
      let negotiationSession = await ctx.db
        .query('negotiationSessions')
        .withIndex('byConversationStatus', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('conversationId', activeConversationDoc.conversationId)
            .eq('status', 'opened'),
        )
        .first();
      if (!negotiationSession) {
        negotiationSession = await ctx.db
          .query('negotiationSessions')
          .withIndex('byConversationStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('conversationId', activeConversationDoc.conversationId)
              .eq('status', 'active'),
          )
          .first();
      }
      if (negotiationSession && negotiationSession.expiresAt > args.now) {
        const proposal = await ctx.db
          .query('negotiationProposals')
          .withIndex('byProposal', (q) =>
            q.eq('worldId', args.worldId).eq('proposalId', negotiationSession!.currentProposalId),
          )
          .first();
        if (proposal?.status === 'active') {
          const history = await ctx.db
            .query('negotiationProposals')
            .withIndex('byNegotiationRevision', (q) =>
              q.eq('worldId', args.worldId).eq('negotiationId', negotiationSession!.negotiationId),
            )
            .collect();
          activeNegotiation = {
            negotiationId: negotiationSession.negotiationId,
            proposalId: proposal.proposalId,
            revision: proposal.revision,
            proposerActorId: proposal.proposerActorId,
            recipientActorId: proposal.recipientActorId,
            terms: termsFromProposal(proposal),
            priorOffers: history
              .sort((a, b) => a.revision - b.revision)
              .map((candidate) =>
                candidate.kind !== 'request_deadline'
                  ? {
                      proposerActorId: candidate.proposerActorId,
                      paymentQty: candidate.paymentQty,
                    }
                  : {
                      proposerActorId: candidate.proposerActorId,
                      extensionGameHours: candidate.extensionGameHours,
                    },
              ),
          };
        }
      } else if (other && activeConversationDoc.currentSpeakerActorId === self.actorId) {
        let requestDeadlineOpportunity: AgentContext['negotiationOpportunity'];
        for (const status of ['accepted', 'ready_to_turn_in'] as const) {
          const requests = await ctx.db
            .query('requests')
            .withIndex('byAssignee', (q) =>
              q
                .eq('worldId', args.worldId)
                .eq('assigneeActorId', self.actorId)
                .eq('status', status),
            )
            .take(MAX_ACTIVE_REQUESTS);
          const request = requests.find((candidate) => candidate.issuerActorId === otherActorId);
          if (!request) continue;
          requestDeadlineOpportunity =
            buildRequestDeadlineOpportunity({
              selfActorId: self.actorId,
              otherActorId,
              topicId: activeConversationDoc.topicId,
              nowGameHour,
              request: {
                requestId: String(request._id),
                issuerActorId: request.issuerActorId,
                assigneeActorId: request.assigneeActorId,
                status: request.status,
                expiresAt: request.expiresAt,
                deadlineExtensionCount: request.deadlineExtensionCount,
              },
            }) ?? undefined;
          if (requestDeadlineOpportunity) break;
        }
        let eventCompensationOpportunity: AgentContext['negotiationOpportunity'];
        const compensationEncounters = await ctx.db
          .query('combatEncounters')
          .withIndex('byDefenderStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('defenderActorId', self.actorId)
              .eq('status', 'defender_defeated'),
          )
          .order('desc')
          .take(8);
        for (const encounter of compensationEncounters) {
          if (
            encounter.attackerActorId !== otherActorId ||
            encounter.compensationNegotiationId ||
            !encounter.terminalEventId
          ) {
            continue;
          }
          const harmEvent = await ctx.db.get(encounter.terminalEventId);
          if (!harmEvent) continue;
          let reservedSpiritStones = 0;
          for (const status of ['pending', 'accepted', 'acting'] as const) {
            const ownExecutions = await ctx.db
              .query('actionExecutions')
              .withIndex('byActorStatus', (q) =>
                q.eq('worldId', args.worldId).eq('actorId', otherActorId).eq('status', status),
              )
              .collect();
            const targetedExecutions = await ctx.db
              .query('actionExecutions')
              .withIndex('byTargetStatus', (q) =>
                q
                  .eq('worldId', args.worldId)
                  .eq('targetActorId', otherActorId)
                  .eq('status', status),
              )
              .collect();
            for (const execution of ownExecutions) {
              if (
                execution.expiresAt > args.now &&
                execution.hardDeadlineAt > args.now &&
                execution.reservedItemId === 'spirit_stone'
              ) {
                reservedSpiritStones += execution.reservedItemQuantity ?? 0;
              }
            }
            for (const execution of targetedExecutions) {
              if (
                execution.expiresAt > args.now &&
                execution.hardDeadlineAt > args.now &&
                execution.reservedTargetItemId === 'spirit_stone'
              ) {
                reservedSpiritStones += execution.reservedTargetItemQuantity ?? 0;
              }
            }
          }
          const facts = (harmEvent.facts ?? {}) as Record<string, unknown>;
          eventCompensationOpportunity =
            buildEventCompensationOpportunity({
              selfActorId: self.actorId,
              otherActorId,
              topicId: activeConversationDoc.topicId,
              nowGameHour,
              source: {
                harmEventId: String(harmEvent._id),
                encounterId: encounter.encounterId,
                attackerActorId: encounter.attackerActorId,
                defenderActorId: encounter.defenderActorId,
                encounterStatus: encounter.status,
                winnerActorId: encounter.winnerActorId,
                defeatedActorId: encounter.defeatedActorId,
                terminalEventId: String(encounter.terminalEventId),
                compensationNegotiationId: encounter.compensationNegotiationId,
                eventType: harmEvent.type,
                eventActorIds: harmEvent.actorIds,
                eventTargetActorIds: harmEvent.targetActorIds ?? [],
                eventEncounterId:
                  typeof facts.encounterId === 'string' ? facts.encounterId : undefined,
                eventTargetActorId:
                  typeof facts.targetActorId === 'string' ? facts.targetActorId : undefined,
                eventDamage: typeof facts.damage === 'number' ? facts.damage : undefined,
                eventDefeated: facts.defeated === true,
                eventGameHour: await readGameHour(ctx, args.worldId, harmEvent.createdAt),
                payerAvailableSpiritStones: Math.max(
                  0,
                  ((other.inventory ?? []).find((item) => item.itemId === 'spirit_stone')?.qty ??
                    0) - reservedSpiritStones,
                ),
              },
            }) ?? undefined;
          if (eventCompensationOpportunity) break;
        }
        negotiationOpportunity =
          requestDeadlineOpportunity ??
          eventCompensationOpportunity ??
          buildHerbTradeOpportunity({
            selfActorId: self.actorId,
            otherActorId,
            selfInventory: self.inventory ?? [],
            otherInventory: other.inventory ?? [],
            relationship: negotiationRelationship,
          }) ??
          undefined;
      }
    }
    if (activeGroupMembership && activeGroupConversationDoc?.status === 'active') {
      // C014c：共享灰盒累积角色超过 nearby page 时，具名 group participant 不能被截断，
      // 否则投票者会把真实方向关系误当成中立。按 session 快照精确补载，仍复核现场与生命。
      for (const participantActorId of activeGroupConversationDoc.participantActorIds) {
        if (
          participantActorId === self.actorId ||
          others.some((other) => other.actorId === participantActorId)
        )
          continue;
        const participant = await ctx.db
          .query('xianxiaProfiles')
          .withIndex('actor', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', participantActorId),
          )
          .first();
        if (
          !participant ||
          !isAgentInteractionTargetEligible(participant) ||
          (participant.mapId ?? 'world') !== selfMapId ||
          participant.currentLocationId !== self.currentLocationId
        )
          continue;
        others.push({
          actorId: participant.actorId,
          name: participant.name,
          role: participant.role,
          realm: participant.realm,
          ...relationshipViewFor(participant.actorId),
        });
      }
      const [turns, beliefs] = await Promise.all([
        ctx.db
          .query('conversationUtterances')
          .withIndex('byConversationTurn', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('conversationId', activeGroupConversationDoc.groupConversationId),
          )
          .order('desc')
          .take(8),
        ctx.db
          .query('actorBeliefs')
          .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', self.actorId))
          .order('desc')
          .take(12),
      ]);
      activeGroupConversation = {
        groupConversationId: activeGroupConversationDoc.groupConversationId,
        role: activeGroupMembership.role,
        topicId: activeGroupConversationDoc.topicId,
        participantActorIds: activeGroupConversationDoc.participantActorIds,
        observerActorIds: activeGroupConversationDoc.observerActorIds,
        currentSpeakerActorId: activeGroupConversationDoc.currentSpeakerActorId,
        turnNumber: activeGroupConversationDoc.turnNumber,
        maxTurns: activeGroupConversationDoc.maxTurns,
        expiresAt: activeGroupConversationDoc.expiresAt,
        expired: activeGroupConversationDoc.expiresAt <= args.now,
        recentTurns: turns.reverse().map((turn) => ({
          turnNumber: turn.turnNumber,
          speakerActorId: turn.speakerActorId,
          speechAct: turn.speechAct,
          utteranceText: turn.utteranceText,
        })),
        beliefs: await projectRuntimeAgentBeliefs(
          ctx,
          args.worldId,
          self.actorId,
          activeGroupConversationDoc.topicId,
          beliefs,
        ),
      };
      if (activeGroupMembership.role === 'participant') {
        const proposalHistory = await ctx.db
          .query('groupProposals')
          .withIndex('byGroupStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('groupConversationId', activeGroupConversationDoc.groupConversationId),
          )
          .collect();
        proposalHistory.sort(
          (a, b) => a.createdAt - b.createdAt || a.proposalId.localeCompare(b.proposalId),
        );
        const openProposal = proposalHistory.find((proposal) => proposal.status === 'open');
        const committedProposal = openProposal
          ? undefined
          : [...proposalHistory].reverse().find((proposal) => proposal.status === 'committed');
        const priorVote = openProposal
          ? await ctx.db
              .query('groupVotes')
              .withIndex('byProposalActor', (q) =>
                q
                  .eq('worldId', args.worldId)
                  .eq('proposalId', openProposal.proposalId)
                  .eq('actorId', self.actorId),
              )
              .first()
          : null;
        const commitment = committedProposal?.commitmentId
          ? await ctx.db
              .query('groupCommitments')
              .withIndex('byCommitment', (q) =>
                q.eq('worldId', args.worldId).eq('commitmentId', committedProposal.commitmentId!),
              )
              .first()
          : null;
        activeGroupDecision = {
          openProposal: openProposal
            ? {
                proposalId: openProposal.proposalId,
                proposerActorId: openProposal.proposerActorId,
                donorActorId: openProposal.donorActorId,
                recipientActorId: openProposal.recipientActorId,
                hasVoted: !!priorVote,
              }
            : undefined,
          pendingCommitment:
            commitment?.status === 'pending'
              ? {
                  commitmentId: commitment.commitmentId,
                  donorActorId: commitment.donorActorId,
                  recipientActorId: commitment.recipientActorId,
                }
              : undefined,
          attemptedRecipientActorIds: proposalHistory.map((proposal) => proposal.recipientActorId),
          proposalCount: proposalHistory.length,
          mediationExhausted:
            proposalHistory.length >= 3 ||
            sessionRecipientsExhausted(
              activeGroupConversationDoc.participantActorIds,
              self.actorId,
              proposalHistory.map((proposal) => proposal.recipientActorId),
            ),
        };
        if (
          !incapacitated &&
          roleKit.includes('group_decide') &&
          !availableActions.includes('group_decide')
        ) {
          availableActions.push('group_decide');
        }
      }
    }

    // W4b-B：本游戏日内已与谁叙谈过（对话冷却）。查近期 conversation_started，取与己相关者的另一方。
    const oneGameDayMs = 24 * MS_PER_GAME_HOUR;
    const talkEvents = await ctx.db
      .query('worldEvents')
      .withIndex('byType', (q) => q.eq('worldId', args.worldId).eq('type', 'conversation_started'))
      .order('desc')
      .take(40);
    const recentlyTalked = [
      ...new Set(
        talkEvents
          .filter((e) => e.createdAt > args.now - oneGameDayMs)
          .filter(
            (e) =>
              e.actorIds.includes(self.actorId) || (e.targetActorIds ?? []).includes(self.actorId),
          )
          .flatMap((e) => [...e.actorIds, ...(e.targetActorIds ?? [])])
          .filter((a) => a !== self.actorId),
      ),
    ];
    const projectionConsequenceRows = purposeIntentV2
      ? await ctx.db
          .query('socialConsequences')
          .withIndex('bySubjectStatus', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('subjectActorId', self.actorId)
              .eq('status', 'active'),
          )
          .order('desc')
          .take(16)
      : [];
    const verifiedProjectionConsequences = (
      await Promise.all(
        projectionConsequenceRows.map(async (consequence) => {
          if (
            !['gratitude_due', 'grievance_created'].includes(consequence.kind) ||
            consequence.counterpartActorIds.length !== 1 ||
            consequence.counterpartActorIds[0] === self.actorId
          ) return undefined;
          if (consequence.kind === 'gratitude_due') {
            if (
              consequence.sourceKind !== 'social_outcome' ||
              consequence.sourceWarrantId === undefined
            ) return undefined;
            const [sourceOutcome, sourceEvent] = await Promise.all([
              ctx.db
                .query('socialOutcomeReceipts')
                .withIndex('byOutcome', (q) =>
                  q
                    .eq('worldId', args.worldId)
                    .eq('outcomeId', consequence.sourceOutcomeId),
                )
                .unique(),
              ctx.db.get(consequence.sourceEventId),
            ]);
            if (
              !sourceOutcome ||
              !sourceEvent ||
              sourceOutcome.revision !== consequence.sourceOutcomeRevision ||
              sourceOutcome.status !== 'resolved' ||
              sourceOutcome.terminalActionId !== consequence.sourceActionId ||
              sourceOutcome.terminalEventId !== consequence.sourceEventId ||
              sourceEvent.actionId !== consequence.sourceActionId
            ) return undefined;
            return {
              consequence,
              actionTerminalEvidenceVerified: false,
              sourceEventAssaultEvidenceCount: 0,
            };
          }
          const sourceActionId = ctx.db.normalizeId(
            'actionRecords', consequence.sourceActionId,
          );
          if (!sourceActionId) return undefined;
          const [sourceAction, sourceEvent, assaultEvidence] = await Promise.all([
            ctx.db.get(sourceActionId),
            ctx.db.get(consequence.sourceEventId),
            ctx.db.query('relationshipChanges').withIndex('bySourceEvent', (q) =>
              q.eq('worldId', args.worldId)
                .eq('sourceEventId', String(consequence.sourceEventId)),
            ).collect(),
          ]);
          const exactAssaultEvidence = assaultEvidence.filter((row) =>
            row.fromActorId === consequence.subjectActorId &&
            row.toActorId === consequence.counterpartActorIds[0] &&
            row.effectKind === 'assault');
          const verified = Boolean(
            sourceAction && sourceEvent &&
            sourceAction.worldId === args.worldId && sourceEvent.worldId === args.worldId &&
            grievanceProjectionSourceEvidenceValid({
              consequence: {
                sourceKind: consequence.sourceKind,
                sourceActionId: consequence.sourceActionId,
                sourceEventId: String(consequence.sourceEventId),
                sourceOutcomeId: consequence.sourceOutcomeId,
                sourceOutcomeRevision: consequence.sourceOutcomeRevision,
                sourceWarrantId: consequence.sourceWarrantId,
                sourceRevision: consequence.sourceRevision,
                subjectActorId: consequence.subjectActorId,
                counterpartActorIds: consequence.counterpartActorIds,
              },
              action: sourceAction ? {
                id: String(sourceAction._id), type: sourceAction.type,
                status: sourceAction.status, actorId: sourceAction.actorId,
                targetActorId: sourceAction.targetActorId,
              } : null,
              event: sourceEvent ? {
                _id: String(sourceEvent._id), worldId: String(sourceEvent.worldId),
                type: sourceEvent.type, actorIds: sourceEvent.actorIds,
                targetActorIds: sourceEvent.targetActorIds,
                actionId: sourceEvent.actionId ? String(sourceEvent.actionId) : undefined,
                facts: sourceEvent.facts,
              } : null,
              assaultEvidence: assaultEvidence.map((row) => ({
                sourceEventId: row.sourceEventId, fromActorId: row.fromActorId,
                toActorId: row.toActorId, effectKind: row.effectKind,
              })),
            }),
          );
          if (!verified) return undefined;
          return {
            consequence,
            actionTerminalEvidenceVerified: true,
            sourceEventAssaultEvidenceCount: exactAssaultEvidence.length,
          };
        }),
      )
    ).filter((row): row is NonNullable<typeof row> => row !== undefined);
    const verifiedGratitudeConsequences = verifiedProjectionConsequences.filter(
      (entry) => entry.consequence.kind === 'gratitude_due',
    );
    const verifiedGrievanceConsequences = verifiedProjectionConsequences.filter(
      (entry) => entry.consequence.kind === 'grievance_created',
    );
    // A consequence names an exact counterpart, so generic nearby pagination
    // must not make that person disappear. The same location/life checks still
    // apply and no remote actor is pulled into a direct candidate.
    for (const { consequence } of verifiedProjectionConsequences) {
      const targetActorId = consequence.counterpartActorIds[0];
      if (others.some((other) => other.actorId === targetActorId)) continue;
      const target = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', targetActorId),
        )
        .first();
      if (
        !target ||
        isGodotSmokeActor(target.actorId) ||
        !isAgentInteractionTargetEligible(target) ||
        (target.mapId ?? 'world') !== selfMapId ||
        !self.currentLocationId ||
        target.currentLocationId !== self.currentLocationId
      ) continue;
      others.push({
        actorId: target.actorId,
        name: target.name,
        role: target.role,
        realm: target.realm,
        ...relationshipViewFor(target.actorId),
      });
    }
    const giftCooldownTargetActorIds = (
      await Promise.all(
        others.map(async (other) => {
          const usageRows = await ctx.db
            .query('socialActionUsages')
            .withIndex('byActorTargetTypeDay', (q) =>
              q
                .eq('worldId', args.worldId)
                .eq('actorId', self.actorId)
                .eq('targetActorId', other.actorId)
                .eq('actionType', 'gift'),
            )
            .collect();
          return evaluateGiftActionCooldown(
            nowGameDay,
            usageRows.map((row) => row.sourceGameDay),
          ).ok
            ? undefined
            : other.actorId;
        }),
      )
    )
      .filter((actorId): actorId is string => Boolean(actorId))
      .sort();

    const socialTargetBusy = new Map<string, boolean>();
    for (const other of others) {
      let busy = false;
      for (const status of ACTIVE_ACTION_EXECUTION_STATUSES) {
        const execution = await ctx.db
          .query('actionExecutions')
          .withIndex('byActorStatus', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', other.actorId).eq('status', status),
          )
          .first();
        if (execution && execution.expiresAt > args.now && execution.hardDeadlineAt > args.now) {
          busy = true;
          break;
        }
      }
      if (!busy) {
        const actorAConversation = await ctx.db
          .query('conversationSessions')
          .withIndex('byActorAStatus', (q) =>
            q.eq('worldId', args.worldId).eq('actorAId', other.actorId).eq('status', 'active'),
          )
          .first();
        const actorBConversation = await ctx.db
          .query('conversationSessions')
          .withIndex('byActorBStatus', (q) =>
            q.eq('worldId', args.worldId).eq('actorBId', other.actorId).eq('status', 'active'),
          )
          .first();
        const groupMembership = await ctx.db
          .query('groupConversationMemberships')
          .withIndex('byActorStatus', (q) =>
            q.eq('worldId', args.worldId).eq('actorId', other.actorId).eq('status', 'active'),
          )
          .first();
        busy = Boolean(actorAConversation || actorBConversation || groupMembership);
      }
      socialTargetBusy.set(other.actorId, busy);
    }
    const recentlyTalkedSet = new Set(recentlyTalked);

    // M7 点亮：让 Agent 知道「可去之处」与「身上的委托」，以便主动 travel / 履约。
    const locationPages = await Promise.all(
      (selfMapId === 'world' ? [undefined, 'world'] : [selfMapId]).map((mapId) =>
        ctx.db
          .query('locations')
          .withIndex('byMap', (q) => q.eq('worldId', args.worldId).eq('mapId', mapId))
          .take(MAX_KNOWN_LOCATIONS),
      ),
    );
    const allLocs = Array.from(
      new Map(
        locationPages.flat().map((location) => [location.locationId, location] as const),
      ).values(),
    )
      .sort((left, right) => left.locationId.localeCompare(right.locationId))
      .slice(0, MAX_KNOWN_LOCATIONS);
    const knownLocations = allLocs.map((l) => ({
      locationId: l.locationId,
      name: l.name,
      allowedActions: l.allowedActions,
      dangerLevel: l.dangerLevel,
      spiritualEnergy: l.spiritualEnergy,
    }));
    const valleyResident =
      selfMapId === VALLEY_MAP_ID
        ? await ctx.db
            .query('qinglanResidents')
            .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', self.actorId))
            .first()
        : null;
    const valleyMovementHistory =
      selfMapId === VALLEY_MAP_ID
        ? await ctx.db
            .query('movementCommands')
            .withIndex('byActorRevision', (q) =>
              q.eq('worldId', args.worldId).eq('actorId', self.actorId),
            )
            .order('desc')
            .take(8)
        : [];
    const valleyMovementActive = valleyMovementHistory.some((command) =>
      ['pending', 'accepted', 'moving'].includes(command.status),
    );
    const activeMovementCommand = valleyMovementHistory.find(
      (command) =>
        ['pending', 'accepted', 'moving'].includes(command.status) && command.expiresAt > args.now,
    );
    const reqs = (
      await Promise.all(
        (['offered', 'accepted', 'ready_to_turn_in'] as const).map((status) =>
          ctx.db
            .query('requests')
            .withIndex('byAssignee', (q) =>
              q
                .eq('worldId', args.worldId)
                .eq('assigneeActorId', self.actorId)
                .eq('status', status),
            )
            .take(MAX_ACTIVE_REQUESTS),
        ),
      )
    )
      .flat()
      .slice(0, MAX_ACTIVE_REQUESTS);
    const activeRequests: NonNullable<AgentContext['activeRequests']> = [];
    for (const r of reqs) {
      const issuer = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', r.issuerActorId))
        .first();
      const issuerBusy = issuer
        ? await isSocialActorBusy(ctx, args.worldId, issuer.actorId, args.now)
        : true;
      activeRequests.push({
        requestId: String(r._id),
        revision: requestRevision(r),
        status: r.status as 'offered' | 'accepted' | 'ready_to_turn_in',
        type: r.type,
        itemId: r.requirements.itemId,
        qty: r.requirements.qty,
        locationId: r.requirements.locationId,
        issuerActorId: r.issuerActorId,
        issuerLocationId: issuer?.currentLocationId,
        issuerMapId: issuer?.mapId ?? 'world',
        issuerAliveAndCapable: issuer ? isAgentInteractionTargetEligible(issuer) : false,
        issuerBusy,
        summary: r.summary,
      });
      // A crowded semantic location can truncate the generic nearby page. The
      // issuer of an active request is not a guessed stranger: it is a precise,
      // server-owned target already referenced by the request. Load that actor
      // explicitly so ready turn-in capabilities cannot disappear as unrelated
      // graybox residents accumulate.
      if (
        issuer &&
        issuer.actorId !== self.actorId &&
        !isGodotSmokeActor(issuer.actorId) &&
        isAgentInteractionTargetEligible(issuer) &&
        (issuer.mapId ?? 'world') === selfMapId &&
        !!self.currentLocationId &&
        issuer.currentLocationId === self.currentLocationId &&
        !others.some((other) => other.actorId === issuer.actorId)
      ) {
        others.push({
          actorId: issuer.actorId,
          name: issuer.name,
          role: issuer.role,
          realm: issuer.realm,
          ...relationshipViewFor(issuer.actorId),
        });
      }
    }
    const nearbyIssuerRequest = activeRequests.find((request) =>
      others.some((other) => other.actorId === request.issuerActorId),
    );
    if (nearbyIssuerRequest) {
      const requestActions: ActionType[] =
        nearbyIssuerRequest.status === 'offered'
          ? ['accept_request', 'decline_request']
          : nearbyIssuerRequest.status === 'ready_to_turn_in'
            ? ['turn_in_request']
            : [];
      for (const requestAction of requestActions) {
        if (roleKit.includes(requestAction) && !availableActions.includes(requestAction)) {
          availableActions.push(requestAction);
        }
      }
    }
    let sameLocationSocialSources = purposeIntentV2 && self.currentLocationId
      ? [
          ...deriveSameLocationSocialSources({
          nowGameHour,
          currentGameDay: nowGameDay,
          actor: {
            actorId: self.actorId,
            locationId: self.currentLocationId,
            health: self.health,
            maxHealth,
            hasHealingItem: ownedHealingItemId({ inventory: self.inventory ?? [] }) !== null,
            hasGiftableItem: (self.inventory ?? []).some(
              (item) =>
                item.qty > 0 &&
                item.itemId !== 'spirit_stone' &&
                item.itemId !== 'healing_pill',
            ),
          },
          targets: others.map((other) => {
            const row = relationshipRowByActor.get(other.actorId);
            return {
              actorId: other.actorId,
              role: other.role,
              locationId: self.currentLocationId!,
              relationship: other.relationship,
              trust: other.trust ?? 0,
              suspicion: other.suspicion ?? 0,
              debt: other.debt ?? 0,
              fear: other.fear ?? 0,
              lastTouchedDay: row?.lastTouchedDay,
              recentlyTalked: recentlyTalkedSet.has(other.actorId),
              aliveAndCapable: true,
              busy: socialTargetBusy.get(other.actorId) ?? false,
              cooldownClear: !recentlyTalkedSet.has(other.actorId),
              sessionCapacityAvailable: !(socialTargetBusy.get(other.actorId) ?? false),
            };
          }),
          requests: activeRequests.flatMap((request) =>
            request.requestId && request.issuerActorId
              ? [{
                  requestId: request.requestId,
                  revision: request.revision ?? 1,
                  status: request.status ?? 'accepted',
                  issuerActorId: request.issuerActorId,
                }]
              : [],
          ),
          beliefs: observationBeliefRows.map((belief) => ({
            beliefId: belief.beliefId,
            revision: belief.revision ?? 1,
            sourceActorId: belief.sourceActorId,
            kind: belief.kind,
            active: belief.active,
            validity: belief.validity,
            truthStatus: belief.truthStatus,
          })),
          memories: mems.map((memory) => ({
            sourceEventId: memory.sourceEventId,
            aboutActorIds: memory.aboutActorIds,
            eventActorIds: memorySourceEventById.get(memory.sourceEventId)?.actorIds,
            eventTargetActorIds: memorySourceEventById.get(memory.sourceEventId)?.targetActorIds,
            type: memory.type,
            source: memory.source,
            distorted: memory.distorted,
            createdAt: memory.createdAt,
            expiresAt: memory.expiresAt,
          })),
          }).filter((source) => !verifiedProjectionConsequences.some(({ consequence }) =>
            consequence.counterpartActorIds[0] === source.targetActorId &&
            source.sourceRef === `event:${String(consequence.sourceEventId)}`,
          )),
          ...projectGratitudeDueConsequences({
            nowGameHour,
            actor: {
              actorId: self.actorId,
              locationId: self.currentLocationId,
              aliveAndCapable: !incapacitated && self.lifeStatus !== 'deceased',
              busy: Boolean(
                activeExecution ||
                activeConversationDoc ||
                (activeGroupMembership && activeGroupConversationDoc?.status === 'active'),
              ),
              hasGiftableItem: (self.inventory ?? []).some(
                (item) =>
                  item.qty > 0 &&
                  item.itemId !== 'spirit_stone' &&
                  item.itemId !== 'healing_pill',
              ),
            },
            consequences: verifiedGratitudeConsequences.map(({ consequence }) => ({
              consequenceId: consequence.consequenceId,
              revision: consequence.revision,
              sourceOutcomeId: consequence.sourceOutcomeId,
              sourceOutcomeRevision: consequence.sourceOutcomeRevision,
              sourceEventId: String(consequence.sourceEventId),
              sourceRevision: consequence.sourceRevision,
              sourceKind: consequence.sourceKind,
              sourceActionId: consequence.sourceActionId,
              sourceWarrantId: consequence.sourceWarrantId,
              kind: consequence.kind,
              subjectActorId: consequence.subjectActorId,
              counterpartActorIds: consequence.counterpartActorIds,
              audience: consequence.audience,
              status: consequence.status,
              remainingProjectionBudget: consequence.remainingProjectionBudget,
              dueGameHour: consequence.dueGameHour,
              expiresGameHour: consequence.expiresGameHour,
              createdGameHour: consequence.createdGameHour,
            })),
            targets: others.map((other) => ({
              actorId: other.actorId,
              locationId: self.currentLocationId!,
              aliveAndCapable: true,
              busy: socialTargetBusy.get(other.actorId) ?? false,
              disclosureAllowed: true,
              cooldownClear: !recentlyTalkedSet.has(other.actorId),
              giftCooldownClear: !giftCooldownTargetActorIds.includes(other.actorId),
              sessionCapacityAvailable: !(socialTargetBusy.get(other.actorId) ?? false),
            })),
          }).sources,
          ...projectGrievanceCreatedConsequences({
            nowGameHour,
            actor: {
              actorId: self.actorId,
              locationId: self.currentLocationId,
              aliveAndCapable: !incapacitated && self.lifeStatus !== 'deceased',
              busy: Boolean(
                activeExecution ||
                activeConversationDoc ||
                (activeGroupMembership && activeGroupConversationDoc?.status === 'active'),
              ),
            },
            consequences: verifiedGrievanceConsequences.map((entry) => {
              const consequence = entry.consequence;
              return {
                consequenceId: consequence.consequenceId,
                revision: consequence.revision,
                sourceOutcomeId: consequence.sourceOutcomeId,
                sourceOutcomeRevision: consequence.sourceOutcomeRevision,
                sourceEventId: String(consequence.sourceEventId),
                sourceRevision: consequence.sourceRevision,
                sourceKind: consequence.sourceKind,
                sourceActionId: consequence.sourceActionId,
                sourceWarrantId: consequence.sourceWarrantId,
                actionTerminalEvidenceVerified: entry.actionTerminalEvidenceVerified,
                sourceEventAssaultEvidenceCount: entry.sourceEventAssaultEvidenceCount,
                kind: consequence.kind,
                subjectActorId: consequence.subjectActorId,
                counterpartActorIds: consequence.counterpartActorIds,
                audience: consequence.audience,
                status: consequence.status,
                remainingProjectionBudget: consequence.remainingProjectionBudget,
                dueGameHour: consequence.dueGameHour,
                expiresGameHour: consequence.expiresGameHour,
                createdGameHour: consequence.createdGameHour,
              };
            }),
            targets: others.map((other) => ({
              actorId: other.actorId,
              locationId: self.currentLocationId!,
              aliveAndCapable: true,
              busy: socialTargetBusy.get(other.actorId) ?? false,
              disclosureAllowed: true,
              cooldownClear: !recentlyTalkedSet.has(other.actorId),
              giftCooldownClear: !giftCooldownTargetActorIds.includes(other.actorId),
              sessionCapacityAvailable: !(socialTargetBusy.get(other.actorId) ?? false),
            })),
          }).sources,
        ]
      : [];
    if (purposeIntentV2 && self.currentLocationId && sameLocationSocialSources.length > 0) {
      const socialBundle = buildSameLocationSocialOpportunityBundle({
        now: nowGameHour,
        actorId: self.actorId,
        locationId: self.currentLocationId,
        actorAliveAndCapable: !incapacitated,
        actorBusy: false,
        sources: sameLocationSocialSources,
      });
      const blockedSourceDigests = new Set<string>();
      for (const entry of socialBundle.entries) {
        const actionType = entry.candidate.intendedActivity === 'teach'
          ? 'request_teaching'
          : entry.candidate.intendedActivity;
        const binding = prepareSocialOutcomeBinding({
          actorId: self.actorId,
          targetActorIds: entry.candidate.targetActorIds,
          actionType,
          warrant: entry.warrant,
          candidate: entry.candidate,
          warrantDigest: entry.warrantDigest,
          candidateDigest: entry.candidateDigest,
          warrantCandidateDigest: entry.warrantCandidateDigest,
        });
        const sourceAvailable = await socialOutcomeSourceAvailable(ctx, {
          worldId: args.worldId,
          actorId: self.actorId,
          targetActorIds: entry.candidate.targetActorIds,
          sourceRef: entry.warrant.sourceRef,
          intendedOutcome: entry.warrant.intendedOutcome,
          nowGameHour,
        });
        if (!sourceAvailable || (
          binding.ok &&
          !await socialOutcomeScopeAvailable(ctx, args.worldId, binding.binding.scopeKey, nowGameHour)
        )) {
          blockedSourceDigests.add(entry.sourceDigest);
        }
      }
      sameLocationSocialSources = sameLocationSocialSources.filter((source) =>
        !blockedSourceDigests.has(sameLocationSocialSourceDigest(source)));
    }
    const [pendingInvitationRows, acceptedInvitationRows] = purposeIntentV2
      ? await Promise.all([
          ctx.db
            .query('socialInvitations')
            .withIndex('byTargetStatus', (q) =>
              q
                .eq('worldId', args.worldId)
                .eq('targetActorId', self.actorId)
                .eq('status', 'pending'),
            )
            .order('desc')
            .take(8),
          ctx.db
            .query('socialInvitations')
            .withIndex('byActorStatus', (q) =>
              q
                .eq('worldId', args.worldId)
                .eq('actorId', self.actorId)
                .eq('status', 'accepted'),
            )
            .order('desc')
            .take(8),
        ])
      : [[], []];
    const pendingSocialInvitations = (
      await Promise.all(
        pendingInvitationRows.map((row) =>
          loadPendingSocialInvitationSource(
            ctx,
            args.worldId,
            row.invitationId,
            self.actorId,
            args.now,
          ),
        ),
      )
    ).filter((source): source is NonNullable<typeof source> => source !== undefined);
    const acceptedSocialInvitations = (
      await Promise.all(
        acceptedInvitationRows.map((row) =>
          loadAcceptedSocialInvitationSource(
            ctx,
            args.worldId,
            row.invitationId,
            args.now,
          ),
        ),
      )
    ).filter((source): source is NonNullable<typeof source> => source !== undefined);
    const acceptedSharedPlans = purposeIntentV2
      ? await loadActorSharedPlanSources(ctx, args.worldId, self.actorId, args.now)
      : [];
    const activeInvitationWarrantIds = [
      ...pendingInvitationRows.map((row) => row.warrantId),
      ...acceptedInvitationRows.map((row) => row.warrantId),
    ];
    const remoteSocialInvitationOpportunities = purposeIntentV2
      ? deriveRemoteSocialInvitationOpportunities({
          actorId: self.actorId,
          actorMapId: selfMapId,
          actorLocationId: self.currentLocationId,
          actorAliveAndCapable: isAgentInteractionTargetEligible(self),
          actorBusy: Boolean(
            activeExecution ||
            activeConversation ||
            activeGroupConversation ||
            activeGroupDecision,
          ),
          nowGameHour,
          activeInvitationWarrantIds,
          requests: activeRequests.flatMap((request) =>
            request.requestId && request.issuerActorId
              ? [{
                  requestId: request.requestId,
                  revision: request.revision ?? 1,
                  status: request.status ?? 'accepted',
                  issuerActorId: request.issuerActorId,
                  issuerMapId: request.issuerMapId,
                  issuerLocationId: request.issuerLocationId,
                  issuerAliveAndCapable: request.issuerAliveAndCapable ?? false,
                  issuerBusy: request.issuerBusy ?? true,
                  summary: request.summary,
                }]
              : [],
          ),
        })
      : [];
    if (
      remoteSocialInvitationOpportunities.length > 0 &&
      roleKit.includes('invite_social') &&
      !availableActions.includes('invite_social')
    ) {
      availableActions.push('invite_social');
    }
    if (
      pendingSocialInvitations.length > 0 &&
      roleKit.includes('respond_social_invitation') &&
      !availableActions.includes('respond_social_invitation')
    ) {
      availableActions.push('respond_social_invitation');
    }
    const resourceNodeDocs = self.currentLocationId
      ? await ctx.db
          .query('resourceNodes')
          .withIndex('byLocation', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('mapId', selfMapId)
              .eq('locationId', self.currentLocationId!),
          )
          .take(MAX_RESOURCE_NODES)
      : [];
    const purposeResourceNodeDocs = purposeIntentV2
      ? await ctx.db
          .query('resourceNodes')
          .withIndex('byMap', (q) =>
            q.eq('worldId', args.worldId).eq('mapId', selfMapId),
          )
          .take(MAX_RESOURCE_NODES)
      : [];
    const reservedByNode = new Map<string, number>();
    for (const status of ['pending', 'accepted', 'acting'] as const) {
      const activeAtMap = await ctx.db
        .query('actionExecutions')
        .withIndex('byMapStatus', (q) =>
          q.eq('worldId', args.worldId).eq('mapId', selfMapId).eq('status', status),
        )
        .take(64);
      for (const execution of activeAtMap) {
        if (!execution.resourceNodeId) continue;
        reservedByNode.set(
          execution.resourceNodeId,
          (reservedByNode.get(execution.resourceNodeId) ?? 0) + (execution.reservedQuantity ?? 0),
        );
      }
    }
    const resourceNodes = resourceNodeDocs.map((node) => {
      const projected = refreshResourceStock(node, args.now);
      return {
        resourceNodeId: node.resourceNodeId,
        name: node.name,
        itemId: node.itemId,
        stock: projected.stock,
        available: Math.max(0, projected.stock - (reservedByNode.get(node.resourceNodeId) ?? 0)),
        seasonalState: node.seasonalState,
        seasonalRefreshBlockedUntil: projected.seasonalRefreshBlockedUntil,
      };
    });
    const purposeResourceNodes: NonNullable<AgentContext['purposeResourceNodes']> =
      purposeResourceNodeDocs
        .filter((node) => resourceAccessAllowed(node, self.actorId))
        .map((node) => {
          const projected = refreshResourceStock(node, args.now);
          const available = Math.max(
            0,
            projected.stock - (reservedByNode.get(node.resourceNodeId) ?? 0),
          );
          return {
            resourceNodeId: node.resourceNodeId,
            name: node.name,
            locationId: node.locationId,
            itemId: node.itemId,
            available,
            sourceRevision: `resource:${stableObservationDigest({
              resourceNodeId: node.resourceNodeId,
              stock: projected.stock,
              available,
              refreshBlockedUntil: projected.refreshBlockedUntil,
              seasonalState: node.seasonalState,
              seasonalRefreshBlockedUntil: projected.seasonalRefreshBlockedUntil,
            })}`,
          };
        });
    const shopDocs = purposeIntentV2
      ? await ctx.db
          .query('shopInventories')
          .withIndex('byLocation', (q) =>
            q.eq('worldId', args.worldId).eq('mapId', selfMapId),
          )
          .take(8)
      : self.currentLocationId
      ? await ctx.db
          .query('shopInventories')
          .withIndex('byLocation', (q) =>
            q
              .eq('worldId', args.worldId)
              .eq('mapId', selfMapId)
              .eq('locationId', self.currentLocationId!),
          )
          .take(8)
      : [];
    const shopOffers: NonNullable<AgentContext['shopOffers']> = [];
    const purposeShopOffers: NonNullable<AgentContext['purposeShopOffers']> = [];
    const actorReservations = new Map<string, number>();
    const seenActorReservationIds = new Set<string>();
    for (const status of ['pending', 'accepted', 'acting'] as const) {
      const own = await ctx.db
        .query('actionExecutions')
        .withIndex('byActorStatus', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', self.actorId).eq('status', status),
        )
        .collect();
      const targeted = await ctx.db
        .query('actionExecutions')
        .withIndex('byTargetStatus', (q) =>
          q.eq('worldId', args.worldId).eq('targetActorId', self.actorId).eq('status', status),
        )
        .collect();
      for (const execution of [...own, ...targeted]) {
        if (
          seenActorReservationIds.has(String(execution._id)) ||
          execution.expiresAt <= args.now ||
          execution.hardDeadlineAt <= args.now
        )
          continue;
        seenActorReservationIds.add(String(execution._id));
        const itemId =
          execution.actorId === self.actorId
            ? execution.reservedItemId
            : execution.reservedTargetItemId;
        const quantity =
          execution.actorId === self.actorId
            ? execution.reservedItemQuantity
            : execution.reservedTargetItemQuantity;
        if (itemId)
          actorReservations.set(itemId, (actorReservations.get(itemId) ?? 0) + (quantity ?? 0));
      }
    }
    const availableActorQty = (itemId: string) =>
      Math.max(
        0,
        ((self.inventory ?? []).find((item) => item.itemId === itemId)?.qty ?? 0) -
          (actorReservations.get(itemId) ?? 0),
      );
    const actorSpiritStones = availableActorQty('spirit_stone');
    for (const shopDoc of shopDocs) {
      // Do not derive a named shopkeeper from the capped nearby actor page.
      // Crowded locations could otherwise hide the merchant solely because an
      // unrelated actor sorted into the first page.
      const merchant = await ctx.db
        .query('xianxiaProfiles')
        .withIndex('actor', (q) =>
          q.eq('worldId', args.worldId).eq('actorId', shopDoc.merchantActorId),
        )
        .first();
      if (
        !merchant ||
        !isAgentInteractionTargetEligible(merchant) ||
        (merchant.mapId ?? 'world') !== selfMapId ||
        merchant.currentLocationId !== shopDoc.locationId
      ) {
        continue;
      }
      const usageRows = await ctx.db
        .query('socialActionUsages')
        .withIndex('byActorTargetTypeDay', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('actorId', self.actorId)
            .eq('targetActorId', shopDoc.merchantActorId)
            .eq('actionType', 'trade'),
        )
        .collect();
      const tradeUsageGameHours = usageRows
        .map((row) => row.sourceGameHour)
        .filter((hour): hour is number => typeof hour === 'number')
        .sort((left, right) => left - right);
      const cooldown = evaluateTradeActionCooldown(
        nowGameHour,
        tradeUsageGameHours,
      );
      if (!cooldown.ok) continue;
      const merchantView = await ctx.db
        .query('relationships')
        .withIndex('pair', (q) =>
          q
            .eq('worldId', args.worldId)
            .eq('fromActorId', shopDoc.merchantActorId)
            .eq('toActorId', self.actorId),
        )
        .first();
      const effectiveMerchantView = relationshipDimsAt(
        merchantView
          ? {
              affinity: merchantView.value,
              trust: merchantView.trust,
              suspicion: merchantView.suspicion,
              debt: merchantView.debt,
              fear: merchantView.fear,
            }
          : {},
        merchantView?.lastTouchedDay,
        nowGameDay,
        merchant.innerTrait ?? '',
        merchant.outerTrait ?? '',
        merchantView?.dimensionTouchedDays,
      );
      const refreshed = refreshShopState(shopDoc, args.now).shop;
      const reservedOutgoing = new Map<string, number>();
      const reservedIncoming = new Map<string, number>();
      let reservedWallet = 0;
      for (const status of ['pending', 'accepted', 'acting'] as const) {
        const executions = await ctx.db
          .query('actionExecutions')
          .withIndex('byShopStatus', (q) =>
            q.eq('worldId', args.worldId).eq('shopId', refreshed.shopId).eq('status', status),
          )
          .collect();
        for (const execution of executions) {
          if (execution.expiresAt <= args.now || execution.hardDeadlineAt <= args.now) continue;
          if (execution.reservedShopItemId) {
            reservedOutgoing.set(
              execution.reservedShopItemId,
              (reservedOutgoing.get(execution.reservedShopItemId) ?? 0) +
                (execution.reservedShopItemQuantity ?? 0),
            );
          }
          if (execution.reservedShopCapacityItemId) {
            reservedIncoming.set(
              execution.reservedShopCapacityItemId,
              (reservedIncoming.get(execution.reservedShopCapacityItemId) ?? 0) +
                (execution.reservedShopCapacityQuantity ?? 0),
            );
          }
          reservedWallet += execution.reservedShopWalletSpiritStones ?? 0;
        }
      }
      for (const line of refreshed.stock) {
        const localOffer = shopDoc.locationId === self.currentLocationId;
        const availableStock = Math.max(0, line.qty - (reservedOutgoing.get(line.itemId) ?? 0));
        const saleQuote = quoteShopSale(line.itemId, availableStock, line.capacity, {
          affinity: effectiveMerchantView.affinity,
          trust: effectiveMerchantView.trust,
          suspicion: effectiveMerchantView.suspicion,
          tags: merchantView?.tags,
        });
        if (
          availableStock > 0 &&
          saleQuote.finalPrice > 0 &&
          actorSpiritStones >= saleQuote.finalPrice
        ) {
          const offer = {
            shopId: refreshed.shopId,
            shopName: refreshed.name,
            targetActorId: refreshed.merchantActorId,
            direction: 'buy' as const,
            itemId: line.itemId,
            qty: 1,
            unitPrice: saleQuote.finalPrice,
            totalPrice: saleQuote.finalPrice,
            stock: availableStock,
            capacity: line.capacity,
            walletSpiritStones: refreshed.walletSpiritStones,
          };
          if (localOffer) shopOffers.push(offer);
          if (purposeIntentV2) {
            purposeShopOffers.push({
              ...offer,
              locationId: shopDoc.locationId,
              sourceRevision: `shop:${stableObservationDigest({
                ...offer,
                merchantActorId: merchant.actorId,
                tradeUsageGameHours,
              })}`,
            });
          }
        }
        const actorQty = availableActorQty(line.itemId);
        const reservedCapacity = reservedIncoming.get(line.itemId) ?? 0;
        const availableCapacity = Math.max(0, line.capacity - line.qty - reservedCapacity);
        const purchaseQuote = quoteShopPurchase(
          line.itemId,
          Math.min(line.capacity, line.qty + reservedCapacity),
          line.capacity,
        );
        if (
          actorQty > 0 &&
          availableCapacity > 0 &&
          purchaseQuote.finalPrice > 0 &&
          refreshed.walletSpiritStones - reservedWallet >= purchaseQuote.finalPrice
        ) {
          const offer = {
            shopId: refreshed.shopId,
            shopName: refreshed.name,
            targetActorId: refreshed.merchantActorId,
            direction: 'sell' as const,
            itemId: line.itemId,
            qty: 1,
            unitPrice: purchaseQuote.finalPrice,
            totalPrice: purchaseQuote.finalPrice,
            stock: line.qty + reservedCapacity,
            capacity: line.capacity,
            walletSpiritStones: Math.max(0, refreshed.walletSpiritStones - reservedWallet),
          };
          if (localOffer) shopOffers.push(offer);
          if (purposeIntentV2) {
            purposeShopOffers.push({
              ...offer,
              locationId: shopDoc.locationId,
              sourceRevision: `shop:${stableObservationDigest({
                ...offer,
                merchantActorId: merchant.actorId,
                tradeUsageGameHours,
              })}`,
            });
          }
        }
      }
    }

    const worldPressureRows = await ctx.db
      .query('worldPressures')
      .withIndex('byMapStatus', (q) =>
        q.eq('worldId', args.worldId).eq('mapId', selfMapId).eq('status', 'active'),
      )
      .take(12);
    const worldPressures = boundedObservedWorldPressures(
      worldPressureRows
        .filter((pressure) => pressure.endsAt > args.now)
        .map((pressure) => ({
          pressureId: pressure.pressureId,
          revision: pressure.revision,
          kind: pressure.kind,
          status: 'active' as const,
          mapId: pressure.mapId,
          locationId: pressure.locationId,
          affectedResourceNodeIds: pressure.affectedResourceNodeIds,
          severity: pressure.severity,
          effectCodes: pressure.effectCodes,
          endsAt: pressure.endsAt,
          endsAtGameHour: pressure.endsAtGameHour,
          sourceEventId: String(pressure.sourceEventId),
        })),
    );

    const [groupSocialOpportunities, activeGroupSocialCoordination] = purposeIntentV2
      ? await Promise.all([
          loadGroupSocialOpportunities(ctx, args.worldId, self.actorId, args.now),
          loadActorGroupSocialCoordination(ctx, args.worldId, self.actorId, args.now),
        ])
      : [[], []];
    const groupSocialCoordinationCandidates = buildGroupSocialCoordinationCandidates({
      actorId: self.actorId,
      currentLocationId: self.currentLocationId,
      allowed: roleKit.includes('group_talk'),
      opportunities: groupSocialOpportunities,
      active: activeGroupSocialCoordination,
      priorityProjectionV1: purposeIntentV2,
    });
    if (
      groupSocialCoordinationCandidates.length > 0 &&
      !availableActions.includes('group_talk')
    ) {
      availableActions.push('group_talk');
    }

    const context: AgentContext = {
      personalGoal: activePersonalGoalRow
        ? personalGoalRowToActiveGoal(activePersonalGoalRow)
        : undefined,
      currentGameHour: nowGameHour,
      personalGoalCadences:
        personalGoalCadences.length > 0 ? personalGoalCadences : undefined,
      resultHabitPreferences:
        resultHabitPreferences.length > 0 ? resultHabitPreferences : undefined,
      worldPressures,
      self: {
        actorId: self.actorId,
        name: self.name,
        role: self.role,
        realm: self.realm,
        realmStage: self.realmStage,
        cultivationXp: self.cultivationXp,
        mood: self.mood,
        health: self.health,
        lifeStatus: self.lifeStatus,
        maxHealth,
        fatigue: normalizeFatigue(self.fatigue),
        spirit: self.spirit,
        reputation: self.reputation,
        currentLocationId: self.currentLocationId,
        inventory: self.inventory ?? [],
        innerTrait: self.innerTrait,
        outerTrait: self.outerTrait,
        // D：把性格双轴的确定性叙事并进 persona，喂给选动作/对话 LLM（旧档无 trait → 片段为空，persona 不变）。
        persona: [self.persona, personaFragment(self.innerTrait ?? '', self.outerTrait ?? '')]
          .filter(Boolean)
          .join('；'),
      },
      currentLocationName: locationOnSameMap?.name,
      currentLocationSpiritualEnergy: locationOnSameMap?.spiritualEnergy,
      cultivationModes: availableCultivationModes(self.inventory ?? []),
      others,
      recentEvents,
      socialSummaries,
      availableActions,
      readyToBreakthrough: !incapacitated && breakthroughReady,
      knownLocations,
      stableLifeSemanticTravelV1: !purposeIntentV2,
      purposeBoundLifeIntentV2: purposeIntentV2 || undefined,
      decisionPriorityProjectionV1: purposeIntentV2 || undefined,
      sameLocationSocialSources:
        purposeIntentV2 && sameLocationSocialSources.length > 0
          ? sameLocationSocialSources
          : undefined,
      acceptedSocialInvitations:
        purposeIntentV2 && acceptedSocialInvitations.length > 0
          ? acceptedSocialInvitations
          : undefined,
      remoteSocialInvitationOpportunities:
        purposeIntentV2 && remoteSocialInvitationOpportunities.length > 0
          ? remoteSocialInvitationOpportunities
          : undefined,
      pendingSocialInvitations:
        purposeIntentV2 && pendingSocialInvitations.length > 0
          ? pendingSocialInvitations
          : undefined,
      acceptedSharedPlans:
        purposeIntentV2 && acceptedSharedPlans.length > 0
          ? acceptedSharedPlans
          : undefined,
      groupSocialCoordinationProposals:
        purposeIntentV2 && groupSocialCoordinationCandidates.length > 0
          ? groupSocialCoordinationCandidates.map((candidate) => candidate.proposal)
          : undefined,
      groupSocialCoordination:
        purposeIntentV2 && activeGroupSocialCoordination.length > 0
          ? activeGroupSocialCoordination
          : undefined,
      activeRequests,
      resourceNodes,
      shopOffers: shopOffers.slice(0, 16),
      purposeResourceNodes: purposeIntentV2 ? purposeResourceNodes : undefined,
      purposeShopOffers: purposeIntentV2
        ? purposeShopOffers.slice(0, 32)
        : undefined,
      combat: {
        activeEncounterId: activeCombatEncounter?.encounterId,
        opponentActorId,
        opponentName: opponent?.name,
        opponentHealth: opponent?.health,
        lootTargets,
      },
      phase: gt?.phase,
      recentlyTalked,
      giftCooldownTargetActorIds,
      activeExecution: activeExecution
        ? {
            executionId: String(activeExecution._id),
            actionType: activeExecution.actionType,
            status: activeExecution.status as 'pending' | 'accepted' | 'acting',
            expiresAt: activeExecution.expiresAt,
          }
        : undefined,
      activeConversation,
      activeGroupConversation,
      activeGroupDecision,
      activeNegotiation,
      negotiationOpportunity,
      negotiationRelationship,
      currentTile: valleyResident?.displayTile,
      movementPointRadius: selfMapId === VALLEY_MAP_ID ? 12 : undefined,
      knownInteractions:
        selfMapId === VALLEY_MAP_ID
          ? QINGLAN_VALLEY_GATE_DATA.interactions.map((interaction) => ({
              interactionId: interaction.id,
              name: interaction.name,
              locationId: interaction.locationId,
              actions: [...interaction.actions],
            }))
          : undefined,
      valleyRuntime:
        selfMapId === VALLEY_MAP_ID
          ? {
              hasMovementHistory: valleyMovementHistory.length > 0,
              activeCommand: valleyMovementActive,
              fatigue: valleyResident?.fatigue,
              herbNeed: valleyResident?.herbNeed,
              nextActionAt: valleyResident?.nextActionAt,
              recentEventTypes: recentMapEventTypes,
            }
          : undefined,
    };
    if (purposeIntentV2) {
      const purposeBundle = buildPurposeBoundLifeCandidateBundle(context);
      const candidateSource = composeRuntimeAgentCandidateSource({
        purposeBundle,
        invitationInput: {
          actorId: self.actorId,
          currentLocationId: self.currentLocationId,
          personalGoalActive: Boolean(context.personalGoal),
          inviteAllowed: availableActions.includes('invite_social'),
          respondAllowed: availableActions.includes('respond_social_invitation'),
          remoteOpportunities: remoteSocialInvitationOpportunities,
          pendingInvitations: pendingSocialInvitations,
          priorityProjectionV1: true,
        },
        groupCandidates: groupSocialCoordinationCandidates,
      });
      context.purposeFactsDigest = candidateSource.purposeFactsDigest;
      context.purposeBoundLifeCandidateBundle = candidateSource.purposeBoundLifeCandidateBundle;
    }
    const runtimeObservation = bindRuntimeAgentObservation({
      observation: buildLifeObservation({
      context,
      semanticTime: {
        gameHour: nowGameHour,
        gameDay: nowGameDay,
        phase: gt?.phase,
      },
      mapId: selfMapId,
      currentTile: valleyResident?.displayTile,
      memories: mems.map((memory) => ({
        memoryId: String(memory._id),
        actorId: memory.actorId,
        sourceEventId: memory.sourceEventId,
        type: memory.type,
        summary: memory.summary,
        source: memory.source,
        distorted: memory.distorted,
        lifecycle: memory.lifecycle,
        salience: memory.salience,
        createdAt: memory.createdAt,
        expiresAt: memory.expiresAt,
      })),
      summaries: socialSummaryRows
        .filter((summary) => isGodotSmokeActor(self.actorId) || !memoryTouchesGodotSmoke(summary))
        .map((summary) => ({
          summaryId: summary.summaryId,
          actorId: summary.actorId,
          subjectActorId: summary.subjectActorId,
          summary: summary.summary,
          revision: summary.revision,
          updatedAt: summary.updatedAt,
        })),
      beliefs: observationBeliefRows
        .filter(
          (belief) =>
            isGodotSmokeActor(self.actorId) ||
            (!isGodotSmokeActor(belief.sourceActorId) &&
              !(belief.subjectActorIds ?? []).some(isGodotSmokeActor) &&
              !belief.summary.includes('godot_smoke_')),
        )
        .map((belief) => ({
          beliefId: belief.beliefId,
          actorId: belief.actorId,
          kind: belief.kind,
          sourceActorId: belief.sourceActorId,
          sourceClaimId: belief.sourceClaimId,
          subjectClaimId: belief.subjectClaimId,
          subjectActorIds: belief.subjectActorIds,
          summary: belief.summary,
          confidence: belief.confidence,
          active: belief.active,
          revision: belief.revision,
          validity: belief.validity,
          truthStatus: belief.truthStatus,
          evidenceEventId: belief.evidenceEventId,
          evidenceVerdict: belief.evidenceVerdict,
          updatedAt: belief.updatedAt,
        })),
      relationships: effectiveRelationships.map(({ row, dims }) => ({
        actorId: row.toActorId,
        affinity: dims.affinity,
        trust: dims.trust,
        suspicion: dims.suspicion,
        debt: dims.debt,
        fear: dims.fear,
      })),
      activeExecution: activeExecution
        ? {
            executionId: String(activeExecution._id),
            revision: activeExecution.revision,
            actionType: activeExecution.actionType,
            status: activeExecution.status as 'pending' | 'accepted' | 'acting',
            targetActorId: activeExecution.targetActorId,
            requestId: activeExecution.requestId ? String(activeExecution.requestId) : undefined,
            requestRevision: activeExecution.requestRevision,
            locationId: activeExecution.locationId,
            expiresAt: activeExecution.expiresAt,
          }
        : undefined,
      activeMovement: activeMovementCommand
        ? {
            commandId: String(activeMovementCommand._id),
            revision: activeMovementCommand.revision,
            status: activeMovementCommand.status as 'pending' | 'accepted' | 'moving',
            requestedTarget: activeMovementCommand.requestedTarget,
            resolvedLocationId: activeMovementCommand.resolvedLocationId,
            intent: activeMovementCommand.intent,
            expiresAt: activeMovementCommand.expiresAt,
            acceptedTile: activeMovementCommand.acceptedTile,
          }
        : undefined,
      }),
      candidateSetDigest: context.purposeBoundLifeCandidateBundle?.candidateSetDigest,
      activeExecution: context.activeExecution,
      activeConversation: context.activeConversation,
      activeGroupConversation: context.activeGroupConversation,
      now: args.now,
    });
    context.lifeObservation = runtimeObservation.observation;
    context.authoritativeDecisionSnapshot = runtimeObservation.authoritativeDecisionSnapshot;
    return context;
  },
});
