/**
 * Content Quality's reads of a page Chat made or changed, for its version
 * card (CHAT-25 §6, W4-12b part 2) and Chat's check_draft_rules: the same
 * reads an agent's go-live gate makes (lib/content-quality-reads.js), for a
 * person's own Chat run. The web's Chat engine scores them as the Content
 * Editor does (lib/content/go-live-gate.ts). Server to server: CRON_SECRET
 * auth, as the other internal endpoints.
 *
 * POST /api/internal/chat/quality/reads
 *   { orgId, runId, actingUserId, draftId, sites, spend, agentRunId?, scheduleId? }
 *   Checked here, from the database: Chat is on for the workspace; the run
 *   is a run of one of its chats, the person's own (or, for an agent's
 *   run, the agent run is the workspace's, running, and acts as the
 *   person); the person is a member who reaches the draft's brand; the
 *   draft is the workspace's and not archived.
 *   `spend: true` (a new version, the owner's 2026-11-05 decision): a read
 *   the draft hasn't kept is the run's own step, within the month's budget
 *   (an agent's run within its cap too). `spend: false` (check_draft_rules,
 *   free): only kept reads; one it would have to make answers not_kept.
 *   → 200 { links, claims, page, classes, facts, siteTrust }, each
 *     { ok: true, value } or { ok: false, code }.
 *   → 403 { code }: chat_off, permission, brand. 404: the run or the draft
 *     isn't the workspace's.
 */

import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { brandAccessOf } from '../lib/access.js';
import { agentRunReserve, chatRunReserve } from '../lib/chat-budget.js';
import { chatAgenticEnabled } from '../lib/chat-flag.js';
import { NO_SPEND, readQuality } from '../lib/content-quality-reads.js';
import { MAX_SOURCE_SITES } from '../lib/content-source-class.js';
import { webhookSecretsMatch } from '../lib/webhook-secret.js';

const router = Router();

// The secret is compared in constant time (webhookSecretsMatch), as the budget's endpoints do.
router.use((req, res, next) => {
  const auth = req.headers.authorization;
  const secret = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!webhookSecretsMatch(process.env.CRON_SECRET, secret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return next();
});

const readsSchema = z.strictObject({
  orgId: z.guid(),
  runId: z.guid(),
  actingUserId: z.guid(),
  draftId: z.guid(),
  sites: z.array(z.string().trim().toLowerCase().min(1).max(300)).max(MAX_SOURCE_SITES).default([]),
  spend: z.boolean(),
  agentRunId: z.guid().nullish(),
  scheduleId: z.guid().nullish(),
});

/** A check that failed: nothing is read. */
class Refused extends Error {
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function one(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** The run, its person and the draft, as the body names them; the draft when all hold. */
async function checkReads(body) {
  if (!chatAgenticEnabled(body.orgId)) throw new Refused('chat_off');
  const [run, agentRun, access, draft] = await Promise.all([
    one(supabaseAdmin.from('chat_runs').select('id, conversation_id').eq('id', body.runId)),
    body.agentRunId
      ? one(
          supabaseAdmin
            .from('chat_agent_runs')
            .select('id, acting_user_id, status')
            .eq('id', body.agentRunId)
            .eq('organization_id', body.orgId),
        )
      : null,
    brandAccessOf(body.actingUserId),
    one(
      supabaseAdmin
        .from('content_drafts')
        .select(
          'id, brand_id, body_html, page_type, kept_sources, archived_at, brands!inner(organization_id)',
        )
        .eq('id', body.draftId)
        .eq('brands.organization_id', body.orgId),
    ),
  ]);
  if (!run) throw new Refused('not_found', 404);
  const chat = await one(
    supabaseAdmin
      .from('chat_conversations')
      .select('user_id, organization_id')
      .eq('id', run.conversation_id),
  );
  if (!chat || chat.organization_id !== body.orgId) throw new Refused('not_found', 404);
  if (body.agentRunId) {
    if (!agentRun) throw new Refused('not_found', 404);
    if (agentRun.status !== 'running' || agentRun.acting_user_id !== body.actingUserId) {
      throw new Refused('permission');
    }
  } else if (chat.user_id !== body.actingUserId) {
    throw new Refused('permission');
  }
  if (access.orgId !== body.orgId || !access.role) throw new Refused('permission');
  if (!draft || draft.archived_at) throw new Refused('not_found', 404);
  if (!access.all && !access.brandIds.has(draft.brand_id)) throw new Refused('brand');
  return draft;
}

router.post('/reads', async (req, res) => {
  const parsed = readsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, code: 'invalid', message: 'Invalid request' });
  }
  const body = parsed.data;
  let draft;
  try {
    draft = await checkReads(body);
  } catch (err) {
    if (err instanceof Refused) {
      return res.status(err.status).json({ success: false, code: err.code });
    }
    req.log.error({ err }, 'internal chat quality reads check error');
    return res.status(500).json({ success: false, code: 'failed', message: 'Internal error' });
  }
  const reserve = !body.spend
    ? NO_SPEND
    : body.agentRunId
      ? agentRunReserve(body.orgId, { runId: body.runId, agentRunId: body.agentRunId })
      : chatRunReserve(body.orgId, { runId: body.runId, scheduleId: body.scheduleId ?? null });
  const reads = await readQuality({
    orgId: body.orgId,
    actingUserId: body.actingUserId,
    draft,
    sites: body.sites,
    reserve,
    log: req.log,
  });
  return res.json({ success: true, ...reads });
});

export default router;
