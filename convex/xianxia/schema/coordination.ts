import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  conversationStatusValidator,
  groupCommitmentStatusValidator,
  groupConversationMembershipRoleValidator,
  groupConversationStatusValidator,
  groupProposalStatusValidator,
  groupSocialInitiationStatusValidator,
  groupSocialParticipantRoleEntryValidator,
  groupSocialParticipantRoleValidator,
  groupSocialResponseValidator,
  groupSocialSourceKindValidator,
  groupVoteChoiceValidator,
  guardHandoffFactsValidator,
  negotiationKindValidator,
  negotiationProposalStatusValidator,
  negotiationStatusValidator,
  personalGoalBacklogEntryValidator,
  personalGoalKindValidator,
  personalGoalStatusValidator,
  purposeBoundLifeIntentV2Validator,
  purposeGoalStageValidator,
  sharedPlanKindValidator,
  sharedPlanParticipantValidator,
  sharedPlanStatusValidator,
  socialInvitationActivityValidator,
  socialInvitationStatusValidator,
  socialOpportunityCandidateValidator,
  socialWarrantOutcomeValidator,
  socialWarrantValidator,
} from './validators';

export const coordinationTables = {
// C017d bounded, server-observed personal goals. Historical rows preserve
  // terminal reasons; only one row per actor may be active at a time.
  personalGoals: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.personal-goal.v1'),
    goalId: v.string(),
    actorId: v.string(),
    revision: v.number(),
    status: personalGoalStatusValidator,
    goalKey: v.optional(v.string()),
    kind: v.optional(personalGoalKindValidator),
    sourceRef: v.optional(v.string()),
    targetRef: v.optional(v.string()),
    candidateId: v.optional(v.string()),
    intent: v.optional(v.string()),
    progressScore: v.optional(v.number()),
    progressKey: v.optional(v.string()),
    progressRevision: v.number(),
    backlog: v.array(personalGoalBacklogEntryValidator),
    observationRevision: v.string(),
    startedGameHour: v.optional(v.number()),
    lastProgressGameHour: v.optional(v.number()),
    deadlineGameHour: v.optional(v.number()),
    hardDeadlineGameHour: v.optional(v.number()),
    attemptCount: v.number(),
    lastActionRecordId: v.optional(v.id('actionRecords')),
    lastActionType: v.optional(v.string()),
    // C021q3 additive v2 chain. Legacy v1 rows intentionally omit these
    // fields and keep their historical behavior/digests.
    purposeIntent: v.optional(purposeBoundLifeIntentV2Validator),
    purposeIntentDigest: v.optional(v.string()),
    // C021q4 deterministic semantic cadence. Optional preserves every C020/q3
    // historical row without migration or digest rewriting.
    purposeCadenceKey: v.optional(v.string()),
    purposeStage: v.optional(purposeGoalStageValidator),
    purposeArrivalActionRecordId: v.optional(v.id('actionRecords')),
    purposeArrivalEventId: v.optional(v.id('worldEvents')),
    purposeActivityActionRecordId: v.optional(v.id('actionRecords')),
    purposeActivityExecutionId: v.optional(v.id('actionExecutions')),
    purposeActivityTerminalEventId: v.optional(v.id('worldEvents')),
    socialInvitationId: v.optional(v.string()),
    socialInvitationRevision: v.optional(v.number()),
    socialConversationId: v.optional(v.string()),
    terminalGameHour: v.optional(v.number()),
    nextEligibleGameHour: v.optional(v.number()),
    idleReasonCode: v.optional(v.string()),
    terminalReasonCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    terminalAt: v.optional(v.number()),
  })
    .index('byGoal', ['worldId', 'goalId'])
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'revision'])
    .index('byActorRevision', ['worldId', 'actorId', 'revision'])
    .index('byActorTerminalGameHour', ['worldId', 'actorId', 'terminalGameHour', 'revision']),

