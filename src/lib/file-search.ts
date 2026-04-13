/**
 * File-based Search Module
 *
 * Searches memory files on disk using two strategies:
 * 1. Index scan — case-insensitive substring match on name (from listMemoryFiles metadata)
 * 2. ripgrep — full-text body/frontmatter search for richer matches
 *
 * Results are merged and deduped by memory ID. Target: <50ms for 100 files.
 */

import { statSync, readFileSync } from "fs";
import matter from "gray-matter";
import { listMemoryFiles, normalizeTags, resolveNamespacePath, type MemoryFileEntry } from "./fs-memory.js";

export interface FileSearchResult {
  id: string;
  name: string;
  path: string;                  // absolute file path (Spec Decision #8 public contract)
  source: "file" | "index";      // "index" = matched via _index.md fast path, "file" = ripgrep body match
  indexed: boolean;              // whether the graph has extracted entities/edges for this file (false = pending)
  stale: boolean;                // file mtime > indexedAt (Spec Decision #8)
  indexedAt: string | null;      // ISO timestamp when graph last indexed this file, or null if unindexed
  tags: string[];
  matchContext?: string;         // snippet from ripgrep match (if available)
}

/**
 * Computes staleness per Spec Decision #8: `stale` is true when the file's mtime
 * is newer than the stored `indexedAt` timestamp. An unindexed entry is not
 * "stale" — it's pending. Returns false on stat failure (file removed mid-search).
 */
function isStale(filePath: string, indexedAt: string | undefined): boolean {
  if (!indexedAt) return false;
  const indexedAtMs = Date.parse(indexedAt);
  if (!Number.isFinite(indexedAtMs)) return false;
  try {
    return statSync(filePath).mtimeMs > indexedAtMs;
  } catch {
    return false;
  }
}

/**
 * Returns the entry's indexedAt if already populated. Otherwise — when the
 * entry came via the `_index.md` fast path which doesn't carry timestamps —
 * reads just the frontmatter from disk. Bounded to `limit` calls per search.
 */
function resolveIndexedAt(entry: MemoryFileEntry): string | undefined {
  if (entry.indexedAt !== undefined) return entry.indexedAt;
  if (!entry.indexed) return undefined;
  try {
    const parsed = matter.read(entry.path);
    const value = (parsed.data as { indexedAt?: unknown }).indexedAt;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export interface FileSearchOptions {
  tags?: string[];
  limit?: number;  // default 20
}

function normalizeTagFilter(tags?: string[]): string[] | undefined {
  if (!tags || tags.length === 0) return undefined;
  const normalized = normalizeTags(tags);
  return normalized.length > 0 ? normalized : undefined;
}

function matchesTagFilter(entryTags: string[], tagFilter?: string[]): boolean {
  if (!tagFilter || tagFilter.length === 0) return true;
  const entryTagSet = new Set(entryTags);
  return tagFilter.every((tag) => entryTagSet.has(tag));
}

/**
 * Fast path: substring match on name from pre-loaded entries.
 * No file reads needed — name is in the MemoryFileEntry.
 */
function indexScanFromEntries(
  query: string,
  entries: MemoryFileEntry[],
  tagFilter?: string[],
): FileSearchResult[] {
  // Empty queries are intentional: callers use fileSearch("", ns, { tags })
  // as a tag-only browse path, so an empty name query acts as a wildcard.
  const q = query.trim().toLowerCase();

  return entries
    .filter((entry) => {
      if (!entry.name.toLowerCase().includes(q)) return false;
      return matchesTagFilter(entry.tags, tagFilter);
    })
    .map((entry) => {
      const indexedAt = resolveIndexedAt(entry);
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        source: "index" as const,
        indexed: entry.indexed,
        stale: isStale(entry.path, indexedAt),
        indexedAt: indexedAt ?? null,
        tags: entry.tags,
      };
    });
}

/**
 * Returns the 1-indexed line number where the YAML frontmatter closes
 * (the second `---` fence). Returns 0 if the file has no frontmatter,
 * or the file can't be read — callers treat 0 as "no filter", i.e.
 * fall back to the old behavior where frontmatter hits could slip through.
 *
 * Cached per search call; a single memory file may produce many ripgrep
 * matches and we only want to scan it once.
 */
function frontmatterEndLine(filePath: string, cache: Map<string, number>): number {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;

  let end = 0;
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    if (lines[0]?.trim() === "---") {
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
          end = i + 1; // 1-indexed, match ripgrep's line_number
          break;
        }
      }
    }
  } catch {
    // File vanished between rg and here — leave end at 0 so the match
    // passes through (we don't want an I/O race to drop real results).
  }

  cache.set(filePath, end);
  return end;
}

/**
 * Parse ripgrep JSON output and extract the first BODY match context per
 * file. Matches inside the YAML frontmatter (line_number ≤ closing fence)
 * are dropped — otherwise searching "dx-review" surfaces the `name:` line
 * as the snippet, which is useless to LLM consumers expecting body content.
 */
