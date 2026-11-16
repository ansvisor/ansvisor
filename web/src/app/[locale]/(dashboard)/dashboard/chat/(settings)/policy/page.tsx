import { notFound } from 'next/navigation';
import { ChatSettingsSection } from '@/components/chat-access/chat-settings-section';
import { chatPageOpen } from '../../_chat-page-access';

/**
 * Tool policy in Chat's Settings (owner request, 16 Nov 2026): Settings ›
 * Chat (CHAT-20 §5), the same section the app's Settings shows at
 * /dashboard/settings/chat, which stays. Its own server actions read it for
 * everyone and let only Admins change it, so the rules are the same here.
 * Only with the new Chat on for the workspace.
 */
export default async function ChatPolicyPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatSettingsSection heading="policy" />;
}
