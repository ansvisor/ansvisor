'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { sinceMoves, sincePeriods, type SinceYouLeft } from '@/lib/chat/since';
import { LEFT_OUT_PLATFORMS } from '@/lib/mcp/why';

/**
 * Chat Home's Action Center line (CHAT-01 item 12, CHAT-09 item 3): how many
 * of the brand's open actions are due by the end of this week, overdue ones
 * included. Read as the person, so only a brand they can see counts. Behind
 * CHAT_AGENTIC. Answers as a value and never throws (#1777): a count that
 * can't be read hides the line.
 */

export type DueCountResult = { ok: true; count: number } | { ok: false };

/** The Action Center statuses still open. */
const OPEN_STATUSES = ['new', 'in_progress', 'on_hold'];

const input = z.object({
  // guid, not uuid: ids made by hand (the demo brand's) aren't RFC 4122 ones.
  brandId: z.guid(),
  /** The week's last day, YYYY-MM-DD, in the person's own time zone. */
  through: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function countDueActions(brandId: string, through: string): Promise<DueCountResult> {
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
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    if (!chatAgenticEnabled(profile?.organization_id ?? null)) return { ok: false };
    const { count, error } = await supabase
      .from('actions')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', parsed.data.brandId)
      .in('status', OPEN_STATUSES)
      .lte('due_date', parsed.data.through);
    if (error) {
      console.error('[chat-home] could not count due actions:', error.message);
      return { ok: false };
    }
    return { ok: true, count: count ?? 0 };
  } catch (error) {
    console.error('[chat-home] could not count due actions:', error);
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
