'use client';

import { useEffect, useRef, useState } from 'react';
import { Chessground } from '@lichess-org/chessground';
import { Config } from '@lichess-org/chessground/config';
import { DrawShape } from '@lichess-org/chessground/draw';

interface ChessBoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  shapes?: DrawShape[];
  lastMove?: Config['lastMove'];
  viewOnly?: boolean;
  className?: string;
}

export default function ChessBoard({
  fen,
  orientation = 'white',
  shapes = [],
  lastMove,
  viewOnly = true,
  className = '',
}: ChessBoardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<ReturnType<typeof Chessground> | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const chessgroundApi = Chessground(ref.current, {
      fen,
      orientation,
      viewOnly,
      coordinates: false, // Cleaner look for a benchmark
      drawable: {
        shapes,
        autoShapes: [],
      },
      lastMove,
      animation: {
        enabled: true,
        duration: 200,
      },
      // Disable interaction for benchmark viewer
      movable: {
        free: false,
        color: undefined,
        dests: new Map(),
      },
      premovable: {
        enabled: false,
      },
      selectable: {
        enabled: false,
      },
      highlight: {
        lastMove: true,
        check: true,
      },
    });

    setApi(chessgroundApi);

    return () => {
      chessgroundApi.destroy();
    };
  }, []); // Run once on mount

  // Update board when props change
  useEffect(() => {
    if (api) {
      api.set({
        fen,
        orientation,
        drawable: { shapes },
        lastMove,
      });
    }
  }, [fen, orientation, shapes, lastMove, api]);

  return (
    <div className={`relative w-full aspect-square ${className}`}>
      <div ref={ref} className="w-full h-full cg-wrap-brown" />
    </div>
  );
}
