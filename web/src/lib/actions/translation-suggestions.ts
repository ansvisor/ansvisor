'use server';

import { loadMessages } from '@/i18n/messages';
import { isUiLocale } from '@/i18n/locales';
import { assertWritable } from '@/lib/subscription-guard';
import { createClient } from '@/lib/supabase/server';
import {
  cleanSuggestion,
  findMessageKey,
  type SuggestionInput,
  type SuggestionProblem,
} from '@/lib/i18n/translation-suggestions';

export type SubmitSuggestionResult =
  | { ok: true }
  | { ok: false; error: SuggestionProblem | 'tooMany' | 'server' };

/** How many suggestions one person may send in a day: enough to be thorough, too few to flood the queue. */
const DAILY_LIMIT = 20;

/**
 * "Suggest a better translation" (LOC-009): keeps one suggestion for the
 * team's review queue (translation_suggestions, 00555). It is written as the
 * person, on their own organization, so row-level security lets only their
 * own rows in and shows them only their own; no admin client. The text is
 * checked here, whatever the form checked.
 */
export async function submitTranslationSuggestion(
  input: SuggestionInput,
): Promise<SubmitSuggestionResult> {
  await assertWritable();
  const checked = cleanSuggestion(input);
  if (!checked.ok) return { ok: false, error: checked.problem };
  const { locale, path, currentText, suggestion, note } = checked.value;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) return { ok: false, error: 'server' };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('translation_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return { ok: false, error: 'tooMany' };

  // The key of the text, when the language's messages have it once: it saves the team a search.
  let messageKey: string | null = null;
  if (isUiLocale(locale)) {
    try {
      messageKey = findMessageKey(await loadMessages(locale), currentText);
    } catch {
      messageKey = null;
    }
  }

  // The service role adds it, after the checks above: there is no insert policy, so the
  // daily limit and a read-only workspace can't be skipped. The ids are the session's own.
  // Loaded here, not at module load: the settings screens import this file, and the
  // admin client needs server-only settings their tests (and the browser) don't have.
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const { error } = await supabaseAdmin.from('translation_suggestions').insert({
    organization_id: profile.organization_id,
    user_id: user.id,
    locale,
    path,
    message_key: messageKey,
    current_text: currentText,
    suggestion,
    note,
  });
  if (error) return { ok: false, error: 'server' };
  return { ok: true };
}
