# Embedder Benchmark: qwen3 4B (2560-dim) vs Snowflake Arctic xs (384-dim)

**Date**: 2026-04-09
**Context**: Knowledgebase project — filesystem-first personal KB with semantic search
**Question**: Is the bigger embedder actually better, or are we paying for complexity we don't need?

## TL;DR

The 384-dim in-process embedder beats the 2560-dim Ollama model on every metric that mattered to us.

| Metric | Ollama `qwen3-embedding:4b` | Snowflake Arctic xs | Delta |
|---|---|---|---|
| Recall@1 | 90% | 90% | tie |
| Recall@5 | 95% | **100%** | +5pp |
| MRR | 0.933 | **0.950** | +0.017 |
| Query latency | 116 ms | **3.2 ms** | **36× faster** |
| Corpus embed | 5721 ms | **266 ms** | **22× faster** |
| Vector size | 2560 floats | 384 floats | **6.7× smaller** |
| Infra | Ollama daemon + model pull | In-process via transformers.js | zero deps |

The "fallback" beat the "primary" and it wasn't close on the stuff we actually cared about.

## Why we ran this

The knowledgebase project (a personal knowledge graph that auto-extracts entities and edges from text) had two embedders wired in parallel:

- **Primary**: Ollama `qwen3-embedding:4b`, 2560 dims — "the good one"
- **Fallback**: `Snowflake/snowflake-arctic-embed-xs`, 384 dims, running in-process via HuggingFace transformers.js — "the one we use when Ollama is down"

Ingestion wrote to both. Every memory stored twice. Every query fanned out to both indexes. The architecture was called "dual vector indexes" in the design doc.

While reviewing a filesystem-first rewrite of the KB, we noticed the hybrid search module had accumulated a pile of complexity — a 3-second graph timeout, an `ollamaAvailable` cooldown flag, a dance to detect when the daemon was down, backoff logic for retries. Every piece of that complexity traced back to Ollama being flaky. Cold starts, network errors, model loading.

The assumption underlying all of it was: *the 2560-dim model is meaningfully better, so the complexity is worth it.*

We had never actually measured that assumption.

## First attempt: overlap comparison (weak signal)

First we tried the obvious thing: embed the corpus with both models, run the same queries through both, measure top-k overlap with Jaccard similarity and Rank-Biased Overlap.

Result on the real KB corpus: **51% Jaccard overlap at top-10**.

That sounds meaningful until you look at the corpus. It was 167 stale test directories leaked by a test suite that didn't clean up after itself, mixed with 19 real memories. The "51% overlap" was two models agreeing on garbage — there was no ground truth anchoring the comparison. Even if both models were excellent, they could disagree on noise, and we couldn't tell the difference between "these models are genuinely different" and "this corpus has no signal".

> **Overlap between models tells you whether they're similar. It does not tell you whether either one is good.**

We scrapped the approach and built a proper labeled benchmark.

## Second attempt: labeled retrieval benchmark

This is the standard methodology used by BEIR, MTEB, and MS MARCO for IR evaluation. You write queries with known correct answers, then measure whether the model returns them.

### The corpus

30 hand-written documents modeled on realistic personal-KB entries: tech decisions, bug reports, architecture notes, tooling observations, model comparisons. Intentionally short (1-2 sentences each), because short-form is how people actually write personal memories.

Examples:

> **state-1**: DashFrame uses Zustand for global state management. Chose Zustand over Redux for its simpler API and less boilerplate.

> **bug-1**: Bun install fails inside git worktrees. Cannot find package.json despite the file existing at worktree root.

> **search-1**: Reciprocal Rank Fusion combines multiple ranked result lists without requiring score normalization across sources.

The corpus is grouped into 6 topical clusters with **deliberate hard negatives** inside each cluster:

- **State management** (4 docs) — Zustand, Redux Toolkit, React Context, Jotai
- **Build tools** (4 docs) — Bun, Vite, pnpm, esbuild
- **Bugs** (5 docs) — worktree install, LadybugDB segfault, Ollama cold start, TanStack codegen, Tailwind v4
- **Storage** (4 docs) — filesystem layout, Neo4j vector index, dual index architecture, atomic writes
- **Search** (4 docs) — RRF, BM25, ripgrep, hybrid search
- **Tooling** (4 docs) — cc-retro, retro KB sync, subagent CWD, MCP tools
- **AI models** (5 docs) — qwen3 4B, Snowflake Arctic, Claude Sonnet, Gemini Flash, unifai OAuth

Hard negatives are the whole point. Any decent embedder can find an obviously-relevant document. The real question is whether it can distinguish between *keyword-similar-but-wrong* and *semantically-right* within a cluster of related docs.

### The queries

20 labeled queries, each testing a specific retrieval skill:

