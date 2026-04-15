#!/usr/bin/env bun
/**
 * Edge-Fact Embedder Benchmark
 *
 * Extracts edge facts from the real cc-retro corpus using the production
 * extractor (Ollama qwen3.5), then benchmarks both embedders on the
 * extracted facts. This is the workload that GraphRAG actually runs against.
 *
 * Pipeline:
 *   1. Pull retro findings via cc-retro CLI
 *   2. Sample N findings, extract edges from each via real extractor
 *   3. Build labeled queries against the extracted edges
 *   4. Embed all edges with both embedders, run queries, report metrics
 *
 * Why this matters: previous benchmarks measured full-document retrieval,
 * which is not the GraphRAG workload. Edge facts are short (~50-150 chars),
 * factually dense, and proper-noun heavy — a different distribution.
 */

import { spawn } from "bun";
import { extract } from "../src/lib/extractor.ts";
import { embed } from "../src/lib/embedder.ts";
import { embedFallback } from "../src/lib/fallback-embedder.ts";

interface RetroFinding {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: string;
  proposed_fix: string | null;
}

interface ExtractedEdge {
  edgeId: string;       // synthetic id: "${findingId}-${edgeIndex}"
  findingId: number;
  fact: string;
  relationType: string;
  source: string;       // entity name
  target: string;       // entity name
}

interface LabeledQuery {
  query: string;
  expectedFindingId: number;     // expected: any edge from this finding wins
  expectedKeywords?: string[];   // OR: any edge whose fact contains these
  tests: string;
}

interface QueryOutcome {
  query: string;
  tests: string;
  oRank: number;
  fRank: number;
  oHit?: { findingId: number; fact: string };
  fHit?: { findingId: number; fact: string };
}

interface AggregateMetrics {
  r1: number;
  r5: number;
  r10: number;
  mrr: number;
}

// ============================================================================
// Phase 1: load + extract
// ============================================================================

function isTestEntry(f: RetroFinding): boolean {
  const t = f.title.toLowerCase();
  const d = f.description.trim().toLowerCase();
  return t.startsWith("test") || t.includes("sandbox") || t.includes("delete me") ||
         d === "test" || d === "updated desc" || d === "a test finding for dashboard" ||
         d === "this should show as draft";
}

async function loadCorpus(): Promise<RetroFinding[]> {
  const proc = spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const all: RetroFinding[] = JSON.parse(output);
  return all.filter((f) => !isTestEntry(f));
}

function findingText(f: RetroFinding): string {
  const parts = [`[${f.category}/${f.severity}] ${f.title}`, f.description];
  if (f.proposed_fix) parts.push(`Fix: ${f.proposed_fix}`);
  return parts.join("\n\n");
}

