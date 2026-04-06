/**
 * POST /api/trigger-index
 *
 * Receives a file path from the CLI after a filesystem write and queues
 * it for background graph indexing (extraction + embedding + storage).
 *
 * Fire-and-forget: returns immediately after enqueuing.
 */

import { createFileRoute } from "@tanstack/react-router";

async function handleTriggerIndex(request: Request): Promise<Response> {
  let body: { path: string; namespace: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path, namespace } = body;
  if (!path || !namespace) {
    return Response.json({ error: "path and namespace required" }, { status: 400 });
  }

  try {
    // Dynamic imports to avoid loading graph provider at module level
    const { readMemoryFile } = await import("@/lib/fs-memory.js");
    const { getProvider } = await import("@/lib/operations.js");
    const { Queue } = await import("@/lib/queue.js");

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

    // Get provider and queue; process in background (don't await)
    const gp = await getProvider();
    const queue = new Queue(gp);
    queue.add(memory).catch((err: unknown) => {
      console.error(`[api/trigger-index] Queue processing failed for ${path}:`, err);
    });

    return Response.json({ status: "queued", id: frontmatter.id });
  } catch (err) {
    console.error(`[api/trigger-index] Failed to read or queue ${path}:`, err);
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
