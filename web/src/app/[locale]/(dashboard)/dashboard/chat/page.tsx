import { notFound } from 'next/navigation';
import { ChatHome } from '@/components/chat/chat-home';
import { chatFirstName, chatPageOpen } from './_chat-page-access';
import { ChatTestView } from './_chat-test-view';

/**
 * Chat Home (CHAT-01 items 1, 10–12; mockup #s-home): the greeting, what
 * needs the person, the Action Center line, and the composer to start a new
 * chat. Only with the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatHomePage() {
  if (!(await chatPageOpen())) notFound();
  return (
    <>
      <ChatHome firstName={await chatFirstName()} />
      <ChatTestView thread={null} />
    </>
  );
}
