'use client';

import { useCallback } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useChatPanel } from '@/components/chat/panel/chat-panel-context';
import { PANEL_FROM_PARAM } from '@/lib/chat/panel';

/**
 * Opens a chat started from the Action Center (CHAT-21 §F item 29): in the
 * side panel beside the action, else on Chat's own page, which goes back to
 * where it was started from.
 */
export function useShowChat(): (chatId: string) => void {
  const panel = useChatPanel();
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (chatId: string) => {
      if (panel?.available) {
        panel.openChat(chatId);
        return;
      }
      const from = `${pathname}${window.location.search}`;
      router.push(`/dashboard/chat/${chatId}?${PANEL_FROM_PARAM}=${encodeURIComponent(from)}`);
    },
    [panel, pathname, router],
  );
}
