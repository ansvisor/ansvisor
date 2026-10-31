'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { pageKey } from '@/lib/content/sources';
import { menuOfProfile, readRoleHidden, type MenuProfile } from '@/lib/menu-access';
import { OPEN_SIGNAL_STATUSES } from '@/lib/signals/registry';
import { sinceMoves, sincePeriods, type SinceYouLeft } from '@/lib/chat/since';
import { LEFT_OUT_PLATFORMS } from '@/lib/mcp/why';

/**
 * "For you now" on Chat Home (CHAT-08 v2, mockup #s-home `.scut`; CHAT-09
 * item 3): the counts its chips carry, for the active brand.
 *   - Complete tasks: the brand's open Action Center actions due by the end
 *     of this week, overdue ones included.
 *   - Win back citations: the pages the brand's open lost-citation signals
 *     name (their AC-001 evidence; one without evidence names none).
 *   - Ready to publish: the brand's drafts marked ready, not archived.
 * A job whose menu section an Admin took off the person's menu (Menu access,
 * 00374) isn't counted: its chip doesn't show. Read as the person, once,
 * then the counts together. Behind CHAT_AGENTIC; never throws (#1777):
 * counts that can't be read hide the chips.
 */

export type HomeShortcuts =
  | { ok: true; dueTasks: number; lostPages: number; readyDrafts: number }
  | { ok: false };

/** The Action Center statuses still open. */
const OPEN_ACTIONS = ['new', 'in_progress', 'on_hold'];

/** The menu section each job belongs to: an Admin hiding it hides the job. */
const JOB_SECTIONS = {
  dueTasks: 'action-center',
  lostPages: 'citations',
  readyDrafts: 'content',
} as const;

/** Signals read a page at a time; a brand has one per prompt at most. */
const SIGNAL_PAGE = 1000;
const MAX_SIGNAL_PAGES = 20;

