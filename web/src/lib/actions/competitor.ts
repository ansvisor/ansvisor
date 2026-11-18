'use server';

import { createClient } from '@/lib/supabase/server';
import { dbClient } from '@/lib/supabase/scoped';
import { revalidatePath } from 'next/cache';
import type { Competitor } from '@/types';
import { assertWritable } from '@/lib/subscription-guard';
import { isManager } from '@/lib/session-role';
import { z } from 'zod';
import { readAllRpcRows } from '@/lib/supabase/rpc-pages';
import {
  parseTimelineEvents,
  timelineSince,
  weeklyMentions,
  type CompetitorTimeline,
} from '@/lib/competitor-timeline';
import { COMPETITOR_TYPE_MAX_LENGTH, normalizeCompetitorType } from '@/lib/competitor-types';
import {
  MAX_MERGED_AT_ONCE,
  mergedMatch,
  type MergedCompetitor,
  type MergedCompetitorRow,
} from '@/lib/competitor-merge';

/** A competitor's page events the timeline reads at most. */
const TIMELINE_EVENTS = 50;

function mapRow(row: Record<string, unknown>): Competitor {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    name: row.name as string,
    domain: (row.domain as string) ?? '',
    type: (row.type as string | null) ?? null,
  };
}

const TYPE_TOO_LONG = `A competitor type can be at most ${COMPETITOR_TYPE_MAX_LENGTH} characters.`;

/**
 * The types the brand's competitors have (00542), but for the ones named in
 * `except`: what a typed type is matched against, so "airline" joins the
 * brand's "Airline". The competitors being changed are left out, so one can
 * still change its own label's case.
 */
async function brandCompetitorTypes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  except: readonly string[] = [],
): Promise<string[]> {
  const { data, error } = await supabase
    .from('competitors')
    .select('id, type')
    .eq('brand_id', brandId)
    .not('type', 'is', null);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((row) => !except.includes(row.id as string))
    .map((row) => row.type as string);
}

