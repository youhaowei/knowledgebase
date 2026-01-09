/**
 * Health check endpoint
 */

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          status: "ok",
          mode: "tanstack-start",
          timestamp: new Date().toISOString(),
        });
      },
    },
  },
});
