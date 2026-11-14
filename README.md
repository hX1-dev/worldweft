<p align="center">
  <img src="docs/worldweft-cover.png" alt="Worldweft — worlds that live on their own; a miniature inhabited landscape woven from fabric" width="100%">
</p>

<p align="center">
  English &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a> &nbsp;·&nbsp;
  <a href="docs/README.md">Documentation</a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> &nbsp;·&nbsp;
  <a href="#architecture">Architecture</a> &nbsp;·&nbsp;
  <a href="docs/STATUS.md">Implementation status</a> &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Worldweft is an open-source runtime for persistent NPC worlds, built with
**Godot and Convex**. Residents act through shared world rules. Their actions
can change inventories, relationships, memories, and history, with consequences
that remain traceable after the moment has passed.

The core idea is simple: **agents propose, the world decides**. Godot brings
the world to the screen; Convex validates actions and records what happened.
Models can contribute intent or dialogue through that same boundary.

> **Alpha reference implementation.** The Convex–Godot action loop is
> implemented. Richer resident life runs in an offline simulation, and player
> dialogue runs in a separate local lab. Connecting these layers to the live
> client is the next integration step. See [implementation status](docs/STATUS.md)
> for the boundary between working code and planned gameplay.

## In-Game Preview

https://github.com/user-attachments/assets/dfa4b1da-d848-4f2d-9f14-d53d345a0b3d

Real-time development footage from our xianxia simulator, showing the current
HD-2D visuals and exploration. The Qinglan reference client separately exercises
the runtime's actions, spatial rules, and history readback.

## What You Can Build On

- **A consistent world.** Actions pass through identity, presence, capability,
  and rule checks before they change persistent state.
- **Residents with continuity.** Rule-driven turns, goals, resources,
  relationships, and memories provide a foundation for lives beyond a single
  conversation.
- **Grounded interaction.** The dialogue lab uses personality and world facts;
  rules govern affinity and memory, while model-written lines are checked.
- **Inspectable consequences.** Action records, world events, and replay views
  make it possible to follow a decision through to its outcome.

### Where Each Part Runs Today

| Layer | Current scope |
| --- | --- |
| World rules and Godot bridge | Implemented: authenticated actions, state reads, spatial checks, and replay. |
| Autonomous NPC turns | Implemented: bounded, map-scoped scheduling and rules-first decisions. Automatic ticking requires opt-in. |
| Rich resident life | Offline simulation: sleep, daily focus, leisure, gifts, debts, quarrels, apologies, rumours, and reputation. |
| Player dialogue | Local lab: conversation limits, player memory, affinity, and checked model replies. |
| Timed movement and actions | Backend goals/report interfaces exist; the reference client integration is pending. |
| Proximity-based AI and shared player worlds | Planned: distance-based model activation, cross-player trading, delayed chat, and shared news. |

[Detailed capability map and source evidence →](docs/STATUS.md)

## Architecture

![Worldweft runtime architecture: clients and resident turns submit actions to Convex; rules settle durable facts and return read models](docs/architecture.svg)

| Part | Responsibility |
| --- | --- |
| **Godot** | Movement, collision, input, animation, and presentation. |
| **NPC decision layer** | Observe the world and propose an allowed action. Rules drive the default path; optional model routes are gated. |
| **Convex** | Validate, adjudicate, and persist world facts. |
| **History and read models** | Expose permitted state, linked outcomes, and replay without granting write authority. |

A gift becomes an inventory transfer only when the world rules accept it.
A line of dialogue cannot create an item or rewrite a relationship on its own.
Retries retain the same action identity so they do not apply the result twice.

The [architecture guide](ARCHITECTURE.md) covers the action lifecycle, NPC
scheduler, dialogue pipeline, runtime switches, HTTP surfaces, and the proposed
shared-world extension.

## Quick Start

Use **Node.js 24** for the documented baseline. The package supports Node 20–24.
The dialogue lab needs neither Godot nor a running Convex deployment.

```bash
git clone https://github.com/hX1-dev/worldweft.git
cd worldweft
npm ci
npm run dialogue:chat -- --dry
```

Open **http://127.0.0.1:8766**. On the first run, the tool generates a rule-driven
world log; allow about a minute before the page becomes available.