export async function getCompetitors(brandId: string): Promise<Competitor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function addCompetitor(
  brandId: string,
  input: { name: string; domain: string; type?: string | null },
): Promise<Competitor> {
  await assertWritable({ onboarding: true, brandId });
  const supabase = await createClient();

  // Its type (00542), when one was picked: one of the brand's own labels in
  // any case is stored as the brand wrote it.
  let type: string | null = null;
  if (input.type?.trim()) {
    const normalized = normalizeCompetitorType(
      input.type,
      await brandCompetitorTypes(supabase, brandId),
    );
    if (!normalized.ok) throw new Error(TYPE_TOO_LONG);
    type = normalized.type;
  }

  // One merged into another (00543) is that one already: answers naming it
  // count for it. Unmerge it instead of adding it again.
  const merged = mergedMatch(input, await readMergedRows(supabase, brandId).catch(() => []));
  if (merged) {
    throw new Error(
      `${merged.name} is merged into ${(await keptName(supabase, merged.merged_into_id)) || 'another competitor'}: answers naming it already count there. Unmerge it to track it on its own.`,
    );
  }

  const { data, error } = await supabase
    .from('competitors')
    .insert({
      brand_id: brandId,
      name: input.name.trim(),
      domain: input.domain
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, ''),
      ...(type ? { type } : {}),
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to add competitor');

  revalidatePath('/dashboard/brands');
  return mapRow(data as Record<string, unknown>);
}

/** A competitor's domain as two are compared: scheme, www, case and trailing slash aside. */
const domainKey = (domain: string) =>
  domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');

export type AddCompetitorsResult =
  | {
      ok: true;
      /** partial: some weren't added (CHAT-20 §11a), each with why. */
      code: 'ok' | 'partial';
      added: Competitor[];
      skipped: {
        name: string;
        domain: string;
        type?: string | null;
        /** merged: one merged into another competitor (00543), named in mergedInto. */
        reason: 'duplicate' | 'merged' | 'failed';
        mergedInto?: { id: string; name: string };
      }[];
    }
  | { ok: false; reason: 'forbidden_role' | 'duplicate' | 'failed'; message: string };

/**
 * Add competitors to a brand: Chat's add_competitors (CHAT-20 §9 row 30).
 * Admins and Managers, checked here (as the table's policy does). A domain
 * (or, without one, a name) the brand already has is skipped (the natural
 * key, §11c); each of the rest through addCompetitor, as the Competitors page
 * adds one. Errors come back as values (#427).
 */
export async function addCompetitors(
  brandId: string,
  items: { name: string; domain: string; type?: string | null }[],
): Promise<AddCompetitorsResult> {
  try {
    await assertWritable({ brandId });
    return await addSomeCompetitors(brandId, items);
  } catch (err) {
    console.error('Failed to add competitors from Chat:', err);
    return {
      ok: false,
      reason: 'failed',
      message: 'The competitors couldn’t be added. Try again.',
    };
  }
}

async function addSomeCompetitors(
  brandId: string,
  items: { name: string; domain: string; type?: string | null }[],
): Promise<AddCompetitorsResult> {
  if (!(await isManager(await createClient()))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can add competitors.',
    };
  }
  let existing: Competitor[];
  let merged: MergedCompetitorRow[];
  try {
    [existing, merged] = await Promise.all([
      getCompetitors(brandId),
      createClient().then((supabase) => readMergedRows(supabase, brandId)),
    ]);
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  const keyOf = (c: { name: string; domain: string }) =>
    c.domain.trim() ? `d:${domainKey(c.domain)}` : `n:${c.name.trim().toLowerCase()}`;
  const known = new Set(existing.map(keyOf));
  const added: Competitor[] = [];
  const skipped: Extract<AddCompetitorsResult, { ok: true }>['skipped'] = [];
  for (const item of items) {
    if (known.has(keyOf(item))) {
      skipped.push({ ...item, reason: 'duplicate' });
      continue;
    }
    // Merged into another (00543): that one already counts it. Offer it, never a second copy.
    const alias = mergedMatch(item, merged);
    const kept = alias && existing.find((c) => c.id === alias.merged_into_id);
    if (alias) {
      skipped.push({
        ...item,
        reason: 'merged',
        mergedInto: { id: alias.merged_into_id, name: kept?.name ?? '' },
      });
      continue;
    }
    known.add(keyOf(item));
    try {
      added.push(await addCompetitor(brandId, item));
    } catch {
      skipped.push({ ...item, reason: 'failed' });
    }
  }
  if (added.length === 0) {
    const merges = skipped.filter((s) => s.reason === 'merged');
    return skipped.every((s) => s.reason === 'duplicate' || s.reason === 'merged')
      ? {
          ok: false,
          reason: 'duplicate',
          message:
            merges.length > 0
              ? `The brand already has these competitors. ${merges
                  .map((s) => `${s.name} is merged into ${s.mergedInto?.name || 'another one'}`)
                  .join('; ')}: answers naming it already count there.`
              : 'The brand already has these competitors.',
        }
      : { ok: false, reason: 'failed', message: "The competitors couldn't be added." };
  }
  return { ok: true, code: skipped.length > 0 ? 'partial' : 'ok', added, skipped };
}

export type RemoveBrandCompetitorResult =
  | { ok: true; removed: Competitor }
  | { ok: false; reason: 'forbidden_role' | 'not_found' | 'failed'; message: string };

/**
 * Remove one of a brand's competitors: Chat's remove_competitor (CHAT-20 §9
 * row 32). Admins and Managers, checked here. Only the brand's own, then
 * through deleteCompetitor, as the Competitors page removes one: its page
 * events and timeline scans go with it, and its actions' links are marked
 * deleted (00244). Errors come back as values (#427).
 */
export async function removeBrandCompetitor(
  brandId: string,
  competitorId: string,
): Promise<RemoveBrandCompetitorResult> {
  try {
    await assertWritable({ brandId });
    return await removeOneCompetitor(brandId, competitorId);
  } catch (err) {
    console.error('Failed to remove a competitor from Chat:', err);
    return {
      ok: false,
      reason: 'failed',
      message: 'The competitor couldn’t be removed. Try again.',
    };
  }
}

async function removeOneCompetitor(
  brandId: string,
  competitorId: string,
): Promise<RemoveBrandCompetitorResult> {
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can remove competitors.',
    };
  }
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('id', competitorId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (error) return { ok: false, reason: 'failed', message: error.message };
  if (!data) {
    return {
      ok: false,
      reason: 'not_found',
      message: "That competitor isn't one of this brand's.",
    };
  }
  try {
    await deleteCompetitor(competitorId);
  } catch (err) {
    return {
      ok: false,
      reason: 'failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, removed: mapRow(data as Record<string, unknown>) };
}

export async function deleteCompetitor(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  // A delete the row rules don't allow removes nothing rather than failing:
  // say so instead of reporting it removed.
  const { data, error } = await supabase.from('competitors').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("The competitor couldn't be removed.");

  revalidatePath('/dashboard/brands');
}

/** A database without merged_competitors yet (the web deployed ahead of 00543). */
function missingMergedTable(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === '42P01' || error.code === 'PGRST205') &&
    (error.message ?? '').includes('merged_competitors')
  );
}

