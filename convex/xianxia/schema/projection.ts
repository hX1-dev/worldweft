import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  autonomyCandidateValidator,
  autonomyDecisionBoundsValidator,
  autonomyDecisionOutcomeValidator,
  autonomyDecisionSourceValidator,
  autonomyPersonaPolicyValidator,
  beliefEvidenceVerdictValidator,
  beliefKindValidator,
  beliefValidityValidator,
  claimTruthStatusValidator,
  relationshipDeltaValidator,
  relationshipDimsValidator,
  reliabilityEvidenceDirectionValidator,
  socialConsequenceKindValidator,
  socialConsequenceSourceKindValidator,
  socialConsequenceStatusValidator,
  socialWarrantAudienceValidator,
} from './validators';

export const projectionTables = {
// C017a–C017c immutable decision trace. Historical v1/v2 rows remain readable;
  // v3 records survival and persona policy inputs used by production selection.
  // The trace never settles an action. decisionId is replay-safe; ordinary
  // turns derive it from actor/revision, while leased Pi NPC turns use turnId
  // so separate turns may observe the same revision without sharing evidence.
  autonomyDecisionTraces: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.union(
      v.literal('taixu.autonomy-decision.v1'),
      v.literal('taixu.autonomy-decision.v2'),
      v.literal('taixu.autonomy-decision.v3'),
    ),
    decisionId: v.string(),
    actorId: v.string(),
    observationRevision: v.string(),
    candidates: v.array(autonomyCandidateValidator),
    chosenCandidateId: v.optional(v.string()),
    decisionSource: autonomyDecisionSourceValidator,
    outcome: autonomyDecisionOutcomeValidator,
    idleReasonCode: v.optional(v.string()),
    exceptionReason: v.optional(v.string()),
    exceptionSourceIds: v.optional(v.array(v.string())),
    survivalEnvelope: v.optional(
      v.object({
        state: v.union(
          v.literal('incapacitated'),
          v.literal('danger'),
          v.literal('recovery'),
          v.literal('stable'),
        ),
        urgency: v.number(),
        reasonCodes: v.array(v.string()),
        decisionKind: v.string(),
      }),
    ),
    personaPolicy: v.optional(autonomyPersonaPolicyValidator),
    bounds: autonomyDecisionBoundsValidator,
    createdAt: v.number(),
  })
    .index('byDecision', ['worldId', 'decisionId'])
    .index('byActorObservation', ['worldId', 'actorId', 'observationRevision'])
    .index('byActorCreatedAt', ['worldId', 'actorId', 'createdAt']),

// LWSE-1 owns bounded social meaning derived from an already verified
  // outcome terminal. These rows are not relationship, memory, resource, or
  // future-candidate writes; later stages may consume them through separate
  // latest-facts gates.
  socialConsequences: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.social-consequence.v1'),
    consequenceId: v.string(),
    revision: v.number(),
    sourceOutcomeId: v.string(),
    sourceOutcomeRevision: v.number(),
    sourceKind: socialConsequenceSourceKindValidator,
    sourceActionId: v.id('actionRecords'),
    sourceEventId: v.id('worldEvents'),
    sourceWarrantId: v.optional(v.string()),
    sourceRevision: v.string(),
    scopeKey: v.string(),
    kind: socialConsequenceKindValidator,
    evidenceDirection: v.optional(reliabilityEvidenceDirectionValidator),
    subjectActorId: v.string(),
    counterpartActorIds: v.array(v.string()),
    audience: socialWarrantAudienceValidator,
    intensityBand: v.literal('meaningful'),
    status: socialConsequenceStatusValidator,
    remainingProjectionBudget: v.number(),
    dueGameHour: v.optional(v.number()),
    expiresGameHour: v.number(),
    terminalGameHour: v.optional(v.number()),
    terminalReasonCode: v.optional(v.literal('social_consequence_expired')),
    createdGameHour: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byConsequence', ['worldId', 'consequenceId'])
    .index('bySourceOutcome', ['worldId', 'sourceOutcomeId', 'kind'])
    .index('bySubjectStatus', ['worldId', 'subjectActorId', 'status', 'updatedAt'])
    .index('bySourceEvent', ['worldId', 'sourceEventId'])
    .index('byExpiry', ['worldId', 'status', 'expiresGameHour']),

