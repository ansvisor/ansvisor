/**
 * What keeps AI crawlers out of the brand's site, across its pages (the
 * Crawler & Technical Fixer agent's read): each page's latest completed Site
 * Audit, its crawler checks only, gathered into one list. A check failed or
 * warned on some page comes with how many pages and a few of them, with the
 * audit's evidence for each; the AI bots robots.txt or a CDN/firewall turned
 * away are gathered site-wide. Worked out from the audits alone: a page never
 * audited says nothing here.
 */

/**
 * The Site Audit checks that decide whether an AI crawler gets in and reads
 * the page, in the order they matter: let in at all (robots.txt, CDN or
 * firewall), the main text there before JavaScript runs, HTTPS, the
 * canonical page, and a page light enough to be read whole.
 */
export const CRAWLER_CHECKS = [
  'ai-bot-access',
  'no-js-content',
  'https',
  'canonical',
  'page-weight',
] as const;
export type CrawlerCheck = (typeof CRAWLER_CHECKS)[number];

/** Pages named for each check, as examples. */
export const CRAWLER_EXAMPLES = 5;

/** A page's latest completed audit. */
export interface AuditedPage {
  auditId: string;
  url: string;
  auditedAt: string;
}

/** One crawler check's result on one audit (audit_signal_results). */
export interface CrawlerSignalRow {
  audit_id: string;
  signal_key: string;
  status: string;
  evidence: Record<string, unknown> | null;
}

export interface CrawlerIssuePage {
  url: string;
  audit_id: string;
  status: 'fail' | 'warn';
  /** The audit's evidence that says what to fix, by check (bots blocked, % hidden, KB…). */
  detail: Record<string, unknown>;
}

export interface CrawlerIssue {
  check: CrawlerCheck;
  /** Pages it failed on, and warned on. */
  failing: number;
  warning: number;
  /** The first CRAWLER_EXAMPLES pages, failed before warned, by address. */
  examples: CrawlerIssuePage[];
}

export interface CrawlerAccess {
  /** Pages with a completed audit, read (their latest audit each). */
  pages: number;
  /** More audited pages than one read takes: the counts cover `pages`. */
  capped: boolean;
  /** The oldest and newest of those audits (ISO); null without any. */
  oldest_audit_at: string | null;
  newest_audit_at: string | null;
  /** AI bots robots.txt blocks on some page, and bots a CDN or firewall refused while robots.txt lets them in. */
  bots: { robots_blocked: string[]; firewall_refused: string[]; no_robots_txt_pages: number };
  /** Each crawler check that failed or warned on some page, in CRAWLER_CHECKS' order. */
  issues: CrawlerIssue[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((v) =>
          typeof v === 'string'
            ? v
            : v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string'
              ? (v as { key: string }).key
              : null,
        )
        .filter((v): v is string => !!v)
    : [];

/** The evidence that says what to fix, for each check; never the page's own text. */
function detailOf(check: CrawlerCheck, evidence: Record<string, unknown>): Record<string, unknown> {
  const pick = (...keys: string[]) =>
    Object.fromEntries(keys.filter((key) => key in evidence).map((key) => [key, evidence[key]]));
  switch (check) {
    case 'ai-bot-access':
      return {
        robots_blocked: strings(evidence.blockedBots),
        firewall_refused: strings(evidence.wafBlockedBots),
        ...(evidence.robotsTxt === false ? { robots_txt: false } : {}),
        ...pick('liveTest'),
      };
    case 'no-js-content':
      return pick('hiddenPercent', 'hiddenWords', 'mainWords');
    case 'https':
      return pick('https', 'mixedContentRefs');
    case 'page-weight':
      return pick('htmlKb');
    case 'canonical':
      return {};
  }
}

/** The site's crawler issues, from its pages' latest audits and their crawler checks. */
export function crawlerAccess(
  pages: readonly AuditedPage[],
  signals: readonly CrawlerSignalRow[],
  capped = false,
): CrawlerAccess {
  const pageOf = new Map(pages.map((page) => [page.auditId, page]));
  const robotsBlocked = new Set<string>();
  const firewallRefused = new Set<string>();
  let noRobots = 0;
  const found = new Map<CrawlerCheck, CrawlerIssuePage[]>();
  for (const row of signals) {
    const page = pageOf.get(row.audit_id);
    const check = row.signal_key as CrawlerCheck;
    if (!page || !CRAWLER_CHECKS.includes(check)) continue;
    const evidence = row.evidence ?? {};
    if (check === 'ai-bot-access') {
      for (const bot of strings(evidence.blockedBots)) robotsBlocked.add(bot);
      for (const bot of strings(evidence.wafBlockedBots)) firewallRefused.add(bot);
      if (evidence.robotsTxt === false) noRobots += 1;
    }
    if (row.status !== 'fail' && row.status !== 'warn') continue;
    const list = found.get(check) ?? [];
    list.push({
      url: page.url,
      audit_id: page.auditId,
      status: row.status as 'fail' | 'warn',
      detail: detailOf(check, evidence),
    });
    found.set(check, list);
  }
  const dates = pages.map((page) => page.auditedAt).sort();
  return {
    pages: pages.length,
    capped,
    oldest_audit_at: dates[0] ?? null,
    newest_audit_at: dates.at(-1) ?? null,
    bots: {
      robots_blocked: [...robotsBlocked].sort(),
      firewall_refused: [...firewallRefused].sort(),
      no_robots_txt_pages: noRobots,
    },
    issues: CRAWLER_CHECKS.flatMap((check) => {
      const list = found.get(check) ?? [];
      if (!list.length) return [];
      const ordered = [...list].sort(
        (a, b) =>
          (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1) ||
          (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
      );
      return [
        {
          check,
          failing: list.filter((p) => p.status === 'fail').length,
          warning: list.filter((p) => p.status === 'warn').length,
          examples: ordered.slice(0, CRAWLER_EXAMPLES),
        },
      ];
    }),
  };
}
