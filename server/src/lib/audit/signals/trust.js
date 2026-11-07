/**
 * Trust-category signal evaluators (7 signals). See structure.js for the
 * evaluator shape.
 */

import { metaContent } from './helpers.js';

const AI_BOTS = [
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'claudebot',
  'anthropic-ai',
  'perplexitybot',
  'google-extended',
];

export const https = {
  key: 'https',
  evaluate(ctx) {
    const isHttps = ctx.protocol === 'https';
    let mixedContentRefs = 0;
    if (isHttps) {
      ctx.$('script[src], link[href], img[src], iframe[src], source[src]').each((_, el) => {
        const ref = ctx.$(el).attr('src') || ctx.$(el).attr('href') || '';
        if (/^http:\/\//i.test(ref)) mixedContentRefs += 1;
      });
    }
    let status = 'fail';
    let score = 0;
    if (isHttps && mixedContentRefs === 0) {
      status = 'pass';
      score = 1;
    } else if (isHttps) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { https: isHttps, mixedContentRefs } };
  },
};

/**
 * robots.txt as its groups: the user agents a group names and whether its
 * rules disallow or allow the whole site. Consecutive user-agent lines share
 * a group; comments and blank lines are skipped. An agent is kept as the
 * crawler matches it: its name in lower case, up to a version ("GPTBot/1.1").
 */
export function robotsGroups(robotsTxt) {
  const groups = [];
  let current = null;
  let agentLine = false;
  for (const raw of String(robotsTxt ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || !line.includes(':')) continue;
    const at = line.indexOf(':');
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === 'user-agent') {
      if (!current || !agentLine) {
        current = { agents: [], disallowAll: false, allowAll: false };
        groups.push(current);
      }
      const agent = value.toLowerCase();
      current.agents.push(agent.match(/^[a-z_-]+/)?.[0] ?? agent);
      agentLine = true;
    } else {
      agentLine = false;
      if (current && value === '/') {
        if (field === 'disallow') current.disallowAll = true;
        if (field === 'allow') current.allowAll = true;
      }
    }
  }
  return groups;
}

/**
 * Whether robots.txt keeps a crawler out of the whole site, as crawlers read
 * it: the crawler's own groups when it has any, else the `*` groups. Its
 * groups disallow the whole site and none allows it back ("Allow: /" wins a
 * tie).
 */
export function robotsBlocks(groups, agent) {
  const own = groups.filter((g) => g.agents.includes(agent));
  const rules = own.length > 0 ? own : groups.filter((g) => g.agents.includes('*'));
  return rules.some((g) => g.disallowAll) && !rules.some((g) => g.allowAll);
}

/**
 * The AI bots the report lists one by one (Site Audit spec §6.3): the five
 * the live test asks the page as (audit/bot-access.js), and Google-Extended,
 * which only robots.txt lets in or keeps out.
 */
export const REPORTED_BOTS = [
  { key: 'gptbot', name: 'GPTBot' },
  { key: 'oai-searchbot', name: 'OAI-SearchBot' },
  { key: 'chatgpt-user', name: 'ChatGPT-User' },
  { key: 'perplexitybot', name: 'PerplexityBot' },
  { key: 'claudebot', name: 'ClaudeBot' },
  { key: 'google-extended', name: 'Google-Extended' },
];

