import {
  deriveAidSocialConsequenceDrafts,
  deriveBoundarySocialConsequenceDraft,
  deriveGrievanceSocialConsequenceDraft,
  grievanceProjectionSourceEvidenceValid,
  deriveReliabilitySocialConsequenceDrafts,
  effectiveSocialConsequenceStatus,
  type SocialConsequenceTerminalEvent,
} from './socialConsequenceContracts';
import type { SocialOutcomeReceipt } from './socialOutcomeContracts';

describe('LWSE-1a aid consequence contract', () => {
  test('derives one evidence owner and one bounded gratitude owner from the verified gift terminal', () => {
    const drafts = deriveAidSocialConsequenceDrafts(receipt());
    expect(drafts.map((entry) => entry.kind)).toEqual(['aid_received', 'gratitude_due']);
    expect(new Set(drafts.map((entry) => entry.consequenceId)).size).toBe(2);
    expect(drafts).toEqual([
      expect.objectContaining({
        kind: 'aid_received', subjectActorId: 'actor:recipient',
        counterpartActorIds: ['actor:donor'], remainingProjectionBudget: 0,
        sourceOutcomeId: 'outcome:gift', sourceOutcomeRevision: 2,
        sourceActionId: 'action:gift', sourceEventId: 'event:gift',
        sourceWarrantId: 'warrant:repair', sourceRevision: 'source-rev:1',
        createdGameHour: 31, expiresGameHour: 751,
      }),
      expect.objectContaining({
        kind: 'gratitude_due', subjectActorId: 'actor:recipient',
        counterpartActorIds: ['actor:donor'], remainingProjectionBudget: 1,
        dueGameHour: 55, createdGameHour: 31, expiresGameHour: 751,
      }),
    ]);
    expect(effectiveSocialConsequenceStatus(drafts[1], 750)).toBe('active');
    expect(effectiveSocialConsequenceStatus(drafts[1], 751)).toBe('expired');
  });

  test.each([
    ['ordinary talk', { intendedOutcome: 'maintain_bond', terminalReasonCode: 'social_outcome_bond_exchange_completed' }],
    ['speech-only repair', { terminalResultCode: 'conversation_ended', terminalReasonCode: 'social_outcome_repair_acknowledged' }],
    ['refusal', { status: 'failed', terminalResultCode: 'conversation_ended', terminalReasonCode: 'social_outcome_repair_refused' }],
    ['cancelled', { status: 'cancelled', terminalResultCode: 'conversation_cancelled', terminalReasonCode: 'social_outcome_cancelled' }],
    ['expired', { status: 'expired', terminalResultCode: 'conversation_expired', terminalReasonCode: 'social_outcome_expired' }],
    ['pre-terminal revision', { revision: 1 }],
    ['self target', { targetActorIds: ['actor:donor'] }],
    ['group target', { targetActorIds: ['actor:recipient', 'actor:other'] }],
    ['missing action', { terminalActionId: undefined }],
    ['missing event', { terminalEventId: undefined }],
  ])('derives zero owners for %s', (_label, patch) => {
    expect(deriveAidSocialConsequenceDrafts({ ...receipt(), ...patch } as SocialOutcomeReceipt))
      .toEqual([]);
  });
});

