'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

/**
 * Where the preview opens: Chat v2's Home, from the mockups kept as they are
 * under public/demo/chat (CHAT-mockup-v2*.html and their index). They link to
 * each other, so the whole preview can be clicked through inside the frame.
 */
export const CHAT_PREVIEW_SRC = '/demo/chat/CHAT-mockup-v2.html#s-home';

/**
 * Chat on the demo brand, until it ships: a thin line that it arrives next
 * week, and the Chat v2 mockups themselves, the page's full height.
 */
export function ChatSoonPreview() {
  const t = useTranslations('demo.chat');
  return (
    <div className="-m-6 flex h-[calc(100%+3rem)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2 text-sm">
        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">
          {t('soon')}
        </Badge>
        <p className="min-w-0 flex-1 text-muted-foreground">{t('note')}</p>
      </div>
      <iframe
        src={CHAT_PREVIEW_SRC}
        title={t('frameTitle')}
        sandbox="allow-scripts allow-same-origin"
        className="min-h-0 w-full flex-1 border-0 bg-background"
      />
    </div>
  );
}
