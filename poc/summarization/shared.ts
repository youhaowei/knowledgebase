import { existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";

export interface InputFile {
  path: string;
  filename: string;
  content: string;
  lines: number;
}

const RESULTS_DIR = join(import.meta.dir, "results");
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.5";

export async function getInputFiles(defaultDir = "src/lib"): Promise<InputFile[]> {
  const dir = resolve(process.argv[2] || defaultDir);
  const glob = new Bun.Glob("*.ts");
  const files: InputFile[] = [];

  for await (const filename of glob.scan({ cwd: dir })) {
    if (filename.endsWith(".d.ts")) continue;
    const path = join(dir, filename);
    const content = await Bun.file(path).text();
    files.push({ path, filename, content, lines: content.split("\n").length });
  }

  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

export function writeResult(name: string, markdown: string) {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const path = join(RESULTS_DIR, `${name}.md`);
  Bun.write(path, markdown);
  console.error(`Wrote ${path}`);
}

export async function summarizeWithLLM(
  systemPrompt: string,
  userContent: string,
): Promise<{ text: string; elapsedMs: number }> {
  const start = performance.now();

  const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: `${systemPrompt}\n\n${userContent}`,
      stream: false,
      think: false,
      options: { temperature: 0.3, num_predict: 2048 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error: ${resp.status} ${await resp.text()}`);
  }

  const data = (await resp.json()) as { response: string };
  const elapsedMs = Math.round(performance.now() - start);
  return { text: data.response.trim(), elapsedMs };
}
