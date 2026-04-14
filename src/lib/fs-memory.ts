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
import {
  mkdirSync,
  renameSync,
  readdirSync,
  existsSync,
  writeFileSync,
  appendFileSync,
  readFileSync,
  rmSync,
  unlinkSync,
  statSync,
  openSync,
  closeSync,
  utimesSync,
} from "fs";
import { randomUUID } from "crypto";
import matter from "gray-matter";
import { MemoryCategory } from "../types.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const Origin = z.enum(["manual", "retro", "mcp", "import"]);
export type Origin = z.infer<typeof Origin>;

// ISO 8601 timestamp refinement. Downstream code calls `Date.parse`,
// `localeCompare`, and constructs `new Date(...)` on these values; a
// user-edited file with a human-readable date like "2026-04-13" would
// otherwise slip past validation and surface as a crash or a mis-sort
// far from the source of the corruption.
const IsoTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "expected ISO 8601 timestamp (e.g., 2026-04-13T00:00:00Z)",
  });

export const MemoryFrontmatter = z.object({
  id: z.uuid(),
  name: z.string(),
  origin: Origin,
  namespace: z.string().min(1, "namespace must be a non-empty string"),
  tags: z.array(z.string()).default([]),
  createdAt: IsoTimestamp,
  indexedAt: IsoTimestamp.optional(), // set when server has processed this file
  abstract: z.string().optional(),  // filled by indexer (Phase 2)
  summary: z.string().optional(),
  category: MemoryCategory.optional(),
  schemaVersion: z.string().optional(),
  versionedAt: IsoTimestamp.optional(),
}).loose();
export type MemoryFrontmatter = z.infer<typeof MemoryFrontmatter>;

export interface MemoryFileEntry {
  id: string;
  name: string;
  path: string;
  indexed: boolean;
  /**
   * ISO timestamp of last indexing, when known. The slow path (directory walk)
   * populates this from frontmatter. The `_index.md` fast path does not carry
   * the timestamp — only the `indexed` bool — so this is `undefined` there.
   * Callers that need staleness detection must read it on demand when missing.
   */
  indexedAt?: string;
  tags: string[];
}

const MEMORY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Spec Decision #12: stale-lock break at 30s. The lock is held only for the
// commit window (tempfile write + rename + _index.md regen) — sub-second on a
// healthy disk — so 30s is generous margin against false-stale judgements
// during a stop-the-world GC, FUSE hiccup, or laptop sleep mid-commit.
// `timeoutMs` is the waiter budget; staying at 10s keeps user-facing waits
// short while still letting one or two normal commits complete in front of us.
const defaultLockTimings = {
  timeoutMs: 10_000,
  retryMs: 25,
  staleLockAgeMs: 30_000,
};
const lockTimings = { ...defaultLockTimings };

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
 *
 * Namespaces are single-segment directory names. Multi-segment inputs
 * (`foo/bar`) are rejected — otherwise `_index.md` header rendering
 * (which calls `basename(namespacePath)`) would show just the tail
 * segment and hide the true namespace. Spec Decision #3: namespaces are
 * hard isolation boundaries, not a hierarchy.
 */
