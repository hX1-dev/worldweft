import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  actionExecutionStatusValidator,
  actionSource,
  actionStatus,
  beliefEvidenceVerdictValidator,
  durableActionMetadataValidator,
  durableActionResultValidator,
  durableEffectsValidator,
  durableEventFactsValidator,
  eventVisibility,
  movementCommandStatusValidator,
  movementDecisionSourceValidator,
  movementTargetValidator,
  socialOpportunityActivityValidator,
  socialOutcomeStatusValidator,
  socialWarrantAudienceValidator,
  socialWarrantOutcomeValidator,
  speechActValidator,
  tilePointValidator,
} from './validators';

export const executionTables = {
// §12 Event Log：世界事实的核心，前端展示 / 记忆来源 / 关系声望依据 / 回放。
  worldEvents: defineTable({
    worldId: v.id('worlds'),
    type: v.string(), // e.g. steal_resolved / cultivation_completed / actor_arrived_location
    createdAt: v.number(),
    actorIds: v.array(v.string()),
    targetActorIds: v.optional(v.array(v.string())),
    locationId: v.optional(v.string()),
    actionId: v.optional(v.string()),
    visibility: eventVisibility,
    witnessActorIds: v.optional(v.array(v.string())),
    summary: v.string(), // 可有文学性
    facts: v.optional(durableEventFactsValidator),
    effects: v.optional(durableEffectsValidator),
    mapId: v.optional(v.string()), // 渐进式多地图：world / qinglan 等 surface id。
  })
    .index('worldId', ['worldId', 'createdAt'])
    .index('byMap', ['worldId', 'mapId', 'createdAt'])
    .index('byType', ['worldId', 'type'])
    .index('byAction', ['worldId', 'actionId']),

// C021b0e binds a causal SocialWarrant to one authoritative terminal. It is
  // an audit/anti-spam receipt only; inventory, relationship, belief and memory
  // effects remain owned by their existing event-sourced paths.
  socialOutcomeReceipts: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.social-outcome.v1'),
    outcomeId: v.string(),
    scopeKey: v.string(),
    revision: v.number(),
    actorId: v.string(),
    targetActorIds: v.array(v.string()),
    sourceRef: v.string(),
    sourceRevision: v.string(),
    intendedOutcome: socialWarrantOutcomeValidator,
    activity: socialOpportunityActivityValidator,
    topicRefs: v.array(v.string()),
    audience: socialWarrantAudienceValidator,
    warrantId: v.string(),
    warrantDigest: v.string(),
    candidateId: v.string(),
    candidateDigest: v.string(),
    warrantCandidateDigest: v.string(),
    status: socialOutcomeStatusValidator,
    openedByActionId: v.id('actionRecords'),
    openedEventId: v.id('worldEvents'),
    conversationId: v.optional(v.string()),
    groupConversationId: v.optional(v.string()),
    terminalActionId: v.optional(v.id('actionRecords')),
    terminalEventId: v.optional(v.id('worldEvents')),
    outcomeEventId: v.optional(v.id('worldEvents')),
    terminalResultCode: v.optional(v.string()),
    terminalReasonCode: v.optional(v.string()),
    cooldownUntilGameHour: v.optional(v.number()),
    createdGameHour: v.number(),
    terminalGameHour: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byOutcome', ['worldId', 'outcomeId'])
    .index('byScope', ['worldId', 'scopeKey', 'updatedAt'])
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'updatedAt'])
    .index('byOpenedAction', ['worldId', 'openedByActionId'])
    .index('byConversation', ['worldId', 'conversationId'])
    .index('byGroupConversation', ['worldId', 'groupConversationId'])
    .index('byTerminalEvent', ['worldId', 'terminalEventId']),

