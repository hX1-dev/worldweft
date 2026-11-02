import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { MAX_HEALTH } from './lifeStateLogic';
import { stableObservationDigest } from './lifeObservation';
import {
  cancelSocialInvitationTx,
  createSocialInvitationTx,
  linkSocialInvitationConversationTx,
  linkSocialInvitationGoalTx,
  respondToSocialInvitationTx,
} from './socialInvitations';
import { SOCIAL_WARRANT_VERSION, type SocialWarrant } from './socialWarrantContracts';

const WORLD_ID = 'world:invitation' as Id<'worlds'>;
const NOW = 10_000;

type InvitationFixture = {
  ctx: MutationCtx;
  table: (name: string) => MemoryDoc[];
  patchActor: (actorId: string, value: Record<string, unknown>) => void;
};

function bodyWarrant(health = 4): SocialWarrant {
  return {
    contractVersion: SOCIAL_WARRANT_VERSION,
    warrantId: 'warrant:body:hanli',
    actorId: 'hanli',
    kind: 'care_or_aid',
    sourceRef: 'body:hanli',
    sourceRevision: `body:${stableObservationDigest({
      health,
      maxHealth: MAX_HEALTH,
      hasHealingItem: false,
    })}`,
    intendedOutcome: 'request_aid',
    eligibleTargetActorIds: ['liu_qiaoer'],
    topicRefs: ['body:health:hanli'],
    audience: 'private',
    urgencyBand: 'important',
    createdAt: 0,
    expiresAt: 1_000,
  };
}

