/**
 * FBT AI / Intent OS — UPGRADE 6
 * OrchestratorV2 barrel — re-exports from sharedContext for backward compat
 */
export * from './sharedContext.js';
import { getOrchestratorV2, createSharedContext, AgentOrchestratorV2 } from './sharedContext.js';
export { getOrchestratorV2, createSharedContext, AgentOrchestratorV2 };
export default getOrchestratorV2;
