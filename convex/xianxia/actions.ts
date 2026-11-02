// Stable Convex facade. ARC3 moves implementation behind this path without
// changing generated identities such as internal.xianxia.actions.submitAction.
import {
  addToInventory,
  applyRelationshipEvent,
  autoAdvanceLayers,
  ensureIncapacitationRecovery,
  expireActionExecution as expireActionExecutionImpl,
  loadProfile,
  prepareActionExecutionGoals as prepareActionExecutionGoalsImpl,
  reportActionExecution as reportActionExecutionImpl,
  submitAction as submitActionImpl,
} from './domains/actionRouter';

export const submitAction = submitActionImpl;
export const reportActionExecution = reportActionExecutionImpl;
export const expireActionExecution = expireActionExecutionImpl;
export const prepareActionExecutionGoals = prepareActionExecutionGoalsImpl;

export {
  addToInventory,
  applyRelationshipEvent,
  autoAdvanceLayers,
  ensureIncapacitationRecovery,
  loadProfile,
};
