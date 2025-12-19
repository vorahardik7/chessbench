# ChessBench

A benchmark suite for evaluating Large Language Models (LLMs) on chess puzzle solving. Models are tested on mate-in-1, mate-in-2, and mate-in-3 puzzles from Lichess, with strict UCI (Universal Chess Interface) move format validation.

## Features

- **Strict UCI Format**: Models must output moves in UCI notation (e.g., `e2e4`, `g1f3`)
- **Puzzle Caching**: Results are cached per model ID - test models one at a time without losing previous results
- **Visual Interface**: Interactive web UI showing puzzle positions, model responses, and performance metrics
- **Lichess Integration**: Puzzles fetched directly from Lichess puzzle database

## Quick Start

### 1. Setup Environment

Create a `.env` file in the project root:

```bash
OPENROUTER_API_KEY=your_api_key_here
```

### 2. Fetch Puzzles

Fetch puzzles from Lichess (currently fetches 10 mate-in-1 puzzles):

```bash
bun run bench:fetch-puzzles
```

This generates:
- `bench/puzzles.mate1.json` - Mate-in-1 puzzles (currently active)
- `bench/puzzles.mate2.json` - Mate-in-2 puzzles (planned, see below)
- `bench/puzzles.mate3.json` - Mate-in-3 puzzles (planned, see below)

**Note**: Currently only mate-in-1 puzzles are tested. To enable mate-in-2 and mate-in-3:
1. Uncomment the corresponding lines in `bench/run.ts` (lines 322-323)
2. Update `bench/fetch-lichess.ts` to fetch mate2/mate3 puzzles
3. Re-run `bun run bench:fetch-puzzles`

### 3. Configure Models

Edit `bench/models.json` to add models you want to test:

```json
[
  {
    "id": "model-provider/model-name:free",
    "name": "Model Display Name",
    "temperature": 0,
    "maxTokens": 128
  }
]
```

**Model Caching**: The benchmark runner automatically caches results per model ID. If you:
- Add a new model → Only that model will be tested
- Remove a model from `models.json` → Its cached results remain visible
- Re-run with existing models → Skips models that already have complete results

### 4. Run Benchmark

Run the benchmark to test models on puzzles:

```bash
bun run bench:run
```

This generates/updates:
- `public/results/index.json` - Benchmark index + leaderboard (read by the web UI)
- `public/results/models/*.json` - One file per model containing that model's per-puzzle results

**Optional**: Control concurrency (default is 3):

```bash
BENCH_CONCURRENCY=5 bun run bench:run
```

**Re-running / caching behavior**:
- Delete `public/results/models/<model>.json` → re-runs only that model next time you run `bun run bench:run`
- Delete the entire `public/results/models/` folder → re-runs all models
- The index file is regenerated on each run based on the per-model files

### 5. View Results

Start the development server:

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000) to view:
- **Puzzles Tab**: Browse puzzles, see model responses, view board positions
- **Benchmarks Tab**: Leaderboard, performance charts (overall, breakdown, latency)

### 6. Publish

Commit `public/results/index.json` and `public/results/models/*.json` and deploy (e.g., Vercel).

## Puzzle Format

Puzzles are stored in JSON format with the following structure:

```json
{
  "id": "mate1-HR783",
  "level": "mate1",
  "fen": "8/p6p/1p6/3P2Q1/2P5/1q3p2/7k/5K2 w - - 4 55",
  "lastMoveUci": "g3h2",
  "solutionUci": "g5h4",
  "source": {
    "provider": "lichess",
    "puzzleId": "HR783",
    "url": "https://lichess.org/training/HR783",
    "themes": ["master", "oneMove", "mateIn1", "endgame", "queenEndgame"],
    "rating": 1461,
    "gameId": "IPJijxFi"
  }
}
```

**Fields**:
- `id`: Unique puzzle identifier
- `level`: Puzzle difficulty (`mate1`, `mate2`, `mate3`)
- `fen`: Position in FEN notation (position after opponent's last move)
- `lastMoveUci`: Opponent's last move in UCI format (shown on board)
- `solutionUci`: Correct solution in UCI format (space-separated for multi-move puzzles)
- `source`: Metadata from Lichess including puzzle URL, themes, and rating

**Scoring**:
- Models must output the exact UCI move sequence (case-insensitive)
- For mate-in-1: 1 move (e.g., `g5h4`)
- For mate-in-2: 3 plies (e.g., `e2h5 g7g6 h5h6`)
- For mate-in-3: 5 plies (e.g., `c1c2 c8c2 f1b1 c2c3`)

## Project Structure

```
chessbench/
├── app/                    # Next.js application
│   ├── components/        # React components
│   │   ├── BenchmarkExplorer.tsx  # Main UI
│   │   └── ChessBoard.tsx        # Chess board visualization
│   ├── page.tsx           # Home page
│   └── layout.tsx         # Root layout
├── bench/                 # Benchmark scripts
│   ├── fetch-lichess.ts   # Fetch puzzles from Lichess
│   ├── run.ts             # Run benchmarks
│   ├── models.json        # Model configurations
│   ├── puzzles.mate*.json # Puzzle datasets
│   ├── types.ts           # TypeScript types
│   └── utils.ts           # Utility functions
└── public/
    └── results/
        ├── index.json           # Benchmark index + leaderboard (generated)
        └── models/              # Per-model results (generated)
            └── *.json
```

## Workflow Details

### Model Testing Workflow

1. **First Run**: Test Model A → Results cached in `public/results/models/<modelA>.json`
2. **Second Run**: Add Model B to `models.json` → Only Model B is tested, Model A stays cached
3. **Third Run**: Remove Model A from `models.json` → Model A is no longer tested (and may disappear from the UI if not in the index)
4. **Fourth Run**: Delete `public/results/models/<modelA>.json` and re-run → Model A is tested again, results regenerated

### Puzzle Updates

If you re-fetch puzzles and puzzle IDs change:
- Old puzzle results are lost (matched by puzzle ID)
- Models retain their overall stats based on current puzzle set

## Development

### Prerequisites

- [Bun](https://bun.sh) (or Node.js 18+)
- OpenRouter API key

### Install Dependencies

```bash
bun install
```

### Available Scripts

- `bun dev` - Start development server
- `bun run bench:fetch-puzzles` - Fetch puzzles from Lichess
- `bun run bench:run` - Run benchmark tests
- `bun run lint` - Run ESLint
- `bun run build` - Build for production
- `bun start` - Start production server

## License

Private project.