// LWSE-3d P9g is an execution-admission fence only. It binds an already
  // revalidated P9f dispatch to one future owner without creating a goal,
  // action, body command, event, or terminal.
  guardHandoffExecutionAdmissions: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.guard-handoff-execution-admission.v1'),
    executionAdmissionId: v.string(),
    status: v.literal('admitted'),
    planId: v.string(),
    planRevision: v.number(),
    planDigest: v.string(),
    scheduleRevision: v.number(),
    scheduleDigest: v.string(),
    handoffFactsDigest: v.string(),
    sourceRef: v.string(),
    sourceRevision: v.string(),
    sourceDigest: v.string(),
    handoffMapId: v.string(),
    handoffLocationId: v.string(),
    outgoingActorId: v.string(),
    incomingActorId: v.string(),
    outgoingAssignmentId: v.string(),
    incomingAssignmentId: v.string(),
    outgoingAdmissionDigest: v.string(),
    incomingAdmissionDigest: v.string(),
    dispatchDigest: v.string(),
    providerCalls: v.literal(0),
    createdWorldActions: v.literal(0),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('byNaturalKey', ['worldId', 'planId', 'planRevision', 'dispatchDigest']),

// P9l is immutable evidence only. A future pair-terminal owner must patch
  // the outgoing assignment and insert this receipt in the same transaction.
  guardHandoffAssignmentTransitionReceipts: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.guard-handoff-assignment-transition-receipt.v1'),
    transitionKey: v.string(),
    executionAdmissionId: v.string(),
    dispatchDigest: v.string(),
    planId: v.string(),
    planRevision: v.number(),
    planDigest: v.string(),
    terminalRef: v.string(),
    terminalDigest: v.string(),
    outgoingAssignmentId: v.string(),
    outgoingPreRevision: v.number(),
    outgoingPreDigest: v.string(),
    outgoingPostRevision: v.number(),
    outgoingPostDigest: v.string(),
    incomingAssignmentId: v.string(),
    incomingPreRevision: v.number(),
    incomingPreDigest: v.string(),
    incomingPostRevision: v.number(),
    incomingPostDigest: v.string(),
    outcome: v.literal('applied'),
    reasonCode: v.literal('guard_handoff_completed'),
    receiptDigest: v.string(),
    createdAt: v.number(),
  }).index('byNaturalKey', ['worldId', 'executionAdmissionId', 'dispatchDigest']),

