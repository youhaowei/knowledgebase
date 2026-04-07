/**
 * File-based Search Module
 *
 * Searches memory files on disk using two strategies:
 * 1. Index scan — case-insensitive substring match on name (from listMemoryFiles metadata)
 * 2. ripgrep — full-text body/frontmatter search for richer matches
 *
 * Results are merged and deduped by memory ID. Target: <50ms for 100 files.
 */

import { listMemoryFiles, getNamespacePath } from "./fs-memory.js";

export interface FileSearchResult {
  id: string;
  name: string;
  abstract?: string;    // from frontmatter (may be empty for unindexed)
  source: "file";
  indexed: boolean;     // whether indexedAt is set
  stale: boolean;       // false for Phase 1 (no staleness detection yet)
  tags: string[];
  matchContext?: string; // snippet from ripgrep match (if available)
}

export interface FileSearchOptions {
  tags?: string[];
  limit?: number;  // default 20
}

/**
 * Fast path: substring match on name from listMemoryFiles metadata.
 * No file reads needed — name is in the MemoryFileEntry returned by listMemoryFiles.
 */
function indexScan(
  query: string,
  namespace: string,
  options?: FileSearchOptions,
): FileSearchResult[] {
  const entries = listMemoryFiles(namespace);
  const q = query.toLowerCase();

  return entries
    .filter((entry) => {
      if (!entry.name.toLowerCase().includes(q)) return false;
      if (options?.tags && options.tags.length > 0) {
        const entryTagSet = new Set(entry.tags);
        return options.tags.some((t) => entryTagSet.has(t));
      }
      return true;
    })
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      abstract: undefined,
      source: "file" as const,
      indexed: entry.indexed,
      stale: false,
      tags: entry.tags,
    }));
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
  const result = new Map<string, string>();
  try {
    const proc = Bun.spawn(
      ["rg", "--json", "-F", "-i", "--no-heading", query, namespacePath],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = await new Response(proc.stdout).text();
    const lines = output.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type === "match") {
          const filePath = obj.data.path.text as string;
          const context = (obj.data.lines.text as string).trim();
          // Only store the first match context per file
          if (!result.has(filePath)) {
            result.set(filePath, context);
          }
        }
      } catch {
        // skip malformed JSON lines
      }
    }
  } catch {
    console.error("[file-search] ripgrep not found, skipping body search");
  }
  return result;
}

/**
 * Merge ripgrep matches into the result map. Adds matchContext to existing
 * entries or creates new rg-only entries with file metadata.
 */
function mergeRgMatches(
  resultById: Map<string, FileSearchResult>,
  rgMatches: Map<string, string>,
  namespace: string,
  tagFilter?: string[],
): void {
  const allEntries = listMemoryFiles(namespace);
  const entryByPath = new Map(allEntries.map((e) => [e.path, e]));

  for (const [filePath, context] of rgMatches) {
    const entry = entryByPath.get(filePath);
    if (!entry) continue;

    if (tagFilter && tagFilter.length > 0) {
      const entryTagSet = new Set(entry.tags);
      if (!tagFilter.some((t) => entryTagSet.has(t))) continue;
    }

    const existing = resultById.get(entry.id);
    if (existing) {
      existing.matchContext = context;
    } else {
      resultById.set(entry.id, {
        id: entry.id,
        name: entry.name,
        abstract: undefined,
        source: "file",
        indexed: entry.indexed,
        stale: false,
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
  const namespacePath = getNamespacePath(namespace);

  const [indexResults, rgMatches] = await Promise.all([
    Promise.resolve(indexScan(query, namespace, options)),
    rgSearch(query, namespacePath),
  ]);

  const resultById = new Map<string, FileSearchResult>();
  for (const r of indexResults) {
    resultById.set(r.id, r);
  }

  if (rgMatches.size > 0) {
    mergeRgMatches(resultById, rgMatches, namespace, options?.tags);
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
