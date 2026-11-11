/**
 * ChatGPT Business Hub numbers (business_hub_snapshots, 00526), as a brand's
 * members enter them: by hand in Visibility, or from Ansvisor's own CSV
 * template. Business Hub has no export or API, so nothing here reads it.
 *
 * An entry is one length (7 or 28 days) ending on one day: its Mentions,
 * Website clicks and Profile views (each a whole number, or null where
 * Business Hub shows none) and its top five discovery topics. Saving the same
 * brand, length and last day again replaces the entry. The topics are the
 * person's own words: they are cleaned here, and treated as untrusted text
 * wherever they are shown or read.
 */

import { z } from 'zod';
import supabaseAdmin from '../../config/supabase.js';
import { completeFirstNumbersTask } from '../action-center/from-business-hub.js';

export const PERIOD_DAYS = [7, 28];
export const MAX_TOPICS = 5;
export const TOPIC_CHARS = 120;
/** Two years of weekly entries: what a list reads, and what an import may carry. */
export const MAX_ENTRIES = 104;
/** How far back an entry's last day may go. */
export const MAX_AGE_DAYS = 730;
/** The int column's top. */
const MAX_COUNT = 2_147_483_647;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMNS =
  'id, brand_id, period_days, period_end, mentions, website_clicks, profile_views, discovery_topics, source, entered_by, created_at, updated_at';
const CONTROL = /\p{Cc}/gu;

/** Why an entry is refused, as the routes answer it (400 `invalid`, with `field` and `reason`). */
export class SnapshotError extends Error {
  constructor(field, reason, row = null) {
    super(`${field}: ${reason}`);
    this.field = field;
    this.reason = reason;
    this.row = row;
  }
}

/**
 * The topics as kept: each trimmed, its control characters gone and its
 * spaces collapsed, empty ones dropped, and each kept once whatever its case
 * (the first spelling wins; a Turkish İ is an i). More than MAX_TOPICS left, or one over
 * TOPIC_CHARS, is refused rather than cut.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function cleanTopics(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new SnapshotError('topics', 'not_a_list');
  const seen = new Set();
  const topics = [];
  for (const item of raw) {
    if (item == null) continue;
    if (typeof item !== 'string') throw new SnapshotError('topics', 'not_text');
    const topic = item.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
    if (!topic) continue;
    if (topic.length > TOPIC_CHARS) throw new SnapshotError('topics', 'too_long');
    // Turkish İ lowers to i and a combining dot: without the dot it is i.
    const key = topic.toLocaleLowerCase('en').replace(/\u0307/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  if (topics.length > MAX_TOPICS) throw new SnapshotError('topics', 'too_many');
  return topics;
}

/** A YYYY-MM-DD day that exists, as its UTC midnight in ms; else null. */
function dayOf(text) {
  if (typeof text !== 'string' || !DATE.test(text)) return null;
  const ms = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return ms;
}

/**
 * Whether `periodEnd` may be an entry's last day at `now`: a real day, not
 * in the future anywhere (it may already be tomorrow east of UTC, up to
 * UTC+14), and not more than MAX_AGE_DAYS back.
 */
export function periodEndProblem(periodEnd, now = new Date()) {
  const day = dayOf(periodEnd);
  if (day === null) return 'not_a_date';
  const latest = Date.parse(new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10));
  if (day > latest) return 'future';
  const today = Date.parse(now.toISOString().slice(0, 10));
  if (day < today - MAX_AGE_DAYS * DAY_MS) return 'too_old';
  return null;
}

const count = z.number().int().min(0).max(MAX_COUNT).nullable().optional();

/** An entry as the web sends it. */
export const snapshotInput = z.object({
  periodDays: z.union([z.literal(7), z.literal(28)]),
  periodEnd: z.string(),
  mentions: count,
  websiteClicks: count,
  profileViews: count,
  topics: z.array(z.unknown()).max(50).optional(),
});

