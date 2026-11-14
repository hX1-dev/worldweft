# Worldweft Reference Client

This Godot project exercises the Convex runtime through an authenticated
bridge: read a region, inspect a resident, submit an action, and read back its
result and history. The application starts at `scenes/Main.tscn`; Qinglan is
the spatial integration fixture.

## Setup

Use **Godot 4.3+**; the published verification baseline uses 4.7. Open
`project.godot` after supplying these variables to the Godot process:

| Variable | Purpose |
| --- | --- |
| `GODOT_BRIDGE_URL` | The configured Convex HTTP action origin. |
| `GODOT_BRIDGE_TOKEN` | A player credential bound to the intended world and actor. |
| `GODOT_BRIDGE_DEBUG_TOKEN` | Optional separate credential for an authorized debug session. |

The backend must already contain a seeded reference world and matching bridge
configuration. A one-command fresh-world bootstrap is pending. Follow
[Getting started](../docs/GETTING_STARTED.md#4-use-the-connected-reference-client)
and the [runbook](PRODUCTION_RUNBOOK.md#local-startup) for connection checks.

## Current Scope

- Player movement, collision, semantic locations, and route preview.
- Resident selection and permitted actor context.
- Capability-driven action selection and authoritative results.
- Event bubbles, trace references, and authorized history inspection.
- Contract and windowed-verification tooling.

The richer `humanLifeV1` rules and player dialogue run in separate labs.
`ConvexBridge.gd` includes timed-body transport wrappers, but `Main.gd` does
not yet consume the movement/action-execution goals in the public client loop.
See [Implementation status](../docs/STATUS.md) for those boundaries.

## Relevant Files

| Path | Responsibility |
| --- | --- |
| [`scripts/Main.gd`](scripts/Main.gd) | Main client orchestration. |
| [`scripts/ConvexBridge.gd`](scripts/ConvexBridge.gd) | HTTP transport and bridge response handling. |
| [`scripts/PlayerController.gd`](scripts/PlayerController.gd) | Player input and movement. |
| [`scripts/WorldStateStore.gd`](scripts/WorldStateStore.gd) | Client-side read state. |
| [`scripts/ResidentRenderer.gd`](scripts/ResidentRenderer.gd) | Resident presentation. |
| [`scripts/TraceState.gd`](scripts/TraceState.gd) | Inspection and trace state. |
| [`tools/`](tools) | Contracts, connected checks, simulations, and the dialogue lab. |

## Verification

From the repository root, in PowerShell:

```powershell
$env:GODOT_BIN = 'C:\Tools\Godot\Godot.exe'
npm run godot:check-core
```

Or in Bash:

```bash
GODOT_BIN="/path/to/Godot" npm run godot:check-core
```

Replace the example path with your installed executable. This includes source,
static, soak-policy, unit, and headless Godot contract checks.
[Bridge tests](BRIDGE_TESTS.md) describe the contracts and negative cases.
The [runbook](PRODUCTION_RUNBOOK.md) describes connected smoke, soak, and
windowed evidence. [HARDENING_PLAN.md](HARDENING_PLAN.md) preserves historical
gate details; current public scope is maintained in the root docs.