- **Paraphrase** — "how are memories stored on disk" for a doc that says "filesystem-first storage layout"
- **Causal bug recall** — "why is the first embedding slow" for a doc about Ollama cold starts
- **Conceptual** — "how do we combine multiple ranked search results" for a doc about RRF
- **Disambiguation** — "which state library has the simplest api" — four state-management docs exist, must pick the one about Zustand's "simpler API"
- **Hard negatives** — "what embedding dimensions are stored" — both individual model docs and the dual-index doc mention dimensions

For each query the benchmark records the rank of the expected doc in each model's ranked results.

### Metrics

- **Recall@1** — is the expected doc ranked first?
- **Recall@5** — is it in the top 5?
- **MRR (Mean Reciprocal Rank)** — `avg(1/rank)`, a continuous quality signal that rewards early ranking

For each query the corpus is ranked by cosine similarity. We compute the rank of the expected doc, aggregate across all 20 queries, and compare the two models.

## Results

```
Metric        Ollama     Fallback   Delta
--------------------------------------------------
Recall@1       90%        90%       +0pp
Recall@5       95%       100%       +5pp
MRR           0.933     0.950     +0.017
```

Both models got 18 of 20 queries right on the first rank. The interesting stuff is in the 4 disagreements.

### The 4 disagreements

**1. "fast file search for markdown"** — Ollama #1, Fallback #2

- Ollama top-3: `search-3` ✓, `storage-1`, `search-2`
- Fallback top-3: `storage-1`, `search-3` ✓, `search-4`

Fallback got lexically pulled by "file" into the filesystem-layout doc before landing on the ripgrep doc. Small miss, recoverable at rank #2.

**2. "which state library has the simplest api"** — Ollama **#6**, Fallback **#1**

- Ollama top-3: `ai-5` (OAuth), `tool-1` (SQLite), `ai-2` (Snowflake) — expected doc ranked **#6**
- Fallback top-3: `state-1` ✓, `state-3`, `state-2` — **all three are state-management docs**

This is the most striking result of the entire benchmark. Ollama literally did not put a single state-management document in the top 3 for a query about state management libraries. It surfaced three completely unrelated documents (OAuth, SQLite, Snowflake) ahead of any state doc. Meanwhile Fallback nailed not just the primary answer but cleanly ranked the four hard-negative docs in the right cluster.

If a user asked this question and only saw the top-3 results, Ollama would produce something that looks like the KB is broken. Fallback would produce something that looks like search understands what you meant.

**3. "what embedding dimensions are stored"** — Ollama #1, Fallback #2

- Ollama top-3: `ai-1`, `ai-2`, `storage-2` — acceptable docs at ranks 1 and 2
- Fallback top-3: `search-2`, `storage-3` ✓, `storage-1` — expected "dual-index" doc at rank #2

Slight edge to Fallback on the "most correct" doc (storage-3 describes the dual-index architecture), but technically both get acceptable answers in the top 2. Calling this a wash.

**4. "how does claude code talk to the knowledge base"** — Ollama #2, Fallback **#1**

- Ollama top-3: `ai-5` (OAuth), `tool-4` ✓, `ai-2` — OAuth doc ranked ahead of MCP doc
- Fallback top-3: `tool-4` ✓, `tool-2`, `tool-3` — MCP doc first, adjacent tooling docs next

Ollama was attracted to the OAuth doc by the proper noun "Claude", even though the query is about MCP (which is how Claude Code actually talks to the KB). Fallback was not distracted by the proper noun and found the right doc directly.

### The pattern

Ollama's failures share a common shape: it over-weights **proper nouns and lexical surface features** ("Claude", "Ollama", individual model names) and under-weights **topical coherence**. When we asked about state management, it surfaced docs about OAuth and SQLite. When we asked how Claude Code talks to the KB, it surfaced a doc about Claude's OAuth instead of the doc about MCP tools.

Fallback is less flashy but steadier. It doesn't beat Ollama on any single query by a huge margin, but it never catastrophically fails the way Ollama did on the state-management query.

## Why the smaller model wins

Two plausible explanations, both probably contributing.

### 1. Short text is out-of-distribution for qwen3 4B

Instruction-tuned embedders like qwen3-embedding:4b are trained on long retrieval tasks — Wikipedia passages, documentation paragraphs, NQ/MS-MARCO question-answer pairs that average 100-500 tokens. Our corpus is 1-2 sentences per doc, ~20-40 tokens each.

Short-text retrieval is historically where small purpose-built encoders outperform large instruction-tuned models. Snowflake Arctic xs was specifically trained on **short-passage retrieval** — its training distribution is basically exactly what a personal KB looks like. qwen3 4B is a generalist. On our distribution, the specialist wins.

### 2. Dimension curse on small corpora