// C021b0c bounded cross-location coordination. This receipt does not move a
  // body or open a conversation; accepted rows only reserve two semantic
  // meeting seats and authorize the existing personal-goal/travel/talk chain.
  socialInvitations: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.social-invitation.v1'),
    invitationId: v.string(),
    invitationKey: v.string(),
    revision: v.number(),
    actorId: v.string(),
    targetActorId: v.string(),
    warrant: socialWarrantValidator,
    warrantId: v.string(),
    warrantDigest: v.string(),
    candidate: socialOpportunityCandidateValidator,
    candidateId: v.string(),
    candidateDigest: v.string(),
    sourceRef: v.string(),
    sourceRevision: v.string(),
    intendedActivity: socialInvitationActivityValidator,
    meetingMapId: v.string(),
    meetingLocationId: v.string(),
    reservedCapacity: v.literal(2),
    status: socialInvitationStatusValidator,
    createdAt: v.number(),
    respondedAt: v.optional(v.number()),
    expiresAt: v.number(),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    personalGoalId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('byInvitation', ['worldId', 'invitationId'])
    .index('byKeyStatus', ['worldId', 'invitationKey', 'status', 'updatedAt'])
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'updatedAt'])
    .index('byTargetStatus', ['worldId', 'targetActorId', 'status', 'updatedAt'])
    .index('byMeetingStatus', [
      'worldId',
      'meetingMapId',
      'meetingLocationId',
      'status',
      'updatedAt',
    ]),

// C021b0d: a causal group opportunity becomes a bounded coordination
  // receipt before C014 may open a session. This table reserves no movement
  // and creates no social outcome; every invited member must consent first.
  groupSocialInitiations: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.group-social-initiation.v1'),
    initiationId: v.string(),
    revision: v.number(),
    hostActorId: v.string(),
    sourceKind: groupSocialSourceKindValidator,
    sourceRef: v.string(),
    sourceRevision: v.string(),
    warrantId: v.string(),
    warrantDigest: v.string(),
    candidateId: v.string(),
    candidateDigest: v.string(),
    topicRefs: v.array(v.string()),
    audience: v.union(v.literal('participants'), v.literal('local_public')),
    meetingMapId: v.string(),
    meetingLocationId: v.string(),
    participantActorIds: v.array(v.string()),
    participantRoles: v.array(groupSocialParticipantRoleEntryValidator),
    observerActorIds: v.array(v.string()),
    status: groupSocialInitiationStatusValidator,
    createdAt: v.number(),
    expiresAt: v.number(),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    groupConversationId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('byInitiation', ['worldId', 'initiationId'])
    .index('bySourceStatus', ['worldId', 'sourceRef', 'sourceRevision', 'status', 'updatedAt'])
    .index('byHostStatus', ['worldId', 'hostActorId', 'status', 'updatedAt'])
    .index('byMeetingStatus', [
      'worldId', 'meetingMapId', 'meetingLocationId', 'status', 'updatedAt',
    ]),

groupSocialInitiationMembers: defineTable({
    worldId: v.id('worlds'),
    initiationId: v.string(),
    actorId: v.string(),
    role: groupSocialParticipantRoleValidator,
    response: groupSocialResponseValidator,
    initiationStatus: groupSocialInitiationStatusValidator,
    respondedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byInitiationActor', ['worldId', 'initiationId', 'actorId'])
    .index('byInitiation', ['worldId', 'initiationId'])
    .index('byActorStatus', ['worldId', 'actorId', 'initiationStatus', 'updatedAt']),

// LWSE-3a scene-clock occurrences. A closed window is only a durable time
  // owner: it cannot grant an action, emit a social candidate, or call a
  // provider. Later LWSE-3 stages may project bounded actor reviews from it.
  lifeRhythmWindows: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.life-rhythm-window.v1'),
    windowId: v.string(),
    cadence: v.union(v.literal('daily'), v.literal('weekly')),
    periodIndex: v.number(),
    windowStartGameHour: v.number(),
    windowEndGameHour: v.number(),
    clockStartedAt: v.number(),
    status: v.literal('closed'),
    providerCalls: v.literal(0),
    createdWorldActions: v.literal(0),
    createdSocialCandidates: v.literal(0),
    recordedAt: v.number(),
    windowDigest: v.string(),
  })
    .index('byWindow', ['worldId', 'windowId'])
    .index('byCadencePeriod', ['worldId', 'cadence', 'periodIndex'])
    .index('byRecordedAt', ['worldId', 'recordedAt']),

