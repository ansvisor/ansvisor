import { Router } from 'express';
import { z } from 'zod';
import { assertBrandAccess } from '../lib/access.js';
import { fixDraftRules, fixRulesInput } from '../lib/content-agent.js';
import { handOffDraft, handOffInput } from '../lib/content-handoff.js';
import { qualityPhase } from '../lib/content-quality.js';
import { briefRules, rebuildDraftBrief, rebuildSources } from '../lib/content-brief.js';
import { NoShoppingPath, buildShoppingPath } from '../lib/shopping-path.js';
import { DeliveryError, sendContentPages, sendInput } from '../lib/content-delivery.js';
import { checkFramerPublished } from '../lib/cms/framer-status.js';
import { checkWebflowPublished } from '../lib/cms/webflow-status.js';
import { checkWordPressPublished } from '../lib/cms/wordpress-status.js';
import { checkWixPublished } from '../lib/cms/wix-status.js';
import { liveAddress, publishDraft } from '../lib/content-published.js';
import { cmsStatusLimiter, shoppingPathLimiter } from '../middleware/rate-limiter.js';
import { stopDraftRun } from '../lib/content-runs.js';
import { startDraftWriting, writeDraftInput } from '../lib/content-writer.js';
import supabaseAdmin from '../config/supabase.js';
import { PlanLimitError } from '../lib/plan-guard.js';

/**
 * Content Editor drafts: Rebuild outline in the editor's Brief tab writes
 * the draft's brief from the sources the person kept (CE-007); Fix open
 * rules with agent leaves the Content Agent's suggestions for review
 * (CE-018); Hand off has it fix the page's open Quality checks (CE-051);
 * Start's Agent has the Content Agent do the page (CE-015);
 * Stop ends the agent's run under way, changing nothing (v1.1 CE-027); and
 * Send to CMS sends pages to the brand's webhook, its Webflow or Framer collection or its WordPress site (#1331).
 */

const router = Router();

/** The person-facing reason, by status, when the error names none. */
const ERROR_CODES = { 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'invalid' };

/** Who may send pages to the brand's CMS (#1331): as who may change its webhook. */
const SEND_ROLES = ['admin', 'manager'];

/**
 * An admin sends; a manager only while no admin of the brand's workspace
 * turned Publishing off for managers (Settings › Chat, "What Managers may
 * take live": chat_settings.manager_execute_off, 00401). Chat's own send
 * (web cms-send.ts) checks the same switch. A read that fails refuses the
 * send.
 */
async function assertSender(userId, orgId) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!SEND_ROLES.includes(profile?.role)) {
    const err = new Error('Only admins and managers can send pages to the CMS.');
    err.status = 403;
    throw err;
  }
  if (profile.role === 'admin') return;
  const { data: settings, error } = await supabaseAdmin
    .from('chat_settings')
    .select('manager_execute_off')
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (settings?.manager_execute_off?.includes('publishing')) {
    const err = new Error('An admin turned publishing off for managers.');
    err.status = 403;
    err.code = 'execute_off';
    throw err;
  }
}

/**
 * POST /api/content-drafts/send
 * Body: { brandId, target?: 'webhook' | 'webflow' | 'wordpress' | 'framer' | 'wix', pages: [{ draftId, title, slug, metaTitle, metaDescription, html, author, featuredImage }] }
 * One page is sent before this answers: { deliveries: [{ id, status, http_status, error }] };
 * more (up to 25) go on in the background: { batchId, deliveries: queued, skipped }.
 */
router.post('/send', async (req, res) => {
  const parsed = sendInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Which page and field, so the dialog can say what to fix.
    const field = parsed.error.issues[0]?.path.join('.') ?? null;
    return res.status(400).json({ error: 'Invalid request', code: 'invalid', field });
  }
  const { brandId, pages, target } = parsed.data;
  try {
    const { orgId } = await assertBrandAccess(brandId, req.user.id);
    await assertSender(req.user.id, orgId);
    const sent = await sendContentPages({ orgId, brandId, userId: req.user.id, pages, target });
    return res.json(sent);
  } catch (err) {
    if (err instanceof DeliveryError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft send error');
    return res.status(502).json({ error: 'The pages could not be sent', code: 'failed' });
  }
});

const publishBody = z.object({ url: z.string().max(8192) });

