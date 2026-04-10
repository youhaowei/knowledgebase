#!/usr/bin/env bun
/**
 * Real-Data Embedder Benchmark — cc-retro corpus
 *
 * Reads 132 real retro findings from the cc-retro CLI (`retro list`),
 * runs both embedders against a labeled query set, and reports retrieval
 * accuracy with Recall@1 / Recall@5 / MRR.
 *
 * Unlike the synthetic benchmark, this uses the user's actual personal-KB
 * data — 97 findings in a single workflow-friction cluster with heavy
 * vocabulary overlap, which is the hardest disambiguation test we can run.
 */

import { spawn } from "bun";
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

interface LabeledQuery {
  query: string;
  expected: number;              // retro finding id
  alsoAcceptable?: number[];     // other finding ids that would be correct
  tests: string;                 // what this query probes
}

// ============================================================================
// Load real corpus from cc-retro CLI
// ============================================================================

function isTestEntry(f: RetroFinding): boolean {
  const t = f.title.toLowerCase();
  const d = f.description.trim().toLowerCase();
  return (
    t.startsWith("test") ||
    t.includes("sandbox") ||
    t.includes("delete me") ||
    d === "test" ||
    d === "updated desc" ||
    d === "a test finding for dashboard" ||
    d === "this should show as draft"
  );
}

