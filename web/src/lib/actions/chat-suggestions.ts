'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import { parseTeamRole } from '@/lib/chat/precedence';
import { assertWritable, SUBSCRIPTION_INACTIVE } from '@/lib/subscription-guard';
import {
  feedsState,
  parseSuggestionSummary,
  roleFeed,
  shownSince,
  type DailySuggestion,
  type DailySuggestionsRead,
} from '@/lib/chat/daily-suggestions';

/**
 * Daily suggestions in Chat's Inbox (CHAT-26 §2.2, §2.4, §5, §6), behind
 * CHAT_AGENTIC. The person reads their own suggestions and feeds through
 * their session (00422's policies: their own, in the workspace they belong
 * to now). Every write is the server's (00422 grants members select only):
 * these write with the service role, each on the person's own rows only,
 * after the plan check, so a read-only workspace keeps its list and changes
 * nothing. Answers as values and never throws (#1777).
 *
 * Seeing a suggestion marks it seen, which is no use of it: only opening one
 * keeps the feed's last_used_at, which the nightly job's 30-day pause counts
 * from. Turning the feeds on or off only changes their status: the job's
 * "first one the next morning" reads the update's time (updated_at).
 */

export type SuggestionsFailure = 'chat_off' | 'read_only' | 'not_allowed' | 'not_found' | 'failed';

export type SuggestionsReadResult =
  | { ok: true; read: DailySuggestionsRead }
  | { ok: false; failure: 'chat_off' | 'failed' };

export type SuggestionsWriteResult = { ok: true } | { ok: false; failure: SuggestionsFailure };

export type SuggestionsStartResult =
  | { ok: true; made: number }
  | { ok: false; failure: SuggestionsFailure };

/** The suggestions a read lists at most: 7 a week per brand. */
const LIST_MAX = 100;

const idSchema = z.guid();
const idsSchema = z.array(z.guid()).min(1).max(LIST_MAX);

interface Person {
  client: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  orgId: string;
  role: ReturnType<typeof parseTeamRole>;
}

/** The signed-in person with the new Chat on for their workspace, or null. */
async function chatPerson(): Promise<Person | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;
  const { data: profile } = await client
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id ?? null;
  if (!orgId || !chatAgenticEnabled(orgId)) return null;
  return { client, userId: user.id, orgId, role: parseTeamRole(profile?.role) };
}

/** The plan check's refusal as a result: read_only while the workspace is, else failed. */
function refusal(error: unknown): { ok: false; failure: SuggestionsFailure } {
  const code = (error as { code?: unknown } | null)?.code;
  return { ok: false, failure: code === SUBSCRIPTION_INACTIVE.code ? 'read_only' : 'failed' };
}

function logFailure(what: string, error: unknown) {
  const message = error instanceof Error ? error.message : (error as { message?: string })?.message;
  console.error(`[chat-suggestions] could not ${what}:`, message ?? error);
}

interface SuggestionRow {
  id: string;
  brand_id: string;
  action_id: string;
  sent_on: string;
  sent_at: string;
  seen_at: string | null;
  opened_at: string | null;
  started_at: string | null;
  started_via: string | null;
  summary: unknown;
}

function toSuggestion(row: SuggestionRow): DailySuggestion {
  return {
    id: row.id,
    brandId: row.brand_id,
    actionId: row.action_id,
    sentOn: row.sent_on,
    sentAt: row.sent_at,
    seenAt: row.seen_at,
    openedAt: row.opened_at,
    startedAt: row.started_at,
    startedVia: row.started_via === 'chat' || row.started_via === 'editor' ? row.started_via : null,
    summary: parseSuggestionSummary(row.summary),
  };
}

/**
 * The person's daily suggestions for the Inbox: their feeds as one state and
 * the last 7 days' suggestions they haven't removed, newest first. An
 * Analyst gets none (§6), and nothing is read for them.
 */
