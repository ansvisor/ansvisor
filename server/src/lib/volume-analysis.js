import { resolveModel } from '../lib/ai-provider.js';
import { regionToLocationCode, languageToCode } from '../lib/dataforseo-codes.js';
import supabaseAdmin from '../config/supabase.js';
import { AI_VOLUME_MULTIPLIER, extractIntentKeywords } from '../lib/intent-extraction.js';
import { getSearchVolumes } from './dataforseo.js';
import logger from './logger.js';

export function mapVolumeRow(saved) {
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

export async function fetchAndSaveVolumes(promptId, keywords, intent, locationCode, languageCode) {
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
 * PostgREST caps an un-paginated select at 1000 rows, and an `.in()` filter
 * travels in the query string rather than the body — a brand near the
 * 1000-prompt ceiling would truncate silently on the first count and overflow
 * the request line on the second (#714, #740, #741). Both reads below page,
 * and scope through the prompt_sets embed so no list of prompt ids is ever
 * assembled.
 */
const PAGE_SIZE = 1000;

/**
 * Ceiling on what one brand can page in. A backend that kept answering full
 * pages would otherwise spin this loop forever, and the caller is a background
 * run with nobody waiting on it to notice. The largest brand allowed today
 * holds 1000 prompts, so this leaves an order of magnitude of headroom.
 */
const MAX_PAGED_ROWS = 50_000;

async function fetchAllPages(buildQuery) {
  const rows = [];
  for (let from = 0; from < MAX_PAGED_ROWS; from += PAGE_SIZE) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function fetchPromptSetIds(brandId) {
  const { data, error } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);

  if (error) throw new Error(`Failed to fetch prompt sets: ${error.message}`);
  return (data || []).map((ps) => ps.id);
}

/**
 * Inactive prompts are tracked on no platform, so analysing one spends an LLM
 * call, a DataForSEO call and its share of the wait on a row no surface reads.
 */
function activePromptsQuery(setIds) {
  return supabaseAdmin
    .from('prompts')
    .select('id, text')
    .in('prompt_set_id', setIds)
    .eq('is_active', true)
    .order('id', { ascending: true });
}

/**
 * How much of a brand's active prompt set already carries volumes. This is the
 * pair the Prompts page polls while an analysis runs, so it stays two exact
 * counts — no rows travel, and the 1000-row cap cannot reach it.
 */
export async function getVolumeProgress(brandId) {
  const setIds = await fetchPromptSetIds(brandId);
  if (setIds.length === 0) return { total: 0, analyzed: 0 };

  const [{ count: total }, { count: analyzed }] = await Promise.all([
    supabaseAdmin
      .from('prompts')
      .select('*', { count: 'exact', head: true })
      .in('prompt_set_id', setIds)
      .eq('is_active', true),
    supabaseAdmin
      .from('prompt_volumes')
      .select('prompts!inner(prompt_set_id, is_active)', { count: 'exact', head: true })
      .in('prompts.prompt_set_id', setIds)
      .eq('prompts.is_active', true),
  ]);

  return { total: total || 0, analyzed: analyzed || 0 };
}

export async function analyzeBrandVolumes(
  brandId,
  { locationCode, languageCode, force = false, onlyMissing = false } = {},
) {
  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select('region, language')
    .eq('id', brandId)
    .maybeSingle();

  if (brandError) {
    throw new Error(`Failed to fetch brand: ${brandError.message}`);
  }
  if (!brand) {
    throw new Error(`Brand ${brandId} not found`);
  }

  const resolvedLocationCode =
    locationCode ?? (brand.region ? regionToLocationCode(brand.region) : undefined);
  const resolvedLanguageCode =
    languageCode ?? (brand.language ? languageToCode(brand.language) : undefined);

  const setIds = await fetchPromptSetIds(brandId);
  if (setIds.length === 0) {
    return [];
  }

  const prompts = await fetchAllPages(() => activePromptsQuery(setIds));
  if (prompts.length === 0) {
    return [];
  }

  const existingMap = {};
  const existingPromptIds = new Set();

  if (!force || onlyMissing) {
    const existingRows = await fetchAllPages(() =>
      supabaseAdmin
        .from('prompt_volumes')
        .select('prompt_id, intent, keywords, prompts!inner(prompt_set_id)')
        .in('prompts.prompt_set_id', setIds)
        .order('prompt_id', { ascending: true }),
    );

    for (const row of existingRows) {
      existingPromptIds.add(row.prompt_id);

      if (row.keywords?.length) {
        existingMap[row.prompt_id] = {
          intent: row.intent,
          keywords: row.keywords,
        };
      }
    }
  }

  let promptsToAnalyze = prompts;

  if (onlyMissing) {
    promptsToAnalyze = prompts.filter(({ id }) => !existingPromptIds.has(id));
  }

  const aiModel = resolveModel();
  const results = [];

  for (const { id: promptId, text: promptText } of promptsToAnalyze) {
    try {
      let intent;
      let keywords;

      const cached = existingMap[promptId];
      if (cached) {
        intent = cached.intent;
        keywords = cached.keywords;
      } else {
        const intentResult = await extractIntentKeywords(promptText, aiModel);
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
      logger.error({ err, promptId }, 'volume analysis failed for prompt');

      results.push({
        promptId,
        error: err.message,
      });
    }
  }
  return results;
}
