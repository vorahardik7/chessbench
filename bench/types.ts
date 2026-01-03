// Puzzle levels - add new levels here as needed
export type MateLevel = "mate1" | "mate2" | "mate3";

// All available puzzle levels for iteration
export const ALL_MATE_LEVELS: MateLevel[] = ["mate1", "mate2", "mate3"];

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

// ============================================================================
// PER-LEVEL RESULT FILES (scalable storage)
// ============================================================================
// Stored at: public/results/levels/{level}/{model_slug}.json
export type ModelLevelResultsFile = {
  model: BenchModel;
  level: MateLevel;
  runId: string;
  runAt: string;
  promptVersion: string;
  score: number; // % correct for this level
  avgLatencyMs?: number;
  // Results keyed by puzzle id (only puzzles for this level)
  results: Record<string, ModelPuzzleResult>;
};

// ============================================================================
// AGGREGATED MODEL FILES (for backward compatibility & UI)
// ============================================================================
// Stored at: public/results/models/{model_slug}.json
export type ModelResultsFile = {
  model: BenchModel;
  runId: string;
  runAt: string;
  promptVersion: string;
  score: number; // overall %
  breakdown: { mate1: number; mate2: number; mate3: number };
  avgLatencyMs?: number;
  // Results keyed by puzzle id (all levels combined)
  results: Record<string, ModelPuzzleResult>;
};

// ============================================================================
// RESULTS INDEX (leaderboard & metadata)
// ============================================================================
export type ResultsIndex = {
  runId: string;
  runAt: string;
  promptVersion: string;
  // Puzzle definitions (no per-model results here)
  puzzles: BenchPuzzle[];
  // Leaderboard-ready summaries (derived from per-model files)
  models: LatestSnapshotModel[];
  // Public URLs to per-model aggregated result files, keyed by model id
  modelFiles: Record<string, string>;
  // Public URLs to per-level result files: levelFiles[modelId][level] = url
  levelFiles: Record<string, Record<MateLevel, string>>;
};


