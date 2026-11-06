import { DASHBOARD_HOME, landingPageFor } from '@/config/home';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { readChatStartAudience } from '@/lib/chat/start-audience';
import { createClient } from '@/lib/supabase/server';

type Reader = Awaited<ReturnType<typeof createClient>>;

/**
 * The page the organization's people land on (landingPageFor): Chat Home in
 * the free trial and the demo, with the new Chat on; else the Action
 * Center. Read as the person; a read that fails lands on the Action Center,
 * as before. Server only.
 */
export async function dashboardHomeFor(
  supabase: Reader,
  organizationId: string | null,
): Promise<string> {
  if (!organizationId) return DASHBOARD_HOME;
  const chatOn = chatAgenticEnabled(organizationId);
  if (!chatOn) return DASHBOARD_HOME;
  try {
    const audience = await readChatStartAudience(supabase, organizationId);
    return landingPageFor({ chatOn, audience });
  } catch (error) {
    console.error('[dashboard-home] could not read where the person starts:', error);
    return DASHBOARD_HOME;
  }
}

/** The signed-in person's landing page (dashboardHomeFor); the Action Center without a session. */
export async function dashboardHome(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DASHBOARD_HOME;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  return dashboardHomeFor(supabase, profile?.organization_id ?? null);
}
