import { supabaseAdmin } from '@/lib/supabase/admin';
import { contentRulesOf } from '@/lib/content/content-rules';
import { bannedPhrasesIssue } from './banned-phrases';

/**
 * The draft save's banned-phrase check (create_draft, update_draft): the
 * brand's Content rules read as the service role, then the title and page
 * checked (banned-phrases.ts). A refusal comes back as the tool's result, so
 * the model rewrites and saves again; a failed read never blocks a save.
 * Server only; never a server action.
 */

export type BannedRefusal = { ok: false; reason: 'invalid'; message: string };

export async function refuseBannedPhrases(
  at: { brandId: string } | { draftId: string },
  texts: readonly (string | undefined)[],
): Promise<BannedRefusal | null> {
  if (!texts.some(Boolean)) return null;
  try {
    const { data } =
      'brandId' in at
        ? await supabaseAdmin
            .from('brands')
            .select('content_rules')
            .eq('id', at.brandId)
            .maybeSingle()
        : await supabaseAdmin
            .from('content_drafts')
            .select('brands(content_rules)')
            .eq('id', at.draftId)
            .maybeSingle()
            .then((r) => ({
              data: {
                content_rules: (r.data as { brands?: { content_rules?: unknown } } | null)?.brands
                  ?.content_rules,
              },
            }));
    const phrases = contentRulesOf(data?.content_rules).bannedPhrases;
    const message = phrases.length > 0 ? bannedPhrasesIssue(texts, phrases) : null;
    return message ? { ok: false, reason: 'invalid', message } : null;
  } catch (err) {
    console.error('Failed to read the brand’s banned phrases:', err);
    return null;
  }
}
