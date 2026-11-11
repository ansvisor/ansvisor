'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { businessHubEnabled } from '@/lib/business-hub/flag';
import { actionRefHref } from '@/lib/action-center/action-ref';

/**
 * ChatGPT Business Hub in Settings › Integrations (BUSINESS_HUB_ENABLED,
 * read here on the server each time). Business Hub has no API, so there is
 * nothing to connect: the card opens the brand's setup action, the one the
 * Action Center raises once per brand (action-center/from-business-hub.js,
 * dedup key `business_hub_setup:{brandId}`), and Visibility's numbers.
 */

const id = z.guid();

/** The Actions page's one-action path, by number ("AC-1497") or else by id (actions/[id]). */
const ACTIONS_PAGE = '/dashboard/action-center/actions';

export type BusinessHubSetupRead =
  /** The flag is off: the card isn't there. */
  | { enabled: false }
  | {
      enabled: true;
      /** The address that opens the brand's setup action; null when it has none (or no brand). */
      actionHref: string | null;
      /** The setup action couldn't be looked up. */
      failed: boolean;
    };

/**
 * Whether Business Hub's card shows, and the brand's setup action, looked up
 * by its dedup key with the person's own access (any status: the server
 * raises it once per brand and never again). The newest, should there be
 * more than one. Off, nothing is read.
 */
export async function readBusinessHubSetup(brandId: string | null): Promise<BusinessHubSetupRead> {
  if (!businessHubEnabled()) return { enabled: false };
  if (brandId === null) return { enabled: true, actionHref: null, failed: false };
  if (!id.safeParse(brandId).success) return { enabled: true, actionHref: null, failed: true };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('actions')
      .select('id, action_no')
      .eq('brand_id', brandId)
      .eq('dedup_key', `business_hub_setup:${brandId}`)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return { enabled: true, actionHref: null, failed: true };
    const action = data?.[0];
    if (!action) return { enabled: true, actionHref: null, failed: false };
    const href =
      (action.action_no ? actionRefHref(String(action.action_no)) : null) ??
      `${ACTIONS_PAGE}/${encodeURIComponent(action.id)}`;
    return { enabled: true, actionHref: href, failed: false };
  } catch {
    return { enabled: true, actionHref: null, failed: true };
  }
}