function parseRgOutput(output: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = output.trim().split("\n").filter(Boolean);
  const frontmatterCache = new Map<string, number>();

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.type !== "match") continue;

      const filePath = obj.data.path.text as string;
      const lineNumber = obj.data.line_number as number | undefined;
      const context = (obj.data.lines.text as string).trim();

      // Drop matches inside frontmatter. Falls back to the previous "any
      // match" behavior if we can't determine the fence position (empty
      // frontmatterEndLine), so missing files don't vanish from results.
      if (lineNumber !== undefined) {
        const endLine = frontmatterEndLine(filePath, frontmatterCache);
        if (endLine > 0 && lineNumber <= endLine) continue;
      }

      if (!result.has(filePath)) {
        result.set(filePath, context);
      }
    } catch {
      // skip malformed JSON lines
    }
  }

  return result;
}

/**
 * Handle ripgrep process errors gracefully.
 */
function handleRgError(err: unknown): void {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    console.error("[file-search] ripgrep (rg) not installed, skipping body search");
  } else {
    console.error(`[file-search] ripgrep failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Full-text search via ripgrep. Returns Map of filePath → first match context snippet.
 * Gracefully returns empty Map if rg is not installed.
 */
async function rgSearch(
  query: string,
  namespacePath: string,
): Promise<Map<string, string>> {
  if (query.trim() === "") return new Map();

  let proc: ReturnType<typeof Bun.spawn> | undefined;
  try {
    proc = Bun.spawn(
      [
        "rg",
        "--json",
        "-F",
        "-i",
        "--no-heading",
        "--glob",
        "!_index.md",
        "--glob",
        "!*.tmp",
        "--glob",
        "!*.deleted",
        "--glob",
        "!_tombstones.jsonl",
        "--glob",
        "!_forget_edges.jsonl",
        "--",
        query,
        namespacePath,
      ],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const output = await new Response(proc.stdout as ReadableStream).text();
    await proc.exited;
    return parseRgOutput(output);
  } catch (err) {
    handleRgError(err);
    return new Map();
  } finally {
    try {
      proc?.kill();
    } catch {
      // proc already exited — ignore
    }
  }
}

/**
 * Merge ripgrep matches into the result map. Adds matchContext to existing
 * entries or creates new rg-only entries with file metadata.
 * Accepts pre-loaded entries to avoid re-reading files.
 */
function mergeRgMatches(
  resultById: Map<string, FileSearchResult>,
  rgMatches: Map<string, string>,
  entries: MemoryFileEntry[],
  tagFilter?: string[],
): void {
  const entryByPath = new Map(entries.map((e) => [e.path, e]));

  for (const [filePath, context] of rgMatches) {
    const entry = entryByPath.get(filePath);
    if (!entry) continue;

    if (!matchesTagFilter(entry.tags, tagFilter)) {
      continue;
    }

    const existing = resultById.get(entry.id);
    if (existing) {
      existing.matchContext = context;
      // Upgrade source from "index" (name-only hit) to "file" (body match).
      existing.source = "file";
    } else {
      const indexedAt = resolveIndexedAt(entry);
      resultById.set(entry.id, {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        source: "file",
        indexed: entry.indexed,
        stale: isStale(entry.path, indexedAt),
        indexedAt: indexedAt ?? null,
        tags: entry.tags,
        matchContext: context,
      });
    }
  }
}

/**
 * Main search function. Runs indexScan + rgSearch in parallel, merges and deduplicates.
 *
 * Sort order: indexed files first, then by name match relevance (exact before contains).
 */
export async function fileSearch(
  query: string,
  namespace: string,
  options?: FileSearchOptions,
): Promise<FileSearchResult[]> {
  const limit = options?.limit ?? 20;
  const namespacePath = resolveNamespacePath(namespace);

  // Load entries once, share between indexScan and mergeRgMatches
  const allEntries = listMemoryFiles(namespace);
  const normalizedTags = normalizeTagFilter(options?.tags);

  const [indexResults, rgMatches] = await Promise.all([
    Promise.resolve(indexScanFromEntries(query, allEntries, normalizedTags)),
    rgSearch(query, namespacePath),
  ]);

  const resultById = new Map<string, FileSearchResult>();
  for (const r of indexResults) {
    resultById.set(r.id, r);
  }

  if (rgMatches.size > 0) {
    mergeRgMatches(resultById, rgMatches, allEntries, normalizedTags);
  }

  const q = query.toLowerCase();
  return Array.from(resultById.values())
    .sort((a, b) => {
      if (a.indexed !== b.indexed) return a.indexed ? -1 : 1;
      const aExact = a.name.toLowerCase() === q;
      const bExact = b.name.toLowerCase() === q;
      if (aExact !== bExact) return aExact ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}
