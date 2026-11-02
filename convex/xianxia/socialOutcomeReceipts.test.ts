import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  createSocialOutcomeReceipt,
  prepareSocialOutcomeBinding,
} from './socialOutcomeContracts';
import {
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
  type SocialOpportunityCandidate,
  type SocialWarrant,
} from './socialWarrantContracts';
import {
  beginSocialOutcomeTx,
  bindGroupConversationSocialOutcomeTx,
  ensureSocialOutcomeEventTx,
  groupSocialOutcomePendingTx,
  settleActionSocialOutcomeTx,
  settleConversationSocialOutcomeTx,
  settleGroupSocialOutcomeTx,
  settleSocialOutcomeTx,
  socialOutcomeScopeAvailable,
  socialOutcomeSourceAvailable,
} from './socialOutcomeReceipts';
import { consumeSocialConsequenceProjectionTx } from './socialConsequenceProjections';
import {
  socialConsequenceProjectionSourceRef,
  socialConsequenceProjectionSourceRevision,
} from './socialConsequenceProjectionContracts';
import { grievanceActionTerminalSourceRevision } from './socialConsequenceContracts';

const WORLD_ID = 'world:outcome' as Id<'worlds'>;

describe('C021b0e social outcome persistence', () => {
  test('LWSE-2a consumes one exact gratitude projection at outcome admission and replay is inert', async () => {
    const fixture = memoryFixture();
    const sourceOutcomeId = 'social_outcome:aid_source';
    const sourceActionId = 'action:gift' as Id<'actionRecords'>;
    const sourceEventId = 'event:gift' as Id<'worldEvents'>;
    fixture.table('worldEvents').push(doc(sourceEventId, {
      worldId: WORLD_ID,
      type: 'gift_completed',
      actorIds: ['actor_b'],
      targetActorIds: ['actor_a'],
      actionId: sourceActionId,
    }));
    fixture.table('socialOutcomeReceipts').push(doc('receipt:aid', {
      worldId: WORLD_ID,
      outcomeId: sourceOutcomeId,
      revision: 2,
      status: 'resolved',
      terminalActionId: sourceActionId,
      terminalEventId: sourceEventId,
    }));
    const consequence = {
      worldId: WORLD_ID,
      contractVersion: 'taixu.social-consequence.v1',
      consequenceId: 'social_consequence:gratitude',
      revision: 1,
      sourceOutcomeId,
      sourceOutcomeRevision: 2,
      sourceKind: 'social_outcome',
      sourceActionId,
      sourceEventId,
      sourceWarrantId: 'warrant:aid',
      sourceRevision: 'outcome:aid:2',
      scopeKey: 'consequence:gratitude',
      kind: 'gratitude_due',
      subjectActorId: 'actor_a',
      counterpartActorIds: ['actor_b'],
      audience: 'participants',
      intensityBand: 'meaningful',
      status: 'active',
      remainingProjectionBudget: 1,
      dueGameHour: 48,
      expiresGameHour: 768,
      createdGameHour: 24,
      createdAt: 1,
      updatedAt: 1,
    };
    fixture.table('socialConsequences').push(doc('consequence:row', consequence));
    const sourceRevision = socialConsequenceProjectionSourceRevision({
      consequenceId: consequence.consequenceId,
      consequenceRevision: consequence.revision,
      sourceOutcomeId: consequence.sourceOutcomeId,
      sourceOutcomeRevision: consequence.sourceOutcomeRevision,
      sourceRevision: consequence.sourceRevision,
      status: consequence.status,
      remainingProjectionBudget: consequence.remainingProjectionBudget,
      dueGameHour: consequence.dueGameHour,
      expiresGameHour: consequence.expiresGameHour,
    });
    const binding = {
      ...directBinding('thank_apologize_or_repair', 'talk', 'talk'),
      outcomeId: 'social_outcome:gratitude_attempt',
      scopeKey: 'social_outcome_scope:gratitude_attempt',
      sourceRef: socialConsequenceProjectionSourceRef(consequence.consequenceId),
      sourceRevision,
      topicRefs: [`consequence:${consequence.consequenceId}`],
      audience: 'participants' as const,
    };
    const first = await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID,
      binding,
      openedByActionId: 'action:thanks' as Id<'actionRecords'>,
      openedEventId: 'event:thanks' as Id<'worldEvents'>,
      gameHour: 48,
      now: 2_000,
      conversationId: 'conversation:thanks',
    });
    expect(first).toMatchObject({ ok: true, replay: false });
    expect(fixture.table('socialConsequences')[0]).toMatchObject({
      revision: 2,
      remainingProjectionBudget: 0,
      updatedAt: 2_000,
    });
    const replay = await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID,
      binding,
      openedByActionId: 'action:thanks' as Id<'actionRecords'>,
      openedEventId: 'event:thanks' as Id<'worldEvents'>,
      gameHour: 48,
      now: 2_001,
      conversationId: 'conversation:thanks',
    });
    expect(replay).toMatchObject({ ok: true, replay: true });
    expect(fixture.table('socialConsequences')[0]).toMatchObject({
      revision: 2,
      remainingProjectionBudget: 0,
      updatedAt: 2_000,
    });
    expect(fixture.table('socialOutcomeReceipts').filter((row) =>
      row.outcomeId === binding.outcomeId)).toHaveLength(1);
  });

  test('LWSE-2a projection consumption fails closed for due, source, direction and stale revision', async () => {
    const setup = () => {
      const fixture = memoryFixture();
      const consequence = doc('consequence:row', {
        worldId: WORLD_ID,
        consequenceId: 'social_consequence:gratitude', revision: 1,
        sourceOutcomeId: 'social_outcome:aid_source', sourceOutcomeRevision: 2,
        sourceKind: 'social_outcome', sourceActionId: 'action:gift', sourceEventId: 'event:gift',
        sourceWarrantId: 'warrant:aid', sourceRevision: 'outcome:aid:2',
        kind: 'gratitude_due', subjectActorId: 'actor_a', counterpartActorIds: ['actor_b'],
        audience: 'participants', status: 'active', remainingProjectionBudget: 1,
        dueGameHour: 48, expiresGameHour: 768, updatedAt: 1,
      });
      fixture.table('socialConsequences').push(consequence);
      fixture.table('worldEvents').push(doc('event:gift', { actionId: 'action:gift' }));
      fixture.table('socialOutcomeReceipts').push(doc('receipt:aid', {
        worldId: WORLD_ID, outcomeId: consequence.sourceOutcomeId, revision: 2, status: 'resolved',
        terminalActionId: 'action:gift', terminalEventId: 'event:gift',
      }));
      const sourceRevision = socialConsequenceProjectionSourceRevision({
        consequenceId: consequence.consequenceId,
        consequenceRevision: consequence.revision,
        sourceOutcomeId: consequence.sourceOutcomeId,
        sourceOutcomeRevision: consequence.sourceOutcomeRevision,
        sourceRevision: consequence.sourceRevision,
        status: consequence.status,
        remainingProjectionBudget: consequence.remainingProjectionBudget,
        dueGameHour: consequence.dueGameHour,
        expiresGameHour: consequence.expiresGameHour,
      });
      const binding = {
        ...directBinding('thank_apologize_or_repair', 'talk', 'talk'),
        sourceRef: socialConsequenceProjectionSourceRef(consequence.consequenceId),
        sourceRevision,
        audience: 'participants' as const,
      };
      return { fixture, consequence, binding };
    };
    const early = setup();
    expect(await consumeSocialConsequenceProjectionTx(early.fixture.ctx, {
      worldId: WORLD_ID, binding: early.binding, gameHour: 47, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_not_due' });
    const timeExpired = setup();
    expect(await consumeSocialConsequenceProjectionTx(timeExpired.fixture.ctx, {
      worldId: WORLD_ID, binding: timeExpired.binding, gameHour: 768, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_expired' });
    const persistedExpired = setup();
    Object.assign(persistedExpired.fixture.table('socialConsequences')[0], {
      status: 'expired', revision: 2, remainingProjectionBudget: 0,
      terminalGameHour: 768, terminalReasonCode: 'social_consequence_expired',
    });
    expect(await consumeSocialConsequenceProjectionTx(persistedExpired.fixture.ctx, {
      worldId: WORLD_ID, binding: persistedExpired.binding, gameHour: 768, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_expired' });
    const wrongActor = setup();
    expect(await consumeSocialConsequenceProjectionTx(wrongActor.fixture.ctx, {
      worldId: WORLD_ID,
      binding: { ...wrongActor.binding, actorId: 'actor_b', targetActorIds: ['actor_a'] },
      gameHour: 48, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_subject_mismatch' });
    const stale = setup();
    expect(await consumeSocialConsequenceProjectionTx(stale.fixture.ctx, {
      worldId: WORLD_ID,
      binding: { ...stale.binding, sourceRevision: 'consequence_revision:stale' },
      gameHour: 48, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_source_stale' });
    const missing = setup();
    missing.fixture.table('socialConsequences').splice(0);
    expect(await consumeSocialConsequenceProjectionTx(missing.fixture.ctx, {
      worldId: WORLD_ID, binding: missing.binding, gameHour: 48, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_source_missing' });
  });

  test('LWSE-2b consumes one exact grievance request and counts assault evidence once', async () => {
    const fixture = memoryFixture();
    const sourceActionId = 'action:attack' as Id<'actionRecords'>;
    const sourceEventId = 'event:attack' as Id<'worldEvents'>;
    const sourceOutcomeId = `action_terminal:${sourceActionId}:${sourceEventId}`;
    const facts = {
      schemaVersion: 1, resultCode: 'combat_attack_hit', encounterId: 'encounter:1',
      targetActorId: 'actor_a', damage: 3, defeated: false,
    };
    const sourceRevision = grievanceActionTerminalSourceRevision({
      eventId: sourceEventId, actionId: sourceActionId,
      resultCode: facts.resultCode, targetActorId: facts.targetActorId,
      damage: facts.damage, defeated: facts.defeated,
    });
    fixture.table('actionRecords').push(doc(sourceActionId, {
      worldId: WORLD_ID, type: 'attack', status: 'applied',
      actorId: 'actor_b', targetActorId: 'actor_a',
    }));
    fixture.table('worldEvents').push(doc(sourceEventId, {
      worldId: WORLD_ID, type: 'combat_attack_resolved', actorIds: ['actor_b'],
      targetActorIds: ['actor_a'], actionId: sourceActionId, facts,
    }));
    fixture.table('relationshipChanges').push(doc('relationship:assault', {
      worldId: WORLD_ID, sourceEventId, fromActorId: 'actor_a', toActorId: 'actor_b',
      effectKind: 'assault',
    }));
    const consequence = {
      worldId: WORLD_ID, consequenceId: 'social_consequence:grievance', revision: 1,
      sourceOutcomeId, sourceOutcomeRevision: 1, sourceKind: 'action_terminal',
      sourceActionId, sourceEventId, sourceRevision, kind: 'grievance_created',
      subjectActorId: 'actor_a', counterpartActorIds: ['actor_b'], audience: 'private',
      status: 'active', remainingProjectionBudget: 1, expiresGameHour: 768, updatedAt: 1,
    };
    fixture.table('socialConsequences').push(doc('consequence:grievance', consequence));
    const projectionRevision = socialConsequenceProjectionSourceRevision({
      consequenceId: consequence.consequenceId,
      consequenceRevision: consequence.revision,
      sourceOutcomeId: consequence.sourceOutcomeId,
      sourceOutcomeRevision: consequence.sourceOutcomeRevision,
      sourceRevision: consequence.sourceRevision,
      status: consequence.status,
      remainingProjectionBudget: consequence.remainingProjectionBudget,
      expiresGameHour: consequence.expiresGameHour,
    });
    const binding = {
      ...directBinding('mediate_or_negotiate', 'talk', 'talk'),
      outcomeId: 'social_outcome:grievance_request',
      scopeKey: 'social_outcome_scope:grievance_request',
      sourceRef: socialConsequenceProjectionSourceRef(consequence.consequenceId),
      sourceRevision: projectionRevision,
      topicRefs: [`consequence:${consequence.consequenceId}`, `event:${sourceEventId}`],
      audience: 'private' as const,
    };
    expect(await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding,
      openedByActionId: 'action:request-compensation' as Id<'actionRecords'>,
      openedEventId: 'event:request-compensation' as Id<'worldEvents'>,
      gameHour: 48, now: 2_000, conversationId: 'conversation:grievance',
    })).toMatchObject({ ok: true, replay: false });
    expect(fixture.table('socialConsequences')[0]).toMatchObject({
      revision: 2, remainingProjectionBudget: 0, updatedAt: 2_000,
    });
    expect(fixture.table('relationshipChanges')).toHaveLength(1);
  });

  test('LWSE-2b grievance admission rejects missing or duplicate exact assault evidence', async () => {
    const setup = () => {
      const fixture = memoryFixture();
      const sourceActionId = 'action:attack'; const sourceEventId = 'event:attack';
      const facts = { resultCode: 'combat_attack_hit', targetActorId: 'actor_a', damage: 2, defeated: false };
      const sourceRevision = grievanceActionTerminalSourceRevision({
        eventId: sourceEventId, actionId: sourceActionId, ...facts,
      });
      fixture.table('actionRecords').push(doc(sourceActionId, {
        worldId: WORLD_ID, type: 'attack', status: 'applied', actorId: 'actor_b', targetActorId: 'actor_a',
      }));
      fixture.table('worldEvents').push(doc(sourceEventId, {
        worldId: WORLD_ID, type: 'combat_attack_resolved', actorIds: ['actor_b'],
        targetActorIds: ['actor_a'], actionId: sourceActionId, facts,
      }));
      const consequence = doc('consequence:grievance', {
        worldId: WORLD_ID, consequenceId: 'social_consequence:grievance', revision: 1,
        sourceOutcomeId: `action_terminal:${sourceActionId}:${sourceEventId}`,
        sourceOutcomeRevision: 1, sourceKind: 'action_terminal', sourceActionId,
        sourceEventId, sourceRevision, kind: 'grievance_created', subjectActorId: 'actor_a',
        counterpartActorIds: ['actor_b'], audience: 'private', status: 'active',
        remainingProjectionBudget: 1, expiresGameHour: 768, updatedAt: 1,
      });
      fixture.table('socialConsequences').push(consequence);
      const projectionRevision = socialConsequenceProjectionSourceRevision({
        consequenceId: consequence.consequenceId, consequenceRevision: consequence.revision,
        sourceOutcomeId: consequence.sourceOutcomeId,
        sourceOutcomeRevision: consequence.sourceOutcomeRevision,
        sourceRevision: consequence.sourceRevision, status: consequence.status,
        remainingProjectionBudget: consequence.remainingProjectionBudget,
        expiresGameHour: consequence.expiresGameHour,
      });
      const binding = {
        ...directBinding('mediate_or_negotiate', 'talk', 'talk'),
        sourceRef: socialConsequenceProjectionSourceRef(consequence.consequenceId),
        sourceRevision: projectionRevision, audience: 'private' as const,
      };
      return { fixture, binding };
    };
    const missing = setup();
    expect(await consumeSocialConsequenceProjectionTx(missing.fixture.ctx, {
      worldId: WORLD_ID, binding: missing.binding, gameHour: 48, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_evidence_missing' });
    const duplicate = setup();
    for (const id of ['relationship:assault:1', 'relationship:assault:2']) {
      duplicate.fixture.table('relationshipChanges').push(doc(id, {
        worldId: WORLD_ID, sourceEventId: 'event:attack', fromActorId: 'actor_a',
        toActorId: 'actor_b', effectKind: 'assault',
      }));
    }
    expect(await consumeSocialConsequenceProjectionTx(duplicate.fixture.ctx, {
      worldId: WORLD_ID, binding: duplicate.binding, gameHour: 48, now: 1,
    })).toEqual({ ok: false, reasonCode: 'social_consequence_projection_source_stale' });
  });

  test('begin, conversation evidence, terminal and scope cooldown are atomic and replay-safe', async () => {
    const fixture = memoryFixture();
    const binding = directBinding('ask_or_verify', 'teach', 'request_teaching');
    const begun = await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, openedByActionId: 'action:open' as Id<'actionRecords'>,
      openedEventId: 'event:open' as Id<'worldEvents'>, gameHour: 10, now: 1_000,
      conversationId: 'conversation:1',
    });
    expect(begun).toMatchObject({ ok: true, replay: false, receipt: { status: 'pending' } });
    fixture.table('conversationUtterances').push(doc('utterance:1', {
      worldId: WORLD_ID, conversationId: 'conversation:1', turnNumber: 1,
      speakerActorId: 'actor_b', speechAct: 'clarify', referencedFactIds: ['event:evidence'],
      referencedBeliefIds: ['belief:1'],
    }));
    fixture.table('socialClaims').push(doc('claim:1', {
      worldId: WORLD_ID, conversationId: 'conversation:1', truthStatus: 'supported',
      referencedFactIds: ['event:evidence'], referencedBeliefIds: ['belief:1'],
    }));
    const settled = await settleConversationSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, conversationId: 'conversation:1', status: 'resolved',
      resultCode: 'conversation_ended', terminalActionId: 'action:end' as Id<'actionRecords'>,
      terminalEventId: 'event:end' as Id<'worldEvents'>, gameHour: 12, now: 1_200,
    });
    expect(settled).toMatchObject({ ok: true, replay: false, receipt: {
      status: 'resolved', terminalReasonCode: 'social_outcome_knowledge_verified',
    } });
    expect(await settleConversationSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, conversationId: 'conversation:1', status: 'resolved',
      resultCode: 'conversation_ended', terminalActionId: 'action:end' as Id<'actionRecords'>,
      terminalEventId: 'event:end' as Id<'worldEvents'>, gameHour: 12, now: 1_201,
    })).toMatchObject({ ok: true, replay: true });
    const second = await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID,
      binding: { ...binding, outcomeId: 'social_outcome:other', sourceRevision: 'rev:2' },
      openedByActionId: 'action:other' as Id<'actionRecords'>,
      openedEventId: 'event:other' as Id<'worldEvents'>, gameHour: 20, now: 2_000,
    });
    expect(second).toEqual({ ok: false, reasonCode: 'social_outcome_cooldown_active' });
    const independentFact = await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID,
      binding: {
        ...binding,
        outcomeId: 'social_outcome:new_causal_fact',
        scopeKey: 'social_outcome_scope:direct:new_causal_fact',
        sourceRef: 'event:new_causal_fact',
        sourceRevision: 'event:rev:1',
        topicRefs: ['event:new_causal_fact'],
      },
      openedByActionId: 'action:new-fact' as Id<'actionRecords'>,
      openedEventId: 'event:new-fact' as Id<'worldEvents'>, gameHour: 20, now: 2_001,
    });
    expect(independentFact).toMatchObject({ ok: true, replay: false, receipt: {
      sourceRef: 'event:new_causal_fact', status: 'pending',
    } });
    expect(fixture.table('socialOutcomeReceipts')).toHaveLength(2);
  });

  test('unproven knowledge fails honestly and a conflicting replay cannot rewrite it', async () => {
    const fixture = memoryFixture();
    const binding = directBinding('ask_or_verify', 'teach', 'request_teaching');
    await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, openedByActionId: 'action:open' as Id<'actionRecords'>,
      openedEventId: 'event:open' as Id<'worldEvents'>, gameHour: 10, now: 1_000,
      conversationId: 'conversation:1',
    });
    fixture.table('conversationUtterances').push(doc('utterance:1', {
      worldId: WORLD_ID, conversationId: 'conversation:1', turnNumber: 1,
      speakerActorId: 'actor_b', speechAct: 'inform', referencedFactIds: [], referencedBeliefIds: [],
    }));
    const failed = await settleConversationSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, conversationId: 'conversation:1', status: 'resolved', resultCode: 'conversation_ended',
      terminalActionId: 'action:end' as Id<'actionRecords'>, terminalEventId: 'event:end' as Id<'worldEvents'>,
      gameHour: 12, now: 1_200,
    });
    expect(failed).toMatchObject({ ok: true, receipt: { status: 'failed', terminalReasonCode: 'social_outcome_knowledge_unproven' } });
    expect(fixture.table('socialConsequences')).toHaveLength(0);
    expect(await settleSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, outcomeId: binding.outcomeId,
      evidence: { resultCode: 'teaching_granted' },
      terminalActionId: 'action:rewrite' as Id<'actionRecords'>,
      terminalEventId: 'event:rewrite' as Id<'worldEvents'>, gameHour: 13, now: 1_300,
    })).toEqual({ ok: false, reasonCode: 'social_outcome_terminal_conflict' });
  });

  test('pure receipt transition fixture proves eight-way replay has one terminal', () => {
    const binding = directBinding('request_aid', 'talk', 'talk');
    const receipt = createSocialOutcomeReceipt({
      binding, openedByActionId: 'action:open', openedEventId: 'event:open',
      createdGameHour: 1, conversationId: 'conversation:1',
    });
    expect(receipt.status).toBe('pending');
  });

  test('group invitation binds one C014 session and rejection closes the source/topic once', async () => {
    const fixture = memoryFixture();
    const binding = groupBinding();
    await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, openedByActionId: 'action:invite' as Id<'actionRecords'>,
      openedEventId: 'event:invite' as Id<'worldEvents'>, gameHour: 20, now: 2_000,
    });
    expect(await bindGroupConversationSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, groupConversationId: 'group:1', now: 2_100,
    })).toMatchObject({ ok: true, replay: false });
    expect(await groupSocialOutcomePendingTx(fixture.ctx, {
      worldId: WORLD_ID, groupConversationId: 'group:1',
    })).toBe(true);
    const settled = await settleGroupSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, groupConversationId: 'group:1',
      evidence: { resultCode: 'group_proposal_rejected', groupProposalStatus: 'rejected' },
      terminalActionId: 'action:vote' as Id<'actionRecords'>,
      terminalEventId: 'event:vote' as Id<'worldEvents'>, gameHour: 21, now: 2_200,
    });
    expect(settled).toMatchObject({ ok: true, receipt: {
      status: 'resolved', terminalReasonCode: 'social_outcome_group_proposal_rejected',
    } });
    expect(await groupSocialOutcomePendingTx(fixture.ctx, {
      worldId: WORLD_ID, groupConversationId: 'group:1',
    })).toBe(false);
    expect(await socialOutcomeScopeAvailable(fixture.ctx, WORLD_ID, binding.scopeKey, 22)).toBe(false);
    expect(await socialOutcomeScopeAvailable(fixture.ctx, WORLD_ID, binding.scopeKey, 21 + 7 * 24)).toBe(true);
  });

  test.each([
    ['fulfilled', 'group_commitment_fulfilled', 'supports', 'resolved'],
    ['breached', 'group_commitment_breached', 'contradicts', 'failed'],
  ] as const)('group commitment %s terminal atomically derives one %s reliability owner', async (
    commitmentStatus, resultCode, evidenceDirection, outcomeStatus,
  ) => {
    const fixture = memoryFixture();
    const binding = groupBinding();
    await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding,
      openedByActionId: 'action:invite' as Id<'actionRecords'>,
      openedEventId: 'event:invite' as Id<'worldEvents'>,
      gameHour: 20, now: 2_000,
    });
    await bindGroupConversationSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, groupConversationId: 'group:reliability', now: 2_010,
    });
    fixture.table('worldEvents').push(doc('event:execute', {
      worldId: WORLD_ID, type: resultCode, actorIds: ['actor_a'],
      targetActorIds: ['actor_b'], witnessActorIds: ['actor_b', 'actor_c'],
      actionId: 'action:execute', visibility: 'witnessed', summary: resultCode,
      createdAt: 2_100,
      facts: {
        schemaVersion: 1, resultCode, operation: 'execute',
        groupConversationId: 'group:reliability', proposalId: 'proposal:1',
        proposalStatus: 'committed', kind: 'owned_herb_allocation',
        proposerActorId: 'actor_a', donorActorId: 'actor_a', recipientActorId: 'actor_b',
        itemId: 'spirit_herb', itemQty: 1, quorum: 2,
        commitmentId: 'commitment:1', commitmentStatus,
      },
    }));
    const settled = await settleGroupSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, groupConversationId: 'group:reliability',
      evidence: { resultCode, commitmentStatus },
      terminalActionId: 'action:execute' as Id<'actionRecords'>,
      terminalEventId: 'event:execute' as Id<'worldEvents'>,
      gameHour: 21, now: 2_100,
    });
    expect(settled).toMatchObject({ ok: true, replay: false, receipt: {
      revision: 2, status: outcomeStatus,
    } });
    expect(fixture.table('socialConsequences')).toEqual([expect.objectContaining({
      kind: 'reliability_evidence', evidenceDirection,
      sourceOutcomeId: binding.outcomeId, sourceOutcomeRevision: 2,
      sourceActionId: 'action:execute', sourceEventId: 'event:execute',
      subjectActorId: 'actor_a', counterpartActorIds: ['actor_b'],
      remainingProjectionBudget: 0,
    })]);
    expect(await settleGroupSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, groupConversationId: 'group:reliability',
      evidence: { resultCode, commitmentStatus },
      terminalActionId: 'action:execute' as Id<'actionRecords'>,
      terminalEventId: 'event:execute' as Id<'worldEvents'>,
      gameHour: 21, now: 2_101,
    })).toMatchObject({ ok: true, replay: true });
    expect(fixture.table('socialConsequences')).toHaveLength(1);
  });

  test('claimed reliability terminal with inconsistent event facts fails closed', async () => {
    const fixture = memoryFixture();
    const binding = groupBinding();
    await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding,
      openedByActionId: 'action:invite' as Id<'actionRecords'>,
      openedEventId: 'event:invite' as Id<'worldEvents'>,
      gameHour: 20, now: 2_000,
    });
    await bindGroupConversationSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, groupConversationId: 'group:invalid', now: 2_010,
    });
    fixture.table('worldEvents').push(doc('event:execute', {
      worldId: WORLD_ID, type: 'group_commitment_fulfilled', actorIds: ['actor_a'],
      targetActorIds: ['actor_b'], actionId: 'action:execute',
      facts: {
        resultCode: 'group_commitment_fulfilled', operation: 'vote',
        kind: 'owned_herb_allocation', donorActorId: 'actor_a', recipientActorId: 'actor_b',
        commitmentId: 'commitment:1', commitmentStatus: 'fulfilled',
      },
    }));
    await expect(settleGroupSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, groupConversationId: 'group:invalid',
      evidence: { resultCode: 'group_commitment_fulfilled', commitmentStatus: 'fulfilled' },
      terminalActionId: 'action:execute' as Id<'actionRecords'>,
      terminalEventId: 'event:execute' as Id<'worldEvents'>,
      gameHour: 21, now: 2_100,
    })).rejects.toThrow('social_consequence_terminal_evidence_invalid');
    expect(fixture.table('socialConsequences')).toHaveLength(0);
  });

  test('an authoritative direct-action terminal settles once and emits one derived result memory', async () => {
    const fixture = memoryFixture();
    const binding = directBinding('thank_apologize_or_repair', 'gift', 'gift');
    fixture.table('worldEvents').push(doc('event:open', {
      worldId: WORLD_ID, type: 'action_execution_started', actorIds: ['actor_a'],
      targetActorIds: ['actor_b'], visibility: 'private', summary: '开始赠礼', createdAt: 1_000,
    }));
    fixture.table('worldEvents').push(doc('event:gift', {
      worldId: WORLD_ID, type: 'action_execution_completed', actorIds: ['actor_a'],
      targetActorIds: ['actor_b'], visibility: 'private', summary: '赠礼完成', createdAt: 1_100,
    }));
    fixture.table('xianxiaProfiles').push(
      doc('profile:a', { worldId: WORLD_ID, actorId: 'actor_a' }),
      doc('profile:b', { worldId: WORLD_ID, actorId: 'actor_b' }),
    );
    await beginSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, binding, openedByActionId: 'action:gift' as Id<'actionRecords'>,
      openedEventId: 'event:open' as Id<'worldEvents'>, gameHour: 30, now: 3_000,
    });
    const settled = await settleActionSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, actionRecordId: 'action:gift' as Id<'actionRecords'>,
      terminalEventId: 'event:gift' as Id<'worldEvents'>, resultCode: 'gift_accepted',
      gameHour: 31, now: 3_100,
    });
    expect(settled).toMatchObject({ ok: true, receipt: { status: 'resolved' } });
    expect(fixture.table('socialConsequences')).toEqual([
      expect.objectContaining({
        kind: 'aid_received', sourceOutcomeId: binding.outcomeId,
        sourceActionId: 'action:gift', sourceEventId: 'event:gift',
        subjectActorId: 'actor_b', counterpartActorIds: ['actor_a'],
        remainingProjectionBudget: 0,
      }),
      expect.objectContaining({
        kind: 'gratitude_due', sourceOutcomeId: binding.outcomeId,
        sourceActionId: 'action:gift', sourceEventId: 'event:gift',
        subjectActorId: 'actor_b', counterpartActorIds: ['actor_a'],
        remainingProjectionBudget: 1,
      }),
    ]);
    expect(await settleActionSocialOutcomeTx(fixture.ctx, {
      worldId: WORLD_ID, actionRecordId: 'action:gift' as Id<'actionRecords'>,
      terminalEventId: 'event:gift' as Id<'worldEvents'>, resultCode: 'gift_accepted',
      gameHour: 31, now: 3_101,
    })).toMatchObject({ ok: true, replay: true });
    expect(fixture.table('socialConsequences')).toHaveLength(2);
    expect(await socialOutcomeSourceAvailable(fixture.ctx, {
      worldId: WORLD_ID,
      actorId: binding.actorId,
      targetActorIds: binding.targetActorIds,
      sourceRef: binding.sourceRef,
      intendedOutcome: binding.intendedOutcome,
      nowGameHour: 32,
    })).toBe(false);
    expect(await socialOutcomeSourceAvailable(fixture.ctx, {
      worldId: WORLD_ID,
      actorId: binding.actorId,
      targetActorIds: binding.targetActorIds,
      sourceRef: 'event:a-new-help',
      intendedOutcome: binding.intendedOutcome,
      nowGameHour: 32,
    })).toBe(true);
    expect(await ensureSocialOutcomeEventTx(fixture.ctx, {
      worldId: WORLD_ID, outcomeId: binding.outcomeId, gameHour: 31, now: 3_100,
    })).toMatchObject({ ok: true, replay: false });
    expect(await ensureSocialOutcomeEventTx(fixture.ctx, {
      worldId: WORLD_ID, outcomeId: binding.outcomeId, gameHour: 31, now: 3_101,
    })).toMatchObject({ ok: true, replay: true });
    expect(fixture.table('worldEvents').filter((event) => event.type === 'social_outcome_resolved')).toHaveLength(1);
    expect(fixture.table('shortMemories')).toHaveLength(2);
    expect(fixture.table('relationships')).toHaveLength(0);
  });
});

