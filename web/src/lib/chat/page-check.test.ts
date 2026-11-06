// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveRule, RuleStatus } from '@/lib/content/rules';

/**
 * "Check it against the rules" (CHAT-25 §6 item 3, W4-12b part 2):
 * check_draft_rules lists a page's open rules and Quality checks in the
 * Content Editor's own words, spending nothing.
 */

const reads = vi.hoisted(() => ({ rules: vi.fn(), quality: vi.fn() }));
vi.mock('@/lib/content/draft-rules-read', () => ({
  readDraftRules: (...args: unknown[]) => reads.rules(...args),
}));
vi.mock('@/lib/content/go-live-gate', () => ({
  readPageQuality: (...args: unknown[]) => reads.quality(...args),
}));

const { checkDraftRules, pageCheckOf } = await import('./page-check');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const RUN = '66666666-6666-4666-8666-666666666666';
const ctx = {
  userId: USER,
  email: null,
  organizationId: ORG,
  role: 'analyst' as const,
  apiKeyId: 'agent-internal',
  run: { id: RUN, agentRunId: null, scheduleId: null },
};

const rule = (over: Partial<ActiveRule>): ActiveRule =>
  ({
    key: 'faq',
    group: 'structure',
    kind: 'number',
    value: '5',
    check: 'page',
    on: true,
    current: '5',
    changed: false,
    ...over,
  }) as ActiveRule;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '1');
  reads.rules.mockReset().mockResolvedValue({
    title: 'FAQ: Pricing',
    met: 10,
    total: 12,
    checked: [
      {
        rule: rule({ key: 'length', unit: 'characters', current: '1200' }),
        status: { state: 'bad', code: 'long', count: 1900, min: 960, max: 1440 } as RuleStatus,
      },
      {
        rule: rule({ key: 'faq', unit: 'questions' }),
        status: { state: 'bad', code: 'partOf', count: 3, of: 5 } as RuleStatus,
      },
      { rule: rule({ key: 'oneH1' }), status: { state: 'ok' } as RuleStatus },
      {
        rule: rule({ key: 'tone', on: false }),
        status: { state: 'bad', code: 'missing' } as RuleStatus,
      },
    ],
  });
  reads.quality.mockReset().mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe('check_draft_rules (W4-12b part 2)', () => {
  it('lists each open rule with how the page reads now and its aim, in the Rules tab’s words', async () => {
    const check = await checkDraftRules(ctx, DRAFT);
    expect(check).toMatchObject({
      title: 'FAQ: Pricing',
      editor_href: `/dashboard/content/editor/${DRAFT}`,
      rules: {
        met: 10,
        total: 12,
        open: [
          {
            rule: 'Length',
            now: '1,900 characters, over 960–1,440',
            aim: '1200 characters',
          },
          { rule: 'FAQ block', now: '3 of 5', aim: '5 questions' },
        ],
      },
    });
  });

  it('reads Quality from the kept reads only, for this run, and says when it wasn’t read', async () => {
    const check = await checkDraftRules(ctx, DRAFT);
    expect(reads.quality).toHaveBeenCalledWith({
      organizationId: ORG,
      draftId: DRAFT,
      runId: RUN,
      actingUserId: USER,
      actingRole: 'analyst',
      agentRunId: null,
      scheduleId: null,
      spend: false,
    });
    expect(check).toMatchObject({ quality: { not_read: expect.stringContaining('card') } });
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '0');
    reads.quality.mockClear();
    expect(await checkDraftRules(ctx, DRAFT)).toMatchObject({
      quality: { not_read: 'Content Quality isn’t on for this workspace.' },
    });
    expect(reads.quality).not.toHaveBeenCalled();
  });

  it('gives Quality’s scores and bands, and the checks that would raise them, biggest gain first', async () => {
    reads.quality.mockResolvedValue({
      score: 71,
      brandName: 'Acme',
      state: {
        eeatScore: {
          score: 60,
          checks: [
            { id: 'experience', points: 0, max: 20 },
            { id: 'byline', points: 15, max: 15 },
          ],
        },
        trustScore: null,
        readable: {
          score: 82,
          checks: [{ id: 'longSentences', count: 2, value: 0, at: 'x' }],
        },
        aiChecks: null,
      },
    });
    const check = await checkDraftRules(ctx, DRAFT);
    expect(check).toMatchObject({
      quality: {
        score: 71,
        scores: [
          { name: 'E-E-A-T', score: 60, band: 'Can improve' },
          { name: 'Readability', score: 82, band: 'Strong' },
        ],
      },
    });
    const open = (check as { quality: { open: { score: string; check: string }[] } }).quality.open;
    // E-E-A-T's are the person's to-dos, by the Quality tab's title.
    expect(open).toContainEqual(
      expect.objectContaining({ score: 'E-E-A-T', check: 'Add your own experience' }),
    );
    expect(open.map((o) => o.check)).not.toContain("Pick the page's author");
  });

  it('finds nothing of a draft the workspace doesn’t have', async () => {
    reads.rules.mockResolvedValue(null);
    expect(await checkDraftRules(ctx, DRAFT)).toEqual({ found: false });
    expect(await checkDraftRules({ ...ctx, organizationId: null }, DRAFT)).toEqual({
      found: false,
    });
  });

  it('leaves the next moves the page’s link and how many rules are open', async () => {
    const check = await checkDraftRules(ctx, DRAFT);
    expect(pageCheckOf(check)).toEqual({ href: `/dashboard/content/editor/${DRAFT}`, open: 2 });
    expect(pageCheckOf({ found: false })).toBeNull();
    expect(pageCheckOf({ editor_href: 'https://evil.example', rules: { open: [] } })).toBeNull();
  });
});
