import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { actionRef } from '@/lib/action-center/action-ref';
import { currentActionFirst, signalDetailForApi } from '@/lib/signals/detail';
import { signalTexts } from '@/lib/signals/display';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type SignalRow } from '@/lib/signals/map';
import { readPromptPlaces } from '@/lib/signals/prompt-places';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { brandAllowed, signalActionRefs } from './data';
import { pageMeta, pageRows, pageWindow, type PageMeta } from './list-page';

/**
 * Chat's Signals read (CHAT-20 §9 row 40), a page at a time: the signals of
 * the Signals page's window (detected by its end, and open or resolved after
 * its start), newest first, every one counted. A row is compact, as the
 * page's list shows it: its title and description in the page's words, where
 * it happened, and the actions built on it, so a page of 50 fits one read.
 * Only the caller's brand, in their organization and access.
 */

export interface SignalsPageParams {
  brandId: string;
  status?: string;
  kind?: string;
  /** The window's first and last day (or timestamps); none: every signal. */
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

const textsT = createTranslator({ locale: 'en', messages, namespace: 'actionCenter.signalTexts' });
const plainTexts = (key: string, values?: Record<string, string | number>) =>
  textsT(key as never, values as never);

const day = (at: string | null | undefined) => (at ? at.slice(0, 10) : undefined);

/** A date the model or the range gave, as a timestamp the filter takes; null when it isn't one. */
function stamp(value: string | undefined, endOfDay: boolean): string | null {
  if (!value) return null;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const at = Date.parse(bare && endOfDay ? `${value}T23:59:59.999Z` : value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

export async function listSignalsPageFor(
  auth: McpAuthContext,
  params: SignalsPageParams,
): Promise<(PageMeta & { signals: Record<string, unknown>[] }) | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const { limit, offset } = pageWindow(params);
  const from = stamp(params.dateFrom, false);
  const to = stamp(params.dateTo, true);

  const matching = (head = false) => {
    let query = supabaseAdmin
      .from('signals')
      .select(SIGNAL_ROW_COLUMNS, { count: 'exact', head })
      .eq('brand_id', params.brandId);
    // The page's window: detected by its end, and still open or resolved after its start.
    if (to) query = query.lte('detected_at', to);
    if (from) query = query.or(`resolved_at.is.null,resolved_at.gte.${from}`);
    if (params.status) query = query.eq('status', params.status);
    if (params.kind) query = query.eq('kind', params.kind);
    return query;
  };
  const { rows, total } = await pageRows(
    await matching()
      .order('detected_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );
  const list = rows as unknown as SignalRow[];
  const [prompts, actions] = await Promise.all([
    readPromptPlaces(supabaseAdmin, params.brandId),
    signalActionRefs(
      params.brandId,
      list.filter((row) => row.action_id).map((row) => row.id),
    ),
  ]);
  const known = new Map(mapSignalRows(list, prompts).map((signal) => [signal.id, signal]));

  const signals = list.map((row) => {
    const signal = known.get(row.id);
    const used = currentActionFirst(actions.get(row.id) ?? [], row.action_id);
    const where = signal
      ? Object.fromEntries(
          Object.entries(signalDetailForApi(signal, used).where).filter(([, v]) => v !== null),
        )
      : {};
    const texts = signal ? signalTexts(signal, plainTexts) : null;
    return {
      id: row.id,
      ...(texts ? { title: texts.title, description: texts.description } : {}),
      kind: row.kind,
      category: row.category,
      impact: row.impact,
      status: row.status,
      detected: day(row.detected_at),
      ...(row.resolved_at ? { resolved: day(row.resolved_at) } : {}),
      ...(Object.keys(where).length > 0 ? { where } : {}),
      ...(used.length > 0 ? { actions: used.map((a) => actionRef(a.action_no)) } : {}),
    };
  });
  return {
    ...pageMeta({ what: 'signals', order: 'newest first' }, total, offset, signals.length),
    signals,
  };
}