describe('LWSE-1b reliability evidence contract', () => {
  test.each([
    ['fulfilled', 'supports', 'resolved', 'group_commitment_fulfilled',
      'social_outcome_group_commitment_fulfilled'],
    ['breached', 'contradicts', 'failed', 'group_commitment_breached',
      'social_outcome_group_commitment_breached'],
  ] as const)('derives one %s terminal as %s evidence', (
    commitmentStatus, evidenceDirection, status, resultCode, reasonCode,
  ) => {
    const input = reliabilityReceipt({
      status, terminalResultCode: resultCode, terminalReasonCode: reasonCode,
    });
    const drafts = deriveReliabilitySocialConsequenceDrafts(
      input,
      reliabilityEvent(resultCode, commitmentStatus),
    );
    expect(drafts).toEqual([expect.objectContaining({
      kind: 'reliability_evidence', evidenceDirection,
      subjectActorId: 'actor:donor', counterpartActorIds: ['actor:recipient'],
      audience: 'participants', remainingProjectionBudget: 0,
      sourceOutcomeId: 'outcome:group', sourceOutcomeRevision: 2,
      sourceActionId: 'action:execute', sourceEventId: 'event:execute',
      sourceWarrantId: 'warrant:group', sourceRevision: 'source-rev:group',
      createdGameHour: 80, expiresGameHour: 2240,
    })]);
  });

  test('positive and negative evidence use different deterministic identities', () => {
    const positive = deriveReliabilitySocialConsequenceDrafts(
      reliabilityReceipt(),
      reliabilityEvent('group_commitment_fulfilled', 'fulfilled'),
    )[0];
    const negative = deriveReliabilitySocialConsequenceDrafts(
      reliabilityReceipt({
        status: 'failed', terminalResultCode: 'group_commitment_breached',
        terminalReasonCode: 'social_outcome_group_commitment_breached',
      }),
      reliabilityEvent('group_commitment_breached', 'breached'),
    )[0];
    expect(positive.consequenceId).not.toBe(negative.consequenceId);
    expect(positive.scopeKey).not.toBe(negative.scopeKey);
  });

  test.each([
    ['ordinary talk', { intendedOutcome: 'maintain_bond' }],
    ['proposal committed only', { terminalResultCode: 'group_proposal_committed', terminalReasonCode: 'social_outcome_pending' }],
    ['proposal rejected', { terminalResultCode: 'group_proposal_rejected', terminalReasonCode: 'social_outcome_group_proposal_rejected' }],
    ['cancelled', { status: 'cancelled', terminalResultCode: 'group_conversation_cancelled', terminalReasonCode: 'social_outcome_cancelled' }],
    ['expired', { status: 'expired', terminalResultCode: 'group_conversation_expired', terminalReasonCode: 'social_outcome_expired' }],
    ['pre-terminal', { revision: 1 }],
  ])('derives zero reliability evidence for %s', (_label, patch) => {
    expect(deriveReliabilitySocialConsequenceDrafts(
      reliabilityReceipt(patch as Partial<SocialOutcomeReceipt>),
      null,
    )).toEqual([]);
  });

  test.each([
    ['missing event', () => null],
    ['wrong event id', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { _id: 'event:other' })],
    ['wrong action id', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { actionId: 'action:other' })],
    ['wrong event type', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { type: 'group_vote_recorded' })],
    ['wrong facts result', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { facts: { ...reliabilityFacts('group_commitment_fulfilled', 'fulfilled'), resultCode: 'group_commitment_breached' } })],
    ['wrong operation', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { facts: { ...reliabilityFacts('group_commitment_fulfilled', 'fulfilled'), operation: 'vote' } })],
    ['missing commitment', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { facts: { ...reliabilityFacts('group_commitment_fulfilled', 'fulfilled'), commitmentId: '' } })],
    ['self counterpart', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { targetActorIds: ['actor:donor'], facts: { ...reliabilityFacts('group_commitment_fulfilled', 'fulfilled'), recipientActorId: 'actor:donor' } })],
    ['outsider donor', () => reliabilityEvent('group_commitment_fulfilled', 'fulfilled', { actorIds: ['actor:outsider'], facts: { ...reliabilityFacts('group_commitment_fulfilled', 'fulfilled'), donorActorId: 'actor:outsider' } })],
  ])('fails closed for a claimed terminal with %s', (_label, buildEvent) => {
    expect(() => deriveReliabilitySocialConsequenceDrafts(
      reliabilityReceipt(), buildEvent(),
    )).toThrow('social_consequence_terminal_evidence_invalid');
  });
});

