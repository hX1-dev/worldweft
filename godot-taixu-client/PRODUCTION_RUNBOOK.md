# Godot Taixu Production Runbook

Last reviewed: 2026-07-10.

This runbook owns release and incident procedures for the Convex xianxia
backend plus the new Godot Taixu client. It does not include the old Web/Pixi
client, old Godot prototypes, external engine source, or map-production tools.

## Authority Invariants

- Convex is the only durable world fact and rule authority.
- Godot submits semantic actions and displays Convex results. It never writes
  profiles, inventory, relationships, memories, events, or action records.
- Agent/LLM output is intent or display polish only. It cannot bypass
  `submitAction` or write durable tables.
- Every durable result has a linked `actionRecord` and `worldEvent`.
  Non-durable observations are explicitly `tickOnly`.
- Spatial and semantic-location preconditions are revalidated in the final
  rule mutation; a read-only preparation snapshot is never sufficient by
  itself.
- Player reads are viewer-safe. Private NPC memories and unrestricted replay
  are debug/admin data, not part of the production player projection.
- Only one world/map tick lease may advance global systems at a time.
- `durableSummary`, ids, result codes, facts, and effects are locked. Optional
  presentation polish can change display fields only.

Stop a release if any of these statements is not proven by the current gate.

## Environment Profiles

Production Convex deployment:

```text
GODOT_BRIDGE_WORLD_ID       required, exact deployed world id
GODOT_BRIDGE_ACTOR_ID       optional, defaults to godot_player
GODOT_BRIDGE_TOKEN          required, at least 32 non-whitespace characters
GODOT_BRIDGE_ALLOWED_ORIGINS optional exact browser origins; never use *
GODOT_BRIDGE_DEBUG_ENABLED  false or absent
GODOT_BRIDGE_DEBUG_TOKEN    absent
```

Production Godot process:

```text
GODOT_BRIDGE_URL            deployed Convex HTTP action origin
GODOT_BRIDGE_TOKEN          player credential only
GODOT_BRIDGE_DEBUG_TOKEN    absent
```

Local release verification additionally enables a separate debug credential:

```text
GODOT_BRIDGE_DEBUG_ENABLED=true
GODOT_BRIDGE_DEBUG_TOKEN=<different local-only token>
```

Never commit, print, persist in Godot resources, or write either token into a
durable Convex table. Debug access is omitted in production, not merely hidden
by the UI.

## Local Startup

1. Start the existing local Convex deployment:

```bash
npm run dev:backend
```

Keep this watcher running while testing. `npx convex codegen` validates and
generates bindings but does not replace runtime synchronization. Before a live
bridge gate, confirm the watcher has printed `Convex functions ready!`; if an
orphaned `convex-local-backend` owns port 3210, stop it and restart this
project's watcher rather than testing an old function bundle.

2. Check the public non-secret health summary:

```bash
curl http://127.0.0.1:3211/godot
```

Expected conditions:

- `ok: true`
- `contractVersion: godot_bridge_v1`
- `hardeningVersions.spatialAdjudication/viewerProjection/tickLease/memoryFanoutJob/durableSchema: 1`
- `security.configured: true`
- production profile: `security.debugEnabled: false`

3. Start Godot with credentials supplied through the process environment. Do
not add credentials to `project.godot` or a scene/resource file.

## Automated Release Gate

Run from the repository root:

```bash
npm run godot:check-production
```

The gate intentionally fails unless the real repository contains one clean,
committed 161-file release unit. It then runs:

1. real-worktree release-source gate;
2. full-local isolated snapshot with codegen stability, strict static checks,
   the current focused unit suite, Godot import/contracts, authenticated bridge smoke, and
   short soak;
3. 24-tick long soak with positive memory and relationship gates;
4. Qinglan mask audit;
5. whitespace and final release-source checks.

The smoke and soak use restricted `godot_smoke_*` fixtures and preserve real
durable action/event traces while cleaning temporary profiles, relationships,
memories, and requests.

## Manual Client Gate

Run the repeatable connected window harness first:

```bash
npm run godot:check-live-ui
```

