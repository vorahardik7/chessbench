'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Puzzle, TrendingUp } from 'lucide-react';
import PuzzlesTab from './PuzzlesTab';
import BenchmarksTab from './BenchmarksTab';
import type { LatestSnapshot as BenchmarkData } from '../../bench/types';

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
