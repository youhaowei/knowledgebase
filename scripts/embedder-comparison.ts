#!/usr/bin/env bun
/**
 * Embedder Quality Comparison
 *
 * Embeds the real KB corpus with both Ollama (2560-dim qwen3) and the
 * fallback (384-dim Snowflake Arctic). Runs a battery of queries and
 * compares top-10 rankings via cosine similarity.
 */

import { readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import matter from "gray-matter";
import { embed } from "../src/lib/embedder.ts";
import { embedFallback } from "../src/lib/fallback-embedder.ts";

interface Doc {
  id: string;
  name: string;
  text: string;
}

function loadCorpus(): Doc[] {
  const root = join(homedir(), ".kb", "memories");
  const docs: Doc[] = [];
  for (const ns of ["default", "retro"]) {
    const nsPath = join(root, ns);
    try {
      const files = readdirSync(nsPath).filter(
        (f) => f.endsWith(".md") && f !== "_index.md" && !f.startsWith("."),
      );
      for (const f of files) {
        try {
          const parsed = matter.read(join(nsPath, f));
          docs.push({
            id: parsed.data.id as string,
            name: (parsed.data.name as string) || "(unnamed)",
            text: parsed.content.trim(),
          });
        } catch {
          // skip
        }
      }
    } catch {
      // skip
    }
  }
  return docs;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
}

interface Ranked {
  id: string;
  name: string;
  score: number;
}

function topK(queryEmb: number[], docEmbs: Map<string, number[]>, docs: Doc[], k = 10): Ranked[] {
  const scored: Ranked[] = docs
    .map((d) => ({
      id: d.id,
      name: d.name,
      score: cosine(queryEmb, docEmbs.get(d.id)!),
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// Jaccard similarity over top-k sets
function jaccard(a: Ranked[], b: Ranked[]): number {
  const aSet = new Set(a.map((x) => x.id));
  const bSet = new Set(b.map((x) => x.id));
  const intersection = [...aSet].filter((x) => bSet.has(x)).length;
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

// Rank-biased overlap at depth k (weights early matches more)
function rbo(a: Ranked[], b: Ranked[], p = 0.9): number {
  const aIds = a.map((x) => x.id);
  const bIds = b.map((x) => x.id);
  let sum = 0;
  const k = Math.min(a.length, b.length);
  for (let d = 1; d <= k; d++) {
    const aSet = new Set(aIds.slice(0, d));
    const bSet = new Set(bIds.slice(0, d));
    const overlap = [...aSet].filter((x) => bSet.has(x)).length;
    sum += (overlap / d) * Math.pow(p, d - 1);
  }
  return (1 - p) * sum;
}

const QUERIES = [
  "what state management do we use",
  "filesystem storage for knowledge graph",
  "bun worktree issues",
  "test isolation problems",
  "retro finding workflow",
  "hybrid search with RRF",
  "how do tasks get finished",
  "memory categories",
  "graph provider interface",
  "namespace locking",
];

async function main() {
  console.log("Loading corpus...");
  const docs = loadCorpus();
  console.log(`Loaded ${docs.length} memories\n`);

  if (docs.length === 0) {
    console.error("No documents found!");
    process.exit(1);
  }

  // ============ Embed corpus ============
  console.log("Embedding corpus with Ollama (qwen3-embedding:4b, 2560-dim)...");
  const ollamaEmbs = new Map<string, number[]>();
  const ollamaStart = performance.now();
  for (const d of docs) {
    const emb = await embed(`${d.name}\n${d.text}`);
    if (emb.length === 0) {
      console.error(`  FAILED: ${d.name}`);
      continue;
    }
    ollamaEmbs.set(d.id, emb);
  }
  const ollamaCorpusMs = performance.now() - ollamaStart;
  console.log(`  ${ollamaEmbs.size}/${docs.length} docs embedded in ${ollamaCorpusMs.toFixed(0)}ms (avg ${(ollamaCorpusMs / docs.length).toFixed(0)}ms/doc)\n`);

  console.log("Embedding corpus with Fallback (snowflake-arctic-xs, 384-dim)...");
  const fallbackEmbs = new Map<string, number[]>();
  const fallbackStart = performance.now();
  for (const d of docs) {
    const emb = await embedFallback(`${d.name}\n${d.text}`);
    if (emb.length === 0) {
      console.error(`  FAILED: ${d.name}`);
      continue;
    }
    fallbackEmbs.set(d.id, emb);
  }
  const fallbackCorpusMs = performance.now() - fallbackStart;
  console.log(`  ${fallbackEmbs.size}/${docs.length} docs embedded in ${fallbackCorpusMs.toFixed(0)}ms (avg ${(fallbackCorpusMs / docs.length).toFixed(0)}ms/doc)\n`);

  // Filter to docs both embedders succeeded on
  const validDocs = docs.filter((d) => ollamaEmbs.has(d.id) && fallbackEmbs.has(d.id));

  // ============ Run queries ============
  console.log("=".repeat(80));
  console.log("Query results comparison");
  console.log("=".repeat(80));

  const overlapScores: number[] = [];
  const rboScores: number[] = [];
  let ollamaQueryTotal = 0;
  let fallbackQueryTotal = 0;

  for (const query of QUERIES) {
    const oQStart = performance.now();
    const oQueryEmb = await embed(query);
    ollamaQueryTotal += performance.now() - oQStart;

    const fQStart = performance.now();
    const fQueryEmb = await embedFallback(query);
    fallbackQueryTotal += performance.now() - fQStart;

    const oTop = topK(oQueryEmb, ollamaEmbs, validDocs, 10);
    const fTop = topK(fQueryEmb, fallbackEmbs, validDocs, 10);

    const overlap = jaccard(oTop, fTop);
    const rboScore = rbo(oTop, fTop);
    overlapScores.push(overlap);
    rboScores.push(rboScore);

    console.log(`\nQuery: "${query}"`);
    console.log(`  Top-10 overlap (Jaccard): ${(overlap * 100).toFixed(0)}%`);
    console.log(`  Top-10 rank-biased overlap: ${(rboScore * 100).toFixed(0)}%`);
    console.log(`  Ollama top-5:`);
    for (const r of oTop.slice(0, 5)) {
      console.log(`    [${r.score.toFixed(3)}] ${r.name}`);
    }
    console.log(`  Fallback top-5:`);
    for (const r of fTop.slice(0, 5)) {
      console.log(`    [${r.score.toFixed(3)}] ${r.name}`);
    }
  }

  // ============ Summary ============
  console.log("\n" + "=".repeat(80));
  console.log("Summary");
  console.log("=".repeat(80));
  const avgOverlap = overlapScores.reduce((a, b) => a + b, 0) / overlapScores.length;
  const avgRbo = rboScores.reduce((a, b) => a + b, 0) / rboScores.length;
  console.log(`\nCorpus: ${validDocs.length} docs (both embedders succeeded)`);
  console.log(`Queries: ${QUERIES.length}`);
  console.log(`\nAverage Jaccard overlap (top-10): ${(avgOverlap * 100).toFixed(0)}%`);
  console.log(`Average RBO@10 (rank-biased):     ${(avgRbo * 100).toFixed(0)}%`);
  console.log(`\nLatency per query:`);
  console.log(`  Ollama:   ${(ollamaQueryTotal / QUERIES.length).toFixed(0)}ms avg`);
  console.log(`  Fallback: ${(fallbackQueryTotal / QUERIES.length).toFixed(1)}ms avg`);
  console.log(`  Speedup:  ${(ollamaQueryTotal / fallbackQueryTotal).toFixed(0)}x`);
  console.log(`\nCorpus embed time:`);
  console.log(`  Ollama:   ${ollamaCorpusMs.toFixed(0)}ms (${validDocs.length} docs)`);
  console.log(`  Fallback: ${fallbackCorpusMs.toFixed(0)}ms (${validDocs.length} docs)`);
  console.log(`  Speedup:  ${(ollamaCorpusMs / fallbackCorpusMs).toFixed(0)}x`);
}

main().catch((err) => {
  console.error("Experiment failed:", err);
  process.exit(1);
});