export async function readDailySuggestions(): Promise<SuggestionsReadResult> {
  try {
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    const feed = roleFeed(me.role);
    if (feed === 'never')
      return { ok: true, read: { roleFeed: feed, state: 'none', suggestions: [] } };
    const [feeds, rows] = await Promise.all([
      me.client.from('chat_suggestion_feeds').select('status').eq('user_id', me.userId),
      me.client
        .from('chat_suggestions')
        .select(
          'id, brand_id, action_id, sent_on, sent_at, seen_at, opened_at, started_at, started_via, summary',
        )
        .eq('user_id', me.userId)
        .gt('sent_at', shownSince(new Date()))
        .is('removed_at', null)
        .order('sent_at', { ascending: false })
        .limit(LIST_MAX),
    ]);
    if (feeds.error || rows.error) {
      logFailure('read daily suggestions', feeds.error ?? rows.error);
      return { ok: false, failure: 'failed' };
    }
    return {
      ok: true,
      read: {
        roleFeed: feed,
        state: feedsState((feeds.data ?? []).map((row) => row.status)),
        suggestions: ((rows.data ?? []) as SuggestionRow[]).map(toSuggestion),
      },
    };
  } catch (error) {
    logFailure('read daily suggestions', error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * Marks the suggestions the Inbox showed as seen: the person's own, not seen
 * before. Seeing isn't using: the feed is left alone.
 */
export async function markDailySuggestionsSeen(ids: string[]): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const parsed = idsSchema.safeParse(ids);
    if (!parsed.success) return { ok: false, failure: 'not_found' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    const { error } = await supabaseAdmin
      .from('chat_suggestions')
      .update({ seen_at: new Date().toISOString() })
      .in('id', [...new Set(parsed.data)])
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .is('seen_at', null);
    if (error) {
      logFailure('mark suggestions seen', error);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true };
  } catch (error) {
    logFailure('mark suggestions seen', error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * The person opened a suggestion (§5: a use): its opened_at the first time
 * (and seen_at, when the Inbox hadn't marked it yet), and its feed's
 * last_used_at each time.
 */
export async function openDailySuggestion(id: string): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return { ok: false, failure: 'not_found' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    const { data: row, error: readError } = await supabaseAdmin
      .from('chat_suggestions')
      .select('id, brand_id, seen_at, opened_at')
      .eq('id', parsed.data)
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .maybeSingle();
    if (readError) {
      logFailure('read a suggestion', readError);
      return { ok: false, failure: 'failed' };
    }
    if (!row) return { ok: false, failure: 'not_found' };
    const at = new Date().toISOString();
    if (!row.opened_at) {
      const { error } = await supabaseAdmin
        .from('chat_suggestions')
        .update(row.seen_at ? { opened_at: at } : { opened_at: at, seen_at: at })
        .eq('id', row.id)
        .eq('user_id', me.userId)
        .is('opened_at', null);
      if (error) {
        logFailure('mark a suggestion opened', error);
        return { ok: false, failure: 'failed' };
      }
    }
    const { error } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .update({ last_used_at: at })
      .eq('user_id', me.userId)
      .eq('brand_id', row.brand_id);
    if (error) {
      logFailure('keep the feed used', error);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true };
  } catch (error) {
    logFailure('open a suggestion', error);
    return { ok: false, failure: 'failed' };
  }
}

/** The workspace's brands that get suggestions: active, and not the demo brand (§6). */
async function suggestionBrands(orgId: string): Promise<string[] | null> {
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .eq('is_demo', false);
  if (error) {
    logFailure('read the brands', error);
    return null;
  }
  return ((data ?? []) as { id: string }[]).map((brand) => brand.id);
}

/**
 * Pause daily suggestions (off), or turn them back on (§2.4, §5): every one
 * of the person's feeds, a brand without one included, so the job doesn't
 * make an Admin's new feed on after a pause. Off is the person's own choice;
 * a feed the job paused comes back on only this way. The first suggestion
 * after turning them on comes the next morning (the job reads updated_at).
 */
export async function setDailySuggestions(on: boolean): Promise<SuggestionsWriteResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    if (typeof on !== 'boolean') return { ok: false, failure: 'not_allowed' };
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (roleFeed(me.role) === 'never') return { ok: false, failure: 'not_allowed' };
    const status = on ? 'on' : 'off';
    const { error } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .update({ status, paused_at: null })
      .eq('user_id', me.userId)
      .eq('organization_id', me.orgId)
      .neq('status', status);
    if (error) {
      logFailure(`turn daily suggestions ${status}`, error);
      return { ok: false, failure: 'failed' };
    }
    const brands = await suggestionBrands(me.orgId);
    if (!brands) return { ok: false, failure: 'failed' };
    if (brands.length) {
      const { error: insertError } = await supabaseAdmin.from('chat_suggestion_feeds').upsert(
        brands.map((brandId) => ({
          user_id: me.userId,
          brand_id: brandId,
          organization_id: me.orgId,
          status,
        })),
        { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
      );
      if (insertError) {
        logFailure(`turn daily suggestions ${status}`, insertError);
        return { ok: false, failure: 'failed' };
      }
    }
    return { ok: true };
  } catch (error) {
    logFailure('turn daily suggestions on or off', error);
    return { ok: false, failure: 'failed' };
  }
}

/**
 * An Agency partner's first Inbox (§6, DECISIONS V: "members" get them on
 * when they first open the Inbox): their feeds are made, on, for the
 * workspace's brands. Only while they have none: one they paused or turned
 * off stays so. Admins' and Managers' feeds are the nightly job's to make;
 * an Analyst gets none.
 */
export async function startDailySuggestions(): Promise<SuggestionsStartResult> {
  try {
    await assertWritable();
  } catch (error) {
    return refusal(error);
  }
  try {
    const me = await chatPerson();
    if (!me) return { ok: false, failure: 'chat_off' };
    if (roleFeed(me.role) !== 'opt_in') return { ok: false, failure: 'not_allowed' };
    const { data: feeds, error: readError } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .select('brand_id')
      .eq('user_id', me.userId)
      .limit(1);
    if (readError) {
      logFailure('read the feeds', readError);
      return { ok: false, failure: 'failed' };
    }
    if ((feeds ?? []).length) return { ok: true, made: 0 };
    const brands = await suggestionBrands(me.orgId);
    if (!brands) return { ok: false, failure: 'failed' };
    if (!brands.length) return { ok: true, made: 0 };
    const { data: made, error } = await supabaseAdmin
      .from('chat_suggestion_feeds')
      .upsert(
        brands.map((brandId) => ({
          user_id: me.userId,
          brand_id: brandId,
          organization_id: me.orgId,
          status: 'on',
        })),
        { onConflict: 'user_id,brand_id', ignoreDuplicates: true },
      )
      .select('brand_id');
    if (error) {
      logFailure('start daily suggestions', error);
      return { ok: false, failure: 'failed' };
    }
    return { ok: true, made: (made ?? []).length };
  } catch (error) {
    logFailure('start daily suggestions', error);
    return { ok: false, failure: 'failed' };
  }
}
