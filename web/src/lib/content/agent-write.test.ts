import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DraftSourcesData } from './sources';
import { NO_DRAFT_RULES, activeRules, ruleSet, type ActiveRule } from './rules';

/**
 * What Start's Agent gives the Content Agent (CE-015): the sources kept, the
 * rules in effect (the workspace's My rules included, feed rules left out),
 * the person's own rules, and on an existing page the passages AI quotes.
 */

const getDraftSources = vi.fn();
const getMyRuleSets = vi.fn();
const getCitedPassages = vi.fn();
vi.mock('@/lib/actions/content-drafts', () => ({
  getDraftSources: (...args: unknown[]) => getDraftSources(...args),
  getMyRuleSets: (...args: unknown[]) => getMyRuleSets(...args),
  getCitedPassages: (...args: unknown[]) => getCitedPassages(...args),
}));

const { agentWriteRequest } = await import('./agent-write');

const data: DraftSourcesData = {
  prompts: [
    { id: 'p1', text: 'Best grinder?', inDraft: true, citesPage: false, answers: 4, mentioned: 1 },
  ],
  fanouts: [{ query: 'burr grinder under 200', platforms: ['copilot-web'], searched: 3 }],
  citedPages: [],
  gscQueries: [],
  brandDomains: ['acme.example'],
  competitorDomains: [],
};
const describe_ = (rule: ActiveRule) => ({ name: `name:${rule.key}`, detail: rule.current });
const draft = (over = {}) => ({
  id: 'd1',
  brandId: 'b1',
  title: 'Burr grinders',
  pageType: 'product_page',
  method: 'create' as const,
  sourceUrl: null,
  bodyHtml: '<h1>Burr grinders</h1>',
  rules: NO_DRAFT_RULES,
  ...over,
});

beforeEach(() => {
  getDraftSources.mockReset().mockResolvedValue({ data, choices: [] });
  getMyRuleSets.mockReset().mockResolvedValue({});
  getCitedPassages.mockReset().mockResolvedValue([]);
});

describe('agentWriteRequest', () => {
  it('sends the sources kept and the type’s rules, with the workspace’s My rules', async () => {
    getMyRuleSets.mockResolvedValue({
      product_page: {
        overrides: { faq: { on: false }, length: { value: '2000' } },
        textRules: [
          { id: 't1', text: 'Say “we” for the brand', on: true },
          { id: 't2', text: 'Old rule', on: false },
        ],
      },
    });
    const request = await agentWriteRequest(draft(), describe_);

    expect(request.sources).toMatchObject({
      promptIds: ['p1'],
      fanouts: [{ query: 'burr grinder under 200', platforms: ['copilot-web'] }],
      headings: [],
      length: 2000,
    });
    const keys = request.rules.map((rule) => rule.key);
    expect(keys).not.toContain('faq');
    expect(keys).not.toContain('feedMatch');
    // Heading levels are the editor's: one H1 isn't the agent's to keep.
    expect(keys).not.toContain('oneH1');
    expect(keys).toContain('aiTraces');
    expect(request.rules.find((rule) => rule.key === 'length')).toEqual({
      key: 'length',
      name: 'name:length',
      detail: '2000',
    });
    expect(request.textRules).toEqual(['Say “we” for the brand']);
    // A new page has nothing AI quotes yet.
    expect(getCitedPassages).not.toHaveBeenCalled();
    expect(request.locked).toEqual([]);
  });

  it('locks what AI quotes on an existing page, and takes the editor’s rules as given', async () => {
    getCitedPassages.mockResolvedValue([{ key: 'burrs grind evenly', platforms: [] }]);
    const rules = activeRules(ruleSet('product_page'), NO_DRAFT_RULES).filter((rule) =>
      ['summary', 'feedMatch'].includes(rule.key),
    );
    const request = await agentWriteRequest(
      draft({
        method: 'optimize',
        sourceUrl: 'https://acme.example/grinders',
        bodyHtml: '<h1>Grinders</h1><p>Burrs grind evenly.</p><ul><li><p>Steel</p></li></ul>',
      }),
      describe_,
      { rules, textRules: ['Short sentences'] },
    );

    expect(getCitedPassages).toHaveBeenCalledWith('d1', [
      'Grinders',
      'Burrs grind evenly.',
      'Steel',
    ]);
    expect(request.locked).toEqual(['burrs grind evenly']);
    expect(getMyRuleSets).not.toHaveBeenCalled();
    expect(request.rules.map((rule) => rule.key)).toEqual(['summary']);
    expect(request.textRules).toEqual(['Short sentences']);
  });

  it('still sends the rules when the sources can’t be read', async () => {
    getDraftSources.mockResolvedValue(null);
    const request = await agentWriteRequest(draft({ pageType: null }), describe_);
    expect(request.sources).toEqual({
      promptIds: [],
      fanouts: [],
      pages: [],
      queries: [],
      headings: [],
      length: expect.any(Number),
    });
    expect(request.rules.length).toBeGreaterThan(0);
  });
});
