import { notFound } from 'next/navigation';
import { ChatMemory } from '@/components/chat/chat-memory';
import { chatPageOpen } from '../_chat-page-access';

/**
 * Memory (CHAT-14 items 21–25; W3-12b), from the chat header's ⋯: what Chat
 * remembers between chats, by Me, Brand and Workspace, with "Use memory".
 * Only with the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatMemoryPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatMemory />;
}
