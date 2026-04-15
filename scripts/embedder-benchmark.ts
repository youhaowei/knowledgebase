#!/usr/bin/env bun
/**
 * Labeled Embedder Benchmark
 *
 * Measures retrieval accuracy of Ollama (2560-dim qwen3) vs Fallback
 * (384-dim Snowflake Arctic xs) on a labeled corpus of realistic KB
 * memories and queries with known expected answers.
 *
 * Metrics:
 *   Recall@1  — expected doc ranked first
 *   Recall@5  — expected doc in top 5
 *   MRR       — mean reciprocal rank (1/rank)
 *
 * Corpus is hardcoded for reproducibility. Modeled on real retro-style
 * content, with deliberate hard negatives (multiple docs sharing keywords).
 */

import { embed } from "../src/lib/embedder.ts";
import { embedFallback } from "../src/lib/fallback-embedder.ts";

interface Doc {
  id: string;
  text: string;
}

interface LabeledQuery {
  query: string;
  expected: string;           // primary expected doc id
  alsoAcceptable?: string[];  // other docs that would also be correct
  tests: string;              // what this query is probing
}

// ============================================================================
// Corpus — 30 docs modeled on realistic personal-KB entries
// ============================================================================

const CORPUS: Doc[] = [
  // State management (hard negatives for each other)
  { id: "state-1", text: "DashFrame uses Zustand for global state management. Chose Zustand over Redux for its simpler API and less boilerplate." },
  { id: "state-2", text: "Redux Toolkit is overkill for small apps. Too much boilerplate, too many concepts, slow for rapid iteration." },
  { id: "state-3", text: "React Context plus useReducer works fine for medium apps under 20 components. No extra dependencies needed." },
  { id: "state-4", text: "Jotai atoms feel natural but caused issues with Suspense boundaries and server components in Next.js." },

  // Build tools and runtime
  { id: "build-1", text: "Bun runtime replaces Node plus npm plus tsx. Three times faster test startup and unified package management." },
  { id: "build-2", text: "Vite HMR breaks globalThis symbols unless cached via Symbol.for. Module re-evaluation loses singleton state." },
  { id: "build-3", text: "pnpm workspaces are faster than yarn but slower than Bun. Content-addressable storage avoids duplicate installs." },
  { id: "build-4", text: "esbuild is ten times faster than tsc but does not typecheck. Use tsc for type errors, esbuild for bundling." },

  // Bugs and known issues
  { id: "bug-1", text: "Bun install fails inside git worktrees. Cannot find package.json despite the file existing at worktree root." },
  { id: "bug-2", text: "LadybugDB native addon segfaults on close during test teardown. Skip explicit close in afterAll hooks." },
  { id: "bug-3", text: "Ollama embedding server takes about one second cold start per model. First request after idle is slow." },
  { id: "bug-4", text: "TanStack Router codegen runs on every file save. Slows the dev loop during rapid edits." },
  { id: "bug-5", text: "Tailwind v4 breaks when layer base is declared twice in the stylesheet. Merge directive order matters." },

  // Storage and database
  { id: "storage-1", text: "Filesystem-first storage layout. Markdown files with YAML frontmatter at kb memories namespace uuid dot md." },
  { id: "storage-2", text: "Neo4j vector index supports cosine similarity but requires full index rebuild when embedding dimension changes." },
  { id: "storage-3", text: "Dual vector indexes coexist per node type. 2560 dimension Ollama and 384 dimension fallback are populated at ingestion." },
  { id: "storage-4", text: "Atomic file writes need the writeTempAndRename pattern. fsync then rename is safe against torn writes on crash." },

  // Search and retrieval
  { id: "search-1", text: "Reciprocal Rank Fusion combines multiple ranked result lists without requiring score normalization across sources." },
  { id: "search-2", text: "BM25 keyword search catches exact terms that dense embedding vectors miss. Rare identifiers and proper nouns especially." },
  { id: "search-3", text: "ripgrep with json output streams matches as they are found. Under 50ms to search 1000 markdown files." },
  { id: "search-4", text: "Hybrid search merges file search with graph search behind a 3 second timeout and exponential backoff cooldown on failure." },

  // Tooling and workflow
  { id: "tool-1", text: "cc-retro CLI stores findings in local SQLite. Faster than Notion for daily logs, zero auth overhead." },
  { id: "tool-2", text: "Retro findings sync to KB via kb add with retro namespace. Fire and forget background call, never blocks the user." },
  { id: "tool-3", text: "Claude Code subagents inherit main process CWD. Causes worktree path issues when git-ops runs from the wrong directory." },
  { id: "tool-4", text: "MCP tools expose KB search add and forget operations to Claude Code over stdio transport. No HTTP server needed." },

  // AI and models
  { id: "ai-1", text: "qwen3 embedding 4b produces 2560 dimensional vectors. High quality but three second cold start on Ollama after idle." },
  { id: "ai-2", text: "Snowflake Arctic xs is 384 dimensions. Runs in process via HuggingFace transformers js. Zero dependencies to install." },
  { id: "ai-3", text: "Claude Sonnet 4.5 handles entity and edge extraction better than Haiku. Quality gap is worth the extra latency." },
  { id: "ai-4", text: "Gemini 2.5 Flash is cheaper than Claude for simple extraction but hallucinates entity type labels more often." },
  { id: "ai-5", text: "OAuth Claude subscription via unifai replaces API billing for personal KB. Zero marginal cost per extraction." },
];