async function extractEdgesFromCorpus(
  corpus: RetroFinding[],
  cacheFile: string,
): Promise<ExtractedEdge[]> {
  // Try cache first — extraction is slow
  try {
    const cached = await Bun.file(cacheFile).json();
    if (Array.isArray(cached) && cached.length > 0) {
      console.error(`[edges] loaded ${cached.length} edges from cache: ${cacheFile}`);
      return cached;
    }
  } catch {
    // No cache, extract fresh
  }

  console.error(`[edges] extracting from ${corpus.length} findings (no cache)...`);
  const edges: ExtractedEdge[] = [];
  let succeeded = 0, failed = 0, totalEdges = 0;
  const start = performance.now();

  for (let i = 0; i < corpus.length; i++) {
    const f = corpus[i]!;
    const progress = `[${i + 1}/${corpus.length}]`;
    try {
      const fStart = performance.now();
      const result = await extract(findingText(f));
      const fMs = Math.round(performance.now() - fStart);
      for (let j = 0; j < result.edges.length; j++) {
        const e = result.edges[j]!;
        const src = result.entities[e.sourceIndex];
        const tgt = result.entities[e.targetIndex];
        if (!src || !tgt) continue;
        edges.push({
          edgeId: `${f.id}-${j}`,
          findingId: f.id,
          fact: e.fact,
          relationType: e.relationType,
          source: src.name,
          target: tgt.name,
        });
      }
      succeeded++;
      totalEdges += result.edges.length;
      console.error(`${progress} #${f.id} → ${result.edges.length} edges (${fMs}ms): ${f.title.slice(0, 60)}`);
    } catch (err) {
      failed++;
      console.error(`${progress} #${f.id} FAILED: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
    }
  }
  const totalMs = Math.round(performance.now() - start);
  console.error(`\n[edges] done: ${edges.length} edges from ${succeeded}/${corpus.length} findings (${failed} failures) in ${(totalMs / 1000).toFixed(1)}s`);
  console.error(`[edges] avg ${(totalMs / corpus.length).toFixed(0)}ms per finding, ${(totalEdges / Math.max(succeeded, 1)).toFixed(1)} edges per finding`);

  // Cache for re-runs
  await Bun.write(cacheFile, JSON.stringify(edges, null, 2));
  console.error(`[edges] cached to ${cacheFile}`);
  return edges;
}

function formatRank(rank: number): string {
  return rank === Infinity ? "MISS" : `#${rank}`;
}

function pickWinner(ollamaRank: number, fallbackRank: number): string {
  if (ollamaRank < fallbackRank) return "Ollama";
  if (fallbackRank < ollamaRank) return "Built-in";
  return "tie";
}

function aggregate(ranks: number[]): AggregateMetrics {
  const r1 = ranks.filter((rank) => rank === 1).length / ranks.length;
  const r5 = ranks.filter((rank) => rank <= 5).length / ranks.length;
  const r10 = ranks.filter((rank) => rank <= 10).length / ranks.length;
  const mrr = ranks.reduce((sum, rank) => sum + (rank === Infinity ? 0 : 1 / rank), 0) / ranks.length;
  return { r1, r5, r10, mrr };
}

function logMissingQueries(sample: RetroFinding[]): void {
  const sampleIds = new Set(sample.map((finding) => finding.id));
  const missingQueries = QUERIES.filter((query) => query.expectedFindingId > 0 && !sampleIds.has(query.expectedFindingId));
  if (missingQueries.length === 0) return;

  console.error(`WARN: ${missingQueries.length}/${QUERIES.length} queries reference findings not in sample:`);
  for (const query of missingQueries) {
    console.error(`  "${query.query}" expects #${query.expectedFindingId}`);
  }
  console.error("");
}

function logSampleEdges(edges: ExtractedEdge[]): void {
  console.error(`\n[edges] sample fact lengths: ${edges.slice(0, 5).map((edge) => edge.fact.length).join(", ")}... (chars)`);
  console.error("[edges] sample facts:");
  for (const edge of edges.slice(0, 3)) {
    console.error(`  ${edge.edgeId} [${edge.relationType}] ${edge.fact}`);
  }
}

async function embedEdgeFacts(
  label: string,
  edges: ExtractedEdge[],
  embedFn: (text: string) => Promise<number[]>,
): Promise<{ embeddings: Map<string, number[]>; elapsedMs: number }> {
  console.error(label);
  const embeddings = new Map<string, number[]>();
  const startedAt = performance.now();
  for (const edge of edges) {
    const embedding = await embedFn(edge.fact);
    if (embedding.length > 0) embeddings.set(edge.edgeId, embedding);
  }
  return {
    embeddings,
    elapsedMs: performance.now() - startedAt,
  };
}

async function evaluateQueries(
  edges: ExtractedEdge[],
  ollamaEmbs: Map<string, number[]>,
  fallbackEmbs: Map<string, number[]>,
): Promise<{ results: QueryOutcome[]; oQueryTotal: number; fQueryTotal: number }> {
  let oQueryTotal = 0;
  let fQueryTotal = 0;
  const results: QueryOutcome[] = [];

  for (const query of QUERIES) {
    const ollamaStartedAt = performance.now();
    const ollamaEmbedding = await embed(query.query);
    oQueryTotal += performance.now() - ollamaStartedAt;

    const fallbackStartedAt = performance.now();
    const fallbackEmbedding = await embedFallback(query.query);
    fQueryTotal += performance.now() - fallbackStartedAt;

    const ollamaRanked = rankEdges(ollamaEmbedding, ollamaEmbs, edges);
    const fallbackRanked = rankEdges(fallbackEmbedding, fallbackEmbs, edges);
    const ollamaHit = isHit(ollamaRanked, query, 50);
    const fallbackHit = isHit(fallbackRanked, query, 50);

    results.push({
      query: query.query,
      tests: query.tests,
      oRank: ollamaHit.hitRank,
      fRank: fallbackHit.hitRank,
      oHit: ollamaHit.hitEdge,
      fHit: fallbackHit.hitEdge,
    });
  }

  return { results, oQueryTotal, fQueryTotal };
}

function logPerQueryResults(results: QueryOutcome[]): void {
  console.log("\n" + "=".repeat(110));
  console.log("Per-query results (rank of first matching edge — lower is better)");
  console.log("=".repeat(110));
  console.log("\nQuery".padEnd(60) + "Built-in".padEnd(11) + "Ollama".padEnd(11) + "Winner");
  console.log("-".repeat(110));
  for (const result of results) {
    const queryLabel = result.query.length > 56 ? result.query.slice(0, 53) + "..." : result.query;
    const ollamaRank = formatRank(result.oRank);
    const fallbackRank = formatRank(result.fRank);
    const winner = pickWinner(result.oRank, result.fRank);
    console.log(queryLabel.padEnd(60) + fallbackRank.padEnd(11) + ollamaRank.padEnd(11) + winner);
  }
}

function logDisagreements(results: QueryOutcome[]): void {
  const disagreements = results.filter((result) => result.oRank !== result.fRank);
  if (disagreements.length === 0) return;

  console.log("\n" + "=".repeat(110));
  console.log(`Disagreements (${disagreements.length}/${results.length}):`);
  console.log("=".repeat(110));
  for (const result of disagreements) {
    const builtInFact = result.fHit ? ` [${result.fHit.fact.slice(0, 70)}]` : "";
    const ollamaFact = result.oHit ? ` [${result.oHit.fact.slice(0, 70)}]` : "";
    console.log(`\nQuery: "${result.query}"`);
    console.log(`  Tests: ${result.tests}`);
    console.log(`  Built-in rank: ${formatRank(result.fRank)}${builtInFact}`);
    console.log(`  Ollama   rank: ${formatRank(result.oRank)}${ollamaFact}`);
  }
}

function logSummary(
  edges: ExtractedEdge[],
  sample: RetroFinding[],
  results: QueryOutcome[],
  fMetrics: AggregateMetrics,
  oMetrics: AggregateMetrics,
  fQueryTotal: number,
  oQueryTotal: number,
  fCorpusMs: number,
  oCorpusMs: number,
): void {
  console.log("\n" + "=".repeat(110));
  console.log("Summary — Edge-Fact Retrieval Benchmark");
  console.log("=".repeat(110));
  console.log(`\nCorpus:  ${edges.length} extracted edge facts from ${sample.length} retro findings`);
  console.log(`Queries: ${QUERIES.length} labeled\n`);
  console.log("Metric        Built-in   Ollama     Delta");
  console.log("-".repeat(50));
  console.log(`Recall@1      ${(fMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${(oMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${((oMetrics.r1 - fMetrics.r1) * 100).toFixed(0)}pp`);
  console.log(`Recall@5      ${(fMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${(oMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${((oMetrics.r5 - fMetrics.r5) * 100).toFixed(0)}pp`);
  console.log(`Recall@10     ${(fMetrics.r10 * 100).toFixed(0).padStart(3)}%       ${(oMetrics.r10 * 100).toFixed(0).padStart(3)}%       ${((oMetrics.r10 - fMetrics.r10) * 100).toFixed(0)}pp`);
  console.log(`MRR           ${fMetrics.mrr.toFixed(3)}     ${oMetrics.mrr.toFixed(3)}     ${(oMetrics.mrr - fMetrics.mrr).toFixed(3)}`);
  console.log();
  console.log("Latency per query:");
  console.log(`  Built-in: ${(fQueryTotal / QUERIES.length).toFixed(1)}ms avg`);
  console.log(`  Ollama:   ${(oQueryTotal / QUERIES.length).toFixed(0)}ms avg`);
  console.log(`  Speedup:  ${(oQueryTotal / fQueryTotal).toFixed(0)}x`);
  console.log();
  console.log("Corpus embed time:");
  console.log(`  Built-in: ${fCorpusMs.toFixed(0)}ms (${edges.length} edges, avg ${(fCorpusMs / edges.length).toFixed(1)}ms)`);
  console.log(`  Ollama:   ${oCorpusMs.toFixed(0)}ms (${edges.length} edges, avg ${(oCorpusMs / edges.length).toFixed(0)}ms)`);
  console.log(`  Speedup:  ${(oCorpusMs / fCorpusMs).toFixed(0)}x`);
  console.log();

  let verdict = "Built-in is good enough — complementary Ollama not justified for edge facts";
  if (oMetrics.mrr - fMetrics.mrr > 0.05) verdict = "Ollama is meaningfully better — complementary embedder earns its keep";
  if (fMetrics.mrr - oMetrics.mrr > 0.05) verdict = "Built-in is meaningfully better — complementary not needed";
  console.log(`Verdict: ${verdict}`);
}

// ============================================================================
// Phase 2: labeled queries
// ============================================================================
//
// Queries target edges by FINDING (any edge from finding #N is a hit) or by
// KEYWORD (any edge whose fact contains all of the listed keywords). The
// finding-id approach is more permissive — many findings have 5+ edges and
// any one of them surfacing is a successful retrieval.
//
const QUERIES: LabeledQuery[] = [
  // Specific paraphrase queries
  { query: "what state library does dashframe use", expectedFindingId: 0, expectedKeywords: ["zustand"], tests: "paraphrase against any zustand-related fact" },
  { query: "shipping code with tests still failing", expectedFindingId: 130, tests: "edges from 'pushed failing tests' finding" },
  { query: "quality drops as session gets longer", expectedFindingId: 124, tests: "edges from 'quality degrades' finding" },
  { query: "marking acceptance criteria pass without runtime check", expectedFindingId: 121, tests: "completion bias edges" },
  { query: "review skipped runtime verification entirely", expectedFindingId: 138, tests: "zero-QA edges" },
  { query: "blind CSS iteration without root cause investigation", expectedFindingId: 23, tests: "Electron drag region edges" },
  { query: "wrong browser test tool chosen for electron app", expectedFindingId: 123, tests: "chrome-tester misuse edges" },
  { query: "parallel review agents found complementary issues", expectedFindingId: 127, tests: "positive parallel-review edges" },
  { query: "skipped code review after migration", expectedFindingId: 14, tests: "post-migration review skip" },
  { query: "started implementation before user confirmation", expectedFindingId: 19, tests: "eager execution edges" },
  { query: "claude too compliant when user wants pushback", expectedFindingId: 22, tests: "pushback failure edges" },
  { query: "tailwind v4 from-white gradient bug", expectedFindingId: 8, tests: "specific tailwind bug" },
  { query: "electron loaded wrong dev server port", expectedFindingId: 24, tests: "specific port bug" },
  { query: "scroll bug debugged by reading code without browser", expectedFindingId: 113, tests: "no-runtime-evidence scroll edges" },
  { query: "blind iteration on glass surface UI", expectedFindingId: 7, tests: "specific glass surface edges" },
  { query: "overwrote a fix without understanding existing logic", expectedFindingId: 111, tests: "overwrite edges" },
  { query: "subagent missed files in mechanical update", expectedFindingId: 88, tests: "subagent coverage edges" },
  { query: "browser tool thrashing between three options", expectedFindingId: 78, tests: "browser tool churn edges" },
  { query: "narrowing review scope between rounds", expectedFindingId: 122, tests: "scope narrowing edges" },
  { query: "skill not loaded when it should have been", expectedFindingId: 85, tests: "skill loading failure edges" },
];

// ============================================================================
// Math + ranking
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

function rankEdges(
  queryEmb: number[],
  edgeEmbs: Map<string, number[]>,
  edges: ExtractedEdge[],
): Array<{ edgeId: string; findingId: number; fact: string; rank: number; score: number }> {
  const scored = edges
    .filter((e) => edgeEmbs.has(e.edgeId))
    .map((e) => ({
      edgeId: e.edgeId,
      findingId: e.findingId,
      fact: e.fact,
      score: cosine(queryEmb, edgeEmbs.get(e.edgeId)!),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.map((x, i) => ({ ...x, rank: i + 1 }));
}

function isHit(
  ranked: Array<{ findingId: number; fact: string }>,
  q: LabeledQuery,
  topK: number,
): { hitRank: number; hitEdge?: { findingId: number; fact: string } } {
  for (let i = 0; i < Math.min(ranked.length, topK); i++) {
    const r = ranked[i]!;
    // Match by finding id
    if (q.expectedFindingId > 0 && r.findingId === q.expectedFindingId) {
      return { hitRank: i + 1, hitEdge: r };
    }
    // OR match by keywords (all must appear, case-insensitive)
    if (q.expectedKeywords && q.expectedKeywords.length > 0) {
      const factLower = r.fact.toLowerCase();
      if (q.expectedKeywords.every((k) => factLower.includes(k.toLowerCase()))) {
        return { hitRank: i + 1, hitEdge: r };
      }
    }
  }
  return { hitRank: Infinity };
}

// ============================================================================
// Main
// ============================================================================

const SAMPLE_SIZE = parseInt(process.env.SAMPLE ?? "40", 10);
const CACHE_FILE = `/tmp/retro-edges-sample-${SAMPLE_SIZE}.json`;

async function main() {
  // ------- Load + sample corpus -------
  console.error("Loading cc-retro corpus...");
  const all = await loadCorpus();
  // Sample by ID — pick the most recent N (highest IDs) for representative content
  const sample = [...all].sort((a, b) => b.id - a.id).slice(0, SAMPLE_SIZE);
  console.error(`Sampled ${sample.length} of ${all.length} findings (most recent by id)\n`);

  // Verify queries point to findings in the sample
  logMissingQueries(sample);

  // ------- Extract edges -------
  const edges = await extractEdgesFromCorpus(sample, CACHE_FILE);
  if (edges.length === 0) {
    console.error("No edges extracted, aborting");
    process.exit(1);
  }
  logSampleEdges(edges);

  // ------- Embed all edges with both -------
  const ollamaCorpus = await embedEdgeFacts(
    `\nEmbedding ${edges.length} edges with Ollama (qwen3-embedding:4b, 2560-dim)...`,
    edges,
    embed,
  );
  const ollamaEmbs = ollamaCorpus.embeddings;
  const oCorpusMs = ollamaCorpus.elapsedMs;
  console.error(`  ${ollamaEmbs.size}/${edges.length} embedded in ${oCorpusMs.toFixed(0)}ms (avg ${(oCorpusMs / edges.length).toFixed(0)}ms)`);

  const fallbackCorpus = await embedEdgeFacts(
    `Embedding ${edges.length} edges with Fallback (snowflake-arctic-xs, 384-dim)...`,
    edges,
    embedFallback,
  );
  const fallbackEmbs = fallbackCorpus.embeddings;
  const fCorpusMs = fallbackCorpus.elapsedMs;
  console.error(`  ${fallbackEmbs.size}/${edges.length} embedded in ${fCorpusMs.toFixed(0)}ms (avg ${(fCorpusMs / edges.length).toFixed(1)}ms)`);

  // ------- Run queries -------
  const { results, oQueryTotal, fQueryTotal } = await evaluateQueries(edges, ollamaEmbs, fallbackEmbs);
  const oM = aggregate(results.map((result) => result.oRank));
  const fM = aggregate(results.map((result) => result.fRank));

  logPerQueryResults(results);
  logDisagreements(results);
  logSummary(edges, sample, results, fM, oM, fQueryTotal, oQueryTotal, fCorpusMs, oCorpusMs);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
