#!/usr/bin/env bun
/**
 * Edge Re-Ranking Benchmark — the real GraphRAG retrieval workload
 *
 * Measures embedder quality at the operation that actually happens in
 * production: re-ranking edges from a small candidate set surfaced by
 * memory-text retrieval. This is NOT cold-start retrieval — that's a
 * separate workload that runs against memory embeddings, not edge embeddings.
 *
 * Pipeline simulated:
 *   1. (assumed) Memory text retrieval finds top-K=5 candidate memories
 *   2. Gather all edges from those K memories → ~25-50 edge candidate set
 *   3. Embed-rank those edges → measure rank of expected answer
 *
 * To simulate step 1 without running a full memory retrieval, we pick the
 * candidate memories deterministically: the expected memory + 4 nearest
 * neighbors by category. This produces a hard-negative-rich candidate set
 * with the same kind of vocabulary overlap as a real text-retrieval result.
 */

import { join } from "path";
import { embed } from "../src/lib/embedder.ts";
import { embedFallback } from "../src/lib/fallback-embedder.ts";

interface ExtractedEdge {
  edgeId: string;
  findingId: number;
  fact: string;
  relationType: string;
  source: string;
  target: string;
}

interface RetroFinding {
  id: number;
  title: string;
  description: string;
  category: string;
  severity: string;
}

interface LabeledQuery {
  query: string;
  expectedFindingId: number;
  tests: string;
}

// All queries target findings 114-143 — the 30 most-recent findings that
// all four extractors were run against. No out-of-range references.
const QUERIES: LabeledQuery[] = [
  // === Kept from original (already in range 114-143) ===
  { query: "shipping code with tests still failing", expectedFindingId: 130, tests: "pushed failing tests" },
  { query: "quality drops as session gets longer", expectedFindingId: 124, tests: "session length quality" },
  { query: "marking acceptance criteria pass without runtime check", expectedFindingId: 121, tests: "completion bias" },
  { query: "review skipped runtime verification entirely", expectedFindingId: 138, tests: "zero-QA review" },
  { query: "wrong browser test tool chosen for electron app", expectedFindingId: 123, tests: "chrome-tester misuse" },
  { query: "parallel review agents found complementary issues", expectedFindingId: 127, tests: "positive parallel review" },
  { query: "narrowing review scope between rounds", expectedFindingId: 122, tests: "scope narrowing" },
  { query: "design iteration through conversation", expectedFindingId: 119, tests: "conversation-driven design" },

  // === New queries targeting in-range findings ===
  { query: "simplify and preflight must run before reviewers", expectedFindingId: 141, tests: "review sequencing" },
  { query: "audit should check existing Notion tasks before reporting", expectedFindingId: 140, tests: "cross-reference tasks" },
  { query: "codex agent never invoked unless skill forces it", expectedFindingId: 139, tests: "codex underutilized" },
  { query: "retro skipped the interactive per-finding triage", expectedFindingId: 137, tests: "retro triage skipped" },
  { query: "tickets created with premature estimates before scoping", expectedFindingId: 136, tests: "premature estimates" },
  { query: "electron-builder migration to bun went smoothly", expectedFindingId: 135, tests: "successful migration" },
  { query: "submodule changes pushed directly instead of PR", expectedFindingId: 134, tests: "submodule push" },
  { query: "user prefers teams over sub-agents for parallel work", expectedFindingId: 133, tests: "teams vs subagents" },
  { query: "theorized about root cause without verifying empirically", expectedFindingId: 131, tests: "theorize vs verify" },
  { query: "review skill missing a runtime verification component", expectedFindingId: 129, tests: "review lacks QA" },
  { query: "pre-existing test failures dismissed as not our problem", expectedFindingId: 125, tests: "dismissed failures" },
  { query: "chose chrome-tester when agent-browser was correct", expectedFindingId: 114, tests: "chrome-tester misuse 2" },
];

// CACHE_FILE: pass via env, defaults to original qwen3.5 cache
//   CACHE_FILE=/tmp/retro-edges-gemma3-4b-sample-30.json bun run ...
//   CACHE_FILE=/tmp/retro-edges-qwen3-1.7b-sample-30.json bun run ...
const CACHE_FILE = process.env.CACHE_FILE ?? join(import.meta.dir, ".cache", "retro-edges-sample-30.json");
const CANDIDATE_K = 5;  // memory candidate set size — simulates top-5 from text retrieval

// ============================================================================
// Math
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

// ============================================================================
// Candidate set selection
// ============================================================================
//
// Simulates "top-K memories surfaced by text retrieval" by picking the
// expected memory + (K-1) others from the same category. This produces a
// realistic candidate set with vocabulary overlap (hard negatives) without
// needing to actually run text retrieval inside the benchmark.
//
function pickCandidateMemories(
  expectedFindingId: number,
  findingsById: Map<number, RetroFinding>,
  k: number,
): number[] {
  const expected = findingsById.get(expectedFindingId);
  if (!expected) return [expectedFindingId];

  // Get other findings in the same category, sorted by id desc (most recent first)
  const sameCategory = [...findingsById.values()]
    .filter((f) => f.id !== expectedFindingId && f.category === expected.category)
    .sort((a, b) => b.id - a.id)
    .slice(0, k - 1)
    .map((f) => f.id);

  return [expectedFindingId, ...sameCategory];
}

