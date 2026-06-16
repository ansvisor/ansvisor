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
import { assertBrandAccess } from '../lib/access.js';
import { requireFeature, enforceSiteAuditQuota, PlanLimitError } from '../lib/plan-guard.js';
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
    console.error('[audit] run failed:', err.message);
    await supabaseAdmin
      .from('site_audits')
      .update({ status: 'failed', error: err.message, completed_at: new Date().toISOString() })
      .eq('id', auditId);
  }
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
      console.error('[audit] background job crashed:', err.message),
    );

    return res.status(202).json({ success: true, audit: assembleAudit(created, []) });
  } catch (err) {
    if (err instanceof PlanLimitError) {
      return res
        .status(err.statusCode)
        .json({ success: false, error: 'quota_exceeded', message: err.message });
    }
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message });
    }
    console.error('[audit] start failed:', err.message);
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
    console.error('[audit] fetch failed:', err.message);
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
    console.error('[audit] list failed:', err.message);
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
    console.error('[audit] delete failed:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
