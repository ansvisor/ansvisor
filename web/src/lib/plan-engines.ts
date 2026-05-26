import { getPlan, type PlanId } from '@/config/plans';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';

/**
 * Resolve the scraper + model id sets a plan currently allows.
 *
 * Mirrors the gating logic in the onboarding wizard
 * (`(onboarding)/dashboard/onboarding/page.tsx`): if `allowedScrapers` /
 * `allowedModels` is **absent** on the plan, every engine / model is allowed
 * (Growth, Enterprise, Self-hosted). If it's an **array** — even an empty
 * one — only the listed ids are allowed (Starter ships
 * `allowedScrapers: ['chatgpt-web', 'perplexity-web']` and
 * `allowedModels: []`).
 *
 * Used by the Stripe success route to align onboarding-created prompts to
 * the plan the user actually picks at step 6 — without this, a Growth
 * trial-er ends up tracking only the 2 Starter engines (issue #78).
 */
export function getActiveEngineIdsForPlan(planId: PlanId | string | null | undefined): {
  platforms: string[];
  models: string[];
} {
  const plan = getPlan((planId ?? 'starter') as PlanId);

  const allowedScrapers = plan.limits.allowedScrapers;
  const platforms = allowedScrapers
    ? ALL_SCRAPERS.filter((s) => allowedScrapers.includes(s.id)).map((s) => s.id)
    : ALL_SCRAPERS.map((s) => s.id);

  const allowedModels = plan.limits.allowedModels;
  const models = allowedModels
    ? ALL_MODELS.filter((m) => allowedModels.includes(m.id)).map((m) => m.id)
    : ALL_MODELS.map((m) => m.id);

  return { platforms, models };
}
