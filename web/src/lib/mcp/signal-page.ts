import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { actionRef } from '@/lib/action-center/action-ref';
import { currentActionFirst, signalDetailForApi } from '@/lib/signals/detail';
import { signalTexts } from '@/lib/signals/display';
import { SIGNAL_ROW_COLUMNS, mapSignalRows, type SignalRow } from '@/lib/signals/map';
import { readPromptPlaces } from '@/lib/signals/prompt-places';
import { signalCode } from '@/lib/signals/signal-code';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { brandAllowed, signalActionRefs } from './data';
import { pageMeta, pageRows, pageWindow, type PageMeta } from './list-page';
import { askedSignals, keysOf, signalLookup, type SignalLookup } from './lookup';

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
  /** The Signals page's filters: a category, an impact, a source its signals came from. */
  category?: string;
  impact?: string;
  source?: string;
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
    if (params.category) query = query.eq('category', params.category);
    if (params.impact) query = query.eq('impact', params.impact);
    // As the page's Source filter: a signal any of whose sources it is.
    if (params.source) query = query.contains('source', [params.source]);
    return query;
  };
  const { rows, total } = await pageRows(
    await matching()
      .order('detected_at', { ascending: false })
      .order('id')
      .range(offset, offset + limit - 1),
    () => matching(true),
  );
  const signals = await compactSignals(params.brandId, rows as unknown as SignalRow[]);
  return {
    ...pageMeta({ what: 'signals', order: 'newest first' }, total, offset, signals.length),
    signals,
  };
}

/** One signal as Chat's reads give it: compact, in the Signals page's words. */
export type SignalPageRow = Record<string, unknown> & { id: string; code?: string };

/**
 * Each signal as the Signals page's list shows it: its code ("S-07", once
 * its brand is numbered), its title and description in the page's words,
 * where it happened, and the actions built on it by the codes the app shows.
 */
async function compactSignals(brandId: string, list: SignalRow[]): Promise<SignalPageRow[]> {
  if (list.length === 0) return [];
  const [prompts, actions] = await Promise.all([
    readPromptPlaces(supabaseAdmin, brandId),
    signalActionRefs(
      brandId,
      list.filter((row) => row.action_id).map((row) => row.id),
    ),
  ]);
  const known = new Map(mapSignalRows(list, prompts).map((signal) => [signal.id, signal]));

  return list.map((row) => {
    const signal = known.get(row.id);
    const used = currentActionFirst(actions.get(row.id) ?? [], row.action_id);
    const where = signal
      ? Object.fromEntries(
          Object.entries(signalDetailForApi(signal, used).where).filter(([, v]) => v !== null),
        )
      : {};
    const texts = signal ? signalTexts(signal, plainTexts) : null;
    const code = signalCode({ brandNo: row.brand_no });
    return {
      id: row.id,
      ...(code ? { code } : {}),
      ...(texts ? { title: texts.title, description: texts.description } : {}),
      kind: row.kind,
      category: row.category,
      impact: row.impact,
      status: row.status,
      detected: day(row.detected_at),
      ...(row.resolved_at ? { resolved: day(row.resolved_at) } : {}),
      ...(Object.keys(where).length > 0 ? { where } : {}),
      // As the app shows them: each action's code in its brand (00534), else its old number.
      ...(used.length > 0 ? { actions: used.map((a) => a.code ?? actionRef(a.action_no)) } : {}),
    };
  });
}

// ─── The brand's signals by their codes and ids ─────────────────────────────

/**
 * The brand's signals by the codes a person wrote ("S-07", "S 7", "s7",
 * "#7", "7") or by their ids, for Chat (the owner's plan of 2026-11-16,
 * item 2: "what is S-07?" never depends on S-07 being on the first page).
 * Every status and every date: a lookup ignores the page's window. A code
 * is the signal's number in its brand (brand_no, 00534); every signal a
 * code or id names comes back, never one picked. Only this brand of the
 * caller's organization is read, its organization joined on the rows too:
 * a code or id of another brand or workspace is not found. Null for a brand
 * outside the caller's organization or access.
 */
export async function lookUpSignalsFor(
  auth: McpAuthContext,
  params: { brandId: string; codes?: readonly string[]; ids?: readonly string[] },
): Promise<SignalLookup<SignalPageRow> | null> {
  if (!auth.organizationId || !(await brandAllowed(auth, params.brandId))) return null;
  const organizationId = auth.organizationId;
  const asked = askedSignals(params.codes, params.ids);
  // Numbers and checked ids only: none of the model's text reaches a filter.
  const numbers = keysOf<number>(asked, 'code');
  const ids = keysOf<string>(asked, 'id');

  const read = async (column: 'brand_no' | 'id', values: (number | string)[]) => {
    if (values.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from('signals')
      .select(`${SIGNAL_ROW_COLUMNS}, brands!inner(organization_id)`)
      .eq('brand_id', params.brandId)
      .eq('brands.organization_id', organizationId)
      .in(column, values)
      .order('id');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as SignalRow[];
  };
  const [byNumber, byId] = await Promise.all([read('brand_no', numbers), read('id', ids)]);
  const rows = [...byNumber, ...byId.filter((row) => !byNumber.some((n) => n.id === row.id))];
  return signalLookup(asked, await compactSignals(params.brandId, rows));
}
