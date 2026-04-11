#!/usr/bin/env bun
/**
 * Test the real extraction prompt against Gemma 4 E4B in-process.
 * Uses one real retro finding, attempts to parse the JSON output,
 * and reports timing + edge count.
 */

import { AutoProcessor, AutoModelForCausalLM, type Tensor } from "@huggingface/transformers";
import { extractionPrompt, parseJsonFromText } from "../src/lib/extractor.ts";

const MODEL_ID = "onnx-community/gemma-4-E4B-it-ONNX";

// One real retro finding to test on
const TEST_TEXT = `[workflow-friction/major] Eager execution: acting before confirming user intent

Multiple sessions show Claude starting implementation when the user only wanted planning, discussion, or Notion task creation. Examples: 154513dd (started spike when user wanted Notion tasks), 6d1da3ef (started implementing migration when user wanted it saved as task), c81da441 (plan diverged from user's approach). CLAUDE.md already says 'Ask first' but the pattern persists specifically around concrete-sounding requests.`;

function logParsedEdges(parsed: { entities?: unknown[]; edges?: unknown[] }): void {
  console.log(`[test] parsed: ${parsed.entities?.length ?? 0} entities, ${parsed.edges?.length ?? 0} edges`);
  if (!parsed.edges || !Array.isArray(parsed.edges)) return;

  for (const edge of parsed.edges as Array<{ fact?: string }>) {
    console.log(`  - ${edge.fact}`);
  }
}

async function main() {
  console.error(`[test] loading ${MODEL_ID}...`);
  const t0 = performance.now();
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, { dtype: "q4f16" });
  console.error(`[test] loaded in ${(performance.now() - t0).toFixed(0)}ms\n`);

  // Build the extraction prompt
  const prompt = extractionPrompt(TEST_TEXT) +
    "\n\nRespond with ONLY valid JSON matching the schema. No markdown fencing, no explanation.";

  const messages = [{ role: "user", content: prompt }];
  const chatTemplate = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(chatTemplate);
  const inputLen = (inputs.input_ids as Tensor).dims.at(-1) as number;
  console.error(`[test] input tokens: ${inputLen}`);

  console.error(`[test] generating (this may take a minute)...`);
  const genStart = performance.now();
  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: 2048,
    do_sample: false,
  }) as Tensor;
  const genMs = performance.now() - genStart;
  const totalLen = outputs.dims.at(-1) as number;
  const newTokens = totalLen - inputLen;
  console.error(`[test] generated ${newTokens} tokens in ${genMs.toFixed(0)}ms (${(newTokens / (genMs / 1000)).toFixed(1)} tok/s)\n`);

  // Decode just the new tokens
  const newTokenSlice = outputs.slice(null, [inputLen, null]);
  const decoded = processor.batch_decode(newTokenSlice, { skip_special_tokens: true });
  const responseText = decoded[0] as string;

  console.log("=== Raw model output ===");
  console.log(responseText);
  console.log("=== End ===\n");

  const parsed = parseJsonFromText(responseText) as { entities?: unknown[]; edges?: unknown[] } | null;

  if (!parsed) {
    console.error("[test] FAILED to parse JSON");
    process.exit(1);
  }

  logParsedEdges(parsed);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
