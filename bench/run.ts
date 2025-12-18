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
import { asyncPool, loadDotEnv, readJsonFile, writeJsonFile } from "./utils";
import { Chess } from "chess.js";

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenRouterContentPart = {
  text?: string;
  type?: string;
};

type OpenRouterChoice = {
  message?: {
    content?: string | Array<string | OpenRouterContentPart>;
    reasoning?: string;
    reasoning_details?: Array<{ text?: string }>;
  };
  text?: string;
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
};

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
  // Be permissive about common formatting mistakes:
  // - "a2-a4" / "a2:a4" -> a2a4
  // - "a7a8=Q" -> a7a8q
  const re = /\b([a-h][1-8])\s*[-:]?\s*([a-h][1-8])\s*(?:=?\s*([qrbn]))?\b/gi;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const from = m[1]!.toLowerCase();
    const to = m[2]!.toLowerCase();
    const promo = (m[3] ?? "").toLowerCase();
    const tok = `${from}${to}${promo}`;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

function extractSanCandidates(text: string): string[] {
  // Heuristic SAN token extraction from chatty model output.
  // Examples: "Qf8#", "Rxf7+", "O-O", "O-O-O", "e8=Q+", "gxh8=Q"
  const re =
    /\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[a-h]x[a-h][1-8](?:=[QRBN])?[+#]?)\b/g;
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[1]!;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

function tryParseSanToUciLine(fen: string, need: number, text: string): string {
  const sanToks = extractSanCandidates(text);
  if (sanToks.length === 0) return "";

  const chess = new Chess(fen);
  const uci: string[] = [];

  for (const san of sanToks) {
    if (uci.length >= need) break;
    try {
      const mv = chess.move(san, { strict: false });
      const promo = typeof mv.promotion === "string" ? mv.promotion.toLowerCase() : "";
      uci.push(`${mv.from}${mv.to}${promo}`);
    } catch {
      // ignore tokens that aren't legal in the current position
    }
  }

  return uci.length > 0 ? uci.slice(0, need).join(" ") : "";
}

function scoreMove(expectedLine: string, gotLine: string): boolean {
  return normalizeUciLine(expectedLine).toLowerCase() === normalizeUciLine(gotLine).toLowerCase();
}

function buildPrompt(puzzle: BenchPuzzle): { system: string; user: string } {
  const n = puzzle.level === "mate1" ? 1 : puzzle.level === "mate2" ? 2 : 3;
  const plies = requiredPlies(puzzle.level);

  const system =
    "You are a chess engine assistant. Follow the format rules strictly. " +
    "Output must contain only UCI moves. No explanation. No punctuation. " +
    "If a promotion occurs, write it as a single trailing letter (e.g. a7a8q), not a7a8=Q.";

  const lastMoveLine = puzzle.lastMoveUci ? `Opponent last move (context): ${puzzle.lastMoveUci}\n` : "";

  const user =
    `Task: Solve mate in ${n}.\n` +
    `Return exactly ${plies} ply of UCI moves separated by single spaces.\n` +
    `FEN: ${puzzle.fen}\n` +
    lastMoveLine +
    `Output format example: e2e4 (mate in 1) or e2e4 e7e5 g1f3 (mate in 2)\n` +
    `Now output only the UCI line:`;

  return { system, user };
}

function isUciMove(tok: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(tok.trim());
}

function validateUciLineLegal(
  fen: string,
  uciLine: string,
  needPlies: number,
): { isLegal: boolean; appliedPlies: number } {
  const line = normalizeUciLine(uciLine);
  if (!line) return { isLegal: false, appliedPlies: 0 };

  const moves = line.split(" ").filter(Boolean).slice(0, needPlies);
  if (moves.length !== needPlies) return { isLegal: false, appliedPlies: 0 };
  if (!moves.every(isUciMove)) return { isLegal: false, appliedPlies: 0 };

  const chess = new Chess(fen);
  let applied = 0;
  for (const uci of moves) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      const mv = chess.move({ from, to, promotion });
      if (!mv) return { isLegal: false, appliedPlies: applied };
      applied++;
    } catch {
      return { isLegal: false, appliedPlies: applied };
    }
  }
  return { isLegal: true, appliedPlies: applied };
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractOpenRouterText(json: OpenRouterResponse): string {
  const choice = json.choices?.[0];

  // OpenAI-style chat completions
  const msg = choice?.message;
  const content = msg?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;

  // Some providers return structured content parts: [{ type: "text", text: "..." }, ...]
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object" && typeof p.text === "string") return p.text;
        return "";
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join("");
  }

  // Some models return their output in `message.reasoning` / `reasoning_details` and leave `content` empty.
  // We still want to parse UCI tokens from it (and show it in the UI for debugging).
  const reasoning = msg?.reasoning;
  if (typeof reasoning === "string" && reasoning.trim().length > 0) return reasoning;
  const reasoningDetails = msg?.reasoning_details;
  if (Array.isArray(reasoningDetails)) {
    const parts = reasoningDetails
      .map((p) => (p && typeof p.text === "string" ? p.text : ""))
      .filter(Boolean);
    if (parts.length > 0) return parts.join("\n");
  }

  // Some providers return "text" at the choice level (completion-style)
  if (typeof choice?.text === "string" && choice.text.trim().length > 0) return choice.text;

  // Fallback: preserve something useful for debugging instead of an empty string.
  // Important: some providers return an empty string for `message.content` but include
  // other metadata. Keeping the choice payload visible helps debug.
  return safeJsonStringify(choice ?? json ?? "");
}

