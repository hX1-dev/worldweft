import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import {
  commitGroupSocialInitiationStarted,
  createGroupSocialInitiationTx,
  loadActorGroupSocialCoordination,
  loadGroupSocialOpportunities,
  prepareGroupSocialInitiationStart,
  respondGroupSocialInitiationTx,
} from './groupSocialInitiations';
import { commitGroupConversationStart, prepareGroupConversationStart } from './groupConversations';
import {
  commitGroupDecision,
  prepareGroupCommitmentExecution,
  prepareGroupProposal,
  prepareGroupVote,
} from './groupDecisions';
import { createSocialOutcomeReceipt, prepareSocialOutcomeBinding } from './socialOutcomeContracts';
import {
  socialOpportunityCandidateDigest,
  socialWarrantCandidateDigest,
  socialWarrantDigest,
} from './socialWarrantContracts';

const WORLD_ID = 'world:group-social' as Id<'worlds'>;
const NOW = 10_000;

describe('C021b0d group social initiation persistence', () => {
  test('C021b0e resolved source/topic cooldown suppresses a future group candidate', async () => {
    const fixture = memoryFixture();
    const [opportunity] = await loadGroupSocialOpportunities(fixture.ctx, WORLD_ID, 'steward', NOW);
    const warrantDigest = socialWarrantDigest(opportunity.warrant);
    const candidateDigest = socialOpportunityCandidateDigest(opportunity.candidate);
    const prepared = prepareSocialOutcomeBinding({
      actorId: 'steward', targetActorIds: opportunity.candidate.targetActorIds,
      actionType: 'group_talk', warrant: opportunity.warrant, candidate: opportunity.candidate,
      warrantDigest, candidateDigest,
      warrantCandidateDigest: socialWarrantCandidateDigest(opportunity.warrant, opportunity.candidate),
    });
    if (!prepared.ok) throw new Error(prepared.reasonCode);
    fixture.table('socialOutcomeReceipts').push(doc('outcome:1', {
      worldId: WORLD_ID,
      ...createSocialOutcomeReceipt({
        binding: prepared.binding, openedByActionId: 'action:invite', openedEventId: 'event:invite',
        createdGameHour: 0,
      }),
      status: 'resolved', terminalActionId: 'action:vote', terminalEventId: 'event:vote',
      terminalResultCode: 'group_proposal_rejected', terminalReasonCode: 'social_outcome_group_proposal_rejected',
      terminalGameHour: 0, cooldownUntilGameHour: 168, createdAt: NOW, updatedAt: NOW,
    }));
    expect(await loadGroupSocialOpportunities(fixture.ctx, WORLD_ID, 'steward', NOW + 1)).toEqual([]);
  });

  test('shared request creates once, collects consent, then binds one C014 session', async () => {
    const fixture = memoryFixture();
    const opportunities = await loadGroupSocialOpportunities(fixture.ctx, WORLD_ID, 'steward', NOW);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      sourceKind: 'shared_request',
      candidate: { targetActorIds: ['disciple', 'merchant'], mode: 'start_group_conversation' },
    });
    const created = await createGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID,
      actorId: 'steward',
      candidateId: opportunities[0].candidate.candidateId,
      now: NOW,
    });
    expect(created).toMatchObject({ ok: true, replay: false, receipt: { status: 'pending', revision: 1 } });
    const replay = await createGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID,
      actorId: 'steward',
      candidateId: opportunities[0].candidate.candidateId,
      now: NOW,
    });
    expect(replay).toMatchObject({ ok: true, replay: true });
    if (!created.ok) throw new Error('expected initiation');
    const first = await respondGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID,
      initiationId: created.receipt.initiationId,
      actorId: 'disciple',
      expectedRevision: 1,
      response: 'accept',
      now: NOW + 1,
    });
    expect(first).toMatchObject({ ok: true, receipt: { status: 'pending', revision: 2 } });
    const second = await respondGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID,
      initiationId: created.receipt.initiationId,
      actorId: 'merchant',
      expectedRevision: 2,
      response: 'accept',
      now: NOW + 2,
    });
    expect(second).toMatchObject({ ok: true, receipt: { status: 'ready', revision: 3 } });
    const ready = await prepareGroupSocialInitiationStart(fixture.ctx, {
      worldId: WORLD_ID,
      initiationId: created.receipt.initiationId,
      actorId: 'steward',
      expectedRevision: 3,
      now: NOW + 3,
    });
    expect(ready).toMatchObject({ ok: true, receipt: { status: 'ready' } });
    if (!ready.ok) throw new Error('expected ready');
    const profile = fixture.table('xianxiaProfiles').find((row) => row.actorId === 'steward')!;
    const prepared = await prepareGroupConversationStart(fixture.ctx, {
      worldId: WORLD_ID,
      actionRecordId: 'action:start' as Id<'actionRecords'>,
      actor: profile as never,
      participantActorIds: ready.receipt.participantActorIds,
      observerActorIds: ready.receipt.observerActorIds,
      topicId: ready.receipt.topicRefs[0],
      sourceBinding: {
        initiationId: ready.receipt.initiationId,
        outcomeId: `${ready.receipt.initiationId}:outcome`,
        warrantId: ready.receipt.warrantId,
        warrantDigest: ready.receipt.warrantDigest,
        sourceRef: ready.receipt.sourceRef,
        sourceRevision: ready.receipt.sourceRevision,
        participantRoles: ready.receipt.participantRoles,
      },
      now: NOW + 3,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error('expected C014 plan');
    const session = await commitGroupConversationStart(fixture.ctx, {
      worldId: WORLD_ID,
      actionRecordId: 'action:start' as Id<'actionRecords'>,
      eventId: 'event:start' as Id<'worldEvents'>,
      plan: prepared.plan,
    });
    const linked = await commitGroupSocialInitiationStarted(fixture.ctx, {
      worldId: WORLD_ID,
      initiationId: ready.receipt.initiationId,
      actorId: 'steward',
      expectedRevision: 3,
      groupConversationId: session.groupConversationId,
      now: NOW + 3,
    });
    expect(linked).toMatchObject({ ok: true, replay: false, receipt: { status: 'started', revision: 4 } });
    expect(fixture.table('groupConversationSessions')).toHaveLength(1);
    expect(fixture.table('groupConversationSessions')[0]).toMatchObject({
      groupSocialInitiationId: ready.receipt.initiationId,
      socialOutcomeId: `${ready.receipt.initiationId}:outcome`,
      socialSourceRef: ready.receipt.sourceRef,
    });
    const proposed = await prepareGroupProposal(fixture.ctx, {
      worldId: WORLD_ID, actionRecordId: 'action:proposal' as Id<'actionRecords'>,
      actorId: 'steward', groupConversationId: session.groupConversationId,
      recipientActorId: 'disciple', now: NOW + 4,
    });
    expect(proposed.result.status).toBe('applied');
    if (!proposed.plan) throw new Error('expected proposal plan');
    await commitGroupDecision(fixture.ctx, {
      worldId: WORLD_ID, actionRecordId: 'action:proposal' as Id<'actionRecords'>,
      eventId: 'event:proposal' as Id<'worldEvents'>, plan: proposed.plan, now: NOW + 4,
    });
    for (const [index, voter] of ['steward', 'disciple'].entries()) {
      const vote = await prepareGroupVote(fixture.ctx, {
        worldId: WORLD_ID, actorId: voter, groupConversationId: session.groupConversationId,
        proposalId: 'group_proposal:action:proposal', choice: 'approve', source: 'human', now: NOW + 5 + index,
      });
      expect(vote.result.status).toBe('applied');
      if (!vote.plan) throw new Error('expected vote plan');
      await commitGroupDecision(fixture.ctx, {
        worldId: WORLD_ID, actionRecordId: `action:vote:${index}` as Id<'actionRecords'>,
        eventId: `event:vote:${index}` as Id<'worldEvents'>, plan: vote.plan, now: NOW + 5 + index,
      });
    }
    const commitment = fixture.table('groupCommitments')[0];
    expect(commitment).toMatchObject({ status: 'pending', donorActorId: 'steward', recipientActorId: 'disciple' });
    const execution = await prepareGroupCommitmentExecution(fixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', groupConversationId: session.groupConversationId,
      commitmentId: commitment.commitmentId, now: NOW + 8,
    });
    expect(execution.result).toMatchObject({ status: 'applied', resultCode: 'group_commitment_fulfilled' });
    if (!execution.plan) throw new Error('expected execution plan');
    await commitGroupDecision(fixture.ctx, {
      worldId: WORLD_ID, actionRecordId: 'action:execute' as Id<'actionRecords'>,
      eventId: 'event:execute' as Id<'worldEvents'>, plan: execution.plan, now: NOW + 8,
    });
    expect(fixture.table('groupCommitments')[0]).toMatchObject({ status: 'fulfilled' });
    expect((await prepareGroupCommitmentExecution(fixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', groupConversationId: session.groupConversationId,
      commitmentId: commitment.commitmentId, now: NOW + 9,
    })).result).toMatchObject({ status: 'rejected', resultCode: 'group_commitment_not_pending' });
  });

  test('decline, moved participant and stale source all fail closed', async () => {
    const declinedFixture = memoryFixture();
    const [candidate] = await loadGroupSocialOpportunities(declinedFixture.ctx, WORLD_ID, 'steward', NOW);
    const created = await createGroupSocialInitiationTx(declinedFixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', candidateId: candidate.candidate.candidateId, now: NOW,
    });
    if (!created.ok) throw new Error('expected initiation');
    expect(await respondGroupSocialInitiationTx(declinedFixture.ctx, {
      worldId: WORLD_ID, initiationId: created.receipt.initiationId, actorId: 'disciple',
      expectedRevision: 1, response: 'decline', now: NOW + 1,
    })).toMatchObject({ ok: true, receipt: { status: 'declined' } });
    expect(declinedFixture.table('groupConversationSessions')).toHaveLength(0);

    const movedFixture = memoryFixture();
    const [movedCandidate] = await loadGroupSocialOpportunities(movedFixture.ctx, WORLD_ID, 'steward', NOW);
    const movedCreated = await createGroupSocialInitiationTx(movedFixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', candidateId: movedCandidate.candidate.candidateId, now: NOW,
    });
    if (!movedCreated.ok) throw new Error('expected initiation');
    movedFixture.patchActor('disciple', { currentLocationId: 'elsewhere' });
    expect(await respondGroupSocialInitiationTx(movedFixture.ctx, {
      worldId: WORLD_ID, initiationId: movedCreated.receipt.initiationId, actorId: 'merchant',
      expectedRevision: 1, response: 'accept', now: NOW + 1,
    })).toEqual({ ok: false, reasonCode: 'group_social_participant_moved' });
    expect(movedFixture.table('groupSocialInitiations')[0]).toMatchObject({ status: 'cancelled' });

    const staleFixture = memoryFixture();
    const [staleCandidate] = await loadGroupSocialOpportunities(staleFixture.ctx, WORLD_ID, 'steward', NOW);
    const staleCreated = await createGroupSocialInitiationTx(staleFixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', candidateId: staleCandidate.candidate.candidateId, now: NOW,
    });
    if (!staleCreated.ok) throw new Error('expected initiation');
    staleFixture.table('requests')[0].revision = 2;
    expect(await respondGroupSocialInitiationTx(staleFixture.ctx, {
      worldId: WORLD_ID, initiationId: staleCreated.receipt.initiationId, actorId: 'disciple',
      expectedRevision: 1, response: 'accept', now: NOW + 1,
    })).toEqual({ ok: false, reasonCode: 'group_social_source_stale' });
  });

  test('actor projection offers only relevant pending response or host start', async () => {
    const fixture = memoryFixture();
    const [candidate] = await loadGroupSocialOpportunities(fixture.ctx, WORLD_ID, 'steward', NOW);
    const created = await createGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', candidateId: candidate.candidate.candidateId, now: NOW,
    });
    if (!created.ok) throw new Error('expected initiation');
    const pending = await loadActorGroupSocialCoordination(fixture.ctx, WORLD_ID, 'disciple', NOW + 1);
    expect(pending).toMatchObject([{ canRespond: true, canStart: false }]);
  });

  test.each([
    ['busy', 'group_social_participant_busy', (fixture: ReturnType<typeof memoryFixture>) => {
      fixture.table('actionExecutions').push(doc('execution:busy', {
        worldId: WORLD_ID, actorId: 'disciple', status: 'acting', expiresAt: NOW + 9_000,
        hardDeadlineAt: NOW + 9_000,
      }));
    }],
    ['incapacitated', 'group_social_actor_unavailable', (fixture: ReturnType<typeof memoryFixture>) => {
      fixture.patchActor('disciple', { health: 0 });
    }],
    ['deceased', 'group_social_actor_unavailable', (fixture: ReturnType<typeof memoryFixture>) => {
      fixture.patchActor('disciple', { lifeStatus: 'deceased' });
    }],
    ['capacity', 'group_social_capacity_full', (fixture: ReturnType<typeof memoryFixture>) => {
      fixture.table('socialInvitations').push(doc('invitation:capacity', {
        worldId: WORLD_ID, meetingMapId: 'world', meetingLocationId: 'hall', status: 'accepted',
        reservedCapacity: 6,
      }));
    }],
  ])('%s drift cancels before consent', async (_label, reasonCode, mutate) => {
    const fixture = memoryFixture();
    const [candidate] = await loadGroupSocialOpportunities(fixture.ctx, WORLD_ID, 'steward', NOW);
    const created = await createGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', candidateId: candidate.candidate.candidateId, now: NOW,
    });
    if (!created.ok) throw new Error('expected initiation');
    mutate(fixture);
    expect(await respondGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID, initiationId: created.receipt.initiationId, actorId: 'merchant',
      expectedRevision: 1, response: 'accept', now: NOW + 1,
    })).toEqual({ ok: false, reasonCode });
    expect(fixture.table('groupSocialInitiations')[0]).toMatchObject({ status: 'cancelled', terminalReasonCode: reasonCode });
  });

  test('expired response writes one expired terminal and never starts a session', async () => {
    const fixture = memoryFixture();
    const [candidate] = await loadGroupSocialOpportunities(fixture.ctx, WORLD_ID, 'steward', NOW);
    const created = await createGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID, actorId: 'steward', candidateId: candidate.candidate.candidateId, now: NOW,
    });
    if (!created.ok) throw new Error('expected initiation');
    expect(await respondGroupSocialInitiationTx(fixture.ctx, {
      worldId: WORLD_ID, initiationId: created.receipt.initiationId, actorId: 'disciple',
      expectedRevision: 1, response: 'accept', now: created.receipt.expiresAt,
    })).toEqual({ ok: false, reasonCode: 'group_social_invitation_expired' });
    expect(fixture.table('groupSocialInitiations')[0]).toMatchObject({
      status: 'expired', revision: 2, terminalReasonCode: 'group_social_invitation_expired',
    });
    expect(fixture.table('groupConversationSessions')).toHaveLength(0);
  });
});