// LWSE-3b actor/window review projection. It is an immutable, bounded read
  // receipt over existing fact owners. Literal zero counters prevent a review
  // from being mistaken for a plan, candidate, memory, relationship change,
  // provider turn, or world action.
  lifeSocialReviews: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.life-social-review.v1'),
    reviewId: v.string(),
    actorId: v.string(),
    windowId: v.string(),
    windowDigest: v.string(),
    cadence: v.union(v.literal('daily'), v.literal('weekly')),
    periodIndex: v.number(),
    windowStartGameHour: v.number(),
    windowEndGameHour: v.number(),
    status: v.union(v.literal('quiet'), v.literal('factual')),
    sourceRefs: v.array(v.object({
      kind: v.union(
        v.literal('personal_goal_open'),
        v.literal('personal_goal_terminal'),
        v.literal('action_terminal'),
        v.literal('group_duty_open'),
        v.literal('group_duty_terminal'),
        v.literal('social_session_terminal'),
        v.literal('group_session_terminal'),
        v.literal('social_consequence_open'),
        v.literal('social_consequence_terminal'),
      ),
      sourceRef: v.string(),
      sourceRevision: v.string(),
      sourceDigest: v.string(),
      occurredGameHour: v.number(),
      visibility: v.union(v.literal('actor_private'), v.literal('participants')),
      subjectActorIds: v.array(v.string()),
    })),
    sourceSetDigest: v.string(),
    sourcesTruncated: v.boolean(),
    providerCalls: v.literal(0),
    createdWorldActions: v.literal(0),
    createdSocialCandidates: v.literal(0),
    createdRelationshipChanges: v.literal(0),
    createdMemories: v.literal(0),
    recordedAt: v.number(),
    reviewDigest: v.string(),
  })
    .index('byReview', ['worldId', 'reviewId'])
    .index('byActorCadencePeriod', ['worldId', 'actorId', 'cadence', 'periodIndex'])
    .index('byWindowActor', ['worldId', 'windowId', 'actorId'])
    .index('byRecordedAt', ['worldId', 'recordedAt']),

// Per-actor projection checkpoint. Review rows remain the immutable result;
  // this small row only prevents full-history scans and makes crash/restart
  // catch-up deterministic.
  lifeSocialReviewStates: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.life-social-review-state.v1'),
    actorId: v.string(),
    actorCreatedGameHour: v.number(),
    firstDayIndex: v.number(),
    firstWeekIndex: v.number(),
    appliedDayIndex: v.number(),
    appliedWeekIndex: v.number(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('byActor', ['worldId', 'actorId']),

// C015b：每一桩 source event 对一条有向关系的实际/被抑制后果。
  // changeId = sourceEvent + direction + effectKind；OCC 下并发重放只能保留一条。
  relationshipChanges: defineTable({
    worldId: v.id('worlds'),
    changeId: v.string(),
    sourceEventId: v.string(),
    fromActorId: v.string(),
    toActorId: v.string(),
    effectKind: v.string(),
    sourceGameDay: v.number(),
    baseDelta: relationshipDeltaValidator,
    appliedDelta: relationshipDeltaValidator,
    before: relationshipDimsValidator,
    after: relationshipDimsValidator,
    priorWindowCount: v.number(),
    multiplier: v.number(),
    status: v.union(v.literal('applied'), v.literal('suppressed')),
    reasonCode: v.optional(
      v.union(v.literal('relationship_gain_cooldown'), v.literal('relationship_saturated')),
    ),
    createdAt: v.number(),
  })
    .index('byChangeId', ['worldId', 'changeId'])
    .index('bySourceEvent', ['worldId', 'sourceEventId'])
    .index('byDirectionKindDay', [
      'worldId',
      'fromActorId',
      'toActorId',
      'effectKind',
      'sourceGameDay',
    ]),

// C017f 稀疏世界压力。Director 只能写环境事实；角色是否响应仍由
  // 正式 Agent 候选、人格策略与动作规则共同裁决。
  worldPressures: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.world-pressure.v1'),
    pressureId: v.string(),
    revision: v.number(),
    kind: v.literal('herb_miasma'),
    status: v.union(v.literal('active'), v.literal('resolved'), v.literal('cancelled')),
    mapId: v.string(),
    locationId: v.string(),
    affectedResourceNodeIds: v.array(v.string()),
    severity: v.number(),
    effectCodes: v.array(v.literal('resource_refresh_delayed')),
    maximumAffectedResourceNodes: v.number(),
    startedAt: v.number(),
    startsAtGameHour: v.number(),
    endsAt: v.number(),
    endsAtGameHour: v.number(),
    cooldownEndsAtGameHour: v.number(),
    sourceEventId: v.id('worldEvents'),
    terminalEventId: v.optional(v.id('worldEvents')),
    terminalReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('byPressure', ['worldId', 'pressureId'])
    .index('byWorldStatus', ['worldId', 'status'])
    .index('byMapStatus', ['worldId', 'mapId', 'status', 'locationId']),

// H7 result admission is actor-owned interpretation of an already canonical
  // terminal event. It never substitutes for worldEvents or shortMemories.
  taixuResultAdoptionStates: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(),
    revision: v.number(),
    stateJson: v.string(),
    stateDigest: v.string(),
    updatedAt: v.number(),
  }).index('byActor', ['worldId', 'actorId']),