Dry mode exercises the conversation rules, memory, and affinity without model
calls. Lines that require a model appear as placeholders. To use generated
replies, supply `XIANXIA_PI_NPC_DEEPSEEK_API_KEY` in the process environment and
run `npm run dialogue:chat` without `--dry`.

For the connected Godot client, use [Getting started](docs/GETTING_STARTED.md).
It explains the deployment and seeded-world prerequisites as well as the local
lab; a clean checkout does not yet bootstrap a connected world in one command.

## Verification

[![Verify](https://github.com/hX1-dev/worldweft/actions/workflows/verify.yml/badge.svg)](https://github.com/hX1-dev/worldweft/actions/workflows/verify.yml)

The checks cover rule behavior, authority boundaries, dialogue, and repeatable
simulation trajectories. The life and dialogue checks below do not call a model.

| Command | Checks |
| --- | --- |
| `npm run godot:check-core` | Source boundary, types, lint, focused unit tests, and headless Godot contracts. |
| `npm run life:check-baseline` | All 15 fixed simulation trajectories; `-- --quick` runs the five s1 cases. |
| `npm run dialogue:check-memory` | What residents retain from player conversations. |
| `npm run dialogue:check-affinity` | Relationship changes, apologies, and conversation reactions. |

The core gate requires **Godot 4.3+**; the published engine baseline is 4.7.
Core and dialogue commands work in PowerShell and POSIX shells. Set `GODOT_BIN`
to the executable using the [examples for your shell](docs/GETTING_STARTED.md#3-run-the-checks).

CI runs source, static, soak-policy, and unit checks on Linux and Windows,
plus simulation and dialogue checks on Linux. Connected backend and windowed
Godot checks remain separate verification steps; see the
[runbook](godot-taixu-client/PRODUCTION_RUNBOOK.md).

Design evidence includes the [rules/model comparison](docs/ab-rules-vs-deepseek-2026-10-21.md),
[resident-life standard](docs/NPC人性过关标准.md), and
[dialogue standard](docs/玩家对话过关标准.md). These are scoped development
experiments; the planned blind human rating has not yet been completed.

## Roadmap

1. Connect the richer life rules and player dialogue to the live Godot loop.
2. Integrate timed movement/action goals and publish a repeatable playable demo.
3. Add a neutral example world and clearer world-pack boundaries.
4. Explore proximity-based model activation and asynchronous connections
   between player worlds: equipment trading, delayed chat, and shared news.

These are development directions. The [status page](docs/STATUS.md) records what
is currently implemented, experimentally verified, and still planned.

## Explore The Repository

| Path | What is there |
| --- | --- |
| [`convex/`](convex) | World rules, bridge, durable state, NPC runtime, and tests. |
| [`godot-taixu-client/`](godot-taixu-client) | Reference client, contract checks, dialogue tools, and simulations. |
| [`data/`](data) | Reference-world definitions and spatial fixtures. |
| [Documentation index](docs/README.md) | Getting started, capability status, and evaluation reports. |

Start with [Getting started](docs/GETTING_STARTED.md),
[Architecture](ARCHITECTURE.md), or [Implementation status](docs/STATUS.md).
For changes, read [Contributing](CONTRIBUTING.md). Questions belong in
[Discussions](https://github.com/hX1-dev/worldweft/discussions); reproducible bugs
belong in [Issues](https://github.com/hX1-dev/worldweft/issues).

## Origins And License

Worldweft builds on lessons and selected MIT-licensed code from
[AI Town](https://github.com/a16z-infra/ai-town), and takes inspiration from
the Godot-native multi-agent direction of
[Microverse](https://github.com/KsanaDock/Microverse).
See [Positioning](POSITIONING.md) for the design direction and
[Compatibility](COMPATIBILITY.md) for retained backend modules.

Released under the [MIT License](LICENSE). Third-party attribution, font
licenses, and reference-fixture notes are recorded in [NOTICE.md](NOTICE.md).
Cover artwork and the editable diagram are documented in [Brand assets](docs/brand/README.md).
Release work is tracked in the [readiness checklist](OPEN_SOURCE_CHECKLIST.md).
