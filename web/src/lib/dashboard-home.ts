import {
  DASHBOARD_HOME,
  INSIGHTS_HOME,
  TODAY_HOME,
  landingPageFor,
  startsOnInsights,
} from '@/config/home';
import { isCloud } from '@/config/plans';
import { TRIAL_DAYS } from '@/lib/billing/trial';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { simpleNavEnabled } from '@/lib/simple-nav/flag';
import {
  menuOfProfile,
  menuSectionOf,
  menuSectionsFor,
  readRoleHidden,
  type MenuProfile,
} from '@/lib/menu-access';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types';

type Reader = Awaited<ReturnType<typeof createClient>>;

/**
 * Chat's section of the left menu: its menu item is /dashboard/agent, which
 * opens the new Chat where it is on. Menu access and work areas hide it by
 * this name.
 */
export const CHAT_MENU_SECTION = menuSectionOf('/dashboard/agent') as string;

/** Insights' section of the left menu (Visibility): menu access and work areas hide it by this name. */
export const INSIGHTS_MENU_SECTION = menuSectionOf(INSIGHTS_HOME) as string;

/**
 * The profile columns the landing page reads: the organization, the
 * person's menu, and their time zone (a trial's second day starts at their
 * midnight).
 */
export const LANDING_PROFILE_COLUMNS =
  'organization_id, role, work_areas, work_areas_asked_at, menu_shown, menu_hidden, can_manage_menus, time_zone';

/** The person's profile row, with LANDING_PROFILE_COLUMNS. */
export type LandingProfile = Omit<MenuProfile, 'role'> & {
  organization_id: string | null;
  role: string | null;
  time_zone?: string | null;
};

/**
 * Whether the organization starts on Insights (startsOnInsights): its plan
 * is active (one set to cancel at the period's end too), or its free trial
 * is past its first day; not a payment due, an ended or canceled plan. Read
 * as the person (members read their organization's row); a read that fails
 * counts as not, so the person lands where they did.
 */
async function insightsWorkspace(
  supabase: Reader,
  organizationId: string,
  timeZone: string | null,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('organizations')
      .select('subscription_status, subscription_ends_at')
      .eq('id', organizationId)
      .maybeSingle();
    if (error) throw error;
    return startsOnInsights({
      status: data?.subscription_status as string | null | undefined,
      periodEnd: data?.subscription_ends_at as string | null | undefined,
      timeZone,
      trialDays: TRIAL_DAYS,
    });
  } catch (error) {
    console.error('[dashboard-home] could not read the plan; starting as unpaid:', error);
    return false;
  }
}

/**
 * The page the person lands on (landingPageFor). With the simplified layout
 * on (SIMPLE_NAV): Action Center › Today for everyone, read from nothing,
 * since the Action Center is on every menu and no plan changes it.
 * Otherwise, on Ansvisor Cloud:
 * Insights for a paid workspace, or a free trial past its first day, while
 * Insights is on their menu; else Chat
 * Home while the new Chat is on for their workspace and on their menu; else
 * the Action Center. Their menu is the one the left menu shows
 * (menuOfProfile): an Admin's menu access for their role or for them, and
 * their work areas. Read as the person; a plan that can't be read counts as
 * unpaid, and a menu that can't be read lands on the Action Center. Server
 * only.
 */
export async function dashboardHomeFor(
  supabase: Reader,
  profile: LandingProfile | null,
): Promise<string> {
  if (simpleNavEnabled()) return TODAY_HOME;
  const organizationId = profile?.organization_id ?? null;
  if (!profile || !organizationId || !isCloud()) return DASHBOARD_HOME;
  const chatOn = chatAgenticEnabled(organizationId);
  try {
    const role = (profile.role ?? 'analyst') as UserRole;
    // The plan and the role's menu at once: either may decide the page.
    const [onInsights, roleHidden] = await Promise.all([
      insightsWorkspace(supabase, organizationId, profile.time_zone ?? null),
      readRoleHidden(supabase, organizationId, role),
    ]);
    const menu = menuOfProfile({ ...profile, role }, roleHidden, menuSectionsFor(chatOn));
    return landingPageFor({
      chatOn,
      chatHidden: menu.hidden.includes(CHAT_MENU_SECTION),
      onInsights,
      insightsHidden: menu.hidden.includes(INSIGHTS_MENU_SECTION),
    });
  } catch (error) {
    console.error('[dashboard-home] could not read where the person starts:', error);
    return DASHBOARD_HOME;
  }
}

/**
 * The signed-in person's landing page (dashboardHomeFor); the Action Center
 * without a session (Today with SIMPLE_NAV on, read from nothing).
 */
export async function dashboardHome(): Promise<string> {
  if (simpleNavEnabled()) return TODAY_HOME;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return DASHBOARD_HOME;
  const { data: profile } = await supabase
    .from('profiles')
    .select(LANDING_PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();
  return dashboardHomeFor(supabase, (profile as LandingProfile | null) ?? null);
}