function directBinding(outcome: SocialWarrant['intendedOutcome'], activity: 'talk' | 'teach' | 'gift', actionType: string) {
  const kind = outcome === 'ask_or_verify'
    ? 'knowledge_gap'
    : outcome === 'thank_apologize_or_repair'
      ? 'gratitude_or_repair'
      : outcome === 'mediate_or_negotiate'
        ? 'conflict_resolution'
      : 'care_or_aid';
  const warrant: SocialWarrant = {
    contractVersion: 'taixu.social-warrant.v1', warrantId: `warrant:${outcome}`,
    actorId: 'actor_a', kind, sourceRef: `source:${outcome}`, sourceRevision: 'rev:1',
    intendedOutcome: outcome, eligibleTargetActorIds: ['actor_b'], topicRefs: [`topic:${outcome}`],
    audience: 'private', urgencyBand: 'routine', createdAt: 1, expiresAt: 100,
  };
  const candidate: SocialOpportunityCandidate = {
    contractVersion: 'taixu.social-opportunity-candidate.v1', candidateId: `candidate:${outcome}`,
    warrantId: warrant.warrantId, mode: 'start_direct_conversation', targetActorIds: ['actor_b'],
    intendedActivity: activity, summary: outcome,
  };
  const result = prepareSocialOutcomeBinding({
    actorId: 'actor_a', targetActorIds: ['actor_b'], actionType, warrant, candidate,
    warrantDigest: socialWarrantDigest(warrant), candidateDigest: socialOpportunityCandidateDigest(candidate),
    warrantCandidateDigest: socialWarrantCandidateDigest(warrant, candidate),
  });
  if (!result.ok) throw new Error(result.reasonCode);
  return result.binding;
}

