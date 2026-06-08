import { Router } from 'express';
import { generateObject } from 'ai';
import { z } from 'zod';
import { resolveModel } from '../lib/ai-provider.js';
import { getSearchVolumes } from '../lib/dataforseo.js';
import { regionToLocationCode, languageToCode } from '../lib/dataforseo-codes.js';
import {
  requireFeature,
  enforceVolumeQuota,
  getVolumeQuotaStatus,
  PlanLimitError,
} from '../lib/plan-guard.js';
import supabaseAdmin from '../config/supabase.js';

const router = Router();

const AI_VOLUME_MULTIPLIER = parseFloat(process.env.AI_VOLUME_MULTIPLIER || '0.15');

const intentKeywordSchema = z.object({
  intent: z
    .enum([
      'comparison',
      'how-to',
      'what-is',
      'best-top',
      'vs-review',
      'recommendation',
      'problem-solving',
      'other',
    ])
    .describe('The primary search intent behind this prompt'),
  keywords: z
    .array(
      z
        .string()
        .describe(
          'A short Google head term — 1 to 3 words, category-level, measurable Google Ads volume',
        ),
    )
    .length(5)
    .describe(
      'Five broad, high-volume Google head terms that capture the category the prompt belongs to',
    ),
});

const INTENT_SYSTEM_PROMPT = `You are a keyword research expert. Given an AI search prompt, you must:

1. Determine the primary search intent (comparison, how-to, what-is, best-top, vs-review, recommendation, or problem-solving).
2. Generate exactly 5 short HEAD keywords that a user would type into Google when researching the same category.

CRITICAL: Output HEAD terms, NOT long-tail variants. Google Ads only returns search volume for keywords with measurable demand — long-tail strings like "best portable motion control for travel 2026" return 0. Drop modifiers and surface the underlying noun phrases.

Rules:
- 1 to 3 words per keyword (strict). Never more than 4.
- Generic, category-level. No brand names, no years, no superlatives ("best", "top") unless they are part of the natural head term.
- Lowercase only.
- Each of the 5 keywords must capture a different angle of the same category.
- Think "what category does this prompt belong to?" → then list the broadest searchable terms in that category.

Example A — prompt: "What are the best tools for managing remote teams?"
- Intent: best-top
- Keywords: ["project management software", "team collaboration tools", "remote work software", "team management apps", "online collaboration platform"]

Example B — prompt: "best portable motion control for travel 2026"
- Intent: best-top
- Keywords: ["camera slider", "motion control camera", "video stabilizer", "camera dolly", "time lapse equipment"]

Notice: NO "best", NO "2026", NO "for travel". Strip modifiers, keep the category nouns.`;

function mapVolumeRow(saved) {
  return {
    id: saved.id,
    promptId: saved.prompt_id,
    intent: saved.intent,
    keywords: saved.keywords,
    googleVolumes: saved.google_volumes,
    totalGoogleVolume: saved.total_google_volume,
    aiVolumeMultiplier: parseFloat(saved.ai_volume_multiplier),
    estAiVolume: saved.est_ai_volume,
    competitionIndex: saved.competition_index ?? null,
    competition: saved.competition ?? null,
    locationCode: saved.location_code,
    languageCode: saved.language_code,
    fetchedAt: saved.fetched_at,
  };
}