// M5 短期记忆：由重要事件经可见性/传闻传播生成，喂给 Agent 决策（知识过滤）。
  // 记忆必关联 sourceEventId（§10.1：记忆来自事件，非 LLM 凭空生成）。summary 可能是
  // 走样的传言版本。salience/expiresAt 控制重要度与保留时长（§10.4）。
  shortMemories: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(), // 记住此事的人
    sourceEventId: v.string(),
    aboutActorIds: v.array(v.string()),
    type: v.string(),
    salience: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    summary: v.string(),
    source: v.optional(
      v.union(v.literal('direct'), v.literal('witness'), v.literal('present'), v.literal('rumor')),
    ),
    distorted: v.optional(v.boolean()),
    // C015a: legacy rows without lifecycle are treated as active until their
    // first compaction pass. Archived rows retain the complete event evidence
    // but are excluded from ordinary Agent prompts.
    lifecycle: v.optional(v.union(v.literal('active'), v.literal('archived'))),
    archivedAtGameHour: v.optional(v.number()),
    socialSummaryId: v.optional(v.string()),
  })
    .index('byActor', ['worldId', 'actorId', 'createdAt'])
    .index('byActorLifecycle', ['worldId', 'actorId', 'lifecycle', 'createdAt'])
    .index('byActorSourceEvent', ['worldId', 'actorId', 'sourceEventId'])
    .index('bySourceEvent', ['worldId', 'sourceEventId']),