const input = z.object({
  // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
  brandId: z.guid(),
  /** The week's last day, YYYY-MM-DD, in the person's own time zone. */
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** A page as the lost-citation evidence keys it (server signals/lost-citation-evidence.js). */
const pageOf = (url: string) => pageKey(/^[a-z]+:\/\//i.test(url) ? url : `https://${url.trim()}`);

type Client = Awaited<ReturnType<typeof createClient>>;

/** The pages the brand's open lost-citation signals name, a page of signals at a time. */
async function countLostPages(supabase: Client, brandId: string): Promise<number> {
  const pages = new Set<string>();
  for (let page = 0; page < MAX_SIGNAL_PAGES; page++) {
    const { data, error } = await supabase
      .from('signals')
      .select('lostUrls:payload->lostUrls')
      .eq('brand_id', brandId)
      .eq('kind', 'lost_citations')
      .in('status', [...OPEN_SIGNAL_STATUSES])
      .order('id')
      .range(page * SIGNAL_PAGE, (page + 1) * SIGNAL_PAGE - 1);
    if (error) throw new Error(`signals: ${error.message}`);
    const rows = (data ?? []) as { lostUrls: unknown }[];
    for (const { lostUrls } of rows) {
      for (const lost of Array.isArray(lostUrls) ? lostUrls : []) {
        const url = (lost as { url?: unknown } | null)?.url;
        const key = typeof url === 'string' && url.trim() ? pageOf(url) : null;
        if (key) pages.add(key);
      }
    }
    if (rows.length < SIGNAL_PAGE) break;
  }
  return pages.size;
}

async function countOf(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  what: string,
): Promise<number> {
  const { count, error } = await query;
  if (error) throw new Error(`${what}: ${error.message}`);
  return count ?? 0;
}

export async function readHomeShortcuts(brandId: string, through: string): Promise<HomeShortcuts> {
  try {
    const parsed = input.safeParse({ brandId, through });
    if (!parsed.success) return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select(
        'organization_id, role, work_areas, work_areas_asked_at, menu_shown, menu_hidden, can_manage_menus',
      )
      .eq('id', user.id)
      .maybeSingle();
    const orgId = (profile?.organization_id as string | null | undefined) ?? null;
    if (!profile || !orgId || !chatAgenticEnabled(orgId)) return { ok: false };
    const menuProfile = profile as unknown as MenuProfile;
    const roleHidden = await readRoleHidden(supabase, orgId, menuProfile.role);
    const hidden = new Set(menuOfProfile(menuProfile, roleHidden).hiddenByAdmin);
    const shown = (job: keyof typeof JOB_SECTIONS) => !hidden.has(JOB_SECTIONS[job]);

    const { brandId: brand, through: weekEnd } = parsed.data;
    const [dueTasks, lostPages, readyDrafts] = await Promise.all([
      shown('dueTasks')
        ? countOf(
            supabase
              .from('actions')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brand)
              .in('status', OPEN_ACTIONS)
              .lte('due_date', weekEnd),
            'actions',
          )
        : 0,
      shown('lostPages') ? countLostPages(supabase, brand) : 0,
      shown('readyDrafts')
        ? countOf(
            supabase
              .from('content_drafts')
              .select('id', { count: 'exact', head: true })
              .eq('brand_id', brand)
              .eq('status', 'ready')
              .is('archived_at', null),
            'content_drafts',
          )
        : 0,
    ]);
    return { ok: true, dueTasks, lostPages, readyDrafts };
  } catch (error) {
    console.error('[chat-home] could not count the shortcuts:', error);
    return { ok: false };
  }
}

/**
 * Chat Home's "Since you left" (CHAT-22 §1, mockup #s-home `.since`): the
 * brand's biggest citation drop and one win by engine, from the day the
 * person last left Home (chat_user_prefs.home_seen_at, 00420) to yesterday,
 * against as many days before. The counts come from chat_why_cells (00423)
 * as the service role, once the brand is checked to be the person's
 * workspace's, as Why did it move reads them. `since` is null before the
 * first leave, within a day of it, or with no move beyond normal swing.
 * Behind CHAT_AGENTIC; never throws (#1777): a strip that can't be read
 * isn't shown.
 */

export type SinceResult = { ok: true; since: SinceYouLeft | null } | { ok: false };

interface SinceRpcCell {
  prompt_id: string;
  platform: string | null;
  model_used: string | null;
  region: string | null;
  period: 'a' | 'b';
  runs: number;
  answers: number;
  citation_answers: number;
}

export async function readSinceYouLeft(brandId: string): Promise<SinceResult> {
  try {
    const parsed = z.guid().safeParse(brandId);
    if (!parsed.success) return { ok: false };
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false };
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    const orgId = profile?.organization_id ?? null;
    if (!orgId || !chatAgenticEnabled(orgId)) return { ok: false };
    const [prefs, brand] = await Promise.all([
      supabase.from('chat_user_prefs').select('home_seen_at').eq('user_id', user.id).maybeSingle(),
      supabase
        .from('brands')
        .select('id')
        .eq('id', parsed.data)
        .eq('organization_id', orgId)
        .maybeSingle(),
    ]);
    const failed = prefs.error ?? brand.error;
    if (failed) {
      console.error('[chat-home] could not read Since you left:', failed.message);
      return { ok: false };
    }
    if (!brand.data) return { ok: false };
    const seenAt = prefs.data?.home_seen_at ?? null;
    const periods = seenAt ? sincePeriods(seenAt, Date.now()) : null;
    if (!seenAt || !periods) return { ok: true, since: null };
    const { data, error } = await supabaseAdmin.rpc('chat_why_cells', {
      p_brand_id: parsed.data,
      p_a_from: periods.a.from,
      p_a_to: periods.a.to,
      p_b_from: periods.b.from,
      p_b_to: periods.b.to,
      // Its day series isn't used here: the shortest, one day.
      p_series_from: periods.b.to,
    });
    if (error) {
      console.error('[chat-home] could not read Since you left:', error.message);
      return { ok: false };
    }
    const cells = ((data ?? {}) as { cells?: SinceRpcCell[] }).cells ?? [];
    const moves = sinceMoves(
      cells
        .filter((cell) => !LEFT_OUT_PLATFORMS.has(cell.platform ?? ''))
        .map((cell) => ({
          key: [cell.prompt_id, cell.platform ?? '', cell.model_used ?? '', cell.region ?? ''].join(
            '|',
          ),
          engine: cell.model_used ?? cell.platform ?? 'unknown',
          period: cell.period,
          runs: Number(cell.runs) || 0,
          answers: Number(cell.answers) || 0,
          citationAnswers: Number(cell.citation_answers) || 0,
        })),
    );
    if (!moves.drop && !moves.win) return { ok: true, since: null };
    return { ok: true, since: { from: periods.b.from, seenAt, ...moves } };
  } catch (error) {
    console.error('[chat-home] could not read Since you left:', error);
    return { ok: false };
  }
}