/** The brand's merged competitors (00543), read through the person's own client. */
async function readMergedRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<MergedCompetitorRow[]> {
  const { data, error } = await supabase
    .from('merged_competitors')
    .select('id, merged_into_id, name, domain')
    .eq('brand_id', brandId);
  if (error) {
    if (missingMergedTable(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as MergedCompetitorRow[];
}

async function keptName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competitorId: string,
): Promise<string> {
  const { data } = await supabase
    .from('competitors')
    .select('name')
    .eq('id', competitorId)
    .maybeSingle();
  return (data?.name as string | undefined) ?? '';
}

/**
 * The brand's merged competitors (00543), newest first, for the Merged
 * competitors list: each one's name and domain, the competitor it was merged
 * into, when and by whom. Through the person's own client (RLS: members who
 * can access the brand). Empty before 00543.
 */
export async function getMergedCompetitors(brandId: string): Promise<MergedCompetitor[]> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('merged_competitors')
    .select('id, merged_into_id, name, domain, type, merged_at, merged_by')
    .eq('brand_id', brandId)
    .order('merged_at', { ascending: false });
  if (error) {
    if (missingMergedTable(error)) return [];
    throw new Error(error.message);
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const keptIds = [...new Set(rows.map((row) => row.merged_into_id))];
  const byIds = [...new Set(rows.map((row) => row.merged_by).filter((id): id is string => !!id))];
  const [kept, people] = await Promise.all([
    supabase.from('competitors').select('id, name').eq('brand_id', brandId).in('id', keptIds),
    byIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', byIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[], error: null }),
  ]);
  if (kept.error) throw new Error(kept.error.message);
  const keptNames = new Map((kept.data ?? []).map((row) => [row.id, row.name]));
  const names = new Map(
    (people.data ?? []).map((row) => [row.id, row.full_name?.trim() || null] as const),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    domain: row.domain ?? '',
    type: row.type ?? null,
    mergedIntoId: row.merged_into_id,
    mergedIntoName: keptNames.get(row.merged_into_id) ?? '',
    mergedAt: row.merged_at,
    mergedBy: row.merged_by ? (names.get(row.merged_by) ?? null) : null,
  }));
}

export type MergeCompetitorsResult =
  | {
      ok: true;
      kept: { id: string; name: string };
      /** The ones merged now. */
      merged: { id: string; name: string }[];
      /** The ones already merged before, left as they were (a merge run twice changes nothing). */
      already: { id: string; name: string; mergedIntoId: string }[];
    }
  | {
      ok: false;
      reason: 'forbidden_role' | 'invalid' | 'not_found' | 'failed';
      message: string;
    };

/**
 * A database error as the person reads it: the merge functions' own refusals
 * (their error codes, 00543) as they word them, anything else as `fallback`.
 */
const rpcMessage = (error: { message: string; code?: string }, fallback: string) =>
  error.message && ['22023', 'P0002', '42501', '23514'].includes(error.code ?? '')
    ? error.message
    : fallback;

/**
 * Merge duplicate competitors (00543): the Competitors page. Each of
 * `mergedIds` leaves the brand's competitors and its name and domain become
 * `keptId`'s other names, so answers naming it count for the kept one from
 * now on. Their history stays under their own ids: numbers from before the
 * merge aren't combined. The plan first, then the role (admins and
 * managers), then that every competitor is this brand's, then
 * merge_competitors with the person's own client, which checks all of it
 * again and records who and when. One already merged is left as it is and
 * comes back under `already`. Errors come back as values.
 */