type MemoryDoc = Record<string, any> & { _id: string; _creationTime: number };

function memoryFixture() {
  let serial = 1;
  const actor = (actorId: string, role: string, inventory: Array<{ itemId: string; qty: number }> = []) =>
    doc(`profile:${actorId}`, {
      worldId: WORLD_ID, actorId, name: actorId, role, realm: 'qi_refining', realmStage: 1,
      cultivationXp: 0, mood: 0, health: 10, spirit: 5, reputation: 0,
      currentLocationId: 'hall', mapId: 'world', inventory,
    });
  const tables: Record<string, MemoryDoc[]> = {
    xianxiaProfiles: [
      actor('steward', 'steward', [{ itemId: 'spirit_herb', qty: 1 }]),
      actor('disciple', 'outer_disciple'), actor('merchant', 'merchant'),
    ],
    locations: [doc('location:hall', {
      worldId: WORLD_ID, locationId: 'hall', name: '议事堂', kind: 'hall', dangerLevel: 0,
      spiritualEnergy: 1, allowedActions: ['group_talk', 'group_decide'], mapId: 'world',
      entryPoints: Array.from({ length: 8 }, (_, index) => ({ x: index, y: 0 })),
    })],
    requests: [doc('request:1', {
      worldId: WORLD_ID, issuerActorId: 'steward', assigneeActorId: 'disciple', type: 'collect_item',
      status: 'accepted', revision: 1, requirements: { itemId: 'spirit_herb', qty: 1 }, rewards: {},
      createdAt: 0, expiresAt: 99_999, summary: '采药',
    })],
    resourceNodes: [], worldEvents: [], xianxiaConfig: [], actionExecutions: [],
    conversationSessions: [], socialInvitations: [], groupConversationSessions: [],
    groupConversationMemberships: [], groupSocialInitiations: [], groupSocialInitiationMembers: [],
    conversationUtterances: [], groupProposals: [], groupVotes: [], groupCommitments: [], relationships: [],
    socialOutcomeReceipts: [],
  };
  const db = {
    query(table: string) { return queryBuilder(() => tables[table] ?? []); },
    async insert(table: string, value: Record<string, unknown>) {
      const row = doc(`${table}:${serial++}`, value); (tables[table] ??= []).push(row); return row._id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((entry) => entry._id === id); if (row) Object.assign(row, value);
      }
    },
    async get(id: string) { return Object.values(tables).flat().find((entry) => entry._id === id) ?? null; },
    normalizeId(table: string, id: string) {
      return (tables[table] ?? []).some((entry) => entry._id === id) ? id : null;
    },
  };
  return {
    ctx: { db } as unknown as MutationCtx,
    table: (name: string) => tables[name],
    patchActor(actorId: string, value: Record<string, unknown>) {
      Object.assign(tables.xianxiaProfiles.find((row) => row.actorId === actorId)!, value);
    },
  };
}

