'use client';

import { useState, useMemo } from 'react';
import { Chess } from 'chess.js';
import { motion } from 'framer-motion';
import { ChevronRight, CheckCircle2, XCircle, Trophy, Target, Cpu } from 'lucide-react';
import ChessBoard from './ChessBoard';

// Types matching our JSON structure
type ModelResult = {
  move: string;
  isCorrect: boolean;
};

type Puzzle = {
  id: string;
  level: string;
  fen: string;
  solutionUci: string;
  results: Record<string, ModelResult>;
};

type Model = {
  id: string;
  name: string;
  score: number;
  breakdown: { mate1: number; mate2: number; mate3: number };
};

type BenchmarkData = {
  runId: string;
  runAt: string;
  models: Model[];
  puzzles: Puzzle[];
};

export default function BenchmarkExplorer({ data }: { data: BenchmarkData }) {
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string>(data.puzzles[0]?.id);
  const [selectedModelId, setSelectedModelId] = useState<string>(data.models[0]?.id);

  const selectedPuzzle = data.puzzles.find((p) => p.id === selectedPuzzleId) || data.puzzles[0];
  const selectedModel = data.models.find((m) => m.id === selectedModelId) || data.models[0];

  const modelResult = selectedPuzzle.results[selectedModelId];
  
  // Calculate shapes (arrows) for the board
  const shapes = useMemo(() => {
    const s: any[] = []; // Chessground shapes
    if (!selectedPuzzle) return s;

    // 1. Solution arrow (Green)
    // We only show the first move of the solution for the board visualization usually,
    // or we could show the whole line if we handled ply stepping. 
    // For MVP, let's just show the first move of the solution.
    const solutionMoves = selectedPuzzle.solutionUci.split(' ');
    const firstSolutionMove = solutionMoves[0];
    if (firstSolutionMove && firstSolutionMove.length >= 4) {
      s.push({
        orig: firstSolutionMove.substring(0, 2),
        dest: firstSolutionMove.substring(2, 4),
        brush: 'green',
      });
    }

    // 2. Model arrow (Red if incorrect and different)
    if (modelResult) {
      const modelMoves = modelResult.move.split(' ');
      const firstModelMove = modelMoves[0];
      
      // Only show model arrow if it's valid and different from solution
      if (
        firstModelMove && 
        firstModelMove.length >= 4 && 
        firstModelMove !== firstSolutionMove
      ) {
         s.push({
          orig: firstModelMove.substring(0, 2),
          dest: firstModelMove.substring(2, 4),
          brush: 'red',
        });
      }
    }

    return s;
  }, [selectedPuzzle, modelResult]);

  return (
    <div className="flex flex-col gap-12">
      {/* Leaderboard Section */}
      <section className="grid gap-6">
        <div className="flex items-center gap-2 mb-2">
           <Trophy className="w-6 h-6 text-yellow-500" />
           <h2 className="text-2xl font-bold tracking-tight">Leaderboard</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {data.models
            .sort((a, b) => b.score - a.score)
            .map((model, idx) => (
            <motion.div
              key={model.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`p-6 rounded-xl border transition-colors cursor-pointer ${
                selectedModelId === model.id
                  ? 'bg-neutral-800 border-neutral-600 ring-1 ring-neutral-500'
                  : 'bg-neutral-800/40 border-neutral-700 hover:bg-neutral-800/60'
              }`}
              onClick={() => setSelectedModelId(model.id)}
            >
              <div className="flex justify-between items-start mb-4">
                <span className={`text-3xl font-bold ${idx === 0 ? 'text-yellow-500' : 'text-neutral-100'}`}>
                  #{idx + 1}
                </span>
                <span className="text-sm font-mono text-neutral-400">{model.score.toFixed(1)}%</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">{model.name}</h3>
              <div className="flex gap-2 text-xs text-neutral-500">
                <span>M1: {model.breakdown.mate1}%</span>
                <span>•</span>
                <span>M2: {model.breakdown.mate2}%</span>
                <span>•</span>
                <span>M3: {model.breakdown.mate3}%</span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Puzzle Explorer Section */}
      <section className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Sidebar: Puzzle List */}
        <div className="lg:col-span-4 flex flex-col gap-4 max-h-[600px] overflow-y-auto pr-2">
            <div className="flex items-center gap-2 mb-2 sticky top-0 bg-neutral-900/95 backdrop-blur z-10 py-2">
                <Target className="w-5 h-5 text-blue-500" />
                <h2 className="text-xl font-bold">Puzzles</h2>
            </div>
            {data.puzzles.map((puzzle) => {
                const result = puzzle.results[selectedModelId];
                return (
                    <button
                        key={puzzle.id}
                        onClick={() => setSelectedPuzzleId(puzzle.id)}
                        className={`text-left p-4 rounded-lg border transition-all ${
                            selectedPuzzleId === puzzle.id
                                ? 'bg-neutral-800 border-neutral-600'
                                : 'bg-neutral-800/20 border-neutral-800 hover:bg-neutral-800/40 hover:border-neutral-700'
                        }`}
                    >
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-mono text-neutral-500 uppercase">{puzzle.level}</span>
                            {result?.isCorrect ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                                <XCircle className="w-4 h-4 text-red-500" />
                            )}
                        </div>
                        <div className="font-medium text-sm truncate text-neutral-300">
                             {puzzle.id}
                        </div>
                    </button>
                )
            })}
        </div>

        {/* Main: Board & Details */}
        <div className="lg:col-span-8 grid md:grid-cols-2 gap-8 bg-neutral-900/20 p-8 rounded-2xl border border-neutral-800">
            {/* Board */}
            <div>
                 <ChessBoard 
                    fen={selectedPuzzle.fen} 
                    orientation={selectedPuzzle.fen.includes(' w ') ? 'white' : 'black'}
                    shapes={shapes}
                    className="rounded shadow-2xl shadow-black/50"
                 />
            </div>

            {/* Info Panel */}
            <div className="flex flex-col gap-6">
                <div>
                    <h3 className="text-2xl font-bold mb-2 flex items-center gap-2">
                        <span>Puzzle</span>
                        <span className="text-neutral-500 font-mono text-lg">#{selectedPuzzle.id}</span>
                    </h3>
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-800 text-xs font-mono text-neutral-300 border border-neutral-700">
                        {selectedPuzzle.level}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="p-4 rounded-lg bg-green-900/10 border border-green-900/30">
                        <div className="text-xs text-green-500 font-bold uppercase tracking-wider mb-1">Expected Solution</div>
                        <div className="font-mono text-lg text-green-400">{selectedPuzzle.solutionUci}</div>
                    </div>

                    <div className={`p-4 rounded-lg border ${modelResult?.isCorrect ? 'bg-green-900/10 border-green-900/30' : 'bg-red-900/10 border-red-900/30'}`}>
                        <div className="flex justify-between items-start mb-1">
                             <div className={`text-xs font-bold uppercase tracking-wider ${modelResult?.isCorrect ? 'text-green-500' : 'text-red-500'}`}>
                                {selectedModel.name}
                             </div>
                             <div className="text-xs text-neutral-500">Output</div>
                        </div>
                        <div className={`font-mono text-lg ${modelResult?.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                            {modelResult?.move || 'No move'}
                        </div>
                        {!modelResult?.isCorrect && (
                            <div className="mt-2 text-xs text-red-400/80">
                                Incorrect move or format
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-auto pt-6 border-t border-neutral-800">
                    <div className="flex items-center gap-2 text-sm text-neutral-500">
                        <Cpu className="w-4 h-4" />
                        <span>Viewing snapshot: <span className="text-neutral-300">{data.runId}</span></span>
                    </div>
                </div>
            </div>
        </div>
      </section>
    </div>
  );
}
