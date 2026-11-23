import { notFound } from 'next/navigation';
import { isChatStaff } from '@/lib/chat/staff';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { TranslationSuggestionsAdmin, type SuggestionRow } from './_translation-suggestions-admin';

export const dynamic = 'force-dynamic';

/**
 * The review queue of suggested translations (LOC-009): the new ones, with
 * Accept and Reject. Only for Ansvisor staff (STAFF_EMAILS,
 * lib/chat/staff.ts, as the report cards' admin view); for anyone else, a
 * customer's Admin too, the page isn't there. Not linked from the menu.
 * No names or e-mails are read: the row has only the language, the screen
 * and the texts.
 */
export default async function TranslationSuggestionsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isChatStaff(user)) notFound();

  const { data, error } = await supabaseAdmin
    .from('translation_suggestions')
    .select('id, locale, path, message_key, current_text, suggestion, note, created_at')
    .eq('status', 'new')
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);

  return <TranslationSuggestionsAdmin rows={(data ?? []) as SuggestionRow[]} />;
}
