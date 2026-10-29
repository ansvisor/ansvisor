import { notFound } from 'next/navigation';
import { chatPageOpen } from './_chat-page-access';
import { ChatTestView } from './_chat-test-view';

/**
 * A plain page to try Chat's engine (C3) while the new Chat is built: a
 * message box, the run's live steps and its cards (D2). Only with the new
 * Chat on for the workspace (CHAT_AGENTIC). The real shell (W1-01) replaces it.
 */
export default async function ChatTestPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatTestView thread={null} />;
}
