'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { CHAT_SETTINGS_TABS, chatSettingsTabOf } from '@/lib/chat/settings-tabs';
import { cn } from '@/lib/utils';

/**
 * Chat's Settings frame (mockup #s-settings; owner request, 16 Nov 2026):
 * the "Settings" title and its line, and the page's own left navigation,
 * General, Activity, What Chat can do and Tool policy, with the open tab
 * marked and its page on the right. Drawn once by the chat/(settings)
 * layout, so it stays while the tab under it changes. Every tab is open to
 * everyone while the new Chat is on (CHAT_SETTINGS_TABS); with it off there
 * is no frame, as the Chat layout has none, and the pages answer as they do.
 * Below 900px the navigation is a row of tabs above the page.
 */
export function ChatSettingsFrame({ children }: { children: ReactNode }) {
  const t = useTranslations('chatShell.settings');
  const tMenu = useTranslations('chatShell.menu');
  const chatAgentic = useChatAgentic();
  const current = chatSettingsTabOf(usePathname());
  if (!chatAgentic) return children;
  return (
    <div className="max-w-[1200px]">
      <div className="mb-3.5">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{t('intro')}</p>
      </div>
      <div className="flex items-start gap-6 max-[900px]:flex-col">
        <nav
          aria-label={t('title')}
          className="sticky top-0 grid w-[200px] shrink-0 gap-0.5 max-[900px]:static max-[900px]:flex max-[900px]:w-full max-[900px]:flex-wrap"
        >
          {CHAT_SETTINGS_TABS.map(({ id, href }) => {
            const active = id === current;
            return (
              <Link
                key={id}
                href={href}
                data-action="chatSettings.tab"
                data-tab={id}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-lg px-2.5 py-[7px] text-[13px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  active
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {tMenu(id)}
              </Link>
            );
          })}
        </nav>
        <div data-slot="chat-settings-tab" className="w-full min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  );
}
