import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { readClockStartedAt } from './config';
import { ACTIVE_ACTION_EXECUTION_STATUSES } from './actionExecutionContracts';
import { isActorIncapacitated } from './lifeStateLogic';
import { projectTaixuResultHabitPreferences } from './taixuResultSelectiveMemoryAdoptionLogic';
import { gameTimeAt } from './timeLogic';
import { relationshipDimsAt } from './relationshipLogic';
import { isAgentInteractionTargetEligible, type AgentContext } from './agentLogic';
import { MAX_PROMPT_SOCIAL_SUMMARIES } from './memoryLogic';
import type { ActionType } from './actionSchema';
import { canAttemptRealmBreakthrough } from './rules';
import { allowedActionsForRole } from './policy';
import { evaluateFatigueActionGate } from './fatigueLogic';
import { evaluateBreakthroughProgress } from './breakthroughProgressLogic';
import { ownedHealingItemId } from './agentLogic';

const IMPLEMENTED_ACTION_TYPES: ActionType[] = [
  'cultivate', 'gather', 'rest', 'talk', 'invite_social', 'respond_social_invitation',
  'group_talk', 'group_decide', 'negotiate', 'trade', 'gift', 'request_teaching',
  'accept_request', 'decline_request', 'turn_in_request', 'spar', 'attack', 'flee',
  'loot', 'explore', 'inspect', 'breakthrough', 'use_item',
];

export const RUNTIME_AGENT_NEARBY_LIMIT = 24;
export const RUNTIME_AGENT_RELATIONSHIP_LIMIT = 256;