export const aiBotAccess = {
  key: 'ai-bot-access',
  evaluate(ctx) {
    const groups = ctx.robotsTxt ? robotsGroups(ctx.robotsTxt) : [];
    const lower = (ctx.robotsTxt ?? '').toLowerCase();
    const mentioned = AI_BOTS.filter((b) => lower.includes(b));
    // An explicit block, read group by group as crawlers do; scanning the
    // text after a bot's name also caught the next group's rules, and blocked
    // a bot that robots.txt allows. A bot with no group of its own follows
    // "User-agent: *" (SA-008). The Action Center names the crawlers a block
    // affects.
    const blockedBots = AI_BOTS.filter((b) => robotsBlocks(groups, b));
    const blocked = blockedBots.length > 0;

    // The live test (SA-008): a bot the CDN or firewall refused while
    // robots.txt lets it in. A page read without the test (the demo brand,
    // a draft's estimate) is judged on robots.txt alone; a crawler task's
    // re-check asks the bots itself (action-center/task-checks.js).
    const live = ctx.botAccess ?? null;
    const liveByKey = new Map((live?.bots ?? []).map((b) => [b.key, b]));
    const wafBlockedBots = live?.tested
      ? live.bots
          .filter((b) => b.live === 'blocked' && !robotsBlocks(groups, b.key))
          .map((b) => b.key)
      : [];
    const bots = REPORTED_BOTS.map(({ key, name }) => ({
      key,
      name,
      robots: robotsBlocks(groups, key) ? 'blocked' : 'allowed',
      http: liveByKey.get(key)?.http ?? null,
      live: liveByKey.get(key)?.live ?? null,
    }));

    // A refusal seen only in the live test can't tell: a CDN that checks a
    // crawler's published addresses turns away a request that only names the
    // bot, as ours does, and may still let the real crawler in. It warns,
    // never fails or scores 0; robots.txt's own block still fails.
    let status = 'warn';
    let score = 0.5;
    if (blocked) {
      status = 'fail';
      score = 0;
    } else if (mentioned.length > 0 && wafBlockedBots.length === 0) {
      status = 'pass';
      score = 1;
    }
    return {
      status,
      score,
      evidence: {
        // No robots.txt: still crawlable by default, but no explicit signal.
        ...(ctx.robotsTxt ? {} : { robotsTxt: false }),
        aiBotsMentioned: mentioned,
        blocked,
        blockedBots,
        bots,
        ...(live ? { liveTest: live.tested ? 'done' : 'inconclusive', control: live.control } : {}),
        ...(wafBlockedBots.length > 0 ? { wafBlockedBots } : {}),
      },
    };
  },
};

export const llmsTxtPresence = {
  key: 'llms-txt-presence',
  evaluate(ctx) {
    const present = Boolean(ctx.llmsTxt && ctx.llmsTxt.trim().length > 0);
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: { llmsTxt: present },
    };
  },
};

export const canonical = {
  key: 'canonical',
  evaluate(ctx) {
    const href = ctx.$('link[rel="canonical"]').first().attr('href');
    const present = Boolean(href && href.trim());
    // The score is the tag's presence (rubric); where it points is evidence
    // for the Action Center (AC plan P-11, canonical.js), read at fetch time.
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: {
        canonical: href || null,
        ...(ctx.canonicalTarget ? { target: ctx.canonicalTarget } : {}),
      },
    };
  },
};

export const viewport = {
  key: 'viewport',
  evaluate(ctx) {
    const present = Boolean(metaContent(ctx, 'viewport'));
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: { viewport: present },
    };
  },
};

export const twitterCard = {
  key: 'twitter-card',
  evaluate(ctx) {
    const card = metaContent(ctx, 'twitter:card');
    const image = metaContent(ctx, 'twitter:image');
    let status = 'fail';
    let score = 0;
    if (card && image) {
      status = 'pass';
      score = 1;
    } else if (card) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { card: card || null, hasImage: Boolean(image) } };
  },
};

export const metaDescription = {
  key: 'meta-description',
  evaluate(ctx) {
    const desc = metaContent(ctx, 'description');
    const len = desc ? desc.length : 0;
    let status = 'fail';
    let score = 0;
    if (len >= 80 && len <= 160) {
      status = 'pass';
      score = 1;
    } else if (len > 0) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { length: len } };
  },
};

export const trustSignals = [
  https,
  aiBotAccess,
  llmsTxtPresence,
  canonical,
  viewport,
  twitterCard,
  metaDescription,
];
