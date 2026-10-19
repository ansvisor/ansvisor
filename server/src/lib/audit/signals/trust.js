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

export const aiBotAccess = {
  key: 'ai-bot-access',
  evaluate(ctx) {
    if (!ctx.robotsTxt) {
      // No robots.txt → still crawlable by default, but no explicit signal.
      return { status: 'warn', score: 0.5, evidence: { robotsTxt: false } };
    }
    const lower = ctx.robotsTxt.toLowerCase();
    const mentioned = AI_BOTS.filter((b) => lower.includes(b));
    // Detect an explicit block: a mentioned AI UA followed by "disallow: /".
    const blocked = mentioned.some((b) => {
      const idx = lower.indexOf(b);
      const after = lower.slice(idx, idx + 200);
      return /disallow:\s*\/\s*(\n|$)/.test(after);
    });

    let status = 'warn';
    let score = 0.5;
    if (blocked) {
      status = 'fail';
      score = 0;
    } else if (mentioned.length > 0) {
      status = 'pass';
      score = 1;
    }
    return { status, score, evidence: { aiBotsMentioned: mentioned, blocked } };
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
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: { canonical: href || null },
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