describe('C021b0c social invitation transactions', () => {
  test('server selects target location, persists once and acceptance reserves it', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    expect(created).toMatchObject({
      ok: true,
      replay: false,
      receipt: { status: 'pending', meetingLocationId: 'alchemy_room', revision: 1 },
    });
    const replay = await createSocialInvitationTx(fixture.ctx, createArgs());
    expect(replay).toMatchObject({ ok: true, replay: true, receipt: { revision: 1 } });
    if (!created.ok) throw new Error('expected invitation');
    const accepted = await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'accept',
      now: NOW + 1,
    });
    expect(accepted).toMatchObject({ ok: true, replay: false, receipt: { status: 'accepted', revision: 2 } });
    expect(fixture.table('socialInvitations')).toHaveLength(1);
  });

  test('decline is terminal and never creates goal or conversation links', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    const declined = await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'decline',
      now: NOW + 1,
    });
    expect(declined).toMatchObject({ ok: true, receipt: { status: 'declined', revision: 2 } });
    await expect(linkSocialInvitationGoalTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      personalGoalId: 'goal:forbidden',
      now: NOW + 2,
    })).resolves.toEqual({ ok: false, reasonCode: 'social_invitation_not_pending' });
  });

  test('target movement before accept cancels rather than retargeting or chasing', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    fixture.patchActor('liu_qiaoer', { currentLocationId: 'quiet_retreat' });
    const result = await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'accept',
      now: NOW + 1,
    });
    expect(result).toEqual({ ok: false, reasonCode: 'social_invitation_target_moved' });
    expect(fixture.table('socialInvitations')[0]).toMatchObject({
      status: 'cancelled',
      revision: 2,
      terminalReasonCode: 'social_invitation_target_moved',
      personalGoalId: undefined,
    });
  });

  test('accepted receipt links exactly one goal and one conversation', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    const accepted = await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'accept',
      now: NOW + 1,
    });
    if (!accepted.ok) throw new Error('expected accepted');
    const goal = await linkSocialInvitationGoalTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      personalGoalId: 'personal_goal:hanli:1',
      now: NOW + 2,
    });
    expect(goal).toMatchObject({ ok: true, replay: false });
    expect(await linkSocialInvitationGoalTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      personalGoalId: 'personal_goal:hanli:1',
      now: NOW + 3,
    })).toMatchObject({ ok: true, replay: true });
    expect(await linkSocialInvitationGoalTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      personalGoalId: 'personal_goal:hanli:2',
      now: NOW + 3,
    })).toEqual({ ok: false, reasonCode: 'social_invitation_terminal_replay' });
    expect(await linkSocialInvitationConversationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      conversationId: 'conversation:1',
      now: NOW + 4,
    })).toMatchObject({ ok: true, replay: false });
  });

  test('explicit cancellation is idempotent and releases the active chain', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    const cancelled = await cancelSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 1,
      reasonCode: 'social_invitation_lease_expired',
      now: NOW + 1,
    });
    expect(cancelled).toMatchObject({
      ok: true,
      replay: false,
      receipt: { status: 'cancelled', terminalReasonCode: 'social_invitation_lease_expired' },
    });
    expect(await cancelSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      reasonCode: 'social_invitation_lease_expired',
      now: NOW + 2,
    })).toMatchObject({ ok: true, replay: true });
  });

  test('movement failure cancels an already accepted receipt exactly once', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    const accepted = await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'accept',
      now: NOW + 1,
    });
    if (!accepted.ok) throw new Error('expected accepted');
    expect(await cancelSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      actorId: 'hanli',
      expectedRevision: 2,
      reasonCode: 'social_invitation_movement_blocked',
      now: NOW + 2,
    })).toMatchObject({
      ok: true,
      replay: false,
      receipt: { status: 'cancelled', revision: 3 },
    });
  });

  test.each([
    ['incapacitated', (fixture: InvitationFixture): void => {
      fixture.patchActor('liu_qiaoer', { health: 0 });
    }, 'social_invitation_target_unavailable'],
    ['deceased', (fixture: InvitationFixture): void => {
      fixture.patchActor('liu_qiaoer', { lifeStatus: 'deceased' });
    }, 'social_invitation_target_unavailable'],
    ['busy', (fixture: InvitationFixture): void => {
      fixture.table('actionExecutions').push(doc('execution:busy', {
        worldId: WORLD_ID,
        actorId: 'liu_qiaoer',
        status: 'acting',
        expiresAt: NOW + 60_000,
        hardDeadlineAt: NOW + 60_000,
      }));
    }, 'social_invitation_target_busy'],
    ['capacity full', (fixture: InvitationFixture): void => {
      for (const index of [1, 2]) {
        fixture.table('socialInvitations').push(doc(`invitation:other:${index}`, {
          worldId: WORLD_ID,
          invitationId: `other:${index}`,
          meetingMapId: 'world',
          meetingLocationId: 'alchemy_room',
          status: 'accepted',
          reservedCapacity: 2,
        }));
      }
    }, 'social_invitation_capacity_full'],
  ] as const)('accept cancels when target is %s', async (_label, mutate, reasonCode) => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    mutate(fixture);
    expect(await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'accept',
      now: NOW + 1,
    })).toEqual({ ok: false, reasonCode });
    expect(fixture.table('socialInvitations').find(
      (row) => row.invitationId === created.receipt.invitationId,
    )).toMatchObject({ status: 'cancelled', terminalReasonCode: reasonCode });
  });

  test('wall-clock expiry terminalizes pending and never starts travel', async () => {
    const fixture = memoryFixture();
    const created = await createSocialInvitationTx(fixture.ctx, createArgs());
    if (!created.ok) throw new Error('expected invitation');
    expect(await respondToSocialInvitationTx(fixture.ctx, {
      worldId: WORLD_ID,
      invitationId: created.receipt.invitationId,
      targetActorId: 'liu_qiaoer',
      expectedRevision: 1,
      response: 'accept',
      now: created.receipt.expiresAt,
    })).toEqual({ ok: false, reasonCode: 'social_invitation_expired' });
    expect(fixture.table('socialInvitations')[0]).toMatchObject({
      status: 'expired',
      personalGoalId: undefined,
      conversationId: undefined,
    });
  });
});

