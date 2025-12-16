import { promises as fs } from "fs";
import path from "path";
import { Chess } from "chess.js";

function stripQuotes(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

/**
 * Minimal .env loader for bench scripts.
 *
 * Next.js loads `.env*` automatically for the app, but `bun run bench/*.ts` does not
 * unless you use `--env-file`. This keeps the CLI workflow aligned with the README.
 */
export async function loadDotEnv(
  absPath: string = path.join(process.cwd(), ".env"),
): Promise<void> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    const lines = raw.split(/\r?\n/g);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = stripQuotes(trimmed.slice(eq + 1));
      if (!key) continue;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // ignore missing .env
  }
}

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

/**
 * Convert UCI move to SAN notation using chess.js.
 * Returns the UCI string if conversion fails.
 */
export function uciToSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

/**
 * Convert a space-separated UCI line to SAN notation.
 */
export function uciLineToSan(fen: string, uciLine: string): string {
  if (!uciLine.trim()) return "";
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
    return sanMoves.join(" ");
  } catch {
    return uciLine;
  }
}


