# Getting Started

There are two entry points: a local dialogue lab and a connected Godot
reference client. Start with the lab to inspect resident interaction without
setting up a deployment.

## Requirements

| Tool | Needed for | Baseline |
| --- | --- | --- |
| Node.js and npm | All commands | Node 24; package range is 20–24. |
| Git | Clone and source-boundary checks | A normal Git checkout. |
| Godot | Reference client and headless contracts | 4.3+; published checks use 4.7. |
| Convex deployment | Connected client | A configured deployment with a seeded reference world. |
| Model key | Generated dialogue | Optional; the lab supports dry mode. |

## 1. Install

```bash
git clone https://github.com/hX1-dev/worldweft.git
cd worldweft
npm ci
```

Run commands from the repository root. The dialogue commands work in
PowerShell and POSIX shells. Use Git Bash on Windows for the core verification
scripts, which contain POSIX environment assignments.

## 2. Try The Dialogue Lab

```bash
npm run dialogue:chat -- --dry
```

Open **http://127.0.0.1:8766** once the terminal reports that the server is
ready. On a fresh checkout, the tool first generates a 3,600-tick resident-life
log. This usually takes about a minute and makes no model calls.

Choose a resident and try introductions, questions about their day, repeated
visits, compliments, or an apology. The lab exposes the rule/model source of
each reply, remembered details, and affinity changes. Dry mode shows
`【这句交给 AI】` when a line would require model generation.

For generated replies, supply `XIANXIA_PI_NPC_DEEPSEEK_API_KEY` through the
process environment, then run `npm run dialogue:chat` without `--dry`. The
model and its request settings are defined in
[`player_dialogue_engine.mjs`](../godot-taixu-client/tools/player_dialogue_engine.mjs).
The lab binds to localhost and saves session logs under `.logs/player-dialogue/`.
Stop it with **Ctrl+C**.

This tool uses a simulated world log and local conversation state. Integrating
it with live Convex state and the Godot client is tracked in
[Implementation status](STATUS.md).

## 3. Run The Checks

Life and dialogue checks require no model key or deployment:

```bash
npm run dialogue:check-memory
npm run dialogue:check-affinity
npm run life:check-baseline -- --quick
```

Quick mode runs five s1 cases. Omit `-- --quick` for all 15 fixed trajectories.
Generated reports stay under the ignored `.logs/` directory.

The core gate also requires Godot. In Bash or Git Bash:

```bash
GODOT_BIN="/path/to/Godot" npm run godot:check-core
```

For Git Bash on Windows, a path such as `C:/Tools/Godot/Godot.exe` is suitable.
The core gate checks source boundaries, types, lint, unit behavior, and
headless client contracts. It does not start a connected world.

## 4. Use The Connected Reference Client

The current connected path assumes an initialized Convex deployment, a seeded
Qinglan world, and world/actor-bound bridge credentials. A one-command bootstrap
for a new world is a pending milestone.

1. Configure the deployment's world ID, player actor, and bridge credentials
   using the [runbook environment profiles](../godot-taixu-client/PRODUCTION_RUNBOOK.md#environment-profiles).
2. Run `npm run dev:backend` and wait for `Convex functions ready!`.
3. Read the deployment's `/godot` health endpoint and check its contract and
   non-secret configuration summary.
4. Open `godot-taixu-client/project.godot` in Godot, with `GODOT_BRIDGE_URL`
   and the player `GODOT_BRIDGE_TOKEN` supplied to that process.
5. Follow the [client guide](../godot-taixu-client/README.md) and
   [bridge contracts](../godot-taixu-client/BRIDGE_TESTS.md) for actions and readback.

For the local deployment described in the runbook, the HTTP action origin is
`http://127.0.0.1:3211`; a hosted deployment uses its own HTTP action origin.
Debug tick and replay inspection require separate authorized debug credentials.
Player credentials do not grant debug access.

## Common Questions

**The page has not opened yet.** Wait for the initial simulation and the
`player dialogue chat ready` message. To use another port:
`npm run dialogue:chat -- --dry --port 8767`.

**Some replies are placeholders.** This is expected in dry mode. Rule replies
still run; model-dependent lines need the optional key and a run without `--dry`.

**Godot cannot connect.** Check the deployment health endpoint and distinguish
the Convex API port from its HTTP action origin. Then use the runbook's
[failure triage](../godot-taixu-client/PRODUCTION_RUNBOOK.md#failure-triage).

[README](../README.md) · [Architecture](../ARCHITECTURE.md) ·
[Implementation status](STATUS.md) · [Support](../SUPPORT.md)
