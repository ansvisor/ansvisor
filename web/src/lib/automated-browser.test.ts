import { describe, expect, it } from 'vitest';
import { isAutomatedBrowser } from './automated-browser';

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
// A phone brand with "bot" in its name: a person, never a crawler.
const CUBOT =
  'Mozilla/5.0 (Linux; Android 13; CUBOT X70) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

describe('isAutomatedBrowser', () => {
  it('counts a browser a program drives', () => {
    expect(isAutomatedBrowser({ userAgent: CHROME, webdriver: true })).toBe(true);
    for (const userAgent of [
      CHROME.replace('Chrome/', 'HeadlessChrome/'),
      'Mozilla/5.0 (Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Chrome-Lighthouse',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (compatible; SomeCrawler; +https://example.com)',
      'Mozilla/5.0 (compatible; ExampleSpider/3.0)',
    ]) {
      expect(isAutomatedBrowser({ userAgent, webdriver: false }), userAgent).toBe(true);
    }
  });

  it('never counts a person', () => {
    for (const userAgent of [CHROME, SAFARI_IPHONE, CUBOT]) {
      expect(isAutomatedBrowser({ userAgent, webdriver: false }), userAgent).toBe(false);
      expect(isAutomatedBrowser({ userAgent }), userAgent).toBe(false);
    }
    expect(isAutomatedBrowser(undefined)).toBe(false);
  });
});
