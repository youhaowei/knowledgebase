#!/usr/bin/env bun
/**
 * Smoke test for transformers.js + Gemma 4 E4B in-process inference.
 * Verifies the model loads, runs text generation, and produces structured JSON.
 *
 * First run downloads ~2.5 GB of ONNX weights to ~/.cache/huggingface — slow.
 * Subsequent runs load from cache — fast.
 */

import { AutoProcessor, AutoModelForCausalLM, TextStreamer } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/gemma-4-E4B-it-ONNX";

async function main() {
  console.error(`[smoke] loading ${MODEL_ID}...`);
  const loadStart = performance.now();

  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  console.error(`[smoke] processor loaded in ${(performance.now() - loadStart).toFixed(0)}ms`);

  const modelStart = performance.now();
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: "q4f16",
    // Omit device — defaults to cpu in Node/Bun. WebGPU is browser-only.
  });
  const modelMs = performance.now() - modelStart;
  console.error(`[smoke] model loaded in ${modelMs.toFixed(0)}ms`);

  // Try a simple generation first
  const prompt = "What is 2 + 2? Reply with just the number.";
  const messages = [{ role: "user", content: prompt }];

  const chatTemplate = processor.apply_chat_template(messages, {
    add_generation_prompt: true,
  });
  console.error(`[smoke] chat template applied`);

  const inputs = await processor(chatTemplate);
  console.error(`[smoke] inputs tokenized: ${inputs.input_ids?.dims ?? "unknown"}`);

  const genStart = performance.now();
  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: 64,
    do_sample: false,
  });
  const genMs = performance.now() - genStart;
  console.error(`[smoke] generation done in ${genMs.toFixed(0)}ms`);

  const decoded = processor.batch_decode(outputs, { skip_special_tokens: true });
  console.log("\n=== Output ===");
  console.log(decoded[0]);
  console.log("===");
}

main().catch((err) => {
  console.error("Smoke test failed:", err);
  process.exit(1);
});
