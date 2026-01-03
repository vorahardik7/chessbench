/**
 * Quick script to update index.json by scanning all existing level results.
 * Does NOT run any new benchmarks.
 * 
 * Run: bun run bench/update-index.ts
 */

import path from "path";
import { promises as fs } from "fs";
import type {
  BenchModel,
  BenchPuzzle,
  MateLevel,
  ModelLevelResultsFile,
  ModelResultsFile,
  LatestSnapshotModel,
  ResultsIndex,
} from "./types";
import { ALL_MATE_LEVELS } from "./types";
import { readJsonFile, writeJsonFile } from "./utils";

function safeModelFileSlug(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]+/g, "__");
}

async function main() {
  const root = process.cwd();
  const resultsDir = path.join(root, "public/results");
  const levelsDir = path.join(resultsDir, "levels");
  const modelsOutDir = path.join(resultsDir, "models");
  const indexPath = path.join(resultsDir, "index.json");
  const promptVersion = "v1.1";

  // Load puzzles
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
      puzzlesByLevel[level] = [];
    }
  }

  const allPuzzles = ALL_MATE_LEVELS.flatMap((level) => puzzlesByLevel[level]);

  const runId = `index-update-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runAt = new Date().toISOString();

  const modelFiles: Record<string, string> = {};
  const levelFiles: Record<string, Record<MateLevel, string>> = {};
  const leaderboard: LatestSnapshotModel[] = [];

  // Scan existing level files
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
      // Directory might not exist
    }
  }

  console.log(`Found ${existingModelSlugs.size} model slugs`);

  // Process each model
  for (const slug of existingModelSlugs) {
    let modelInfo: BenchModel | null = null;
    const allResults: Record<string, unknown> = {};
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
        // Level file doesn't exist
      }
    }

    if (modelInfo && Object.keys(allResults).length > 0) {
      const breakdown = {
        mate1: levelScores.mate1,
        mate2: levelScores.mate2,
        mate3: levelScores.mate3,
      };

      // Calculate average score only for levels that have been tested
      // A level is considered tested if there are results for it
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
        results: allResults as Record<string, import("./types").ModelPuzzleResult>,
      };
      await writeJsonFile(path.join(modelsOutDir, `${slug}.json`), modelOut);

      leaderboard.push({
        id: modelInfo.id,
        name: modelInfo.name,
        score: weightedScore,
        breakdown,
        avgLatencyMs,
      });

      console.log(`  ${modelInfo.name}: ${Object.keys(allResults).length} results, ${weightedScore}% score`);
    }
  }

  // Write index
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
  console.log(`Summary: ${allPuzzles.length} puzzles, ${leaderboard.length} models`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
