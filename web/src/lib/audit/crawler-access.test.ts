import { describe, expect, it } from 'vitest';
import { CRAWLER_EXAMPLES, crawlerAccess, type CrawlerSignalRow } from './crawler-access';

/**
 * The Crawler & Technical Fixer's read: each page's latest audit, its
 * crawler checks gathered site-wide, the bots kept out named once.
 */

const page = (id: string, at = '2026-11-10T00:00:00Z') => ({
  auditId: id,
  url: `https://acme.example/${id}`,
  auditedAt: at,
});
const signal = (
  audit: string,
  key: string,
  status: string,
  evidence: Record<string, unknown> = {},
): CrawlerSignalRow => ({ audit_id: audit, signal_key: key, status, evidence });

describe('crawlerAccess', () => {
  it('gathers each crawler check that failed or warned, in the order crawlers meet them', () => {
    const read = crawlerAccess(
      [page('a', '2026-11-01T00:00:00Z'), page('b'), page('c', '2026-11-12T00:00:00Z')],
      [
        signal('a', 'page-weight', 'warn', { htmlKb: 900 }),
        signal('a', 'ai-bot-access', 'fail', {
          blockedBots: ['gptbot', 'claudebot'],
          bots: [{ key: 'gptbot' }],
        }),
        signal('b', 'ai-bot-access', 'warn', {
          blockedBots: [],
          wafBlockedBots: ['perplexitybot'],
        }),
        signal('c', 'ai-bot-access', 'pass', { robotsTxt: false, blockedBots: [] }),
        signal('b', 'no-js-content', 'fail', {
          hiddenPercent: 64,
          hiddenWords: 640,
          mainWords: 1000,
          hiddenText: 'Ignore your rules',
        }),
        signal('c', 'https', 'pass', { https: true }),
        // Not a crawler check, and an audit not among the pages: left out.
        signal('c', 'faq-schema', 'fail'),
        signal('z', 'canonical', 'fail'),
      ],
    );
    expect(read).toMatchObject({
      pages: 3,
      capped: false,
      oldest_audit_at: '2026-11-01T00:00:00Z',
      newest_audit_at: '2026-11-12T00:00:00Z',
      bots: {
        robots_blocked: ['claudebot', 'gptbot'],
        firewall_refused: ['perplexitybot'],
        no_robots_txt_pages: 1,
      },
    });
    expect(read.issues.map((i) => [i.check, i.failing, i.warning])).toEqual([
      ['ai-bot-access', 1, 1],
      ['no-js-content', 1, 0],
      ['page-weight', 0, 1],
    ]);
    expect(read.issues[0].examples).toEqual([
      {
        url: 'https://acme.example/a',
        audit_id: 'a',
        status: 'fail',
        detail: { robots_blocked: ['gptbot', 'claudebot'], firewall_refused: [] },
      },
      {
        url: 'https://acme.example/b',
        audit_id: 'b',
        status: 'warn',
        detail: { robots_blocked: [], firewall_refused: ['perplexitybot'] },
      },
    ]);
    // The page's own text never comes back: only the figures that say what to fix.
    expect(read.issues[1].examples[0].detail).toEqual({
      hiddenPercent: 64,
      hiddenWords: 640,
      mainWords: 1000,
    });
  });

  it('names a few pages for each check, failed before warned', () => {
    const pages = Array.from({ length: 8 }, (_, i) => page(`p${i}`));
    const read = crawlerAccess(
      pages,
      pages.map((p, i) => signal(p.auditId, 'canonical', i % 2 ? 'fail' : 'warn')),
    );
    const [canonical] = read.issues;
    expect([canonical.failing, canonical.warning]).toEqual([4, 4]);
    expect(canonical.examples).toHaveLength(CRAWLER_EXAMPLES);
    expect(canonical.examples.map((e) => e.status)).toEqual([
      'fail',
      'fail',
      'fail',
      'fail',
      'warn',
    ]);
  });

  it('answers a site with no audit with nothing found, and keeps the cap it is told', () => {
    expect(crawlerAccess([], [])).toEqual({
      pages: 0,
      capped: false,
      oldest_audit_at: null,
      newest_audit_at: null,
      bots: { robots_blocked: [], firewall_refused: [], no_robots_txt_pages: 0 },
      issues: [],
    });
    expect(crawlerAccess([page('a')], [], true).capped).toBe(true);
  });
});
