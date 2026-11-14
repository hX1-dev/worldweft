# Worldweft Documentation

[English overview](../README.md) · [中文首页](../README.zh-CN.md)

Start with the current guides below. Dated reports record individual
experiments; use the implementation status page to check whether a capability
is part of the live runtime, a separate lab, or a future integration.

## Start Here

| Guide | What it answers |
| --- | --- |
| [Getting started](GETTING_STARTED.md) | Install, try the dialogue lab, run checks, and connect the reference client. Includes PowerShell and Bash setup. |
| [Implementation status](STATUS.md) | What works today, where it runs, source evidence, and the next integration milestones. |
| [Architecture](../ARCHITECTURE.md) | World authority, action lifecycle, NPC scheduling, dialogue, and the proposed shared-world extension. |
| [Reference client](../godot-taixu-client/README.md) | Godot setup, current scope, important files, and verification. |
| [Bridge contracts](../godot-taixu-client/BRIDGE_TESTS.md) | State/action contracts, authorization, and negative cases. |
| [Production runbook](../godot-taixu-client/PRODUCTION_RUNBOOK.md) | Environment profiles and connected, headless, windowed, and release checks. Historical evidence is dated. |

## Design And Evaluation

Most experiment reports are written in Chinese. They describe the named
version and test conditions, rather than certifying the current release.

| Area | Standards and reports |
| --- | --- |
| Rules and models | [Rules vs DeepSeek comparison](ab-rules-vs-deepseek-2026-10-21.md) · [Agent architecture research](agent架构_可缝合的做法_调研_2026-10-27.md) |
| Resident life | [Evaluation standard](NPC人性过关标准.md) · [Baseline](NPC人性基线_2026-10-22.md) · [Daily life v1](NPC人性优化_拟人生活v1_2026-10-23.md) · [Conflict, rumours, and reputation](NPC人性优化_冲突流言名声_2026-10-23.md) |
| Player dialogue | [Evaluation standard](玩家对话过关标准.md) · [Dialogue v1](玩家对话v1_2026-10-23.md) · [Apologies](玩家对话_道歉v1_2026-10-23.md) · [Affinity](玩家对话_好感度v1_2026-10-23.md) |
| Dialogue grounding | [World knowledge](玩家对话_生活常识_2026-10-24.md) · [Conversation memory](玩家对话_记得聊过的事_2026-10-24.md) · [Checks before speaking](玩家对话_说出口前核对_2026-11-04.md) |
| Playtest material | [Human playtest plan](玩家对话_真人试玩_2026-10-23.md) · [Scripted self-test](玩家对话_自测_2026-10-24.md) |
| Reference-world content | [Qinglan common-knowledge draft](世界逻辑/青岚山外门_生活常识_草案.md) |

The full life baseline has 15 fixed trajectories. CI runs the five-case quick
subset. Blind human rating remains outstanding; report scores should be read
with their stated scope and limitations.

## Contribute And Release

| Guide | Purpose |
| --- | --- |
| [Contributing](../CONTRIBUTING.md) | Change scope, authority rules, and required evidence. |
| [Support](../SUPPORT.md) | Where to ask questions and report reproducible problems. |
| [Security](../SECURITY.md) | Private vulnerability reporting. |
| [Positioning](../POSITIONING.md) | Framework direction and the relationship to AI Town and Microverse. |
| [Compatibility](../COMPATIBILITY.md) | Retained backend modules and the supported public path. |
| [Release readiness](../OPEN_SOURCE_CHECKLIST.md) | Remaining distribution and asset-provenance work. |
| [Notices](../NOTICE.md) | Third-party attribution, fonts, and reference-fixture notes. |
| [Brand assets](brand/README.md) | Cover provenance, generation prompt, and editable architecture artwork. |

Historical client plans remain in
[HARDENING_PLAN.md](../godot-taixu-client/HARDENING_PLAN.md) and
[IMPLEMENTATION_PLAN.md](../godot-taixu-client/IMPLEMENTATION_PLAN.md).
For current runtime scope, return to [Implementation status](STATUS.md).