/**
 * POST /api/content-drafts/:draftId/publish
 * Body: { url }. A person marks the page Published at its live address
 * (CE-013): any member of the brand's workspace, as they change its status.
 * Its Live page tab then measures that address, and a linked action gets
 * the page (its Publish task done once all its pages are live). Answers
 * { publishedUrl, publishedAt, taskCompleted, onBrandDomain }: an address
 * off the brand's domains is kept, but its numbers won't show.
 */
router.post('/:draftId/publish', async (req, res) => {
  const id = z.guid().safeParse(req.params.draftId);
  const parsed = publishBody.safeParse(req.body ?? {});
  if (!id.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const url = liveAddress(parsed.data.url);
  if (!url) {
    return res.status(400).json({
      error: 'Give the http(s) address the page is live at, with no sign-in details.',
      code: 'invalid_url',
    });
  }
  try {
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('id, brand_id, action_id, archived_at')
      .eq('id', id.data)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // An archived page is restored first, as its status is changed.
    if (!draft || draft.archived_at) {
      return res.status(404).json({ error: 'Not found', code: 'not_found' });
    }
    await assertBrandAccess(draft.brand_id, req.user.id);
    return res.json(await publishDraft(draft, url, req.user.id));
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err: { name: err?.name } }, 'content draft publish error');
    return res
      .status(500)
      .json({ error: 'The page could not be marked published', code: 'failed' });
  }
});

/** A brand's Webflow pages read at most this often on demand (the daily sweep reads them too). */
const WEBFLOW_STATUS_EVERY_MS = 2 * 60 * 1000;
const webflowChecked = new Map();
const webflowStatusBody = z.object({ brandId: z.guid() });

/**
 * POST /api/content-drafts/webflow-status
 * Body: { brandId }. Pages the brand sent to Webflow, published there since,
 * marked published at their address (cms/webflow-status.js). For any member
 * of the brand's workspace (the Library asks when it opens), a brand at most
 * every two minutes: { checked, published: [{ draftId, url }], recent? }.
 */
router.post('/webflow-status', cmsStatusLimiter, async (req, res) => {
  const parsed = webflowStatusBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  const { brandId } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const last = webflowChecked.get(brandId) ?? 0;
    if (Date.now() - last < WEBFLOW_STATUS_EVERY_MS) {
      return res.json({ checked: 0, published: [], recent: true });
    }
    webflowChecked.set(brandId, Date.now());
    return res.json(await checkWebflowPublished(brandId));
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error(
      { err: { name: err?.name, code: err?.code } },
      'content draft webflow status error',
    );
    return res.status(502).json({ error: 'Webflow could not be read', code: 'failed' });
  }
});

/** A brand's WordPress posts read at most this often on demand (the daily sweep reads them too). */
const wordpressChecked = new Map();

/**
 * POST /api/content-drafts/wordpress-status
 * Body: { brandId }. Pages the brand sent to WordPress, published there
 * since, marked published at the post's link (cms/wordpress-status.js). As
 * /webflow-status: any member, a brand at most every two minutes.
 */
router.post('/wordpress-status', cmsStatusLimiter, async (req, res) => {
  const parsed = webflowStatusBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  const { brandId } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const last = wordpressChecked.get(brandId) ?? 0;
    if (Date.now() - last < WEBFLOW_STATUS_EVERY_MS) {
      return res.json({ checked: 0, published: [], recent: true });
    }
    wordpressChecked.set(brandId, Date.now());
    return res.json(await checkWordPressPublished(brandId));
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error(
      { err: { name: err?.name, code: err?.code } },
      'content draft wordpress status error',
    );
    return res.status(502).json({ error: 'WordPress could not be read', code: 'failed' });
  }
});

/** A brand's Framer items read at most this often on demand (the daily sweep reads them too). */
const framerChecked = new Map();

/**
 * POST /api/content-drafts/framer-status
 * Body: { brandId }. Pages the brand sent to Framer, published there since,
 * marked published at the item's page (cms/framer-status.js). As
 * /webflow-status: any member, a brand at most every two minutes.
 */
router.post('/framer-status', cmsStatusLimiter, async (req, res) => {
  const parsed = webflowStatusBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  const { brandId } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const last = framerChecked.get(brandId) ?? 0;
    if (Date.now() - last < WEBFLOW_STATUS_EVERY_MS) {
      return res.json({ checked: 0, published: [], recent: true });
    }
    framerChecked.set(brandId, Date.now());
    return res.json(await checkFramerPublished(brandId));
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error(
      { err: { name: err?.name, code: err?.code } },
      'content draft framer status error',
    );
    return res.status(502).json({ error: 'Framer could not be read', code: 'failed' });
  }
});

