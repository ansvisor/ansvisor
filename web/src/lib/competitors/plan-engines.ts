/**
 * The engines a workspace's plan tracks, for the Competitors page's Platform
 * Breakdown (UX audit CP-04): the engines the plan reads, each once, with or
 * without answers in the period; engines outside it (Claude on Growth, an
 * engine from an older plan) left out and named on one line.
 */

import {
  getAIProviderDisplayName,
  resolveAIProvider,
  type AIProviderKey,
} from '@/components/ai-provider-avatar';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import type { HeadToHeadPlatformRow } from '@/lib/head-to-head';

/** ChatGPT Shopping feeds Product Visibility; it isn't an engine of its own here. */
const NOT_AN_ENGINE = new Set(['chatgpt-shopping']);

/**
 * The engines the plan reads, by provider. `scrapers` and `models` are the
 * plan's allowed ids, null for all of them. Self-hosted, the page passes no
 * plan at all (breakdownForPlan with null).
 */
export function planEngineKeys(
  scrapers: readonly string[] | null | undefined,
  models: readonly string[] | null | undefined,
): Set<AIProviderKey> {
  const keys = new Set<AIProviderKey>();
  for (const scraper of ALL_SCRAPERS) {
    if (NOT_AN_ENGINE.has(scraper.id)) continue;
    if (!scrapers || scrapers.includes(scraper.id)) keys.add(resolveAIProvider('', scraper.id));
  }
  for (const model of ALL_MODELS) {
    if (!models || models.includes(model.id)) keys.add(resolveAIProvider(model.id));
  }
  return keys;
}

/** A breakdown row; `noAnswers` for an engine of the plan with none in the period. */
export interface PlanBreakdownRow extends HeadToHeadPlatformRow {
  provider: AIProviderKey;
  noAnswers?: boolean;
}

/**
 * The plan's engines in the breakdown, by name: those with answers, then
 * those without; and the names of engines left out, not in the plan. With
 * no plan (null) every row stays, as before.
 */
export function breakdownForPlan(
  rows: readonly HeadToHeadPlatformRow[],
  plan: ReadonlySet<AIProviderKey> | null,
): { rows: PlanBreakdownRow[]; notInPlan: string[] } {
  const withKey = rows.map((row) => ({ ...row, provider: resolveAIProvider('', row.platform) }));
  if (!plan) return { rows: withKey, notInPlan: [] };
  const kept = withKey.filter((row) => plan.has(row.provider));
  const seen = new Set(kept.map((row) => row.provider));
  const empty: PlanBreakdownRow[] = [...plan]
    .filter((key) => !seen.has(key))
    .map((provider) => ({
      platform: getAIProviderDisplayName(provider),
      provider,
      brandScore: 0,
      competitorScore: 0,
      diff: 0,
      noAnswers: true,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));
  const notInPlan = [
    ...new Set(withKey.filter((row) => !plan.has(row.provider)).map((row) => row.platform)),
  ].sort((a, b) => a.localeCompare(b));
  return { rows: [...kept, ...empty], notInPlan };
}