function groupBinding() {
  const warrant: SocialWarrant = {
    contractVersion: 'taixu.social-warrant.v1', warrantId: 'warrant:group', actorId: 'actor_a',
    kind: 'collective_event', sourceRef: 'event:shared', sourceRevision: 'rev:1',
    intendedOutcome: 'reach_group_decision', eligibleTargetActorIds: ['actor_b', 'actor_c'],
    topicRefs: ['topic:shared'], audience: 'participants', urgencyBand: 'important',
    createdAt: 10, expiresAt: 100,
  };
  const candidate: SocialOpportunityCandidate = {
    contractVersion: 'taixu.social-opportunity-candidate.v1', candidateId: 'candidate:group',
    warrantId: warrant.warrantId, mode: 'start_group_conversation',
    targetActorIds: ['actor_b', 'actor_c'], meetingLocationId: 'location:hall',
    intendedActivity: 'group_decide', summary: '共同商议',
  };
  const result = prepareSocialOutcomeBinding({
    actorId: 'actor_a', targetActorIds: candidate.targetActorIds, actionType: 'group_talk',
    warrant, candidate, warrantDigest: socialWarrantDigest(warrant),
    candidateDigest: socialOpportunityCandidateDigest(candidate),
    warrantCandidateDigest: socialWarrantCandidateDigest(warrant, candidate),
  });
  if (!result.ok) throw new Error(result.reasonCode);
  return result.binding;
}

