'use client';

import { lazy, Suspense } from 'react';
import type { ChatScheduleMade } from '@/lib/chat/events';

/**
 * The card itself, loaded once there is one to show: its Run it now is a
 * server action, which the thread's other cards don't need.
 */
const ScheduleMadeCard = lazy(() =>
  import('./schedule-made-card').then((card) => ({ default: card.ScheduleMadeCard })),
);

/**
 * Each piece of recurring work a run set up, as its card under the answer
 * (schedule-made-card.tsx); nothing without one.
 */
export function ScheduleMadeCards({ cards }: { cards: readonly ChatScheduleMade[] }) {
  if (cards.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {cards.map((made, i) => (
        <ScheduleMadeCard key={`${made.href}-${i}`} made={made} />
      ))}
    </Suspense>
  );
}
