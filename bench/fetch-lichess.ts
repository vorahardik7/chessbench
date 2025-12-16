import path from "path";
import { Chess } from "chess.js";
import type { BenchPuzzle, MateLevel, PuzzleSource } from "./types";
import { loadDotEnv, writeJsonFile } from "./utils";

const PUZZLES_PER_LEVEL = 10;
const REQUEST_DELAY_MS = 2000;
const RATE_LIMIT_WAIT_MS = 65000;
const BATCH_SIZE = 50;

type LichessPuzzle = {
  puzzle: {
    id: string;
    rating: number;
    plays: number;
    solution: string[];
    themes: string[];
    initialPly: number;
  };
  game: {
    id: string;
    pgn: string;
  };
};

type LichessBatchResponse = {
  puzzles: LichessPuzzle[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Number of plies (half-moves) to score for each level.
 * - mate1: 1 move
 * - mate2: 2 moves (player, then player again after opponent responds) = 3 plies
 * - mate3: 3 moves = 5 plies
 */
function requiredPlies(level: MateLevel): number {
  if (level === "mate1") return 1;
  if (level === "mate2") return 3; // player-opp-player (3 plies)
  return 5; // player-opp-player-opp-player (5 plies)
}

function isUciMove(tok: string): boolean {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(tok.trim());
}

function applyUciMove(chess: Chess, uci: string): boolean {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.length > 4 ? uci[4] : undefined;
  try {
    const result = chess.move({ from, to, promotion });
    return !!result;
  } catch {
    return false;
  }
}

function tokenizePgnMoves(pgn: string): string[] {
  // Lichess `game.pgn` from puzzle batch is usually just a SAN move list separated by spaces.
  // But be defensive: filter out move numbers and game result markers.
  const toks = pgn.trim().split(/\s+/g).filter(Boolean);
  const isMoveNumber = (t: string) => /^\d+\.(\.\.)?$/.test(t) || /^\d+\.\.\.$/.test(t) || /^\d+\.$/.test(t);
  const isResult = (t: string) => t === "1-0" || t === "0-1" || t === "1/2-1/2" || t === "*";

  return toks.filter((t) => !isMoveNumber(t) && !isResult(t));
}

function positionAfterPlies(
  gamePgn: string,
  plies: number,
): { fen: string; lastMoveUci?: string } | null {
  const moves = tokenizePgnMoves(gamePgn);
  const take = Math.max(0, Math.min(plies, moves.length));
  const chess = new Chess();
  let lastMoveUci: string | undefined = undefined;

  for (let i = 0; i < take; i++) {
    const san = moves[i]!;
    try {
      // chess.js default parser is permissive; good for common SAN variants.
      const mv = chess.move(san);
      const promo = typeof mv.promotion === "string" ? mv.promotion.toLowerCase() : "";
      lastMoveUci = `${mv.from}${mv.to}${promo}`;
    } catch {
      return null;
    }
  }

  return { fen: chess.fen(), lastMoveUci };
}

function puzzlePosFromGameAndSolution(raw: LichessPuzzle): { fen: string; lastMoveUci?: string } | null {
  const { game, puzzle } = raw;
  const first = puzzle.solution?.[0];
  if (!first || !isUciMove(first)) return null;

  // Primary guess: initialPly is the puzzle start ply.
  // Be robust: try a small +/- 1 window and pick the first where solution[0] is legal.
  const candidates = [
    puzzle.initialPly,
    puzzle.initialPly - 1,
    puzzle.initialPly + 1,
  ].filter((n, idx, arr) => Number.isFinite(n) && n >= 0 && arr.indexOf(n) === idx);

  for (const plies of candidates) {
    const pos = positionAfterPlies(game.pgn, plies);
    if (!pos) continue;
    const chess = new Chess(pos.fen);
    if (applyUciMove(chess, first)) return pos;
  }

  return null;
}

function parsePuzzle(raw: LichessPuzzle, level: MateLevel): BenchPuzzle | null {
  const puzzle = raw.puzzle;
  const game = raw.game;
  const solution = puzzle.solution;

  const need = requiredPlies(level);

  // Need at least the scored line length.
  if (!Array.isArray(solution) || solution.length < need) {
    return null;
  }

  // Validate all solution moves are valid UCI
  if (!solution.every(isUciMove)) {
    return null;
  }

  const pos = puzzlePosFromGameAndSolution(raw);
  if (!pos) return null;

  // Take exactly the required plies for scoring.
  const solutionUci = solution.slice(0, need).join(" ");

  const source: PuzzleSource = {
    provider: "lichess",
    puzzleId: puzzle.id,
    url: `https://lichess.org/training/${puzzle.id}`,
    themes: puzzle.themes,
    rating: puzzle.rating,
    gameId: game.id,
  };

  return {
    id: `${level}-${puzzle.id}`,
    level,
    fen: pos.fen,
    lastMoveUci: pos.lastMoveUci,
    solutionUci,
    source,
  };
}

async function fetchBatch(theme: string): Promise<LichessPuzzle[]> {
  // Use mateIn1 theme and request 50 puzzles (max allowed)
  const url = `https://lichess.org/api/puzzle/batch/${theme}?nb=${BATCH_SIZE}`;
  const token = process.env.LICHESS_TOKEN?.trim();

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "chessbench (personal benchmark runner, contact: github.com/chessbench)",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 429) {
    throw new Error("RATE_LIMITED");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Lichess API error: ${res.status} ${res.statusText} ${body}`);
  }

  const json = (await res.json()) as LichessBatchResponse;
  return json.puzzles ?? [];
}

async function collectPuzzles(level: MateLevel, count: number): Promise<BenchPuzzle[]> {
  const theme = level === "mate1" ? "mateIn1" : level === "mate2" ? "mateIn2" : "mateIn3";
  const collected: BenchPuzzle[] = [];
  const seenIds = new Set<string>();
  let retries = 0;
  const maxRetries = 5;

  console.log(`Fetching ${level} puzzles (theme: ${theme})...`);

  while (collected.length < count && retries < maxRetries) {
    try {
      const batch = await fetchBatch(theme);
      console.log(`  Received ${batch.length} puzzles from Lichess`);

      let parsedCount = 0;
      for (const raw of batch) {
        if (seenIds.has(raw.puzzle.id)) continue;
        seenIds.add(raw.puzzle.id);

        const parsed = parsePuzzle(raw, level);
        if (parsed) {
          collected.push(parsed);
          parsedCount++;
          if (collected.length >= count) break;
        }
      }

      console.log(`  Parsed ${parsedCount} valid puzzles, total: ${collected.length}/${count}`);

      if (collected.length < count) {
        console.log(`  Waiting ${REQUEST_DELAY_MS}ms before next request...`);
        await sleep(REQUEST_DELAY_MS);
      }
    } catch (err) {
      if (String(err).includes("RATE_LIMITED")) {
        console.log(`  Rate limited! Waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry...`);
        await sleep(RATE_LIMIT_WAIT_MS);
        retries++;
      } else {
        console.error(`  Error: ${String(err)}`);
        retries++;
        await sleep(REQUEST_DELAY_MS * 2);
      }
    }
  }

  if (collected.length < count) {
    console.warn(`  Warning: Only collected ${collected.length}/${count} puzzles for ${level}`);
  }

  return collected.slice(0, count);
}

async function verifyPuzzles(
  puzzles: BenchPuzzle[],
): Promise<{ valid: number; invalid: string[]; sampleInvalid?: { id: string; fen: string; solutionUci: string } }> {
  const invalid: string[] = [];
  let valid = 0;
  let sampleInvalid: { id: string; fen: string; solutionUci: string } | undefined = undefined;

  for (const p of puzzles) {
    const chess = new Chess(p.fen);
    const firstMove = p.solutionUci.split(" ")[0];
    if (!firstMove) {
      invalid.push(p.id);
      if (!sampleInvalid) sampleInvalid = { id: p.id, fen: p.fen, solutionUci: p.solutionUci };
      continue;
    }

    if (applyUciMove(chess, firstMove)) {
      valid++;
    } else {
      invalid.push(p.id);
      if (!sampleInvalid) sampleInvalid = { id: p.id, fen: p.fen, solutionUci: p.solutionUci };
    }
  }

  return { valid, invalid, sampleInvalid };
}

async function main() {
  await loadDotEnv();
  const root = process.cwd();
  const outDir = path.join(root, "bench");

  console.log("=".repeat(60));
  console.log("Lichess Puzzle Fetcher");
  console.log("=".repeat(60));
  console.log(`Target: ${PUZZLES_PER_LEVEL} mate-in-1 puzzles\n`);

  const mate1 = await collectPuzzles("mate1", PUZZLES_PER_LEVEL);
  console.log("");

  // Verify puzzles before writing
  console.log("Verifying puzzles...");
  const v1 = await verifyPuzzles(mate1);
  
  console.log(`  mate1: ${v1.valid}/${mate1.length} valid`);

  if (v1.valid === 0) {
    console.error("\nERROR: No valid puzzles collected. Try again later.");
    if (v1.sampleInvalid) {
      console.error(`Sample invalid puzzle:\n  id=${v1.sampleInvalid.id}\n  fen=${v1.sampleInvalid.fen}\n  sol=${v1.sampleInvalid.solutionUci}`);
    }
    process.exit(1);
  }

  console.log("\nWriting puzzle files...");
  
  if (mate1.length > 0) {
    await writeJsonFile(path.join(outDir, "puzzles.mate1.json"), mate1);
    console.log(`  ✓ bench/puzzles.mate1.json (${mate1.length} puzzles)`);
  }

  console.log("");
  console.log("=".repeat(60));
  console.log("Summary:");
  console.log(`  Mate-in-1: ${mate1.length} puzzles (${v1.valid} verified)`);
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
