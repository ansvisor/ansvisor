import { createTranslator } from 'next-intl';
import messages from '../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { actionTexts } from '@/lib/action-center/display';
import { readEntityCounts, withEntityCounts } from '@/lib/action-center/entity-counts';

/**
 * An action's title and description as the Action Center words them, for
 * the API server's Slack post of the daily suggestion (#2139): the server
 * keeps an action's structured fields only, and its words live here
 * (actionCenter.actionTexts). Named with what is left of its targets, as
 * the list names it (AC-009). Server only.
 */

const textsT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.actionTexts' });

/** The plain (key, values) translator display.ts's helpers take. */
const plain =
  (t: (key: never, values?: never) => string) =>
  (key: string, values?: Record<string, string | number>) =>
    t(key as never, values as never);

/** The action's words, or null when there is no such action. */
export async function slackActionWords(
  actionId: string,
): Promise<{ title: string; description: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('id, kind, payload')
    .eq('id', actionId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the action: ${error.message}`);
  const row = data as { id: string; kind: string; payload: Record<string, unknown> | null } | null;
  if (!row) return null;
  const counts = await readEntityCounts(supabaseAdmin, [row.id]);
  const payload = withEntityCounts(row.payload ?? {}, counts.get(row.id));
  return actionTexts(
    { kind: row.kind, payload } as Parameters<typeof actionTexts>[0],
    plain(textsT),
  );
}