// 用户/调试视角当前所在 surface。它只表达“入口/返回状态”，不移动 AI Town 身体。
  surfaceSessions: defineTable({
    worldId: v.id('worlds'),
    sessionId: v.string(),
    currentMapId: v.string(),
    currentLocationId: v.optional(v.string()),
    originMapId: v.optional(v.string()),
    originLocationId: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('bySession', ['worldId', 'sessionId']),

// 溪谷自主移动采用异步命令：Convex 决定、校验目标，Godot 持有逐帧物理位置。
  // 每个 actor 只有一个 active revision；客户端稀疏回报续租，终态保留用于审计/回放。
  movementCommands: defineTable({
    worldId: v.id('worlds'),
    actionRecordId: v.id('actionRecords'),
    // Copied from the materialized Pi v3 ActionRecord; ordinary and legacy
    // executions intentionally remain unbound.
    autonomyDecisionTraceId: v.optional(v.id('autonomyDecisionTraces')),
    revision: v.number(),
    actorId: v.string(),
    personalGoalId: v.optional(v.string()),
    personalGoalRevision: v.optional(v.number()),
    purposeIntentDigest: v.optional(v.string()),
    mapId: v.string(),
    intent: v.string(),
    decisionSource: movementDecisionSourceValidator,
    requestedTarget: movementTargetValidator,
    originTile: tilePointValidator,
    acceptedTile: tilePointValidator,
    acceptedMaskType: v.string(),
    resolvedLocationId: v.optional(v.string()),
    status: movementCommandStatusValidator,
    lastTile: v.optional(tilePointValidator),
    lastReportedAt: v.optional(v.number()),
    reasonCode: v.optional(v.string()),
    issuedAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('byWorld', ['worldId'])
    .index('byMapStatus', ['worldId', 'mapId', 'status', 'updatedAt'])
    .index('byActorRevision', ['worldId', 'actorId', 'revision'])
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'updatedAt'])
    .index('byAction', ['worldId', 'actionRecordId']),

// C004 持续动作执行层。ActionRecord 表达高层意图；本表持有 Godot 身体的
  // pending/accepted/acting/terminal 过程。完成前不结算动作效果。
  actionExecutions: defineTable({
    worldId: v.id('worlds'),
    actionRecordId: v.id('actionRecords'),
    // Pi-selected actions already bind their ActionRecord to an immutable
    // decision trace. Persist the same optional link on the body execution so
    // wake → choice → physical terminal remains auditable as one chain.
    autonomyDecisionTraceId: v.optional(v.id('autonomyDecisionTraces')),
    revision: v.number(),
    actorId: v.string(),
    personalGoalId: v.optional(v.string()),
    personalGoalRevision: v.optional(v.number()),
    purposeIntentDigest: v.optional(v.string()),
    actionType: v.string(),
    source: actionSource,
    mapId: v.optional(v.string()),
    locationId: v.optional(v.string()),
    targetActorId: v.optional(v.string()),
    encounterId: v.optional(v.string()),
    resourceNodeId: v.optional(v.string()),
    reservedQuantity: v.optional(v.number()),
    cultivationMode: v.optional(
      v.union(v.literal('ambient'), v.literal('spirit_stone'), v.literal('qi_pill')),
    ),
    reservedItemId: v.optional(v.string()),
    reservedItemQuantity: v.optional(v.number()),
    reservedTargetItemId: v.optional(v.string()),
    reservedTargetItemQuantity: v.optional(v.number()),
    tradeMode: v.optional(
      v.union(v.literal('direct'), v.literal('shop_buy'), v.literal('shop_sell')),
    ),
    shopId: v.optional(v.string()),
    tradeItemId: v.optional(v.string()),
    tradeItemQuantity: v.optional(v.number()),
    tradeUnitPrice: v.optional(v.number()),
    tradeTotalPrice: v.optional(v.number()),
    reservedShopItemId: v.optional(v.string()),
    reservedShopItemQuantity: v.optional(v.number()),
    reservedShopWalletSpiritStones: v.optional(v.number()),
    reservedShopCapacityItemId: v.optional(v.string()),
    reservedShopCapacityQuantity: v.optional(v.number()),
    teachingTopic: v.optional(v.literal('cultivation_fundamentals')),
    requestId: v.optional(v.id('requests')),
    requestRevision: v.optional(v.number()),
    intent: v.string(),
    status: actionExecutionStatusValidator,
    durationMs: v.number(),
    leaseOwner: v.optional(v.string()),
    hardDeadlineAt: v.number(),
    lastMapId: v.optional(v.string()),
    lastTile: v.optional(tilePointValidator),
    // The body executor may resolve an occupied semantic entry point to a
    // nearby legal cell. Persist that exact endpoint so arrival remains a
    // <=0.25 tile physical check instead of a broad location-membership guess.
    targetTile: v.optional(tilePointValidator),
    // World-map travel is driven by an engine input. Persisting the exact row
    // lets a bounded body executor prove it consumed this command and no
    // caller-injected duplicate.
    movementInputId: v.optional(v.id('inputs')),
    movementInputNumber: v.optional(v.number()),
    movementPlayerId: v.optional(v.string()),
    movementInputDigest: v.optional(v.string()),
    acceptedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    lastHeartbeatAt: v.optional(v.number()),
    terminalAt: v.optional(v.number()),
    terminalEventId: v.optional(v.id('worldEvents')),
    resultCode: v.optional(v.string()),
    reasonCode: v.optional(v.string()),
    issuedAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
  })
    .index('byWorld', ['worldId'])
    .index('byAction', ['worldId', 'actionRecordId'])
    .index('byActorRevision', ['worldId', 'actorId', 'revision'])
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'updatedAt'])
    .index('byTargetStatus', ['worldId', 'targetActorId', 'status', 'updatedAt'])
    .index('byShopStatus', ['worldId', 'shopId', 'status', 'updatedAt'])
    .index('byResourceStatus', ['worldId', 'resourceNodeId', 'status', 'updatedAt'])
    .index('byEncounterStatus', ['worldId', 'encounterId', 'status', 'updatedAt'])
    .index('byMapStatus', ['worldId', 'mapId', 'status', 'updatedAt']),

