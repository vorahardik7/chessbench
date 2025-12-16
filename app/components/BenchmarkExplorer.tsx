'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DrawShape } from '@lichess-org/chessground/draw';
import { Chess } from 'chess.js';
import {
  CheckCircle2,
  XCircle,
  Trophy,
  Target,
  BarChart3,
  Clock,
  Puzzle,
  TrendingUp,
  ChevronDown,
  Check,
  Filter,
} from 'lucide-react';
import ChessBoard from './ChessBoard';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  LabelList,
} from 'recharts';

// Types matching our JSON structure
type ModelResult = {
  move: string;
  isCorrect: boolean;
  rawOutput?: string;
  latencyMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

type PuzzleData = {
  id: string;
  level: string;
  fen: string;
  lastMoveUci?: string;
  solutionUci: string;
  results: Record<string, ModelResult>;
};

type Model = {
  id: string;
  name: string;
  score: number;
  breakdown: { mate1: number; mate2: number; mate3: number };
  avgLatencyMs?: number;
};

type BenchmarkData = {
  runId: string;
  runAt: string;
  models: Model[];
  puzzles: PuzzleData[];
};

const CHART_COLORS = {
  primary: '#fbbf24',
  success: '#22c55e',
  info: '#3b82f6',
  warning: '#f97316',
  purple: '#a78bfa',
};

const BREAKDOWN_COLORS = ['#22c55e', '#3b82f6', '#f97316'];

// Convert UCI line to SAN notation
function uciLineToSan(fen: string, uciLine: string): string {
  if (!uciLine.trim()) return '';
  const moves = uciLine.trim().split(/\s+/g).filter(Boolean);
  try {
    const chess = new Chess(fen);
    const sanMoves: string[] = [];
    for (const uci of moves) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      const move = chess.move({ from, to, promotion });
      if (move) {
        sanMoves.push(move.san);
      } else {
        return uciLine; // fallback to UCI if any move fails
      }
    }
    return sanMoves.join(' ');
  } catch {
    return uciLine;
  }
}

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
// MULTI-SELECT DROPDOWN FOR CHART FILTERING
// ============================================================================
function MultiSelectDropdown({
  selected,
  options,
  onChange,
  label = 'Filter models',
}: {
  selected: Set<string>;
  options: { id: string; label: string }[];
  onChange: (selected: Set<string>) => void;
  label?: string;
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

  const toggleItem = (id: string) => {
    const newSelected = new Set(selected);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    onChange(newSelected);
  };

  const selectAll = () => {
    onChange(new Set(options.map((o) => o.id)));
  };

  const selectNone = () => {
    onChange(new Set());
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800 border border-neutral-700 text-xs font-medium text-neutral-300 hover:border-neutral-600 transition-colors"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>{label}</span>
        <span className="px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400">
          {selected.size}/{options.length}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-2 w-64 max-h-80 overflow-y-auto rounded-lg bg-neutral-800 border border-neutral-700 shadow-xl"
          >
            {/* Quick actions */}
            <div className="flex items-center gap-2 p-2 border-b border-neutral-700">
              <button
                type="button"
                onClick={selectAll}
                className="flex-1 px-2 py-1.5 text-xs font-medium text-neutral-300 rounded hover:bg-neutral-700/50 transition-colors"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={selectNone}
                className="flex-1 px-2 py-1.5 text-xs font-medium text-neutral-300 rounded hover:bg-neutral-700/50 transition-colors"
              >
                Clear
              </button>
            </div>

            {/* Options */}
            <div className="p-1">
              {options.map((option) => {
                const isChecked = selected.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => toggleItem(option.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-left hover:bg-neutral-700/50 transition-colors"
                  >
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'bg-yellow-500 border-yellow-500'
                          : 'border-neutral-600 bg-neutral-900'
                      }`}
                    >
                      {isChecked && <Check className="w-3 h-3 text-neutral-900" />}
                    </div>
                    <span className="text-sm text-neutral-200 truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ============================================================================
// CHART TOOLTIP
// ============================================================================
type ChartPayloadItem = { name?: string; value?: number | string; color?: string };
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: ChartPayloadItem[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 shadow-xl">
      <div className="text-sm font-semibold text-neutral-100 mb-2">{label}</div>
      <div className="space-y-1">
        {payload.map((p, idx: number) => (
          <div key={idx} className="flex items-center justify-between gap-4 text-sm">
            <div className="flex items-center gap-2 text-neutral-300">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: p.color ?? '#a3a3a3' }}
              />
              <span>{p.name}</span>
            </div>
            <div className="font-mono font-semibold text-neutral-100">
              {typeof p.value === 'number' ? p.value.toFixed(2) : p.value ?? '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomLabel(props: { x: number; y: number; width: number; value?: number | string | null }) {
  const { x, y, width, value } = props;
  if (value === null || value === undefined) return null;
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      fill="#d4d4d4"
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
    >
      {typeof value === 'number' ? value.toFixed(1) : value}
    </text>
  );
}

// ============================================================================
// PUZZLES TAB
// ============================================================================
function PuzzlesTab({ data }: { data: BenchmarkData }) {
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string>(data.puzzles[0]?.id);
  const [selectedModelId, setSelectedModelId] = useState<string>(data.models[0]?.id);
  const [levelFilter, setLevelFilter] = useState<'all' | 'mate1' | 'mate2' | 'mate3'>('all');

  const selectedPuzzle = data.puzzles.find((p) => p.id === selectedPuzzleId) || data.puzzles[0];
  const selectedModel = data.models.find((m) => m.id === selectedModelId) || data.models[0];
  const modelResult = selectedPuzzle?.results[selectedModelId];

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
    if (levelFilter === 'all') return data.puzzles;
    return data.puzzles.filter((p) => p.level === levelFilter);
  }, [data.puzzles, levelFilter]);

  const shapes = useMemo(() => {
    const s: DrawShape[] = [];
    if (!selectedPuzzle) return s;

    // Show opponent's last move leading into the puzzle (if available)
    const last = selectedPuzzle.lastMoveUci;
    if (last && last.length >= 4) {
      s.push({
        orig: last.substring(0, 2),
        dest: last.substring(2, 4),
        brush: 'blue',
      });
    }

    const solutionMoves = selectedPuzzle.solutionUci.split(' ');
    const firstSolutionMove = solutionMoves[0];
    if (firstSolutionMove && firstSolutionMove.length >= 4) {
      s.push({
        orig: firstSolutionMove.substring(0, 2),
        dest: firstSolutionMove.substring(2, 4),
        brush: 'green',
      });
    }

    if (modelResult) {
      const modelMoves = modelResult.move.split(' ');
      const firstModelMove = modelMoves[0];
      if (firstModelMove && firstModelMove.length >= 4 && firstModelMove !== firstSolutionMove) {
         s.push({
          orig: firstModelMove.substring(0, 2),
          dest: firstModelMove.substring(2, 4),
          brush: 'red',
        });
      }
    }

    return s;
  }, [selectedPuzzle, modelResult]);

  const lastMoveHighlight = useMemo(() => {
    const last = selectedPuzzle?.lastMoveUci;
    if (!last || last.length < 4) return undefined;
    return [last.substring(0, 2), last.substring(2, 4)] as const;
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

  return (
    <div className="grid lg:grid-cols-12 gap-6">
      {/* Left: Puzzle List */}
      <div className="lg:col-span-4 flex flex-col gap-4">
        {/* Model Selector */}
        <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-900/50">
          <div className="text-xs text-neutral-500 uppercase tracking-wider mb-3">Select Model</div>
          <CustomDropdown
            value={selectedModelId}
            options={modelOptions}
            onChange={setSelectedModelId}
            placeholder="Choose a model..."
          />
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-neutral-400">Accuracy:</span>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-neutral-100">
                {modelStats.correct}/{modelStats.total}
              </span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-bold ${
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
        </div>
        
        {/* Level Filter */}
        <div className="flex rounded-lg border border-neutral-800 bg-neutral-900/50 p-1 gap-1">
          {(['all', 'mate1', 'mate2', 'mate3'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all ${
                levelFilter === level
                  ? 'bg-neutral-700 text-neutral-100'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
              }`}
            >
              {level === 'all' ? 'All' : level === 'mate1' ? 'M1' : level === 'mate2' ? 'M2' : 'M3'}
            </button>
          ))}
        </div>

        {/* Puzzle List */}
        <div className="flex-1 max-h-[500px] overflow-y-auto pr-1 space-y-1.5">
          {filteredPuzzles.map((puzzle) => {
                const result = puzzle.results[selectedModelId];
                return (
                    <button
                        key={puzzle.id}
                        onClick={() => setSelectedPuzzleId(puzzle.id)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                            selectedPuzzleId === puzzle.id
                                ? 'bg-neutral-800 border-neutral-600'
                    : 'bg-neutral-800/20 border-neutral-800 hover:bg-neutral-800/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                        puzzle.level === 'mate1'
                          ? 'bg-green-900/30 text-green-400'
                          : puzzle.level === 'mate2'
                          ? 'bg-blue-900/30 text-blue-400'
                          : 'bg-orange-900/30 text-orange-400'
                      }`}
                    >
                      {puzzle.level === 'mate1' ? 'M1' : puzzle.level === 'mate2' ? 'M2' : 'M3'}
                    </span>
                    <span className="text-sm font-medium text-neutral-300">{puzzle.id}</span>
                  </div>
                            {result?.isCorrect ? (
                                <CheckCircle2 className="w-4 h-4 text-green-500" />
                            ) : (
                                <XCircle className="w-4 h-4 text-red-500" />
                            )}
                        </div>
                    </button>
            );
            })}
        </div>
        </div>

      {/* Right: Board + Details */}
      <div className="lg:col-span-8">
        <div className="grid md:grid-cols-2 gap-6 p-6 rounded-2xl border border-neutral-800 bg-gradient-to-br from-neutral-900/60 to-neutral-900/30">
            {/* Board */}
            <div>
                 <ChessBoard 
                    fen={selectedPuzzle.fen} 
                    orientation={selectedPuzzle.fen.includes(' w ') ? 'white' : 'black'}
                    shapes={shapes}
                    lastMove={lastMoveHighlight}
              className="rounded-lg shadow-2xl shadow-black/60"
            />
            <div className="mt-4 flex items-center justify-center gap-4 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-blue-500" />
                <span className="text-neutral-400">Opponent last move</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-green-500" />
                <span className="text-neutral-400">Correct move</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-500" />
                <span className="text-neutral-400">Model move (if wrong)</span>
              </div>
            </div>
            </div>

            {/* Info Panel */}
          <div className="flex flex-col gap-5">
                <div>
              <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Puzzle</div>
              <div className="text-2xl font-bold text-neutral-100">{selectedPuzzle.id}</div>
              {selectedPuzzle.lastMoveUci && (
                <div className="mt-2 text-xs text-neutral-500">
                  Opponent last move:{' '}
                  <span className="font-mono text-neutral-300">{selectedPuzzle.lastMoveUci}</span>
                </div>
              )}
              <div
                className={`inline-block mt-2 px-2 py-1 rounded text-xs font-bold uppercase ${
                  selectedPuzzle.level === 'mate1'
                    ? 'bg-green-900/30 text-green-400'
                    : selectedPuzzle.level === 'mate2'
                    ? 'bg-blue-900/30 text-blue-400'
                    : 'bg-orange-900/30 text-orange-400'
                }`}
              >
                {selectedPuzzle.level === 'mate1'
                  ? 'Mate in 1'
                  : selectedPuzzle.level === 'mate2'
                  ? 'Mate in 2'
                  : 'Mate in 3'}
                    </div>
                </div>

                    <div className="p-4 rounded-lg bg-green-900/10 border border-green-900/30">
              <div className="text-xs text-green-500 font-bold uppercase mb-1">Solution</div>
                        <div className="font-mono text-lg text-green-400">{uciLineToSan(selectedPuzzle.fen, selectedPuzzle.solutionUci)}</div>
                    </div>

            <div
              className={`p-4 rounded-lg border ${
                modelResult?.isCorrect
                  ? 'bg-green-900/10 border-green-900/30'
                  : 'bg-red-900/10 border-red-900/30'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div
                  className={`text-xs font-bold uppercase ${
                    modelResult?.isCorrect ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                                {selectedModel.name}
                             </div>
                {modelResult?.isCorrect ? (
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-500" />
                )}
                        </div>
              <div
                className={`font-mono text-lg ${
                  modelResult?.isCorrect ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {modelResult?.move ? uciLineToSan(selectedPuzzle.fen, modelResult.move) : 'No output'}
                        </div>
                        {!modelResult?.isCorrect && (
                <div className="mt-2 text-xs text-red-400/70">Incorrect move or format</div>
              )}
            </div>

            {modelResult?.latencyMs && (
              <div className="text-sm text-neutral-500">
                Response time: <span className="text-neutral-300">{modelResult.latencyMs}ms</span>
                            </div>
                        )}

            <div className="mt-auto pt-4 border-t border-neutral-800 text-xs text-neutral-500">
              <span className="font-mono">FEN:</span>{' '}
              <span className="text-neutral-400 break-all">{selectedPuzzle.fen}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// BENCHMARKS TAB
// ============================================================================
function BenchmarksTab({ data }: { data: BenchmarkData }) {
  const [activeChart, setActiveChart] = useState<'overall' | 'breakdown' | 'latency'>('overall');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    () => new Set(data.models.map((m) => m.id))
  );

  const modelFilterOptions = useMemo(() => {
    return [...data.models]
      .sort((a, b) => b.score - a.score)
      .map((m) => ({ id: m.id, label: m.name }));
  }, [data.models]);

  const filteredModels = useMemo(() => {
    return [...data.models]
      .filter((m) => selectedModels.has(m.id))
      .sort((a, b) => b.score - a.score);
  }, [data.models, selectedModels]);

  const overallData = useMemo(() => {
    return filteredModels.map((m) => ({
      name: m.name,
      score: Math.round(m.score * 10) / 10,
      id: m.id,
    }));
  }, [filteredModels]);

  const breakdownData = useMemo(() => {
    return filteredModels.map((m) => ({
      name: m.name,
      'Mate-1': m.breakdown.mate1,
      'Mate-2': m.breakdown.mate2,
      'Mate-3': m.breakdown.mate3,
      id: m.id,
    }));
  }, [filteredModels]);

  const latencyData = useMemo(() => {
    return filteredModels
      .filter((m) => typeof m.avgLatencyMs === 'number')
      .sort((a, b) => (a.avgLatencyMs ?? 0) - (b.avgLatencyMs ?? 0))
      .map((m) => ({
        name: m.name,
        latency: m.avgLatencyMs,
        id: m.id,
      }));
  }, [filteredModels]);

  const chartTabs = [
    { key: 'overall', label: 'Overall', icon: BarChart3 },
    { key: 'breakdown', label: 'Breakdown', icon: Target },
    { key: 'latency', label: 'Latency', icon: Clock },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      {/* Leaderboard Cards */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h2 className="text-xl font-bold">Leaderboard</h2>
                    </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...data.models]
            .sort((a, b) => b.score - a.score)
            .map((model, idx) => (
              <motion.div
                key={model.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className="p-5 rounded-xl border border-neutral-700/50 bg-neutral-800/30 hover:bg-neutral-800/50 transition-colors"
              >
                <div className="flex justify-between items-start mb-3">
                  <span
                    className={`text-2xl font-bold ${
                      idx === 0
                        ? 'text-yellow-400'
                        : idx === 1
                        ? 'text-neutral-300'
                        : idx === 2
                        ? 'text-amber-600'
                        : 'text-neutral-500'
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <div className="text-2xl font-bold text-neutral-100">{model.score.toFixed(1)}%</div>
                </div>
                <h3 className="font-semibold text-base text-neutral-200 mb-2 truncate">{model.name}</h3>
                <div className="flex gap-3 text-xs">
                  <span className="text-green-400">M1: {model.breakdown.mate1}%</span>
                  <span className="text-blue-400">M2: {model.breakdown.mate2}%</span>
                  <span className="text-orange-400">M3: {model.breakdown.mate3}%</span>
                </div>
              </motion.div>
            ))}
        </div>
      </section>

      {/* Charts Section */}
      <section className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900/50 to-neutral-900/20 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <TrendingUp className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <div className="text-lg font-semibold text-neutral-100">Performance Charts</div>
              <div className="text-xs text-neutral-500">Visual comparison across models</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Model filter dropdown */}
            <MultiSelectDropdown
              selected={selectedModels}
              options={modelFilterOptions}
              onChange={setSelectedModels}
              label="Filter models"
            />

            {/* Chart type tabs */}
            <div className="flex rounded-lg border border-neutral-700 bg-neutral-900/80 p-1 gap-1">
              {chartTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveChart(tab.key)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-all ${
                      activeChart === tab.key
                        ? 'bg-neutral-700 text-neutral-100 shadow-sm'
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="h-[400px] w-full">
          {selectedModels.size === 0 ? (
            <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
              Select at least one model to view charts
            </div>
          ) : (
            <>
              {activeChart === 'overall' && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overallData} margin={{ top: 30, right: 20, left: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#a3a3a3', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                      angle={-40}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: '#a3a3a3', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="score" name="Score (%)" radius={[6, 6, 0, 0]} maxBarSize={50}>
                      {overallData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={index === 0 ? CHART_COLORS.primary : `rgba(251, 191, 36, ${0.8 - index * 0.06})`}
                        />
                      ))}
                      <LabelList dataKey="score" content={<CustomLabel />} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}

              {activeChart === 'breakdown' && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdownData} margin={{ top: 30, right: 20, left: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fill: '#a3a3a3', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                      angle={-40}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: '#a3a3a3', fontSize: 11 }}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey="Mate-1" name="Mate-in-1 (%)" fill={BREAKDOWN_COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="Mate-2" name="Mate-in-2 (%)" fill={BREAKDOWN_COLORS[1]} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    <Bar dataKey="Mate-3" name="Mate-in-3 (%)" fill={BREAKDOWN_COLORS[2]} radius={[4, 4, 0, 0]} maxBarSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              )}

              {activeChart === 'latency' && (
                <>
                  {latencyData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
                      No latency data yet. Run{' '}
                      <code className="mx-1 px-2 py-1 rounded bg-neutral-800 text-xs">bun run bench:run</code> to populate.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={latencyData} margin={{ top: 30, right: 20, left: 20, bottom: 80 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                        <XAxis
                          dataKey="name"
                          tick={{ fill: '#a3a3a3', fontSize: 11 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          tickLine={false}
                          angle={-40}
                          textAnchor="end"
                          height={80}
                        />
                        <YAxis
                          tick={{ fill: '#a3a3a3', fontSize: 11 }}
                          axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                          tickLine={false}
                          tickFormatter={(v) => `${v}ms`}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                        <Bar dataKey="latency" name="Avg Latency (ms)" radius={[6, 6, 0, 0]} maxBarSize={50}>
                          {latencyData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={CHART_COLORS.purple} fillOpacity={0.9 - index * 0.05} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </>
              )}

            </>
          )}
        </div>

        <div className="mt-4 text-xs text-neutral-500 text-center">
          {activeChart === 'breakdown' && 'Grouped bars show accuracy for each mate depth (1, 2, 3).'}
          {activeChart === 'overall' && 'Overall score = average of mate-in-1/2/3 accuracy.'}
          {activeChart === 'latency' && 'Lower is better. Latency measured from API call to response.'}
        </div>
      </section>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
export default function BenchmarkExplorer({ data }: { data: BenchmarkData }) {
  const [activeTab, setActiveTab] = useState<'puzzles' | 'benchmarks'>('puzzles');

  const mainTabs = [
    { key: 'puzzles', label: 'Puzzles', icon: Puzzle, desc: 'See how models solved each puzzle' },
    { key: 'benchmarks', label: 'Benchmarks', icon: TrendingUp, desc: 'Leaderboard & performance charts' },
  ] as const;

  return (
    <div className="flex flex-col gap-8">
      {/* Main Tab Switcher */}
      <div className="flex justify-center">
        <div className="inline-flex rounded-xl border border-neutral-700 bg-neutral-900/80 p-1.5 gap-2">
          {mainTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-3 px-6 py-3 rounded-lg transition-all ${
                  activeTab === tab.key
                    ? 'bg-neutral-700 text-neutral-100 shadow-lg'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50'
                }`}
              >
                <Icon className="w-5 h-5" />
                <div className="text-left">
                  <div className="font-semibold text-sm">{tab.label}</div>
                  <div className="text-[10px] opacity-70">{tab.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'puzzles' && <PuzzlesTab data={data} />}
          {activeTab === 'benchmarks' && <BenchmarksTab data={data} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
