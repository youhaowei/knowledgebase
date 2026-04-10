#!/usr/bin/env bun
import { prompt } from "unifai";

try {
  console.log("Calling Haiku via unifai...");
  const result = await prompt("claude", "What is 2 + 2? Reply with just the number.", {
    model: "haiku",
    maxTurns: 1,
    allowedTools: [],
    env: { ...process.env, CLAUDECODE: undefined },
  });
  console.log("text:", result.text);
  console.log("usage:", result.usage);
} catch (err) {
  console.error("FAILED:", err);
  if (err instanceof Error) {
    console.error("stack:", err.stack);
  }
}
