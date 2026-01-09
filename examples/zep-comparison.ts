/**
 * Zep Cloud Comparison Script
 *
 * Inserts the same sample data we have in our knowledgebase into Zep Cloud
 * to compare how Graphiti extracts entities and relations.
 *
 * Run with: bun run examples/zep-comparison.ts
 */

const ZEP_API_KEY = process.env.ZEP_API_KEY;

if (!ZEP_API_KEY) {
  console.error("Error: ZEP_API_KEY environment variable is required");
  console.error("Add it to your .env file: ZEP_API_KEY=your_key_here");
  process.exit(1);
}

const ZEP_BASE_URL = "https://api.getzep.com/api/v2";

// Sample data - same as what we've been testing with
const sampleEpisodes = [
  {
    name: "DashFrame Tech Stack",
    text: `DashFrame uses Next.js 16 with App Router and React 19 for the web frontend. The backend layer uses DuckDB-WASM for in-browser query execution and Dexie (IndexedDB) for client-side data persistence. Vega-Lite handles chart rendering.`,
  },
  {
    name: "DashFrame State Management",
    text: `DashFrame uses Zustand stores with Immer middleware for state management, persisting state to Dexie (IndexedDB). The pattern uses useLiveQuery hooks from dexie-react-hooks for reactive database queries. We chose Zustand over Redux because of its simpler API and better TypeScript support.`,
  },
  {
    name: "DashFrame Data Flow",
    text: `DashFrame's data flow follows a clear pattern: CSV/Notion source → DataFrame (Arrow IPC format) → IndexedDB storage → DuckDB table → Visualization (Vega-Lite). The DataFrame acts as the central abstraction that all data sources convert to and all visualizations consume from.`,
  },
];

async function zepRequest(endpoint: string, options: RequestInit = {}) {
  const response = await fetch(`${ZEP_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${ZEP_API_KEY}`,
      ...options.headers,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Zep API error (${response.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function main() {
  console.log("🔗 Connecting to Zep Cloud...\n");

  // Step 1: Create a graph for our comparison
  const graphId = `kb-compare-${Date.now()}`;

  console.log(`📊 Creating graph: ${graphId}`);
  try {
    await zepRequest("/graph/create", {
      method: "POST",
      body: JSON.stringify({
        graph_id: graphId,
        name: "Knowledgebase Comparison",
        description: "Comparing Zep/Graphiti extraction with our knowledgebase",
      }),
    });
    console.log("   ✓ Graph created\n");
  } catch (e) {
    console.error("   ✗ Failed to create graph:", e);
    return;
  }

  // Step 2: Add episodes (our sample data)
  console.log("📝 Adding episodes...");
  for (const episode of sampleEpisodes) {
    try {
      await zepRequest("/graph", {
        method: "POST",
        body: JSON.stringify({
          graph_id: graphId,
          type: "text",
          data: episode.text,
          source_description: episode.name,
        }),
      });
      console.log(`   ✓ Added: ${episode.name}`);
    } catch (e) {
      console.error(`   ✗ Failed to add ${episode.name}:`, e);
    }
  }

  console.log("\n⏳ Waiting for Zep to process episodes (45s)...");
  console.log("   (Zep extracts entities, relations, and builds the graph)");
  await new Promise((resolve) => setTimeout(resolve, 45000));

  // Step 3: Retrieve and display the extracted nodes (entities)
  console.log("\n🔍 Retrieving extracted nodes (entities)...\n");
  try {
    const nodes = await zepRequest(`/graph/node/graph/${graphId}`, {
      method: "POST",
      body: JSON.stringify({ limit: 50 }),
    });
    console.log("=== ENTITIES (Nodes) ===");
    const nodeList = Array.isArray(nodes) ? nodes : nodes.nodes || [];
    if (nodeList.length === 0) {
      console.log("   (No nodes extracted yet - processing may still be in progress)");
    }
    for (const node of nodeList) {
      console.log(`  • ${node.name} [${node.labels?.join(", ") || node.label || "Entity"}]`);
      if (node.summary) {
        console.log(`    Summary: ${node.summary}`);
      }
    }
  } catch (e) {
    console.error("Failed to get nodes:", e);
  }

  // Step 4: Retrieve and display the extracted edges (facts with relations)
  console.log("\n🔗 Retrieving extracted edges (facts/relations)...\n");
  try {
    const edges = await zepRequest(`/graph/edge/graph/${graphId}`, {
      method: "POST",
      body: JSON.stringify({ limit: 50 }),
    });
    console.log("=== EDGES (Facts with Relations) ===");
    const edgeList = Array.isArray(edges) ? edges : edges.edges || [];
    if (edgeList.length === 0) {
      console.log("   (No edges extracted yet - processing may still be in progress)");
    }
    for (const edge of edgeList) {
      // The edge.name is the relation type (e.g., "USES", "PREFERS", etc.)
      console.log(`  • [${edge.name}] ${edge.fact}`);
      if (edge.valid_at || edge.invalid_at) {
        console.log(
          `    Temporal: ${edge.valid_at || "unknown"} → ${edge.invalid_at || "present"}`
        );
      }
    }
  } catch (e) {
    console.error("Failed to get edges:", e);
  }

  // Step 5: Test a search query
  console.log("\n🔎 Testing search: 'What does DashFrame use for state management?'\n");
  try {
    const searchResult = await zepRequest(`/graph/${graphId}/search`, {
      method: "POST",
      body: JSON.stringify({
        query: "What does DashFrame use for state management?",
        limit: 5,
      }),
    });
    console.log("=== SEARCH RESULTS ===");
    const results = searchResult.edges || searchResult.facts || searchResult.results || [];
    if (results.length === 0) {
      console.log("   (No search results - graph may still be processing)");
    }
    for (const result of results) {
      console.log(`  • ${result.fact || result.name || JSON.stringify(result)}`);
      if (result.score !== undefined) {
        console.log(`    Score: ${result.score.toFixed(3)}`);
      }
    }
  } catch (e) {
    console.error("Search failed:", e);
  }

  // Step 6: Compare with what our model would produce
  console.log("\n" + "=".repeat(60));
  console.log("📊 COMPARISON: Zep/Graphiti vs Our Knowledgebase Model");
  console.log("=".repeat(60));
  console.log(`
Zep/Graphiti Model:
  • Edges ARE facts: "DashFrame --[USES]--> Zustand"
  • Edge properties: name (relation type), fact (text), valid_at, invalid_at
  • Semantic relation types: USES, PREFERS, CHOSEN_OVER, etc.
  • Temporal: tracks when facts became true/false

Our Current Model:
  • Facts are separate nodes linked to entities via ABOUT
  • Edges are co-occurrence only (no semantic type)
  • Missing: relation types, temporal bounds, decision context

Key Differences:
  1. Zep can answer "What do we USE?" vs "What did we REJECT?"
  2. Zep tracks temporal validity of facts
  3. Our model has richer fact text but loses relation semantics
`);

  console.log("\n✅ Comparison complete!");
  console.log(`\nGraph ID for reference: ${graphId}`);
  console.log("View in Zep dashboard: https://app.getzep.com");
}

main().catch(console.error);
