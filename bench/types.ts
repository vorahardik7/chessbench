export type MateLevel = "mate1" | "mate2" | "mate3";

export type PuzzleSource =
  | {
      provider: "lichess";
      puzzleId: string;
      url: string;
      themes?: string[];
      rating?: number;
      gameId?: string;
    }
  | {
      provider: "unknown";
      url?: string;
    };

export type BenchPuzzle = {
  id: string;
  level: MateLevel;
  fen: string;
  lastMoveUci?: string; // last move played in the source game before the puzzle starts (often opponent's blunder)
  solutionUci: string; // space-separated UCI line used for scoring
  source?: PuzzleSource;
};

export type BenchModel = {
  id: string; // OpenRouter model id
  name: string;
  temperature?: number;
  maxTokens?: number;
};

export type ModelPuzzleResult = {
  move: string; // parsed UCI line (space-separated)
  isCorrect: boolean;
  isLegal?: boolean; // whether the parsed move line is legal from the given FEN (up to required plies)
  parseMethod?: "uci" | "san" | "none";
  rawOutput?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LatestSnapshotModel = {
  id: string; // model id (stable key)
  name: string;
  score: number; // overall %
  breakdown: { mate1: number; mate2: number; mate3: number };
  avgLatencyMs?: number;
};

export type LatestSnapshotPuzzle = BenchPuzzle & {
  results: Record<string, ModelPuzzleResult>;
};

export type LatestSnapshot = {
  runId: string;
  runAt: string;
  promptVersion: string;
  models: LatestSnapshotModel[];
  puzzles: LatestSnapshotPuzzle[];
};

// ============================================================================
// NEW OUTPUT FORMAT (index + per-model files)
// ============================================================================
export type ModelResultsFile = {
  model: BenchModel;
  runId: string;
  runAt: string;
  promptVersion: string;
  score: number; // overall %
  breakdown: { mate1: number; mate2: number; mate3: number };
  avgLatencyMs?: number;
  // Results keyed by puzzle id
  results: Record<string, ModelPuzzleResult>;
};

export type ResultsIndex = {
  runId: string;
  runAt: string;
  promptVersion: string;
  // Puzzle definitions (no per-model results here)
  puzzles: BenchPuzzle[];
  // Leaderboard-ready summaries (derived from per-model files)
  models: LatestSnapshotModel[];
  // Public URLs to per-model result files, keyed by model id
  modelFiles: Record<string, string>;
};