type Row = Record<string, any> & { _id: string; _creationTime: number };
function memoryFixture() {
  let serial = 1;
  const tables: Record<string, Row[]> = {
    socialOutcomeReceipts: [], conversationUtterances: [], socialClaims: [], worldEvents: [],
    socialConsequences: [],
    xianxiaProfiles: [], shortMemories: [], memoryCompactionStates: [],
    relationships: [], actionRecords: [], relationshipChanges: [],
  };
  const db = {
    query(table: string) { return queryBuilder(() => tables[table] ?? []); },
    async get(id: string) {
      return Object.values(tables).flat().find((entry) => entry._id === id) ?? null;
    },
    normalizeId(_table: string, id: string) { return typeof id === 'string' ? id : null; },
    async insert(table: string, value: Record<string, unknown>) {
      const row = doc(`${table}:${serial++}`, value); (tables[table] ??= []).push(row); return row._id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      const row = Object.values(tables).flat().find((entry) => entry._id === id);
      if (row) Object.assign(row, value);
    },
  };
  const scheduler = { async runAfter() { return undefined; } };
  return { ctx: { db, scheduler } as unknown as MutationCtx, table: (name: string) => tables[name] };
}

function doc(id: string, value: Record<string, unknown>): Row {
  return { _id: id, _creationTime: 1, ...value };
}

function queryBuilder(source: () => Row[]) {
  let predicates: Array<(row: Row) => boolean> = [];
  const chain = {
    withIndex(_name: string, callback?: (q: any) => any) {
      if (callback) {
        const conditions: Array<[string, unknown]> = [];
        const q = { eq(field: string, value: unknown) { conditions.push([field, value]); return q; } };
        callback(q); predicates.push((row) => conditions.every(([field, value]) => row[field] === value));
      }
      return chain;
    },
    async collect() { return rows(); },
    async first() { return rows()[0] ?? null; },
    async take(limit: number) { return rows().slice(0, limit); },
    order() { return chain; },
    async unique() { const values = rows(); if (values.length > 1) throw new Error('not_unique'); return values[0] ?? null; },
  };
  function rows() { return source().filter((row) => predicates.every((predicate) => predicate(row))); }
  return chain;
}
