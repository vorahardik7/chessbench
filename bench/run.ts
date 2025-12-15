import path from "path";
import type {
  BenchModel,
  BenchPuzzle,
  LatestSnapshot,
  LatestSnapshotModel,
  LatestSnapshotPuzzle,
  MateLevel,
  ModelPuzzleResult,
} from "./types";
import { asyncPool, readJsonFile, writeJsonFile } from "./utils";

function requiredPlies(level: MateLevel): number {
  if (level === "mate1") return 1;
  if (level === "mate2") return 3;
  return 5;
}

function normalizeUciLine(line: string): string {
  return line
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .join(" ");
}

function extractUciTokens(text: string): string[] {
  // Find UCI tokens anywhere in the response (models can be chatty).
  const re = /\b[a-h][1-8][a-h][1-8][qrbn]?\b/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]!.toLowerCase());
  return out;
}

function scoreMove(expectedLine: string, gotLine: string): boolean {
  return normalizeUciLine(expectedLine).toLowerCase() === normalizeUciLine(gotLine).toLowerCase();
}

function buildPrompt(puzzle: BenchPuzzle): { system: string; user: string } {
  const n = puzzle.level === "mate1" ? 1 : puzzle.level === "mate2" ? 2 : 3;
  const plies = requiredPlies(puzzle.level);

  const system =
    "You are a chess engine assistant. Follow the format rules strictly. " +
    "Output must contain only UCI moves. No explanation. No punctuation.";

  const user =
    `Task: Solve mate in ${n}.\n` +
    `Return exactly ${plies} ply of UCI moves separated by single spaces.\n` +
    `FEN: ${puzzle.fen}\n` +
    `Output format example: e2e4 (mate in 1) or e2e4 e7e5 g1f3 (mate in 2)\n` +
    `Now output only the UCI line:`;

  return { system, user };
}

async function callOpenRouter(model: BenchModel, prompt: { system: string; user: string }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY env var.");

  const referer = process.env.CHESSBENCH_HTTP_REFERER ?? "http://localhost:3000";
  const title = process.env.CHESSBENCH_X_TITLE ?? "ChessBench";

  const body = {
    model: model.id,
    temperature: model.temperature ?? 0,
    max_tokens: model.maxTokens ?? 128,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  };

  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
      "X-Title": title,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenRouter error for ${model.id}: ${res.status} ${res.statusText} ${txt}`);
  }

  const json = (await res.json()) as any;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`OpenRouter response missing message content for ${model.id}`);
  }
  const usage = json?.usage ?? null;
  const promptTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const completionTokens =
    typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const totalTokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined;

  return { content, latencyMs, promptTokens, completionTokens, totalTokens };
}

async function evalOne(model: BenchModel, puzzle: BenchPuzzle): Promise<ModelPuzzleResult> {
  const prompt = buildPrompt(puzzle);
  const { content, latencyMs, promptTokens, completionTokens, totalTokens } = await callOpenRouter(
    model,
    prompt,
  );

  const need = requiredPlies(puzzle.level);
  const toks = extractUciTokens(content);
  const parsed = toks.slice(0, need).join(" ");
  const isCorrect = parsed.length > 0 && scoreMove(puzzle.solutionUci, parsed);

  return {
    move: parsed || "",
    isCorrect,
    rawOutput: content,
    latencyMs,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function computeBreakdown(puzzles: LatestSnapshotPuzzle[], modelKey: string) {
  const byLevel: Record<MateLevel, { correct: number; total: number; latencies: number[] }> = {
    mate1: { correct: 0, total: 0, latencies: [] },
    mate2: { correct: 0, total: 0, latencies: [] },
    mate3: { correct: 0, total: 0, latencies: [] },
  };

  for (const p of puzzles) {
    const r = p.results[modelKey];
    if (!r) continue;
    byLevel[p.level].total += 1;
    if (r.isCorrect) byLevel[p.level].correct += 1;
    if (typeof r.latencyMs === "number") byLevel[p.level].latencies.push(r.latencyMs);
  }

  const pct = (c: number, t: number) => (t === 0 ? 0 : Math.round((c / t) * 1000) / 10);
  const avg = (xs: number[]) =>
    xs.length === 0 ? undefined : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

  return {
    breakdown: {
      mate1: pct(byLevel.mate1.correct, byLevel.mate1.total),
      mate2: pct(byLevel.mate2.correct, byLevel.mate2.total),
      mate3: pct(byLevel.mate3.correct, byLevel.mate3.total),
    },
    avgLatencyMs: avg([
      ...byLevel.mate1.latencies,
      ...byLevel.mate2.latencies,
      ...byLevel.mate3.latencies,
    ]),
  };
}

async function main() {
  const root = process.cwd();
  const modelsPath = path.join(root, "bench/models.json");
  const puzzlesPaths = [
    path.join(root, "bench/puzzles.mate1.json"),
    path.join(root, "bench/puzzles.mate2.json"),
    path.join(root, "bench/puzzles.mate3.json"),
  ];

  const models = await readJsonFile<BenchModel[]>(modelsPath);
  const puzzles = (await Promise.all(puzzlesPaths.map((p) => readJsonFile<BenchPuzzle[]>(p)))).flat();

  const snapshotPuzzles: LatestSnapshotPuzzle[] = puzzles.map((p) => ({
    ...p,
    results: {},
  }));

  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? "3");

  for (const model of models) {
    console.log(`Running model: ${model.name} (${model.id})`);

    const results = await asyncPool(concurrency, snapshotPuzzles, async (p) => evalOne(model, p));
    snapshotPuzzles.forEach((p, idx) => {
      p.results[model.id] = results[idx]!;
    });
  }

  const snapshotModels: LatestSnapshotModel[] = models.map((m) => {
    const { breakdown, avgLatencyMs } = computeBreakdown(snapshotPuzzles, m.id);
    const score = Math.round(((breakdown.mate1 + breakdown.mate2 + breakdown.mate3) / 3) * 10) / 10;
    return {
      id: m.id,
      name: m.name,
      score,
      breakdown,
      avgLatencyMs,
    };
  });

  const snapshot: LatestSnapshot = {
    runId: `bench-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    runAt: new Date().toISOString(),
    promptVersion: "v1.0",
    models: snapshotModels.sort((a, b) => b.score - a.score),
    puzzles: snapshotPuzzles,
  };

  const outPath = path.join(root, "public/results/latest.json");
  await writeJsonFile(outPath, snapshot);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


