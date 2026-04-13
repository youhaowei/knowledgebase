#!/usr/bin/env bun
/**
 * Knowledgebase CLI
 *
 * Usage: bun run kb <command> [args] [--flags]
 * Commands: add, search, get, forget, forget-edge, stats
 * Interactive: bun run kb (no args or -i)
 */

export {};

// --- Arg parsing (before any imports that trigger Graph init) ---

interface ParsedArgs {
  flags: Record<string, string>;
  positional: string[];
}

class UsageError extends Error {}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === "--tag") {
      const existing = flags["--tag"] ?? "";
      flags["--tag"] = existing ? `${existing},${argv[++i] ?? ""}` : (argv[++i] ?? "");
    } else if (arg === "--env" || arg === "--namespace" || arg === "--ns" || arg === "--name" || arg === "--limit" || arg === "--since" || arg === "--op" || arg === "--origin") {
      const key = arg === "--ns" ? "--namespace" : arg;
      flags[key] = argv[++i] ?? "";
    } else if (arg === "--json" || arg === "-i" || arg === "--dry-run") {
      flags[arg] = "true";
    } else if (arg.startsWith("--")) {
      flags[arg] = argv[++i] ?? "";
    } else {
      positional.push(arg);
    }
    i++;
  }

  return { flags, positional };
}

const initialArgs = parseArgs(process.argv.slice(2));
const envName = initialArgs.flags["--env"];

// Set env BEFORE importing modules that create Graph singletons.
// Only fill gaps — if the caller (a test harness, a sandboxed child, a
// developer experimenting) already exported KB_MEMORY_PATH or
// LADYBUG_DATA_PATH, respect it. `--env` is a convenience default, not
// an override. This preserves the Decision #11 isolation guarantee while
// letting test runners pin paths to tmpdir for cleanup.
if (envName) {
  process.env.LADYBUG_DATA_PATH ??= `./.ladybug-${envName}`;
  process.env.KB_MEMORY_PATH ??= `./.kb-${envName}/memories`;
}

// --- Dynamic imports (after env is set) ---

const ops = await import("./lib/operations.js");
const { analyticsContext } = await import("./lib/analytics.js");
const { hybridSearch } = await import("./lib/hybrid-search.js");

// --- Context for command execution ---

interface CmdContext {
  positional: string[];
  flags: Record<string, string>;
  json: boolean;
  namespace: string;
}

function ctxFrom(args: ParsedArgs, defaults?: Partial<ParsedArgs>): CmdContext {
  const ns = args.flags["--namespace"] ?? defaults?.flags?.["--namespace"] ?? "default";
  return {
    positional: args.positional,
    flags: args.flags,
    json: args.flags["--json"] === "true",
    namespace: ns,
  };
}

// --- Output helpers ---

