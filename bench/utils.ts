import { promises as fs } from "fs";
import path from "path";

export async function readJsonFile<T>(absPath: string): Promise<T> {
  const txt = await fs.readFile(absPath, "utf8");
  return JSON.parse(txt) as T;
}

export async function writeJsonFile(absPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function uniqBy<T>(arr: T[], keyFn: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const k = keyFn(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export async function asyncPool<T, R>(
  concurrency: number,
  items: readonly T[],
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]!, idx);
    }
  });

  await Promise.all(workers);
  return results;
}


