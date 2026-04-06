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
import { join } from "path";
import { mkdirSync, renameSync, readdirSync, existsSync, appendFileSync, writeFileSync, readFileSync } from "fs";
import matter from "gray-matter";

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
});
export type MemoryFrontmatter = z.infer<typeof MemoryFrontmatter>;

export interface MemoryFileEntry {
  id: string;
  name: string;
  path: string;
  indexed: boolean;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const KB_ROOT = join(homedir(), ".kb", "memories");

/**
 * Returns the directory path for a namespace, creating it if needed.
 * Example: ~/.kb/memories/default/
 */
export function getNamespacePath(namespace: string): string {
  const nsPath = join(KB_ROOT, namespace);
  mkdirSync(nsPath, { recursive: true });
  return nsPath;
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
      .replace(/^-|-$/g, ""),       // strip leading/trailing hyphens
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
 * Writes a memory file atomically (write to .tmp then rename).
 * Returns the final file path.
 */
export async function writeMemoryFile(
  id: string,
  text: string,
  frontmatter: MemoryFrontmatter,
): Promise<string> {
  const nsPath = getNamespacePath(frontmatter.namespace);
  const finalPath = join(nsPath, `${id}.md`);
  const tmpPath = join(nsPath, `.${id}.md.tmp`);

  // Serialize frontmatter + body using gray-matter
  const fileContent = matter.stringify(text.trim(), frontmatter as Record<string, unknown>);

  writeFileSync(tmpPath, fileContent);
  renameSync(tmpPath, finalPath); // atomic on same filesystem

  return finalPath;
}

/**
 * Reads and parses a memory file. Validates frontmatter against the Zod schema.
 */
export async function readMemoryFile(
  filePath: string,
): Promise<{ frontmatter: MemoryFrontmatter; text: string }> {
  const content = readFileSync(filePath, "utf-8");
  return parseFrontmatter(content);
}

/**
 * Lists all memory files in a namespace directory.
 * Excludes _index.md. Returns parsed frontmatter metadata only (no body text).
 */
export function listMemoryFiles(namespace: string): MemoryFileEntry[] {
  const nsPath = getNamespacePath(namespace);

  let files: string[];
  try {
    files = readdirSync(nsPath).filter(
      (f) => f.endsWith(".md") && f !== "_index.md" && !f.startsWith("."),
    );
  } catch {
    return [];
  }

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
  const namespace = namespacePath.split("/").at(-1) ?? "unknown";

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
    `# ${namespace} (${total} memories, ${unindexed} unindexed)`,
    "",
    "| ID | Name | Tags | Indexed |",
    "|----|------|------|---------|",
  ];

  for (const e of entries) {
    const shortId = e.id.slice(0, 7);
    const tags = e.tags.join(", ");
    const indexed = e.indexedAt ? "✓" : "✗";
    lines.push(`| ${shortId} | ${e.name} | ${tags} | ${indexed} |`);
  }

  lines.push(""); // trailing newline

  const indexPath = join(namespacePath, "_index.md");
  writeFileSync(indexPath, lines.join("\n"));
}

/**
 * O(1) append: adds one table row to an existing _index.md without regenerating.
 * Creates _index.md with a minimal header if it doesn't exist yet.
 */
export function appendToIndex(namespacePath: string, entry: MemoryFrontmatter): void {
  const indexPath = join(namespacePath, "_index.md");
  const shortId = entry.id.slice(0, 7);
  const tags = entry.tags.join(", ");
  const indexed = entry.indexedAt ? "✓" : "✗";
  const row = `| ${shortId} | ${entry.name} | ${tags} | ${indexed} |\n`;

  if (!existsSync(indexPath)) {
    const namespace = namespacePath.split("/").at(-1) ?? "unknown";
    const header = [
      `# ${namespace}`,
      "",
      "| ID | Name | Tags | Indexed |",
      "|----|------|------|---------|",
      "",
    ].join("\n");
    appendFileSync(indexPath, header);
  }

  appendFileSync(indexPath, row);
}
