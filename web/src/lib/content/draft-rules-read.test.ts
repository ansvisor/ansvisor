// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * A draft's rules read on the server for Chat (CHAT-25 §6, W4-12b part 2):
 * the editor's own rule functions with its context (the set for the page
 * type, the draft's choices, My rules, the brief's keywords, the brand's
 * domains and the fan-outs it keeps), counted as the editor counts them.
 */

const fake = vi.hoisted(() => ({ db: null as unknown as FakeSupabase }));
vi.mock('@/lib/supabase/admin', () => ({
  get supabaseAdmin() {
    return fake.db;
  },
}));
vi.mock('./catalog-match', () => ({ catalogMatchFor: async () => null }));

const { readDraftRules } = await import('./draft-rules-read');
const { activeRules, checkRule, NO_DRAFT_RULES, pageTextLength, readPage, ruleSet, rulesMet } =
  await import('./rules');
const { withContentDom } = await import('./server-dom');

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const DRAFT = '44444444-4444-4444-8444-444444444444';

const HTML =
  '<h1>Pricing FAQ</h1><p>Plans for every team.</p><h2>Can I change plans?</h2><p>Yes, any time from Billing.</p><h2>Can I get a refund?</h2><p>Within 30 days.</p>';

const brand = {
  organization_id: ORG,
  language: 'en',
  site_type: 'b2b',
  industry: null,
  shopping_mode_enabled: false,
  trusted_sources: [],
};

beforeEach(() => {
  fake.db = createFakeSupabase();
  fake.db.tables.content_drafts = [
    {
      id: DRAFT,
      title: 'Pricing FAQ',
      body_html: HTML,
      page_type: 'docs_faq',
      rules: null,
      source_url: null,
      brief: null,
      opportunity_id: null,
      brands: brand,
      // The fake reads brands!inner's filter as this column.
      'brands.organization_id': ORG,
    },
  ];
  fake.db.tables.content_rule_sets = [];
  fake.db.tables.content_draft_sources = [];
  fake.db.rpcs.content_draft_sources = () => null;
});

/** The editor's count for the page, by the same functions, with no context read. */
async function editorCount(overrides: Record<string, { on?: boolean; value?: string }> = {}) {
  await withContentDom();
  const rules = activeRules(ruleSet('docs_faq', { language: 'en', shopping: false }), {
    ...NO_DRAFT_RULES,
    overrides,
  });
  const page = readPage(HTML, pageTextLength(HTML));
  const ctx = { brandDomains: [], competitorDomains: [], fanouts: [], language: 'en' };
  return rulesMet(rules.map((rule) => ({ rule, status: checkRule(rule, page, ctx) })));
}

describe('a draft’s rules read for Chat (W4-12b part 2)', () => {
  it('counts the page’s rules as the editor does', async () => {
    const read = await readDraftRules({ organizationId: ORG, draftId: DRAFT });
    expect(read?.title).toBe('Pricing FAQ');
    expect(read && { met: read.met, total: read.total }).toEqual(await editorCount());
    expect(read!.total).toBeGreaterThan(0);
    // Every rule in effect, with its status, as the Rules tab lists them.
    expect(read!.checked.map(({ rule }) => rule.key)).toContain('length');
  });

  it('follows the draft’s own choices over the workspace’s My rules', async () => {
    fake.db.tables.content_rule_sets = [
      {
        organization_id: ORG,
        site_type: 'b2b',
        page_type: 'docs_faq',
        overrides: { sentence: { on: false } },
        text_rules: [],
      },
    ];
    const mine = await readDraftRules({ organizationId: ORG, draftId: DRAFT });
    expect(mine!.total).toBe((await editorCount({ sentence: { on: false } })).total);
    fake.db.tables.content_drafts[0].rules = {
      set: null,
      source: 'default',
      overrides: { length: { on: false } },
      textRules: [],
    };
    const own = await readDraftRules({ organizationId: ORG, draftId: DRAFT });
    expect(own!.total).toBe((await editorCount({ length: { on: false } })).total);
  });

  it('takes the brief’s keywords for the Keywords rule', async () => {
    fake.db.tables.content_drafts[0].brief = {
      goal: '',
      audience: '',
      outline: [],
      keywords: ['refund policy', 'plan change'],
      origin: 'edit',
      builtAt: null,
      builtFrom: null,
    };
    const read = await readDraftRules({ organizationId: ORG, draftId: DRAFT });
    const keywords = read!.checked.find(({ rule }) => rule.key === 'keywords');
    expect(keywords?.rule.current).toBe('refund policy, plan change');
  });

  it('reads nothing of another workspace’s draft', async () => {
    expect(await readDraftRules({ organizationId: OTHER, draftId: DRAFT })).toBeNull();
  });
});