// LWSE-3c source-bound two-person life activity. This row coordinates
  // consent and observes existing personal-goal/body terminals; it never owns
  // movement, resource settlement, relationship, memory, or provider writes.
  sharedPlans: defineTable({
    worldId: v.id('worlds'),
    contractVersion: v.literal('taixu.shared-plan.v1'),
    planId: v.string(),
    planKey: v.string(),
    revision: v.number(),
    kind: sharedPlanKindValidator,
    status: sharedPlanStatusValidator,
    proposerActorId: v.string(),
    inviteeActorId: v.string(),
    sourceReviewId: v.string(),
    sourceReviewDigest: v.string(),
    sourceWindowId: v.string(),
    sourceRef: v.string(),
    sourceRevision: v.string(),
    sourceDigest: v.string(),
    sourceCommitmentId: v.string(),
    resourceNodeId: v.optional(v.string()),
    resourceNodeRevision: v.optional(v.string()),
    mapId: v.string(),
    locationId: v.string(),
    itemId: v.optional(v.string()),
    teachingTopic: v.optional(v.literal('cultivation_fundamentals')),
    learnerActorId: v.optional(v.string()),
    teacherActorId: v.optional(v.string()),
    handoffFacts: v.optional(guardHandoffFactsValidator),
    handoffFactsDigest: v.optional(v.string()),
    participants: v.array(sharedPlanParticipantValidator),
    scheduleRevision: v.optional(v.number()),
    scheduleDigest: v.optional(v.string()),
    expiresGameHour: v.number(),
    terminalGameHour: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    providerCalls: v.literal(0),
    createdWorldActions: v.literal(0),
    createdAt: v.number(),
    updatedAt: v.number(),
    planDigest: v.string(),
  })
    .index('byPlan', ['worldId', 'planId'])
    .index('byPlanKey', ['worldId', 'planKey'])
    .index('bySourceReview', ['worldId', 'sourceReviewId', 'sourceRef'])
    .index('byProposerStatus', ['worldId', 'proposerActorId', 'status', 'updatedAt'])
    .index('byInviteeStatus', ['worldId', 'inviteeActorId', 'status', 'updatedAt'])
    .index('byStatus', ['worldId', 'status', 'updatedAt']),

// LWSE-3d P9c server-owned authority source. Rows are deliberately not
  // seeded or tick-created: an empty world has zero assignments and therefore
  // cannot authorize a guard handoff.
  guardDutyAssignments: defineTable({
    worldId: v.id('worlds'),
    ownerContractVersion: v.literal('taixu.guard-duty-assignment-owner.v1'),
    contractVersion: v.literal('taixu.guard-duty-assignment.v1'),
    assignmentId: v.string(),
    assignmentRevision: v.number(),
    actorId: v.string(),
    status: v.union(v.literal('active'), v.literal('revoked')),
    role: v.string(),
    homeZoneId: v.string(),
    dutyState: v.string(),
    mapId: v.string(),
    currentLocationId: v.string(),
    aliveAndCapable: v.boolean(),
    busy: v.boolean(),
    validFromGameHour: v.number(),
    validUntilGameHour: v.number(),
    authoritySourceRef: v.string(),
    authoritySourceRevision: v.string(),
    authoritySourceDigest: v.string(),
    assignmentDigest: v.string(),
    admissionCommandDigest: v.string(),
    authorizationRef: v.string(),
    authorizationRevision: v.string(),
    authorizationDigest: v.string(),
    revokedByCommandDigest: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byAssignment', ['worldId', 'assignmentId'])
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'updatedAt']),