// Exactly-once fence for H7 admission. The terminal event remains the source
  // of truth; this row only records a verified actor-owned H6 adoption.
  taixuResultAdmissionReceipts: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(),
    terminalEventId: v.id('worldEvents'),
    receiptId: v.string(),
    receiptRevision: v.number(),
    contractVersion: v.optional(v.literal('taixu.embodiment-receipt.v1')),
    authority: v.optional(v.literal('godot')),
    decisionId: v.optional(v.string()),
    candidateId: v.optional(v.string()),
    status: v.optional(v.literal('arrived')),
    terminalSourceRef: v.optional(v.string()),
    reportedAt: v.optional(v.number()),
    traceId: v.id('autonomyDecisionTraces'),
    actionRecordId: v.id('actionRecords'),
    executionId: v.id('actionExecutions'),
    visibility: v.union(v.literal('public'), v.literal('actor_private')),
    evidenceDigest: v.string(),
    stateRevision: v.number(),
    createdAt: v.number(),
  }).index('byActorTerminalEvent', ['worldId', 'actorId', 'terminalEventId']),

// C016e3a：只记录已经完成裁决的有向社会动作尝试。技术拒绝、身体中断和
  // lease 失败不写 usage；因此它既是动作冷却依据，也是可追溯的反刷取证据。
  socialActionUsages: defineTable({
    worldId: v.id('worlds'),
    usageId: v.string(),
    actionRecordId: v.id('actionRecords'),
    sourceEventId: v.id('worldEvents'),
    actionType: v.string(),
    actorId: v.string(),
    targetActorId: v.string(),
    sourceGameHour: v.optional(v.number()),
    sourceGameDay: v.number(),
    outcome: v.string(),
    createdAt: v.number(),
  })
    .index('byUsage', ['worldId', 'usageId'])
    .index('byAction', ['worldId', 'actionRecordId'])
    .index('byActorTargetTypeDay', [
      'worldId',
      'actorId',
      'targetActorId',
      'actionType',
      'sourceGameDay',
    ]),