describe('LWSE-1c grievance and consent-boundary contract', () => {
  test.each([
    ['nonlethal', 'combat_attack_resolved', 'combat_attack_hit', false],
    ['defeat', 'combatant_defeated', 'combat_target_defeated', true],
  ] as const)('derives one victim-owned grievance for %s attack terminal', (
    _label, type, resultCode, defeated,
  ) => {
    const draft = deriveGrievanceSocialConsequenceDraft(grievanceTerminal({
      event: grievanceEvent({ type, facts: grievanceFacts({ resultCode, defeated }) }),
    }));
    expect(draft).toEqual(expect.objectContaining({
      sourceKind: 'action_terminal', kind: 'grievance_created',
      subjectActorId: 'actor:victim', counterpartActorIds: ['actor:attacker'],
      sourceActionId: 'action:attack', sourceEventId: 'event:attack',
      sourceOutcomeRevision: 1,
      remainingProjectionBudget: 1, createdGameHour: 48, expiresGameHour: 768,
    }));
    expect(draft).not.toHaveProperty('sourceWarrantId');
  });

  test.each([
    ['spar', { actionType: 'spar' }],
    ['wrong action', { actionId: 'action:other' }],
    ['wrong actor', { executionActorId: 'actor:other' }],
    ['wrong target', { executionTargetActorId: 'actor:other' }],
    ['missing damage', { event: grievanceEvent({ facts: grievanceFacts({ damage: undefined }) }) }],
  ])('fails closed for claimed eligible attack with %s', (_label, patch) => {
    expect(() => deriveGrievanceSocialConsequenceDraft(grievanceTerminal(patch)))
      .toThrow('social_consequence_terminal_evidence_invalid');
  });

  test.each([
    ['speech', grievanceEvent({ type: 'conversation_utterance', facts: { resultCode: 'conversation_turn_recorded' } })],
    ['start', grievanceEvent({ type: 'action_execution_started', facts: { resultCode: 'action_execution_started' } })],
    ['flee', grievanceEvent({ type: 'combat_flee_failed', facts: { resultCode: 'combat_flee_failed', damage: 1 } })],
    ['inconsistent result family', grievanceEvent({ facts: grievanceFacts({ defeated: true }) })],
  ])('derives zero grievance for %s', (_label, event) => {
    expect(deriveGrievanceSocialConsequenceDraft(grievanceTerminal({ event }))).toBeNull();
  });

  test('LWSE-2b treats owner and assault relationship row as one exact source-event proof', () => {
    const consequence = deriveGrievanceSocialConsequenceDraft(grievanceTerminal());
    if (!consequence) throw new Error('grievance_draft_missing');
    const evidence = {
      consequence,
      action: {
        id: 'action:attack', type: 'attack', status: 'applied',
        actorId: 'actor:attacker', targetActorId: 'actor:victim',
      },
      event: grievanceEvent(),
      assaultEvidence: [{
        sourceEventId: 'event:attack', fromActorId: 'actor:victim',
        toActorId: 'actor:attacker', effectKind: 'assault',
      }],
    };
    expect(grievanceProjectionSourceEvidenceValid(evidence)).toBe(true);
    expect(grievanceProjectionSourceEvidenceValid({
      ...evidence, assaultEvidence: [...evidence.assaultEvidence, evidence.assaultEvidence[0]],
    })).toBe(false);
    expect(grievanceProjectionSourceEvidenceValid({
      ...evidence, action: { ...evidence.action, targetActorId: 'actor:other' },
    })).toBe(false);
    expect(grievanceProjectionSourceEvidenceValid({
      ...evidence, event: grievanceEvent({ facts: grievanceFacts({ damage: 3 }) }),
    })).toBe(false);
  });

  test('derives a bounded refusal owner without grievance or negative direction', () => {
    const draft = deriveBoundarySocialConsequenceDraft(boundaryReceipt(), boundaryEvidence());
    expect(draft).toEqual(expect.objectContaining({
      sourceKind: 'social_outcome', kind: 'boundary_or_refusal',
      subjectActorId: 'actor:target', counterpartActorIds: ['actor:initiator'],
      sourceActionId: 'action:refuse', sourceEventId: 'event:refuse',
      sourceWarrantId: 'warrant:repair', remainingProjectionBudget: 0,
      createdGameHour: 90, expiresGameHour: 258,
    }));
    expect(draft).not.toHaveProperty('evidenceDirection');
  });

  test.each([
    ['ordinary acknowledged repair', { status: 'resolved', terminalReasonCode: 'social_outcome_repair_acknowledged' }],
    ['gift accepted', { status: 'resolved', terminalResultCode: 'gift_accepted', terminalReasonCode: 'social_outcome_repair_gift_accepted' }],
    ['ordinary bond refusal', { intendedOutcome: 'maintain_bond' }],
    ['cancelled', { status: 'cancelled', terminalReasonCode: 'social_outcome_cancelled' }],
  ])('derives zero boundary for %s', (_label, patch) => {
    expect(deriveBoundarySocialConsequenceDraft(
      { ...boundaryReceipt(), ...patch } as SocialOutcomeReceipt,
      boundaryEvidence(),
    )).toBeNull();
  });

  test.each([
    ['missing evidence', null],
    ['wrong speaker', boundaryEvidence({ speakerActorId: 'actor:other' })],
    ['wrong action', boundaryEvidence({ actionId: 'action:other' })],
    ['wrong speech act', boundaryEvidence({ speechAct: 'respond' })],
    ['wrong conversation', boundaryEvidence({ conversationId: 'conversation:other' })],
  ])('fails closed for refused receipt with %s', (_label, evidence) => {
    expect(() => deriveBoundarySocialConsequenceDraft(boundaryReceipt(), evidence))
      .toThrow('lwse_1c_boundary_evidence_missing');
  });
});

