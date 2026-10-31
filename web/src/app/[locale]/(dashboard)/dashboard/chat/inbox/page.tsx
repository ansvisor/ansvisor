import { notFound } from 'next/navigation';
import { ChatInbox } from '@/components/chat/chat-inbox-page';
import { readDailySuggestions } from '@/lib/actions/chat-suggestions';
import { chatPageOpen } from '../_chat-page-access';

/**
 * Chat's Inbox (mockup #s-inbox): what needs the person, what their agents
 * are running, and the results they haven't opened, with their daily
 * suggestions in topic tabs (CHAT-26, mockup #d-inbox). Only with the new
 * Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatInboxPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatInbox suggestions={await readDailySuggestions()} />;
}
