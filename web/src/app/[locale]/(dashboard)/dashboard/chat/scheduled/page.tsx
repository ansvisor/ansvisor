import { notFound } from 'next/navigation';
import { ScheduledList } from '@/components/chat/scheduled/scheduled-list';
import { listChatSchedules } from '@/lib/actions/chat-schedules';
import { chatPageOpen } from '../_chat-page-access';

/**
 * Scheduled (mockup #s-sched; CHAT-12 items 21–25; W3-03): the work Chat
 * does on a date or on repeat, the person's own and, for an Admin, the
 * workspace's, with the agents' Schedule triggers beside them. Only with
 * the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatScheduledPage() {
  if (!(await chatPageOpen())) notFound();
  return <ScheduledList initial={await listChatSchedules()} />;
}
