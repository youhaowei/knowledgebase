/**
 * Filesystem Memory Module
 *
 * Shared contract for reading/writing memories as markdown files with YAML frontmatter.
 * Storage root: ~/.kb/memories/{namespace}/{uuid}.md
 *
 * All other instant-kb modules import from here.
 */

import { z } from "zod";
import { homedir } from "os";
import { join, resolve, sep, basename } from "path";
import { mkdirSync, renameSync, readdirSync, existsSync, writeFileSync, readFileSync, rmSync, unlinkSync, statSync } from "fs";
import matter from "gray-matter";
import { MemoryCategory } from "../types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const Origin = z.enum(["manual", "retro", "mcp", "import"]);
export type Origin = z.infer<typeof Origin>;

export const MemoryFrontmatter = z.object({
  id: z.uuid(),
  name: z.string(),
  origin: Origin,
  namespace: z.string().default("default"),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),        // ISO 8601
  indexedAt: z.string().optional(), // set when server has processed this file
  abstract: z.string().optional(),  // filled by indexer (Phase 2)
  summary: z.string().optional(),
  category: MemoryCategory.optional(),
  schemaVersion: z.string().optional(),
  versionedAt: z.string().optional(),
});
export type MemoryFrontmatter = z.infer<typeof MemoryFrontmatter>;

export interface MemoryFileEntry {
  id: string;
  name: string;
  path: string;
  indexed: boolean;
  tags: string[];
}

const MEMORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMESPACE_LOCK_TIMEOUT_MS = 10_000;
const NAMESPACE_LOCK_RETRY_MS = 25;
const STALE_LOCK_AGE_MS = 10_000;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Lazy getter — reads env at call time so tests can set KB_MEMORY_PATH before first use. */
function getKbRoot(): string {
  return process.env.KB_MEMORY_PATH ?? join(homedir(), ".kb", "memories");
}

/**
 * Resolves the directory path for a namespace without creating it.
 * Use for read-only operations (search, list, get).
 */
export function resolveNamespacePath(namespace: string): string {
  const root = getKbRoot();
  if (namespace.startsWith(".")) {
    throw new Error(`Invalid namespace: "${namespace}"`);
  }
  const nsPath = resolve(root, namespace);
  if (!nsPath.startsWith(`${resolve(root)}${sep}`)) {
    throw new Error(`Invalid namespace: "${namespace}"`);
  }
  return nsPath;
}

/**
 * Returns the directory path for a namespace, creating it if needed.
 * Use for write operations (add, migrate, index generation).
 */
export function ensureNamespacePath(namespace: string): string {
  const nsPath = resolveNamespacePath(namespace);
  mkdirSync(nsPath, { recursive: true });
  return nsPath;
}


export function assertValidMemoryId(id: string): void {
  if (!MEMORY_ID_RE.test(id)) {
    throw new Error(`Invalid memory id: "${id}"`);
  }
}

let lockRootCreated = false;

function getNamespaceLockPath(namespace: string): string {
  const lockRoot = join(getKbRoot(), ".locks");
  if (!lockRootCreated) {
    mkdirSync(lockRoot, { recursive: true });
    lockRootCreated = true;
  }
  return join(lockRoot, `${encodeURIComponent(namespace)}.lock`);
}

function breakStaleLock(lockPath: string): boolean {
  try {
    const age = Date.now() - statSync(lockPath).mtimeMs;
    if (age > STALE_LOCK_AGE_MS) {
      rmSync(lockPath, { recursive: true, force: true });
      console.error(`[fs-memory] Broke stale lock (${Math.round(age / 1000)}s old): ${lockPath}`);
      return true;
    }
  } catch {
    // Lock disappeared between check and stat — treat as broken
    return true;
  }
  return false;
}

