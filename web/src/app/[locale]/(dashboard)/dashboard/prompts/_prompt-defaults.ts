import { useMemo } from 'react';
import { usePlanContext } from '@/components/providers/plan-provider';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import { PLANS } from '@/config/plans';
import { isValidLocation, locationCode } from '@/lib/region';

/**
 * What a new prompt gets unless someone picks otherwise, as the brand's
 * Add Prompt card gave it: every engine the plan allows, and the brand's
 * location.
 */

/**
 * Plan- and brand-scoped engine lists shared by the Add / Edit prompt dialogs
 * and Generate by topic. Shopping tracking is opt-in per brand (#155): the
 * engine is hidden entirely when the pref is off. The write actions strip it
 * server-side too.
 */
export function useAllowedEngines(shoppingEnabled: boolean) {
  const { planId, allowedModelIds: planAllowedModelIds } = usePlanContext();

  const allowedScraperIds = useMemo(() => {
    const allowed = PLANS[planId].limits.allowedScrapers;
    const ids = allowed ? [...allowed] : ALL_SCRAPERS.map((s) => s.id);
    return shoppingEnabled ? ids : ids.filter((id) => id !== 'chatgpt-shopping');
  }, [planId, shoppingEnabled]);
  const allowedModelIds = useMemo(
    () => planAllowedModelIds ?? ALL_MODELS.map((m) => m.id),
    [planAllowedModelIds],
  );
  const visibleScrapers = useMemo(
    () => ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id)),
    [allowedScraperIds],
  );
  const visibleModels = useMemo(
    () => ALL_MODELS.filter((m) => allowedModelIds.includes(m.id)),
    [allowedModelIds],
  );

  return { allowedScraperIds, allowedModelIds, visibleScrapers, visibleModels };
}

/** The brand's tracking location, as new prompts get it (addPromptToSet). */
export function brandLocation(region: string | undefined, state: string | undefined): string {
  const country = region ?? 'US';
  const candidate = locationCode(country, state ?? null);
  return isValidLocation(candidate) ? candidate : country;
}
