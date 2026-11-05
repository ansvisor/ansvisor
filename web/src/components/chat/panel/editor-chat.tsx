'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Maximize2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import { DRAFT_CHIP } from '@/lib/chat/editor-page';
import { PANEL_FROM_PARAM } from '@/lib/chat/panel';
import type { ChatThread } from '@/lib/chat/thread';
import { CONTENT_EDITOR_PATH, type DraftConversation } from '@/lib/content/drafts';
import { ChatActionsProvider } from '../chat-actions';
import { ChatThreadView } from '../chat-thread-view';
import { useChatPanel } from './chat-panel-context';
import { readThread } from './read-thread';

/** localStorage: the chat this browser had with a draft in the editor, by the draft. */
const EDITOR_CHAT_KEY = 'aeo:editor-chat:';

function keptChat(draftId: string): string | null {
  try {
    return localStorage.getItem(EDITOR_CHAT_KEY + draftId);
  } catch {
    return null;
  }
}

function keepChat(draftId: string, chatId: string) {
  try {
    localStorage.setItem(EDITOR_CHAT_KEY + draftId, chatId);
  } catch {
    // Storage blocked: the tab starts a new chat next time.
  }
}

type TabView =
  | { status: 'loading' }
  | { status: 'ready'; thread: ChatThread | null; continued: string | null };

/**
 * The Content Editor's Chat tab (CHAT-25 §5, CHAT-15 §A; W4-16): Chat
 * beside the page, first in the editor's side panel. A draft the member's
 * own chat made continues it ("Continued from your chat …"); any other continues
 * the one this browser had with it here, else starts one, from the panel
 * and the editor's page. The box carries the page as "This draft", so what
 * the person asks about it comes back as the Content Agent's suggestions
 * in the page, never as a change (W4-14); removing the chip stops Chat
 * editing the page. Open in full page continues the chat on Chat's page.
 */
export function EditorChat({
  draftId,
  conversation,
  onSuggestions,
}: {
  draftId: string;
  /** The chat that made the draft (00463), when Chat made it. */
  conversation: DraftConversation | null;
  /** The Content Agent left suggestions in the page: the editor reads them. */
  onSuggestions: (count: number) => void;
}) {
  const t = useTranslations('contentEditor.editor.chat');
  const panel = useChatPanel();
  const route = `${CONTENT_EDITOR_PATH}/${draftId}`;
  // The chat it opens on, read once: the draft's own when it is the member's, else the one
  // kept here. A teammate's shared chat would open read-only, so it isn't continued.
  const [opening] = useState(() => (conversation?.mine ? conversation.id : keptChat(draftId)));
  const [view, setView] = useState<TabView>(() =>
    opening ? { status: 'loading' } : { status: 'ready', thread: null, continued: null },
  );
  const [chatId, setChatId] = useState<string | null>(null);
  const [chip, setChip] = useState(true);

  useEffect(() => {
    if (!opening) return;
    let live = true;
    const id = opening;
    void readThread(id).then((read) => {
      if (!live) return;
      // A chat gone or not theirs any more (only shared): a new one.
      const own = read?.thread.mine ? read : null;
      setChatId(own ? id : null);
      setView({
        status: 'ready',
        thread: own?.thread ?? null,
        continued:
          own && conversation?.id === id
            ? own.thread.title || conversation.title || t('untitled')
            : null,
      });
    });
    return () => {
      live = false;
    };
  }, [opening, conversation, t]);

  if (!panel) return null;
  const { setup } = panel;
  if (view.status === 'loading') {
    return (
      <div className="space-y-2 p-1" aria-busy="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  return (
    <ChatActionsProvider>
      <div data-slot="editor-chat" className="flex h-full min-h-0 flex-col gap-2">
        {(view.continued || chatId) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {view.continued && (
              <span className="min-w-0 truncate" title={view.continued}>
                {t('continued', { title: view.continued })}
              </span>
            )}
            {chatId && (
              <Link
                href={`/dashboard/chat/${chatId}?${PANEL_FROM_PARAM}=${encodeURIComponent(route)}`}
                data-action="editorChat.openFull"
                aria-label={t('openFull')}
                title={t('openFull')}
                className="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted hover:text-foreground"
              >
                <Maximize2 className="size-3.5" aria-hidden />
              </Link>
            )}
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col">
          <ChatThreadView
            thread={view.thread}
            variant="panel"
            defaultMode={setup.defaultMode}
            fullAutoOpen={setup.fullAutoOpen}
            fullAutoOffByAdmin={setup.fullAutoOffByAdmin}
            onOwnKey={setup.onOwnKey}
            keyFailure={setup.keyFailure}
            usageNoticeSeen={setup.usageNoticeSeen}
            skills={setup.skills}
            onConversation={(id) => {
              setChatId(id);
              keepChat(draftId, id);
            }}
            chips={chip ? [{ key: DRAFT_CHIP, label: t('thisDraft'), value: draftId }] : []}
            onRemoveChip={(key) => {
              if (key === DRAFT_CHIP) setChip(false);
            }}
            pageRoute={route}
            placeholder={t('placeholder')}
            onSuggestions={onSuggestions}
            empty={<p className="pt-4 text-center text-sm text-muted-foreground">{t('empty')}</p>}
          />
        </div>
      </div>
    </ChatActionsProvider>
  );
}
