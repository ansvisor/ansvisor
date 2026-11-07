import { supabaseAdmin } from '@/lib/supabase/admin';
import { buildSourceGroups } from './sources';
import { catalogMatchFor } from './catalog-match';
import { brandSiteType } from './draft-page-type';
import { readDraftBriefWith, readDraftSourcesWith } from './draft-reads';
import { isPageType } from './drafts';
import { profileFor } from './quality-profiles';
import {
  activeRules,
  checkRule,
  draftRulesSchema,
  effectiveRules,
  NO_DRAFT_RULES,
  pageTextLength,
  readPage,
  ruleSet,
  rulesMet,
  savedRuleSetSchema,
  type ActiveRule,
  type RuleContext,
  type RuleStatus,
  type SavedRuleSet,
} from './rules';
import { withContentDom } from './server-dom';

/**
 * A draft's rules as the Content Editor checks them (CE-009, useDraftRules),
 * read on the server for Chat (CHAT-25 §6, W4-12b part 2: a page's version
 * card's "Rules {met}/{total}" and check_draft_rules): the set for its page
 * type with the draft's own choices over the workspace's My rules, the
 * brief's keywords and the brand's language, each checked against the page
 * as saved with the editor's context (the brand's and its competitors'
 * domains and the fan-outs the draft keeps, from its Sources; the page's
 * product in the catalog on a product page). The same functions the editor
 * runs: no rule has a second copy. Shopping path rules are left out (they
 * need a check of the catalog the editor makes as it opens, the owner's
 * 2026-11-05 decision), and text rules aren't counted, as the editor counts
 * neither them nor a rule the page can't say. Read with the service role
 * within the workspace: the run already wrote the draft, or its tool
 * checked who may read it. Null when the draft isn't the workspace's.
 */

export interface DraftRulesRead {
  title: string;
  /** Every rule in effect with its status on the page, as the Rules tab lists them. */
  checked: { rule: ActiveRule; status: RuleStatus }[];
  met: number;
  total: number;
  /** The person's own rules that are on, in their words (checked by AI in the editor, not counted). */
  textRules: string[];
}

export async function readDraftRules(input: {
  organizationId: string;
  draftId: string;
}): Promise<DraftRulesRead | null> {
  const { organizationId, draftId } = input;
  const { data: draft, error } = await supabaseAdmin
    .from('content_drafts')
    .select(
      'id, title, body_html, page_type, rules, source_url, brands!inner(organization_id, language, site_type, industry, shopping_mode_enabled)',
    )
    .eq('id', draftId)
    .eq('brands.organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the draft: ${error.message}`);
  if (!draft) return null;
  const brand = (Array.isArray(draft.brands) ? draft.brands[0] : draft.brands) as {
    language: string | null;
    site_type: string | null;
    industry: string | null;
    shopping_mode_enabled: boolean | null;
  };
  const title = draft.title ?? '';
  const pageType = isPageType(draft.page_type) ? draft.page_type : null;
  const [mineRows, sources, brief, catalog] = await Promise.all([
    supabaseAdmin
      .from('content_rule_sets')
      .select('page_type, overrides, text_rules')
      .eq('organization_id', organizationId)
      .eq(
        'site_type',
        brandSiteType({ ...brand, shopping_mode_enabled: brand.shopping_mode_enabled === true }),
      ),
    readDraftSourcesWith(supabaseAdmin, draftId),
    readDraftBriefWith(supabaseAdmin, draftId),
    // A product page's product in the brand's catalog, as the editor reads it (feedOn).
    profileFor(draft.page_type) === 'product'
      ? catalogMatchFor(supabaseAdmin, draftId, title)
      : Promise.resolve(null),
  ]);
  if (mineRows.error) throw new Error(`Could not read My rules: ${mineRows.error.message}`);
  const mine: Partial<Record<string, SavedRuleSet>> = {};
  for (const row of mineRows.data ?? []) {
    const set = savedRuleSetSchema.safeParse({
      overrides: row.overrides,
      textRules: row.text_rules,
    });
    if (set.success && isPageType(row.page_type)) mine[row.page_type] = set.data;
  }

  const choices = draftRulesSchema.safeParse(draft.rules).data ?? NO_DRAFT_RULES;
  const setType = choices.set ?? pageType;
  const effective = effectiveRules(choices, setType ? mine[setType] : undefined);
  const language = brand.language;
  const rules = activeRules(
    ruleSet(setType, {
      keywords: brief?.brief?.keywords ?? [],
      language,
      length: effective.importLength,
      shopping: false,
    }),
    effective,
  );
  const fanouts = sources
    ? buildSourceGroups(sources.data, sources.choices, {
        title,
        sourceUrl: draft.source_url,
      })
        .find((g) => g.kind === 'fanout')
        ?.rows.filter((r) => r.included)
        .map((r) => r.name)
    : undefined;
  const ctx: RuleContext = {
    brandDomains: sources?.data.brandDomains ?? [],
    competitorDomains: sources?.data.competitorDomains ?? [],
    fanouts: fanouts ?? [],
    language,
    catalog,
    shopping: null,
  };
  // The page is read with the content DOM, as the editor's helpers read it on the server.
  await withContentDom();
  const html = draft.body_html ?? '';
  const page = readPage(html, pageTextLength(html));
  const checked = rules.map((rule) => ({ rule, status: checkRule(rule, page, ctx) }));
  return {
    title,
    checked,
    ...rulesMet(checked),
    textRules: effective.textRules.filter((rule) => rule.on).map((rule) => rule.text),
  };
}
