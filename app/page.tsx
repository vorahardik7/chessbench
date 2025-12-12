import { promises as fs } from 'fs';
import path from 'path';
import BenchmarkExplorer from './components/BenchmarkExplorer';

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
  const data = await getLatestResults();

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-neutral-500">
        No benchmark data found. Please run the benchmark script.
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-900 text-neutral-200 font-sans selection:bg-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <header className="mb-16 text-center space-y-4">
          <div className="inline-flex items-center justify-center px-4 py-1.5 rounded-full bg-neutral-800 border border-neutral-700 text-sm text-neutral-400 mb-4">
            <span className="w-2 h-2 rounded-full bg-green-500 mr-2 animate-pulse"></span>
            Latest Snapshot: {new Date(data.runAt).toLocaleDateString()}
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-transparent pb-2">
            ChessBench
          </h1>
          <p className="text-xl text-neutral-400 max-w-2xl mx-auto">
            Benchmarking Large Language Models on their ability to solve chess puzzles.
            <br />
            Strict UCI output format. Exact match accuracy.
          </p>
        </header>

        {/* Main Content */}
        <BenchmarkExplorer data={data} />
      </div>
    </main>
  );
}