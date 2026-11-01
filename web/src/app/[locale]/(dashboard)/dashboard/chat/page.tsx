import { notFound } from 'next/navigation';
import { ChatHome } from '@/components/chat/chat-home';
import { ChatThreadView } from '@/components/chat/chat-thread-view';
import { ChatFocusGate } from '@/components/chat/focus-picker';
import {
  chatComposerSetup,
  chatFirstName,
  chatFocusState,
  chatPageOpen,
} from './_chat-page-access';

/**
 * Chat Home (CHAT-01 items 1, 10–12; mockup #s-home): the greeting, what
 * needs the person, "For you now" (CHAT-08 v2), and the composer to start a new
 * chat (W1-10…13). The first time, the focus picker (CHAT-24) opens in
 * their place, once. Only with the new Chat on for the workspace
 * (CHAT_AGENTIC).
 */
export default async function ChatHomePage() {
  if (!(await chatPageOpen())) notFound();
  const [firstName, setup, focus] = await Promise.all([
    chatFirstName(),
    chatComposerSetup(),
    chatFocusState(),
  ]);
  return (
    <ChatFocusGate {...focus}>
      <ChatHome firstName={firstName} />
      <ChatThreadView thread={null} variant="home" {...setup} />
    </ChatFocusGate>
  );
}
