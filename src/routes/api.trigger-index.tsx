/**
 * POST /api/trigger-index
 *
 * Receives an id + namespace from the CLI after a filesystem write and queues
 * it for background graph indexing (extraction + embedding + storage).
 *
 * Fire-and-forget: returns immediately after enqueuing.
 */

import { createFileRoute } from "@tanstack/react-router";
import { join } from "path";

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
    // Dynamic imports to avoid loading graph provider at module level
    const { getNamespacePath, readMemoryFile } = await import("@/lib/fs-memory.js");
    const { getQueue } = await import("@/lib/operations.js");

    // Reconstruct path server-side — never trust client-supplied paths
    const path = join(getNamespacePath(namespace), `${id}.md`);
    const { frontmatter, text } = await readMemoryFile(path);

    const memory = {
      id: frontmatter.id,
      name: frontmatter.name,
      text,
      abstract: "",
      summary: "",
      namespace: frontmatter.namespace,
      status: "pending" as const,
      schemaVersion: "0.0.0",
      createdAt: new Date(frontmatter.createdAt),
    };

    // Use shared queue singleton — don't create a new Queue per request
    const q = await getQueue();
    q.add(memory).catch((err: unknown) => {
      console.error(`[api/trigger-index] Queue processing failed for ${id}:`, err);
    });

    return Response.json({ status: "queued", id: frontmatter.id });
  } catch (err) {
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
