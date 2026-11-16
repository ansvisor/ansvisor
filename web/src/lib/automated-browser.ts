/**
 * Whether this browser is driven by a program, not a person: a crawler, a
 * headless browser or an automation tool. Product analytics (PostHog) doesn't
 * start in one, so its visits don't count as people in the sign-up funnel
 * (the owner saw sign-up page views that followed every sign-up button of
 * the marketing site's pages, one by one, and never signed up).
 *
 * Only clear signs count, so no person is left out:
 *  - `navigator.webdriver`, which WebDriver, Playwright and Puppeteer set;
 *  - a headless Chrome or Lighthouse user agent;
 *  - a crawler's own name in the user agent, as crawlers write it
 *    ("Googlebot/2.1", "GPTBot/1.0", "bingbot/2.0"), or the words crawler
 *    or spider.
 * An agent that drives an ordinary browser and hides these signs still
 * counts; filter those in PostHog by what its events show.
 */
const AUTOMATED_AGENT = /HeadlessChrome|Chrome-Lighthouse|\b[a-z]*bot\/\d|crawler|spider/i;

export function isAutomatedBrowser(
  nav: (Pick<Navigator, 'userAgent'> & { webdriver?: boolean }) | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator,
): boolean {
  if (!nav) return false;
  if (nav.webdriver === true) return true;
  return AUTOMATED_AGENT.test(nav.userAgent ?? '');
}
