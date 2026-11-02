import { supabaseAdmin } from '@/lib/supabase/admin';
import { summaryValue } from '../activity';
import type { UndoRule, WriteRecord } from '../undo';
import { DAY_MS, asObject, textOf } from '../undo-parts';

/**
 * A follow-up check's record in the Activity log, and its Undo (CHAT-20 §9
 * row 79: "Yes · until the check runs"; §13): the check goes while it hasn't
 * run; once it ran, its result stays and Undo finds it changed. The window
 * is the longest a check is set out (90 days). Server only.
 */
export const followUpUndo: UndoRule = {
  targetType: 'chat_schedule',
  windowMs: 90 * DAY_MS,
  async before() {
    return null;
  },
  async record(input, output): Promise<WriteRecord> {
    const made = asObject(output);
    const id = textOf(made.schedule_id);
    return {
      target: { type: 'chat_schedule', id },
      summaryParams: {
        title: summaryValue(textOf(made.title) ?? textOf(asObject(input).title)),
        date: summaryValue(textOf(made.date)),
      },
      undo: id ? { after: { id } } : null,
    };
  },
  async inverse({ id }) {
    const { data, error } = await supabaseAdmin
      .from('chat_schedules')
      .delete()
      .eq('id', id)
      .eq('kind', 'followup_check')
      .is('last_run_at', null)
      .select('id');
    if (error) throw new Error(`Could not cancel the follow-up check: ${error.message}`);
    if ((data ?? []).length > 0) return 'ok';
    // Still there: it ran already, and its result stays.
    const { data: still, error: readError } = await supabaseAdmin
      .from('chat_schedules')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw new Error(`Could not read the follow-up check: ${readError.message}`);
    return still ? 'changed' : 'gone';
  },
  href: () => '/dashboard/chat',
};
