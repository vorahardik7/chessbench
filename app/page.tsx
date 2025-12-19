import { promises as fs } from 'fs';
import path from 'path';
import { unstable_noStore as noStore } from 'next/cache';
import BenchmarkExplorer from './components/BenchmarkExplorer';
import { Analytics } from "@vercel/analytics/next"

export const dynamic = 'force-dynamic';

async function getLatestResults() {
  const filePath = path.join(process.cwd(), 'public/results/index.json');
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
      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 xl:px-12 py-12">
        {/* Header */}
        <header className="mb-12 text-center space-y-4">
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-transparent pb-2">
            ChessBench
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto">
            Benchmarking Large Language Models on chess puzzles.
          </p>
        </header>

        <Analytics />

        {/* Main Content */}
        <BenchmarkExplorer data={data} />
      </div>
    </main>
  );
}