// C015a deterministic social summaries. They are actor-owned background,
  // never world facts. The archived episodic rows remain the complete audit
  // trail and point back here via socialSummaryId.
  socialMemorySummaries: defineTable({
    worldId: v.id('worlds'),
    summaryId: v.string(),
    actorId: v.string(),
    subjectActorId: v.string(),
    summary: v.string(),
    memoryCount: v.number(),
    sourceEventIds: v.array(v.string()),
    eventTypes: v.array(v.string()),
    sourceKinds: v.array(
      v.union(v.literal('direct'), v.literal('witness'), v.literal('present'), v.literal('rumor')),
    ),
    firstOccurredAt: v.number(),
    lastOccurredAt: v.number(),
    highestSalience: v.number(),
    containsDistortion: v.boolean(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('bySummary', ['worldId', 'summaryId'])
    .index('byActorSubject', ['worldId', 'actorId', 'subjectActorId'])
    .index('byActorUpdated', ['worldId', 'actorId', 'updatedAt']),

// C015a keeps legacy migration in a small row instead of patching the much
  // larger profile during fanout. Pending work survives process restarts.
  memoryCompactionStates: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(),
    status: v.union(v.literal('pending'), v.literal('migrated')),
    requestedAtGameHour: v.number(),
    lastCompactedAtGameHour: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('byActor', ['worldId', 'actorId']),

// claim 是某人说过的不可变主张，不是真实世界事实。
  socialClaims: defineTable({
    worldId: v.id('worlds'),
    claimId: v.string(),
    conversationId: v.string(),
    utteranceId: v.id('conversationUtterances'),
    sourceEventId: v.id('worldEvents'),
    assertedByActorId: v.string(),
    summary: v.string(),
    referencedFactIds: v.array(v.string()),
    referencedBeliefIds: v.array(v.string()),
    truthStatus: claimTruthStatusValidator,
    // C016e2 provenance fields are optional only for legacy rows. Every new
    // claim write fills them.
    topicId: v.optional(v.string()),
    subjectClaimId: v.optional(v.string()),
    subjectActorIds: v.optional(v.array(v.string())),
    evidenceEventId: v.optional(v.string()),
    evidenceVerdict: v.optional(beliefEvidenceVerdictValidator),
    createdAt: v.number(),
  })
    .index('byClaim', ['worldId', 'claimId'])
    .index('byConversation', ['worldId', 'conversationId', 'createdAt']),

// belief 属于具体角色；rumor 是 belief 的一种来源等级，永不升级为 worldFact。
  actorBeliefs: defineTable({
    worldId: v.id('worlds'),
    beliefId: v.string(),
    actorId: v.string(),
    kind: beliefKindValidator,
    sourceClaimId: v.string(),
    sourceUtteranceId: v.id('conversationUtterances'),
    sourceEventId: v.id('worldEvents'),
    sourceActorId: v.string(),
    summary: v.string(),
    confidence: v.number(),
    active: v.boolean(),
    // C016e2 immutable revision chain. Legacy rows fall back to revision 1,
    // sourceClaimId as the subject, and active/superseded from `active`.
    beliefSeriesId: v.optional(v.string()),
    subjectClaimId: v.optional(v.string()),
    topicId: v.optional(v.string()),
    subjectActorIds: v.optional(v.array(v.string())),
    revision: v.optional(v.number()),
    validity: v.optional(beliefValidityValidator),
    truthStatus: v.optional(claimTruthStatusValidator),
    supersedesBeliefId: v.optional(v.string()),
    supersededByBeliefId: v.optional(v.string()),
    evidenceEventId: v.optional(v.string()),
    evidenceVerdict: v.optional(beliefEvidenceVerdictValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byActor', ['worldId', 'actorId', 'updatedAt'])
    .index('byActorBelief', ['worldId', 'actorId', 'beliefId'])
    .index('bySourceClaim', ['worldId', 'sourceClaimId', 'actorId'])
    .index('byActorSeries', ['worldId', 'actorId', 'beliefSeriesId', 'active'])
    .index('bySubjectClaim', ['worldId', 'subjectClaimId', 'actorId', 'revision']),

// Only the rule layer may register an evidence verdict. Conversation text
  // can cite this record but cannot choose confirm/refute/uncertain.
  beliefEvidence: defineTable({
    worldId: v.id('worlds'),
    evidenceId: v.string(),
    subjectClaimId: v.string(),
    topicId: v.string(),
    subjectActorIds: v.array(v.string()),
    sourceEventId: v.id('worldEvents'),
    verdict: beliefEvidenceVerdictValidator,
    createdAt: v.number(),
  })
    .index('byEvidence', ['worldId', 'evidenceId'])
    .index('bySourceEvent', ['worldId', 'sourceEventId'])
    .index('byClaim', ['worldId', 'subjectClaimId', 'createdAt'])
    .index('byClaimEvent', ['worldId', 'subjectClaimId', 'sourceEventId']),
} as const;
