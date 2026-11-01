import type { BrandAccess } from '@/lib/brand-access';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The brands a chat touched (BRAND-ACCESS §10, 00436): a chat with no brand
 * lets each call pick its own, so a shared one can hold any brand's data.
 * Its touched_brand_ids say which: the chat's own brand when it starts, and
 * the brand of every call Chat lets run (or asks about), noted before the
 * call reads anything. A read about no brand that names every brand the
 * person can access (the brand list, the connections) touches all of them:
 * for someone with All brands, the whole workspace (null). A file filed
 * from the chat keeps the chat's set (00436's trigger).
 *
 * Null is "not known": a chat from before 00436, one Chat didn't start (an
 * old Agent chat copied in), or one that touched the whole workspace. With
 * no brand and not known, only Admins and All-brands people read someone
 * else's (00424); a known set lets a Selected-brands person read it when
 * every brand in it is theirs (00436's policies).
 *
 * Before 00436 the functions aren't there: nothing is noted, and nothing
 * reads the set. Server only.
 */

/** A call's brands: these ids, or every brand of the workspace. */
export type TouchedBrands = readonly string[] | 'workspace';

/** A function that isn't there: PostgREST doesn't know it, or Postgres doesn't. */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
let warnedMissing = false;

function missing(error: { code?: string; message: string }): boolean {
  if (!MISSING_FUNCTION.has(error.code ?? '')) return false;
  if (!warnedMissing) {
    warnedMissing = true;
    console.warn("[chat] a chat's brands aren't kept until 00436 is applied");
  }
  return true;
}

/**
 * What a call touches: its brand; for a read about no brand that names the
 * brands the person can access (`namesBrands`), every one of them, which
 * for All brands is the whole workspace; else nothing. Pure.
 */
export function touchedByCall(
  tool: { namesBrands?: true },
  brandId: string | null,
  access: BrandAccess | null,
): TouchedBrands {
  if (brandId) return [brandId];
  if (!tool.namesBrands) return [];
  return access === 'all' ? 'workspace' : [...(access ?? [])];
}

/**
 * Starts keeping a new chat's brands: its own brand, or none yet. Only a
 * chat with no message yet (the database checks): anything already in it
 * is of brands no one noted. A start that fails leaves the set not known,
 * the closed side: it is logged, and the chat goes on.
 */
export async function startTouchedBrands(conversationId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('chat_start_touched_brands', {
    p_conversation_id: conversationId,
  });
  if (error && !missing(error)) {
    console.error("[chat] could not start keeping a chat's brands:", error.message);
  }
}

/**
 * Notes what a call touches on its chat, before it runs. Answers whether
 * the call may go on: false when the note failed, so the call reads
 * nothing a shared chat would then show to someone without that brand.
 */
export async function noteTouchedBrands(
  conversationId: string,
  touched: TouchedBrands,
): Promise<boolean> {
  if (touched !== 'workspace' && touched.length === 0) return true;
  const { error } = await supabaseAdmin.rpc('chat_note_touched_brands', {
    p_conversation_id: conversationId,
    p_brand_ids: touched === 'workspace' ? [] : [...touched],
    p_whole_workspace: touched === 'workspace',
  });
  if (!error || missing(error)) return true;
  console.error("[chat] could not note a call's brands:", error.message);
  return false;
}