function out(ctx: CmdContext, data: unknown) {
  if (ctx.json || typeof data !== "string") {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

function formatEdge(e: { sourceEntityName: string; targetEntityName: string; relationType: string; fact: string; sentiment: number; id: string }) {
  return `  ${e.sourceEntityName} --[${e.relationType}]--> ${e.targetEntityName}\n    "${e.fact}" (sentiment: ${e.sentiment}) [${e.id}]`;
}

function formatEntity(e: { name: string; type: string; description?: string }) {
  const desc = e.description ? ` — ${e.description}` : "";
  return `  ${e.name} (${e.type})${desc}`;
}

// --- Command handlers (throw UsageError instead of process.exit) ---

async function handleAdd(ctx: CmdContext) {
  const text = ctx.positional[1];
  if (!text) throw new UsageError("Usage: kb add <text> [--name <name>] [--ns <namespace>]");
  const name = ctx.flags["--name"];
  const originRaw = ctx.flags["--origin"] ?? "manual";
  const validOrigins = ["manual", "retro", "mcp", "import"] as const;
  if (!validOrigins.includes(originRaw as (typeof validOrigins)[number])) {
    throw new UsageError(`Invalid --origin: "${originRaw}". Must be one of: ${validOrigins.join(", ")}`);
  }
  const origin = originRaw as import("./lib/fs-memory.js").Origin;
  const tags = ctx.flags["--tag"]?.split(",").filter(Boolean) ?? [];
  const result = await ops.addMemory(text, name, ctx.namespace, origin, tags);
  const msg = result.status === "existing"
    ? `Memory already exists: ${result.id}. To update, edit: ${result.path}`
    : `Written ${result.path}`;
  out(ctx, ctx.json ? result : msg);
}

function formatFileResult(f: { id: string; name: string; indexed: boolean; tags: string[]; matchContext?: string }): string {
  const label = f.name || `(unnamed: ${f.id.slice(0, 7)})`;
  const status = f.indexed ? "" : " [unindexed]";
  const tags = f.tags.length ? ` [${f.tags.join(", ")}]` : "";
  const context = f.matchContext ? `\n    ...${f.matchContext.slice(0, 80)}...` : "";
  return `  ${label}${status}${tags}${context}`;
}

function formatMemory(m: { id: string; name: string; summary: string; text: string }): string {
  return `  [${m.id}] ${m.name || "(unnamed)"} — ${m.summary || m.text.slice(0, 80)}`;
}

function printSection<T>(label: string, items: T[], fmt: (item: T) => string) {
  if (items.length === 0) return;
  console.log(`\n${label} (${items.length}):`);
  for (const item of items) console.log(fmt(item));
}

function printSearchResults(result: Awaited<ReturnType<typeof hybridSearch>>) {
  printSection("Files", result.files, formatFileResult);
  printSection("Memories", result.memories, formatMemory);
  printSection("Edges", result.edges, formatEdge);
  printSection("Entities", result.entities, formatEntity);

  const total = result.files.length + result.memories.length + result.edges.length + result.entities.length;
  if (total === 0) console.log("No results found.");

  // Structured signals per Spec Decision #8 — rendered to stderr so stdout
  // stays machine-readable when piped without --json.
  const { signals } = result;
  if (signals.degraded) {
    console.error("  ⚠ graph unavailable — filesystem results only");
  }
  if (signals.unindexedCount > 0) {
    console.error(`  ⚠ ${signals.unindexedCount} result${signals.unindexedCount === 1 ? "" : "s"} not yet indexed`);
  }
  if (signals.staleCount > 0) {
    console.error(`  ⚠ ${signals.staleCount} result${signals.staleCount === 1 ? "" : "s"} edited since last index`);
  }
}

async function handleSearch(ctx: CmdContext) {
  const query = ctx.positional[1];
  if (!query) throw new UsageError("Usage: kb search <query> [--limit <n>] [--ns <namespace>]");
  const parsed = parseInt(ctx.flags["--limit"] ?? "", 10);
  const limit = Number.isNaN(parsed) ? 10 : parsed;
  const tags = ctx.flags["--tag"]?.split(",").filter(Boolean);
  const result = await hybridSearch(query, ctx.namespace, limit, tags);

  if (ctx.json) {
    out(ctx, result);
    return;
  }
  printSearchResults(result);
}

async function handleGet(ctx: CmdContext) {
  const name = ctx.positional[1];
  if (!name) throw new UsageError("Usage: kb get <name> [--ns <namespace>]");
  const result = await ops.getByName(name, ctx.namespace);

  if (ctx.json) {
    out(ctx, result);
    return;
  }

  if (!result.entity && !result.memory) {
    console.log(`"${name}" not found.`);
    return;
  }

  if (result.memory) {
    const m = result.memory;
    const status = m.status === "pending" ? " [unindexed]" : "";
    console.log(`\n  Memory: ${m.name || "(unnamed)"}${status}`);
    console.log(`  ${m.summary || m.text.slice(0, 120)}`);
  }
  if (result.entity) {
    console.log(`\n${formatEntity(result.entity)}`);
  }
  if (result.edges.length > 0) {
    console.log(`\nEdges (${result.edges.length}):`);
    for (const e of result.edges) {
      console.log(formatEdge(e));
    }
  }
}

async function handleForget(ctx: CmdContext) {
  const name = ctx.positional[1];
  if (!name) throw new UsageError("Usage: kb forget <name> --ns <namespace>");
  const result = await ops.forget(name, ctx.namespace);
  const msg = result.deleted ? `Deleted "${name}"` : `Not found: ${result.reason}`;
  out(ctx, ctx.json ? result : msg);
}

async function handleForgetEdge(ctx: CmdContext) {
  const edgeId = ctx.positional[1];
  const reason = ctx.positional[2];
  if (!edgeId || !reason) throw new UsageError('Usage: kb forget-edge <edgeId> "<reason>"');
  const result = await ops.forgetEdge(edgeId, reason, ctx.namespace);
  const msg = `Queued edge ${edgeId} for invalidation in "${ctx.namespace}"`;
  out(ctx, ctx.json ? result : msg);
}

async function handleStats(ctx: CmdContext) {
  const result = await ops.stats(ctx.namespace);
  if (ctx.json) {
    out(ctx, result);
    return;
  }
  // getQueueStatus still requires a working provider (it reads the in-memory
  // queue state that lives next to the graph connection). Degrade gracefully
  // so `kb stats` still prints file counts when the graph is unavailable.
  let pending = 0;
  try {
    pending = await ops.getQueueStatus(ctx.namespace);
  } catch {
    // Graph unavailable — queue state is inaccessible too. Omit pending count.
  }
  console.log(`\nKnowledgebase Stats (namespace: ${ctx.namespace}):`);
  console.log(`  Memories: ${result.memories}`);
  // Degraded-mode contract: graph counts are null when server is unavailable.
  console.log(`  Entities: ${result.entities ?? "—"}`);
  console.log(`  Edges:    ${result.edges ?? "—"}`);
  if (pending > 0) console.log(`  Pending:  ${pending}`);
  if (result.degraded) {
    console.error("  (graph unavailable — run the server or check NEO4J_URI / LADYBUG_DATA_PATH)");
  }
}

async function handleMigrate(ctx: CmdContext) {
  const dryRun = ctx.flags["--dry-run"] === "true";
  const { migrate } = await import("./lib/migrate-to-fs.js");
  await migrate(dryRun);
  if (ctx.json) out(ctx, { done: true });
}

function parseSinceFlag(sinceFlag: string): string {
  const match = sinceFlag.match(/^(\d+)([dhm])$/);
  if (!match) throw new UsageError("--since format: <n>d, <n>h, or <n>m (e.g., 7d, 24h, 30m)");
  const [, amount, unit] = match;
  const num = parseInt(amount!, 10);
  if (num > 365 * 24 * 60) throw new UsageError("--since value too large (max ~1 year)");
  const ms = num * ({ d: 86400000, h: 3600000, m: 60000 }[unit!] ?? 0);
  return new Date(Date.now() - ms).toISOString();
}

function buildAnalyticsFilter(sinceFlag?: string, opFilter?: string) {
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];
  if (sinceFlag) {
    conditions.push("ts >= ?");
    params.push(parseSinceFlag(sinceFlag));
  }
  if (opFilter) {
    conditions.push("operation = ?");
    params.push(opFilter);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- display logic with formatting
async function handleAnalytics(ctx: CmdContext) {
  const { getOperationSummary, getSourceBreakdown, getEventTotals } = await import("./lib/analytics.js");
  const sinceFlag = ctx.flags["--since"];
  const opFilter = ctx.flags["--op"];
  const { where, params } = buildAnalyticsFilter(sinceFlag, opFilter);
  const summary = getOperationSummary(where, params);

  if (ctx.json) {
    out(ctx, { summary, sourceBreakdown: getSourceBreakdown(where, params), ...getEventTotals(where, params) });
    return;
  }
  if (summary.length === 0) {
    console.log("No analytics events recorded yet.");
    return;
  }

  const { total: cnt, earliest, latest } = getEventTotals(where, params);
  const startDate = earliest ? String(earliest).slice(0, 10) : "?";
  const endDate = latest ? String(latest).slice(0, 10) : "?";
  console.log(`\nAnalytics Summary (${cnt} events, ${startDate} to ${endDate})`);
  if (sinceFlag) console.log(`  Filtered: last ${sinceFlag}`);
  if (opFilter) console.log(`  Operation: ${opFilter}`);

  console.log(`\n  Operation          Count  Avg ms   Min ms   Max ms   Errors`);
  console.log(`  ${"─".repeat(65)}`);
  for (const row of summary) {
    const op = String(row.operation).padEnd(18);
    const count = String(row.count).padStart(5);
    const avg = row.avg_ms != null ? String(row.avg_ms).padStart(7) : "    n/a";
    const min = row.min_ms != null ? String(row.min_ms).padStart(8) : "     n/a";
    const max = row.max_ms != null ? String(row.max_ms).padStart(8) : "     n/a";
    const errors = String(row.errors).padStart(8);
    console.log(`  ${op} ${count} ${avg} ${min} ${max} ${errors}`);
  }

  const sources = getSourceBreakdown(where, params);
  if (sources.length > 0) {
    console.log(`\n  Sources:`);
    for (const row of sources) console.log(`    ${row.source}: ${row.count}`);
  }
  console.log("");
}

function showHelp() {
  console.log(`
Knowledgebase CLI

Usage: kb <command> [args] [flags]

Commands:
  add <text>                    Save a memory to disk (background indexing)
  search <query>                Hybrid search (file + semantic)
  get <name>                    Look up entity by name
  forget <name>                 Remove entity
  forget-edge <id> <reason>     Invalidate an edge with reason
  stats                         Show statistics
  analytics                     Usage analytics summary
  migrate                       Export memories to ~/.kb/memories/ (filesystem)

Flags:
  --ns, --namespace <name>      Namespace (default: "default")
  --env <name>                  Environment (data isolation, e.g. "test")
  --name <name>                 Name for add command
  --origin <type>               Origin type (manual|retro|mcp|import)
  --tag <tag>                   Tag for add/search (repeatable: --tag bug --tag ui)
  --limit <n>                   Result limit for search (default: 10)
  --json                        Output raw JSON (machine-readable contract)
  --since <period>              Analytics time filter (e.g., 7d, 24h, 30m)
  --op <operation>              Analytics operation filter
  --dry-run                     Preview migrate without writing files
  -i                            Interactive mode

Environment:
  KB_MEMORY_PATH                Memory directory (default: ~/.kb/memories)
  LADYBUG_DATA_PATH             LadybugDB data directory (default: ./.ladybug)
  EXTRACTION_MODEL              Ollama extraction model (default: gemma4:e4b)
  EMBEDDING_MODEL               Embedder choice: "built-in" (default) or "ollama"
  OLLAMA_URL                    Ollama server URL (default: http://localhost:11434)
  NEO4J_URI                     Opt-in Neo4j backend (replaces LadybugDB when set)
  KB_DISABLE_SERVER_INDEXER     Set to "true" to disable the 60s indexer sweep

Output contract:
  Default stdout is human-readable prose for terminal use. For piping or
  scripting, pass --json — every command emits a JSON payload on stdout
  with the same shape as the MCP response (Spec Decision #8). All
  diagnostics and progress messages go to stderr regardless of --json.

Interactive: Run 'kb' or 'kb -i' for a REPL.
`.trim());
}

// --- Main dispatch ---

async function runCommand(ctx: CmdContext) {
  const cmd = ctx.positional[0];
  const dispatch = () => {
    switch (cmd) {
      case "add": return handleAdd(ctx);
      case "search": return handleSearch(ctx);
      case "get": return handleGet(ctx);
      case "forget": return handleForget(ctx);
      case "forget-edge": return handleForgetEdge(ctx);
      case "stats": return handleStats(ctx);
      case "analytics": return handleAnalytics(ctx);
      case "migrate": return handleMigrate(ctx);
      case "help": return showHelp();
      default:
        throw new UsageError(`Unknown command: ${cmd}. Run 'kb help' for usage.`);
    }
  };
  // Analytics and help don't need source tracking
  if (cmd === "help" || cmd === "analytics") return dispatch();
  return analyticsContext.run({ source: "cli" }, dispatch);
}

// --- Interactive REPL ---

async function repl() {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: envName ? `kb[${envName}]> ` : "kb> ",
  });

  console.log("Knowledgebase interactive mode. Type 'help' for commands, 'exit' to quit.");
  rl.prompt();

  rl.on("line", async (line: string) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (input === "exit" || input === "quit") {
      rl.close();
      return;
    }
    if (input === "help") {
      showHelp();
      rl.prompt();
      return;
    }

    // Tokenize respecting quoted strings
    const tokens = input.match(/(?:[^\s"]+|"[^"]*")/g)?.map(t => t.replace(/(?:^"|"$)/g, "")) ?? [];
    const parsed = parseArgs(tokens);
    // Inherit initial --namespace if not overridden in this command
    const ctx = ctxFrom(parsed, initialArgs);

    try {
      await runCommand(ctx);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
    }
    rl.prompt();
  });

  rl.on("close", async () => {
    await ops.close();
    process.exit(0);
  });
}

// --- Entry point ---

const ctx = ctxFrom(initialArgs);

try {
  if (!ctx.positional[0] || initialArgs.flags["-i"] === "true") {
    await repl();
  } else {
    await runCommand(ctx);
    process.exit(0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
