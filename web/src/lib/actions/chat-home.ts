'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { chatAgenticEnabled } from '@/lib/chat/flag';

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
