import path from "path";
import type { BenchModel, LatestSnapshot, LatestSnapshotPuzzle } from "./types";
import { readJsonFile } from "./utils";

type OpenRouterModelsResponse = {
  data?: Array<{
    id: string;
    name?: string;
    pricing?: {
      prompt?: string | number; // often USD per token as string
      completion?: string | number;
    };
  }>;
};

function toNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sumTokens(puzzles: LatestSnapshotPuzzle[], modelId: string) {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let samples = 0;

  for (const p of puzzles) {
    const r: any = p.results?.[modelId];
    if (!r) continue;
    if (typeof r.promptTokens === "number") prompt += r.promptTokens;
    if (typeof r.completionTokens === "number") completion += r.completionTokens;
    if (typeof r.totalTokens === "number") total += r.totalTokens;
    samples += 1;
  }

  return { prompt, completion, total, samples };
}

async function fetchOpenRouterPricing(): Promise<Map<string, { promptPerToken?: number; completionPerToken?: number }>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey
      ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" }
      : { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Failed to fetch OpenRouter models: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as OpenRouterModelsResponse;
  const map = new Map<string, { promptPerToken?: number; completionPerToken?: number }>();
  for (const m of json.data ?? []) {
    const promptPerToken = toNum(m.pricing?.prompt);
    const completionPerToken = toNum(m.pricing?.completion);
    map.set(m.id, { promptPerToken, completionPerToken });
  }
  return map;
}

async function main() {
  const root = process.cwd();
  const models = await readJsonFile<BenchModel[]>(path.join(root, "bench/models.json"));
  const snapshot = await readJsonFile<LatestSnapshot>(path.join(root, "public/results/latest.json"));

  const pricing = await fetchOpenRouterPricing();

  let totalUsd = 0;
  console.log(`Run: ${snapshot.runId} (${snapshot.runAt})`);
  console.log(`Puzzles: ${snapshot.puzzles.length} • Models: ${models.length}`);
  console.log("");

  for (const m of models) {
    const tok = sumTokens(snapshot.puzzles as LatestSnapshotPuzzle[], m.id);
    const p = pricing.get(m.id);

    if (!p?.promptPerToken && !p?.completionPerToken) {
      console.log(`${m.name}: pricing not found for model id ${m.id}`);
      continue;
    }

    if (tok.samples === 0 || tok.total === 0) {
      console.log(`${m.name}: token usage not found in latest.json (rerun bench:run to populate usage)`);
      continue;
    }

    const modelUsd =
      (p.promptPerToken ?? 0) * tok.prompt + (p.completionPerToken ?? 0) * tok.completion;
    totalUsd += modelUsd;

    console.log(
      `${m.name}: $${modelUsd.toFixed(4)}  (prompt ${tok.prompt}, completion ${tok.completion}, total ${tok.total})`,
    );
  }

  console.log("");
  console.log(`Estimated total: $${totalUsd.toFixed(4)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