// ============================================================================
// Labeled queries — real-world phrasings with hard negatives
// ============================================================================

const QUERIES: LabeledQuery[] = [
  // Natural paraphrase
  { query: "what state management library does dashframe use", expected: "state-1", tests: "paraphrase: 'library' not in doc" },
  { query: "why did we pick zustand", expected: "state-1", tests: "short intent query" },
  { query: "how are memories stored on disk", expected: "storage-1", tests: "paraphrase: 'on disk' vs 'filesystem-first'" },

  // Bug recall
  { query: "bun install failing in git worktree", expected: "bug-1", tests: "bug recall with all keywords present" },
  { query: "ladybug database crashes during shutdown", expected: "bug-2", tests: "paraphrase: 'crashes' vs 'segfaults', 'shutdown' vs 'close'" },
  { query: "why is the first embedding slow", expected: "bug-3", tests: "causal query, no shared keywords with doc" },

  // Conceptual / architecture
  { query: "how do we combine multiple ranked search results", expected: "search-1", tests: "paraphrase of RRF concept" },
  { query: "keyword search to catch exact terms embeddings miss", expected: "search-2", tests: "doc terminology almost matches" },
  { query: "fast file search for markdown", expected: "search-3", tests: "paraphrase of ripgrep use case" },

  // Hard negatives (multiple docs share keywords)
  { query: "which state library has the simplest api", expected: "state-1", alsoAcceptable: ["state-3"], tests: "must prefer simplest over other libs" },
  { query: "what embedding dimensions are stored", expected: "storage-3", alsoAcceptable: ["ai-1", "ai-2"], tests: "must pick dual-index over individual model docs" },
  { query: "ollama cold start latency", expected: "bug-3", alsoAcceptable: ["ai-1"], tests: "must prefer bug doc over capability doc" },

  // Specific technical
  { query: "atomic writes without torn files", expected: "storage-4", tests: "paraphrase: 'without torn files' vs 'torn write safe'" },
  { query: "vite hmr module singleton problem", expected: "build-2", tests: "technical jargon" },
  { query: "sqlite based retro finding storage", expected: "tool-1", tests: "specific tooling query" },
  { query: "tailwind layer ordering issue", expected: "bug-5", tests: "short bug query" },
  { query: "subagents running from wrong working directory", expected: "tool-3", tests: "paraphrase: 'wrong working directory' vs 'CWD issues'" },
  { query: "how does claude code talk to the knowledge base", expected: "tool-4", tests: "natural user question" },
  { query: "which model is better for extraction accuracy", expected: "ai-3", alsoAcceptable: ["ai-4"], tests: "comparative query" },
  { query: "snowflake arctic local embeddings", expected: "ai-2", tests: "specific model query" },
];

// ============================================================================
// Math helpers
// ============================================================================

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

function rankDocs(
  queryEmb: number[],
  docEmbs: Map<string, number[]>,
): Array<{ id: string; score: number; rank: number }> {
  const scored = [...docEmbs.entries()]
    .map(([id, emb]) => ({ id, score: cosine(queryEmb, emb) }))
    .sort((a, b) => b.score - a.score);
  return scored.map((x, i) => ({ ...x, rank: i + 1 }));
}

function findRank(
  ranked: Array<{ id: string; rank: number }>,
  targetIds: string[],
): number {
  for (const r of ranked) {
    if (targetIds.includes(r.id)) return r.rank;
  }
  return Infinity;
}

// ============================================================================
// Per-query evaluation
// ============================================================================

