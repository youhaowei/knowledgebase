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
const CACHE_FILE = process.env.CACHE_FILE ?? "/tmp/retro-edges-sample-30.json";
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

  // Load corpus metadata for category-based candidate selection
  console.error(`Loading retro corpus metadata...`);
  const proc = Bun.spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const allFindings: RetroFinding[] = JSON.parse(await new Response(proc.stdout).text());
  await proc.exited;
  const findingsById = new Map<number, RetroFinding>(allFindings.map((f) => [f.id, f]));
  console.error(`Loaded ${findingsById.size} findings\n`);

  // Embed all edges with both
  console.error("Embedding edges with Ollama (qwen3-embedding:4b)...");
  const ollamaEmbs = new Map<string, number[]>();
  const oStart = performance.now();
  for (const e of allEdges) {
    const emb = await embed(e.fact);
    if (emb.length > 0) ollamaEmbs.set(e.edgeId, emb);
  }
  const oCorpusMs = performance.now() - oStart;
  console.error(`  ${ollamaEmbs.size}/${allEdges.length} embedded in ${oCorpusMs.toFixed(0)}ms`);

  console.error("Embedding edges with Fallback (snowflake-arctic-xs)...");
  const fallbackEmbs = new Map<string, number[]>();
  const fStart = performance.now();
  for (const e of allEdges) {
    const emb = await embedFallback(e.fact);
    if (emb.length > 0) fallbackEmbs.set(e.edgeId, emb);
  }
  const fCorpusMs = performance.now() - fStart;
  console.error(`  ${fallbackEmbs.size}/${allEdges.length} embedded in ${fCorpusMs.toFixed(0)}ms\n`);

  // Run queries
  const results: RerankResult[] = [];
  for (const q of QUERIES) {
    const r = await rerankForQuery(q, findingsById, allEdges, ollamaEmbs, fallbackEmbs);
    results.push(r);
  }

  // ------- Per-query report -------
  console.log("\n" + "=".repeat(110));
  console.log("Per-query results — edge rank within ${CANDIDATE_K}-memory candidate set");
  console.log("=".repeat(110));
  console.log("\nQuery".padEnd(58) + "Cands".padEnd(8) + "Built-in".padEnd(11) + "Ollama".padEnd(11) + "Winner");
  console.log("-".repeat(110));
  for (const r of results) {
    const q = r.query.length > 54 ? r.query.slice(0, 51) + "..." : r.query;
    const oStr = r.oRank === Infinity ? "MISS" : `#${r.oRank}`;
    const fStr = r.fRank === Infinity ? "MISS" : `#${r.fRank}`;
    const winner =
      r.oRank < r.fRank ? "Ollama"
      : r.fRank < r.oRank ? "Built-in"
      : "tie";
    console.log(q.padEnd(58) + String(r.candidateEdgeCount).padEnd(8) + fStr.padEnd(11) + oStr.padEnd(11) + winner);
  }

  // ------- Disagreements -------
  const disagreements = results.filter((r) => r.oRank !== r.fRank);
  if (disagreements.length > 0) {
    console.log("\n" + "=".repeat(110));
    console.log(`Disagreements (${disagreements.length}/${results.length}):`);
    console.log("=".repeat(110));
    for (const r of disagreements) {
      console.log(`\nQuery: "${r.query}"`);
      console.log(`  Expected: finding #${r.expectedFindingId}`);
      console.log(`  Candidate set: ${r.candidateEdgeCount} edges from memories ${r.candidateMemoryIds.join(", ")}`);
      console.log(`  Built-in #${r.fRank === Infinity ? "MISS" : r.fRank}: ${r.fTopFact?.slice(0, 90)}`);
      console.log(`  Ollama   #${r.oRank === Infinity ? "MISS" : r.oRank}: ${r.oTopFact?.slice(0, 90)}`);
    }
  }

  // ------- Aggregate -------
  function agg(ranks: number[]) {
    const r1 = ranks.filter((r) => r === 1).length / ranks.length;
    const r3 = ranks.filter((r) => r <= 3).length / ranks.length;
    const r5 = ranks.filter((r) => r <= 5).length / ranks.length;
    const mrr = ranks.reduce((s, r) => s + (r === Infinity ? 0 : 1 / r), 0) / ranks.length;
    return { r1, r3, r5, mrr };
  }
  const oM = agg(results.map((r) => r.oRank));
  const fM = agg(results.map((r) => r.fRank));

  // ------- Summary -------
  console.log("\n" + "=".repeat(110));
  console.log("Summary — Edge Re-Ranking Within Candidate Set");
  console.log("=".repeat(110));
  console.log(`\nCorpus:           ${allEdges.length} edges from 30 findings`);
  console.log(`Candidate K:      ${CANDIDATE_K} memories per query (~${Math.round(allEdges.length * CANDIDATE_K / 30)} edges in set)`);
  console.log(`Queries:          ${QUERIES.length}`);
  console.log(`Avg candidate set size: ${(results.reduce((s, r) => s + r.candidateEdgeCount, 0) / results.length).toFixed(1)} edges\n`);
  console.log("Metric        Built-in   Ollama     Delta");
  console.log("-".repeat(50));
  console.log(`Recall@1      ${(fM.r1 * 100).toFixed(0).padStart(3)}%       ${(oM.r1 * 100).toFixed(0).padStart(3)}%       ${((oM.r1 - fM.r1) * 100).toFixed(0)}pp`);
  console.log(`Recall@3      ${(fM.r3 * 100).toFixed(0).padStart(3)}%       ${(oM.r3 * 100).toFixed(0).padStart(3)}%       ${((oM.r3 - fM.r3) * 100).toFixed(0)}pp`);
  console.log(`Recall@5      ${(fM.r5 * 100).toFixed(0).padStart(3)}%       ${(oM.r5 * 100).toFixed(0).padStart(3)}%       ${((oM.r5 - fM.r5) * 100).toFixed(0)}pp`);
  console.log(`MRR           ${fM.mrr.toFixed(3)}     ${oM.mrr.toFixed(3)}     ${(oM.mrr - fM.mrr).toFixed(3)}`);
  console.log();

  const verdict =
    oM.mrr - fM.mrr > 0.05 ? "Complementary Ollama meaningfully better — earns its keep"
    : fM.mrr - oM.mrr > 0.05 ? "Built-in meaningfully better — Ollama not justified"
    : "Tie within noise — Built-in is good enough for edge re-ranking";
  console.log(`Verdict: ${verdict}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
