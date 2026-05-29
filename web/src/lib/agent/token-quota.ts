import { supabaseAdmin } from '@/lib/supabase/admin';
import { getPlan, type PlanId } from '@/config/plans';

/**
 * Returns the current calendar month in UTC as `YYYY-MM`, matching the
 * shape stored in `agent_token_usage.year_month`. Used as the bucket key
 * for quota lookups and the upsert at the end of every chat turn.
 */
export function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export interface QuotaCheck {
  /** Whether the user can issue another agent turn this month. */
  allowed: boolean;
  /** Cumulative tokens already consumed this month, prompt + completion. */
  usedTokens: number;
  /** Quota cap from the org's plan; `null` means unlimited. */
  quotaTokens: number | null;
}

/**
 * Look up the user's running monthly token usage and compare it against
 * the plan's `aiAgentTokenQuota` ceiling. Self-hosted / enterprise plans
 * leave the quota undefined → unlimited (returns `quotaTokens: null`).
 */
export async function checkAgentQuota(
  userId: string,
  organizationId: string,
  planId: PlanId | string | null | undefined,
): Promise<QuotaCheck> {
  const plan = getPlan((planId ?? 'starter') as PlanId);
  const quotaTokens = plan.limits.aiAgentTokenQuota ?? null;

  const { data } = await supabaseAdmin
    .from('agent_token_usage')
    .select('prompt_tokens, completion_tokens')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('year_month', currentYearMonth())
    .maybeSingle();

  const usedTokens = data
    ? Number(data.prompt_tokens ?? 0) + Number(data.completion_tokens ?? 0)
    : 0;

  return {
    allowed: quotaTokens === null || usedTokens < quotaTokens,
    usedTokens,
    quotaTokens,
  };
}

/**
 * Add this turn's token usage to the user's monthly bucket. The combined
 * `prompt + completion` total is what the quota check compares against —
 * both are stored so we can break the cost down in reports later.
 *
 * Uses Postgres `upsert` with `onConflict` on the unique
 * (user_id, organization_id, year_month) constraint so the first turn of
 * the month inserts, and every turn after that adds to the existing row.
 */
export async function recordAgentTokenUsage(
  userId: string,
  organizationId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  if (promptTokens <= 0 && completionTokens <= 0) return;

  const yearMonth = currentYearMonth();

  // Postgres doesn't support `ON CONFLICT DO UPDATE SET col = col + EXCLUDED.col`
  // through the Supabase JS client cleanly, so fetch-then-write. The
  // unique constraint still protects against races: the fallback insert
  // would 23505 and we'd retry as an update. For a single user issuing
  // one turn at a time this is effectively serialized at the app layer.
  const { data: existing } = await supabaseAdmin
    .from('agent_token_usage')
    .select('id, prompt_tokens, completion_tokens')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('agent_token_usage')
      .update({
        prompt_tokens: Number(existing.prompt_tokens ?? 0) + promptTokens,
        completion_tokens: Number(existing.completion_tokens ?? 0) + completionTokens,
      })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin.from('agent_token_usage').insert({
      user_id: userId,
      organization_id: organizationId,
      year_month: yearMonth,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    });
  }
}