export async function loadRuntimeAgentContextBootstrap(
  ctx: QueryCtx,
  args: {
    worldId: Id<'worlds'>;
    actorId: string;
    now: number;
    autonomyIntentVersion?: 'legacy_v1' | 'purpose_v2';
  },
) {
  const purposeIntentV2 = args.autonomyIntentVersion === 'purpose_v2';
  const self = await ctx.db
    .query('xianxiaProfiles')
    .withIndex('actor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
    .first();
  if (!self) return null;
  const resultAdoptionState = await ctx.db
    .query('taixuResultAdoptionStates')
    .withIndex('byActor', (q) => q.eq('worldId', args.worldId).eq('actorId', args.actorId))
    .unique();
  const resultHabitPreferences = resultAdoptionState
    ? projectTaixuResultHabitPreferences({
        actorId: args.actorId,
        revision: resultAdoptionState.revision,
        stateJson: resultAdoptionState.stateJson,
        stateDigest: resultAdoptionState.stateDigest,
      })
    : [];
  const activePersonalGoalRow = await ctx.db
    .query('personalGoals')
    .withIndex('byActorStatus', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', args.actorId).eq('status', 'active'),
    )
    .order('desc')
    .first();
  const selfMapId = self.mapId ?? 'world';
  const incapacitated = isActorIncapacitated(self.health);
  const latestExecution = await ctx.db
    .query('actionExecutions')
    .withIndex('byActorRevision', (q) => q.eq('worldId', args.worldId).eq('actorId', self.actorId))
    .order('desc')
    .first();
  const activeExecution =
    latestExecution &&
    ACTIVE_ACTION_EXECUTION_STATUSES.has(latestExecution.status) &&
    latestExecution.expiresAt > args.now &&
    latestExecution.hardDeadlineAt > args.now
      ? latestExecution
      : null;
  const [activeAsA, activeAsB] = await Promise.all([
    ctx.db.query('conversationSessions').withIndex('byActorAStatus', (q) =>
      q.eq('worldId', args.worldId).eq('actorAId', self.actorId).eq('status', 'active'),
    ).order('desc').first(),
    ctx.db.query('conversationSessions').withIndex('byActorBStatus', (q) =>
      q.eq('worldId', args.worldId).eq('actorBId', self.actorId).eq('status', 'active'),
    ).order('desc').first(),
  ]);
  const activeConversationDoc = [activeAsA, activeAsB]
    .filter((session): session is NonNullable<typeof activeAsA> => !!session && session.expiresAt > args.now)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const activeGroupMembership = await ctx.db
    .query('groupConversationMemberships')
    .withIndex('byActorStatus', (q) =>
      q.eq('worldId', args.worldId).eq('actorId', self.actorId).eq('status', 'active'),
    )
    .order('desc')
    .first();
  const activeGroupConversationDoc = activeGroupMembership
    ? await ctx.db.query('groupConversationSessions').withIndex('byGroupConversation', (q) =>
        q.eq('worldId', args.worldId).eq('groupConversationId', activeGroupMembership.groupConversationId),
      ).first()
    : null;
  const clockStartedAt = await readClockStartedAt(ctx, args.worldId);
  const gt = clockStartedAt === null ? null : gameTimeAt(args.now, clockStartedAt);
  const nowGameHour = gt?.totalHours ?? 0;
  return {
    purposeIntentV2, self, resultHabitPreferences, activePersonalGoalRow, selfMapId,
    incapacitated, activeExecution, activeConversationDoc, activeGroupMembership,
    activeGroupConversationDoc, gt, nowGameHour, nowGameDay: Math.floor(nowGameHour / 24),
  };
}

export async function loadRuntimeAgentSocialRead(
  ctx: QueryCtx,
  input: {
    worldId: Id<'worlds'>;
    self: Doc<'xianxiaProfiles'>;
    selfMapId: string;
    nowGameDay: number;
    isSmokeActor: (actorId: string) => boolean;
  },
) {
  const { worldId, self, selfMapId, nowGameDay, isSmokeActor } = input;
  const nearbyProfilePages = self.currentLocationId
    ? await Promise.all(
        (selfMapId === 'world' ? [undefined, 'world'] : [selfMapId]).map((mapId) =>
          ctx.db.query('xianxiaProfiles').withIndex('byLocation', (q) =>
            q.eq('worldId', worldId).eq('mapId', mapId).eq('currentLocationId', self.currentLocationId),
          ).take(RUNTIME_AGENT_NEARBY_LIMIT + 1),
        ),
      )
    : [];
  const nearbyProfiles = Array.from(
    new Map(nearbyProfilePages.flat().map((profile) => [profile.actorId, profile] as const)).values(),
  ).slice(0, RUNTIME_AGENT_NEARBY_LIMIT + 1);
  const relationships = await ctx.db.query('relationships').withIndex('from', (q) =>
    q.eq('worldId', worldId).eq('fromActorId', self.actorId),
  ).take(RUNTIME_AGENT_RELATIONSHIP_LIMIT);
  const effectiveRelationships = relationships.map((relationship) => ({
    row: relationship,
    dims: relationshipDimsAt(
      { affinity: relationship.value, trust: relationship.trust, suspicion: relationship.suspicion, debt: relationship.debt, fear: relationship.fear },
      relationship.lastTouchedDay, nowGameDay, self.innerTrait ?? '', self.outerTrait ?? '', relationship.dimensionTouchedDays,
    ),
  }));
  const relationshipByActor = new Map(effectiveRelationships.map(({ row, dims }) => [row.toActorId, dims.affinity]));
  const relationshipDimsByActor = new Map(effectiveRelationships.map(({ row, dims }) => [row.toActorId, dims]));
  const relationshipRowByActor = new Map(effectiveRelationships.map(({ row }) => [row.toActorId, row]));
  const relationshipViewFor = (actorId: string) => {
    const dims = relationshipDimsByActor.get(actorId);
    return { relationship: dims?.affinity ?? 0, trust: dims?.trust ?? 0, suspicion: dims?.suspicion ?? 0, debt: dims?.debt ?? 0, fear: dims?.fear ?? 0 };
  };
  const others: AgentContext['others'] = [];
  for (const profile of nearbyProfiles.slice(0, RUNTIME_AGENT_NEARBY_LIMIT)) {
    if (profile.actorId === self.actorId || isSmokeActor(profile.actorId)) continue;
    if (!isAgentInteractionTargetEligible(profile)) continue;
    if ((profile.mapId ?? 'world') !== selfMapId || !self.currentLocationId || profile.currentLocationId !== self.currentLocationId) continue;
    others.push({ actorId: profile.actorId, name: profile.name, role: profile.role, realm: profile.realm, ...relationshipViewFor(profile.actorId) });
  }
  return { effectiveRelationships, relationshipByActor, relationshipRowByActor, relationshipViewFor, others };
}

export async function loadRuntimeAgentMemoryRead(
  ctx: QueryCtx,
  input: {
    worldId: Id<'worlds'>;
    actorId: string;
    nowGameHour: number;
    isSmokeActor: (actorId: string) => boolean;
    touchesSmoke: (row: { aboutActorIds?: string[]; summary?: string }) => boolean;
  },
) {
  const { worldId, actorId, nowGameHour, isSmokeActor, touchesSmoke } = input;
  const [activeMemories, legacyMemories, socialSummaryRows, observationBeliefRows] = await Promise.all([
    ctx.db.query('shortMemories').withIndex('byActorLifecycle', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId).eq('lifecycle', 'active'),
    ).order('desc').take(15),
    ctx.db.query('shortMemories').withIndex('byActor', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId),
    ).order('desc').take(30),
    ctx.db.query('socialMemorySummaries').withIndex('byActorUpdated', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId),
    ).order('desc').take(MAX_PROMPT_SOCIAL_SUMMARIES),
    ctx.db.query('actorBeliefs').withIndex('byActor', (q) =>
      q.eq('worldId', worldId).eq('actorId', actorId),
    ).order('desc').take(64),
  ]);
  const mems = [...activeMemories, ...legacyMemories.filter((memory) => memory.lifecycle === undefined)]
    .sort((left, right) => right.createdAt - left.createdAt || String(right._id).localeCompare(String(left._id)))
    .slice(0, 15);
  const memorySourceEventEntries = await Promise.all(
    [...new Set(mems.map((memory) => memory.sourceEventId))].map(async (sourceEventId) => {
      const normalizedId = ctx.db.normalizeId('worldEvents', sourceEventId);
      return [sourceEventId, normalizedId ? await ctx.db.get(normalizedId) : null] as const;
    }),
  );
  const memorySourceEventById = new Map(memorySourceEventEntries);
  const socialSummaries = socialSummaryRows
    .filter((summary) => isSmokeActor(actorId) || !touchesSmoke(summary))
    .map((summary) => summary.summary);
  const recentEvents = mems
    .filter((memory) => memory.expiresAt > nowGameHour)
    .filter((memory) => isSmokeActor(actorId) || !touchesSmoke(memory))
    .slice(0, 5)
    .map((memory) => memory.summary);
  return { mems, socialSummaryRows, observationBeliefRows, memorySourceEventById, socialSummaries, recentEvents };
}

