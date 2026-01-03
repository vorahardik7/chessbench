import path from "path";
import { promises as fs } from "fs";
import type {
  BenchModel,
  BenchPuzzle,
  LatestSnapshotModel,
  MateLevel,
  ModelPuzzleResult,
  ModelResultsFile,
  ModelLevelResultsFile,
  ResultsIndex,
} from "./types";
import { ALL_MATE_LEVELS } from "./types";
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

function computeLevelStats(
  puzzles: BenchPuzzle[],
  results: Record<string, ModelPuzzleResult>,
): { score: number; avgLatencyMs?: number } {
  let correct = 0;
  let total = 0;
  const latencies: number[] = [];

  for (const p of puzzles) {
    const r = results[p.id];
    if (!r) continue;
    total++;
    if (r.isCorrect) correct++;
    if (typeof r.latencyMs === "number") latencies.push(r.latencyMs);
  }

  const score = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
  const avgLatencyMs =
    latencies.length === 0 ? undefined : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  return { score, avgLatencyMs };
}

function safeModelFileSlug(modelId: string): string {
  // OpenRouter ids often contain slashes like "openai/gpt-4o".
  // We keep it filesystem-safe and stable.
  return modelId.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

async function main() {
  await loadDotEnv();
  const root = process.cwd();
  const modelsPath = path.join(root, "bench/models.json");
  const resultsDir = path.join(root, "public/results");
  const levelsDir = path.join(resultsDir, "levels");
  const modelsOutDir = path.join(resultsDir, "models");
  const indexPath = path.join(resultsDir, "index.json");
  const promptVersion = "v1.1";

  // Load puzzles by level
  const puzzlesByLevel: Record<MateLevel, BenchPuzzle[]> = {
    mate1: [],
    mate2: [],
    mate3: [],
  };

  for (const level of ALL_MATE_LEVELS) {
    const puzzlePath = path.join(root, `bench/puzzles.${level}.json`);
    try {
      puzzlesByLevel[level] = await readJsonFile<BenchPuzzle[]>(puzzlePath);
      console.log(`Loaded ${puzzlesByLevel[level].length} puzzles for ${level}`);
    } catch {
      console.log(`No puzzles found for ${level} (${puzzlePath})`);
      puzzlesByLevel[level] = [];
    }
  }

  const allPuzzles = ALL_MATE_LEVELS.flatMap((level) => puzzlesByLevel[level]);
  const models = await readJsonFile<BenchModel[]>(modelsPath);
  const concurrency = Number(process.env.BENCH_CONCURRENCY ?? "3");

  const runId = `bench-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runAt = new Date().toISOString();

  // Ensure directories exist
  await ensureDir(levelsDir);
  await ensureDir(modelsOutDir);
  for (const level of ALL_MATE_LEVELS) {
    await ensureDir(path.join(levelsDir, level));
  }

  const modelFiles: Record<string, string> = {};
  const levelFiles: Record<string, Record<MateLevel, string>> = {};
  const leaderboard: LatestSnapshotModel[] = [];
  const processedModelIds = new Set<string>();

  // ============================================================================
  // STEP 1: Scan existing level files to include all models with results
  // ============================================================================
  console.log("\nScanning existing results...");
  const existingModelSlugs = new Set<string>();
  
  for (const level of ALL_MATE_LEVELS) {
    const levelDir = path.join(levelsDir, level);
    try {
      const files = await fs.readdir(levelDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          existingModelSlugs.add(file.replace(".json", ""));
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  // Process existing models not in models.json
  for (const slug of existingModelSlugs) {
    // Try to load model info from any level file
    let modelInfo: BenchModel | null = null;
    const allResults: Record<string, ModelPuzzleResult> = {};
    const levelScores: Record<MateLevel, number> = { mate1: 0, mate2: 0, mate3: 0 };
    const allLatencies: number[] = [];

    for (const level of ALL_MATE_LEVELS) {
      const levelFilePath = path.join(levelsDir, level, `${slug}.json`);
      try {
        const levelFile = await readJsonFile<ModelLevelResultsFile>(levelFilePath);
        if (!modelInfo) {
          modelInfo = levelFile.model;
        }
        levelScores[level] = levelFile.score;
        Object.assign(allResults, levelFile.results);
        if (levelFile.avgLatencyMs) allLatencies.push(levelFile.avgLatencyMs);
        
        // Set up level files reference
        if (!levelFiles[levelFile.model.id]) {
          levelFiles[levelFile.model.id] = {} as Record<MateLevel, string>;
        }
        levelFiles[levelFile.model.id][level] = `/results/levels/${level}/${slug}.json`;
      } catch {
        // Level file doesn't exist for this model
      }
    }

    if (modelInfo && Object.keys(allResults).length > 0) {
      // Skip if this model will be processed from models.json
      const isInModelsJson = models.some((m) => safeModelFileSlug(m.id) === slug);
      if (isInModelsJson) continue;

      processedModelIds.add(modelInfo.id);
      
      const breakdown = {
        mate1: levelScores.mate1,
        mate2: levelScores.mate2,
        mate3: levelScores.mate3,
      };

      // Calculate average score only for levels that have been tested
      const testedLevels = ALL_MATE_LEVELS.filter((l) => 
        Object.keys(allResults).some((k) => k.startsWith(`${l}-`))
      );
      
      const weightedScore = testedLevels.length === 0 ? 0 : Math.round(
        testedLevels.reduce((sum, l) => sum + levelScores[l], 0) / testedLevels.length * 10
      ) / 10;

      const avgLatencyMs =
        allLatencies.length === 0
          ? undefined
          : Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);

      modelFiles[modelInfo.id] = `/results/models/${slug}.json`;

      // Update aggregated model file
      const modelOut: ModelResultsFile = {
        model: modelInfo,
        runId,
        runAt,
        promptVersion,
        score: weightedScore,
        breakdown,
        avgLatencyMs,
        results: allResults,
      };
      await writeJsonFile(path.join(modelsOutDir, `${slug}.json`), modelOut);

      leaderboard.push({
        id: modelInfo.id,
        name: modelInfo.name,
        score: weightedScore,
        breakdown,
        avgLatencyMs,
      });

      console.log(`  Found existing: ${modelInfo.name} (${Object.keys(allResults).length} results)`);
    }
  }

  console.log(`\nFound ${leaderboard.length} models with existing results`);

  // ============================================================================
  // STEP 2: Process models from models.json (run benchmarks if needed)
  // ============================================================================
  for (const model of models) {
    const slug = safeModelFileSlug(model.id);
    console.log(`\nProcessing model: ${model.name} (${model.id})`);

    // Initialize level files for this model
    levelFiles[model.id] = {} as Record<MateLevel, string>;

    // Track results across all levels for this model
    const allResults: Record<string, ModelPuzzleResult> = {};
    const levelScores: Record<MateLevel, number> = { mate1: 0, mate2: 0, mate3: 0 };
    const allLatencies: number[] = [];

    // Process each level independently
    for (const level of ALL_MATE_LEVELS) {
      const levelPuzzles = puzzlesByLevel[level];
      const levelOutDir = path.join(levelsDir, level);
      const levelFilePath = path.join(levelOutDir, `${slug}.json`);
      const levelPublicUrl = `/results/levels/${level}/${slug}.json`;
      levelFiles[model.id][level] = levelPublicUrl;

      // Check if we have cached results for this level
      let existingLevel: ModelLevelResultsFile | null = null;
      try {
        existingLevel = await readJsonFile<ModelLevelResultsFile>(levelFilePath);
      } catch {
        existingLevel = null;
      }

      // If no puzzles for this level, just use cached results if available
      if (levelPuzzles.length === 0) {
        if (existingLevel) {
          console.log(`  Loaded cached ${level}: ${existingLevel.score}% correct`);
          levelScores[level] = existingLevel.score;
          Object.assign(allResults, existingLevel.results);
          if (existingLevel.avgLatencyMs) allLatencies.push(existingLevel.avgLatencyMs);
        } else {
          console.log(`  Skipping ${level}: no puzzles and no cached results`);
        }
        continue;
      }

      // Check if cached results are valid
      const expectedPuzzleIds = levelPuzzles.map((p) => p.id).sort().join("|");
      const existingPuzzleIds = existingLevel
        ? Object.keys(existingLevel.results ?? {}).sort().join("|")
        : "";

      const needsRun =
        !existingLevel ||
        existingLevel.promptVersion !== promptVersion ||
        existingLevel.model?.id !== model.id ||
        existingPuzzleIds !== expectedPuzzleIds;

      if (needsRun) {
        console.log(`  Running ${level} (${levelPuzzles.length} puzzles)...`);

        // Run evaluation for this level
        const resultsArr = await asyncPool(concurrency, levelPuzzles, async (p) => evalOne(model, p));
        const levelResults: Record<string, ModelPuzzleResult> = {};
        levelPuzzles.forEach((p, idx) => {
          levelResults[p.id] = resultsArr[idx]!;
        });

        // Compute stats for this level
        const stats = computeLevelStats(levelPuzzles, levelResults);
        levelScores[level] = stats.score;

        // Save level results
        const levelOut: ModelLevelResultsFile = {
          model,
          level,
          runId,
          runAt,
          promptVersion,
          score: stats.score,
          avgLatencyMs: stats.avgLatencyMs,
          results: levelResults,
        };
        await writeJsonFile(levelFilePath, levelOut);
        console.log(`  Saved ${level}: ${stats.score}% correct`);

        // Add to aggregated results
        Object.assign(allResults, levelResults);
        if (stats.avgLatencyMs) allLatencies.push(stats.avgLatencyMs);
      } else {
        // existingLevel is guaranteed non-null here since needsRun is false
        const cached = existingLevel!;
        console.log(`  Cached ${level}: ${cached.score}% correct`);

        // Use cached results
        levelScores[level] = cached.score;
        Object.assign(allResults, cached.results);
        if (cached.avgLatencyMs) allLatencies.push(cached.avgLatencyMs);
      }
    }

    // Compute overall stats
    const breakdown = {
      mate1: levelScores.mate1,
      mate2: levelScores.mate2,
      mate3: levelScores.mate3,
    };

    // Calculate average score only for levels that have been tested
    const testedLevels = ALL_MATE_LEVELS.filter((l) => 
      Object.keys(allResults).some((k) => k.startsWith(`${l}-`))
    );
    
    const weightedScore = testedLevels.length === 0 ? 0 : Math.round(
      testedLevels.reduce((sum, l) => sum + levelScores[l], 0) / testedLevels.length * 10
    ) / 10;

    const avgLatencyMs =
      allLatencies.length === 0
        ? undefined
        : Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length);

    // Save aggregated model results (for backward compatibility)
    const modelFilePath = path.join(modelsOutDir, `${slug}.json`);
    const modelPublicUrl = `/results/models/${slug}.json`;
    modelFiles[model.id] = modelPublicUrl;

    const modelOut: ModelResultsFile = {
      model,
      runId,
      runAt,
      promptVersion,
      score: weightedScore,
      breakdown,
      avgLatencyMs,
      results: allResults,
    };
    await writeJsonFile(modelFilePath, modelOut);

    // Add to leaderboard
    leaderboard.push({
      id: model.id,
      name: model.name,
      score: weightedScore,
      breakdown,
      avgLatencyMs,
    });

    console.log(`  Overall: ${weightedScore}% (mate1: ${breakdown.mate1}%, mate2: ${breakdown.mate2}%, mate3: ${breakdown.mate3}%)`);
  }

  // Write index file
  const index: ResultsIndex = {
    runId,
    runAt,
    promptVersion,
    puzzles: allPuzzles,
    models: leaderboard.sort((a, b) => b.score - a.score),
    modelFiles,
    levelFiles,
  };

  await writeJsonFile(indexPath, index);
  console.log(`\nWrote ${indexPath}`);
  console.log(`\nSummary: ${allPuzzles.length} puzzles across ${ALL_MATE_LEVELS.length} levels, ${leaderboard.length} models`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