// C012 持久双人会话。actorA/B 使用确定性排序，避免数组字段无法索引；
  // 每一轮仍由 talk ActionRecord 驱动，本表只持有发言权与会话生命周期。
  conversationSessions: defineTable({
    worldId: v.id('worlds'),
    conversationId: v.string(),
    status: conversationStatusValidator,
    actorAId: v.string(),
    actorBId: v.string(),
    proposerActorId: v.string(),
    currentSpeakerActorId: v.optional(v.string()),
    topicId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    turnNumber: v.number(),
    maxTurns: v.number(),
    revision: v.number(),
    openedByActionId: v.id('actionRecords'),
    startedEventId: v.id('worldEvents'),
    // C021b0e optional causal binding. Legacy C012 sessions remain readable.
    socialOutcomeId: v.optional(v.string()),
    socialWarrantId: v.optional(v.string()),
    socialWarrantDigest: v.optional(v.string()),
    socialSourceRef: v.optional(v.string()),
    socialSourceRevision: v.optional(v.string()),
    socialIntendedOutcome: v.optional(socialWarrantOutcomeValidator),
    socialTopicRefs: v.optional(v.array(v.string())),
    proposedAt: v.number(),
    acceptedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    lastTurnAt: v.optional(v.number()),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byConversation', ['worldId', 'conversationId'])
    .index('byOpenedAction', ['worldId', 'openedByActionId'])
    .index('byPairStatus', ['worldId', 'actorAId', 'actorBId', 'status'])
    .index('byActorAStatus', ['worldId', 'actorAId', 'status', 'updatedAt'])
    .index('byActorBStatus', ['worldId', 'actorBId', 'status', 'updatedAt']),

// C014a 持久群体会话。participant/observer 数组是可回放快照；逐角色唯一活动会话由
  // groupConversationMemberships 的 actor+status 索引裁决。发言仍复用 conversationUtterances。
  groupConversationSessions: defineTable({
    worldId: v.id('worlds'),
    groupConversationId: v.string(),
    status: groupConversationStatusValidator,
    hostActorId: v.string(),
    participantActorIds: v.array(v.string()),
    observerActorIds: v.array(v.string()),
    currentSpeakerActorId: v.optional(v.string()),
    topicId: v.string(),
    mapId: v.string(),
    locationId: v.string(),
    // C021b0d optional causal binding. Legacy C014 fixtures remain valid;
    // naturally initiated sessions carry the exact source receipt snapshot.
    groupSocialInitiationId: v.optional(v.string()),
    socialOutcomeId: v.optional(v.string()),
    socialWarrantId: v.optional(v.string()),
    socialWarrantDigest: v.optional(v.string()),
    socialSourceRef: v.optional(v.string()),
    socialSourceRevision: v.optional(v.string()),
    socialParticipantRoles: v.optional(v.array(groupSocialParticipantRoleEntryValidator)),
    turnNumber: v.number(),
    maxTurns: v.number(),
    revision: v.number(),
    openedByActionId: v.id('actionRecords'),
    startedEventId: v.id('worldEvents'),
    startedAt: v.number(),
    lastTurnAt: v.number(),
    terminalActionId: v.optional(v.id('actionRecords')),
    terminalEventId: v.optional(v.id('worldEvents')),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byGroupConversation', ['worldId', 'groupConversationId'])
    .index('byStatusLocation', ['worldId', 'status', 'mapId', 'locationId', 'updatedAt'])
    .index('byOpenedAction', ['worldId', 'openedByActionId']),

groupConversationMemberships: defineTable({
    worldId: v.id('worlds'),
    groupConversationId: v.string(),
    actorId: v.string(),
    role: groupConversationMembershipRoleValidator,
    status: groupConversationStatusValidator,
    joinedAt: v.number(),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('byActorStatus', ['worldId', 'actorId', 'status', 'updatedAt'])
    .index('byGroupRole', ['worldId', 'groupConversationId', 'role', 'actorId']),

// C014b 群体决定。提案/票/承诺分表，承诺执行后才产生真实物品转移。
  groupProposals: defineTable({
    worldId: v.id('worlds'),
    proposalId: v.string(),
    groupConversationId: v.string(),
    kind: v.literal('owned_herb_allocation'),
    status: groupProposalStatusValidator,
    proposerActorId: v.string(),
    donorActorId: v.string(),
    recipientActorId: v.string(),
    itemId: v.literal('spirit_herb'),
    itemQty: v.literal(1),
    participantActorIds: v.array(v.string()),
    sessionRevision: v.number(),
    mapId: v.string(),
    locationId: v.string(),
    quorum: v.number(),
    approvals: v.number(),
    oppositions: v.number(),
    abstentions: v.number(),
    openedByActionId: v.id('actionRecords'),
    openedEventId: v.id('worldEvents'),
    commitmentId: v.optional(v.string()),
    terminalActionId: v.optional(v.id('actionRecords')),
    terminalEventId: v.optional(v.id('worldEvents')),
    terminalReasonCode: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byProposal', ['worldId', 'proposalId'])
    .index('byGroupStatus', ['worldId', 'groupConversationId', 'status', 'updatedAt']),

groupVotes: defineTable({
    worldId: v.id('worlds'),
    proposalId: v.string(),
    actorId: v.string(),
    choice: groupVoteChoiceValidator,
    decisionBasis: v.optional(v.string()),
    relationshipBand: v.optional(v.string()),
    actionRecordId: v.id('actionRecords'),
    sourceEventId: v.id('worldEvents'),
    createdAt: v.number(),
  })
    .index('byProposalActor', ['worldId', 'proposalId', 'actorId'])
    .index('byProposal', ['worldId', 'proposalId', 'createdAt']),

groupCommitments: defineTable({
    worldId: v.id('worlds'),
    commitmentId: v.string(),
    proposalId: v.string(),
    groupConversationId: v.string(),
    status: groupCommitmentStatusValidator,
    donorActorId: v.string(),
    recipientActorId: v.string(),
    itemId: v.literal('spirit_herb'),
    itemQty: v.literal(1),
    approvedByActionId: v.id('actionRecords'),
    approvedEventId: v.id('worldEvents'),
    settlementActionId: v.optional(v.id('actionRecords')),
    settlementEventId: v.optional(v.id('worldEvents')),
    terminalReasonCode: v.optional(v.string()),
    createdAt: v.number(),
    terminalAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('byCommitment', ['worldId', 'commitmentId'])
    .index('byProposal', ['worldId', 'proposalId'])
    .index('byDonorStatus', ['worldId', 'donorActorId', 'status', 'updatedAt'])
    .index('byRecipientStatus', ['worldId', 'recipientActorId', 'status', 'updatedAt']),

// C012b 服务端社交节律。key 对 actor / 无向 pair / 无向 pair+topic 分别唯一；
  // opening session 与四类 cooldown 在同一 mutation 写入，客户端不能绕过。
  conversationCooldowns: defineTable({
    worldId: v.id('worlds'),
    cooldownKey: v.string(),
    scope: v.union(v.literal('actor'), v.literal('pair'), v.literal('topic')),
    actorId: v.optional(v.string()),
    targetActorId: v.optional(v.string()),
    topicId: v.optional(v.string()),
    conversationId: v.string(),
    nextAllowedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('byKey', ['worldId', 'cooldownKey'])
    .index('byActor', ['worldId', 'actorId', 'nextAllowedAt']),

// C013 有限轮次双边议价。会话负责轮流发言，本表只持有可结算事实；
  // accept 的物品交换或委托期限变更在同一个 submitAction mutation 中完成。
  negotiationSessions: defineTable({
    worldId: v.id('worlds'),
    negotiationId: v.string(),
    conversationId: v.string(),
    kind: negotiationKindValidator,
    status: negotiationStatusValidator,
    actorAId: v.string(),
    actorBId: v.string(),
    openedByActorId: v.string(),
    currentProposalId: v.string(),
    currentResponderActorId: v.optional(v.string()),
    revision: v.number(),
    mapId: v.string(),
    locationId: v.string(),
    openedByActionId: v.id('actionRecords'),
    settlementActionId: v.optional(v.id('actionRecords')),
    settlementEventId: v.optional(v.id('worldEvents')),
    terminalActionId: v.optional(v.id('actionRecords')),
    terminalEventId: v.optional(v.id('worldEvents')),
    openedAt: v.number(),
    expiresAt: v.number(),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('byNegotiation', ['worldId', 'negotiationId'])
    .index('byConversationStatus', ['worldId', 'conversationId', 'status'])
    .index('byActorAStatus', ['worldId', 'actorAId', 'status', 'updatedAt'])
    .index('byActorBStatus', ['worldId', 'actorBId', 'status', 'updatedAt'])
    .index('byCurrentProposal', ['worldId', 'currentProposalId']),

negotiationProposals: defineTable({
    worldId: v.id('worlds'),
    proposalId: v.string(),
    negotiationId: v.string(),
    conversationId: v.string(),
    revision: v.number(),
    status: negotiationProposalStatusValidator,
    kind: negotiationKindValidator,
    proposerActorId: v.string(),
    recipientActorId: v.string(),
    parentProposalId: v.optional(v.string()),
    sellerActorId: v.optional(v.string()),
    buyerActorId: v.optional(v.string()),
    itemId: v.optional(v.literal('spirit_herb')),
    itemQty: v.optional(v.number()),
    paymentItemId: v.optional(v.literal('spirit_stone')),
    paymentQty: v.optional(v.number()),
    requestId: v.optional(v.string()),
    issuerActorId: v.optional(v.string()),
    assigneeActorId: v.optional(v.string()),
    baseExpiresAtGameHour: v.optional(v.number()),
    extensionGameHours: v.optional(v.number()),
    harmEventId: v.optional(v.string()),
    encounterId: v.optional(v.string()),
    payerActorId: v.optional(v.string()),
    payeeActorId: v.optional(v.string()),
    harmDamage: v.optional(v.number()),
    actionRecordId: v.id('actionRecords'),
    sourceEventId: v.id('worldEvents'),
    createdAt: v.number(),
    terminalActionId: v.optional(v.id('actionRecords')),
    terminalEventId: v.optional(v.id('worldEvents')),
    terminalAt: v.optional(v.number()),
    terminalReasonCode: v.optional(v.string()),
  })
    .index('byProposal', ['worldId', 'proposalId'])
    .index('byNegotiationRevision', ['worldId', 'negotiationId', 'revision'])
    .index('byNegotiationStatus', ['worldId', 'negotiationId', 'status'])
    .index('byAction', ['worldId', 'actionRecordId']),

// M6 轻量委托：NPC 据关系派事，完成改关系/发奖（§12）。第一版两类：collect_item / explore_location。
  requests: defineTable({
    worldId: v.id('worlds'),
    issuerActorId: v.string(),
    assigneeActorId: v.string(),
    type: v.string(),
    status: v.string(), // offered / accepted / ready_to_turn_in / completed / declined / expired
    // C016e3d：旧行缺 revision 时按 1 读取；新写入和每次迁移都显式推进。
    revision: v.optional(v.number()),
    requirements: v.object({
      itemId: v.optional(v.string()),
      qty: v.optional(v.number()),
      locationId: v.optional(v.string()),
    }),
    rewards: v.object({
      cultivationXp: v.optional(v.number()),
      trust: v.optional(v.number()),
      debt: v.optional(v.number()),
      items: v.optional(v.array(v.object({ itemId: v.string(), qty: v.number() }))),
    }),
    createdAt: v.number(),
    offeredAtGameHour: v.optional(v.number()),
    expiresAt: v.number(),
    originalExpiresAt: v.optional(v.number()),
    deadlineExtensionCount: v.optional(v.number()),
    deadlineExtendedAt: v.optional(v.number()),
    deadlineExtensionHours: v.optional(v.number()),
    deadlineNegotiationId: v.optional(v.string()),
    acceptedAt: v.optional(v.number()),
    readyAt: v.optional(v.number()),
    fulfilledAt: v.optional(v.number()),
    declinedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    terminalAtGameHour: v.optional(v.number()),
    openedByActionId: v.optional(v.id('actionRecords')),
    sourceEventId: v.optional(v.id('worldEvents')),
    lastTransitionActionId: v.optional(v.id('actionRecords')),
    lastTransitionEventId: v.optional(v.id('worldEvents')),
    lastTransitionAt: v.optional(v.number()),
    summary: v.string(),
  })
    .index('byAssignee', ['worldId', 'assigneeActorId', 'status'])
    .index('byIssuer', ['worldId', 'issuerActorId', 'status'])
    .index('byStatus', ['worldId', 'status']),

// 世界级配置（每世界一行）。「自动推进」开关 + 世界时钟锚点 + 自主成长开关，供 UI 切换、cron 读取。
  xianxiaConfig: defineTable({
    worldId: v.id('worlds'),
    autoTickEnabled: v.boolean(),
    // W3a 世界时钟锚点：真实 ms = 第 1 日 0 时。游戏时间由 (now − 此值) 推导，见 timeLogic.ts。
    clockStartedAt: v.optional(v.number()),
    // C019a 独立岁月历：只管理年、季节以及未来的年龄/寿命，绝不复用 12 分钟昼夜钟。
    lifeCalendarStartedAt: v.optional(v.number()),
    lifeCalendarAppliedSeasonIndex: v.optional(v.number()),
    lifeCalendarAppliedAt: v.optional(v.number()),
    // LWSE-3a scene-clock review cursors. These are independent from the
    // season/lifespan calendar and advance atomically with concrete windows.
    lifeRhythmAppliedDayIndex: v.optional(v.number()),
    lifeRhythmAppliedWeekIndex: v.optional(v.number()),
    lifeRhythmAppliedAt: v.optional(v.number()),
    // G 自主成长开关。默认关闭——寿命/死亡安全栏（docs/世界逻辑/寿命-时间尺度.md）建好前不开，
    // 否则全员只升不死、漂向「全员化神」。optional：旧档/缺省一律按关处理。
    autonomousGrowthEnabled: v.optional(v.boolean()),
    // C017f 默认关闭。即使关闭，已存在压力仍会被 tick 结算，避免永久悬挂。
    worldDirectorEnabled: v.optional(v.boolean()),
    worldDirectorNextEligibleGameHour: v.optional(v.number()),
    // Agent tick 的操作性轮转游标。按 map/scope 独立保存，避免固定 slice 让后排角色永久饥饿。
    agentTickCursors: v.optional(
      v.array(
        v.object({
          scope: v.string(),
          afterActorId: v.string(),
          updatedAt: v.number(),
        }),
      ),
    ),
    // Optional autonomous-growth batch cursor. Growth is disabled by default,
    // but when enabled it advances every profile through bounded lexical pages.
    growthCursorActorId: v.optional(v.string()),
    agentTickLease: v.optional(
      v.object({
        tickId: v.string(),
        mapId: v.optional(v.string()),
        owner: v.string(),
        acquiredAt: v.number(),
        expiresAt: v.number(),
      }),
    ),
    recentAgentTicks: v.optional(
      v.array(
        v.object({
          tickId: v.string(),
          mapId: v.optional(v.string()),
          status: v.union(v.literal('completed'), v.literal('failed')),
          finishedAt: v.number(),
        }),
      ),
    ),
  }).index('byWorld', ['worldId']),
} as const;