2560 dimensions only help if you have enough documents to discriminate along all of them. With 30 docs, the extra dimensions aren't adding signal — they're adding ways to be confidently wrong. 384 focused dimensions, aggressively tuned for the same task, produce tighter neighborhoods.

On a 30M-doc corpus the answer might be different. On a 30-doc corpus the smaller model has a real advantage.

### Both effects compound

Bigger model + longer-text training regime + more dimensions = more ways to fixate on irrelevant signal in short-text retrieval. The failures we saw (proper-noun fixation, topical drift) are consistent with a model that has too much representational capacity being used on the wrong distribution.

## What we're changing

The dual-index architecture was speculative. It bet that Ollama would be meaningfully better, and that the fallback was a "break glass in case of emergency" option. The benchmark says the bet was wrong in both directions: the fallback is *equal-or-better quality*, and 36× faster.

Action items, in priority order:

1. **Drop the Ollama code path entirely.** Delete `embed()`'s Ollama branch. Make `embedFallback()` the only embedder.
2. **Collapse to a single 384-dim index.** Drop the 2560-dim Memory.embedding field, keep only Memory.embedding384 and rename it to Memory.embedding. Same for Fact.
3. **Delete `getActiveDimension()` and all its callsites.** There is only one dimension now.
4. **Remove the hybrid-search cooldown flag and the 3-second graph timeout.** Their whole purpose was Ollama reliability, which is no longer a problem.
5. **Drop the `memory_vec_idx` and `fact_vec_idx` Neo4j indexes** (2560-dim). Keep only the 384-dim indexes.
6. **Update CLAUDE.md** to remove the "dual vector indexes" note and the "primary/fallback" framing.
7. **Delete `db:reembed` / `db:backfill`** complexity — there's only one dimension to maintain.

Storage footprint drops ~6.7× on vector columns. Cold-start latency drops from ~1s to 0. No Ollama process to babysit. Embedding runs in-process via a ~30MB model cached at first load.

The fallback becomes the primary. The primary becomes the past.

## Caveats

- **Corpus size**: 30 docs is small. At 30k docs, the gap between models may close or flip. Expanding the corpus is the top priority for a follow-up study.
- **Domain specificity**: the corpus is personal-KB-shaped (short entries about tech decisions). Results may not generalize to e-commerce search, code search, scientific literature, legal documents, etc.
- **Query count**: 20 queries gives noisy confidence intervals on recall metrics. A rigorous study would expand to 100+.
- **Single language**: English only. Do not extrapolate to multilingual retrieval.
- **Author bias**: I wrote both the docs and the queries. I tried to avoid leading the evaluation — hard negatives are deliberately included, failure modes are reported honestly — but a blind setup with queries written by someone else would be stronger.
- **Base models, not fine-tuned**: both embedders are used as shipped, no fine-tuning. Fine-tuning either model on a task-specific dataset could change the ranking.

That said, the **direction** of the result is clear enough that these caveats don't flip the decision. Tied Recall@1 with a 36× latency win is not a close call. A more rigorous study might sharpen the magnitude, but it's unlikely to reverse it.

## The meta-lesson

The original architecture called the 384-dim model "the fallback". That single word framed it as the worse option — the one you use when the better one is unavailable. We believed the framing for months and built infrastructure around it. Cooldown flags. Timeout handlers. Dual indexes. Re-embed migration scripts. `getActiveDimension()` everywhere.

The actual measurement says the "fallback" is the better choice for this workload. The framing was wrong. All the infrastructure built to protect us against the fallback's presumed inferiority was wrong too.

It's worth measuring the things you treat as obvious. Especially the ones you wrote "obviously better" in a comment next to. Architectures calcify around unmeasured assumptions, and then the code review finds itself debating the right cooldown duration for a problem that would evaporate if you questioned the premise underneath it.

## Reproducing the benchmark

Script: [`scripts/embedder-benchmark.ts`](../../scripts/embedder-benchmark.ts)
Raw output: [`results.txt`](./results.txt)

```bash
bun run scripts/embedder-benchmark.ts
```

Requires:
- Ollama running with `qwen3-embedding:4b` pulled (`ollama pull qwen3-embedding:4b`)
- Node/Bun with `@huggingface/transformers` installed (downloads Snowflake Arctic xs on first run, ~30MB cached at `~/.cache/huggingface`)

The benchmark is deterministic — embeddings are stable across runs, so you can re-run anytime to verify or to A/B a new model against the baseline.

## What to do with this script long-term

The benchmark should stay checked in as a regression test. If you ever revisit the embedder choice — new Ollama model, new Snowflake release, a BGE or E5 variant worth trying — add it as a third model in the script and re-run. The existing labeled corpus + queries give you an immediate apples-to-apples answer.

This is how you keep architectural decisions grounded. Not by trusting your taste. By running the measurement, again.
