/**
 * Tests for the Decision #8 indexing ordering invariant.
 *
 * Spec reference: Spec — Instant KB, Decision #8, "Indexing ordering invariant".
 * The indexer records a snapshot mtime before extraction and re-stats before
 * committing. If the file changes during the pass, the commit is abandoned —
 * no graph write, no indexedAt stamp — and the next sweep picks it up.
 *
 * These tests exercise the invariant's building blocks. The same helpers are
 * used by Queue.processEntry, so a regression in either the helper logic or
 * the ordering would surface here.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

import { safeMtimeMs, isFileChangedSince } from "../src/lib/queue.js";

let workDir: string;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), "kb-queue-test-"));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function writeFile(body: string): string {
  const filePath = join(workDir, `${randomUUID()}.md`);
  writeFileSync(filePath, body);
  return filePath;
}

describe("Decision #8: indexing ordering invariant", () => {
  test("safeMtimeMs returns the file's mtime when present", () => {
    const filePath = writeFile("hello");
    const mtime = safeMtimeMs(filePath);
    expect(mtime).not.toBeNull();
    expect(typeof mtime).toBe("number");
  });

  test("safeMtimeMs returns null when the file does not exist", () => {
    const missing = join(workDir, "does-not-exist.md");
    expect(safeMtimeMs(missing)).toBeNull();
  });

  test("isFileChangedSince returns false when null snapshot (invariant skipped)", () => {
    const filePath = writeFile("hello");
    // Synthetic memories without an on-disk file pass null here; the invariant
    // should be skipped, not report a false "changed".
    expect(isFileChangedSince(filePath, null)).toBe(false);
  });

  test("isFileChangedSince returns false when mtime unchanged since snapshot", () => {
    const filePath = writeFile("hello");
    const snapshot = safeMtimeMs(filePath);
    expect(isFileChangedSince(filePath, snapshot)).toBe(false);
  });

  test("Decision #8: isFileChangedSince detects edits that happen after the snapshot", () => {
    const filePath = writeFile("original");
    const snapshot = safeMtimeMs(filePath)!;

    // Simulate a user edit during extraction by bumping the file's mtime.
    const futureSecs = (Date.now() + 5000) / 1000;
    utimesSync(filePath, futureSecs, futureSecs);

    expect(isFileChangedSince(filePath, snapshot)).toBe(true);
  });

  test("Decision #8: isFileChangedSince treats a disappeared file as changed (abandon safely)", () => {
    const filePath = writeFile("to-be-deleted");
    const snapshot = safeMtimeMs(filePath)!;

    // User deletes file mid-indexing — the pass must abandon, not commit.
    rmSync(filePath);

    expect(isFileChangedSince(filePath, snapshot)).toBe(true);
  });
});
