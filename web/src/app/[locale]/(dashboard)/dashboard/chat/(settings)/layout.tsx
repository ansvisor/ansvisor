import type { ReactNode } from 'react';
import { ChatSettingsFrame } from '@/components/chat/chat-settings-frame';

/**
 * Chat's Settings (owner request, 16 Nov 2026): General
 * (/dashboard/chat/settings), Activity (/dashboard/chat/activity), What Chat
 * can do (/dashboard/chat/capabilities) and Tool policy
 * (/dashboard/chat/policy), one route each under this layout. The title, its
 * line and the left navigation are drawn here and stay from tab to tab; only
 * the tab's own page renders on the right, reading its own data. The route
 * group leaves every address as it was.
 */
export default function ChatSettingsLayout({ children }: { children: ReactNode }) {
  return <ChatSettingsFrame>{children}</ChatSettingsFrame>;
}
