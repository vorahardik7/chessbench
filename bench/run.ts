import path from "path";
import { promises as fs } from "fs";
import type {
  BenchModel,
  BenchPuzzle,
  LatestSnapshotModel,
  MateLevel,
  ModelPuzzleResult,
  ModelResultsFile,
  ResultsIndex,
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
  const chess = new Chess(puzzle.fen);
  const turn = chess.turn() === "w" ? "White" : "Black";

  const system =
    "You are a chess engine assistant. Analyze the position and solve the puzzle. " +
    "First, provide a brief analysis of the position and identify the tactical theme. " +
    "Then, find the forcing checkmate sequence. " +
    "Finally, output the moves strictly in UCI format (e.g. e2e4 e7e5) separated by spaces, " +
    "wrapped in [RESULT] and [/RESULT] tags.";

  const lastMoveLine = puzzle.lastMoveUci ? `Opponent's last move (context): ${puzzle.lastMoveUci}\n` : "";

  const user =
    `Position (FEN): ${puzzle.fen}\n` +
    `It is ${turn}'s turn to move.\n\n` +
    `Board:\n${chess.ascii()}\n` +
    lastMoveLine +
    `Task: Find mate in ${n} (${plies} plies).\n\n` +
    `Output only the UCI line inside [RESULT] tags at the very end of your response.\n` +
    `Now analyze and solve:`;

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

  if (typeof choice?.text === "string" && choice.text.trim().length > 0) return choice.text;
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
    max_tokens: opts?.maxTokensOverride ?? model.maxTokens ?? 256,
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
    // provider: {
    //   only: ['google-vertex'],
    // },
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

  const parseContent = (text: string): { parsed: string; method: "uci" | "san" | "none" } => {
    // 1. Try to find content inside [RESULT] tags
    // Support newlines between tags without relying on the RegExp dotAll flag
    // (tsconfig target is ES2017).
    // Example:
    // [RESULT]
    // e2e4 e7e5
    // [/RESULT]
    const tagMatch = text.match(/\[RESULT\]\s*([\s\S]*?)\s*\[\/RESULT\]/i);
    const target = tagMatch ? tagMatch[1] : text;

    // 2. Extract UCI tokens
    const uciToks = extractUciTokens(target);
    if (uciToks.length >= need) {
      return { parsed: uciToks.slice(0, need).join(" "), method: "uci" };
    }

    // 3. Fallback to SAN parsing
    const sanLine = tryParseSanToUciLine(puzzle.fen, need, target);
    if (sanLine) {
      return { parsed: sanLine, method: "san" };
    }

    return { parsed: "", method: "none" };
  };

  let { parsed, method: parseMethod } = parseContent(content);

  // If we got nothing and we likely hit the token limit, retry once with a higher cap.
  // This is particularly important for models that spend early tokens on "reasoning" and only emit moves later.
  const configuredMax = model.maxTokens ?? 256;
  const hitLimit = typeof completionTokens === "number" && completionTokens >= configuredMax;
  if (parsed.length === 0 && hitLimit) {
    const retryMax = Math.min(Math.max(configuredMax * 4, 512), 2048);
    const retry = await callOpenRouter(model, prompt, { maxTokensOverride: retryMax });
    content = retry.content;
    latencyMs = retry.latencyMs;
    promptTokens = retry.promptTokens;
    completionTokens = retry.completionTokens;
    totalTokens = retry.totalTokens;

    const retryRes = parseContent(content);
    parsed = retryRes.parsed;
    parseMethod = retryRes.method;
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

// NOTE: Old snapshot-wide breakdown kept for reference; new flow uses
// computeModelStatsFromResults() on per-model files.

function computeModelStatsFromResults(
  puzzles: BenchPuzzle[],
  resultsByPuzzleId: Record<string, ModelPuzzleResult>,
): { breakdown: { mate1: number; mate2: number; mate3: number }; avgLatencyMs?: number; score: number } {
  const byLevel: Record<MateLevel, { correct: number; total: number; latencies: number[] }> = {
    mate1: { correct: 0, total: 0, latencies: [] },
    mate2: { correct: 0, total: 0, latencies: [] },
    mate3: { correct: 0, total: 0, latencies: [] },
  };

  for (const p of puzzles) {
    const r = resultsByPuzzleId[p.id];
    if (!r) continue;
    byLevel[p.level].total += 1;
    if (r.isCorrect) byLevel[p.level].correct += 1;
    if (typeof r.latencyMs === "number") byLevel[p.level].latencies.push(r.latencyMs);
  }

  const pct = (c: number, t: number) => (t === 0 ? 0 : Math.round((c / t) * 1000) / 10);
  const avg = (xs: number[]) =>
    xs.length === 0 ? undefined : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

  const breakdown = {
    mate1: pct(byLevel.mate1.correct, byLevel.mate1.total),
    mate2: pct(byLevel.mate2.correct, byLevel.mate2.total),
    mate3: pct(byLevel.mate3.correct, byLevel.mate3.total),
  };

  // Only use mate1 score for now (keep existing behavior)
  const score = breakdown.mate1;

  const avgLatencyMs = avg([
    ...byLevel.mate1.latencies,
    ...byLevel.mate2.latencies,
    ...byLevel.mate3.latencies,
  ]);

  return { breakdown, avgLatencyMs, score };
}

function safeModelFileSlug(modelId: string): string {
  // OpenRouter ids often contain slashes like "openai/gpt-4o".
  // We keep it filesystem-safe and stable.
  return modelId.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

async function main() {
  await loadDotEnv();
  const root = process.cwd();
  const modelsPath = path.join(root, "bench/models.json");
  const resultsDir = path.join(root, "public/results");
  const modelsOutDir = path.join(resultsDir, "models");
  const indexPath = path.join(resultsDir, "index.json");
  const promptVersion = "v1.1";
  // Only test mate1 for now
  const puzzlesPaths = [
    path.join(root, "bench/puzzles.mate1.json"),
    // path.join(root, "bench/puzzles.mate2.json"),
    // path.join(root, "bench/puzzles.mate3.json"),
  ];

  const models = await readJsonFile<BenchModel[]>(modelsPath);
  const puzzles = (await Promise.all(puzzlesPaths.map((p) => readJsonFile<BenchPuzzle[]>(p)))).flat();

  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? "3");

  const runId = `bench-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runAt = new Date().toISOString();

  const modelFiles: Record<string, string> = {};
  const leaderboard: LatestSnapshotModel[] = [];
  const processedModelIds = new Set<string>();

  // Step 1: Scan existing model result files and include them in the index
  // This ensures models removed from models.json still appear in results
  try {
    const existingFiles = await fs.readdir(modelsOutDir);
    for (const filename of existingFiles) {
      if (!filename.endsWith(".json")) continue;
      const modelAbsPath = path.join(modelsOutDir, filename);
      try {
        const file = await readJsonFile<ModelResultsFile>(modelAbsPath);
        if (file.model?.id) {
          const modelId = file.model.id;
          processedModelIds.add(modelId);
          const slug = safeModelFileSlug(modelId);
          const modelPublicUrl = `/results/models/${slug}.json`;
          modelFiles[modelId] = modelPublicUrl;
          leaderboard.push({
            id: modelId,
            name: file.model.name,
            score: file.score,
            breakdown: file.breakdown,
            avgLatencyMs: file.avgLatencyMs,
          });
        }
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Directory doesn't exist yet, that's fine
  }

  // Step 2: For each model in models.json, test if needed
  for (const model of models) {
    const slug = safeModelFileSlug(model.id);
    const modelAbsPath = path.join(modelsOutDir, `${slug}.json`);
    const modelPublicUrl = `/results/models/${slug}.json`;
    modelFiles[model.id] = modelPublicUrl;

    let existing: ModelResultsFile | null = null;
    try {
      existing = await readJsonFile<ModelResultsFile>(modelAbsPath);
    } catch {
      existing = null;
    }

    const expectedPuzzleIds = puzzles.map((p) => p.id).sort().join("|");
    const existingPuzzleIds =
      existing ? Object.keys(existing.results ?? {}).sort().join("|") : "";

    const needsRun =
      !existing ||
      existing.promptVersion !== promptVersion ||
      existing.model?.id !== model.id ||
      existingPuzzleIds !== expectedPuzzleIds;

    if (needsRun) {
      console.log(`Running model: ${model.name} (${model.id})`);
      const resultsArr = await asyncPool(concurrency, puzzles, async (p) => evalOne(model, p));
      const resultsByPuzzleId: Record<string, ModelPuzzleResult> = {};
      puzzles.forEach((p, idx) => {
        resultsByPuzzleId[p.id] = resultsArr[idx]!;
      });

      const stats = computeModelStatsFromResults(puzzles, resultsByPuzzleId);
      const out: ModelResultsFile = {
        model,
        runId,
        runAt,
        promptVersion,
        score: stats.score,
        breakdown: stats.breakdown,
        avgLatencyMs: stats.avgLatencyMs,
        results: resultsByPuzzleId,
      };
      await writeJsonFile(modelAbsPath, out);
      
      // Update leaderboard entry (replace if exists, add if new)
      const existingIdx = leaderboard.findIndex((m) => m.id === model.id);
      const entry: LatestSnapshotModel = {
        id: model.id,
        name: model.name,
        score: stats.score,
        breakdown: stats.breakdown,
        avgLatencyMs: stats.avgLatencyMs,
      };
      if (existingIdx >= 0) {
        leaderboard[existingIdx] = entry;
      } else {
        leaderboard.push(entry);
      }
    } else {
      console.log(`Cached model: ${model.name} (${model.id})`);
      // Update leaderboard entry if it exists, otherwise add it
      const existingIdx = leaderboard.findIndex((m) => m.id === model.id);
      if (existingIdx >= 0) {
        // Re-read to ensure fresh stats
        const file = await readJsonFile<ModelResultsFile>(modelAbsPath);
        leaderboard[existingIdx] = {
          id: model.id,
          name: model.name,
          score: file.score,
          breakdown: file.breakdown,
          avgLatencyMs: file.avgLatencyMs,
        };
      } else {
        // Shouldn't happen, but add it if missing
        const file = await readJsonFile<ModelResultsFile>(modelAbsPath);
        leaderboard.push({
          id: model.id,
          name: model.name,
          score: file.score,
          breakdown: file.breakdown,
          avgLatencyMs: file.avgLatencyMs,
        });
      }
    }
  }

  const index: ResultsIndex = {
    runId,
    runAt,
    promptVersion,
    puzzles,
    models: leaderboard.sort((a, b) => b.score - a.score),
    modelFiles,
  };

  await writeJsonFile(indexPath, index);
  console.log(`Wrote ${indexPath}`);
  console.log(`\nSummary: ${puzzles.length} puzzles, ${leaderboard.length} models`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