function gatherCandidateEdges(
  candidateMemoryIds: number[],
  allEdges: ExtractedEdge[],
): ExtractedEdge[] {
  const idSet = new Set(candidateMemoryIds);
  return allEdges.filter((e) => idSet.has(e.findingId));
}

// ============================================================================
// Per-query rerank
// ============================================================================

interface RerankResult {
  query: string;
  expectedFindingId: number;
  candidateMemoryIds: number[];
  candidateEdgeCount: number;
  oRank: number;
  fRank: number;
  oTopFact?: string;
  fTopFact?: string;
}

interface AggregateMetrics {
  r1: number;
  r3: number;
  r5: number;
  mrr: number;
}

function aggregate(ranks: number[]): AggregateMetrics {
  const r1 = ranks.filter((rank) => rank === 1).length / ranks.length;
  const r3 = ranks.filter((rank) => rank <= 3).length / ranks.length;
  const r5 = ranks.filter((rank) => rank <= 5).length / ranks.length;
  const mrr = ranks.reduce((sum, rank) => sum + (rank === Infinity ? 0 : 1 / rank), 0) / ranks.length;
  return { r1, r3, r5, mrr };
}

function formatRank(rank: number): string {
  return rank === Infinity ? "MISS" : `#${rank}`;
}

function pickWinner(ollamaRank: number, fallbackRank: number): string {
  if (ollamaRank < fallbackRank) return "Ollama";
  if (fallbackRank < ollamaRank) return "Built-in";
  return "tie";
}

