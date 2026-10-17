/**
 * Site Audit routes — implements the AEO/GEO scoring rubric ourselves rather
 * than calling any third-party API.
 *
 *   POST /api/audits        { url, brandId }  → run a single-page audit
 *   GET  /api/audits/:id                      → fetch a stored audit + signals
 *   GET  /api/audits?brandId=…&limit=&offset= → recent audits for a brand (paged)
 *
 * The audit runs synchronously: one Scrape.do fetch, the deterministic signal
 * engine, one batched LLM round-trip for the semantic signals, and a Wikidata
 * lookup — a few seconds total. Crawl / multi-page moves to a job later.
 */

import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import logger from '../lib/logger.js';
import { assertBrandAccess } from '../lib/access.js';
import {
  requireFeature,
  enforceSiteAuditQuota,
  getSiteAuditQuotaStatus,
  getOrgIdForUser,
  PlanLimitError,
} from '../lib/plan-guard.js';
import { buildAuditContext } from '../lib/audit/context.js';
import { normStoredDomain } from '../lib/audit/host.js';
import {
  buildAuditPages,
  buildTrendPoints,
  pageKey,
  parseListPage,
  TREND_LIMIT,
} from '../lib/audit/history.js';
import { readAllRpcRows } from '../lib/rpc-pages.js';
import { AUTHORITY_CATEGORIES, buildOverview, primaryPages } from '../lib/audit/overview.js';
import {
  aiVisitsByPage,
  buildOpportunities,
  competitorGapPages,
  opportunityKey,
} from '../lib/audit/opportunities.js';
import { ENGINE_THRESHOLDS } from '../config/action-engine.js';
import { runSignals } from '../lib/audit/engine.js';
import { evaluateLlmSignals } from '../lib/audit/llm-signals.js';
import { evaluateBrandEntity } from '../lib/audit/external-signals.js';
import { brandFactsFor, generateRecommendations } from '../lib/audit/recommendations.js';
import { scoreAudit } from '../lib/audit/scorer.js';
import { signalsByKey, TOTAL_SIGNALS, RUBRIC_VERSION } from '../lib/audit/rubric.js';

const router = Router();

/**
 * Merge a stored audit row + its signal results with the rubric copy the UI
 * needs (label / what / why / howToFix / impactTier).
 */
function assembleAudit(audit, signalRows) {
  const signals = signalRows.map((row) => {
    const meta = signalsByKey[row.signal_key] ?? {};
    return {
      key: row.signal_key,
      category: row.category ?? meta.category ?? null,
      status: row.status,
      score: row.score === null ? null : Number(row.score),
      evidence: row.evidence ?? {},
      label: meta.label ?? row.signal_key,
      what: meta.what ?? null,
      why: meta.why ?? null,
      howToFix: meta.howToFix ?? null,
      impactTier: meta.impactTier ?? null,
    };
  });

  return {
    id: audit.id,
    brandId: audit.brand_id,
    url: audit.url,
    finalUrl: audit.final_url ?? null,
    status: audit.status,
    totalScore: audit.total_score === null ? null : Number(audit.total_score),
    categoryScores: audit.category_scores ?? {},
    signalsEvaluated: audit.signals_evaluated ?? null,
    signalsTotal: audit.signals_total ?? TOTAL_SIGNALS,
    rubricVersion: audit.rubric_version ?? RUBRIC_VERSION,
    error: audit.error ?? null,
    createdAt: audit.created_at,
    completedAt: audit.completed_at ?? null,
    signals,
    recommendations: audit.recommendations ?? [],
  };
}

/** The brand's primary domain as stored (else its first domain), or null. */
async function primaryDomainOf(brandId) {
  const { data: domainRows } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary')
    .eq('brand_id', brandId);
  return (
    (domainRows ?? []).find((d) => d.is_primary)?.domain ?? (domainRows ?? [])[0]?.domain ?? null
  );
}

// 20 audits × 47 signals stays under PostgREST's 1000-row page.
const ISSUE_COUNT_CHUNK = 20;

