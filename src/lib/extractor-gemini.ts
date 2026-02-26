/**
 * Gemini Extractor - extracts structured knowledge from text
 *
 * Uses Gemini CLI in headless mode (no API costs with personal Google account)
 * Edge-as-Fact Model: extracts entities first, then edges (facts) as relationships
 */

import { Extraction } from "../types.js";
import { extractionPrompt } from "./extractor.js";

interface GeminiJsonOutput {
  session_id: string;
  response: string;
  stats: unknown;
}

/**
 * Parse the CLI JSON output to extract the GeminiJsonOutput structure
 */
function parseGeminiCliOutput(output: string): GeminiJsonOutput {
  let jsonStartIndex = output.indexOf('{"session_id"');

  if (jsonStartIndex === -1) {
    const altStart = output.indexOf('"session_id"');
    if (altStart === -1) {
      throw new Error("No session_id found in output");
    }
    jsonStartIndex = output.lastIndexOf("{", altStart);
    if (jsonStartIndex === -1) {
      throw new Error("No JSON object found in output");
    }
  }

  return JSON.parse(output.slice(jsonStartIndex));
}

/**
 * Remove markdown code block wrapper if present
 */
function stripMarkdownCodeBlock(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;

  const firstNewline = trimmed.indexOf("\n");
  const lastBackticks = trimmed.lastIndexOf("```");

  if (firstNewline !== -1 && lastBackticks > firstNewline) {
    return trimmed.slice(firstNewline + 1, lastBackticks).trim();
  }

  return trimmed;
}

/**
 * Extract JSON object from string by matching balanced braces
 */
function extractJsonObject(text: string): string {
  const startBrace = text.indexOf("{");
  if (startBrace === -1) {
    throw new Error("No JSON object found");
  }

  let depth = 0;
  for (let i = startBrace; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startBrace, i + 1);
      }
    }
  }

  throw new Error("Unmatched braces in JSON");
}

export async function extractWithGemini(text: string): Promise<Extraction> {
  // Use the shared extraction prompt
  const fullPrompt = `${extractionPrompt(text)}\n\nReturn ONLY valid JSON (no markdown, no explanation).`;

  // Use Bun's spawn to call gemini CLI in sandbox mode (no file/shell access)
  const proc = Bun.spawn(["gemini", "-o", "json", "--sandbox", fullPrompt], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error("Gemini CLI stderr:", stderr);
    throw new Error(`Gemini CLI failed with exit code ${exitCode}`);
  }

  // Parse the CLI output
  let geminiOutput: GeminiJsonOutput;
  try {
    geminiOutput = parseGeminiCliOutput(output);
  } catch (e) {
    console.error("Failed to parse Gemini CLI output:", output);
    throw new Error(`Failed to parse Gemini JSON output: ${e}`);
  }

  // Extract the extraction JSON from the model's response
  const responseText = geminiOutput.response;
  const jsonStr = stripMarkdownCodeBlock(responseText);

  let jsonContent: string;
  try {
    jsonContent = extractJsonObject(jsonStr);
  } catch (e) {
    console.error("No valid JSON object in response:", responseText);
    throw new Error(`No valid JSON in Gemini response: ${e}`);
  }

  // Parse and validate the extraction result
  try {
    const parsed = JSON.parse(jsonContent);
    console.error("Gemini extraction result:", JSON.stringify(parsed, null, 2));
    return Extraction.parse(parsed);
  } catch (e) {
    console.error("Failed to parse extraction JSON:", jsonContent);
    throw new Error(`Failed to parse extraction result: ${e}`);
  }
}
