# scripts/

Operational + research scripts that aren't part of the main `kb` CLI or the server runtime. The `kb` CLI should cover day-to-day use; this directory is for admin chores and one-shot experiments.

Each script is pinned as **operational** (still used, wired into `package.json` or documented workflows) or **one-shot** (ran once to produce a decision or data file — kept for reproducibility, not for regular execution).

| Script | Status | Purpose |
|---|---|---|
| `clear-indexed.ts` | **operational** | Wired as `bun run db:reindex`. Clears `indexedAt` on every memory file so the next indexer sweep re-extracts. Use after an extractor change. |
| `debug-extract.ts` | operational | Runs the extraction pipeline against arbitrary text via stdin or arg. Prints raw LLM output + parsed entities/edges. No DB writes. Useful when triaging extraction regressions. |
| `list-edges.ts` | operational | Dumps edges from LadybugDB for a namespace, sorted by created-at. Reads only. Handy during retro cleanup. |
| `embedder-benchmark.ts` | one-shot | Recall@1 / MRR benchmark, built-in 384-dim vs Ollama 2560-dim on the memory corpus. Result: built-in is sufficient for all retrieval tiers (Spec Open Q #4 → Resolved). |
| `embedder-benchmark-edges.ts` | one-shot | Same benchmark but over `Fact` FTS index rather than memories. |
| `embedder-benchmark-rerank.ts` | one-shot | Explores a rerank-after-retrieve pattern. No positive finding worth shipping. |
| `embedder-benchmark-retro.ts` | one-shot | Benchmark scoped to the retro corpus. |
| `embedder-comparison.ts` | one-shot | Side-by-side embedding similarity sanity check. |
| `extract-with-haiku.ts` | one-shot | Runs extraction via Anthropic Haiku (through `unifai`). Used to produce the Haiku row in the extractor×embedder benchmark. |
| `extract-with-model.ts` | one-shot | Generalized version of `extract-with-haiku.ts`; `--model` arg. Historical default was `qwen3.5` — see git log and the extractor×embedder benchmark for the decision that replaced it with `gemma4:e4b`. |
| `extract-with-tjs.ts` | one-shot | Extraction via the built-in `@huggingface/transformers.js` backend. Demonstrated unreliable JSON grammar output on this model class — not shipped. |
| `haiku-smoke.ts` | one-shot | Minimal "does Haiku respond?" check. Diagnostic. |
| `tjs-extract-test.ts` | one-shot | Same smoke but for transformers.js. |
| `tjs-smoke.ts` | one-shot | Smallest possible transformers.js load test. |

## When adding a new script

- One-shot scripts: add a header comment with the date, question it answers, and outcome — the file becomes a reproducibility artifact even if the decision is already in Notion.
- Operational scripts: wire them to a `package.json` script so the canonical entry point is `bun run <name>`, not `bun run scripts/<file>.ts`.
- Output convention: diagnostics to `stderr`, machine-readable data (if any) to `stdout`. Match the main `kb` CLI contract.