async function loadFindingsMetadata(): Promise<Map<number, RetroFinding>> {
  console.error("Loading retro corpus metadata...");
  const proc = Bun.spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const allFindings: RetroFinding[] = JSON.parse(await new Response(proc.stdout).text());
  await proc.exited;
  return new Map<number, RetroFinding>(allFindings.map((finding) => [finding.id, finding]));
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

async function runQueries(
  findingsById: Map<number, RetroFinding>,
  allEdges: ExtractedEdge[],
  ollamaEmbs: Map<string, number[]>,
  fallbackEmbs: Map<string, number[]>,
): Promise<RerankResult[]> {
  const results: RerankResult[] = [];
  for (const query of QUERIES) {
    results.push(await rerankForQuery(query, findingsById, allEdges, ollamaEmbs, fallbackEmbs));
  }
  return results;
}

function logPerQueryResults(results: RerankResult[]): void {
  console.log("\n" + "=".repeat(110));
  console.log(`Per-query results — edge rank within ${CANDIDATE_K}-memory candidate set`);
  console.log("=".repeat(110));
  console.log("\nQuery".padEnd(58) + "Cands".padEnd(8) + "Built-in".padEnd(11) + "Ollama".padEnd(11) + "Winner");
  console.log("-".repeat(110));
  for (const result of results) {
    const queryLabel = result.query.length > 54 ? result.query.slice(0, 51) + "..." : result.query;
    const ollamaRank = formatRank(result.oRank);
    const fallbackRank = formatRank(result.fRank);
    const winner = pickWinner(result.oRank, result.fRank);
    console.log(queryLabel.padEnd(58) + String(result.candidateEdgeCount).padEnd(8) + fallbackRank.padEnd(11) + ollamaRank.padEnd(11) + winner);
  }
}

function logDisagreements(results: RerankResult[]): void {
  const disagreements = results.filter((result) => result.oRank !== result.fRank);
  if (disagreements.length === 0) return;

  console.log("\n" + "=".repeat(110));
  console.log(`Disagreements (${disagreements.length}/${results.length}):`);
  console.log("=".repeat(110));
  for (const result of disagreements) {
    console.log(`\nQuery: "${result.query}"`);
    console.log(`  Expected: finding #${result.expectedFindingId}`);
    console.log(`  Candidate set: ${result.candidateEdgeCount} edges from memories ${result.candidateMemoryIds.join(", ")}`);
    console.log(`  Built-in ${formatRank(result.fRank)}: ${result.fTopFact?.slice(0, 90)}`);
    console.log(`  Ollama   ${formatRank(result.oRank)}: ${result.oTopFact?.slice(0, 90)}`);
  }
}

function logSummary(
  allEdges: ExtractedEdge[],
  results: RerankResult[],
  oMetrics: AggregateMetrics,
  fMetrics: AggregateMetrics,
): void {
  console.log("\n" + "=".repeat(110));
  console.log("Summary — Edge Re-Ranking Within Candidate Set");
  console.log("=".repeat(110));
  console.log(`\nCorpus:           ${allEdges.length} edges from 30 findings`);
  console.log(`Candidate K:      ${CANDIDATE_K} memories per query (~${Math.round(allEdges.length * CANDIDATE_K / 30)} edges in set)`);
  console.log(`Queries:          ${QUERIES.length}`);
  console.log(`Avg candidate set size: ${(results.reduce((sum, result) => sum + result.candidateEdgeCount, 0) / results.length).toFixed(1)} edges\n`);
  console.log("Metric        Built-in   Ollama     Delta");
  console.log("-".repeat(50));
  console.log(`Recall@1      ${(fMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${(oMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${((oMetrics.r1 - fMetrics.r1) * 100).toFixed(0)}pp`);
  console.log(`Recall@3      ${(fMetrics.r3 * 100).toFixed(0).padStart(3)}%       ${(oMetrics.r3 * 100).toFixed(0).padStart(3)}%       ${((oMetrics.r3 - fMetrics.r3) * 100).toFixed(0)}pp`);
  console.log(`Recall@5      ${(fMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${(oMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${((oMetrics.r5 - fMetrics.r5) * 100).toFixed(0)}pp`);
  console.log(`MRR           ${fMetrics.mrr.toFixed(3)}     ${oMetrics.mrr.toFixed(3)}     ${(oMetrics.mrr - fMetrics.mrr).toFixed(3)}`);
  console.log();

  let verdict = "Tie within noise — Built-in is good enough for edge re-ranking";
  if (oMetrics.mrr - fMetrics.mrr > 0.05) verdict = "Complementary Ollama meaningfully better — earns its keep";
  if (fMetrics.mrr - oMetrics.mrr > 0.05) verdict = "Built-in meaningfully better — Ollama not justified";
  console.log(`Verdict: ${verdict}`);
}

async function rerankForQuery(
  q: LabeledQuery,
  findingsById: Map<number, RetroFinding>,
  allEdges: ExtractedEdge[],
  ollamaEmbs: Map<string, number[]>,
  fallbackEmbs: Map<string, number[]>,
): Promise<RerankResult> {
  const candidateMemoryIds = pickCandidateMemories(q.expectedFindingId, findingsById, CANDIDATE_K);
  const candidates = gatherCandidateEdges(candidateMemoryIds, allEdges);

  const oQEmb = await embed(q.query);
  const fQEmb = await embedFallback(q.query);

  function rankCandidates(qEmb: number[], embs: Map<string, number[]>): Array<{ edge: ExtractedEdge; score: number }> {
    return candidates
      .filter((e) => embs.has(e.edgeId))
      .map((e) => ({ edge: e, score: cosine(qEmb, embs.get(e.edgeId)!) }))
      .sort((a, b) => b.score - a.score);
  }

  const oRanked = rankCandidates(oQEmb, ollamaEmbs);
  const fRanked = rankCandidates(fQEmb, fallbackEmbs);

  const oRank = oRanked.findIndex((r) => r.edge.findingId === q.expectedFindingId) + 1 || Infinity;
  const fRank = fRanked.findIndex((r) => r.edge.findingId === q.expectedFindingId) + 1 || Infinity;

  return {
    query: q.query,
    expectedFindingId: q.expectedFindingId,
    candidateMemoryIds,
    candidateEdgeCount: candidates.length,
    oRank,
    fRank,
    oTopFact: oRanked[0]?.edge.fact,
    fTopFact: fRanked[0]?.edge.fact,
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Load cached edges
  console.error(`Loading cached edges from ${CACHE_FILE}...`);
  const allEdges: ExtractedEdge[] = await Bun.file(CACHE_FILE).json();
  console.error(`Loaded ${allEdges.length} edges from ${new Set(allEdges.map((e) => e.findingId)).size} findings`);

  const findingsById = await loadFindingsMetadata();
  console.error(`Loaded ${findingsById.size} findings\n`);

  // Embed all edges with both
  const ollamaCorpus = await embedEdgeFacts("Embedding edges with Ollama (qwen3-embedding:4b)...", allEdges, embed);
  const ollamaEmbs = ollamaCorpus.embeddings;
  const oCorpusMs = ollamaCorpus.elapsedMs;
  console.error(`  ${ollamaEmbs.size}/${allEdges.length} embedded in ${oCorpusMs.toFixed(0)}ms`);

  const fallbackCorpus = await embedEdgeFacts("Embedding edges with Fallback (snowflake-arctic-xs)...", allEdges, embedFallback);
  const fallbackEmbs = fallbackCorpus.embeddings;
  const fCorpusMs = fallbackCorpus.elapsedMs;
  console.error(`  ${fallbackEmbs.size}/${allEdges.length} embedded in ${fCorpusMs.toFixed(0)}ms\n`);

  // Run queries
  const results = await runQueries(findingsById, allEdges, ollamaEmbs, fallbackEmbs);
  const oM = aggregate(results.map((result) => result.oRank));
  const fM = aggregate(results.map((result) => result.fRank));

  logPerQueryResults(results);
  logDisagreements(results);
  logSummary(allEdges, results, oM, fM);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
