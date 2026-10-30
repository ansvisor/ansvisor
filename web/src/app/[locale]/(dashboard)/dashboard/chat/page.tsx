import { notFound } from 'next/navigation';
import { ChatHome } from '@/components/chat/chat-home';
import { ChatThreadView } from '@/components/chat/chat-thread-view';
import { chatComposerSetup, chatFirstName, chatPageOpen } from './_chat-page-access';

/**
 * Chat Home (CHAT-01 items 1, 10–12; mockup #s-home): the greeting, what
 * needs the person, the Action Center line, and the composer to start a new
 * chat (W1-10…13). Only with the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatHomePage() {
  if (!(await chatPageOpen())) notFound();
  const [firstName, setup] = await Promise.all([chatFirstName(), chatComposerSetup()]);
  return (
    <>
      <ChatHome firstName={firstName} />
      <ChatThreadView thread={null} variant="home" {...setup} />
    </>
  );
}
