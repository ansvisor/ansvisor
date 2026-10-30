'use client';

import { useTranslations } from 'next-intl';
import type { ChatNextMove } from '@/lib/chat/events';

/**
 * Next moves under the latest answer (CHAT-07 §C, mockup `#s-done` "Next
 * moves"): a card per move, best first, fading in once the run ended
 * (CHAT-03 item 12f). A click sends its prompt as the next message; it never
 * changes anything by itself (a change still shows its card). Three across,
 * one under another where the column is narrow (the side panel).
 */
export function NextMoves({
  moves,
  onPick,
  disabled = false,
}: {
  moves: readonly ChatNextMove[];
  onPick: (move: ChatNextMove) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('chatPage');
  if (moves.length === 0) return null;
  return (
    <section
      data-slot="next-moves"
      aria-label={t('nextMoves')}
      className="mt-4 animate-in duration-300 fade-in-0 motion-reduce:animate-none"
    >
      <h3 className="mx-0.5 mt-0 mb-1.5 text-[11px] font-normal tracking-[.4px] text-muted-foreground uppercase">
        {t('nextMoves')}
      </h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
        {moves.map((move, i) => (
          <button
            key={`${i}-${move.prompt}`}
            type="button"
            data-action="nextMove.send"
            title={move.prompt}
            disabled={disabled}
            onClick={() => onPick(move)}
            className="rounded-[14px] border bg-card px-3 py-2.5 text-left text-[13px] shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-[transform,box-shadow] duration-200 ease-out outline-none [overflow-wrap:anywhere] hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            {move.label}
          </button>
        ))}
      </div>
    </section>
  );
}
