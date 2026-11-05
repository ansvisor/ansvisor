'use client';

import { useTranslations } from 'next-intl';
import { BookmarkPlus } from 'lucide-react';

/**
 * "Remember this?" under the latest answer (CHAT-14 item 9, W4-33): the
 * lasting preference the person stated, and one click that asks Chat to
 * remember it. The click only sends "Remember this: …" as their next
 * message: the Remember card (W3-12a) still opens, and nothing is saved
 * without its Save. At most once a conversation (the server decides).
 */
export function RememberThis({
  text,
  onPick,
  disabled = false,
}: {
  text: string | null;
  /** Sends the message that asks Chat to remember it. */
  onPick: (prompt: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('chatMemory.offer');
  if (!text) return null;
  return (
    <p
      data-slot="remember-this"
      className="mt-3 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] animate-in duration-300 fade-in-0 motion-reduce:animate-none"
    >
      <button
        type="button"
        data-action="rememberThis.open"
        disabled={disabled}
        onClick={() => onPick(t('prompt', { text }))}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
      >
        <BookmarkPlus className="size-3.5 text-muted-foreground" aria-hidden />
        {t('ask')}
      </button>
      <span className="min-w-0 [overflow-wrap:anywhere] text-muted-foreground">“{text}”</span>
    </p>
  );
}