/**
 * An entry checked and cleaned, as its row's columns (without the brand,
 * who entered it or how). Throws SnapshotError on the first problem.
 *
 * @param {unknown} input
 * @param {{ now?: Date }} [opts]
 */
export function parseSnapshot(input, { now = new Date() } = {}) {
  const parsed = snapshotInput.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SnapshotError(String(issue?.path?.[0] ?? 'entry'), 'invalid');
  }
  const value = parsed.data;
  const problem = periodEndProblem(value.periodEnd, now);
  if (problem) throw new SnapshotError('periodEnd', problem);
  const topics = cleanTopics(value.topics);
  const row = {
    period_days: value.periodDays,
    period_end: value.periodEnd,
    mentions: value.mentions ?? null,
    website_clicks: value.websiteClicks ?? null,
    profile_views: value.profileViews ?? null,
    discovery_topics: topics,
  };
  // Nothing to keep: no number and no topic.
  if (
    row.mentions === null &&
    row.website_clicks === null &&
    row.profile_views === null &&
    !topics.length
  ) {
    throw new SnapshotError('entry', 'empty');
  }
  return row;
}

/** A row as the web reads it. */
export function snapshotOut(row) {
  return {
    id: row.id,
    periodDays: row.period_days,
    periodEnd: row.period_end,
    mentions: row.mentions,
    websiteClicks: row.website_clicks,
    profileViews: row.profile_views,
    topics: Array.isArray(row.discovery_topics) ? row.discovery_topics : [],
    source: row.source,
    enteredBy: row.entered_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The brand's entries, newest last day first, MAX_ENTRIES at most. */
export async function listSnapshots(brandId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('business_hub_snapshots')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('period_end', { ascending: false })
    .order('period_days', { ascending: true })
    .limit(MAX_ENTRIES);
  if (error) throw new Error(`business_hub_snapshots read: ${error.message}`);
  return (data ?? []).map(snapshotOut);
}

/**
 * Saves entries of one brand in one statement (all or none), each replacing
 * the brand's entry of the same length and last day. Answers the rows saved
 * and how many replaced an entry.
 *
 * @param {string} brandId
 * @param {object[]} rows parseSnapshot's
 * @param {{ userId: string|null, source: 'manual'|'csv', db?: object, now?: Date }} opts
 */
export async function saveSnapshots(
  brandId,
  rows,
  { userId, source, db = supabaseAdmin, now = new Date() },
) {
  if (!rows.length) return { saved: [], replaced: 0 };
  const { data: before, error: readErr } = await db
    .from('business_hub_snapshots')
    .select('period_days, period_end')
    .eq('brand_id', brandId)
    .in('period_end', [...new Set(rows.map((row) => row.period_end))]);
  if (readErr) throw new Error(`business_hub_snapshots read: ${readErr.message}`);
  const existing = new Set((before ?? []).map((row) => `${row.period_days}|${row.period_end}`));
  const at = now.toISOString();
  const { data, error } = await db
    .from('business_hub_snapshots')
    .upsert(
      rows.map((row) => ({
        ...row,
        brand_id: brandId,
        source,
        entered_by: userId,
        updated_at: at,
      })),
      { onConflict: 'brand_id,period_days,period_end' },
    )
    .select(COLUMNS);
  if (error) throw new Error(`business_hub_snapshots write: ${error.message}`);
  return {
    saved: (data ?? []).map(snapshotOut),
    replaced: rows.filter((row) => existing.has(`${row.period_days}|${row.period_end}`)).length,
  };
}

/**
 * What follows a save of the brand's numbers: the setup action's Enter your
 * first Business Hub numbers task is completed (action-center/
 * from-business-hub.js). Best effort for the caller: a failure here never
 * undoes the save.
 *
 * @param {string} brandId
 * @param {{ db?: object, now?: Date }} [opts]
 */
export async function afterBusinessHubSave(brandId, { db = supabaseAdmin, now = new Date() } = {}) {
  const firstNumbers = await completeFirstNumbersTask(brandId, { db, now });
  return { firstNumbers };
}
