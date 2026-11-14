# Implementation Status

Reviewed against the runtime in commit
[`19d2cb9`](https://github.com/hX1-dev/worldweft/commit/19d2cb9df59725e1a9f0e5884c820a79498d7069)
on **2026-11-13**. Documentation and presentation changes do not extend the
runtime capabilities listed here.

**Implemented** means a code path exists in the reference runtime. **Lab**
means it runs in a separate simulation or dialogue tool. **Partial** means
supporting code exists but the complete gameplay loop is unfinished.
**Planned** means a design direction rather than a shipped integration.
These labels describe development scope, not production certification.

## Runtime And Client

| Capability | Status | Current boundary and evidence |
| --- | --- | --- |
| Persistent rules and world state | Implemented | Convex owns adjudication, state changes, action records, and events. [Action pipeline](../convex/xianxia/actions.ts). |
| Godot interaction bridge | Implemented | Authenticated state, action, actor-context, and history surfaces. [HTTP routes](../convex/http.ts), [bridge contracts](../godot-taixu-client/BRIDGE_TESTS.md). |
| Formal player/NPC actions | Implemented | Conversation, gift, trade, sparring, teaching, cultivation, breakthrough, arrival, and exploration. These are semantic actions, not a complete progression system. [Bridge](../convex/godot.ts). |
| NPC decision turns | Implemented | Bounded, map-scoped round-robin selection; ordinary autonomous choices use rules by default. [Scheduler](../convex/xianxia/agentTickScheduler.ts), [decision path](../convex/xianxia/runtime/decision/proposeAndAct.ts). |
| Automatic background ticking | Implemented, opt-in | Requires the world switch and `XIANXIA_AUTO_TICK=1`. Missing configuration disables it; the demo seeder enables the world switch for a new configuration. [Policy](../convex/xianxia/agentTickSchedulerPolicy.ts), [seed](../convex/xianxia/seed.ts). |
| Autonomous growth | Implemented, opt-in | A separate growth system exists and defaults off. This does not establish a balanced world economy. [Configuration](../convex/xianxia/config.ts), [growth](../convex/xianxia/growth.ts). |
| Timed movement/action execution | Partial | Backend goals and reports exist. The reference client has not adopted those interfaces. [Bridge surfaces](../ARCHITECTURE.md#bridge-surfaces). |
| Replay and debugging | Implemented | Linked action records, events, and readback support inspection. Player and debug visibility differ. [Read model](../convex/godotReadModel.ts), [viewer policy](../convex/godotViewerPolicy.ts). |

## Resident Life And Interaction

| Capability | Status | Current boundary and evidence |
| --- | --- | --- |
| Personality, needs, and routines | Implemented foundation | Candidate selection uses current context and personality-related rules. [Decision logic](../convex/xianxia/autonomyDecisionTraceLogic.ts). |
| Sleep, daily focus, leisure, gifts, and debts | Lab | `humanLifeV1` enables these in the offline simulation; it is not wired into the live Godot tick. [Life rules](../convex/xianxia/humanLifeLogic.ts). |
| Quarrels, apologies, rumours, and reputation | Lab | Social behavior is exercised in the life simulation. [Society rules](../convex/xianxia/humanSocietyLogic.ts). |
| Player dialogue, memory, and affinity | Lab | A local browser tool reads a simulated world's log. Its conversation state is separate from live Godot integration. [Dialogue engine](../godot-taixu-client/tools/player_dialogue_engine.mjs). |
| Model-written dialogue | Lab, optional | Generated lines are checked, retried once when flagged, and replaced if still invalid. Dry mode uses placeholders for model-dependent lines. [Line checker](../godot-taixu-client/tools/player_dialogue_checks.mjs). |
| Model-selected intent | Optional paths | Deployment-gated routes exist alongside the rules-first default. The scheduler does not activate a model automatically based on player distance. [Decision path](../convex/xianxia/runtime/decision/proposeAndAct.ts). |
| Nearby AI / distant routine switching | Planned integration | Map scoping and rules-first turns are foundations. A complete player-radius activation and handoff system is not part of the current public loop. |
| NPC help and personal stories | Partial | Requests and formal actions provide building blocks. A general natural-language task system and broad hidden-story content remain game-level work. [Requests](../convex/xianxia/quests.ts). |

## World Events And Shared Player Worlds

| Design goal | Status | Current boundary |
| --- | --- | --- |
| Probabilistic outcomes and encounters | Partial | Seeded rule outcomes and exploration exist; a complete random-world narrative system remains future work. |
| Weather and environmental events | Partial | The opt-in director currently implements a bounded herb-miasma pressure with expiry and resource effects. A general weather system is not present. [Director](../convex/xianxia/worldDirector.ts). |
| Nation/kingdom simulation | Planned gameplay | Existing role, group, and world rules should not be described as a completed geopolitical simulation. |
| Equipment trading between player worlds | Planned | The existing `trade` action operates inside a world; it is not a cross-player marketplace or inventory synchronization service. |
| Delayed player-to-player chat | Planned | NPC conversation and legacy chat modules do not implement the proposed asynchronous player-world service. |
| Shared news from player activity | Planned | Local events and simulated rumours exist. Collecting player activity into a news feed shared by every player is a separate future system. |
| Shared projection/synchronization server | Planned | Current read-model projections serve a configured world. Cross-world synchronization, delivery, and import are not implemented by those projections. |

The intended direction is primarily single-player worlds with asynchronous
connections between players. See the
[proposed architecture](../ARCHITECTURE.md#planned-shared-world-extension).

## Verification And Next Milestones

Current [CI](https://github.com/hX1-dev/worldweft/actions/workflows/verify.yml)
runs source, type, lint, soak-policy, and unit checks on Linux and Windows.
Quick life-baseline and dialogue checks run on Linux. The full life baseline
contains 15 fixed trajectories; CI's quick mode runs the five s1 cases.
Connected Convex and windowed Godot checks are separate.

Evaluation reports in this directory are development measurements: rule/model
comparisons, resident-life scoring, and scripted dialogue runs. The proposed
blind human rating has not been completed. These reports do not establish a
general measure of human-like behavior.

The next integration milestones are:

1. Carry life and dialogue through the connected client and authoritative
   runtime, including persistence and readback.
2. Consume timed movement/action goals in the reference client.
3. Make a fresh connected world reproducible from a clean checkout.
4. Validate proximity-based model scheduling before implementing shared
   trading, delayed messages, and the news service.

[README](../README.md) · [Getting started](GETTING_STARTED.md) ·
[Architecture](../ARCHITECTURE.md)