function receipt(): SocialOutcomeReceipt {
  return {
    contractVersion: 'taixu.social-outcome.v1',
    outcomeId: 'outcome:gift', scopeKey: 'scope:gift', revision: 2,
    actorId: 'actor:donor', targetActorIds: ['actor:recipient'],
    sourceRef: 'event:prior-help', sourceRevision: 'source-rev:1',
    intendedOutcome: 'thank_apologize_or_repair', activity: 'gift',
    topicRefs: ['event:prior-help'], audience: 'private',
    warrantId: 'warrant:repair', warrantDigest: 'warrant-digest',
    candidateId: 'candidate:gift', candidateDigest: 'candidate-digest',
    warrantCandidateDigest: 'binding-digest', status: 'resolved',
    openedByActionId: 'action:gift', openedEventId: 'event:gift-started',
    terminalActionId: 'action:gift', terminalEventId: 'event:gift',
    terminalResultCode: 'gift_accepted',
    terminalReasonCode: 'social_outcome_repair_gift_accepted',
    createdGameHour: 30, terminalGameHour: 31,
  };
}

function reliabilityReceipt(
  patch: Partial<SocialOutcomeReceipt> = {},
): SocialOutcomeReceipt {
  return {
    contractVersion: 'taixu.social-outcome.v1',
    outcomeId: 'outcome:group', scopeKey: 'scope:group', revision: 2,
    actorId: 'actor:host', targetActorIds: ['actor:donor', 'actor:recipient'],
    sourceRef: 'request:shared', sourceRevision: 'source-rev:group',
    intendedOutcome: 'reach_group_decision', activity: 'group_decide',
    topicRefs: ['request:shared'], audience: 'participants',
    warrantId: 'warrant:group', warrantDigest: 'warrant-digest:group',
    candidateId: 'candidate:group', candidateDigest: 'candidate-digest:group',
    warrantCandidateDigest: 'binding-digest:group', status: 'resolved',
    openedByActionId: 'action:invite', openedEventId: 'event:invite',
    terminalActionId: 'action:execute', terminalEventId: 'event:execute',
    terminalResultCode: 'group_commitment_fulfilled',
    terminalReasonCode: 'social_outcome_group_commitment_fulfilled',
    createdGameHour: 70, terminalGameHour: 80,
    ...patch,
  };
}