function doc(id: string, value: Record<string, unknown>): MemoryDoc {
  return { _id: id, _creationTime: NOW, ...value };
}

function queryBuilder(source: () => MemoryDoc[]) {
  let predicates: Array<(row: MemoryDoc) => boolean> = [];
  let descending = false;
  const chain = {
    withIndex(_name: string, callback?: (q: any) => any) {
      if (callback) {
        const conditions: Array<[string, unknown]> = [];
        const q = { eq(field: string, value: unknown) { conditions.push([field, value]); return q; } };
        callback(q); predicates.push((row) => conditions.every(([field, value]) => row[field] === value));
      }
      return chain;
    },
    filter(callback: (q: any) => any) {
      const q = {
        field(name: string) { return { field: name }; },
        eq(left: { field: string }, right: unknown) { return { kind: 'eq', field: left.field, right }; },
      };
      const expression = callback(q);
      if (expression?.kind === 'eq') predicates.push((row) => row[expression.field] === expression.right);
      return chain;
    },
    order(value: string) { descending = value === 'desc'; return chain; },
    async collect() { return rows(); },
    async take(limit: number) { return rows().slice(0, limit); },
    async first() { return rows()[0] ?? null; },
    async unique() { const values = rows(); if (values.length > 1) throw new Error('not_unique'); return values[0] ?? null; },
  };
  function rows() {
    const values = source().filter((row) => predicates.every((predicate) => predicate(row)));
    return descending ? [...values].reverse() : [...values];
  }
  return chain;
}
