// Stable Convex facade. ARC5 moves wake orchestration behind this path without
// changing generated identities such as internal.xianxia.agent.agentContext.
import {
  agentContext as agentContextImpl,
  autoTick as autoTickImpl,
  proposeAndAct as proposeAndActImpl,
  runAgentTickInternal as runAgentTickInternalImpl,
} from './runtime/agentWakeOrchestrator';

export const agentContext = agentContextImpl;
export const proposeAndAct = proposeAndActImpl;
export const runAgentTickInternal = runAgentTickInternalImpl;
export const autoTick = autoTickImpl;
