'use server';

import { z } from 'zod';
import type { TeamRole } from '@/components/providers/role-provider';
import { canWriteAgents } from '@/lib/chat/agent-rules';
import {
  agentsForYou,
  agentsForYouOpen,
  joinedAt,
  type AgentForYou,
} from '@/lib/chat/agents-for-you';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { siteTypeOf } from '@/lib/content/page-types';
import { workAreasOf } from '@/lib/menu-access';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/**
 * "Agents for you" on Chat Home (AGENTS plan §8 and #11, its new member
 * half; lib/chat/agents-for-you.ts): for the active brand, the ready-to-use
 * agents that fit its site type and the person's own work areas, while the
 * section is open for them: they answered or skipped Your work areas, they
 * joined the workspace in the last 14 days (the invitation they accepted,
 * read as the service role since only Admins read invitations; else, for
 * whoever made the workspace, when their account was made), and they
 * haven't hidden it (00483). `canTurnOn`: they may turn an agent on (Admins
 * and Managers, CHAT-21 §K item 51); everyone else asks their Admin.
 * Read as the person otherwise. No AI is used. Behind CHAT_AGENTIC; never
 * throws (#1777): a section that can't be read isn't shown.
 */

export type AgentsForYouResult =
  | { ok: true; agents: AgentForYou[]; canTurnOn: boolean }
  | { ok: false };

interface Profile {
  organization_id: string | null;
  role: TeamRole;
  work_areas: string[] | null;
  work_areas_asked_at: string | null;
  created_at: string | null;
}

export async function readAgentsForYou(brandId: string): Promise<AgentsForYouResult> {
  try {
    // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
    const parsed = z.guid().safeParse(brandId);
    if (!parsed.success) return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data, error } = await supabase
      .from('profiles')
      .select('organization_id, role, work_areas, work_areas_asked_at, created_at')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw new Error(`profiles: ${error.message}`);
    const profile = data as Profile | null;
    const orgId = profile?.organization_id ?? null;
    if (!profile || !orgId || !chatAgenticEnabled(orgId)) return { ok: false };
    const canTurnOn = canWriteAgents(profile.role);
    const none: AgentsForYouResult = { ok: true, agents: [], canTurnOn };
    // Asked first: the section waits for Your work areas, answered or skipped.
    if (!profile.work_areas_asked_at) return none;

    const email = user.email?.trim().toLowerCase() ?? '';
    const [prefs, invitation, brand] = await Promise.all([
      supabase
        .from('chat_user_prefs')
        .select('agents_for_you_dismissed_at')
        .eq('user_id', user.id)
        .maybeSingle(),
      email
        ? supabaseAdmin
            .from('invitations')
            .select('accepted_at')
            .eq('organization_id', orgId)
            .eq('email', email)
            .eq('status', 'accepted')
            .order('accepted_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      supabase
        .from('brands')
        .select('site_type, industry, shopping_mode_enabled')
        .eq('id', parsed.data)
        .eq('organization_id', orgId)
        .maybeSingle(),
    ]);
    const failed = prefs.error ?? invitation.error ?? brand.error;
    if (failed) throw new Error(failed.message);
    if (!brand.data) return { ok: false };

    const open = agentsForYouOpen({
      workAreasAskedAt: profile.work_areas_asked_at,
      joinedAt: joinedAt(
        (invitation.data as { accepted_at: string | null } | null)?.accepted_at,
        profile.created_at,
      ),
      dismissedAt:
        (prefs.data as { agents_for_you_dismissed_at: string | null } | null)
          ?.agents_for_you_dismissed_at ?? null,
      now: Date.now(),
    });
    if (!open) return none;
    const site = brand.data as {
      site_type: string | null;
      industry: string | null;
      shopping_mode_enabled: boolean | null;
    };
    const agents = agentsForYou({
      siteType: siteTypeOf({
        siteType: site.site_type,
        industry: site.industry,
        shoppingModeEnabled: site.shopping_mode_enabled === true,
      }),
      workAreas: workAreasOf(profile.work_areas),
    });
    return { ok: true, agents, canTurnOn };
  } catch (error) {
    console.error('[agents-for-you] could not read Agents for you:', error);
    return { ok: false };
  }
}
