import { notFound } from 'next/navigation';
import { ChatUnavailable } from '@/components/chat/chat-unavailable';
import { MarkChatRead } from '@/components/chat/mark-chat-read';
import { chatIdOf } from '@/lib/chat/conversations';
import { loadChatThread } from '@/lib/chat/thread';
import { chatPageOpen } from '../_chat-page-access';
import { ChatTestView } from '../_chat-test-view';

/**
 * A saved chat (CHAT-01 item 1): its messages, and a run still under way
 * picks up its stream. Opening it marks its result read. An unknown,
 * deleted or unshared chat says "This chat isn't available." (item 26).
 * Only with the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const id = chatIdOf((await params).id);
  const thread = id ? await loadChatThread(id) : null;
  if (!thread) return <ChatUnavailable />;
  return (
    <>
      <MarkChatRead chatId={thread.conversationId} />
      <ChatTestView thread={thread} />
    </>
  );
}
