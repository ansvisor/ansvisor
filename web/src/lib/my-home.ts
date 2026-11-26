import { DASHBOARD_HOME, homeFor } from '@/config/home';
import { getMyMenu } from '@/lib/actions/menu-access';
import { createClient } from '@/lib/supabase/server';

/**
 * Whether the person's workspace has any answer yet: one row of
 * prompt_results of the brands their own client can read. By brand id, so
 * it reads prompt_results' brand index: left to row-level security alone it
 * scanned the whole table where there is none (7.45 s on production). A
 * read that fails reads as none: Tracked Prompts, never an empty Overview.
 */
async function hasAnyResults(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: brands, error: brandsError } = await supabase.from('brands').select('id');
    const ids = (brands ?? []).map((brand) => brand.id);
    if (brandsError || ids.length === 0) return false;
    const { data, error } = await supabase
      .from('prompt_results')
      .select('id')
      .in('brand_id', ids)
      .limit(1);
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * The signed-in person's home (homeFor), by their menu as the sidebar reads
 * it (getMyMenu: their organization's menu for their role, their own
 * exceptions and work areas) and whether their workspace has answers yet:
 * Brand Visibility's Overview once it has, else Tracked Prompts, else Action
 * Center › Today when neither is on their menu. A first run under way
 * (`firstRun`, a ?jobId= from setup) always opens Tracked Prompts, where its
 * progress is. Without a person or an organization to read, the default
 * home: the dashboard's layout sends them on from there. Server only.
 */
export async function readMyHome({
  firstRun = false,
}: { firstRun?: boolean } = {}): Promise<string> {
  try {
    const [menu, hasResults] = await Promise.all([
      getMyMenu(),
      firstRun ? Promise.resolve(false) : hasAnyResults(),
    ]);
    return homeFor(menu.hidden, { hasResults });
  } catch {
    return DASHBOARD_HOME;
  }
}
