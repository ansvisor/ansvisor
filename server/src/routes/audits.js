/**
 * Site Audit routes — implements the AEO/GEO scoring rubric ourselves rather
 * than calling any third-party API.
 *
 *   POST /api/audits        { url, brandId }  → run a single-page audit
 *   GET  /api/audits/:id                      → fetch a stored audit + signals
 *   GET  /api/audits?brandId=…                → recent audits for a brand
 *
 * The audit runs synchronously: one Scrape.do fetch, the deterministic signal
 * engine, one batched LLM round-trip for the semantic signals, and a Wikidata
 * lookup — a few seconds total. Crawl / multi-page moves to a job later.
 */

import { Router } from 'express';
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
import { runSignals } from '../lib/audit/engine.js';
import { evaluateLlmSignals } from '../lib/audit/llm-signals.js';
import { evaluateBrandEntity } from '../lib/audit/external-signals.js';
import { generateRecommendations } from '../lib/audit/recommendations.js';
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

/**
 * Run the full audit (fetch → deterministic + LLM + Wikidata → score →
 * persist) for an already-created `running` row. Runs detached from the
 * request so the client gets an id immediately and polls GET /:id. Always
 * resolves — on failure it marks the row `failed` rather than throwing.
 */
async function runAuditJob(auditId, brandId, url, orgId) {
  try {
    // The brand name is only needed for the Wikidata brand-entity lookup. The
    // page is otherwise evaluated entirely on its own terms — the LLM infers
    // the page's own target topic from its content, so an arbitrary URL (a
    // competitor blog, any page) is never judged against this brand's topics.
    const { data: brandRow } = await supabaseAdmin
      .from('brands')
      .select('name')
      .eq('id', brandId)
      .single();

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
    // degrades to [] on failure so it never blocks completion).
    const recommendations = await generateRecommendations(ctx, { results });

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

/** Lowercased host of a URL with a leading www. stripped (null on failure). */
function normHost(u) {
  try {
    return new URL(u).host.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

// GET /api/audits/trend?brandId=… — completed audits of the brand's PRIMARY
// domain over time (score + category scores), for the hub trend chart.
// Registered before /:id so "trend" isn't matched as an audit id.
router.get('/trend', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;
  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const { data: domainRows } = await supabaseAdmin
      .from('brand_domains')
      .select('domain, is_primary')
      .eq('brand_id', brandId);
    const primary =
      (domainRows ?? []).find((d) => d.is_primary)?.domain ?? (domainRows ?? [])[0]?.domain ?? null;
    const primaryHost = primary
      ? primary
          .replace(/^https?:\/\//, '')
          .replace(/^www\./i, '')
          .toLowerCase()
      : null;

    const { data: rows } = await supabaseAdmin
      .from('site_audits')
      .select('id, url, final_url, total_score, category_scores, created_at')
      .eq('brand_id', brandId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
      .limit(500);

    // Keep only audits of the primary domain (match on host of url / final_url).
    const points = (rows ?? [])
      .filter((r) => {
        if (!primaryHost) return false;
        const h = normHost(r.final_url) ?? normHost(r.url);
        return h === primaryHost;
      })
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        totalScore: r.total_score === null ? null : Number(r.total_score),
        categoryScores: r.category_scores ?? {},
      }));

    return res.json({ success: true, primaryDomain: primary, points });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    req.log.error({ err }, 'audit trend failed');
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

// GET /api/audits?brandId=… — recent audits for a brand (list, no signals)
router.get('/', async (req, res) => {
  const userId = req.user?.id;
  const { brandId } = req.query;

  if (!brandId) {
    return res.status(400).json({ success: false, message: 'brandId is required' });
  }

  try {
    await assertBrandAccess(brandId, userId);

    const { data: audits } = await supabaseAdmin
      .from('site_audits')
      .select('id, url, status, total_score, signals_evaluated, signals_total, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(50);

    return res.json({ success: true, audits: audits ?? [] });
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
