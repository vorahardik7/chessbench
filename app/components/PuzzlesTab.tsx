'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DrawShape } from '@lichess-org/chessground/draw';
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Clock,
} from 'lucide-react';
import ChessBoard from './ChessBoard';
import { asKey, uciLineToSan } from './utils';
import type { LatestSnapshot as BenchmarkData } from '../../bench/types';

// ============================================================================
// CUSTOM DROPDOWN COMPONENT
// ============================================================================
function CustomDropdown({
  value,
  options,
  onChange,
  placeholder = 'Select...',
}: {
  value: string;
  options: { id: string; label: string; sublabel?: string }[];
  onChange: (id: string) => void;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find((o) => o.id === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 rounded-lg bg-neutral-800 border border-neutral-700 text-left hover:border-neutral-600 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-neutral-200 truncate">
            {selected?.label ?? placeholder}
          </div>
          {selected?.sublabel && (
            <div className="text-xs text-neutral-500 truncate">{selected.sublabel}</div>
          )}
        </div>
        <ChevronDown
          className={`w-4 h-4 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-2 w-full max-h-64 overflow-y-auto rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl"
          >
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-700/50 transition-colors ${
                  value === option.id ? 'bg-neutral-700/30' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-200 truncate">{option.label}</div>
                  {option.sublabel && (
                    <div className="text-xs text-neutral-500 truncate">{option.sublabel}</div>
                  )}
                </div>
                {value === option.id && <Check className="w-4 h-4 text-green-500 flex-shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function getPuzzleDescription(level: 'mate1' | 'mate2' | 'mate3'): string {
  switch (level) {
    case 'mate1':
      return 'White to move and find checkmate in 1 move.';
    case 'mate2':
      return 'White to move and find checkmate in 2 moves.';
    case 'mate3':
      return 'White to move and find checkmate in 3 moves.';
  }
}

// ============================================================================
// PUZZLES TAB
// ============================================================================
export default function PuzzlesTab({ data }: { data: BenchmarkData }) {
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string>(data.puzzles[0]?.id);
  const [selectedModelId, setSelectedModelId] = useState<string>(data.models[0]?.id);
  const [levelFilter, setLevelFilter] = useState<'all' | 'mate1' | 'mate2' | 'mate3'>('all');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const modelOptions = useMemo(() => {
    return [...data.models]
      .sort((a, b) => b.score - a.score)
      .map((m) => ({
        id: m.id,
        label: m.name,
        sublabel: `${m.score.toFixed(1)}% accuracy`,
      }));
  }, [data.models]);

  const filteredPuzzles = useMemo(() => {
    return levelFilter === 'all' ? data.puzzles : data.puzzles.filter((p) => p.level === levelFilter);
  }, [data.puzzles, levelFilter]);

  const activePuzzleId = useMemo(() => {
    if (filteredPuzzles.length === 0) return selectedPuzzleId;
    return filteredPuzzles.some((p) => p.id === selectedPuzzleId) ? selectedPuzzleId : filteredPuzzles[0].id;
  }, [filteredPuzzles, selectedPuzzleId]);

  const selectedPuzzle = useMemo(() => {
    return data.puzzles.find((p) => p.id === activePuzzleId) || data.puzzles[0];
  }, [data.puzzles, activePuzzleId]);

  const selectedModel = useMemo(() => {
    return data.models.find((m) => m.id === selectedModelId) || data.models[0];
  }, [data.models, selectedModelId]);

  const modelResult = selectedPuzzle?.results[selectedModelId];

  const selectedIndex = useMemo(() => {
    if (filteredPuzzles.length === 0) return 0;
    const idx = filteredPuzzles.findIndex((p) => p.id === activePuzzleId);
    return idx >= 0 ? idx : 0;
  }, [filteredPuzzles, activePuzzleId]);

  const goPrev = () => {
    if (filteredPuzzles.length === 0) return;
    setSelectedPuzzleId(filteredPuzzles[Math.max(0, selectedIndex - 1)].id);
  };

  const goNext = () => {
    if (filteredPuzzles.length === 0) return;
    setSelectedPuzzleId(filteredPuzzles[Math.min(filteredPuzzles.length - 1, selectedIndex + 1)].id);
  };

  const shapes = useMemo(() => {
    const s: DrawShape[] = [];
    if (!selectedPuzzle) return s;

    // Show opponent's last move leading into the puzzle (if available)
    const last = selectedPuzzle.lastMoveUci;
    if (last && last.length >= 4) {
      s.push({
        orig: asKey(last.substring(0, 2)),
        dest: asKey(last.substring(2, 4)),
        brush: 'blue',
      });
    }

    const solutionMoves = selectedPuzzle.solutionUci.split(' ');
    const firstSolutionMove = solutionMoves[0];
    if (firstSolutionMove && firstSolutionMove.length >= 4) {
      s.push({
        orig: asKey(firstSolutionMove.substring(0, 2)),
        dest: asKey(firstSolutionMove.substring(2, 4)),
        brush: 'green',
      });
    }

    if (modelResult?.move) {
      const modelMoves = modelResult.move.split(' ');
      const firstModelMove = modelMoves[0];
      if (firstModelMove && firstModelMove.length >= 4 && firstModelMove !== firstSolutionMove) {
        s.push({
          orig: asKey(firstModelMove.substring(0, 2)),
          dest: asKey(firstModelMove.substring(2, 4)),
          brush: 'red',
        });
      }
    }

    return s;
  }, [selectedPuzzle, modelResult]);

  const lastMoveHighlight = useMemo(() => {
    const last = selectedPuzzle?.lastMoveUci;
    if (!last || last.length < 4) return undefined;
    return [asKey(last.substring(0, 2)), asKey(last.substring(2, 4))];
  }, [selectedPuzzle]);

  const modelStats = useMemo(() => {
    let correct = 0;
    let total = 0;
    for (const p of data.puzzles) {
      const r = p.results[selectedModelId];
      if (r) {
        total++;
        if (r.isCorrect) correct++;
      }
    }
    return { correct, total, pct: total > 0 ? ((correct / total) * 100).toFixed(1) : '0' };
  }, [data.puzzles, selectedModelId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateScrollIndicators = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollTop(scrollTop > 10);
      setShowScrollBottom(scrollTop + clientHeight < scrollHeight - 10);
    };

    updateScrollIndicators();
    container.addEventListener('scroll', updateScrollIndicators);
    window.addEventListener('resize', updateScrollIndicators);

    updateScrollIndicators();

    return () => {
      container.removeEventListener('scroll', updateScrollIndicators);
      window.removeEventListener('resize', updateScrollIndicators);
    };
  }, [filteredPuzzles]);

  return (
    <div
      className="grid gap-6 lg:gap-8 lg:grid-cols-[420px_minmax(0,1fr)] xl:grid-cols-[460px_minmax(0,1fr)] lg:items-start"
      style={{ minHeight: '660px' }}
    >
      {/* Sidebar */}
      <aside className="flex flex-col h-full">
        <div className="flex-1 flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900/50 backdrop-blur-sm shadow-[0_0_0_1px_rgba(255,255,255,0.02)] overflow-hidden lg:max-h-[calc(100vh-160px)]">
          <div className="shrink-0 p-5 border-b border-neutral-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xl text-center text-neutral-500 uppercase tracking-wider">Puzzle browser</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={filteredPuzzles.length === 0 || selectedIndex === 0}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-neutral-800 bg-neutral-950/40 text-neutral-300 hover:bg-neutral-800/40 disabled:opacity-40 disabled:hover:bg-neutral-950/40 transition-colors"
                  title="Previous puzzle"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  disabled={filteredPuzzles.length === 0 || selectedIndex >= filteredPuzzles.length - 1}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-neutral-800 bg-neutral-950/40 text-neutral-300 hover:bg-neutral-800/40 disabled:opacity-40 disabled:hover:bg-neutral-950/40 transition-colors"
                  title="Next puzzle"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-neutral-500 uppercase tracking-wider">Model</div>
                <div className="text-xs text-neutral-500">
                  Accuracy:{' '}
                  <span className="text-neutral-300 font-semibold">
                    {modelStats.correct}/{modelStats.total}
                  </span>{' '}
                  <span
                    className={`ml-2 px-2 py-0.5 rounded text-[11px] font-bold ${
                      parseFloat(modelStats.pct) >= 90
                        ? 'bg-green-900/30 text-green-400'
                        : parseFloat(modelStats.pct) >= 70
                        ? 'bg-yellow-900/30 text-yellow-400'
                        : 'bg-red-900/30 text-red-400'
                    }`}
                  >
                    {modelStats.pct}%
                  </span>
                </div>
              </div>
              <CustomDropdown
                value={selectedModelId}
                options={modelOptions}
                onChange={setSelectedModelId}
                placeholder="Choose a model..."
              />
            </div>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex rounded-xl border border-neutral-800 bg-neutral-950/20 p-1 gap-1">
                {(['all', 'mate1', 'mate2', 'mate3'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setLevelFilter(level)}
                    className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-all ${
                      levelFilter === level
                        ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                    }`}
                  >
                    {level === 'all' ? 'All' : level === 'mate1' ? 'Mate 1' : level === 'mate2' ? 'Mate 2' : 'Mate 3'}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-neutral-500">
                <span>
                  Showing <span className="text-neutral-300 font-semibold">{filteredPuzzles.length} puzzles</span>
                </span>
                <span className="px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 font-medium">
                  {filteredPuzzles.length === 0 ? '—' : `${selectedIndex + 1} / ${filteredPuzzles.length}`}
                </span>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 relative">
            {/* Scroll top indicator */}
            {showScrollTop && (
              <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center pointer-events-none">
                <div className="bg-gradient-to-b from-neutral-900 via-neutral-900/98 to-transparent w-full h-10 flex items-start justify-center pt-1">
                  <div className="bg-neutral-800/80 backdrop-blur-sm rounded-full p-1.5 shadow-lg border border-neutral-700/50">
                    <ChevronUp className="w-5 h-5 text-neutral-200 animate-pulse" />
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable list container */}
            <div
              ref={scrollContainerRef}
              className="h-full overflow-y-auto overflow-x-hidden px-2 py-2 custom-scrollbar"
            >
              {filteredPuzzles.length === 0 ? (
                <div className="p-6 text-sm text-neutral-500 text-center italic">No puzzles match your filters.</div>
              ) : (
                <div className="space-y-1.5 pr-1">
                  {filteredPuzzles.map((puzzle, idx) => {
                    const result = puzzle.results[selectedModelId];
                    const active = activePuzzleId === puzzle.id;
                    return (
                      <button
                        key={puzzle.id}
                        type="button"
                        onClick={() => setSelectedPuzzleId(puzzle.id)}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                          active
                            ? 'bg-neutral-800 border-neutral-600 shadow-lg shadow-black/20'
                            : 'bg-neutral-950/20 border-neutral-800/50 hover:bg-neutral-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-3">
                            <span className={`text-xs font-semibold ${active ? 'text-white' : 'text-neutral-400'}`}>
                              Puzzle {idx + 1}
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-sm ${
                                puzzle.level === 'mate1'
                                  ? 'bg-green-900/20 text-green-500'
                                  : puzzle.level === 'mate2'
                                  ? 'bg-blue-900/20 text-blue-500'
                                  : 'bg-orange-900/20 text-orange-500'
                              }`}
                            >
                              {puzzle.level === 'mate1' ? 'M1' : puzzle.level === 'mate2' ? 'M2' : 'M3'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {puzzle.source?.url && (
                              <a
                                href={puzzle.source.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center justify-center w-6 h-6 rounded border border-neutral-800 bg-neutral-900 text-neutral-500 hover:text-neutral-200 transition-colors"
                                title="View on Lichess"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                            {result?.isCorrect ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500" />
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Scroll bottom indicator */}
            {showScrollBottom && (
              <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center pointer-events-none">
                <div className="bg-gradient-to-t from-neutral-900 via-neutral-900/98 to-transparent w-full h-10 flex items-end justify-center pb-1">
                  <div className="bg-neutral-800/80 backdrop-blur-sm rounded-full p-1.5 shadow-lg border border-neutral-700/50">
                    <ChevronDown className="w-5 h-5 text-neutral-200 animate-pulse" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main panel */}
      <section className="flex flex-col h-full min-w-0">
          <div className="flex-1 flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900/40 shadow-xl overflow-hidden lg:max-h-[calc(100vh-160px)]">
          <div className="shrink-0 p-5 border-b border-neutral-800 bg-neutral-900/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-bold text-neutral-100">Puzzle {selectedIndex + 1}</div>
                  <span className="text-xs text-neutral-500 font-mono opacity-50">ID: {selectedPuzzle.id.replace(/^mate[123]-/, '')}</span>
                </div>
                <div className="mt-1 text-sm text-neutral-400 font-medium italic">
                  {getPuzzleDescription(selectedPuzzle.level)}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-5 xl:p-6">
            <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 h-full">
              {/* Board Column - Flexible width, centered */}
              <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-full max-w-[80vh] xl:max-w-[85vh] aspect-square">
                  <div className="w-full h-full rounded-2xl border border-neutral-800 bg-neutral-950/40 p-3 shadow-2xl shadow-black/50 ring-1 ring-white/5 backdrop-blur-sm">
                    <ChessBoard
                      fen={selectedPuzzle.fen}
                      orientation={selectedPuzzle.fen.includes(' w ') ? 'white' : 'black'}
                      shapes={shapes}
                      lastMove={lastMoveHighlight}
                      className="rounded-xl shadow-inner"
                    />
                  </div>
                </div>
                
                {/* Legend */}
                <div className="mt-4 flex items-center justify-center gap-6">
                  <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-medium uppercase tracking-wider">
                    <span className="w-3 h-3 rounded bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.4)]" />
                    Last Move
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-medium uppercase tracking-wider">
                    <span className="w-3 h-3 rounded bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.4)]" />
                    Solution
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-medium uppercase tracking-wider">
                    <span className="w-3 h-3 rounded bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]" />
                    Model
                  </div>
                </div>
              </div>

              {/* Details Column - Fixed width on large screens */}
              <div className="lg:w-[400px] xl:w-[450px] flex flex-col gap-4 lg:py-3">
                {/* Result Status Banner */}
                <div className={`rounded-xl border p-4 ${
                  modelResult?.isCorrect 
                    ? 'bg-green-500/10 border-green-500/20 shadow-[0_0_20px_rgba(34,197,94,0.1)]' 
                    : 'bg-red-500/10 border-red-500/20 shadow-[0_0_20px_rgba(239,68,68,0.1)]'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs font-bold uppercase tracking-widest opacity-70">
                      {modelResult?.isCorrect ? 'Success' : 'Failure'}
                    </div>
                    <div className="text-xs font-mono opacity-50">{selectedModel.name}</div>
                  </div>
                  <div className={`text-xl font-bold ${modelResult?.isCorrect ? 'text-green-400' : 'text-red-400'}`}>
                    {modelResult?.isCorrect ? 'Correct Solution' : 'Incorrect Move'}
                  </div>
                  {typeof modelResult?.latencyMs === 'number' && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs opacity-60">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{modelResult.latencyMs}ms inference time</span>
                    </div>
                  )}
                </div>

                {/* Comparison Card */}
                <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 overflow-hidden flex-1">
                  <div className="p-4 space-y-4">
                    {/* Expected */}
                    <div>
                      <div className="flex items-center mb-2">
                        <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Expected Move</span>
                      </div>
                      <div className="bg-neutral-950/50 rounded-lg border border-neutral-800 p-3">
                        <div className="font-mono text-lg text-green-400 font-medium">
                          {uciLineToSan(selectedPuzzle.fen, selectedPuzzle.solutionUci)}
                        </div>
                        <div className="text-[11px] text-neutral-600 font-mono mt-0.5">
                          {selectedPuzzle.solutionUci}
                        </div>
                      </div>
                    </div>

                    {/* Actual */}
                    <div>
                      <div className="flex items-center mb-2">
                        <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider">Model Output</span>
                      </div>
                      <div className={`rounded-lg border border-neutral-800 p-3 ${
                        !modelResult?.isCorrect ? 'bg-red-500/5 border-red-500/10' : 'bg-neutral-950/50'
                      }`}>
                        <div className={`font-mono text-lg font-medium ${
                          modelResult?.isCorrect ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {modelResult?.move ? uciLineToSan(selectedPuzzle.fen, modelResult.move) : <span className="text-neutral-600 italic">No output</span>}
                        </div>
                        <div className="text-[11px] text-neutral-600 font-mono mt-0.5">
                          {modelResult?.move || '—'}
                        </div>
                        
                        {!modelResult?.isCorrect && modelResult?.move && (
                          <div className="mt-2 pt-2 border-t border-red-500/10 text-[11px] text-red-400/80 flex items-start gap-1.5">
                            <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <div>
                              {modelResult.isLegal === false ? 'Illegal move attempted' : 'Valid move, but incorrect'}
                              {modelResult.parseMethod && modelResult.parseMethod !== 'none' && (
                                <div className="text-[10px] opacity-60 mt-0.5">Parsed via {modelResult.parseMethod}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Meta Info */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-neutral-900/30 rounded-lg p-2.5 border border-neutral-800">
                    <div className="text-[10px] text-neutral-500 uppercase font-bold">Difficulty</div>
                    <div className="text-xs text-neutral-300 capitalize">{selectedPuzzle.level.replace('mate', 'Mate in ')}</div>
                  </div>
                  <div className="bg-neutral-900/30 rounded-lg p-2.5 border border-neutral-800">
                    <div className="text-[10px] text-neutral-500 uppercase font-bold">Source</div>
                    <div className="text-xs text-neutral-300 capitalize">{selectedPuzzle.source?.provider || 'Lichess'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