export function resolveNamespacePath(namespace: string): string {
  const root = getKbRoot();
  if (namespace.startsWith(".")) {
    throw new Error(`Invalid namespace: "${namespace}"`);
  }
  if (namespace.includes("/") || namespace.includes(sep)) {
    throw new Error(
      `Invalid namespace: "${namespace}" — namespaces are single-segment directory names, not paths`,
    );
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

/**
 * Canonical name normalization used by add-dedup, get, forget. Trailing
 * whitespace from a hand-edited frontmatter would otherwise let the same
 * memory be findable by `add` (which trims) but unfindable by `forget`
 * (which previously did not).
 */
export function normalizeNameForLookup(name: string): string {
  return name.trim().toLowerCase();
}

function getNamespaceLockPath(namespace: string): string {
  // Pure resolver — callers that need the directory present (only writers
  // do) call ensureLockRoot first. Read paths must not mutate the FS just
  // by asking for a path; previously this mkdir'd unconditionally and
  // would throw on a readonly mount.
  return join(getKbRoot(), ".locks", `${encodeURIComponent(namespace)}.lock`);
}

function ensureLockRoot(): void {
  mkdirSync(join(getKbRoot(), ".locks"), { recursive: true });
}

function getLockHeartbeatPath(lockPath: string): string {
  return join(lockPath, ".heartbeat");
}

function getLockTokenPath(lockPath: string): string {
  return join(lockPath, ".token");
}

function touchLockHeartbeat(lockPath: string): void {
  const heartbeatPath = getLockHeartbeatPath(lockPath);
  const now = new Date();
  try {
    utimesSync(heartbeatPath, now, now);
  } catch {
    writeFileSync(heartbeatPath, "");
  }
}

/**
 * Release a lock only if we still own it.
 *
 * If a slow holder was judged stale and reclaimed while its work was still
 * running, a blind `rmSync(lockPath)` in a finally block would delete the
 * reclaimer's live lock and open the critical section to concurrent writers.
 * The token written at acquire time is the ownership proof: only remove the
 * directory if the token on disk still matches ours.
 */
function releaseLockIfOwned(lockPath: string, token: string): void {
  let onDisk: string;
  try {
    onDisk = readFileSync(getLockTokenPath(lockPath), "utf8");
  } catch {
    // Lock directory or token file already gone — someone else owns (or owned) it.
    return;
  }
  if (onDisk !== token) return;
  rmSync(lockPath, { recursive: true, force: true });
}


function handleReclaimConflict(lockPath: string): boolean {
  // Another writer is reclaiming. If their marker is itself stale (a prior
  // reclaimer crashed between creating .reclaiming and rmSync'ing the lock),
  // wipe it so the next iteration can try again. Returning false makes the
  // caller sleep + honor timeoutMs rather than spinning forever.
  try {
    const claimPath = join(lockPath, ".reclaiming");
    const claimAge = Date.now() - statSync(claimPath).mtimeMs;
    if (claimAge > lockTimings.staleLockAgeMs) {
      rmSync(claimPath, { force: true });
    }
  } catch {
    // Marker disappeared — next iteration will retry fresh.
  }
  return false;
}

function breakStaleLock(lockPath: string): boolean {
  let heartbeatPath: string;
  let statMs: number;
  try {
    heartbeatPath = getLockHeartbeatPath(lockPath);
    const statPath = existsSync(heartbeatPath) ? heartbeatPath : lockPath;
    statMs = statSync(statPath).mtimeMs;
  } catch (err) {
    // ENOENT: the lock (or heartbeat) disappeared between existsSync and stat.
    // That's the benign race we actually want to signal as "broken" so the
    // caller retries mkdir. Every other errno (EACCES on a read-only volume,
    // ENOSPC, EIO, permission on the parent) is a real problem — silently
    // swallowing it would let two writers into the critical section on a
    // system that can't hold a lock at all. Spec Decision #13 says only ENOENT
    // is recoverable during break.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw err;
  }

  const age = Date.now() - statMs;
  if (age <= lockTimings.staleLockAgeMs) return false;

  try {
    const claimPath = join(lockPath, ".reclaiming");
    const claimFd = openSync(claimPath, "wx");
    closeSync(claimFd);
    rmSync(lockPath, { recursive: true, force: true });
    console.error(`[fs-memory] Broke stale lock (${Math.round(age / 1000)}s old): ${lockPath}`);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Lock vanished mid-reclaim — caller's next mkdir will succeed.
      return true;
    }
    if (code === "EEXIST") {
      return handleReclaimConflict(lockPath);
    }
    throw err;
  }
}


async function acquireLock(lockPath: string, token: string, startedAt: number): Promise<void> {
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(getLockTokenPath(lockPath), token);
      touchLockHeartbeat(lockPath);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error;
      }
      if (breakStaleLock(lockPath)) continue;
      if (Date.now() - startedAt >= lockTimings.timeoutMs) {
        throw new Error(`Timed out waiting for namespace lock: "${lockPath}"`);
      }
      await Bun.sleep(lockTimings.retryMs);
    }
  }
}