async function fetchAndSaveVolumes(promptId, keywords, intent, locationCode, languageCode) {
  const volumes = await getSearchVolumes(keywords, {
    locationCode: locationCode || undefined,
    languageCode: languageCode || undefined,
  });

  // google_volumes stays a { keyword: number } map for the UI. Competition is
  // aggregated per prompt as a volume-weighted average of the keyword indices.
  const googleVolumes = {};
  let totalGoogleVolume = 0;
  let competitionWeightedSum = 0;
  let competitionWeight = 0;
  for (const [keyword, data] of Object.entries(volumes)) {
    googleVolumes[keyword] = data.volume;
    totalGoogleVolume += data.volume;
    if (data.competitionIndex !== null && data.competitionIndex !== undefined) {
      competitionWeightedSum += data.competitionIndex * data.volume;
      competitionWeight += data.volume;
    }
  }

  const competitionIndex =
    competitionWeight > 0 ? Math.round(competitionWeightedSum / competitionWeight) : null;
  const competition =
    competitionIndex === null
      ? null
      : competitionIndex <= 33
        ? 'LOW'
        : competitionIndex <= 66
          ? 'MEDIUM'
          : 'HIGH';

  const estAiVolume = Math.round(totalGoogleVolume * AI_VOLUME_MULTIPLIER);

  const { data: saved, error: dbError } = await supabaseAdmin
    .from('prompt_volumes')
    .upsert(
      {
        prompt_id: promptId,
        intent,
        keywords,
        google_volumes: googleVolumes,
        total_google_volume: totalGoogleVolume,
        ai_volume_multiplier: AI_VOLUME_MULTIPLIER,
        est_ai_volume: estAiVolume,
        competition_index: competitionIndex,
        competition,
        location_code: locationCode || null,
        language_code: languageCode || null,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'prompt_id' },
    )
    .select()
    .single();

  if (dbError) throw new Error(dbError.message);
  return saved;
}

/**
 * POST /api/volumes/analyze
 * First-time analysis: LLM extracts intent + keywords, then fetches volumes.
 * If keywords already exist for this prompt, only refreshes volumes (skips LLM).
 * Pass force=true to re-generate keywords via LLM even if they exist.
 */
router.post('/analyze', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { remaining, orgId } = await enforceVolumeQuota(req.user.id);

    const { promptId, promptText, locationCode, languageCode, model, force } = req.body;

    if (!promptId || !promptText) {
      return res.status(400).json({ error: 'promptId and promptText are required' });
    }

    let resolvedLocationCode = locationCode;
    let resolvedLanguageCode = languageCode;
    if (resolvedLocationCode == null || resolvedLanguageCode == null) {
      const { data: brandRow } = await supabaseAdmin
        .from('prompts')
        .select('prompt_sets!inner(brands!inner(region, language))')
        .eq('id', promptId)
        .maybeSingle();
      const brand = brandRow?.prompt_sets?.brands;
      if (brand) {
        if (resolvedLocationCode == null) {
          resolvedLocationCode = regionToLocationCode(brand.region);
        }
        if (resolvedLanguageCode == null) {
          resolvedLanguageCode = languageToCode(brand.language);
        }
      }
    }

    let intent;
    let keywords;

    if (!force) {
      const { data: existing } = await supabaseAdmin
        .from('prompt_volumes')
        .select('intent, keywords')
        .eq('prompt_id', promptId)
        .single();

      if (existing?.keywords?.length) {
        intent = existing.intent;
        keywords = existing.keywords;
      }
    }

    if (!keywords) {
      const aiModel = resolveModel(model);
      const { object: intentResult } = await generateObject({
        model: aiModel,
        schema: intentKeywordSchema,
        system: INTENT_SYSTEM_PROMPT,
        prompt: `Analyze this AI search prompt and extract intent + 5 Google keywords:\n\n"${promptText}"`,
      });
      intent = intentResult.intent;
      keywords = intentResult.keywords;
    }

    const saved = await fetchAndSaveVolumes(
      promptId,
      keywords,
      intent,
      resolvedLocationCode,
      resolvedLanguageCode,
    );

    if (orgId) {
      await supabaseAdmin.from('volume_usage').insert({
        organization_id: orgId,
        action: 'analyze',
        prompt_count: 1,
      });
    }

    const result = mapVolumeRow(saved);
    return res.json({ ...result, remaining: remaining === -1 ? -1 : remaining - 1 });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    console.error('Volume analysis error:', error);
    return res.status(500).json({
      error: 'Failed to analyze prompt volume',
      details: error.message,
    });
  }
});

/**
 * POST /api/volumes/analyze-batch
 * Batch analysis. Uses saved keywords when available, calls LLM only for new prompts.
 * Pass force=true to re-generate all keywords via LLM.
 */
