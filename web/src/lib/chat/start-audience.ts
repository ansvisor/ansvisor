import { isCloud, isSubscriptionActive } from '@/config/plans';
import { planFactsFromOrgRow } from './plan-facts';

/**
 * The people Ansvisor starts on Chat (owner decision 2026-11-06): those new
 * to it, before they pay.
 *
 *   - `trial`: the workspace is in the free trial (plan-facts' isTrial:
 *     trialing, and not an Enterprise deal's trial).
 *   - `demo`: a workspace that never had a plan, exploring the demo brand
 *     (00380): no plan now, no Stripe subscription ever, and its demo brand
 *     shown. Onboarding's "Explore the demo" without a card.
 *
 * Everyone else: null. A paid plan, an ended or canceled one (it keeps its
 * own data, read-only) and self-hosted keep the Action Center.
 */
export type ChatStartAudience = 'trial' | 'demo';

/** The organization columns the audience reads. */
export const START_AUDIENCE_ORG_COLUMNS = 'plan, subscription_status, stripe_subscription_id';

export interface StartAudienceFacts {
  /** The organization's row with START_AUDIENCE_ORG_COLUMNS; null when it couldn't be read. */
  org: { plan?: unknown; subscription_status?: unknown; stripe_subscription_id?: unknown } | null;
  /** The organization's demo brand is there and not hidden. */
  demoShown: boolean;
}

/** Who the workspace is to Chat's start, from its row; null for everyone it doesn't start. */
export function chatStartAudience({
  org,
  demoShown,
}: StartAudienceFacts): ChatStartAudience | null {
  if (!org || !isCloud()) return null;
  if (planFactsFromOrgRow(org).isTrial) return 'trial';
  const status = typeof org.subscription_status === 'string' ? org.subscription_status : null;
  if (!isSubscriptionActive(status) && !org.stripe_subscription_id && demoShown) return 'demo';
  return null;
}

type Reader = Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>;

/**
 * The audience of the person's organization, read as them (their RLS
 * client): its plan columns, and whether its demo brand is shown. A read
 * that fails decides nothing: null.
 */
export async function readChatStartAudience(
  supabase: Reader,
  organizationId: string,
): Promise<ChatStartAudience | null> {
  if (!isCloud()) return null;
  const [org, demo] = await Promise.all([
    supabase
      .from('organizations')
      .select(START_AUDIENCE_ORG_COLUMNS)
      .eq('id', organizationId)
      .maybeSingle(),
    supabase
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', true)
      .is('demo_hidden_at', null)
      .limit(1),
  ]);
  if (org.error || demo.error) return null;
  return chatStartAudience({ org: org.data, demoShown: (demo.data ?? []).length > 0 });
}
