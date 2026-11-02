import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { ensureIncapacitationRecovery } from './actions';
import { INCAPACITATED_RECOVERY_DELAY_MS } from './lifeStateLogic';
import {
  applyValleyMovementReport,
  createValleyMovementCommand,
  prepareValleyMovementGoals,
} from './valleyMovement';
import { QINGLAN_VALLEY_GATE_MAP_ID } from './valleyMovementContracts';

const WORLD_ID = 'world' as Id<'worlds'>;
const ACTOR_ID = `${QINGLAN_VALLEY_GATE_MAP_ID}:resting_disciple`;
const COMMAND_ID = 'command' as Id<'movementCommands'>;
const ACTION_ID = 'action' as Id<'actionRecords'>;
const NOW = 50_000;

describe('valley movement incapacitation boundary', () => {
  test('goal polling cancels an active command and exposes one explicit cancellation', async () => {
    const fixture = movementFixture({ health: 0, commandStatus: 'moving' });

    const first = await prepareValleyMovementGoals(fixture.ctx, {
      worldId: WORLD_ID,
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      now: NOW,
    });

    expect(first.goals).toEqual([]);
    expect(first.cancellations).toEqual([
      {
        commandId: COMMAND_ID,
        revision: 1,
        actorId: ACTOR_ID,
        mapId: QINGLAN_VALLEY_GATE_MAP_ID,
        reasonCode: 'actor_incapacitated',
        cancelledAt: NOW,
      },
    ]);
    expect(fixture.command()).toMatchObject({
      status: 'cancelled',
      reasonCode: 'actor_incapacitated',
      lastTile: { x: 4, y: 18 },
    });
    expect(fixture.resident()).toMatchObject({
      status: 'incapacitated',
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
    });
    expect(fixture.events()).toHaveLength(1);

    const repeated = await prepareValleyMovementGoals(fixture.ctx, {
      worldId: WORLD_ID,
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      now: NOW + 100,
    });
    expect(repeated.goals).toEqual([]);
    expect(repeated.cancellations).toHaveLength(1);
    expect(fixture.events()).toHaveLength(1);
  });

  test('a report cannot move an incapacitated actor and later reports see a terminal command', async () => {
    const fixture = movementFixture({ health: 0, commandStatus: 'accepted' });
    const report = {
      worldId: WORLD_ID,
      commandId: COMMAND_ID,
      revision: 1,
      actorId: ACTOR_ID,
      status: 'moving' as const,
      positionTiles: { x: 5, y: 18 },
      reportedAt: NOW,
      now: NOW,
    };

    await expect(applyValleyMovementReport(fixture.ctx, report)).resolves.toMatchObject({
      ok: false,
      code: 'actor_incapacitated',
    });
    expect(fixture.command()).toMatchObject({
      status: 'cancelled',
      lastTile: { x: 4, y: 18 },
    });
    expect(fixture.command().lastReportedAt).toBeUndefined();
    expect(fixture.resident().displayTile).toEqual({ x: 4, y: 18 });
    expect(fixture.events()).toHaveLength(1);

    await expect(
      applyValleyMovementReport(fixture.ctx, { ...report, now: NOW + 100 }),
    ).resolves.toMatchObject({ ok: false, code: 'command_terminal' });
    expect(fixture.command().lastTile).toEqual({ x: 4, y: 18 });
    expect(fixture.events()).toHaveLength(1);
  });

  test('an expired movement lease writes one auditable terminal event', async () => {
    const fixture = movementFixture({
      health: 10,
      commandStatus: 'moving',
      expiresAt: NOW - 1,
    });

    await expect(
      applyValleyMovementReport(fixture.ctx, {
        worldId: WORLD_ID,
        commandId: COMMAND_ID,
        revision: 1,
        actorId: ACTOR_ID,
        status: 'moving',
        positionTiles: { x: 5, y: 18 },
        reportedAt: NOW,
        now: NOW,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'command_expired',
    });
    expect(fixture.command()).toMatchObject({
      status: 'expired',
      reasonCode: 'lease_expired',
    });
    expect(fixture.resident()).toMatchObject({
      status: 'idle',
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
    });
    expect(fixture.events()).toHaveLength(1);
    expect(fixture.events()[0]).toMatchObject({
      type: 'movement_cancelled',
      actionId: ACTION_ID,
      facts: {
        resultCode: 'lease_expired',
      },
    });

    await expect(
      applyValleyMovementReport(fixture.ctx, {
        worldId: WORLD_ID,
        commandId: COMMAND_ID,
        revision: 1,
        actorId: ACTOR_ID,
        status: 'moving',
        positionTiles: { x: 5, y: 18 },
        reportedAt: NOW + 1,
        now: NOW + 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      code: 'command_terminal',
    });
    expect(fixture.events()).toHaveLength(1);
  });

  test('direct movement command creation fails closed at zero health', async () => {
    const fixture = movementFixture({ health: 0, includeCommand: false });

    await expect(
      createValleyMovementCommand(fixture.ctx, {
        worldId: WORLD_ID,
        actionRecordId: ACTION_ID,
        actorId: ACTOR_ID,
        intent: '前往溪谷西口。',
        decisionSource: 'test',
        requestedTarget: { kind: 'location', locationId: 'valley_west_entry' },
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: false, reasonCode: 'actor_incapacitated' });
    expect(fixture.table('movementCommands')).toEqual([]);
    expect(fixture.events()).toEqual([]);
  });

  test('healthy actors still receive their active goal', async () => {
    const fixture = movementFixture({ health: 1, commandStatus: 'accepted' });
    const result = await prepareValleyMovementGoals(fixture.ctx, {
      worldId: WORLD_ID,
      mapId: QINGLAN_VALLEY_GATE_MAP_ID,
      now: NOW,
    });

    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]).toMatchObject({ commandId: COMMAND_ID, revision: 1 });
    expect(result.cancellations).toEqual([]);
    expect(fixture.command().status).toBe('accepted');
  });

  test('arrival only confirms the body and never settles rest or gather needs', async () => {
    const herbActorId = `${QINGLAN_VALLEY_GATE_MAP_ID}:herb_gatherer`;
    const fixture = movementFixture({
      health: 10,
      actorId: herbActorId,
      commandStatus: 'accepted',
      initialTile: { x: 11, y: 10 },
      acceptedTile: { x: 11, y: 10 },
      resolvedLocationId: 'rest_clearing',
      fatigue: 80,
      herbNeed: 70,
      inventory: [],
    });

    await expect(
      applyValleyMovementReport(fixture.ctx, {
        worldId: WORLD_ID,
        commandId: COMMAND_ID,
        revision: 1,
        actorId: herbActorId,
        status: 'arrived',
        positionTiles: { x: 11, y: 10 },
        reportedAt: NOW,
        now: NOW,
      }),
    ).resolves.toMatchObject({ ok: true, status: 'arrived' });

    expect(fixture.profile()).toMatchObject({
      currentLocationId: 'rest_clearing',
      fatigue: 80,
      inventory: [],
    });
    expect(fixture.resident()).toMatchObject({
      currentLocationId: 'rest_clearing',
      fatigue: 80,
      herbNeed: 70,
    });
  });

  test('legacy zero-health rows are enrolled once without healing or resuming movement', async () => {
    const fixture = movementFixture({ health: 0, commandStatus: 'moving' });

    await expect(
      ensureIncapacitationRecovery(
        fixture.ctx,
        fixture.profile() as unknown as Doc<'xianxiaProfiles'>,
        NOW,
      ),
    ).resolves.toBe(true);

    expect(fixture.profile()).toMatchObject({
      health: 0,
      incapacitatedAt: NOW,
      recoveryEligibleAt: NOW + INCAPACITATED_RECOVERY_DELAY_MS,
      recoveryToken: 'worldEvents:1',
    });
    expect(fixture.command()).toMatchObject({
      status: 'cancelled',
      reasonCode: 'actor_incapacitated',
    });
    expect(fixture.resident()).toMatchObject({
      status: 'incapacitated',
      targetTile: undefined,
      finalTargetTile: undefined,
      pathTiles: undefined,
    });
    expect(fixture.events().map((event) => event.type)).toEqual([
      'actor_incapacitated',
      'movement_cancelled',
    ]);
    expect(fixture.scheduled()).toEqual([
      {
        at: NOW + INCAPACITATED_RECOVERY_DELAY_MS,
        args: {
          worldId: WORLD_ID,
          actorId: ACTOR_ID,
          recoveryToken: 'worldEvents:1',
        },
      },
    ]);

    await expect(
      ensureIncapacitationRecovery(
        fixture.ctx,
        fixture.profile() as unknown as Doc<'xianxiaProfiles'>,
        NOW + 1,
      ),
    ).resolves.toBe(false);
    expect(fixture.events()).toHaveLength(2);
    expect(fixture.scheduled()).toHaveLength(1);
    expect(fixture.profile().health).toBe(0);
  });
});

type MemoryDoc = Record<string, unknown> & { _id: string; _creationTime: number };

function movementFixture(input: {
  health: number;
  commandStatus?: 'pending' | 'accepted' | 'moving';
  includeCommand?: boolean;
  actorId?: string;
  initialTile?: { x: number; y: number };
  acceptedTile?: { x: number; y: number };
  resolvedLocationId?: string;
  fatigue?: number;
  herbNeed?: number;
  inventory?: { itemId: string; qty: number }[];
  expiresAt?: number;
}) {
  const actorId = input.actorId ?? ACTOR_ID;
  const initialTile = input.initialTile ?? { x: 4, y: 18 };
  const acceptedTile = input.acceptedTile ?? { x: 6, y: 18 };
  const tables: Record<string, MemoryDoc[]> = {
    actionExecutions: [],
    actionRecords: [
      {
        _id: ACTION_ID,
        _creationTime: 1,
        worldId: WORLD_ID,
        actorId,
        type: 'travel',
      },
    ],
    xianxiaProfiles: [
      {
        _id: 'profile',
        _creationTime: 1,
        worldId: WORLD_ID,
        actorId,
        name: actorId,
        mapId: QINGLAN_VALLEY_GATE_MAP_ID,
        currentLocationId: input.resolvedLocationId ? 'herb_meadow' : 'valley_west_entry',
        health: input.health,
        fatigue: input.fatigue,
        inventory: input.inventory ?? [],
      },
    ],
    qinglanResidents: [
      {
        _id: 'resident',
        _creationTime: 1,
        worldId: WORLD_ID,
        actorId,
        mapId: QINGLAN_VALLEY_GATE_MAP_ID,
        displayTile: initialTile,
        targetTile: acceptedTile,
        finalTargetTile: acceptedTile,
        pathTiles: [acceptedTile],
        status: input.commandStatus ?? 'accepted',
        currentLocationId: input.resolvedLocationId ? 'herb_meadow' : 'valley_west_entry',
        nextActionAt: NOW,
        fatigue: input.fatigue,
        herbNeed: input.herbNeed,
      },
    ],
    movementCommands:
      input.includeCommand === false
        ? []
        : [
            {
              _id: COMMAND_ID,
              _creationTime: 1,
              worldId: WORLD_ID,
              actionRecordId: ACTION_ID,
              revision: 1,
              actorId,
              mapId: QINGLAN_VALLEY_GATE_MAP_ID,
              intent: '前往目标。',
              decisionSource: 'test',
              requestedTarget: { kind: 'point', tile: acceptedTile },
              originTile: initialTile,
              acceptedTile,
              acceptedMaskType: 'walkable',
              resolvedLocationId: input.resolvedLocationId,
              status: input.commandStatus ?? 'accepted',
              lastTile: initialTile,
              issuedAt: NOW - 1_000,
              updatedAt: NOW - 1_000,
              expiresAt: input.expiresAt ?? NOW + 60_000,
            },
          ],
    playerDescriptions: [],
    worldEvents: [],
  };

  const scheduled: Array<{ at: number; args: Record<string, unknown> }> = [];

  const db = {
    get: async (id: string) =>
      Object.values(tables)
        .flat()
        .find((doc) => doc._id === id) ?? null,
    patch: async (id: string, patch: Record<string, unknown>) => {
      const doc = Object.values(tables)
        .flat()
        .find((entry) => entry._id === id);
      if (!doc) throw new Error(`Missing in-memory document ${id}.`);
      Object.assign(doc, patch);
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}:${tables[table].length + 1}`;
      tables[table].push({ _id: id, _creationTime: NOW, ...value });
      return id;
    },
    query: (table: string) => new MemoryQuery(tables[table] ?? []),
  };

  return {
    ctx: {
      db,
      scheduler: {
        runAt: async (at: number, _reference: unknown, args: Record<string, unknown>) => {
          scheduled.push({ at, args });
          return 'scheduled';
        },
      },
    } as unknown as MutationCtx,
    table: (name: string) => tables[name],
    command: () => tables.movementCommands[0],
    profile: () => tables.xianxiaProfiles[0],
    resident: () => tables.qinglanResidents[0],
    events: () => tables.worldEvents,
    scheduled: () => scheduled,
  };
}

class MemoryQuery {
  private readonly constraints: Array<(doc: MemoryDoc) => boolean> = [];
  private direction: 'asc' | 'desc' = 'asc';

  constructor(private readonly docs: MemoryDoc[]) {}

  withIndex(_name: string, build: (q: MemoryIndexBuilder) => unknown) {
    build(new MemoryIndexBuilder(this.constraints));
    return this;
  }

  filter(build: (q: MemoryFilterBuilder) => unknown) {
    build(new MemoryFilterBuilder(this.constraints));
    return this;
  }

  order(direction: 'asc' | 'desc') {
    this.direction = direction;
    return this;
  }

  async take(limit: number) {
    return this.rows().slice(0, limit);
  }

  async first() {
    return this.rows()[0] ?? null;
  }

  async unique() {
    const rows = this.rows();
    if (rows.length > 1) {
      throw new Error('MemoryQuery.unique matched more than one document.');
    }
    return rows[0] ?? null;
  }

  private rows() {
    const rows = this.docs.filter((doc) => this.constraints.every((test) => test(doc)));
    rows.sort((a, b) => {
      const aOrder = Number(a.revision ?? a.updatedAt ?? a._creationTime);
      const bOrder = Number(b.revision ?? b.updatedAt ?? b._creationTime);
      return this.direction === 'desc' ? bOrder - aOrder : aOrder - bOrder;
    });
    return rows;
  }
}

class MemoryIndexBuilder {
  constructor(private readonly constraints: Array<(doc: MemoryDoc) => boolean>) {}

  eq(field: string, value: unknown) {
    this.constraints.push((doc) => doc[field] === value);
    return this;
  }

  gte(field: string, value: number) {
    this.constraints.push((doc) => Number(doc[field]) >= value);
    return this;
  }
}

class MemoryFilterBuilder {
  constructor(private readonly constraints: Array<(doc: MemoryDoc) => boolean>) {}

  field(name: string) {
    return name;
  }

  eq(field: string, value: unknown) {
    this.constraints.push((doc) => doc[field] === value);
    return true;
  }
}