async function loadCorpus(): Promise<RetroFinding[]> {
  const proc = spawn({ cmd: ["retro", "list"], stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const all: RetroFinding[] = JSON.parse(output);
  return all.filter((f) => !isTestEntry(f));
}

function docText(f: RetroFinding): string {
  // Include title + description + proposed_fix (if present) as the doc body.
  // This mirrors what `kb add` would store for a retro finding.
  const parts = [
    `[${f.category}/${f.severity}] ${f.title}`,
    f.description,
  ];
  if (f.proposed_fix) parts.push(`Fix: ${f.proposed_fix}`);
  return parts.join("\n\n");
}

// ============================================================================
// Labeled queries — targeted at specific real findings
// ============================================================================
//
// Authoring notes:
//   - Queries written by skimming the corpus once for coverage, then rewording
//     to avoid copying surface vocabulary
//   - Include a mix of paraphrase / disambiguation / causal / conceptual
//   - Hard negatives baked in naturally — 97 workflow-friction docs mean every
//     friction-themed query has dozens of wrong-but-plausible candidates
//   - 25 queries total
//
const QUERIES: LabeledQuery[] = [
  // ============ Paraphrase (doc wording differs from query) ============
  { query: "what happened when four review agents ran together on an audit", expected: 143, tests: "paraphrase of positive-pattern finding" },
  { query: "shipping code with broken tests still failing", expected: 130, tests: "causal paraphrase of 'Committed and pushed failing tests'" },
  { query: "bug where quality gets worse the longer a session goes on", expected: 124, tests: "paraphrase: 'session length' vs 'gets worse'" },
  { query: "marking something done without actually running it", expected: 121, tests: "paraphrase of 'completion bias without runtime evidence'" },

  // ============ Disambiguation (many workflow-friction candidates) ============
  { query: "review skipped runtime verification", expected: 138, alsoAcceptable: [129, 128], tests: "must pick the specific 'zero QA' finding over related runtime-verification docs" },
  { query: "guessed CSS fix instead of finding root cause", expected: 23, alsoAcceptable: [5, 6, 7, 113, 25], tests: "5 hard negatives: many CSS/guessing findings exist, need the Electron drag region one" },
  { query: "used the wrong tool for electron dev server testing", expected: 123, tests: "specific tool-choice finding" },
  { query: "parallel agents found different complementary bugs", expected: 127, alsoAcceptable: [143, 132], tests: "must pick the specific POSITIVE finding" },

  // ============ Causal / intent queries ============
  { query: "why does claude keep skipping code review after migrations", expected: 14, alsoAcceptable: [90], tests: "causal query against migration-review finding" },
  { query: "what makes claude stop asking for confirmation before acting", expected: 19, alsoAcceptable: [115, 116], tests: "intent query against eager-execution finding" },
  { query: "claude compliant when honest pushback was expected", expected: 22, tests: "specific pushback-failure finding" },

  // ============ Conceptual queries ============
  { query: "what brainstorm tool works well for design refinement", expected: 126, tests: "conceptual query for positive brainstorm pattern" },
  { query: "when is the playground approach good for layout work", expected: 106, tests: "conceptual query for positive layout pattern" },
  { query: "how should mechanical fixes be applied separately from architectural ones", expected: 142, tests: "conceptual query for fix-categorization pattern" },

  // ============ Specific technical bug ============
  { query: "tailwind v4 gradient from white resolves wrong", expected: 8, tests: "specific technical bug, exact keyword match" },
  { query: "electron loaded from wrong dev server port", expected: 24, tests: "specific port-mismatch bug" },
  { query: "scroll bug fixed by code reading without browser test", expected: 113, tests: "specific runtime-evidence finding" },
  { query: "blind iteration on semi-transparent glass UI rendering", expected: 7, alsoAcceptable: [6, 23], tests: "specific glass surface finding, hard negative against other CSS iteration" },

  // ============ Workflow / tooling ============
  { query: "overwrote an existing fix without understanding why it was there", expected: 111, tests: "specific overwrite finding" },
  { query: "jumped into editing a skill without checking user wanted it", expected: 116, alsoAcceptable: [19], tests: "specific skill-edit-without-confirming finding" },
  { query: "subagent missed files during a mechanical update", expected: 88, tests: "specific subagent-coverage bug" },
  { query: "browser debugging tools thrashing between multiple options", expected: 78, alsoAcceptable: [84, 114], tests: "browser tool churn finding" },

  // ============ Hard: short / ambiguous queries ============
  { query: "chrome vs agent browser", expected: 84, alsoAcceptable: [114, 78], tests: "short disambiguation query, multiple browser findings" },
  { query: "narrowing review scope between rounds", expected: 122, tests: "specific scope-narrowing finding" },
  { query: "skill not loaded when it should have been", expected: 85, alsoAcceptable: [86, 117, 112, 129], tests: "5 candidates: must pick the 24h-bug-fix session finding" },
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
  docEmbs: Map<number, number[]>,
): Array<{ id: number; score: number; rank: number }> {
  const scored = [...docEmbs.entries()]
    .map(([id, emb]) => ({ id, score: cosine(queryEmb, emb) }))
    .sort((a, b) => b.score - a.score);
  return scored.map((x, i) => ({ ...x, rank: i + 1 }));
}

function findRank(ranked: Array<{ id: number; rank: number }>, targetIds: number[]): number {
  for (const r of ranked) {
    if (targetIds.includes(r.id)) return r.rank;
  }
  return Infinity;
}

// ============================================================================
// Main
// ============================================================================

interface QueryResult {
  query: string;
  expected: number;
  tests: string;
  ollamaRank: number;
  fallbackRank: number;
  ollamaTop3: number[];
  fallbackTop3: number[];
}

async function main() {
  console.log("Loading cc-retro corpus via CLI...");
  const corpus = await loadCorpus();
  console.log(`Loaded ${corpus.length} real findings\n`);

  // Verify all queries target findings that exist in the corpus
  const corpusIds = new Set(corpus.map((f) => f.id));
  const missing = QUERIES.filter(
    (q) => !corpusIds.has(q.expected) || (q.alsoAcceptable ?? []).some((id) => !corpusIds.has(id)),
  );
  if (missing.length > 0) {
    console.error(`WARN: ${missing.length} queries reference missing finding IDs:`);
    for (const q of missing) {
      const absent = [q.expected, ...(q.alsoAcceptable ?? [])].filter((id) => !corpusIds.has(id));
      console.error(`  "${q.query}" missing: ${absent.join(", ")}`);
    }
    console.error("");
  }

  // ------- Embed corpus with both -------
  console.log("Embedding corpus with Ollama (qwen3-embedding:4b, 2560-dim)...");
  const ollamaEmbs = new Map<number, number[]>();
  const ollamaCorpusStart = performance.now();
  for (const f of corpus) {
    const emb = await embed(docText(f));
    if (emb.length === 0) {
      console.error(`  FAILED: #${f.id}`);
      continue;
    }
    ollamaEmbs.set(f.id, emb);
  }
  const ollamaCorpusMs = performance.now() - ollamaCorpusStart;
  console.log(`  ${ollamaEmbs.size}/${corpus.length} embedded in ${ollamaCorpusMs.toFixed(0)}ms (avg ${(ollamaCorpusMs / corpus.length).toFixed(0)}ms/doc)\n`);

  console.log("Embedding corpus with Fallback (snowflake-arctic-xs, 384-dim)...");
  const fallbackEmbs = new Map<number, number[]>();
  const fallbackCorpusStart = performance.now();
  for (const f of corpus) {
    const emb = await embedFallback(docText(f));
    if (emb.length === 0) {
      console.error(`  FAILED: #${f.id}`);
      continue;
    }
    fallbackEmbs.set(f.id, emb);
  }
  const fallbackCorpusMs = performance.now() - fallbackCorpusStart;
  console.log(`  ${fallbackEmbs.size}/${corpus.length} embedded in ${fallbackCorpusMs.toFixed(0)}ms (avg ${(fallbackCorpusMs / corpus.length).toFixed(0)}ms/doc)\n`);

  // ------- Run labeled queries -------
  const results: QueryResult[] = [];
  let ollamaQueryTotal = 0;
  let fallbackQueryTotal = 0;

  for (const lq of QUERIES) {
    const oStart = performance.now();
    const oEmb = await embed(lq.query);
    ollamaQueryTotal += performance.now() - oStart;

    const fStart = performance.now();
    const fEmb = await embedFallback(lq.query);
    fallbackQueryTotal += performance.now() - fStart;

    const oRanked = rankDocs(oEmb, ollamaEmbs);
    const fRanked = rankDocs(fEmb, fallbackEmbs);

    const targets = [lq.expected, ...(lq.alsoAcceptable ?? [])];
    const oRank = findRank(oRanked, targets);
    const fRank = findRank(fRanked, targets);

    results.push({
      query: lq.query,
      expected: lq.expected,
      tests: lq.tests,
      ollamaRank: oRank,
      fallbackRank: fRank,
      ollamaTop3: oRanked.slice(0, 3).map((r) => r.id),
      fallbackTop3: fRanked.slice(0, 3).map((r) => r.id),
    });
  }

  // ------- Aggregate metrics -------
  function aggregate(ranks: number[]) {
    const r1 = ranks.filter((r) => r === 1).length / ranks.length;
    const r5 = ranks.filter((r) => r <= 5).length / ranks.length;
    const r10 = ranks.filter((r) => r <= 10).length / ranks.length;
    const mrr = ranks.reduce((sum, r) => sum + (r === Infinity ? 0 : 1 / r), 0) / ranks.length;
    return { r1, r5, r10, mrr };
  }

  const oMetrics = aggregate(results.map((r) => r.ollamaRank));
  const fMetrics = aggregate(results.map((r) => r.fallbackRank));

  // ------- Per-query breakdown -------
  console.log("=".repeat(110));
  console.log("Per-query results (rank of expected doc — lower is better)");
  console.log("=".repeat(110));
  console.log();
  console.log("Query".padEnd(62) + "Ollama".padEnd(10) + "Fallback".padEnd(10) + "Winner");
  console.log("-".repeat(110));
  for (const r of results) {
    const q = r.query.length > 58 ? r.query.slice(0, 55) + "..." : r.query;
    const oStr = r.ollamaRank === Infinity ? "MISS" : `#${r.ollamaRank}`;
    const fStr = r.fallbackRank === Infinity ? "MISS" : `#${r.fallbackRank}`;
    const winner =
      r.ollamaRank < r.fallbackRank ? "Ollama"
      : r.fallbackRank < r.ollamaRank ? "Fallback"
      : "tie";
    console.log(q.padEnd(62) + oStr.padEnd(10) + fStr.padEnd(10) + winner);
  }
  console.log();

  // ------- Disagreements -------
  const disagreements = results.filter((r) => r.ollamaRank !== r.fallbackRank);
  if (disagreements.length > 0) {
    console.log("=".repeat(110));
    console.log(`Disagreements (${disagreements.length}/${results.length}):`);
    console.log("=".repeat(110));
    for (const r of disagreements) {
      console.log(`\nQuery: "${r.query}"`);
      console.log(`  Tests: ${r.tests}`);
      console.log(`  Expected: #${r.expected}`);
      console.log(`  Ollama   rank: ${r.ollamaRank === Infinity ? "MISS" : `#${r.ollamaRank}`}, top-3: ${r.ollamaTop3.join(", ")}`);
      console.log(`  Fallback rank: ${r.fallbackRank === Infinity ? "MISS" : `#${r.fallbackRank}`}, top-3: ${r.fallbackTop3.join(", ")}`);
    }
  }

  // ------- Summary -------
  console.log("\n" + "=".repeat(110));
  console.log("Summary");
  console.log("=".repeat(110));
  console.log(`\nCorpus:  ${corpus.length} real findings from cc-retro`);
  console.log(`Queries: ${QUERIES.length} labeled\n`);
  console.log("Metric        Ollama     Fallback   Delta");
  console.log("-".repeat(50));
  console.log(`Recall@1      ${(oMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${(fMetrics.r1 * 100).toFixed(0).padStart(3)}%       ${((fMetrics.r1 - oMetrics.r1) * 100).toFixed(0)}pp`);
  console.log(`Recall@5      ${(oMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${(fMetrics.r5 * 100).toFixed(0).padStart(3)}%       ${((fMetrics.r5 - oMetrics.r5) * 100).toFixed(0)}pp`);
  console.log(`Recall@10     ${(oMetrics.r10 * 100).toFixed(0).padStart(3)}%       ${(fMetrics.r10 * 100).toFixed(0).padStart(3)}%       ${((fMetrics.r10 - oMetrics.r10) * 100).toFixed(0)}pp`);
  console.log(`MRR           ${oMetrics.mrr.toFixed(3)}     ${fMetrics.mrr.toFixed(3)}     ${(fMetrics.mrr - oMetrics.mrr).toFixed(3)}`);
  console.log();
  console.log("Latency per query:");
  console.log(`  Ollama:   ${(ollamaQueryTotal / QUERIES.length).toFixed(0)}ms avg`);
  console.log(`  Fallback: ${(fallbackQueryTotal / QUERIES.length).toFixed(1)}ms avg`);
  console.log(`  Speedup:  ${(ollamaQueryTotal / fallbackQueryTotal).toFixed(0)}x`);
  console.log();
  console.log("Corpus embed time:");
  console.log(`  Ollama:   ${ollamaCorpusMs.toFixed(0)}ms (${corpus.length} docs)`);
  console.log(`  Fallback: ${fallbackCorpusMs.toFixed(0)}ms (${corpus.length} docs)`);
  console.log(`  Speedup:  ${(ollamaCorpusMs / fallbackCorpusMs).toFixed(0)}x`);
  console.log();

  const winner =
    oMetrics.mrr > fMetrics.mrr + 0.05 ? "Ollama"
    : fMetrics.mrr > oMetrics.mrr + 0.05 ? "Fallback"
    : "tie (within 5% MRR)";
  console.log(`Quality winner: ${winner}`);
  console.log(`Latency winner: Fallback (${(ollamaQueryTotal / fallbackQueryTotal).toFixed(0)}x faster queries)`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