async function callOpenRouter(
  model: BenchModel,
  prompt: { system: string; user: string },
  opts?: { maxTokensOverride?: number },
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENROUTER_API_KEY. Add it to .env (OPENROUTER_API_KEY=...) or export it in your shell.",
    );
  }

  const referer = process.env.CHESSBENCH_HTTP_REFERER ?? "http://localhost:3000";
  const title = process.env.CHESSBENCH_X_TITLE ?? "ChessBench";

  const body = {
    model: model.id,
    temperature: model.temperature ?? 0,
    max_tokens: opts?.maxTokensOverride ?? model.maxTokens ?? 128,
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

  const json = (await res.json()) as OpenRouterResponse;
  const content = extractOpenRouterText(json);
  const usage = json.usage;
  const promptTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const completionTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
  const totalTokens = typeof usage?.total_tokens === "number" ? usage.total_tokens : undefined;

  return { content, latencyMs, promptTokens, completionTokens, totalTokens };
}

async function evalOne(model: BenchModel, puzzle: BenchPuzzle): Promise<ModelPuzzleResult> {
  const prompt = buildPrompt(puzzle);
  const firstTry = await callOpenRouter(model, prompt);
  let { content, latencyMs, promptTokens, completionTokens, totalTokens } = firstTry;

  const need = requiredPlies(puzzle.level);
  let parseMethod: "uci" | "san" | "none" = "none";
  const toks = extractUciTokens(content);
  let parsed = toks.slice(0, need).join(" ");
  if (parsed.length > 0) parseMethod = "uci";
  if (parsed.length === 0) {
    // Fallback: many models output SAN even when instructed to output UCI.
    parsed = tryParseSanToUciLine(puzzle.fen, need, content);
    if (parsed.length > 0) parseMethod = "san";
  }

  // If we got nothing and we likely hit the token limit, retry once with a higher cap.
  // This is particularly important for models that spend early tokens on "reasoning" and only emit moves later.
  const configuredMax = model.maxTokens ?? 128;
  const hitLimit = typeof completionTokens === "number" && completionTokens >= configuredMax;
  if (parsed.length === 0 && hitLimit) {
    const retryMax = Math.min(Math.max(configuredMax * 4, 256), 1024);
    const retry = await callOpenRouter(model, prompt, { maxTokensOverride: retryMax });
    content = retry.content;
    latencyMs = retry.latencyMs;
    promptTokens = retry.promptTokens;
    completionTokens = retry.completionTokens;
    totalTokens = retry.totalTokens;

    const toks2 = extractUciTokens(content);
    parsed = toks2.slice(0, need).join(" ");
    if (parsed.length > 0) {
      parseMethod = "uci";
    } else {
      parsed = tryParseSanToUciLine(puzzle.fen, need, content);
      if (parsed.length > 0) parseMethod = "san";
    }
  }

  const legality =
    parsed.length > 0
      ? validateUciLineLegal(puzzle.fen, parsed, need)
      : { isLegal: false, appliedPlies: 0 };
  const isCorrect = parsed.length > 0 && legality.isLegal && scoreMove(puzzle.solutionUci, parsed);

  return {
    move: parsed || "",
    isCorrect,
    isLegal: parsed.length > 0 ? legality.isLegal : undefined,
    parseMethod,
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
  await loadDotEnv();
  const root = process.cwd();
  const modelsPath = path.join(root, "bench/models.json");
  const outPath = path.join(root, "public/results/latest.json");
  // Only test mate1 for now
  const puzzlesPaths = [
    path.join(root, "bench/puzzles.mate1.json"),
    // path.join(root, "bench/puzzles.mate2.json"),
    // path.join(root, "bench/puzzles.mate3.json"),
  ];

  const models = await readJsonFile<BenchModel[]>(modelsPath);
  const puzzles = (await Promise.all(puzzlesPaths.map((p) => readJsonFile<BenchPuzzle[]>(p)))).flat();

  // Load existing snapshot if it exists
  let existingSnapshot: LatestSnapshot | null = null;
  try {
    existingSnapshot = await readJsonFile<LatestSnapshot>(outPath);
    console.log(`Loaded existing snapshot with ${existingSnapshot.puzzles.length} puzzles and ${existingSnapshot.models.length} models`);
  } catch {
    console.log("No existing snapshot found, starting fresh");
  }

  // Create puzzle map from existing snapshot (by puzzle ID)
  const existingPuzzleMap = new Map<string, LatestSnapshotPuzzle>();
  if (existingSnapshot) {
    for (const p of existingSnapshot.puzzles) {
      existingPuzzleMap.set(p.id, p);
    }
  }

  // Initialize puzzles with existing results preserved
  const snapshotPuzzles: LatestSnapshotPuzzle[] = puzzles.map((p) => {
    const existing = existingPuzzleMap.get(p.id);
    return {
      ...p,
      results: existing?.results ? { ...existing.results } : {},
    };
  });

  // Determine which models need to be tested
  const modelsToTest = models.filter((m) => {
    // Test if model doesn't have results for all puzzles, or if we want to force update
    const hasAllResults = snapshotPuzzles.every((p) => p.results[m.id] !== undefined);
    return !hasAllResults;
  });

  if (modelsToTest.length === 0) {
    console.log("All models in models.json already have results. No benchmarks to run.");
  } else {
    console.log(`Testing ${modelsToTest.length} model(s): ${modelsToTest.map((m) => m.name).join(", ")}`);
  }

  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? "3");

  // Run benchmarks only for models that need testing
  for (const model of modelsToTest) {
    console.log(`Running model: ${model.name} (${model.id})`);

    const results = await asyncPool(concurrency, snapshotPuzzles, async (p) => evalOne(model, p));
    snapshotPuzzles.forEach((p, idx) => {
      p.results[model.id] = results[idx]!;
    });
  }

  // Collect all model IDs (both new and existing)
  const allModelIds = new Set<string>();
  models.forEach((m) => allModelIds.add(m.id));
  if (existingSnapshot) {
    existingSnapshot.models.forEach((m) => allModelIds.add(m.id));
  }

  // Compute stats for all models (both tested and cached)
  const snapshotModels: LatestSnapshotModel[] = Array.from(allModelIds).map((modelId) => {
    // Find model definition (prefer current models.json, fallback to existing snapshot)
    const currentModel = models.find((m) => m.id === modelId);
    const existingModel = existingSnapshot?.models.find((m) => m.id === modelId);
    const model = currentModel || existingModel;
    
    if (!model) {
      throw new Error(`Model ${modelId} not found in models.json or existing snapshot`);
    }

    const { breakdown, avgLatencyMs } = computeBreakdown(snapshotPuzzles, modelId);
    // Only use mate1 score for now
    const score = breakdown.mate1;
    
    return {
      id: model.id,
      name: currentModel?.name || model.name, // Use current name if available, otherwise cached name
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

  await writeJsonFile(outPath, snapshot);
  console.log(`Wrote ${outPath}`);
  console.log(`\nSummary: ${snapshotPuzzles.length} puzzles, ${snapshotModels.length} models (${modelsToTest.length} tested, ${snapshotModels.length - modelsToTest.length} cached)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


