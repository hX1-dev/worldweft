// Stable schema assembly facade. ARC4 keeps xianxiaTables as the only public composition.
import { runtimeFactsTables } from './schema/runtimeFacts';
import { coordinationTables } from './schema/coordination';
import { executionTables } from './schema/execution';
import { projectionTables } from './schema/projection';
import { evaluationTables } from './schema/evaluation';
import { legacyTables } from './schema/legacy';

export const xianxiaTables = {
  ...runtimeFactsTables,
  ...coordinationTables,
  ...executionTables,
  ...projectionTables,
  ...evaluationTables,
  ...legacyTables,
};
