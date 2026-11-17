import { DASHBOARD_HOME, homeFor } from '@/config/home';
import { getMyMenu } from '@/lib/actions/menu-access';

/**
 * The signed-in person's home (homeFor), by their menu as the sidebar reads
 * it (getMyMenu: their organization's menu for their role, their own
 * exceptions and work areas): Tracked Prompts, or Action Center › Today when
 * Prompts is off their menu. Without a person or an organization to read,
 * the default home: the dashboard's layout sends them on from there.
 * Server only.
 */
export async function readMyHome(): Promise<string> {
  try {
    return homeFor((await getMyMenu()).hidden);
  } catch {
    return DASHBOARD_HOME;
  }
}
