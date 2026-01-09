/**
 * Example tRPC Client
 *
 * Demonstrates how to use the knowledgebase API from TypeScript
 * with full end-to-end type safety
 */

import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../src/api/router.js";

// Create typed client
const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "http://localhost:4000/trpc",
    }),
  ],
});

async function main() {
  console.log("Knowledgebase tRPC Client Example\n");

  // Health check
  console.log("1. Checking health...");
  const health = await client.health.query();
  console.log("   ✓", health);

  // Add memories
  console.log("\n2. Adding memories...");
  await client.add.mutate({
    text: "Alice prefers TypeScript over JavaScript",
  });
  console.log("   ✓ Added: Alice's preference");

  await client.add.mutate({
    text: "Bob works on the DashFrame project",
  });
  console.log("   ✓ Added: Bob's project");

  await client.add.mutate({
    text: "DashFrame uses React and TypeScript",
  });
  console.log("   ✓ Added: DashFrame tech stack");

  // Wait for processing (in real app, you'd poll or use websockets)
  console.log("\n   Waiting for processing...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Search
  console.log("\n3. Searching for TypeScript-related memories...");
  const searchResults = await client.search.query({
    query: "TypeScript",
    limit: 5,
  });
  console.log(`   Found ${searchResults.memories.length} memories:`);
  for (const memory of searchResults.memories) {
    console.log(`   - ${memory.name}: ${memory.summary}`);
  }

  // Get specific item
  console.log("\n4. Getting Alice's information...");
  try {
    const alice = await client.get.query({ name: "Alice" });
    console.log("   Item:", alice.item);
    console.log("   Relations:", alice.relations);
    if (alice.conflicts.length > 0) {
      console.log("   ⚠️  Conflicts detected:", alice.conflicts);
    }
  } catch {
    console.log("   ✗ Not found");
  }

  // Demonstrate conflict
  console.log("\n5. Creating a conflict...");
  await client.add.mutate({
    text: "Alice prefers Python for data science",
  });
  console.log("   ✓ Added conflicting preference");

  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log("\n6. Checking for conflicts...");
  const aliceWithConflict = await client.get.query({ name: "Alice" });
  if (aliceWithConflict.conflicts.length > 0) {
    console.log("   ⚠️  Conflict detected!");
    for (const conflict of aliceWithConflict.conflicts) {
      console.log(`   - ${conflict.item} ${conflict.relation}:`);
      for (const option of conflict.options) {
        console.log(`     - ${option.value} (${option.createdAt})`);
      }
    }
  }

  // Clean up
  console.log("\n7. Cleaning up...");
  await client.forget.mutate({ name: "Alice" });
  console.log("   ✓ Forgot Alice");

  await client.forget.mutate({ name: "Bob" });
  console.log("   ✓ Forgot Bob");

  await client.forget.mutate({ name: "DashFrame" });
  console.log("   ✓ Forgot DashFrame");

  console.log("\n✅ Example complete!");
}

main().catch(console.error);
