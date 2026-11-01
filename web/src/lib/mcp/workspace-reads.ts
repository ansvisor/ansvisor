import { allowedBrands, brandAccessFor } from '@/lib/brand-access';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberEmails } from '@/lib/member-emails';
import { readPrecedenceContext } from '@/lib/chat/precedence-context';
import { planCardOf } from '@/lib/chat/access';
import { planFactsOf } from './chat-facts';

/**
 * Chat's workspace reads (CHAT-20 §9 rows 5, 8, 9 and 10): the team, what
 * is connected, Chat's policy and the plan's facts, for the caller's
 * organization. Nothing secret leaves: e-mails for Admins only (§4a), only
 * the person's own API keys' names (as Settings › API Keys shows them), no
 * key, token or credential, no AI budget in dollars (DECISIONS R). Each
 * answers `data_as_of`; these are live, so it is now. Null without an
 * organization.
 */

const now = () => new Date().toISOString();

export async function listMembersFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, role')
    .eq('organization_id', auth.organizationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const emails = auth.role === 'admin' ? await readMemberEmails(rows.map((r) => r.id)) : null;
  return {
    members: rows.map((row) => ({
      name: row.full_name?.trim() || null,
      role: row.role,
      // Every member uses every brand of the workspace for now (P0 decision 7).
      brand_access: 'all' as const,
      is_you: row.id === auth.userId,
      ...(emails ? { email: emails.get(row.id) ?? null } : {}),
    })),
    data_as_of: now(),
  };
}

/** What is connected, per brand for the brands the person may use (BRAND-ACCESS). */
export async function listConnectionsFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const orgId = auth.organizationId;
  const [integrations, brands, aiKeys, access] = await Promise.all([
    supabaseAdmin
      .from('integration_connections')
      .select('provider, status')
      .eq('organization_id', orgId),
    supabaseAdmin
      .from('brands')
      .select('id, name, gsc_property, ga_property_id')
      .eq('organization_id', orgId),
    supabaseAdmin
      .from('organization_ai_keys')
      .select('provider, active')
      .eq('organization_id', orgId),
    brandAccessFor(auth),
  ]);
  for (const read of [integrations, brands, aiKeys]) {
    if (read.error) throw new Error(read.error.message);
  }
  const brandRows = allowedBrands(access, brands.data ?? []);
  const [cms, keys] = await Promise.all([
    brandRows.length
      ? supabaseAdmin
          .from('brand_cms_connections')
          .select('brand_id, provider, status, site_name')
          .in(
            'brand_id',
            brandRows.map((b) => b.id),
          )
      : { data: [], error: null },
    // The person's own keys, as Settings › API Keys lists them: never a teammate's.
    supabaseAdmin
      .from('api_keys')
      .select('name, last_used_at')
      .eq('user_id', auth.userId)
      .is('revoked_at', null),
  ]);
  if (cms.error) throw new Error(cms.error.message);
  if (keys.error) throw new Error(keys.error.message);
  const brandName = new Map(brandRows.map((b) => [b.id, b.name]));
  return {
    integrations: (integrations.data ?? []).map((row) => ({
      provider: row.provider,
      status: row.status,
    })),
    google: brandRows.map((b) => ({
      brand: b.name,
      search_console: Boolean(b.gsc_property),
      analytics: Boolean(b.ga_property_id),
    })),
    cms: (cms.data ?? []).map((row) => ({
      brand: brandName.get(row.brand_id) ?? null,
      provider: row.provider,
      status: row.status,
      site: row.site_name,
    })),
    // The person's own keys and when they were used: never their values (§8b).
    your_api_keys: (keys.data ?? []).map((row) => ({
      name: row.name,
      last_used_at: row.last_used_at,
    })),
    ai_providers: (aiKeys.data ?? []).map((row) => ({
      provider: row.provider,
      active: row.active,
    })),
    data_as_of: now(),
  };
}

export async function getChatPolicyFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const [ctx, row] = await Promise.all([
    readPrecedenceContext({
      userId: auth.userId,
      organizationId: auth.organizationId,
      mode: 'ask_first',
      surface: 'chat',
    }),
    supabaseAdmin
      .from('chat_settings')
      .select('updated_at')
      .eq('organization_id', auth.organizationId)
      .maybeSingle(),
  ]);
  if (row.error) throw new Error(row.error.message);
  if (!ctx) return null;
  return {
    role: ctx.role,
    // Full auto and "Don't ask again" need Growth and up (§7).
    full_auto_in_plan: ctx.plan.fullAuto,
    full_auto_for_members: ctx.settings.fullAutoForMembers,
    dont_ask_again: ctx.settings.dontAskAgain,
    manager_execute_off: [...ctx.settings.managerExecuteOff],
    // An Admin's policy per tool, by label key; a tool not named keeps its default.
    tool_policies: { ...ctx.settings.toolPolicies },
    your_auto_choices: [...ctx.autoChoices],
    data_as_of: row.data?.updated_at ?? null,
  };
}

/** The plan limits a person may read: counts, never a dollar budget. */
const LIMIT_KEYS = [
  'maxBrands',
  'maxPrompts',
  'maxPlatforms',
  'maxTeamMembers',
  'maxDomainsPerBrand',
  'maxSiteAudits',
  'maxOpportunitiesPerMonth',
] as const;

export async function getPlanFactsFor(auth: McpAuthContext) {
  if (!auth.organizationId) return null;
  const facts = await planFactsOf(auth.organizationId);
  return {
    plan_id: facts.planId,
    plan_name: facts.planName,
    self_hosted: facts.selfHosted,
    is_trial: facts.isTrial,
    writable: facts.writable,
    full_auto: facts.fullAuto,
    features: [...facts.features],
    // -1 means no limit.
    limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, facts.limits[key]])),
    card: planCardOf(facts),
    data_as_of: now(),
  };
}
