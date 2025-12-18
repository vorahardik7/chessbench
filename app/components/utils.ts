import type { Key } from '@lichess-org/chessground/types';
import { Chess } from 'chess.js';

export function asKey(square: string): Key {
  return square as Key;
}

export function uciLineToSan(fen: string, uciLine: string): string {
  if (!uciLine.trim()) return '';
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
    return sanMoves.join(' ');
  } catch {
    return uciLine;
  }
}

