/**
 * POST /api/trigger-index
 *
 * Receives an id + namespace from the CLI after a filesystem write and queues
 * it for background graph indexing (extraction + embedding + storage).
 *
 * Fire-and-forget: returns immediately after enqueuing.
 */

import { createFileRoute } from "@tanstack/react-router";
import { ensureServerIndexerStarted } from "@/server/indexer.js";

ensureServerIndexerStarted();

async function handleTriggerIndex(request: Request): Promise<Response> {
  let body: { id: string; namespace: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id, namespace } = body;
  if (!id || !namespace) {
    return Response.json({ error: "id and namespace required" }, { status: 400 });
  }

  try {
    const { assertValidMemoryId } = await import("@/lib/fs-memory.js");
    assertValidMemoryId(id);
    const { queueMemoryForIndexing } = await import("@/lib/operations.js");

    queueMemoryForIndexing(id, namespace).catch((err: unknown) => {
      console.error(`[api/trigger-index] Queue processing failed for ${id}:`, err);
    });

    return Response.json({ status: "queued", id });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Invalid memory id")) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    console.error(`[api/trigger-index] Failed to read or queue ${id}:`, err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/trigger-index")({
  server: {
    handlers: {
      POST: ({ request }) => handleTriggerIndex(request),
    },
  },
});
