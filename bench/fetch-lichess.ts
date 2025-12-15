import path from "path";
import { Chess } from "chess.js";
import type { BenchPuzzle, MateLevel, PuzzleSource } from "./types";
import { writeJsonFile, uniqBy } from "./utils";

type LichessPuzzleNextResponse = {
  puzzle?: {
    id: string;
    rating?: number;
    themes?: string[];
    solution?: string[]; // usually UCI list
    initialPly?: number;
    fen?: string;
  };
  game?: {
    id?: string;
    pgn?: string;
  };
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

function isUciMove(tok: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(tok.trim());
}

function uciListToLine(moves: string[], take: number): string | null {
  const cleaned = moves.map((m) => m.trim()).filter(Boolean);
  if (cleaned.length < take) return null;
  const first = cleaned.slice(0, take);
  if (!first.every(isUciMove)) return null;
  return normalizeUciLine(first.join(" "));
}

function computeFenFromPgn(pgn: string, initialPly: number): string {
  const full = new Chess();
  // chess.js typings vary by version; `loadPgn` may return void even though it can throw.
  // We treat parsing failures as exceptions and validate by ensuring we have a move list.
  full.loadPgn(pgn);
  const moves = full.history({ verbose: true });
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new Error("Failed to parse PGN from Lichess response.");
  }

  const replay = new Chess();
  const slice = moves.slice(0, Math.max(0, Math.min(initialPly, moves.length)));
  for (const m of slice) replay.move(m);
  return replay.fen();
}

async function fetchPuzzleNext(params: Record<string, string | number | undefined>) {
  const url = new URL("https://lichess.org/api/puzzle/next");
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "chessbench (owner-run benchmark runner)",
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lichess puzzle fetch failed: ${res.status} ${res.statusText} ${body}`);
  }

  return (await res.json()) as LichessPuzzleNextResponse;
}

async function getOnePuzzle(level: MateLevel, difficulty: string): Promise<BenchPuzzle> {
  // Lichess docs/usage varies between `theme` and `angle`. We try `theme` first,
  // then fall back to `angle` if needed.
  const theme = level === "mate1" ? "mateIn1" : level === "mate2" ? "mateIn2" : "mateIn3";

  let json: LichessPuzzleNextResponse;
  try {
    json = await fetchPuzzleNext({ theme, difficulty });
  } catch {
    json = await fetchPuzzleNext({ angle: theme, difficulty });
  }

  const pid = json.puzzle?.id;
  if (!pid) throw new Error("Lichess response missing puzzle.id");

  const sol = json.puzzle?.solution ?? [];
  const take = requiredPlies(level);
  const solutionUci = uciListToLine(sol, take);
  if (!solutionUci) {
    throw new Error(`Puzzle ${pid} did not include a usable UCI solution line for ${level}`);
  }

  const fullSolutionUci = uciListToLine(sol, sol.length) ?? normalizeUciLine(sol.join(" "));

  let fen = json.puzzle?.fen;
  if (!fen) {
    const pgn = json.game?.pgn;
    const initialPly = json.puzzle?.initialPly;
    if (!pgn || typeof initialPly !== "number") {
      throw new Error(`Puzzle ${pid} missing fen and missing pgn/initialPly to derive fen`);
    }
    fen = computeFenFromPgn(pgn, initialPly);
  }

  const source: PuzzleSource = {
    provider: "lichess",
    puzzleId: pid,
    url: `https://lichess.org/training/${pid}`,
    themes: json.puzzle?.themes,
    rating: json.puzzle?.rating,
    gameId: json.game?.id,
  };

  return {
    id: `${level}-${pid}`,
    level,
    fen,
    solutionUci,
    fullSolutionUci,
    source,
  };
}

async function collect(level: MateLevel, count: number): Promise<BenchPuzzle[]> {
  const puzzles: BenchPuzzle[] = [];
  const difficulty = "normal";

  // Try more than needed to avoid duplicates / bad solutions.
  const maxAttempts = count * 10;
  for (let attempt = 0; attempt < maxAttempts && puzzles.length < count; attempt++) {
    try {
      const p = await getOnePuzzle(level, difficulty);
      puzzles.push(p);
    } catch (err) {
      // Skip and keep trying
      console.warn(String(err));
    }
  }

  const unique = uniqBy(puzzles, (p) => p.id);
  if (unique.length < count) {
    throw new Error(`Only collected ${unique.length}/${count} unique puzzles for ${level}`);
  }
  return unique.slice(0, count);
}

async function main() {
  const root = process.cwd();
  const outDir = path.join(root, "bench");

  const mate1 = await collect("mate1", 10);
  const mate2 = await collect("mate2", 10);
  const mate3 = await collect("mate3", 10);

  await writeJsonFile(path.join(outDir, "puzzles.mate1.json"), mate1);
  await writeJsonFile(path.join(outDir, "puzzles.mate2.json"), mate2);
  await writeJsonFile(path.join(outDir, "puzzles.mate3.json"), mate3);

  console.log("Wrote puzzle sets:");
  console.log("- bench/puzzles.mate1.json");
  console.log("- bench/puzzles.mate2.json");
  console.log("- bench/puzzles.mate3.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


