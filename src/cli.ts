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
    if (arg === "--env" || arg === "--namespace" || arg === "--ns" || arg === "--name" || arg === "--limit") {
      const key = arg === "--ns" ? "--namespace" : arg;
      flags[key] = argv[++i] ?? "";
    } else if (arg === "--json" || arg === "-i") {
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
  const result = await ops.addMemory(text, name, ctx.namespace);
  const msg = result.existing
    ? `Memory already exists: ${result.id}`
    : `Queued memory ${result.id}`;
  out(ctx, ctx.json ? result : msg);
}

async function handleSearch(ctx: CmdContext) {
  const query = ctx.positional[1];
  if (!query) throw new UsageError("Usage: kb search <query> [--limit <n>] [--ns <namespace>]");
  const parsed = parseInt(ctx.flags["--limit"] ?? "", 10);
  const limit = Number.isNaN(parsed) ? 10 : parsed;
  const result = await ops.search(query, ctx.namespace, limit);

  if (ctx.json) {
    out(ctx, result);
    return;
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

  if (result.memories.length === 0 && result.edges.length === 0 && result.entities.length === 0) {
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

Flags:
  --ns, --namespace <name>      Namespace (default: "default")
  --env <name>                  Environment (data isolation, e.g. "test")
  --name <name>                 Name for add command
  --limit <n>                   Result limit for search (default: 10)
  --json                        Output raw JSON
  -i                            Interactive mode

Interactive: Run 'kb' or 'kb -i' for a REPL.
`.trim());
}

// --- Main dispatch ---

async function runCommand(ctx: CmdContext) {
  const cmd = ctx.positional[0];
  switch (cmd) {
    case "add": return handleAdd(ctx);
    case "search": return handleSearch(ctx);
    case "get": return handleGet(ctx);
    case "forget": return handleForget(ctx);
    case "forget-edge": return handleForgetEdge(ctx);
    case "stats": return handleStats(ctx);
    case "help": return showHelp();
    default:
      throw new UsageError(`Unknown command: ${cmd}. Run 'kb help' for usage.`);
  }
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