export async function withNamespaceLock<T>(
  namespace: string,
  fn: () => Promise<T>,
): Promise<T> {
  ensureLockRoot();
  const lockPath = getNamespaceLockPath(namespace);
  const startedAt = Date.now();
  const token = randomUUID();
  await acquireLock(lockPath, token, startedAt);

  const heartbeatIntervalMs = Math.max(1, Math.min(lockTimings.retryMs, Math.floor(lockTimings.staleLockAgeMs / 2)));
  const heartbeat = setInterval(() => {
    try {
      touchLockHeartbeat(lockPath);
    } catch {
      // Lock is gone or being cleaned up; the holder will exit naturally.
    }
  }, heartbeatIntervalMs);

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    releaseLockIfOwned(lockPath, token);
  }
}

export function configureFsMemoryTimingForTests(overrides: Partial<typeof defaultLockTimings>): void {
  if (overrides.timeoutMs !== undefined) lockTimings.timeoutMs = overrides.timeoutMs;
  if (overrides.retryMs !== undefined) lockTimings.retryMs = overrides.retryMs;
  if (overrides.staleLockAgeMs !== undefined) lockTimings.staleLockAgeMs = overrides.staleLockAgeMs;
}

export function resetFsMemoryTimingForTests(): void {
  lockTimings.timeoutMs = defaultLockTimings.timeoutMs;
  lockTimings.retryMs = defaultLockTimings.retryMs;
  lockTimings.staleLockAgeMs = defaultLockTimings.staleLockAgeMs;
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
 * Atomic file write: write to a unique sibling tempfile, then rename.
 * Safe against crashes — either the old content or new content exists, never partial.
 *
 * The tempfile name carries pid + a uuid suffix so two concurrent writers
 * (e.g. the locked commit path and the lock-free self-heal in
 * `listMemoryFiles`) never share a tmp path. Without this, a deterministic
 * `${filePath}.tmp` lets two procs interleave writes — the second's
 * `writeFileSync` would clobber the first's tmp before either rename, and
 * the surviving rename could ship corrupted bytes.
 */
export function atomicWriteFile(filePath: string, content: string): void {
  const tmpPath = `${filePath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup if the rename failed mid-flight, so we don't leave
    // unique-suffix detritus behind.
    try { rmSync(tmpPath, { force: true }); } catch { /* ignore */ }
    throw err;
  }
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
 * Callers own the index regeneration — this function does NOT update `_index.md`.
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
 * Tombstones a memory per Spec Decision #11: renames the file to
 * `{uuid}.md.deleted` (body preserved for recovery) and appends a record to
 * `{namespace}/_tombstones.jsonl`. The CLI never opens LadybugDB — the server
 * reconciler (Phase 2) consumes tombstones and applies graph cleanup.
 * Returns the tombstoned file's id/path, or null if not found.
 * Callers own index regeneration.
 */
export function tombstoneMemoryFile(
  name: string,
  namespace: string,
  reason: string,
): { id: string; path: string; tombstonePath: string } | null {
  const entries = listMemoryFiles(namespace);
  // Normalize identically to addMemoryLocked's dedup (`name.trim().toLowerCase()`).
  // Without `.trim()`, a file written with trailing whitespace blocks `add("Foo")`
  // as existing but `forget("Foo")` misses it — the file becomes unforget-able.
  const nameLower = normalizeNameForLookup(name);
  const match = entries.find((e) => normalizeNameForLookup(e.name) === nameLower);
  if (!match) return null;

  const tombstonePath = `${match.path}.deleted`;
  try {
    renameSync(match.path, tombstonePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const nsPath = resolveNamespacePath(namespace);
  const jsonlPath = join(nsPath, "_tombstones.jsonl");
  const record = JSON.stringify({
    id: match.id,
    name: match.name,
    reason,
    timestamp: new Date().toISOString(),
  }) + "\n";
  try {
    // O_APPEND is atomic for single writes under PIPE_BUF on POSIX, so this
    // is crash-safer than read-concat-write and avoids dropping concurrent
    // records if a caller skips the namespace lock.
    appendFileSync(jsonlPath, record);
  } catch (err) {
    // Best-effort: if the log write fails after the rename, the file is still
    // tombstoned (searches won't return it). Reconciler will catch up via directory scan.
    console.error(`[fs-memory] Failed to append to _tombstones.jsonl:`, err);
  }

  return { id: match.id, path: match.path, tombstonePath };
}

/**
 * Appends an edge-forget intent to `{namespace}/_forget_edges.jsonl` per Spec
 * Decision #11. The CLI never opens LadybugDB; the server reconciler consumes
 * the log and invalidates the edge with the recorded reason.
 */
export function recordForgetEdge(
  edgeId: string,
  reason: string,
  namespace: string,
): void {
  const nsPath = resolveNamespacePath(namespace);
  if (!existsSync(nsPath)) mkdirSync(nsPath, { recursive: true });
  const jsonlPath = join(nsPath, "_forget_edges.jsonl");
  const record = JSON.stringify({
    edgeId,
    reason,
    timestamp: new Date().toISOString(),
  }) + "\n";
  // O_APPEND is atomic for single writes under PIPE_BUF on POSIX. Prior
  // read-concat-write silently lost concurrent records when called outside a
  // namespace lock — appendFileSync is both correct and lock-free-safe.
  appendFileSync(jsonlPath, record);
}

/**
 * Unescapes a cell value written by `escapeCell`. Reverses both the
 * `\\` → `\` and `\|` → `|` transforms in the correct order: `\\` first so
 * a literal backslash-pipe sequence is not misread as an escape.
 */
function parseIndexCell(cell: string): string {
  return cell
    .trim()
    // Walk the cell char-by-char so `\\` and `\|` are decoded in one pass
    // without the regex reordering hazard (decoding `\\` after `\|` would
    // turn a user's literal `\|` into `|` followed by a stray `\`).
    .replace(/\\(.)/g, (_match, c) => c);
}

/**
 * Escapes a cell value for writing into a markdown table row. Both `\` and
 * `|` need escaping — `|` because it's the column separator, `\` because
 * its presence before a literal `|` would otherwise be misread as an
 * escape sequence during parse. Order matters: escape `\` first so the
 * backslashes introduced by the `|` replacement aren't themselves escaped.
 */
function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

// Tags are joined by `, ` inside the tags cell; a literal comma in a
// hand-edited tag (Decision #12 allows manual frontmatter edits) would
// be split as two tags. Percent-encode commas at the cell boundary so
// the round-trip preserves them. Slow path (matter.read) is unaffected.
function encodeTagForIndex(tag: string): string {
  return tag.replace(/,/g, "%2C");
}

function decodeTagFromIndex(tag: string): string {
  return tag.replace(/%2C/g, ",");
}

/**
 * Splits a markdown table row on unescaped `|`. Writers use `escapeCell`
 * to produce `\\` and `\|` escapes; this scanner consumes one escape per
 * `\` so literal `\|` sequences survive round-trip without collapsing.
 */
function splitRowCells(row: string): string[] {
  const cells: string[] = [];
  let buf = "";
  let escapeNext = false;
  for (const c of row) {
    if (escapeNext) {
      // Preserve the escape sequence verbatim — parseIndexCell will decode
      // `\\` → `\` and `\|` → `|` in a second pass. Doing the decode here
      // would be wrong: cell boundaries are determined first (on UNESCAPED
      // `|`), then each cell's contents are unescaped.
      buf += "\\" + c;
      escapeNext = false;
      continue;
    }
    if (c === "\\") {
      escapeNext = true;
      continue;
    }
    if (c === "|") {
      cells.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  if (escapeNext) buf += "\\";
  cells.push(buf);
  return cells;
}

function parseIndexEntries(namespacePath: string): MemoryFileEntry[] | null {
  const indexPath = join(namespacePath, "_index.md");
  if (!existsSync(indexPath)) return null;

  try {
    const lines = readFileSync(indexPath, "utf-8").split("\n");
    if (!lines.includes("| ID | Name | Tags | Indexed |")) {
      return null;
    }
    const rows = lines.filter(
      (line) =>
        line.startsWith("| ")
        && line !== "| ID | Name | Tags | Indexed |"
        && line !== "|----|------|------|---------|",
    );

    const entries: MemoryFileEntry[] = [];
    for (const row of rows) {
      const parts = splitRowCells(row).slice(1, -1).map(parseIndexCell);
      if (parts.length < 4) return null;
      const [id, name, tags, indexed] = parts;
      if (!id || !MEMORY_ID_RE.test(id)) {
        return null;
      }
      entries.push({
        id,
        name: name ?? "",
        path: join(namespacePath, `${id}.md`),
        indexed: indexed === "✓",
        tags: tags
          ? tags.split(",").map((tag) => decodeTagFromIndex(tag.trim())).filter(Boolean)
          : [],
      });
    }
    return entries;
  } catch {
    return null;
  }
}

/**
 * Reads `.md` filenames (IDs) from a namespace directory, excluding `_index.md`
 * and hidden files. Returns an empty array if the directory doesn't exist.
 */
function readDiskIds(nsPath: string): string[] {
  try {
    return readdirSync(nsPath)
      .filter((f) => f.endsWith(".md") && f !== "_index.md" && !f.startsWith("."))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

/**
 * Returns true if any memory file in the namespace has an mtime newer than
 * `_index.md`. Signals that a user edited frontmatter in place and the cache
 * is serving stale metadata (same ID set but different names/tags/indexedAt).
 *
 * Without this check, Spec Decision #1 ("files win on disagreement") is
 * violated on the fast path — the cache serves stale data forever once the
 * ID set matches.
 */
function isIndexStale(nsPath: string): boolean {
  const indexPath = join(nsPath, "_index.md");
  let indexMtime: number;
  try {
    indexMtime = statSync(indexPath).mtimeMs;
  } catch {
    // No _index.md — treat as stale so the slow path regenerates it.
    return true;
  }

  let files: string[];
  try {
    files = readdirSync(nsPath).filter(
      (f) => f.endsWith(".md") && f !== "_index.md" && !f.startsWith("."),
    );
  } catch {
    return false;
  }

  for (const file of files) {
    try {
      if (statSync(join(nsPath, file)).mtimeMs > indexMtime) return true;
    } catch {
      // File disappeared mid-check — ignore, slow path handles it.
    }
  }
  return false;
}

/**
 * Lists all memory files in a namespace directory.
 * Excludes _index.md. Returns parsed frontmatter metadata only (no body text).
 *
 * Fast path: read `_index.md` and verify its ID set matches the directory.
 * On drift (ghost entries or orphan files — e.g. crash mid-write, manual
 * edits), fall through to the slow path and regenerate the index so the
 * next call is fast again. Spec Decision #1: files win on disagreement.
 */
export function listMemoryFiles(namespace: string): MemoryFileEntry[] {
  const nsPath = resolveNamespacePath(namespace);
  if (!existsSync(nsPath)) return [];

  const indexedEntries = parseIndexEntries(nsPath);
  if (indexedEntries) {
    const diskIds = new Set(readDiskIds(nsPath));
    const idsInSync =
      diskIds.size === indexedEntries.length
      && indexedEntries.every((e) => diskIds.has(e.id));
    if (idsInSync && !isIndexStale(nsPath)) return indexedEntries;
    // Drift detected — either ID set diverged, or a memory file is newer
    // than _index.md (user edited frontmatter in place). Spec Decision #1:
    // files win. Fall through to slow path and regenerate the index.
  }

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
        indexedAt: frontmatter.indexedAt,
        tags: frontmatter.tags,
      });
    } catch (err) {
      console.error(`[fs-memory] Failed to parse ${filePath}:`, err);
    }
  }

  // Self-heal: reconcile _index.md with disk so the next call takes the fast path.
  // listMemoryFiles is synchronous and lock-free by design, so we can't reach
  // through `withNamespaceLock` here. Instead, yield to any in-progress writer:
  // if the namespace lock directory exists, that writer will regenerate the
  // index when it commits, and our self-heal would race its snapshot.
  // When no writer is active, we do the regeneration directly — still best-effort.
  if (!existsSync(getNamespaceLockPath(namespace))) {
    try {
      generateIndex(nsPath);
    } catch (err) {
      console.error(`[fs-memory] Failed to regenerate _index.md after drift:`, err);
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
    const tags = escapeCell(e.tags.map(encodeTagForIndex).join(", "));
    const escapedName = escapeCell(e.name);
    const indexed = e.indexedAt ? "✓" : "✗";
    lines.push(`| ${e.id} | ${escapedName} | ${tags} | ${indexed} |`);
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

  // Count unindexed by inspecting the trailing "Indexed" cell rather than
  // scanning for a literal ✗ anywhere in the line (names/tags may contain ✗).
  return {
    total: rows.length,
    unindexed: rows.filter((line) => line.trimEnd().endsWith("✗ |")).length,
  };
}

/**
 * O(1) append: adds one table row to an existing _index.md without regenerating.
 * Creates _index.md with a minimal header if it doesn't exist yet.
 */
/**
 * Updates a single existing row in `_index.md` by memory id. Falls back to a
 * full `generateIndex` regeneration if the row isn't found (e.g., on first
 * write-back for a pre-existing file without an index yet).
 */
export function updateIndexEntry(namespacePath: string, entry: MemoryFrontmatter): void {
  const indexPath = join(namespacePath, "_index.md");
  if (!existsSync(indexPath)) {
    generateIndex(namespacePath);
    return;
  }

  const namespace = basename(namespacePath);
  const existingContent = readFileSync(indexPath, "utf-8");
  const lines = existingContent.endsWith("\n")
    ? existingContent.slice(0, -1).split("\n")
    : existingContent.split("\n");

  const rowPrefix = `| ${entry.id} |`;
  const rowIndex = lines.findIndex((line) => line.startsWith(rowPrefix));
  if (rowIndex === -1) {
    generateIndex(namespacePath);
    return;
  }

  const escapedName = escapeCell(entry.name);
  const tags = escapeCell(entry.tags.map(encodeTagForIndex).join(", "));
  const indexed = entry.indexedAt ? "✓" : "✗";
  const newRow = `| ${entry.id} | ${escapedName} | ${tags} | ${indexed} |`;

  const { total, unindexed } = readIndexCounts(lines);
  const oldRow = lines[rowIndex];
  // Parse the indexed marker out of the last cell rather than matching
  // against the full row suffix. endsWith(" ✓ |") would silently return
  // wrong counts if the row format ever gains trailing whitespace or
  // another column — this stays correct through layout changes.
  const oldCells = splitRowCells(oldRow).slice(1, -1).map(parseIndexCell);
  const wasIndexed = (oldCells[3]?.trim() ?? "") === "✓";
  const nowIndexed = Boolean(entry.indexedAt);
  const unindexedDelta = (wasIndexed ? 0 : 1) - (nowIndexed ? 0 : 1);

  const nextLines = [...lines];
  nextLines[rowIndex] = newRow;
  nextLines[0] = formatIndexHeader(namespace, total, unindexed - unindexedDelta);
  // Trailing newline is mandatory — appendToIndex writes with one, so
  // updateIndexEntry must too, or every pair of writes flip-flops the
  // newline and produces spurious git diffs (Goal #3 git-trackable).
  nextLines.push("");

  atomicWriteFile(indexPath, nextLines.join("\n"));
}

export function appendToIndex(namespacePath: string, entry: MemoryFrontmatter): void {
  const indexPath = join(namespacePath, "_index.md");
  const namespace = basename(namespacePath);
  const escapedName = escapeCell(entry.name);
  const tags = escapeCell(entry.tags.map(encodeTagForIndex).join(", "));
  const indexed = entry.indexedAt ? "✓" : "✗";
  const row = `| ${entry.id} | ${escapedName} | ${tags} | ${indexed} |`;

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
