'use server';

import { createClient } from '@/lib/supabase/server';
import type { Database, Json } from '@/types/supabase';
import {
  FOCUS_MAX,
  focusColumn,
  isHiddenKey,
  isNavArea,
  isSeenKey,
  isoTime,
  isUuid,
  parseUserBrandState,
  readSeenKeys,
  withHidden,
  withSeen,
  withSeenKey,
  type FocusPin,
  type NavArea,
  type UserBrandState,
} from '@/lib/user-brand-state';

/**
 * A person's Today and menu state on a brand (user_brand_state, 00529),
 * read and written as the person: the row's policies keep it theirs, on a
 * brand they can access. Not through assertWritable: it is UI state that
 * costs nothing, so it works while the workspace is read-only and on the
 * demo brand too. Answers as values and never throws (#1777): a state that
 * didn't save only means it isn't kept for the next visit.
 *
 * Each write changes one column, read and merged here first; the other
 * columns keep what they have.
 */

export type UserBrandStateResult = { ok: true } | { ok: false; error: 'invalid' | 'failed' };

type Client = Awaited<ReturnType<typeof createClient>>;

/** The signed-in person's client and id, or null. */
async function person(): Promise<{ client: Client; userId: string } | null> {
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  return user ? { client, userId: user.id } : null;
}

/**
 * The person's state on the brand: the empty state when they have none yet,
 * null when it can't be read (signed out, or the read failed), so a caller
 * hides what depends on it rather than showing everything as new.
 */
export async function readUserBrandState(brandId: string): Promise<UserBrandState | null> {
  if (!isUuid(brandId)) return null;
  try {
    const who = await person();
    if (!who) return null;
    const { data, error } = await who.client
      .from('user_brand_state')
      .select('nav_seen, focus, hidden')
      .eq('user_id', who.userId)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) {
      console.error('[user-brand-state] could not read the state:', error.message);
      return null;
    }
    return parseUserBrandState(data, new Date());
  } catch (error) {
    console.error('[user-brand-state] could not read the state:', error);
    return null;
  }
}

type Column = 'nav_seen' | 'focus' | 'hidden';
type Row = Database['public']['Tables']['user_brand_state']['Insert'];

/**
 * Keeps one column of the person's row on the brand, from what it holds now
 * (null when there is no row yet). Logs a failure, never throws.
 */
async function keep(
  brandId: string,
  column: Column,
  next: (current: unknown) => Json,
  what: string,
): Promise<UserBrandStateResult> {
  try {
    const who = await person();
    if (!who) return { ok: false, error: 'failed' };
    let current: unknown = null;
    if (column !== 'focus') {
      const { data, error } = await who.client
        .from('user_brand_state')
        .select(column)
        .eq('user_id', who.userId)
        .eq('brand_id', brandId)
        .maybeSingle();
      if (error) {
        console.error(`[user-brand-state] could not read ${what}:`, error.message);
        return { ok: false, error: 'failed' };
      }
      current = (data as Record<Column, unknown> | null)?.[column] ?? null;
    }
    const row: Row = { user_id: who.userId, brand_id: brandId };
    row[column] = next(current);
    const { error } = await who.client
      .from('user_brand_state')
      .upsert(row, { onConflict: 'user_id,brand_id' });
    if (error) {
      console.error(`[user-brand-state] could not keep ${what}:`, error.message);
      return { ok: false, error: 'failed' };
    }
    return { ok: true };
  } catch (error) {
    console.error(`[user-brand-state] could not keep ${what}:`, error);
    return { ok: false, error: 'failed' };
  }
}

/**
 * The person opened a menu area's page on the brand: its dot clears, and
 * Today's "Since yesterday" starts from this visit next time. The time is
 * the server's.
 */
export async function markSeen(brandId: string, area: NavArea): Promise<UserBrandStateResult> {
  if (!isUuid(brandId) || !isNavArea(area)) return { ok: false, error: 'invalid' };
  const at = new Date();
  return keep(brandId, 'nav_seen', (current) => withSeen(current, area, at), `the ${area} visit`);
}

/**
 * The person looked at a part of a page with its own dot (the Audit page's
 * Auto-audit line or Opportunities tab), or opened an action: that dot
 * clears for them (nav_seen's page keys). The time is the server's.
 */
export async function markPageSeen(brandId: string, key: string): Promise<UserBrandStateResult> {
  if (!isUuid(brandId) || !isSeenKey(key)) return { ok: false, error: 'invalid' };
  const at = new Date();
  return keep(brandId, 'nav_seen', (current) => withSeenKey(current, key, at), `the ${key} visit`);
}

/**
 * When the person last looked at each part of a page with its own dot, by
 * its key; null when it can't be read, so no green or yellow compares with it.
 */
export async function readPageSeen(brandId: string): Promise<Record<string, string> | null> {
  if (!isUuid(brandId)) return null;
  try {
    const who = await person();
    if (!who) return null;
    const { data, error } = await who.client
      .from('user_brand_state')
      .select('nav_seen')
      .eq('user_id', who.userId)
      .eq('brand_id', brandId)
      .maybeSingle();
    if (error) {
      console.error('[user-brand-state] could not read the pages seen:', error.message);
      return null;
    }
    return readSeenKeys(data?.nav_seen);
  } catch (error) {
    console.error('[user-brand-state] could not read the pages seen:', error);
    return null;
  }
}

/**
 * The actions the person keeps in Today's focus, in order: at most 3, each
 * once, with when it took its slot (now when not given). Empty clears it.
 */
export async function setFocus(
  brandId: string,
  pins: readonly { id: string; addedAt?: string }[],
): Promise<UserBrandStateResult> {
  if (!isUuid(brandId) || !Array.isArray(pins) || pins.length > FOCUS_MAX) {
    return { ok: false, error: 'invalid' };
  }
  const now = new Date().toISOString();
  const focus: FocusPin[] = [];
  for (const pin of pins) {
    const addedAt = pin?.addedAt === undefined ? now : isoTime(pin.addedAt);
    if (!isUuid(pin?.id) || !addedAt) return { ok: false, error: 'invalid' };
    const id = pin.id.toLowerCase();
    if (focus.some((kept) => kept.id === id)) return { ok: false, error: 'invalid' };
    focus.push({ id, addedAt });
  }
  return keep(brandId, 'focus', () => focusColumn(focus), 'the focus');
}

/**
 * Hides a card for the person on the brand until `until`, or for good with
 * null: "Finish setting up" (setup), the first day's prompt check
 * (prompts_check), "New area to track" (topic:<key>) or a focus card
 * (skip:<action id>). `until` must be ahead. Cards whose time has passed
 * are dropped as it is kept.
 */
export async function hideCard(
  brandId: string,
  key: string,
  until: string | Date | null,
): Promise<UserBrandStateResult> {
  const now = new Date();
  const time = until === null ? null : isoTime(until);
  if (
    !isUuid(brandId) ||
    !isHiddenKey(key) ||
    (until !== null && (!time || Date.parse(time) <= now.getTime()))
  ) {
    return { ok: false, error: 'invalid' };
  }
  return keep(brandId, 'hidden', (current) => withHidden(current, key, time, now), `card ${key}`);
}
