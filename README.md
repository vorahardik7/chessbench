This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## ChessBench workflow (owner-run snapshots)

ChessBench is designed to publish **only the latest benchmark snapshot** (no DB). You run the benchmark locally, it regenerates `public/results/latest.json`, and you deploy/commit that file.

### 1) Configure environment

Create a local `.env` (not committed) with:

- `OPENROUTER_API_KEY=...`

### 2) Fetch puzzles from Lichess (10 per level)

This generates:

- `bench/puzzles.mate1.json`
- `bench/puzzles.mate2.json`
- `bench/puzzles.mate3.json`

Command:

```bash
bun run bench:fetch-puzzles
```

### 3) Configure models (10–15 models)

Edit:

- `bench/models.json`

You can add/remove models freely; rerun the benchmark to regenerate the snapshot.

### 4) Run benchmark (writes latest snapshot)

This generates/overwrites:

- `public/results/latest.json`

Command:

```bash
bun run bench:run
```

Optional concurrency control (default is 3):

```bash
BENCH_CONCURRENCY=3 bun run bench:run
```

### 4b) Estimate cost of the latest run

After you run the benchmark, you can estimate cost using OpenRouter model pricing + the token usage returned by the API:

```bash
bun run bench:cost
```

Notes:

- If `latest.json` was generated before token-usage fields were added, rerun `bun run bench:run` once to populate token counts.
- Pricing is fetched from OpenRouter’s model listing; it can change over time.

### 5) Publish

Commit `public/results/latest.json` and deploy (e.g. Vercel).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
