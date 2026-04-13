#!/usr/bin/env bun
/**
 * Haiku smoke test — diagnostic one-shot. Verifies unifai can reach the
 * Claude API and round-trip a response. Diagnostic output goes to stderr so
 * stdout stays clean for piping (matches the main CLI's output contract).
 */
import { prompt } from "unifai";

try {
  console.error("Calling Haiku via unifai...");
  const result = await prompt("claude", "What is 2 + 2? Reply with just the number.", {
    model: "haiku",
    maxTurns: 1,
    allowedTools: [],
    env: { ...process.env, CLAUDECODE: undefined },
  });
  console.error("text:", result.text);
  console.error("usage:", result.usage);
  process.stdout.write(JSON.stringify({ text: result.text, usage: result.usage }) + "\n");
} catch (err) {
  console.error("FAILED:", err);
  if (err instanceof Error) {
    console.error("stack:", err.stack);
  }
  process.exit(1);
}
