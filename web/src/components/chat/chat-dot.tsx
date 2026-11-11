'use client';

import { MenuDot } from '@/components/layout/menu-dot';
import type { ChatListItem } from '@/lib/chat/conversations';
import type { RowDot } from '@/lib/menu-dots';
import { cn } from '@/lib/utils';

/**
 * A chat's dot in the chat menu, All chats and Agents at work, in the menu's
 * dots (menu-dots.ts): grey and pulsing while a run in it works; yellow while
 * it waits on the person (a question, an approval, the date range: the run
 * is `waiting`); green once a run finished while they were away, until they
 * open the chat (`last_read_at`); red once its last run stopped with an
 * error. None once it is seen and idle, or paused (its line says so).
 */
export function chatDotOf(chat: Pick<ChatListItem, 'state'>): RowDot | null {
  switch (chat.state) {
    case 'running':
      return { colour: 'grey', reason: 'chatRunning' };
    case 'needsYou':
      return { colour: 'yellow', reason: 'chatWaiting' };
    case 'done':
      return { colour: 'green', reason: 'chatResults' };
    case 'failed':
      return { colour: 'red', reason: 'chatFailed' };
    default:
      return null;
  }
}

/** The row's dot, in a 16px spot that stays when there is none, so the titles line up. */
export function ChatDot({
  chat,
  className,
}: {
  chat: Pick<ChatListItem, 'state'>;
  className?: string;
}) {
  const dot = chatDotOf(chat);
  return (
    <span
      data-slot="chat-dot"
      className={cn('flex size-4 shrink-0 items-center justify-center', className)}
    >
      {dot && <MenuDot dot={dot} />}
    </span>
  );
}