export async function mergeCompetitors(
  brandId: string,
  keptId: string,
  mergedIds: string[],
): Promise<MergeCompetitorsResult> {
  await assertWritable({ brandId });
  const ids = [...new Set(mergedIds)];
  if (
    !z.guid().safeParse(brandId).success ||
    !z.guid().safeParse(keptId).success ||
    ids.length === 0 ||
    ids.length > MAX_MERGED_AT_ONCE ||
    !ids.every((id) => z.guid().safeParse(id).success)
  ) {
    return { ok: false, reason: 'invalid', message: 'Pick the competitors to merge.' };
  }
  if (ids.includes(keptId)) {
    return {
      ok: false,
      reason: 'invalid',
      message: "A competitor can't be merged into itself.",
    };
  }
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can merge competitors.',
    };
  }

  // Every one of them this brand's: the kept one tracked, the others tracked or already merged.
  const [live, merged] = await Promise.all([
    supabase
      .from('competitors')
      .select('id')
      .eq('brand_id', brandId)
      .in('id', [keptId, ...ids]),
    readMergedRows(supabase, brandId).catch(() => null),
  ]);
  if (live.error || merged === null) {
    return { ok: false, reason: 'failed', message: "The competitors couldn't be merged." };
  }
  const liveIds = new Set((live.data ?? []).map((row) => row.id as string));
  const mergedIdsKnown = new Set(merged.map((row) => row.id));
  if (!liveIds.has(keptId)) {
    return {
      ok: false,
      reason: 'not_found',
      message: mergedIdsKnown.has(keptId)
        ? 'The competitor to keep is itself merged into another one.'
        : "The competitor to keep isn't one of this brand's.",
    };
  }
  if (!ids.every((id) => liveIds.has(id) || mergedIdsKnown.has(id))) {
    return {
      ok: false,
      reason: 'not_found',
      message: "One of the competitors to merge isn't one of this brand's.",
    };
  }

  const { data, error } = await supabase.rpc('merge_competitors', {
    p_brand_id: brandId,
    p_kept_id: keptId,
    p_merged_ids: ids,
  });
  if (error) {
    return {
      ok: false,
      reason: error.code === '42501' ? 'forbidden_role' : 'failed',
      message: rpcMessage(error, "The competitors couldn't be merged."),
    };
  }
  const result = (data ?? {}) as {
    kept?: { id: string; name: string };
    merged?: { id: string; name: string }[];
    already?: { id: string; name: string; merged_into_id: string }[];
  };

  revalidatePath('/dashboard/brands');
  return {
    ok: true,
    kept: result.kept ?? { id: keptId, name: '' },
    merged: result.merged ?? [],
    already: (result.already ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      mergedIntoId: row.merged_into_id,
    })),
  };
}

export type UnmergeCompetitorResult =
  | {
      ok: true;
      /** False when it wasn't merged: nothing changed. */
      unmerged: boolean;
      competitor: { id: string; name: string };
      mergedInto: { id: string; name: string } | null;
    }
  | { ok: false; reason: 'forbidden_role' | 'invalid' | 'not_found' | 'failed'; message: string };

/**
 * Unmerge a competitor (00543): it is the brand's own again, with its id, its
 * history from before the merge, its cited pages and its Action Center links;
 * its name stops counting for the one it was merged into. What was counted
 * for that one while they were merged stays there. The plan first, then the
 * role, then the brand; unmerge_competitor checks all of it again.
 */
export async function unmergeCompetitor(
  brandId: string,
  competitorId: string,
): Promise<UnmergeCompetitorResult> {
  await assertWritable({ brandId });
  if (!z.guid().safeParse(brandId).success || !z.guid().safeParse(competitorId).success) {
    return { ok: false, reason: 'invalid', message: 'Pick the competitor to unmerge.' };
  }
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can unmerge competitors.',
    };
  }
  const { data: row, error: readError } = await supabase
    .from('merged_competitors')
    .select('id, name, merged_into_id')
    .eq('brand_id', brandId)
    .eq('id', competitorId)
    .maybeSingle();
  if (readError) {
    return { ok: false, reason: 'failed', message: "The competitor couldn't be unmerged." };
  }
  if (!row) {
    const { data: live } = await supabase
      .from('competitors')
      .select('id, name')
      .eq('brand_id', brandId)
      .eq('id', competitorId)
      .maybeSingle();
    return live
      ? {
          ok: true,
          unmerged: false,
          competitor: { id: live.id, name: live.name },
          mergedInto: null,
        }
      : {
          ok: false,
          reason: 'not_found',
          message: "That competitor isn't one of this brand's.",
        };
  }

  const { data, error } = await supabase.rpc('unmerge_competitor', {
    p_brand_id: brandId,
    p_competitor_id: competitorId,
  });
  if (error) {
    return {
      ok: false,
      reason: error.code === '42501' ? 'forbidden_role' : 'failed',
      message: rpcMessage(error, "The competitor couldn't be unmerged."),
    };
  }
  const result = (data ?? {}) as {
    unmerged?: boolean;
    merged_into?: { id: string; name: string | null } | null;
  };

  revalidatePath('/dashboard/brands');
  return {
    ok: true,
    unmerged: result.unmerged !== false,
    competitor: { id: row.id, name: row.name },
    mergedInto: result.merged_into
      ? { id: result.merged_into.id, name: result.merged_into.name ?? '' }
      : { id: row.merged_into_id, name: '' },
  };
}

