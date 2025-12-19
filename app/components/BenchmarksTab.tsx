'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy,
  Target,
  BarChart3,
  Clock,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  Check,
  Filter,
} from 'lucide-react';
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
import type { ResultsIndex as BenchmarkData } from '../../bench/types';
import { getModelLogoPath } from './utils';

// ============================================================================
// CONSTANTS
// ============================================================================
const CHART_COLORS = {
  primary: '#fbbf24',
  success: '#22c55e',
  info: '#3b82f6',
  warning: '#f97316',
  purple: '#a78bfa',
};

const BREAKDOWN_COLORS = ['#22c55e', '#3b82f6', '#f97316'];

type SortDir = 'asc' | 'desc';
type SortKey = 'score' | 'name' | 'latency' | 'mate1' | 'mate2' | 'mate3';
type BenchModel = BenchmarkData['models'][number];

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <div className="flex flex-col leading-none opacity-40">
        <ChevronUp className="w-3 h-3 -mb-1" />
        <ChevronDown className="w-3 h-3" />
      </div>
    );
  }
  return dir === 'asc' ? (
    <ChevronUp className="w-3.5 h-3.5 text-yellow-400" />
  ) : (
    <ChevronDown className="w-3.5 h-3.5 text-yellow-400" />
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

function CustomLabel(props: {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  value?: number | string | null;
  [key: string]: unknown;
}) {
  const { x, y, width, value } = props;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;

  const xn = typeof x === 'number' ? x : Number(x);
  const yn = typeof y === 'number' ? y : Number(y);
  const wn = typeof width === 'number' ? width : Number(width);
  if (!Number.isFinite(xn) || !Number.isFinite(yn) || !Number.isFinite(wn)) return null;
  return (
    <text
      x={xn + wn / 2}
      y={yn - 8}
      fill="#d4d4d4"
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
    >
      {typeof value === 'number' ? value.toFixed(1) : value}
    </text>
  );
}

// Custom XAxis tick with logo - factory function to create tick with name-to-id map
function createCustomXAxisTick(nameToIdMap: Map<string, string>) {
  return function CustomXAxisTick(props: {
    x?: number;
    y?: number;
    payload?: { value?: string; [key: string]: unknown };
    [key: string]: unknown;
  }) {
    const { x, y, payload } = props;
    if (!payload || !payload.value) return null;
    
    const modelName = payload.value as string;
    const modelId = nameToIdMap.get(modelName);
    const logoPath = modelId ? getModelLogoPath(modelId) : null;
    
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    
    return (
      <g transform={`translate(${x},${y})`}>
        <g transform="rotate(-40)">
          {logoPath && (
            <image
              href={logoPath}
              x={-20}
              y={-7}
              width={14}
              height={14}
              style={{ 
                opacity: 0.9,
                filter: 'brightness(0) invert(1)',
              }}
            />
          )}
          <text
            x={logoPath ? -4 : 0}
            y={0}
            dy={16}
            fill="#a3a3a3"
            fontSize={11}
            textAnchor="end"
          >
            {modelName}
          </text>
        </g>
      </g>
    );
  };
}

// ============================================================================
// BENCHMARKS TAB
// ============================================================================
export default function BenchmarksTab({ data }: { data: BenchmarkData }) {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'overall' | 'breakdown' | 'latency'>('leaderboard');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    () => new Set(data.models.map((m) => m.id))
  );
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const modelFilterOptions = useMemo(() => {
    return [...data.models]
      .sort((a, b) => b.score - a.score)
      .map((m) => ({ id: m.id, label: m.name }));
  }, [data.models]);

  const modelsByScore = useMemo(() => {
    return [...data.models]
      .filter((m) => selectedModels.has(m.id))
      .sort((a, b) => b.score - a.score);
  }, [data.models, selectedModels]);

  const overallData = useMemo(() => {
    return modelsByScore.map((m) => ({
      name: m.name,
      score: Math.round(m.score * 10) / 10,
      id: m.id,
    }));
  }, [modelsByScore]);

  const breakdownData = useMemo(() => {
    return modelsByScore.map((m) => ({
      name: m.name,
      'Mate-1': m.breakdown.mate1,
      'Mate-2': m.breakdown.mate2,
      'Mate-3': m.breakdown.mate3,
      id: m.id,
    }));
  }, [modelsByScore]);

  const latencyData = useMemo(() => {
    return modelsByScore
      .filter((m) => typeof m.avgLatencyMs === 'number')
      .sort((a, b) => (a.avgLatencyMs ?? 0) - (b.avgLatencyMs ?? 0))
      .map((m) => ({
        name: m.name,
        latency: m.avgLatencyMs,
        id: m.id,
      }));
  }, [modelsByScore]);

  // Create name-to-id map for chart ticks
  const modelNameToIdMap = useMemo(() => {
    const map = new Map<string, string>();
    data.models.forEach((m) => {
      map.set(m.name, m.id);
    });
    return map;
  }, [data.models]);

  const CustomXAxisTickWithLogo = useMemo(
    () => createCustomXAxisTick(modelNameToIdMap),
    [modelNameToIdMap]
  );

  const tabs = [
    { key: 'leaderboard', label: 'Leaderboard', icon: Trophy },
    { key: 'overall', label: 'Overall', icon: BarChart3 },
    { key: 'breakdown', label: 'Breakdown', icon: Target },
    { key: 'latency', label: 'Latency', icon: Clock },
  ] as const;

  const leaderboardModels = useMemo(() => {
    const models = [...modelsByScore];

    const getNumeric = (m: BenchModel): number => {
      switch (sortKey) {
        case 'score':
          return m.score;
        case 'latency':
          // Put missing latency at the end when sorting asc; at the start when sorting desc.
          return typeof m.avgLatencyMs === 'number'
            ? m.avgLatencyMs
            : sortDir === 'asc'
              ? Number.POSITIVE_INFINITY
              : Number.NEGATIVE_INFINITY;
        case 'mate1':
          return m.breakdown.mate1;
        case 'mate2':
          return m.breakdown.mate2;
        case 'mate3':
          return m.breakdown.mate3;
        case 'name':
          return 0;
      }
    };

    models.sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const va = getNumeric(a);
      const vb = getNumeric(b);
      const cmp = va === vb ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : va - vb;
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return models;
  }, [modelsByScore, sortDir, sortKey]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    // sensible defaults per column
    if (key === 'name') {
      setSortDir('asc');
    } else if (key === 'latency') {
      setSortDir('asc'); // lower is better
    } else {
      setSortDir('desc'); // higher is better
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Benchmarks Section */}
      <section className="rounded-2xl border border-neutral-800 bg-gradient-to-b from-neutral-900/50 to-neutral-900/20 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <TrendingUp className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <div className="text-lg font-semibold text-neutral-100">Benchmarks</div>
              <div className="text-xs text-neutral-500">
                {activeTab === 'leaderboard'
                  ? 'Sortable leaderboard across models'
                  : 'Visual comparison across models'}
              </div>
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

            {/* Tabs */}
            <div className="flex rounded-lg border border-neutral-700 bg-neutral-900/80 p-1 gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md transition-all ${
                      activeTab === tab.key
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

        {/* Content */}
        {activeTab === 'leaderboard' && (
          <div className="w-full">
            {selectedModels.size === 0 ? (
              <div className="h-[320px] flex items-center justify-center text-neutral-500 text-sm">
                Select at least one model to view the leaderboard
              </div>
            ) : (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950/30 overflow-hidden">
                <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-neutral-800">
                  <div className="text-xs text-neutral-500">
                    Showing <span className="text-neutral-200 font-semibold">{leaderboardModels.length}</span> models
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Click headers to sort
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead className="bg-neutral-900/40">
                      <tr className="text-[11px] text-neutral-400 uppercase tracking-wider">
                        <th className="px-4 py-3 text-left font-semibold w-[72px]">Rank</th>
                        <th className="px-4 py-3 text-left font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleSort('name')}
                            className="inline-flex items-center gap-2 hover:text-neutral-200 transition-colors"
                          >
                            Model
                            <SortIcon active={sortKey === 'name'} dir={sortDir} />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right font-semibold">
                          <button
                            type="button"
                            onClick={() => toggleSort('score')}
                            className="inline-flex items-center gap-2 hover:text-neutral-200 transition-colors"
                          >
                            Accuracy
                            <SortIcon active={sortKey === 'score'} dir={sortDir} />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right font-semibold hidden md:table-cell">
                          <button
                            type="button"
                            onClick={() => toggleSort('mate1')}
                            className="inline-flex items-center gap-2 hover:text-neutral-200 transition-colors"
                          >
                            M1
                            <SortIcon active={sortKey === 'mate1'} dir={sortDir} />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right font-semibold hidden md:table-cell">
                          <button
                            type="button"
                            onClick={() => toggleSort('mate2')}
                            className="inline-flex items-center gap-2 hover:text-neutral-200 transition-colors"
                          >
                            M2
                            <SortIcon active={sortKey === 'mate2'} dir={sortDir} />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right font-semibold hidden md:table-cell">
                          <button
                            type="button"
                            onClick={() => toggleSort('mate3')}
                            className="inline-flex items-center gap-2 hover:text-neutral-200 transition-colors"
                          >
                            M3
                            <SortIcon active={sortKey === 'mate3'} dir={sortDir} />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right font-semibold hidden lg:table-cell">
                          <button
                            type="button"
                            onClick={() => toggleSort('latency')}
                            className="inline-flex items-center gap-2 hover:text-neutral-200 transition-colors"
                          >
                            Latency
                            <SortIcon active={sortKey === 'latency'} dir={sortDir} />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardModels.map((model, idx) => {
                        const rankColor =
                          idx === 0
                            ? 'text-yellow-400'
                            : idx === 1
                              ? 'text-neutral-200'
                              : idx === 2
                                ? 'text-amber-500'
                                : 'text-neutral-500';
                        return (
                          <tr
                            key={model.id}
                            className="border-t border-neutral-800/70 hover:bg-neutral-900/35 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className={`font-mono text-sm font-semibold ${rankColor}`}>#{idx + 1}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {getModelLogoPath(model.id) && (
                                  <img
                                    src={getModelLogoPath(model.id)!}
                                    alt=""
                                    className="w-5 h-5 flex-shrink-0 mr-2"
                                    style={{
                                      filter: 'brightness(0) invert(1)',
                                    }}
                                  />
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium text-neutral-200 truncate max-w-[420px]">
                                    {model.name}
                                  </div>
                                  <div className="text-[11px] text-neutral-500 font-mono truncate">{model.id}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="font-semibold text-neutral-100">{model.score.toFixed(1)}%</div>
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              <span className="inline-flex items-center justify-end px-2 py-0.5 rounded bg-green-900/20 text-green-400 text-xs font-semibold">
                                {model.breakdown.mate1}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              <span className="inline-flex items-center justify-end px-2 py-0.5 rounded bg-blue-900/20 text-blue-400 text-xs font-semibold">
                                {model.breakdown.mate2}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">
                              <span className="inline-flex items-center justify-end px-2 py-0.5 rounded bg-orange-900/20 text-orange-400 text-xs font-semibold">
                                {model.breakdown.mate3}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right hidden lg:table-cell">
                              <div className="font-mono text-sm text-neutral-200">
                                {typeof model.avgLatencyMs === 'number' ? `${model.avgLatencyMs}ms` : '—'}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab !== 'leaderboard' && (
          <div className="h-[400px] w-full">
          {selectedModels.size === 0 ? (
            <div className="h-full flex items-center justify-center text-neutral-500 text-sm">
              Select at least one model to view charts
            </div>
          ) : (
            <>
              {activeTab === 'overall' && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={overallData} margin={{ top: 30, right: 20, left: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={CustomXAxisTickWithLogo}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
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
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      <LabelList dataKey="score" content={CustomLabel as any} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}

              {activeTab === 'breakdown' && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdownData} margin={{ top: 30, right: 20, left: 20, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={CustomXAxisTickWithLogo}
                      axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                      tickLine={false}
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

              {activeTab === 'latency' && (
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
        )}

        <div className="mt-4 text-xs text-neutral-500 text-center">
          {activeTab === 'breakdown' && 'Grouped bars show accuracy for each mate depth (1, 2, 3).'}
          {activeTab === 'overall' && 'Overall score = average of mate-in-1/2/3 accuracy.'}
          {activeTab === 'latency' && 'Lower is better. Latency measured from API call to response.'}
          {activeTab === 'leaderboard' && 'Sort by accuracy, mate depth, or latency to compare models.'}
        </div>
      </section>
    </div>
  );
}