router.post('/analyze-batch', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { remaining, orgId } = await enforceVolumeQuota(req.user.id);

    const { prompts, locationCode, languageCode, model, force } = req.body;

    if (!Array.isArray(prompts) || prompts.length === 0) {
      return res.status(400).json({ error: 'prompts array is required and must not be empty' });
    }

    if (prompts.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 prompts per batch' });
    }

    const promptIds = prompts.map((p) => p.promptId);

    // Resolve DataForSEO location/language from the brand the prompts belong to,
    // unless the caller explicitly passed an override in the request body.
    let resolvedLocationCode = locationCode;
    let resolvedLanguageCode = languageCode;
    if (resolvedLocationCode == null || resolvedLanguageCode == null) {
      const { data: brandRow } = await supabaseAdmin
        .from('prompts')
        .select('prompt_sets!inner(brands!inner(region, language))')
        .in('id', promptIds)
        .limit(1)
        .maybeSingle();
      const brand = brandRow?.prompt_sets?.brands;
      if (brand) {
        if (resolvedLocationCode == null) {
          resolvedLocationCode = regionToLocationCode(brand.region);
        }
        if (resolvedLanguageCode == null) {
          resolvedLanguageCode = languageToCode(brand.language);
        }
      }
    }

    let existingMap = {};

    if (!force) {
      const { data: existingRows } = await supabaseAdmin
        .from('prompt_volumes')
        .select('prompt_id, intent, keywords')
        .in('prompt_id', promptIds);

      if (existingRows) {
        for (const row of existingRows) {
          if (row.keywords?.length) {
            existingMap[row.prompt_id] = {
              intent: row.intent,
              keywords: row.keywords,
            };
          }
        }
      }
    }

    const aiModel = resolveModel(model);
    const results = [];

    for (const { promptId, promptText } of prompts) {
      try {
        let intent;
        let keywords;

        const cached = existingMap[promptId];
        if (cached) {
          intent = cached.intent;
          keywords = cached.keywords;
        } else {
          const { object: intentResult } = await generateObject({
            model: aiModel,
            schema: intentKeywordSchema,
            system: INTENT_SYSTEM_PROMPT,
            prompt: `Analyze this AI search prompt and extract intent + 5 Google keywords:\n\n"${promptText}"`,
          });
          intent = intentResult.intent;
          keywords = intentResult.keywords;
        }

        const saved = await fetchAndSaveVolumes(
          promptId,
          keywords,
          intent,
          resolvedLocationCode,
          resolvedLanguageCode,
        );
        results.push(mapVolumeRow(saved));
      } catch (err) {
        results.push({ promptId, error: err.message });
      }
    }

    const successCount = results.filter((r) => !r.error).length;
    if (successCount > 0 && orgId) {
      await supabaseAdmin.from('volume_usage').insert({
        organization_id: orgId,
        action: 'analyze-batch',
        prompt_count: successCount,
      });
    }

    return res.json({ results, remaining: remaining === -1 ? -1 : remaining - 1 });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    console.error('Batch volume analysis error:', error);
    return res.status(500).json({
      error: 'Failed to analyze prompt volumes',
      details: error.message,
    });
  }
});

/**
 * POST /api/volumes/refresh
 * Refreshes Google volumes for all prompts that already have saved keywords.
 * Does NOT call LLM — only re-fetches DataForSEO volumes.
 * Body: { brandId, locationCode?, languageCode? }
 */