/** The most competitors one Set type changes at once. */
const MAX_TYPED_AT_ONCE = 200;

/**
 * Set the type (00542) of one or more of a brand's competitors, or clear it
 * with null: the Competitors page and brand settings. Admins and Managers,
 * checked here as the table's update rule does. The type is cleaned as
 * normalizeCompetitorType does: a generic type by its key, one of the
 * brand's own labels in any case as the brand wrote it. Only the brand's own
 * competitors change; their rows come back.
 */
export async function setCompetitorTypes(
  brandId: string,
  competitorIds: string[],
  type: string | null,
): Promise<Competitor[]> {
  await assertWritable({ brandId });
  const ids = [...new Set(competitorIds)];
  if (
    !z.guid().safeParse(brandId).success ||
    ids.length === 0 ||
    ids.length > MAX_TYPED_AT_ONCE ||
    !ids.every((id) => z.guid().safeParse(id).success)
  ) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    throw new Error('Only an admin or a manager can change competitor types.');
  }
  const normalized = normalizeCompetitorType(
    type,
    type?.trim() ? await brandCompetitorTypes(supabase, brandId, ids) : [],
  );
  if (!normalized.ok) throw new Error(TYPE_TOO_LONG);

  const { data, error } = await supabase
    .from('competitors')
    .update({ type: normalized.type })
    .eq('brand_id', brandId)
    .in('id', ids)
    .select('*');
  if (error) throw new Error(error.message);
  // None of them the brand's, or the row rules let none change.
  if (!data?.length) throw new Error("The competitors' type couldn't be changed.");

  revalidatePath('/dashboard/brands');
  return data.map((row) => mapRow(row as Record<string, unknown>));
}

/**
 * A competitor's pages over time (learning C3) for the Competitors page: the
 * brand's and the competitor's mentioning answers per week over the chart's
 * weeks (the daily rollups, every row read), and the competitor's page
 * events, newest first. RLS keeps both to the caller's organization.
 */
export async function getCompetitorTimeline(
  brandId: string,
  competitorId: string,
): Promise<CompetitorTimeline> {
  if (!z.guid().safeParse(brandId).success || !z.guid().safeParse(competitorId).success) {
    throw new Error('invalid');
  }
  // dbClient: the person's own client; Chat's read runs it with the service role (asService).
  const supabase = await dbClient();
  const now = new Date();
  const since = timelineSince(now);
  type DayRow = { day: string; mention_answers: number | null };
  const daily = (table: 'insights_brand_daily' | 'insights_competitor_daily') =>
    readAllRpcRows<DayRow>((from, to) => {
      let query = supabase
        .from(table)
        .select('day, mention_answers')
        .eq('brand_id', brandId)
        .gte('day', since);
      if (table === 'insights_competitor_daily') query = query.eq('competitor_id', competitorId);
      return query
        .order('day')
        .order('platform')
        .order('model_used')
        .order('region')
        .range(from, to) as unknown as PromiseLike<{
        data: DayRow[] | null;
        error: { message: string } | null;
      }>;
    });
  const [brandRows, competitorRows, events] = await Promise.all([
    daily('insights_brand_daily'),
    daily('insights_competitor_daily'),
    supabase
      .from('competitor_page_events')
      .select('kind, at, url, domain, detail')
      .eq('brand_id', brandId)
      .eq('competitor_id', competitorId)
      .order('at', { ascending: false })
      .limit(TIMELINE_EVENTS),
  ]);
  if (events.error) throw new Error(events.error.message);
  return {
    weeks: weeklyMentions(brandRows, competitorRows, now),
    events: parseTimelineEvents(events.data ?? []),
  };
}