/** Every audit of the brand, newest first, read past PostgREST's 1000-row page. */
function readBrandAudits(brandId) {
  return readAllRpcRows('site_audits', (from, to) =>
    supabaseAdmin
      .from('site_audits')
      .select('id, url, final_url, status, total_score, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
}

/** Rows for the given audit ids, read a chunk of ids at a time by `query`. */
async function readByAuditIds(ids, chunkSize, query) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map(query));
  const rows = [];
  for (const { data, error } of results) {
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

/** Failed and warning signals per audit id. */
async function countIssues(auditIds) {
  const rows = await readByAuditIds(auditIds, ISSUE_COUNT_CHUNK, (ids) =>
    supabaseAdmin
      .from('audit_signal_results')
      .select('audit_id')
      .in('audit_id', ids)
      .in('status', ['fail', 'warn']),
  );
  const counts = new Map();
  for (const row of rows) counts.set(row.audit_id, (counts.get(row.audit_id) ?? 0) + 1);
  return counts;
}

/**
 * Run the full audit (fetch → deterministic + LLM + Wikidata → score →
 * persist) for an already-created `running` row. Runs detached from the
 * request so the client gets an id immediately and polls GET /:id. Always
 * resolves — on failure it marks the row `failed` rather than throwing.
 */
async function runAuditJob(auditId, brandId, url, orgId) {
  try {
    // The brand name is needed for the Wikidata brand-entity lookup. The page
    // is otherwise evaluated entirely on its own terms — the LLM infers the
    // page's own target topic from its content, so an arbitrary URL (a
    // competitor blog, any page) is never judged against this brand's topics.
    const [{ data: brandRow }, { data: domainRows }] = await Promise.all([
      supabaseAdmin.from('brands').select('name, description').eq('id', brandId).single(),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    ]);

    const ctx = await buildAuditContext(url);

    // Deterministic engine, the batched LLM pass, and the Wikidata lookup run
    // concurrently. The latter two degrade to 'na' internally on failure.
    const [deterministic, llm, brandEntity] = await Promise.all([
      runSignals(ctx),
      evaluateLlmSignals(ctx),
      evaluateBrandEntity(brandRow?.name),
    ]);
    const results = [...deterministic, ...llm, brandEntity];

    const { totalScore, categoryScores } = scoreAudit(results);
    const signalsEvaluated = results.filter((r) => r.status !== 'na').length;

    const signalRows = results.map((r) => ({
      audit_id: auditId,
      signal_key: r.key,
      category: signalsByKey[r.key]?.category ?? null,
      status: r.status,
      score: r.score,
      evidence: r.evidence ?? {},
    }));
    const { error: sigErr } = await supabaseAdmin.from('audit_signal_results').insert(signalRows);
    if (sigErr) throw sigErr;

    // AI fix recommendations for the fixable failing signals (own LLM call;
    // degrades to [] on failure so it never blocks completion). Brand facts
    // (name, description, domains) may be reused only on the brand's own pages.
    const recommendations = await generateRecommendations(ctx, {
      results,
      brand: brandFactsFor(ctx.url, brandRow, domainRows),
      auditId,
    });

    const { error: completeErr } = await supabaseAdmin
      .from('site_audits')
      .update({
        status: 'completed',
        final_url: ctx.url,
        total_score: totalScore,
        category_scores: categoryScores,
        signals_evaluated: signalsEvaluated,
        signals_total: TOTAL_SIGNALS,
        recommendations,
        completed_at: new Date().toISOString(),
      })
      .eq('id', auditId);
    // Don't let a failed completion update leave the row stuck in 'running'.
    if (completeErr) throw completeErr;

    // Charge the monthly quota only for audits that actually completed.
    if (orgId) {
      await supabaseAdmin
        .from('site_audit_usage')
        .insert({ organization_id: orgId, audit_id: auditId });
    }
  } catch (err) {
    logger.error({ err, auditId, brandId }, 'audit run failed');
    await supabaseAdmin
      .from('site_audits')
      .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
      .eq('id', auditId);
  }
}

/**
 * Enforce the monthly quota, create the `running` row, and kick off the
 * detached audit job. Shared by the dashboard POST handler and the internal
 * MCP endpoint. Returns the assembled (still-running) audit. Throws
 * PlanLimitError when the quota is exhausted — nothing is created in that case.
 */
export async function createAndRunAudit(brandId, url, orgId) {
  // Enforce the monthly Site Audit quota (Starter 100 / Growth 500;
  // Enterprise & self-hosted unlimited). Throws PlanLimitError when exhausted.
  await enforceSiteAuditQuota(orgId);

  const { data: created, error: insErr } = await supabaseAdmin
    .from('site_audits')
    .insert({ brand_id: brandId, url, status: 'running', rubric_version: RUBRIC_VERSION })
    .select('*')
    .single();
  if (insErr) throw insErr;

  // Fire-and-forget — the work continues after the response is sent.
  runAuditJob(created.id, brandId, url, orgId).catch((err) =>
    logger.error({ err, auditId: created.id, brandId }, 'audit background job crashed'),
  );

  return assembleAudit(created, []);
}

/** Pages one bulk request may audit: the Pages list's own page size. */
export const BULK_AUDIT_MAX = 50;

/** Bulk audits run at once; the rest wait their turn, still `running`. */
export const BULK_AUDIT_CONCURRENCY = 3;

// One pool for every bulk request, so 50 re-audits don't fetch and score 50
// pages at the same time.
const bulkQueue = [];
let bulkActive = 0;

function drainBulkQueue() {
  while (bulkActive < BULK_AUDIT_CONCURRENCY && bulkQueue.length > 0) {
    const job = bulkQueue.shift();
    bulkActive += 1;
    job()
      .catch((err) => logger.error({ err }, 'bulk audit job crashed'))
      .finally(() => {
        bulkActive -= 1;
        drainBulkQueue();
      });
  }
}

/**
 * Start audits of several pages of a brand. The quota is checked for all of
 * them first, so either every page is queued or none is (PlanLimitError).
 * Repeat spellings of one page are audited once. Returns the running rows.
 */
export async function createAndQueueAudits(brandId, urls, orgId) {
  const byPage = new Map();
  for (const url of urls) {
    const key = pageKey(url)?.key;
    if (key && !byPage.has(key)) byPage.set(key, url);
  }
  const unique = [...byPage.values()];

  await enforceSiteAuditQuota(orgId, unique.length);

  const { data: created, error } = await supabaseAdmin
    .from('site_audits')
    .insert(
      unique.map((url) => ({
        brand_id: brandId,
        url,
        status: 'running',
        rubric_version: RUBRIC_VERSION,
      })),
    )
    .select('*');
  if (error) throw error;

  for (const row of created) {
    bulkQueue.push(() => runAuditJob(row.id, brandId, row.url, orgId));
  }
  drainBulkQueue();

  return created.map((row) => assembleAudit(row, []));
}

const bulkSchema = z.object({
  brandId: z.guid(),
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(BULK_AUDIT_MAX)
    .refine((urls) => urls.every((url) => pageKey(url)), 'Every URL must be a full URL'),
});

/**
 * Internal/MCP entry point: start an audit addressed by brand id + url.
 * Org-ownership is verified upstream in the web MCP layer; here we resolve the
 * brand's org ourselves so the quota is charged authoritatively server-side.
 * Throws a 404-status error when the brand doesn't exist.
 */
export async function startSiteAuditForBrand(brandId, url) {
  const { data: brand } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (!brand) {
    const err = new Error('Brand not found');
    err.status = 404;
    throw err;
  }
  return createAndRunAudit(brandId, url, brand.organization_id);
}

// POST /api/audits — start an audit. Returns immediately with a `running`
// row; the client polls GET /:id until it flips to completed/failed.
router.post('/', requireFeature('content_optimization'), async (req, res) => {
  const userId = req.user?.id;
  const { url, brandId } = req.body || {};

  if (!url || !brandId) {
    return res.status(400).json({ success: false, message: 'url and brandId are required' });
  }

  try {
    const { orgId } = await assertBrandAccess(brandId, userId);
    const audit = await createAndRunAudit(brandId, url, orgId);
    return res.status(202).json({ success: true, audit });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit start failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/audits/bulk — re-audit several pages at once ({ brandId, urls },
// up to BULK_AUDIT_MAX). All of them must fit the monthly quota, or none
// starts. Returns 202 with the running rows; they run a few at a time.
router.post('/bulk', requireFeature('content_optimization'), async (req, res) => {
  const userId = req.user?.id;
  const parsed = bulkSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid request',
    });
  }
  const { brandId, urls } = parsed.data;

  try {
    const { orgId } = await assertBrandAccess(brandId, userId);
    const audits = await createAndQueueAudits(brandId, urls, orgId);
    return res.status(202).json({ success: true, audits });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'bulk audit start failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/quota — the org's monthly audit allowance (used/limit/remaining).
// Registered before /:id so "quota" isn't matched as an audit id.
router.get('/quota', async (req, res) => {
  try {
    const orgId = await getOrgIdForUser(req.user?.id);
    const quota = await getSiteAuditQuotaStatus(orgId);
    return res.json({ success: true, quota });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    req.log.error({ err }, 'audit quota failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/trend?brandId=… — completed audits of the brand's PRIMARY
// domain over time (score + category scores), for the hub trend chart. Reads
// the newest TREND_LIMIT completed audits so the chart always ends at the
// latest one, then returns the points oldest → newest.
// Registered before /:id so "trend" isn't matched as an audit id.
router.get('/trend', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const primary = await primaryDomainOf(brandId);
    const primaryHost = normStoredDomain(primary);

    const { data: rows } = await supabaseAdmin
      .from('site_audits')
      .select('id, url, final_url, total_score, category_scores, created_at')
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(TREND_LIMIT);

    const points = buildTrendPoints(rows, primaryHost);

    return res.json({ success: true, primaryDomain: primary, points });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit trend failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/pages?brandId=…&limit=50&offset=0 — one row per audited
// page (repeat audits of a URL share it), most recently audited first, with
// its latest score, the previous one, a status, its trend, its open issues
// and its runs. `total` is the number of pages, for paging.
// Registered before /:id so "pages" isn't matched as an audit id.
router.get('/pages', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  const { limit, offset } = parseListPage(req.query);
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const [primary, { data: rows, error }] = await Promise.all([
      primaryDomainOf(brandId),
      readBrandAudits(brandId),
    ]);
    if (error) throw error;

    const all = buildAuditPages(rows);
    const pages = all.slice(offset, offset + limit);
    const issues = await countIssues(pages.filter((p) => p.score !== null).map((p) => p.auditId));

    return res.json({
      success: true,
      pages: pages.map((p) => ({
        ...p,
        issues: p.score === null ? null : (issues.get(p.auditId) ?? 0),
      })),
      total: all.length,
      primaryHost: normStoredDomain(primary),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit pages failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/overview?brandId=… — the hub's KPI cards: site score and
// its change, pages audited, and the Authority / E-E-A-T scores with their
// biggest gaps, over the latest audit of each page on the primary domain.
// Registered before /:id so "overview" isn't matched as an audit id.
router.get('/overview', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const [primary, { data: rows, error }] = await Promise.all([
      primaryDomainOf(brandId),
      readBrandAudits(brandId),
    ]);
    if (error) throw error;

    const primaryHost = normStoredDomain(primary);
    const { own, otherPages } = primaryPages(buildAuditPages(rows), primaryHost);
    const ids = own.map((p) => p.auditId);

    const [scoreRows, failingRows] = await Promise.all([
      readByAuditIds(ids, 100, (chunk) =>
        supabaseAdmin.from('site_audits').select('id, category_scores').in('id', chunk),
      ),
      // 50 audits × 16 Authority and E-E-A-T signals stays under 1000 rows.
      readByAuditIds(ids, 50, (chunk) =>
        supabaseAdmin
          .from('audit_signal_results')
          .select('audit_id, signal_key')
          .in('audit_id', chunk)
          .in('category', AUTHORITY_CATEGORIES)
          .in('status', ['fail', 'warn']),
      ),
    ]);
    const categoryScoresById = new Map(scoreRows.map((r) => [r.id, r.category_scores ?? {}]));

    return res.json({
      success: true,
      overview: {
        primaryHost,
        otherPages,
        ...buildOverview(own, categoryScoresById, failingRows),
      },
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit overview failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

/** The window the Opportunities inbox counts AI visits and citations over. */
const OPPORTUNITY_VISITS_DAYS = 30;

/**
 * Pages closest to the prompts a competitor is cited on and the brand never
 * is, over the last 30 days (empty without competitor domains).
 */
async function competitorOpportunityPages(brandId, sitePages) {
  const [{ data: competitors, error: compErr }, { data: domains, error: domErr }] =
    await Promise.all([
      supabaseAdmin.from('competitors').select('name, domain').eq('brand_id', brandId),
      supabaseAdmin.from('brand_domains').select('domain').eq('brand_id', brandId),
    ]);
  if (compErr) throw compErr;
  if (domErr) throw domErr;

  const competitorNames = new Map();
  for (const c of competitors ?? []) {
    const host = normStoredDomain(c.domain);
    if (host) competitorNames.set(host, c.name);
  }
  const ownHosts = (domains ?? []).map((d) => normStoredDomain(d.domain)).filter(Boolean);
  if (competitorNames.size === 0 || ownHosts.length === 0) return [];

  const { data: prompts, error } = await supabaseAdmin.rpc('audit_competitor_cited_prompts', {
    p_brand_id: brandId,
    p_since: new Date(Date.now() - OPPORTUNITY_VISITS_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    p_own_domains: ownHosts,
    p_competitor_domains: [...competitorNames.keys()],
  });
  // A server deployed before migration 00166 lists the other sources without this one.
  if (error?.code === 'PGRST202') return [];
  if (error) throw error;

  const gaps = (prompts ?? []).filter((p) => Number(p.own_results) === 0);
  if (gaps.length === 0) return [];
  const { data: targetUrls, error: targetErr } = await supabaseAdmin
    .from('prompt_target_urls')
    .select('prompt_id, url')
    .in(
      'prompt_id',
      gaps.map((p) => p.prompt_id),
    );
  if (targetErr) throw targetErr;

  return competitorGapPages({
    prompts: gaps,
    targetUrls: targetUrls ?? [],
    sitePages,
    competitorNames,
  });
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * AI visits per page over the last 30 days (null when the brand has neither
 * Google Analytics nor the tracking snippet, so 0 would be a guess).
 */
async function opportunityAiVisits(brandId, urls) {
  if (urls.length === 0) return new Map();
  const [{ data: brand }, { data: logs }] = await Promise.all([
    supabaseAdmin.from('brands').select('ga_property_id').eq('id', brandId).maybeSingle(),
    supabaseAdmin.from('ai_traffic_logs').select('id').eq('brand_id', brandId).limit(1),
  ]);
  if (!brand?.ga_property_id && (logs ?? []).length === 0) return null;

  const now = Date.now();
  const from = isoDay(now - OPPORTUNITY_VISITS_DAYS * 24 * 60 * 60 * 1000);
  const { data, error } = await supabaseAdmin.rpc('ae_page_traffic_evidence', {
    p_brand_id: brandId,
    p_pages: urls,
    p_cur_from: from,
    p_cur_to: isoDay(now),
    // No comparison window: the previous one is left empty.
    p_prev_from: from,
    p_prev_to: isoDay(now - (OPPORTUNITY_VISITS_DAYS + 1) * 24 * 60 * 60 * 1000),
  });
  if (error) throw error;
  return aiVisitsByPage(data);
}

// GET /api/audits/opportunities?brandId=… — the Opportunities inbox (SA-004):
// the brand's pages worth auditing, each with why (Google Analytics pages
// without AI traffic, pages never audited or audited long ago), pinned pages
// first, plus the excluded pages to put back.
// Registered before /:id so "opportunities" isn't matched as an audit id.
router.get('/opportunities', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const [primary, gaPages, sitePages, audits, prefs] = await Promise.all([
      primaryDomainOf(brandId),
      // Up to 30% of GA's 5,000 pages a day: past PostgREST's 1000-row page.
      readAllRpcRows('page_opportunities', (from, to) =>
        supabaseAdmin
          .from('page_opportunities')
          .select(
            'landing_page, value_signal, value_percentile, sessions, citation_state, citations',
          )
          .eq('brand_id', brandId)
          .eq('kind', 'no_ai_traffic')
          .is('resolved_at', null)
          .order('landing_page', { ascending: true })
          .range(from, to),
      ),
      supabaseAdmin
        .from('site_pages')
        .select('url, title, h1, description, ga_sessions, ai_citations')
        .eq('brand_id', brandId),
      readBrandAudits(brandId),
      supabaseAdmin
        .from('site_audit_page_prefs')
        .select('page_key, url, state')
        .eq('brand_id', brandId),
    ]);
    for (const read of [gaPages, sitePages, audits, prefs]) if (read.error) throw read.error;

    const competitorPages = await competitorOpportunityPages(brandId, sitePages.data ?? []);
    const { rows, excluded } = buildOpportunities({
      primaryHost: normStoredDomain(primary),
      gaPages: gaPages.data ?? [],
      sitePages: sitePages.data ?? [],
      auditPages: buildAuditPages(audits.data),
      competitorPages,
      prefs: prefs.data ?? [],
      staleDays: ENGINE_THRESHOLDS.detection.auditMaxAgeDays,
    });
    const visits = await opportunityAiVisits(
      brandId,
      rows.map((r) => r.url),
    );

    return res.json({
      success: true,
      opportunities: rows.map((r) => ({
        ...r,
        aiVisits: visits === null ? null : (visits.get(r.url) ?? 0),
      })),
      excluded,
      staleDays: ENGINE_THRESHOLDS.detection.auditMaxAgeDays,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit opportunities failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

const prefsSchema = z.object({
  brandId: z.guid(),
  urls: z
    .array(z.string().trim().min(1).max(2048))
    .min(1)
    .max(BULK_AUDIT_MAX)
    .refine((urls) => urls.every((url) => opportunityKey(url)), 'Every URL must be a full URL'),
  // null clears the page's pin or exclusion.
  state: z.enum(['pinned', 'excluded']).nullable(),
});

// PUT /api/audits/opportunities/prefs — pin, exclude or clear pages of the
// Opportunities inbox ({ brandId, urls, state }).
router.put('/opportunities/prefs', async (req, res) => {
  const userId = req.user?.id;
  const parsed = prefsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid request',
    });
  }
  const { brandId, urls, state } = parsed.data;

  try {
    await assertBrandAccess(brandId, userId);

    const byKey = new Map(urls.map((url) => [opportunityKey(url), url]));
    const { error } =
      state === null
        ? await supabaseAdmin
            .from('site_audit_page_prefs')
            .delete()
            .eq('brand_id', brandId)
            .in('page_key', [...byKey.keys()])
        : await supabaseAdmin.from('site_audit_page_prefs').upsert(
            [...byKey].map(([pageKeyValue, url]) => ({
              brand_id: brandId,
              page_key: pageKeyValue,
              url,
              state,
              created_by: userId ?? null,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'brand_id,page_key' },
          );
    if (error) throw error;

    return res.json({ success: true, pages: byKey.size, state });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit opportunity prefs failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits/:id — fetch one stored audit with its signals
router.get('/:id', async (req, res) => {
  const userId = req.user?.id;
  const { id } = req.params;

  try {
    const { data: audit } = await supabaseAdmin
      .from('site_audits')
      .select('*')
      .eq('id', id)
      .single();
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit not found' });
    }

    await assertBrandAccess(audit.brand_id, userId);

    const { data: signalRows } = await supabaseAdmin
      .from('audit_signal_results')
      .select('*')
      .eq('audit_id', id);

    return res.json({ success: true, audit: assembleAudit(audit, signalRows ?? []) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit fetch failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/audits?brandId=…&limit=50&offset=0 — recent audits for a brand,
// newest first (list, no signals). `total` is the brand's full audit count so
// the client can page; omitting limit/offset returns the newest 50 as before.
router.get('/', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  const { limit, offset } = parseListPage(req.query);

  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const { data: audits, count } = await supabaseAdmin
      .from('site_audits')
      .select('id, url, status, total_score, signals_evaluated, signals_total, created_at', {
        count: 'exact',
      })
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);

    return res.json({ success: true, audits: audits ?? [], total: count ?? 0 });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit list failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/audits/:id — remove an audit (signal rows cascade via FK)
router.delete('/:id', async (req, res) => {
  const userId = req.user?.id;
  const { id } = req.params;

  try {
    const { data: audit } = await supabaseAdmin
      .from('site_audits')
      .select('id, brand_id')
      .eq('id', id)
      .single();
    if (!audit) {
      return res.status(404).json({ success: false, message: 'Audit not found' });
    }

    await assertBrandAccess(audit.brand_id, userId);

    const { error } = await supabaseAdmin.from('site_audits').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit delete failed');
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