interface QueryResult {
  query: string;
  tests: string;
  ollamaRank: number;
  fallbackRank: number;
  ollamaTop3: string[];
  fallbackTop3: string[];
}

interface AggregateMetrics {
  r1: number;
  r5: number;
  mrr: number;
}

interface CorpusEmbeddingResult {
  embeddings: Map<string, number[]>;
  elapsedMs: number;
}

function aggregate(ranks: number[]): AggregateMetrics {
  const r1 = ranks.filter((rank) => rank === 1).length / ranks.length;
  const r5 = ranks.filter((rank) => rank <= 5).length / ranks.length;
  const mrr = ranks.reduce((sum, rank) => sum + (rank === Infinity ? 0 : 1 / rank), 0) / ranks.length;
  return { r1, r5, mrr };
}

function formatRank(rank: number): string {
  return rank === Infinity ? "MISS" : `#${rank}`;
}

function pickWinner(ollamaRank: number, fallbackRank: number): string {
  if (ollamaRank < fallbackRank) return "Ollama";
  if (fallbackRank < ollamaRank) return "Fallback";
  return "tie";
}

async function embedCorpusWith(
  label: string,
  embedFn: (text: string) => Promise<number[]>,
): Promise<CorpusEmbeddingResult> {
  console.log(label);
  const embeddings = new Map<string, number[]>();
  const startedAt = performance.now();

  for (const doc of CORPUS) {
    const embedding = await embedFn(doc.text);
    if (embedding.length === 0) {
      console.error(`  FAILED: ${doc.id}`);
      continue;
    }
    embeddings.set(doc.id, embedding);
  }

  return {
    embeddings,
    elapsedMs: performance.now() - startedAt,
  };
}

async function evaluateQueries(
  ollamaEmbs: Map<string, number[]>,
  fallbackEmbs: Map<string, number[]>,
): Promise<{ results: QueryResult[]; ollamaQueryTotal: number; fallbackQueryTotal: number }> {
  const results: QueryResult[] = [];
  let ollamaQueryTotal = 0;
  let fallbackQueryTotal = 0;

  for (const query of QUERIES) {
    const ollamaStartedAt = performance.now();
    const ollamaEmbedding = await embed(query.query);
    ollamaQueryTotal += performance.now() - ollamaStartedAt;

    const fallbackStartedAt = performance.now();
    const fallbackEmbedding = await embedFallback(query.query);
    fallbackQueryTotal += performance.now() - fallbackStartedAt;

    const ollamaRanked = rankDocs(ollamaEmbedding, ollamaEmbs);
    const fallbackRanked = rankDocs(fallbackEmbedding, fallbackEmbs);
    const targets = [query.expected, ...(query.alsoAcceptable ?? [])];

    results.push({
      query: query.query,
      tests: query.tests,
      ollamaRank: findRank(ollamaRanked, targets),
      fallbackRank: findRank(fallbackRanked, targets),
      ollamaTop3: ollamaRanked.slice(0, 3).map((result) => result.id),
      fallbackTop3: fallbackRanked.slice(0, 3).map((result) => result.id),
    });
  }

  return { results, ollamaQueryTotal, fallbackQueryTotal };
}

function logPerQueryResults(results: QueryResult[]): void {
  console.log("=".repeat(100));
  console.log("Per-query results (rank of expected doc — lower is better)");
  console.log("=".repeat(100));
  console.log();
  console.log("Query".padEnd(55) + "Ollama".padEnd(10) + "Fallback".padEnd(10) + "Winner");
  console.log("-".repeat(100));

  for (const result of results) {
    const queryLabel = result.query.length > 52 ? result.query.slice(0, 49) + "..." : result.query;
    const ollamaRank = formatRank(result.ollamaRank);
    const fallbackRank = formatRank(result.fallbackRank);
    const winner = pickWinner(result.ollamaRank, result.fallbackRank);
    console.log(queryLabel.padEnd(55) + ollamaRank.padEnd(10) + fallbackRank.padEnd(10) + winner);
  }
  console.log();
}

function logDisagreements(results: QueryResult[]): void {
  const disagreements = results.filter((result) => result.ollamaRank !== result.fallbackRank);
  if (disagreements.length === 0) return;

  console.log("=".repeat(100));
  console.log(`Disagreements (${disagreements.length}/${results.length}):`);
  console.log("=".repeat(100));

  for (const result of disagreements) {
    const ollamaRank = formatRank(result.ollamaRank);
    const fallbackRank = formatRank(result.fallbackRank);
    console.log(`\nQuery: "${result.query}"`);
    console.log(`  Tests: ${result.tests}`);
    console.log(`  Ollama   rank: ${ollamaRank}, top-3: ${result.ollamaTop3.join(", ")}`);
    console.log(`  Fallback rank: ${fallbackRank}, top-3: ${result.fallbackTop3.join(", ")}`);
  }
}

