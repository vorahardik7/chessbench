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
  solutionUci: string; // space-separated UCI line used for scoring
  fullSolutionUci?: string; // optional full line from source
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


