/**
 * Live AI-bot access test (Site Audit spec §6.3, SA-008): the page asked for
 * once as each AI bot, so a CDN or firewall that turns the bots away shows,
 * which robots.txt alone never does.
 *
 * - The bots are the spec's: GPTBot, OAI-SearchBot, ChatGPT-User,
 *   PerplexityBot and ClaudeBot, by their user-agent tokens in the verified
 *   AI bot list (ai-bots.json, the AI bot logs' list). Google-Extended is a
 *   robots.txt token with no crawler of its own, so only robots.txt says
 *   whether it is let in (signals/trust.js).
 * - A control request comes first, as AnsvisorBot, the user agent Ansvisor
 *   reads pages with. Only when the site lets it in is a bot's refusal the
 *   bot's: with the control refused, nothing is concluded and the bots
 *   aren't asked at all.
 * - Polite: one request per bot, one after another, after the control; at
 *   most BOT_ACCESS.maxBytes of each answer is read, and the whole test
 *   stops at BOT_ACCESS.budgetMs (a bot not reached by then isn't tested).
 * - A block is a 4xx answer to a bot while the control got a 2xx. Asked to
 *   slow down (429) or timed out (408), a server error or no answer at all
 *   is shown but isn't a block, so a slow or busy site doesn't move the
 *   score from one audit to the next.
 * - Fetched through safe-fetch: public addresses only, redirects checked.
 * - The first bot let in is read whole (up to BOT_ACCESS.pageBytes): that
 *   HTML, as an AI bot gets it before any JavaScript runs, is what the no-JS
 *   check compares with the rendered page (SA-009). A site that prerenders
 *   for bots is read as the bots get it.
 *
 * The bots are asked from Ansvisor's servers, not the operators' own
 * addresses: a firewall that checks a crawler's published IP ranges can
 * treat the real crawler differently. A block here is a block of anything
 * that names the bot.
 */

import { AI_BOTS } from '../ai-bots.js';
import { MAX_PAGE_BYTES, fetchPage } from '../safe-fetch.js';

/** The bots fetched by their user agent, in the spec's order (keys in ai-bots.json). */
export const LIVE_BOT_KEYS = [
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'perplexitybot',
  'claudebot',
];

export const BOT_ACCESS = Object.freeze({
  /** One request's time limit. */
  timeoutMs: 5_000,
  /** The whole test's: the control and the five bots, one after another. */
  budgetMs: 15_000,
  /** Bytes of an answer read: the status is what counts. */
  maxBytes: 64 * 1024,
  /** Bytes of the first bot's answer read, for the no-JS check (safe-fetch's page limit). */
  pageBytes: MAX_PAGE_BYTES,
});

/** 4xx answers that say nothing about a block: timed out, or asked to slow down. */
const NOT_A_BLOCK = new Set([408, 429]);

/** The user agent a bot is asked as: its token, and who is asking. */
export function botUserAgent(token) {
  return `Mozilla/5.0 (compatible; ${token}/1.0; +https://ansvisor.com) AnsvisorBot/1.0 (AI bot access test)`;
}

/** The bots tested, from the verified list. */
export function liveBots() {
  return LIVE_BOT_KEYS.map((key) => AI_BOTS.find((b) => b.key === key)).filter(Boolean);
}

/**
 * One request: its HTTP status and what it says, `ok` (2xx), `refused`
 * (an answer other than 2xx), `no_answer` (timed out, unreachable) or
 * `not_tested` (an address safe-fetch won't read); and for a 2xx, the start
 * of its body, up to `maxBytes`.
 */
async function ask(url, userAgent, { fetchImpl, timeoutMs, maxBytes = BOT_ACCESS.maxBytes }) {
  try {
    const { status, html } = await fetchImpl(url, {
      userAgent,
      timeoutMs,
      maxBytes,
      truncate: true,
      // Any type: a PDF or a feed answers too.
      types: /(?:)/,
    });
    return { http: status, answer: 'ok', html: html ?? '' };
  } catch (err) {
    if (err?.code === 'http_error') return { http: err.status ?? null, answer: 'refused' };
    if (err?.code === 'invalid_url' || err?.code === 'blocked' || err?.code === 'not_allowed') {
      return { http: null, answer: 'not_tested' };
    }
    return { http: null, answer: 'no_answer' };
  }
}

/** What a bot's answer says once the control was let in. */
export function liveResult({ http, answer }) {
  if (answer === 'ok') return 'ok';
  if (answer === 'refused' && http >= 400 && http < 500 && !NOT_A_BLOCK.has(http)) {
    return 'blocked';
  }
  if (answer === 'refused') return 'error';
  return answer;
}

/**
 * Asks the page as AnsvisorBot, then as each AI bot.
 *
 * @param {string} url
 * @param {{ fetchImpl?: typeof fetchPage, now?: () => number }} [deps]
 * @returns {Promise<null | {
 *   tested: boolean,
 *   control: number|null,
 *   bots: Array<{ key: string, name: string, http: number|null,
 *     live: 'ok'|'blocked'|'error'|'no_answer'|'not_tested'|'inconclusive' }>,
 *   page: { html: string, from: string } | null
 * }>} null for an address safe-fetch won't read; `tested` false when the
 *   control wasn't let in, and then no bot was asked. `page` is the HTML the
 *   first bot let in got, and that bot's key; null when none was.
 */
export async function probeBotAccess(url, { fetchImpl = fetchPage, now = Date.now } = {}) {
  const deadline = now() + BOT_ACCESS.budgetMs;
  const timeLeft = () => Math.min(BOT_ACCESS.timeoutMs, deadline - now());

  const control = await ask(url, undefined, { fetchImpl, timeoutMs: timeLeft() });
  if (control.answer === 'not_tested') return null;
  const bots = liveBots();
  if (control.answer !== 'ok') {
    return {
      tested: false,
      control: control.http,
      bots: bots.map((b) => ({ key: b.key, name: b.name, http: null, live: 'inconclusive' })),
      page: null,
    };
  }

  const results = [];
  let page = null;
  for (const bot of bots) {
    const timeoutMs = timeLeft();
    if (timeoutMs <= 0) {
      results.push({ key: bot.key, name: bot.name, http: null, live: 'not_tested' });
      continue;
    }
    const answer = await ask(url, botUserAgent(bot.userAgent), {
      fetchImpl,
      timeoutMs,
      maxBytes: page ? BOT_ACCESS.maxBytes : BOT_ACCESS.pageBytes,
    });
    if (!page && answer.answer === 'ok') page = { html: answer.html, from: bot.key };
    results.push({ key: bot.key, name: bot.name, http: answer.http, live: liveResult(answer) });
  }
  return { tested: true, control: control.http, bots: results, page };
}