function createArgs() {
  return {
    worldId: WORLD_ID,
    actorId: 'hanli',
    targetActorId: 'liu_qiaoer',
    warrant: bodyWarrant(),
    candidateId: 'candidate:remote-aid',
    intendedActivity: 'talk' as const,
    summary: '邀请柳巧儿在丹房商谈疗伤',
    now: NOW,
  };
}

type MemoryDoc = Record<string, any> & { _id: string; _creationTime: number };

function memoryFixture(): InvitationFixture {
  let serial = 100;
  const tables: Record<string, MemoryDoc[]> = {
    xianxiaProfiles: [
      doc('profile:hanli', {
        worldId: WORLD_ID,
        actorId: 'hanli',
        name: '韩立',
        role: 'outer_disciple',
        realm: 'qi_refining',
        realmStage: 1,
        cultivationXp: 0,
        mood: 50,
        health: 4,
        maxHealth: MAX_HEALTH,
        spirit: 10,
        reputation: 0,
        currentLocationId: 'quiet_retreat',
        mapId: 'world',
        inventory: [],
      }),
      doc('profile:liu', {
        worldId: WORLD_ID,
        actorId: 'liu_qiaoer',
        name: '柳巧儿',
        role: 'herbalist',
        realm: 'qi_refining',
        realmStage: 1,
        cultivationXp: 0,
        mood: 50,
        health: 10,
        maxHealth: MAX_HEALTH,
        spirit: 10,
        reputation: 0,
        currentLocationId: 'alchemy_room',
        mapId: 'world',
        inventory: [],
      }),
    ],
    locations: [
      doc('location:quiet', {
        worldId: WORLD_ID,
        locationId: 'quiet_retreat',
        name: '静修处',
        kind: 'retreat',
        dangerLevel: 0,
        spiritualEnergy: 2,
        allowedActions: ['talk'],
        mapId: 'world',
        entryPoints: [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      }),
      doc('location:alchemy', {
        worldId: WORLD_ID,
        locationId: 'alchemy_room',
        name: '丹房',
        kind: 'alchemy_room',
        dangerLevel: 0,
        spiritualEnergy: 2,
        allowedActions: ['talk'],
        mapId: 'world',
        entryPoints: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }],
      }),
    ],
    socialInvitations: [],
    conversationSessions: [],
    actionExecutions: [],
    groupConversationMemberships: [],
    actorBeliefs: [],
    relationships: [],
    requests: [],
    worldEvents: [],
  };

  const db = {
    query(table: string) {
      return queryBuilder(() => tables[table] ?? []);
    },
    async insert(table: string, value: Record<string, unknown>) {
      const row = doc(`${table}:${serial++}`, value);
      (tables[table] ??= []).push(row);
      return row._id;
    },
    async patch(id: string, value: Record<string, unknown>) {
      for (const rows of Object.values(tables)) {
        const row = rows.find((entry) => entry._id === id);
        if (row) Object.assign(row, value);
      }
    },
    async get(id: string) {
      return Object.values(tables).flat().find((entry) => entry._id === id) ?? null;
    },
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
        callback(q);
        predicates.push((row) => conditions.every(([field, value]) => row[field] === value));
      }
      return chain;
    },
    filter(callback: (q: any) => any) {
      const q = {
        field(name: string) { return { field: name }; },
        eq(left: { field: string }, right: unknown) { return { kind: 'eq', field: left.field, right }; },
      };
      const expression = callback(q);
      if (expression?.kind === 'eq') {
        predicates.push((row) => row[expression.field] === expression.right);
      }
      return chain;
    },
    order(value: string) { descending = value === 'desc'; return chain; },
    async collect() { return rows(); },
    async take(limit: number) { return rows().slice(0, limit); },
    async first() { return rows()[0] ?? null; },
    async unique() {
      const values = rows();
      if (values.length > 1) throw new Error('not_unique');
      return values[0] ?? null;
    },
  };
  function rows() {
    const result = source().filter((row) => predicates.every((predicate) => predicate(row)));
    return descending ? [...result].reverse() : [...result];
  }
  return chain;
}