export async function withNamespaceLock<T>(
  namespace: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = getNamespaceLockPath(namespace);
  const startedAt = Date.now();

  while (true) {
    try {
      mkdirSync(lockPath);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
      // Check for stale lock from a crashed process
      if (breakStaleLock(lockPath)) continue;
      if (Date.now() - startedAt >= NAMESPACE_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for namespace lock: "${namespace}"`);
      }
      await Bun.sleep(NAMESPACE_LOCK_RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

/**
 * Lists all namespace directories on disk.
 * Returns directory names (not full paths).
 */
export function listNamespaceDirs(): string[] {
  const root = getKbRoot();
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Normalizes tags to kebab-case lowercase.
 * "My Tag", "MY_TAG", "my tag" → "my-tag"
 */
export function normalizeTags(tags: string[]): string[] {
  return tags.map((tag) =>
    tag
      .toLowerCase()
      .replace(/[\s_]+/g, "-")      // spaces and underscores → hyphens
      .replace(/[^a-z0-9-]/g, "")  // strip non-alphanumeric (except hyphens)
      .replace(/-+/g, "-")          // collapse multiple hyphens
      .replace(/(?:^-)|(?:-$)/g, ""), // strip leading/trailing hyphens
  ).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Lower-level parse helper. Parses YAML frontmatter from markdown string content.
 */
export function parseFrontmatter(content: string): { frontmatter: MemoryFrontmatter; text: string } {
  const parsed = matter(content);
  const frontmatter = MemoryFrontmatter.parse(parsed.data);
  return { frontmatter, text: parsed.content.trim() };
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Atomic file write: write to .tmp sibling then rename.
 * Safe against crashes — either the old content or new content exists, never partial.
 */
function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, filePath);
}

/**
 * Writes a memory file atomically (write to .tmp then rename).
 * Returns the final file path.
 */
export function writeMemoryFile(
  id: string,
  text: string,
  frontmatter: MemoryFrontmatter,
): string {
  assertValidMemoryId(id);
  const nsPath = ensureNamespacePath(frontmatter.namespace);
  const finalPath = join(nsPath, `${id}.md`);

  // Serialize frontmatter + body using gray-matter
  const fileContent = matter.stringify(text.trim(), frontmatter as Record<string, unknown>);

  atomicWriteFile(finalPath, fileContent);

  return finalPath;
}

/**
 * Reads and parses a memory file. Validates frontmatter against the Zod schema.
 */
export function readMemoryFile(
  filePath: string,
): { frontmatter: MemoryFrontmatter; text: string } {
  const content = readFileSync(filePath, "utf-8");
  return parseFrontmatter(content);
}

/**
 * Deletes a memory file by name within a namespace.
 * Returns the deleted file's id/path, or null if not found.
 */
export function deleteMemoryFile(name: string, namespace: string): { id: string; path: string } | null {
  const entries = listMemoryFiles(namespace);
  const nameLower = name.toLowerCase();
  const match = entries.find((e) => e.name.toLowerCase() === nameLower);
  if (!match) return null;
  try {
    unlinkSync(match.path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return { id: match.id, path: match.path };
}

/**
 * Lists all memory files in a namespace directory.
 * Excludes _index.md. Returns parsed frontmatter metadata only (no body text).
 */
export function listMemoryFiles(namespace: string): MemoryFileEntry[] {
  const nsPath = resolveNamespacePath(namespace);
  if (!existsSync(nsPath)) return [];

  const files = readdirSync(nsPath).filter(
    (f) => f.endsWith(".md") && f !== "_index.md" && !f.startsWith("."),
  );

  const entries: MemoryFileEntry[] = [];
  for (const file of files) {
    const filePath = join(nsPath, file);
    try {
      // matter.read calls fs.readFileSync internally — acceptable for small KB files
      const parsed = matter.read(filePath);
      const frontmatter = MemoryFrontmatter.parse(parsed.data);
      entries.push({
        id: frontmatter.id,
        name: frontmatter.name,
        path: filePath,
        indexed: !!frontmatter.indexedAt,
        tags: frontmatter.tags,
      });
    } catch (err) {
      console.error(`[fs-memory] Failed to parse ${filePath}:`, err);
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Index generation
// ---------------------------------------------------------------------------

/**
 * Generates _index.md for a namespace path with a full table of all memories.
 * Sorted by createdAt descending.
 */
export function generateIndex(namespacePath: string): void {
  const namespace = basename(namespacePath);

  let files: string[];
  try {
    files = readdirSync(namespacePath).filter(
      (f) => f.endsWith(".md") && f !== "_index.md" && !f.startsWith("."),
    );
  } catch {
    files = [];
  }

  const entries: MemoryFrontmatter[] = [];
  for (const file of files) {
    const filePath = join(namespacePath, file);
    try {
      const parsed = matter.read(filePath);
      entries.push(MemoryFrontmatter.parse(parsed.data));
    } catch {
      // Skip unparseable files
    }
  }

  // Sort by createdAt descending
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = entries.length;
  const unindexed = entries.filter((e) => !e.indexedAt).length;

  const lines: string[] = [
    formatIndexHeader(namespace, total, unindexed),
    "",
    "| ID | Name | Tags | Indexed |",
    "|----|------|------|---------|",
  ];

  for (const e of entries) {
    const shortId = e.id.slice(0, 7);
    const tags = e.tags.join(", ").replace(/\|/g, "\\|");
    const escapedName = e.name.replace(/\|/g, "\\|");
    const indexed = e.indexedAt ? "✓" : "✗";
    lines.push(`| ${shortId} | ${escapedName} | ${tags} | ${indexed} |`);
  }

  lines.push(""); // trailing newline

  const indexPath = join(namespacePath, "_index.md");
  atomicWriteFile(indexPath, lines.join("\n"));
}

function formatIndexHeader(namespace: string, total: number, unindexed: number): string {
  return `# ${namespace} (${total} memories, ${unindexed} unindexed)`;
}

function readIndexCounts(lines: string[]): { total: number; unindexed: number } {
  const headerMatch = lines[0]?.match(/\((\d+) memories, (\d+) unindexed\)$/);
  if (headerMatch) {
    return {
      total: Number(headerMatch[1]),
      unindexed: Number(headerMatch[2]),
    };
  }

  const rows = lines.filter(
    (line) =>
      line.startsWith("| ")
      && line !== "| ID | Name | Tags | Indexed |"
      && line !== "|----|------|------|---------|",
  );

  return {
    total: rows.length,
    unindexed: rows.filter((line) => line.includes("✗")).length,
  };
}

/**
 * O(1) append: adds one table row to an existing _index.md without regenerating.
 * Creates _index.md with a minimal header if it doesn't exist yet.
 */
export function appendToIndex(namespacePath: string, entry: MemoryFrontmatter): void {
  const indexPath = join(namespacePath, "_index.md");
  const namespace = basename(namespacePath);
  const shortId = entry.id.slice(0, 7);
  const escapedName = entry.name.replace(/\|/g, "\\|");
  const tags = entry.tags.join(", ").replace(/\|/g, "\\|");
  const indexed = entry.indexedAt ? "✓" : "✗";
  const row = `| ${shortId} | ${escapedName} | ${tags} | ${indexed} |`;

  if (!existsSync(indexPath)) {
    const lines = [
      formatIndexHeader(namespace, 1, entry.indexedAt ? 0 : 1),
      "",
      "| ID | Name | Tags | Indexed |",
      "|----|------|------|---------|",
      row,
      "",
    ];
    atomicWriteFile(indexPath, lines.join("\n"));
    return;
  }

  const existingContent = readFileSync(indexPath, "utf-8");
  const lines = existingContent.endsWith("\n")
    ? existingContent.slice(0, -1).split("\n")
    : existingContent.split("\n");
  const { total, unindexed } = readIndexCounts(lines);

  const nextLines = [...lines];
  nextLines[0] = formatIndexHeader(
    namespace,
    total + 1,
    unindexed + (entry.indexedAt ? 0 : 1),
  );
  nextLines.push(row, "");

  atomicWriteFile(indexPath, nextLines.join("\n"));
}