/** A brand's Wix posts read at most this often on demand (the daily sweep reads them too). */
const wixChecked = new Map();

/**
 * POST /api/content-drafts/wix-status
 * Body: { brandId }. Pages the brand sent to Wix, published there since,
 * marked published at the post's address (cms/wix-status.js). As
 * /webflow-status: any member, a brand at most every two minutes.
 */
router.post('/wix-status', cmsStatusLimiter, async (req, res) => {
  const parsed = webflowStatusBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  const { brandId } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const last = wixChecked.get(brandId) ?? 0;
    if (Date.now() - last < WEBFLOW_STATUS_EVERY_MS) {
      return res.json({ checked: 0, published: [], recent: true });
    }
    wixChecked.set(brandId, Date.now());
    return res.json(await checkWixPublished(brandId));
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err: { name: err?.name, code: err?.code } }, 'content draft wix status error');
    return res.status(502).json({ error: 'Wix could not be read', code: 'failed' });
  }
});

const rebuildBody = z.object({
  // guid, not uuid: brand ids aren't all RFC 4122 versions (seeded ones).
  brandId: z.guid(),
  sources: rebuildSources,
  /** The rules in effect, as Fix sends them: read with the brief rules (2026) on. */
  rules: briefRules.optional(),
});

/**
 * POST /api/content-drafts/:draftId/brief
 * Body: { brandId, sources: { promptIds, fanouts, pages, queries, headings, length }, rules? }
 */
router.post('/:draftId/brief', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = rebuildBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, sources, rules } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const brief = await rebuildDraftBrief({ draftId: draftId.data, brandId, sources, rules });
    return res.json({ brief });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft brief rebuild error');
    return res.status(502).json({ error: 'The brief could not be written', code: 'failed' });
  }
});

/**
 * POST /api/content-drafts/:draftId/shopping-path
 * Body: { brandId }
 * Builds the draft's shopping path from the brand's catalog and saves it
 * (shopping path, 00351): { path }, or { path: null, reason } when it
 * doesn't fit ('not_a_shop', 'page_type', 'no_catalog', 'no_match'). A 409
 * 'changed' when the path changed while it was built; a 429 past its
 * bucket (shoppingPathLimiter).
 */
router.post('/:draftId/shopping-path', shoppingPathLimiter, async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const body = z.object({ brandId: z.guid() }).safeParse(req.body ?? {});
  if (!draftId.success || !body.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  try {
    await assertBrandAccess(body.data.brandId, req.user.id);
    const path = await buildShoppingPath({ draftId: draftId.data, brandId: body.data.brandId });
    return res.json({ path });
  } catch (err) {
    if (err instanceof NoShoppingPath) return res.json({ path: null, reason: err.reason });
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error(
      { err: { name: err?.name, message: err?.message } },
      'content draft shopping path error',
    );
    return res.status(502).json({ error: 'The shopping path could not be built', code: 'failed' });
  }
});

const fixBody = fixRulesInput.extend({ brandId: z.guid() });

/**
 * POST /api/content-drafts/:draftId/suggestions
 * Body: { brandId, rules: [{ key, name, detail }], textRules, locked }
 * Answers { count, batchId, why? }: the suggestions left for review (none when
 * the agent found nothing it could change, with `why`: 'none', 'locked' or
 * 'dropped', content-agent.js emptyWhy); 409 `open_suggestions` while the
 * latest batch is undecided, 409 `published` for a published draft, 409
 * `running` while a fix or a hand-off on it is under way.
 */
router.post('/:draftId/suggestions', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = fixBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await fixDraftRules({ draftId: draftId.data, brandId, input });
    return res.json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent fix error');
    return res.status(502).json({ error: 'The agent could not run', code: 'failed' });
  }
});

const handOffBody = handOffInput.extend({ brandId: z.guid() });

/**
 * POST /api/content-drafts/:draftId/handoff
 * Body: { brandId, items: [{ key, detail }], textRules, locked, sources?, origin }
 * Quality's hand-off (CE-051): answers { count, batchId, why? } as /suggestions
 * does, with its errors; 404 `off` before Quality's phase 2, 409 `not_due`
 * for an automatic one the brand doesn't hand off, 409 `already` when the
 * draft had its automatic one.
 */