function reliabilityEvent(
  resultCode: string,
  commitmentStatus: string,
  patch: Partial<SocialConsequenceTerminalEvent> = {},
): SocialConsequenceTerminalEvent {
  return {
    _id: 'event:execute', worldId: 'world:group', type: resultCode,
    actorIds: ['actor:donor'], targetActorIds: ['actor:recipient'],
    actionId: 'action:execute', facts: reliabilityFacts(resultCode, commitmentStatus),
    ...patch,
  };
}

function reliabilityFacts(resultCode: string, commitmentStatus: string) {
  return {
    schemaVersion: 1, resultCode, operation: 'execute',
    groupConversationId: 'group:1', proposalId: 'proposal:1', proposalStatus: 'committed',
    kind: 'owned_herb_allocation', proposerActorId: 'actor:host',
    donorActorId: 'actor:donor', recipientActorId: 'actor:recipient',
    itemId: 'spirit_herb', itemQty: 1, quorum: 2,
    commitmentId: 'commitment:1', commitmentStatus,
  };
}

function grievanceTerminal(patch: Record<string, unknown> = {}) {
  return {
    actionId: 'action:attack', actionType: 'attack',
    actorId: 'actor:attacker', targetActorId: 'actor:victim',
    executionActionId: 'action:attack', executionActorId: 'actor:attacker',
    executionTargetActorId: 'actor:victim', event: grievanceEvent(), gameHour: 48,
    ...patch,
  } as Parameters<typeof deriveGrievanceSocialConsequenceDraft>[0];
}

function grievanceEvent(patch: Partial<SocialConsequenceTerminalEvent> = {}): SocialConsequenceTerminalEvent {
  return {
    _id: 'event:attack', worldId: 'world:conflict', type: 'combat_attack_resolved',
    actorIds: ['actor:attacker'], targetActorIds: ['actor:victim'],
    actionId: 'action:attack', facts: grievanceFacts(), ...patch,
  };
}

function grievanceFacts(patch: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, resultCode: 'combat_attack_hit', encounterId: 'encounter:1',
    targetActorId: 'actor:victim', damage: 2, defeated: false, ...patch,
  };
}

function boundaryReceipt(): SocialOutcomeReceipt {
  return {
    contractVersion: 'taixu.social-outcome.v1', outcomeId: 'outcome:repair-refused',
    scopeKey: 'scope:repair-refused', revision: 2, actorId: 'actor:initiator',
    targetActorIds: ['actor:target'], sourceRef: 'event:prior-harm',
    sourceRevision: 'source-rev:harm', intendedOutcome: 'thank_apologize_or_repair',
    activity: 'talk', topicRefs: ['event:prior-harm'], audience: 'private',
    warrantId: 'warrant:repair', warrantDigest: 'warrant-digest:repair',
    candidateId: 'candidate:repair', candidateDigest: 'candidate-digest:repair',
    warrantCandidateDigest: 'binding:repair', status: 'failed',
    openedByActionId: 'action:open', openedEventId: 'event:open',
    conversationId: 'conversation:repair', terminalActionId: 'action:close',
    terminalEventId: 'event:close', terminalResultCode: 'conversation_ended',
    terminalReasonCode: 'social_outcome_repair_refused', createdGameHour: 88,
    terminalGameHour: 90,
  };
}

function boundaryEvidence(patch: Record<string, unknown> = {}) {
  const base = {
    conversationId: 'conversation:repair', actionId: 'action:refuse',
    speakerActorId: 'actor:target', addressedActorIds: ['actor:initiator'],
    speechAct: 'refuse',
  };
  const merged = { ...base, ...patch };
  return {
    ...merged,
    event: grievanceEvent({
      _id: 'event:refuse', type: 'conversation_utterance', actorIds: [merged.speakerActorId],
      targetActorIds: ['actor:initiator'], actionId: 'action:refuse',
      facts: {
        schemaVersion: 1, resultCode: 'conversation_turn_recorded',
        conversationId: merged.conversationId, speechAct: merged.speechAct,
      },
    }),
  } as Parameters<typeof deriveBoundarySocialConsequenceDraft>[1];
}