It requires local player/debug credentials in the process environment and
captures exact 1024 x 720 and 1440 x 900 PNGs under the reported temporary
artifact directory. It performs live resident selection, actor context,
capability/replay loading, debug tick, and trace checks. A release owner should
still inspect both images before shipping.

Before release, run the connected Godot client at logical 1024 x 720 and
1440 x 900 and record current evidence for:

- region load, readable Chinese names, and no blank map;
- no overlap or horizontal overflow in the right operations sidebar;
- player movement, collision, location entry, and formal arrive;
- resident selection and stale-selection rejection;
- one enabled semantic action and one disabled/risk-confirmed action;
- tick -> event/tickOnly -> actionRecord -> replay chain;
- production process without a debug token: no Tick, Auto Tick, or trace panel;
- repeated command/retry behavior: one idempotent durable lifecycle.

Headless contracts are necessary but do not replace this gate.

Production release additionally requires focused negative evidence that:

- state changed after action preparation cannot be settled under stale
  map/location facts;
- player credentials cannot read another actor's private memories or hidden
  events, while local debug credentials retain the audited inspection path;
- overlapping ticks return an explicit lease-busy result instead of advancing
  global systems twice;
- a 120-profile scale fixture and interleaved fanout cleanup stay within bounded
  operations and leave no artificial memory rows.

## Failure Triage

`401 bridge_auth_required` or `bridge_auth_invalid`:

- verify the process received the intended token;
- verify the Convex deployment owns the same token;
- rotate or correct configuration; never open an unauthenticated fallback.

`403 bridge_world_forbidden`, `bridge_actor_forbidden`, or
`bridge_scope_forbidden`:

- verify exact world/actor binding and that a player token is not being used
  for debug tick;
- do not let Godot override server-derived actor/source claims.

`409 action_idempotency_conflict`:

- the client reused one `clientActionId` for different semantics;
- preserve the original key only for an exact retry, and generate a new key
  only for a genuinely new player command.

Contract or pagination validation failure:

- compare `contractVersion`, route shape, and continuation metadata;
- JSON integral numbers may arrive as GDScript floats, but fractional limits,
  counts, and offsets remain invalid;
- update server and client validators together before changing the version.

Trace gap or missing readback:

- start from `actionRecordId`/`worldEventId` in the action or tick response;
- query actionRecord, regionState, actorContext, and replay;
- do not synthesize a replacement event in Godot;
- a no-durable-action tick must remain `tickOnly`.

Soak timeout, response budget, scheduler coverage, or fanout failure:

- keep the failing request label and bounded counters;
- inspect the Convex-owned scheduler cursor and memory fanout pages;
- do not weaken positive social-delta or bounded-artifact gates to pass.

Stale spatial result or unexpected target-presence success:

- compare `preparedAt`, current actor/target map and location, and the linked
  action/event location;
- stop player writes until final-mutation validation is restored;
- do not repair the incident by changing Godot presentation or deleting audit
  rows.

Viewer visibility or private-memory disclosure:

- disable the affected player read route or switch it to the safe projection;
- keep debug credentials disabled in production;
- preserve durable rows for audit and fix authorization at the read-model
  boundary.

Tick lease contention:

- inspect the active world/map lease, tick id, owner, and expiry;
- allow expiry-based recovery for an abandoned lease;
- never bypass the lease by invoking global tick mutations directly.

## Rollback

- Disable debug access first if tick/fixture exposure is suspected.
- Roll back backend and client code as one contract-compatible release unit.
- Keep `actionRecords`, `worldEvents`, relationships, and memories intact for
  audit. Do not repair a client regression by deleting durable history.
- Re-run the authenticated bridge smoke against the rollback before reopening
  player access.
- Record any schema/data migration separately; this runbook does not authorize
  destructive table resets in production.

## Current Release Blocks

- Real Git release source is not yet versioned: 132 of 161 release files are
  currently untracked. Staging/commit requires explicit repository-owner
  authorization.
- H7 is closed with mutation-time spatial checks, viewer-safe reads, bounded
  world loops, tick lease, fanout lifecycle, versioned durable schema, 24-tick
  soak, and exact two-size windowed evidence.
- H8 technical evidence is green but final status is blocked until the real
  release-source unit is deliberately versioned with repository-owner approval.
