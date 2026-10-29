import { notFound } from 'next/navigation';
import { getChatAccess } from '@/lib/actions/chat-access';
import { capabilityAreas } from '@/lib/chat/access';
import { registryCatalog } from '@/lib/chat/registry/tools';
import { CapabilitiesView } from '@/components/chat-access/capabilities-view';

/**
 * "What Chat can do" (CHAT-20 §8, mockup #g-capabilities): every tool in
 * Chat's registry, by area, with who may use it and how it is approved.
 * Built from the registry the server checks, so it can't drift from it; a
 * capability not listed isn't Chat's ("silence = never"). Only with the new
 * Chat on for the workspace.
 */
export default async function ChatCapabilitiesPage() {
  const access = await getChatAccess();
  if (!access) notFound();
  return <CapabilitiesView access={access} areas={capabilityAreas(registryCatalog())} />;
}
