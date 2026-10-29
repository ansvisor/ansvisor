import { notFound } from 'next/navigation';
import { loadChatThread } from '@/lib/chat/thread';
import { chatPageOpen } from '../_chat-page-access';
import { ChatTestView } from '../_chat-test-view';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A saved chat on the engine's test page; a run still under way picks up its stream. */
export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id) || !(await chatPageOpen())) notFound();
  const thread = await loadChatThread(id);
  if (!thread) notFound();
  return <ChatTestView thread={thread} />;
}