router.post('/refresh', requireFeature('prompt_volumes'), async (req, res) => {
  try {
    const { remaining, orgId } = await enforceVolumeQuota(req.user.id);

    const { brandId, locationCode, languageCode } = req.body;

    if (!brandId) {
      return res.status(400).json({ error: 'brandId is required' });
    }

    let resolvedLocationCode = locationCode;
    let resolvedLanguageCode = languageCode;
    if (resolvedLocationCode == null || resolvedLanguageCode == null) {
      const { data: brand } = await supabaseAdmin
        .from('brands')
        .select('region, language')
        .eq('id', brandId)
        .maybeSingle();
      if (brand) {
        if (resolvedLocationCode == null) {
          resolvedLocationCode = regionToLocationCode(brand.region);
        }
        if (resolvedLanguageCode == null) {
          resolvedLanguageCode = languageToCode(brand.language);
        }
      }
    }

    const { data: promptSets } = await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .eq('brand_id', brandId);

    if (!promptSets?.length) {
      return res.json({ results: [], refreshed: 0, remaining });
    }

    const { data: prompts } = await supabaseAdmin
      .from('prompts')
      .select('id')
      .in(
        'prompt_set_id',
        promptSets.map((ps) => ps.id),
      );

    if (!prompts?.length) {
      return res.json({ results: [], refreshed: 0, remaining });
    }

    const { data: existingVolumes } = await supabaseAdmin
      .from('prompt_volumes')
      .select('prompt_id, intent, keywords')
      .in(
        'prompt_id',
        prompts.map((p) => p.id),
      );

    if (!existingVolumes?.length) {
      return res.json({ results: [], refreshed: 0, remaining });
    }

    const results = [];

    for (const row of existingVolumes) {
      try {
        const saved = await fetchAndSaveVolumes(
          row.prompt_id,
          row.keywords,
          row.intent,
          resolvedLocationCode,
          resolvedLanguageCode,
        );
        results.push(mapVolumeRow(saved));
      } catch (err) {
        results.push({ promptId: row.prompt_id, error: err.message });
      }
    }

    const refreshed = results.filter((r) => !r.error).length;
    if (refreshed > 0 && orgId) {
      await supabaseAdmin.from('volume_usage').insert({
        organization_id: orgId,
        action: 'refresh',
        prompt_count: refreshed,
      });
    }

    return res.json({
      results,
      refreshed,
      remaining: remaining === -1 ? -1 : remaining - 1,
    });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return res.status(error.statusCode).json({
        success: false,
        error: 'quota_exceeded',
        message: error.message,
      });
    }
    console.error('Volume refresh error:', error);
    return res.status(500).json({
      error: 'Failed to refresh volumes',
      details: error.message,
    });
  }
});

/**
 * GET /api/volumes/brand/:brandId
 */
router.get('/brand/:brandId', async (req, res) => {
  try {
    const { brandId } = req.params;

    const { data: promptSets, error: psError } = await supabaseAdmin
      .from('prompt_sets')
      .select('id')
      .eq('brand_id', brandId);

    if (psError) {
      return res.status(500).json({
        error: 'Failed to fetch prompt sets',
        details: psError.message,
      });
    }

    if (!promptSets || promptSets.length === 0) {
      return res.json({ volumes: [] });
    }

    const setIds = promptSets.map((ps) => ps.id);

    const { data: prompts, error: pError } = await supabaseAdmin
      .from('prompts')
      .select('id, text, category, prompt_set_id')
      .in('prompt_set_id', setIds);

    if (pError) {
      return res.status(500).json({ error: 'Failed to fetch prompts', details: pError.message });
    }

    if (!prompts || prompts.length === 0) {
      return res.json({ volumes: [] });
    }

    const promptIds = prompts.map((p) => p.id);

    const { data: volumes, error: vError } = await supabaseAdmin
      .from('prompt_volumes')
      .select('*')
      .in('prompt_id', promptIds)
      .order('est_ai_volume', { ascending: false });

    if (vError) {
      return res.status(500).json({ error: 'Failed to fetch volumes', details: vError.message });
    }

    const promptMap = {};
    for (const p of prompts) {
      promptMap[p.id] = { text: p.text, category: p.category };
    }

    const enriched = (volumes || []).map((v) => ({
      ...mapVolumeRow(v),
      promptText: promptMap[v.prompt_id]?.text || '',
      promptCategory: promptMap[v.prompt_id]?.category || '',
    }));

    const quota = await getVolumeQuotaStatus(req.user.id);

    return res.json({ volumes: enriched, quota });
  } catch (error) {
    console.error('Fetch volumes error:', error);
    return res.status(500).json({
      error: 'Failed to fetch volume data',
      details: error.message,
    });
  }
});

export default router;
