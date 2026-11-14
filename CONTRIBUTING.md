# Contributing

Worldweft welcomes focused fixes, reproducible reports, and small extensions to
the world runtime. Start with [Getting started](docs/GETTING_STARTED.md),
[Architecture](ARCHITECTURE.md), and [Implementation status](docs/STATUS.md).

## Find The Right Place

- Report reproducible bugs through the [bug form](https://github.com/hX1-dev/worldweft/issues/new?template=bug_report.yml).
- Propose concrete behavior through the [feature form](https://github.com/hX1-dev/worldweft/issues/new?template=feature_request.yml).
- Discuss larger design directions in [Discussions](https://github.com/hX1-dev/worldweft/discussions).
- Report suspected vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Preserve The World Contract

- Convex is the only durable source of world facts and rule outcomes.
- Godot may render, navigate, collect input, and submit semantic actions; it
  must not write durable world state directly.
- LLM output may propose an intent or presentation text. It must not directly
  create `worldEvents`, `actionRecords`, relationships, or memories.
- New actions must enter the formal action pipeline and produce traceable
  durable results when they change the world.

For larger work, discuss the intended behavior, affected records, and
verification first. Check current work before starting a competing implementation.

## Verify The Change

| Change | Evidence to include |
| --- | --- |
| Documentation or SVG | Working links, accurate capability status, and rendered visual checks where relevant. |
| World rules or bridge | Focused behavior tests and `npm run godot:check-core`. |
| Resident life | Relevant unit tests and baseline trajectories, or an explained behavior change with a reviewed baseline update. |
| Dialogue | Memory/affinity checks and relevant conversation cases; model runs only when explicitly intended. |
| Connected or visual behavior | Appropriate live bridge or windowed client evidence in addition to headless checks. |

Use Node 24 for the baseline. Core npm verification works in PowerShell and
POSIX shells; the complete gate also needs Godot. See
[Getting started](docs/GETTING_STARTED.md#3-run-the-checks) for shell-specific setup.

## Open A Pull Request

Describe the problem, resulting behavior, and verification. For world changes,
name the records that may change and explain how the authority boundary is
preserved. Include affected callers and contracts when changing shared code.
Review and test generated code before submitting it.

Documentation should label lab-only and planned capabilities explicitly.
Third-party code and assets must retain attribution and license information;
see [NOTICE.md](NOTICE.md). Keep credentials, local backend state, run logs, and
caches out of the patch.
