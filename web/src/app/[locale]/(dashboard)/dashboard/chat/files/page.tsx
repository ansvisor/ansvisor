import { notFound } from 'next/navigation';
import { ChatFiles } from '@/components/chat/chat-files';
import { chatPageOpen } from '../_chat-page-access';

/**
 * Files (mockup #s-files; CHAT-06 items 12–29): everything Chat finished
 * for the workspace, with filters, Copy, Open, Download, Download selected
 * (.zip) and the storage meter. Only with the new Chat on for the workspace
 * (CHAT_AGENTIC).
 */
export default async function ChatFilesPage() {
  if (!(await chatPageOpen())) notFound();
  return <ChatFiles />;
}
