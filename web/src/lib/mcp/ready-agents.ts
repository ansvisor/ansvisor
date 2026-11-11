import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import {
  presetCardHref,
  presetOnInstall,
  recommendedPresets,
  type PresetFit,
} from '@/lib/chat/agents/catalog';
import { isSiteType, siteTypeOf } from '@/lib/content/page-types';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { workAreasOf } from '@/lib/menu-access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { brandAllowed } from './data';

/**
 * Chat's list_ready_agents (AGENTS plan §3 #11, §8: "recommends 3–5 agents
 * for them on day one"): the ready-to-use agents to recommend for a brand
 * and the person asking, by Agent Center's own rule (recommendedPresets):
 * the brand's site type, as set or else guessed from its industry and
 * Shopping mode (siteTypeOf), and the person's work areas (Settings ›
 * Account). Each with its name and line as its card says them, why it
 * fits, its skills and the link to its card in Agent Center › Ready to
 * use. Only a list: nothing is created or turned on. No model, no AI
 * usage. Null for a brand outside the person's access.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatAgents' });

const FIT: Record<PresetFit, 'site_type' | 'role'> = { siteType: 'site_type', role: 'role' };

export async function listReadyAgentsFor(auth: McpAuthContext, params: { brandId: string }) {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const [brand, profile] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('site_type, industry, shopping_mode_enabled')
      .eq('id', params.brandId)
      .maybeSingle(),
    supabaseAdmin.from('profiles').select('work_areas').eq('id', auth.userId).maybeSingle(),
  ]);
  if (brand.error) throw new Error(brand.error.message);
  if (profile.error) throw new Error(profile.error.message);
  if (!brand.data) return null;

  const siteType = siteTypeOf({
    siteType: brand.data.site_type,
    industry: brand.data.industry,
    shoppingModeEnabled: brand.data.shopping_mode_enabled,
  });
  const workAreas = workAreasOf((profile.data?.work_areas as string[] | null | undefined) ?? null);
  const roleName = (role: string) => t(`ready.roles.${role}` as never);
  return {
    site_type: t(`ready.businessTypes.${siteType}`),
    // A guess until someone sets it in the brand's settings (Site type).
    site_type_set: isSiteType(brand.data.site_type),
    industry: brand.data.industry ?? null,
    work_areas: workAreas.map(roleName),
    agents: recommendedPresets({ siteType, workAreas }).map(({ preset, fit }) => ({
      name: t(`presets.${preset.id}.name` as never),
      does: t(`presets.${preset.id}.description` as never),
      // Made for the brand's site type, for one of the person's work areas, or for every brand.
      fits: fit ? FIT[fit] : 'every_brand',
      ...(fit === 'role'
        ? { for_work_areas: preset.roles.filter((r) => workAreas.includes(r)).map(roleName) }
        : {}),
      // As this install offers it: a skill behind a flag that is off isn't named.
      skills: presetOnInstall(preset).skills.map((skill) => `/${skill}`),
      href: presetCardHref(preset.id),
    })),
    turn_on:
      'The person turns an agent on themselves: Use this agent on its card, then Turn on. Never create, turn on or run one for them.',
    data_as_of: new Date().toISOString(),
  };
}
