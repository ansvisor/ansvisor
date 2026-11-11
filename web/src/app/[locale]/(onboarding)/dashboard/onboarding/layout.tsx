import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { adsEnabled } from '@/lib/ads/flag';
import { AdsProvider } from '@/components/providers/ads-provider';

/**
 * The onboarding wizard, with whether the new Chat is on for the workspace
 * (CHAT_AGENTIC), read on the server: its dashboard preview shows Agent
 * Center only where the menu will. Before the workspace exists it is on only
 * where the flag is on for every workspace (no CHAT_AGENTIC_ORGS). And
 * whether Ads is on (ADS_ENABLED, the same for every workspace), so the
 * preview shows Ads only where the menu will.
 */
export default async function OnboardingWizardLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('profiles').select('organization_id').eq('id', user.id).maybeSingle()
    : { data: null };
  return (
    <ChatAgenticProvider enabled={chatAgenticEnabled(profile?.organization_id ?? null)}>
      <AdsProvider enabled={adsEnabled()}>{children}</AdsProvider>
    </ChatAgenticProvider>
  );
}