export async function loadRuntimeAgentActionRead(
  ctx: QueryCtx,
  input: { worldId: Id<'worlds'>; now: number; self: Doc<'xianxiaProfiles'>; selfMapId: string; incapacitated: boolean },
) {
  const { worldId, now, self, selfMapId, incapacitated } = input;
  const location = self.currentLocationId
    ? await ctx.db.query('locations').withIndex('byLocationId', (q) =>
        q.eq('worldId', worldId).eq('locationId', self.currentLocationId!),
      ).first()
    : null;
  const locationOnSameMap = location && (location.mapId ?? 'world') === selfMapId ? location : null;
  const breakthroughReady = canAttemptRealmBreakthrough(self.realm, self.realmStage, self.cultivationXp) &&
    evaluateBreakthroughProgress({ realm: self.realm, realmEnteredAt: self.realmEnteredAt, profileCreatedAt: self._creationTime, breakthroughRecoveryUntil: self.breakthroughRecoveryUntil, inventory: self.inventory, now }).ok;
  const roleKit = allowedActionsForRole(self.role);
  const availableActions = (
    !incapacitated && locationOnSameMap
      ? locationOnSameMap.allowedActions.filter((action) =>
          IMPLEMENTED_ACTION_TYPES.includes(action as ActionType) && roleKit.includes(action) &&
          evaluateFatigueActionGate(self.fatigue, action).ok && (action !== 'breakthrough' || breakthroughReady),
        )
      : []
  ) as ActionType[];
  if (!incapacitated && availableActions.length === 0) {
    availableActions.push(roleKit.includes('cultivate') && evaluateFatigueActionGate(self.fatigue, 'cultivate').ok ? 'cultivate' : 'talk');
  }
  const maxHealth = Math.max(1, self.maxHealth ?? 10);
  if (!incapacitated && self.health < maxHealth && roleKit.includes('use_item') && ownedHealingItemId({ inventory: self.inventory ?? [] }) && !availableActions.includes('use_item')) {
    availableActions.push('use_item');
  }
  return { locationOnSameMap, roleKit, availableActions, maxHealth, breakthroughReady };
}

