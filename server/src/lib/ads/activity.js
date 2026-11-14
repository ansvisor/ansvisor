import { z } from 'zod';
import supabaseAdmin from '../../config/supabase.js';

/**
 * Ads' activity log (00530, ADS-01 §7a rule 17): every Ads change, written
 * by the server alone and never changed or deleted. Who (a person, or an
 * agent's run and the chat run it ran in), what, before and after, and an
 * export's file and row count (§7a rule 16).
 *
 * target, before and after hold ids, decisions, amounts and settings, never
 * a token, a key or a person's details (§7a rules 13 and 16): an entry with
 * one is refused before anything is written. The table's check refuses the
 * same keys, and e-mail addresses.
 */

/** Keys that name a secret or a person's details: the table's check reads the same. */
const SECRET_KEY =
  /token|secret|passw|api_?key|authori[sz]ation|bearer|cookie|credential|private_?key|e_?mail|phone|first_?name|last_?name|full_?name|birth|ip_?addr|user_?agent/i;

/** Values that are one: an e-mail address, a JWT, an Authorization header, an API key. */
const SECRET_VALUES = [
  /[^@\s]+@[^@\s]+\.[a-z]{2,}/i,
  /\beyJ[\w-]{8,}\.[\w-]{8,}/,
  /\bbearer\s+\S/i,
  /\b(?:sk|rk|pk)[-_](?:live|test|proj|ant)[-_]/i,
];

/**
 * Where in `value` a secret or a person's details sit (`after.owner.email`),
 * or null when nowhere.
 * @param {unknown} value
 * @returns {string | null}
 */
export function secretIn(value, path = '') {
  if (typeof value === 'string') return SECRET_VALUES.some((p) => p.test(value)) ? path : null;
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    const at = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    const found = (!Array.isArray(value) && SECRET_KEY.test(key) && at) || secretIn(item, at);
    if (found) return found;
  }
  return null;
}

const id = z.guid();
/** An object of at most `bytes` (the table's check), with no secret in it. */
const part = (name, bytes) =>
  z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
    const secret = secretIn(v, name);
    if (secret) ctx.addIssue({ code: 'custom', message: `A secret or personal data at ${secret}` });
    if (Buffer.byteLength(JSON.stringify(v)) > bytes) {
      ctx.addIssue({ code: 'custom', message: `${name} is too large` });
    }
  });

const Entry = z.object({
  orgId: id,
  brandId: id.nullable().default(null),
  actor: z
    .object({ userId: id.optional(), agentRunId: id.optional(), chatRunId: id.optional() })
    .refine((a) => a.userId || a.agentRunId, 'An entry names a person or an agent run')
    .refine((a) => !a.agentRunId || a.chatRunId, "An agent run's entry names its chat run"),
  event: z.string().regex(/^[a-z][a-z_]{1,39}(\.[a-z][a-z_]{1,39}){1,2}$/),
  target: part('target', 4096).default({}),
  before: part('before', 8192).nullable().default(null),
  after: part('after', 8192).nullable().default(null),
  rowCount: z.number().int().min(0).nullable().default(null),
  fileName: z.string().min(1).max(200).nullable().default(null),
});

export class AdsActivityError extends Error {}

/**
 * Logs one Ads event. Throws AdsActivityError for an entry the log refuses
 * (nothing is written), and an Error when the write fails.
 *
 * @param {{ orgId: string, brandId?: string | null,
 *   actor: { userId?: string, agentRunId?: string, chatRunId?: string },
 *   event: string, target?: object, before?: object | null, after?: object | null,
 *   rowCount?: number | null, fileName?: string | null }} entry
 * @returns {Promise<{ id: string, createdAt: string }>}
 */
export async function logAdsActivity(entry) {
  const parsed = Entry.safeParse(entry);
  if (!parsed.success) {
    throw new AdsActivityError(parsed.error.issues.map((i) => i.message).join('; '));
  }
  const e = parsed.data;
  const { data, error } = await supabaseAdmin
    .from('ads_activity_log')
    .insert({
      organization_id: e.orgId,
      brand_id: e.brandId,
      actor_user_id: e.actor.userId ?? null,
      agent_run_id: e.actor.agentRunId ?? null,
      chat_run_id: e.actor.chatRunId ?? null,
      event: e.event,
      target: e.target,
      before: e.before,
      after: e.after,
      row_count: e.rowCount,
      file_name: e.fileName,
    })
    .select('id, created_at')
    .single();
  if (error) throw new Error(`ads activity write failed: ${error.message}`);
  return { id: data.id, createdAt: data.created_at };
}

/**
 * The workspace's log (and only its own), newest first: `limit` rows older
 * than `before`, of one brand or all, and the time to ask for the next page.
 * @returns {Promise<{ entries: object[], next: string | null }>}
 */
export async function readAdsActivity({ orgId, brandId = null, before = null, limit = 50 }) {
  let query = supabaseAdmin
    .from('ads_activity_log')
    .select(
      'id, brand_id, actor_user_id, agent_run_id, chat_run_id, event, target, before, after, row_count, file_name, created_at',
    )
    .eq('organization_id', orgId);
  if (brandId) query = query.eq('brand_id', brandId);
  if (before) query = query.lt('created_at', before);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error(`ads activity read failed: ${error.message}`);
  const page = (data ?? []).slice(0, limit);
  return {
    entries: page.map((row) => ({
      id: row.id,
      brandId: row.brand_id,
      actor: {
        userId: row.actor_user_id,
        agentRunId: row.agent_run_id,
        chatRunId: row.chat_run_id,
      },
      event: row.event,
      target: row.target,
      before: row.before,
      after: row.after,
      rowCount: row.row_count,
      fileName: row.file_name,
      createdAt: row.created_at,
    })),
    next: (data ?? []).length > limit ? page[page.length - 1].created_at : null,
  };
}
