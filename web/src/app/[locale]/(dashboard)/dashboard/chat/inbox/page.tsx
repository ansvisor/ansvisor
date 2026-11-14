import { notFound } from 'next/navigation';
import { ChatInbox } from '@/components/chat/chat-inbox-page';
import { readChatNotices } from '@/lib/actions/chat-notices';
import { readOutsideEmails } from '@/lib/actions/chat-outbound';
import { readDailySuggestions } from '@/lib/actions/chat-suggestions';
import { chatPageOpen } from '../_chat-page-access';

/**
 * Approve all (lib/actions/chat-approve-all.ts) makes each change in this
 * page's request, and its runs go on in that request's background: a server
 * action gets its page's time, so the Inbox gets the run routes' 300 s
 * (RUN_REQUEST_MS), as POST /api/chat/runs/{id}/approve has. Never set in the
 * 'use server' file itself: it exports async functions only (#2347).
 */
export const maxDuration = 300;

/**
 * Chat's Inbox (mockup #s-inbox): what needs the person, what their agents
 * are running, and the results they haven't opened, with their daily
 * suggestions in topic tabs (CHAT-26, mockup #d-inbox), and an Admin's
 * notices when the workspace's own AI key fails (00441) at the top of Needs
 * you, then their jobs' e-mails to people outside the workspace waiting for
 * a Send (W4-28). Only with the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatInboxPage() {
  if (!(await chatPageOpen())) notFound();
  const [suggestions, notices, outside] = await Promise.all([
    readDailySuggestions(),
    readChatNotices(),
    readOutsideEmails(),
  ]);
  return <ChatInbox suggestions={suggestions} notices={notices} outside={outside} />;
}
