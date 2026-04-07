#!/usr/bin/env bun
/**
 * Knowledgebase CLI
 *
 * Usage: bun run kb <command> [args] [--flags]
 * Commands: add, search, get, forget, forget-edge, stats
 * Interactive: bun run kb (no args or -i)
 */

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
    if (arg === "--env" || arg === "--namespace" || arg === "--ns" || arg === "--name" || arg === "--limit" || arg === "--since" || arg === "--op" || arg === "--origin") {
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

// Set env BEFORE importing modules that create Graph singletons
if (envName) {
  process.env.LADYBUG_DATA_PATH = `./.ladybug-${envName}`;
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
  const result = await ops.addMemory(text, name, ctx.namespace, origin);
  const msg = result.status === "existing"
    ? `Memory already exists: ${result.id}`
    : `Written ${result.path}`;
  out(ctx, ctx.json ? result : msg);
}

async function handleSearch(ctx: CmdContext) {
  const query = ctx.positional[1];
  if (!query) throw new UsageError("Usage: kb search <query> [--limit <n>] [--ns <namespace>]");
  const parsed = parseInt(ctx.flags["--limit"] ?? "", 10);
  const limit = Number.isNaN(parsed) ? 10 : parsed;
  const result = await hybridSearch(query, ctx.namespace, limit);

  if (ctx.json) {
    out(ctx, result);
    return;
  }

  // Show file results first (fast, always available)
  if (result.files.length > 0) {
    console.log(`\nFiles (${result.files.length}):`);
    for (const f of result.files) {
      const status = f.indexed ? "" : " [unindexed]";
      const tags = f.tags.length ? ` [${f.tags.join(", ")}]` : "";
      console.log(`  ${f.name}${status}${tags}`);
      if (f.matchContext) console.log(`    ...${f.matchContext.slice(0, 80)}...`);
    }
  }

  if (result.memories.length > 0) {
    console.log(`\nMemories (${result.memories.length}):`);
    for (const m of result.memories) {
      console.log(`  [${m.id}] ${m.name || "(unnamed)"} — ${m.summary || m.text.slice(0, 80)}`);
    }
  }

  if (result.edges.length > 0) {
    console.log(`\nEdges (${result.edges.length}):`);
    for (const e of result.edges) {
      console.log(formatEdge(e));
    }
  }

  if (result.entities.length > 0) {
    console.log(`\nEntities (${result.entities.length}):`);
    for (const e of result.entities) {
      console.log(formatEntity(e));
    }
  }

  if (result.files.length === 0 && result.memories.length === 0 && result.edges.length === 0 && result.entities.length === 0) {
    console.log("No results found.");
  }
}

async function handleGet(ctx: CmdContext) {
  const name = ctx.positional[1];
  if (!name) throw new UsageError("Usage: kb get <name> [--ns <namespace>]");
  const result = await ops.getByName(name, ctx.namespace);

  if (ctx.json) {
    out(ctx, result);
    return;
  }

  if (!result.entity) {
    console.log(`Entity "${name}" not found.`);
    return;
  }

  console.log(`\n${formatEntity(result.entity)}`);
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
  const msg = result.invalidatedEdge ? `Invalidated edge ${edgeId}` : `Edge not found: ${edgeId}`;
  out(ctx, ctx.json ? result : msg);
}

async function handleStats(ctx: CmdContext) {
  const result = await ops.stats(ctx.namespace);
  if (ctx.json) {
    out(ctx, result);
    return;
  }
  const pending = await ops.getQueueStatus(ctx.namespace);
  console.log(`\nKnowledgebase Stats (namespace: ${ctx.namespace}):`);
  console.log(`  Memories: ${result.memories}`);
  console.log(`  Entities: ${result.entities}`);
  console.log(`  Edges:    ${result.edges}`);
  if (pending > 0) console.log(`  Pending:  ${pending}`);
}

async function handleMigrate(ctx: CmdContext) {
  const dryRun = ctx.flags["--dry-run"] === "true";
  const { migrate } = await import("./lib/migrate-to-fs.js");
  await migrate(dryRun);
  if (ctx.json) out(ctx, { done: true });
}

async function handleAnalytics(ctx: CmdContext) {
  const { getOperationSummary, getSourceBreakdown, getEventTotals } = await import("./lib/analytics.js");
  const sinceFlag = ctx.flags["--since"];
  const opFilter = ctx.flags["--op"];

  // Parse --since into a date filter (e.g., "7d", "24h", "30d")
  let sinceDate: string | null = null;
  if (sinceFlag) {
    const match = sinceFlag.match(/^(\d+)([dhm])$/);
    if (!match) throw new UsageError("--since format: <n>d, <n>h, or <n>m (e.g., 7d, 24h, 30m)");
    const [, amount, unit] = match;
    const num = parseInt(amount!, 10);
    if (num > 365 * 24 * 60) throw new UsageError("--since value too large (max ~1 year)");
    const ms = num * ({ d: 86400000, h: 3600000, m: 60000 }[unit!] ?? 0);
    sinceDate = new Date(Date.now() - ms).toISOString();
  }

  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (sinceDate) {
    conditions.push("ts >= ?");
    params.push(sinceDate);
  }
  if (opFilter) {
    conditions.push("operation = ?");
    params.push(opFilter);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const summary = getOperationSummary(where, params);

  if (ctx.json) {
    const sourceBreakdown = getSourceBreakdown(where, params);
    const totals = getEventTotals(where, params);
    out(ctx, { summary, sourceBreakdown, ...totals });
    return;
  }

  if (summary.length === 0) {
    console.log("No analytics events recorded yet.");
    return;
  }

  // Header
  const { total: cnt, earliest, latest } = getEventTotals(where, params);
  console.log(`\nAnalytics Summary (${cnt} events, ${earliest ? String(earliest).slice(0, 10) : "?"} to ${latest ? String(latest).slice(0, 10) : "?"})`);
  if (sinceFlag) console.log(`  Filtered: last ${sinceFlag}`);
  if (opFilter) console.log(`  Operation: ${opFilter}`);

  // Operation breakdown
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

  // Source breakdown
  const sources = getSourceBreakdown(where, params);
  if (sources.length > 0) {
    console.log(`\n  Sources:`);
    for (const row of sources) {
      console.log(`    ${row.source}: ${row.count}`);
    }
  }

  console.log("");
}

function showHelp() {
  console.log(`
Knowledgebase CLI

Usage: kb <command> [args] [flags]

Commands:
  add <text>                    Add a memory (extracts entities + edges)
  search <query>                Semantic search
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
  --limit <n>                   Result limit for search (default: 10)
  --json                        Output raw JSON
  --since <period>              Analytics time filter (e.g., 7d, 24h, 30m)
  --op <operation>              Analytics operation filter
  --dry-run                     Preview migrate without writing files
  -i                            Interactive mode

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