function logSummary(
  oMetrics: AggregateMetrics,
  fMetrics: AggregateMetrics,
  ollamaQueryTotal: number,
  fallbackQueryTotal: number,
  ollamaCorpusMs: number,
  fallbackCorpusMs: number,
): void {
  console.log("\n" + "=".repeat(100));
  console.log("Summary");
  console.log("=".repeat(100));
  console.log(`\nCorpus:  ${CORPUS.length} docs`);
  console.log(`Queries: ${QUERIES.length} labeled\n`);
  console.log("Metric        Ollama     Fallback   Delta");
  console.log("-".repeat(50));
  console.log(`Recall@1      ${(oMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${(fMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${((fMetrics.r1 - oMetrics.r1) * 100).toFixed(0)}pp`);
  console.log(`Recall@5      ${(oMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${(fMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${((fMetrics.r5 - oMetrics.r5) * 100).toFixed(0)}pp`);
  console.log(`MRR           ${oMetrics.mrr.toFixed(3)}     ${fMetrics.mrr.toFixed(3)}     ${(fMetrics.mrr - oMetrics.mrr).toFixed(3)}`);
  console.log();
  console.log("Latency per query:");
  console.log(`  Ollama:   ${(ollamaQueryTotal / QUERIES.length).toFixed(0)}ms avg`);
  console.log(`  Fallback: ${(fallbackQueryTotal / QUERIES.length).toFixed(1)}ms avg`);
  console.log(`  Speedup:  ${(ollamaQueryTotal / fallbackQueryTotal).toFixed(0)}x`);
  console.log();
  console.log("Corpus embed time:");
  console.log(`  Ollama:   ${ollamaCorpusMs.toFixed(0)}ms`);
  console.log(`  Fallback: ${fallbackCorpusMs.toFixed(0)}ms`);
  console.log(`  Speedup:  ${(ollamaCorpusMs / fallbackCorpusMs).toFixed(0)}x`);
  console.log();

  let qualityWinner = "tie (within 5% MRR)";
  if (oMetrics.mrr > fMetrics.mrr + 0.05) qualityWinner = "Ollama";
  if (fMetrics.mrr > oMetrics.mrr + 0.05) qualityWinner = "Fallback";
  console.log(`Quality winner: ${qualityWinner}`);
  console.log(`Latency winner: Fallback (${(ollamaQueryTotal / fallbackQueryTotal).toFixed(0)}x faster queries)`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`Corpus: ${CORPUS.length} docs`);
  console.log(`Queries: ${QUERIES.length} labeled\n`);

  // ------- Embed corpus with both -------
  const ollamaCorpus = await embedCorpusWith(
    "Embedding corpus with Ollama (qwen3-embedding:4b, 2560-dim)...",
    embed,
  );
  const ollamaEmbs = ollamaCorpus.embeddings;
  const ollamaCorpusMs = ollamaCorpus.elapsedMs;
  console.log(`  ${ollamaEmbs.size}/${CORPUS.length} embedded in ${ollamaCorpusMs.toFixed(0)}ms\n`);

  const fallbackCorpus = await embedCorpusWith(
    "Embedding corpus with Fallback (snowflake-arctic-xs, 384-dim)...",
    embedFallback,
  );
  const fallbackEmbs = fallbackCorpus.embeddings;
  const fallbackCorpusMs = fallbackCorpus.elapsedMs;
  console.log(`  ${fallbackEmbs.size}/${CORPUS.length} embedded in ${fallbackCorpusMs.toFixed(0)}ms\n`);

  // ------- Run labeled queries -------
  const { results, ollamaQueryTotal, fallbackQueryTotal } = await evaluateQueries(ollamaEmbs, fallbackEmbs);

  // ------- Compute aggregate metrics -------
  const ollamaRanks = results.map((r) => r.ollamaRank);
  const fallbackRanks = results.map((r) => r.fallbackRank);
  const oMetrics = aggregate(ollamaRanks);
  const fMetrics = aggregate(fallbackRanks);

  logPerQueryResults(results);
  logDisagreements(results);
  logSummary(
    oMetrics,
    fMetrics,
    ollamaQueryTotal,
    fallbackQueryTotal,
    ollamaCorpusMs,
    fallbackCorpusMs,
  );
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
