import type { ReactNode } from 'react';
import { ChatListProvider } from '@/components/chat/chat-list-provider';
import { ChatShell } from '@/components/chat/chat-shell';
import { chatShellPrefs } from './_chat-page-access';

/**
 * Every Chat route's frame (CHAT-01 items 5, 9a–9f): the chat menu beside
 * the page, hidden or shown as the person left it. While the new Chat is off
 * for the workspace (CHAT_AGENTIC) there is no frame: the pages answer as
 * they do today.
 */
export default async function ChatLayout({ children }: { children: ReactNode }) {
  const prefs = await chatShellPrefs();
  if (!prefs) return children;
  return (
    <ChatListProvider>
      <ChatShell menuOpen={prefs.menuOpen}>{children}</ChatShell>
    </ChatListProvider>
  );
}