export async function loadRuntimeAgentCombatRead(
  ctx: QueryCtx,
  input: { worldId: Id<'worlds'>; now: number; self: Doc<'xianxiaProfiles'>; selfMapId: string; incapacitated: boolean; locationOnSameMap: unknown },
) {
  const { worldId, now, self, selfMapId, incapacitated, locationOnSameMap } = input;
  let activeCombatEncounter = await ctx.db.query('combatEncounters').withIndex('byAttackerStatus', (q) =>
    q.eq('worldId', worldId).eq('attackerActorId', self.actorId).eq('status', 'active'),
  ).order('desc').first();
  if (!activeCombatEncounter) {
    activeCombatEncounter = await ctx.db.query('combatEncounters').withIndex('byDefenderStatus', (q) =>
      q.eq('worldId', worldId).eq('defenderActorId', self.actorId).eq('status', 'active'),
    ).order('desc').first();
  }
  const opponentActorId = activeCombatEncounter
    ? activeCombatEncounter.attackerActorId === self.actorId ? activeCombatEncounter.defenderActorId : activeCombatEncounter.attackerActorId
    : undefined;
  const opponent = opponentActorId
    ? await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) => q.eq('worldId', worldId).eq('actorId', opponentActorId)).first()
    : null;
  const lootTargets: NonNullable<AgentContext['combat']>['lootTargets'] = [];
  if (!incapacitated && self.currentLocationId && locationOnSameMap) {
    for (const encounterStatus of ['attacker_defeated', 'defender_defeated'] as const) {
      const encounters = await ctx.db.query('combatEncounters').withIndex('byLocationStatus', (q) =>
        q.eq('worldId', worldId).eq('mapId', selfMapId).eq('locationId', self.currentLocationId!).eq('status', encounterStatus),
      ).order('desc').take(20);
      for (const encounter of encounters) {
        if (!encounter.defeatedActorId) continue;
        const target = await ctx.db.query('xianxiaProfiles').withIndex('actor', (q) =>
          q.eq('worldId', worldId).eq('actorId', encounter.defeatedActorId!),
        ).first();
        if (!target || !isActorIncapacitated(target.health)) continue;
        const reserved = new Map<string, number>();
        for (const status of ['pending', 'accepted', 'acting'] as const) {
          const executions = await ctx.db.query('actionExecutions').withIndex('byTargetStatus', (q) =>
            q.eq('worldId', worldId).eq('targetActorId', target.actorId).eq('status', status),
          ).take(32);
          for (const execution of executions) {
            if (execution.expiresAt <= now || execution.hardDeadlineAt <= now || !execution.reservedTargetItemId) continue;
            reserved.set(execution.reservedTargetItemId, (reserved.get(execution.reservedTargetItemId) ?? 0) + (execution.reservedTargetItemQuantity ?? 0));
          }
        }
        lootTargets.push({
          encounterId: encounter.encounterId, actorId: target.actorId, name: target.name,
          priorityAllowed: !encounter.lootOwnerActorId || encounter.lootOwnerActorId === self.actorId || (encounter.lootProtectedUntil ?? 0) <= now,
          items: (target.inventory ?? []).map((item) => ({ itemId: item.itemId, qty: Math.max(0, item.qty - (reserved.get(item.itemId) ?? 0)) })).filter((item) => item.qty > 0),
        });
      }
    }
  }
  return { activeCombatEncounter, opponentActorId, opponent, lootTargets };
}