// C010 hostile conflict fact. Friendly spar never creates a row here.
  combatEncounters: defineTable({
    worldId: v.id('worlds'),
    encounterId: v.string(),
    attackerActorId: v.string(),
    defenderActorId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('attacker_fled'),
      v.literal('defender_fled'),
      v.literal('attacker_defeated'),
      v.literal('defender_defeated'),
      v.literal('closed'),
    ),
    winnerActorId: v.optional(v.string()),
    defeatedActorId: v.optional(v.string()),
    lootOwnerActorId: v.optional(v.string()),
    lootProtectedUntil: v.optional(v.number()),
    witnessActorIds: v.array(v.string()),
    guardActorIds: v.array(v.string()),
    initiatedByActionId: v.id('actionRecords'),
    terminalActionId: v.optional(v.id('actionRecords')),
    terminalEventId: v.optional(v.id('worldEvents')),
    compensationNegotiationId: v.optional(v.string()),
    compensationActionId: v.optional(v.id('actionRecords')),
    compensationEventId: v.optional(v.id('worldEvents')),
    compensationSpiritStones: v.optional(v.number()),
    compensatedAt: v.optional(v.number()),
    startedAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('byEncounter', ['worldId', 'encounterId'])
    .index('byAttackerStatus', ['worldId', 'attackerActorId', 'status', 'updatedAt'])
    .index('byDefenderStatus', ['worldId', 'defenderActorId', 'status', 'updatedAt'])
    .index('byLocationStatus', ['worldId', 'mapId', 'locationId', 'status', 'updatedAt']),

// Large-world memory propagation is asynchronous. The durable job row is the
  // cancellation/continuation boundary: cleanup removes it before deleting
  // memories, so an in-flight page conflicts and cannot recreate cleaned data.
  memoryFanoutJobs: defineTable({
    worldId: v.id('worlds'),
    eventId: v.id('worldEvents'),
    nowGameHour: v.number(),
    status: v.union(v.literal('pending'), v.literal('completed')),
    cursor: v.optional(v.string()),
    pagesProcessed: v.number(),
    actorsProcessed: v.number(),
    memoriesInserted: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('byEvent', ['worldId', 'eventId']),

conversationUtterances: defineTable({
    worldId: v.id('worlds'),
    conversationId: v.string(),
    turnId: v.string(),
    turnNumber: v.number(),
    actionRecordId: v.id('actionRecords'),
    sourceEventId: v.id('worldEvents'),
    speakerActorId: v.string(),
    addressedActorIds: v.array(v.string()),
    speechAct: speechActValidator,
    topicId: v.string(),
    utteranceText: v.string(),
    referencedFactIds: v.array(v.string()),
    referencedBeliefIds: v.array(v.string()),
    proposalId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('byConversationTurn', ['worldId', 'conversationId', 'turnNumber'])
    .index('byTurnId', ['worldId', 'conversationId', 'turnId'])
    .index('bySpeaker', ['worldId', 'speakerActorId', 'createdAt'])
    .index('byAction', ['worldId', 'actionRecordId']),

// Semantic idempotency is actor+belief-series+evidence, not clientActionId.
  beliefEvidenceApplications: defineTable({
    worldId: v.id('worlds'),
    applicationId: v.string(),
    actorId: v.string(),
    beliefSeriesId: v.string(),
    subjectClaimId: v.string(),
    evidenceId: v.string(),
    evidenceEventId: v.id('worldEvents'),
    verdict: beliefEvidenceVerdictValidator,
    priorBeliefId: v.optional(v.string()),
    resultingBeliefId: v.string(),
    revision: v.number(),
    clarificationClaimId: v.string(),
    clarificationEventId: v.id('worldEvents'),
    appliedAt: v.number(),
  })
    .index('byApplication', ['worldId', 'applicationId'])
    .index('bySeries', ['worldId', 'beliefSeriesId', 'appliedAt']),

// §8 Action 生命周期与结果记录。玩家与 Agent 共用同一入口 submitAction（M2）。
  actionRecords: defineTable({
    worldId: v.id('worlds'),
    actorId: v.string(),
    personalGoalId: v.optional(v.string()),
    personalGoalRevision: v.optional(v.number()),
    purposeIntentDigest: v.optional(v.string()),
    type: v.string(), // cultivate / talk / trade / gift / request_teaching / spar / explore / steal / travel
    status: actionStatus,
    targetId: v.optional(v.string()),
    targetActorId: v.optional(v.string()),
    locationId: v.optional(v.string()),
    intent: v.optional(v.string()),
    source: actionSource,
    mapId: v.optional(v.string()),
    clientActionId: v.optional(v.string()),
    clientActionFingerprint: v.optional(v.string()),
    // The decision-trace candidate this action executes, when a decision trace
    // chose it. Kept apart from clientActionFingerprint: the rules layer may
    // enrich the final action before submission. A fact reference only.
    chosenCandidateId: v.optional(v.string()),
    chosenCandidateFingerprint: v.optional(v.string()),
    autonomyDecisionTraceId: v.optional(v.id('autonomyDecisionTraces')),
    riskTolerance: v.optional(v.number()),
    createdAt: v.number(),
    result: v.optional(durableActionResultValidator),
    seed: v.optional(v.string()), // 可记录随机种子，便于复现（§18.3）
    metadata: v.optional(durableActionMetadataValidator),
  })
    .index('byWorld', ['worldId'])
    .index('actor', ['worldId', 'actorId'])
    .index('byClientAction', ['worldId', 'actorId', 'clientActionId'])
    .index('byStatus', ['worldId', 'status']),
} as const;
