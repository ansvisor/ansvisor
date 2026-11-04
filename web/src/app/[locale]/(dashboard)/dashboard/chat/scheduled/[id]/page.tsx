import { notFound } from 'next/navigation';
import { ScheduleDetail } from '@/components/chat/scheduled/schedule-detail';
import { getChatSchedule } from '@/lib/actions/chat-schedules';
import { chatPageOpen } from '../../_chat-page-access';

/**
 * A scheduled job's page (CHAT-12 items 23–24; W3-03): edit it, Run now,
 * Delete, and its last 20 runs. Only a job the person may see; only with
 * the new Chat on for the workspace (CHAT_AGENTIC).
 */
export default async function ChatSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const detail = await getChatSchedule((await params).id);
  if (!detail) notFound();
  return <ScheduleDetail initial={detail} />;
}
