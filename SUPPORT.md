# Support

## Start Here

- [Getting started](docs/GETTING_STARTED.md): dialogue lab, checks, and connected-client prerequisites.
- [Implementation status](docs/STATUS.md): runtime, separate labs, and planned capabilities.
- [Architecture](ARCHITECTURE.md): actions, NPC ticks, dialogue, and world authority.
- [Runbook](godot-taixu-client/PRODUCTION_RUNBOOK.md): deployment profiles and connected failure triage.

Use [Discussions](https://github.com/hX1-dev/worldweft/discussions) for setup help,
world-design questions, and open-ended ideas. Use
[Issues](https://github.com/hX1-dev/worldweft/issues) for reproducible bugs and
focused proposals.

## A Useful Bug Report

Include the smallest reproduction, expected and observed behavior, operating
system, Node/Godot versions, and the relevant failing command. State whether
you used the dialogue lab, offline simulation, or connected client. Include a
sanitized error excerpt rather than a full local state dump.

Dry-mode model placeholders are expected. The first dialogue-lab start may
spend about a minute generating its resident-life log before the page opens.

For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md). Keep bridge
tokens, model keys, environment files, and local Convex state out of public
reports.
