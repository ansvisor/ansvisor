import { notFound } from 'next/navigation';
import { ChatHome } from '@/components/chat/chat-home';
import { ChatThreadView } from '@/components/chat/chat-thread-view';
import { ChatFocusGate } from '@/components/chat/focus-picker';
import { HomeDraftProvider } from '@/components/chat/home-draft';
import { readAgentsForYouOpen } from '@/lib/actions/agents-for-you';
import { composeText } from '@/lib/chat/compose-param';
import {
  chatComposerSetup,
  chatFirstName,
  chatFocusState,
  chatPageOpen,
  chatWelcome,
} from './_chat-page-access';

/**
 * Chat Home (CHAT-01 items 1, 10–12; mockup #s-home): the greeting, what
 * needs the person, "For you now" (CHAT-08 v2), and the composer to start a new
 * chat (W1-10…13). The first time, the focus picker (CHAT-24) opens in
 * their place, once. The free trial and the demo get the welcome card
 * above the box (00486). A person new to the workspace gets Agents for you
 * on the Default view too (owner, 2026-11-06). `?compose=` fills the box,
 * not sent (a skill's Schedule on the Skills page, W3-07). Only with the new
 * Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatHomePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string | string[] }>;
}) {
  if (!(await chatPageOpen())) notFound();
  const [firstName, setup, focus, welcome, newMember, { compose }] = await Promise.all([
    chatFirstName(),
    chatComposerSetup(),
    chatFocusState(),
    chatWelcome(),
    readAgentsForYouOpen(),
    searchParams,
  ]);
  const text = composeText(compose);
  return (
    <ChatFocusGate {...focus}>
      <HomeDraftProvider>
        <ChatHome firstName={firstName} welcome={welcome} newMember={newMember} />
        <ChatThreadView
          thread={null}
          variant="home"
          {...setup}
          draft={text ? { nonce: 1, text } : null}
        />
      </HomeDraftProvider>
    </ChatFocusGate>
  );
}
