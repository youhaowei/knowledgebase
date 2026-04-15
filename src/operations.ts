/**
 * Public Operations API
 *
 * Entry point for "knowledgebase/operations" package export.
 * Re-exports business logic functions for direct consumption
 * by external packages (e.g., Workforce server-side hooks).
 */

export {
  addMemory,
  graphSearch,
  getByName,
  forget,
  forgetEdge,
  stats,
  getQueueStatus,
  close,
} from "./lib/operations.js";