router.post('/:draftId/handoff', async (req, res) => {
  if (qualityPhase() < 2) return res.status(404).json({ error: 'Not available', code: 'off' });
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = handOffBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await handOffDraft({ draftId: draftId.data, brandId, input });
    return res.json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft hand-off error');
    return res.status(502).json({ error: 'The agent could not run', code: 'failed' });
  }
});

const writeBody = writeDraftInput.extend({ brandId: z.guid() });

/**
 * POST /api/content-drafts/:draftId/write
 * Body: { brandId, sources, rules, textRules, locked }
 * Answers 202 { started: true } at once: the agent runs in the background
 * and the draft shows where it is (agent_state). 409 when the draft is marked
 * ready or published (code not_draft), the agent is on it (code writing) or on
 * another of the organization's drafts (code org_writing), an existing
 * page's suggestions are still open (code open_suggestions), or a Fix open
 * rules still runs on it (code running).
 */
router.post('/:draftId/write', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = writeBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await startDraftWriting({ draftId: draftId.data, brandId, input });
    return res.status(202).json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent write error');
    return res.status(502).json({ error: 'The agent could not start', code: 'failed' });
  }
});

/**
 * POST /api/content-drafts/:draftId/rewrite
 * Body: as /write ({ brandId, sources, rules, textRules, locked }).
 * Rewrite the page to these rules: the agent rewrites the whole page in the
 * background and leaves it as ONE suggestion to compare and accept or
 * reject. Answers 202 { started: true } at once; 409 as /write (not_draft,
 * writing, org_writing, open_suggestions, running); 422 when the page has no text
 * (empty) or is too long to send whole (too_long).
 */
router.post('/:draftId/rewrite', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = writeBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, ...input } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await startDraftWriting({
      draftId: draftId.data,
      brandId,
      input,
      rewrite: true,
    });
    return res.status(202).json(result);
  } catch (err) {
    if (err instanceof PlanLimitError) {
      // 402: no active subscription, not a spent budget.
      const code = err.statusCode === 402 ? 'no_subscription' : 'ai_budget';
      return res.status(err.statusCode).json({ error: err.message, code });
    }
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent rewrite error');
    return res.status(502).json({ error: 'The agent could not start', code: 'failed' });
  }
});

const stopBody = z.object({ brandId: z.guid(), runId: z.guid().optional() });

/**
 * POST /api/content-drafts/:draftId/stop
 * Body: { brandId, runId? }
 * Stops the Content Agent's run on the draft (CE-027), the one the editor
 * shows when it names it: it keeps nothing of what it had. Answers
 * { stopped }: false when no run was under way.
 */
router.post('/:draftId/stop', async (req, res) => {
  const draftId = z.guid().safeParse(req.params.draftId);
  const parsed = stopBody.safeParse(req.body ?? {});
  if (!draftId.success || !parsed.success) {
    return res.status(400).json({ error: 'Invalid request', code: 'invalid' });
  }
  const { brandId, runId } = parsed.data;
  try {
    await assertBrandAccess(brandId, req.user.id);
    const { data: draft, error } = await supabaseAdmin
      .from('content_drafts')
      .select('brand_id')
      .eq('id', draftId.data)
      .maybeSingle();
    if (error) throw error;
    if (!draft || draft.brand_id !== brandId) {
      return res.status(404).json({ error: 'Draft not found', code: 'not_found' });
    }
    const stopped = await stopDraftRun(draftId.data, runId ?? null);
    // A run in the background lets go of the draft once it sees the stop;
    // one no server holds any more never would. The editor opens at once.
    // Only the claim a stopped run holds: a Stop on Fix open rules or the
    // brief (which hold none) leaves a Start or Rewrite on the same draft its
    // claim. A live page's Start runs as a Fix, and holds its own.
    for (const { claimed_at: claimedAt } of stopped) {
      if (!claimedAt) continue;
      const { error: letGoError } = await supabaseAdmin
        .from('content_drafts')
        .update({ agent_state: null, agent_state_at: new Date().toISOString() })
        .eq('id', draftId.data)
        .eq('agent_state', 'writing')
        .eq('agent_state_at', claimedAt);
      if (letGoError) throw letGoError;
    }
    return res.json({ stopped: stopped.length > 0 });
  } catch (err) {
    if (ERROR_CODES[err?.status]) {
      return res
        .status(err.status)
        .json({ error: err.message, code: err.code ?? ERROR_CODES[err.status] });
    }
    req.log.error({ err }, 'content draft agent stop error');
    return res.status(502).json({ error: 'The agent could not be stopped', code: 'failed' });
  }
});

export default router;
