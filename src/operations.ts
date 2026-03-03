/**
 * Public Operations API
 *
 * Entry point for "knowledgebase/operations" package export.
 * Re-exports business logic functions for direct consumption
 * by external packages (e.g., Workforce server-side hooks).
 */

export {
  addMemory,
  search,
  getByName,
  forget,
  forgetEdge,
  stats,
  getQueueStatus,
  close,
} from "./lib/operations.js";
