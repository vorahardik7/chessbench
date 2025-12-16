import { promises as fs } from 'fs';
import path from 'path';
import { unstable_noStore as noStore } from 'next/cache';
import BenchmarkExplorer from './components/BenchmarkExplorer';

export const dynamic = 'force-dynamic';

async function getLatestResults() {
  const filePath = path.join(process.cwd(), 'public/results/latest.json');
  try {
    const fileContents = await fs.readFile(filePath, 'utf8');
    return JSON.parse(fileContents);
  } catch (error) {
    console.error('Error reading results file:', error);
    return null;
  }
}

export default async function Home() {
  // Ensure we always read the latest JSON after running bench scripts (avoid RSC caching).
  noStore();
  const data = await getLatestResults();

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500">
        No benchmark data found. Please run the benchmark script.
      </div>
    );
  }

  if (!Array.isArray(data.models) || data.models.length === 0 || !Array.isArray(data.puzzles) || data.puzzles.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500">
        Benchmark data is incomplete. Please run <code className="mx-1 px-2 py-1 rounded bg-neutral-800 text-xs">bun run bench:run</code>.
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-200 font-sans selection:bg-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <header className="mb-12 text-center space-y-4">
          <div className="flex flex-wrap items-center justify-center gap-3 mb-4">
            <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-neutral-800 border border-neutral-700 text-sm text-neutral-400">
              <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
              {new Date(data.runAt).toLocaleDateString()}
            </div>
            <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-neutral-800/50 border border-neutral-700/50 text-xs text-neutral-500">
              <span className="font-mono text-neutral-400">{data.runId}</span>
            </div>
            <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-neutral-800/50 border border-neutral-700/50 text-xs text-neutral-500">
              {data.puzzles?.length ?? 0} puzzles
            </div>
            <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-neutral-800/50 border border-neutral-700/50 text-xs text-neutral-500">
              {data.models?.length ?? 0} models
            </div>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-transparent pb-2">
            ChessBench
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            Benchmarking Large Language Models on chess puzzles.
            <span className="text-neutral-500"> Strict UCI output. Exact match scoring.</span>
          </p>
        </header>

        {/* Main Content */}
        <BenchmarkExplorer data={data} />
      </div>
    </main>
  );
}