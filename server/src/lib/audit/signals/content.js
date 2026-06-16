/**
 * Content-category signal evaluators — Faz 1 ships the 3 deterministic ones
 * (readability, length, youtube-embed). The query-dependent / LLM-judged
 * signals (direct-answer, BLUF, query / sub-query / entity coverage,
 * info-density, mega-page, definitions) land in a later phase that feeds the
 * brand's tracked prompts in as the target query.
 *
 * See structure.js for the evaluator shape.
 */

import { fleschReadingEase } from './helpers.js';

export const readability = {
  key: 'readability',
  evaluate(ctx) {
    const flesch = fleschReadingEase(ctx.text);
    if (flesch === null) {
      return { status: 'na', score: null, evidence: { reason: 'not enough text' } };
    }
    const rounded = Math.round(flesch);
    let status = 'fail';
    let score = 0;
    if (flesch >= 50 && flesch <= 70) {
      status = 'pass';
      score = 1;
    } else if ((flesch >= 30 && flesch < 50) || (flesch > 70 && flesch <= 80)) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { fleschReadingEase: rounded } };
  },
};

export const length = {
  key: 'length',
  evaluate(ctx) {
    const words = ctx.wordCount;
    let status = 'fail';
    let score = 0;
    if (words >= 800 && words <= 3000) {
      status = 'pass';
      score = 1;
    } else if ((words >= 400 && words < 800) || (words > 3000 && words <= 5000)) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { words } };
  },
};

export const youtubeEmbed = {
  key: 'youtube-embed',
  evaluate(ctx) {
    const hasEmbed =
      ctx.$(
        'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtu.be"]',
      ).length > 0;
    return {
      status: hasEmbed ? 'pass' : 'fail',
      score: hasEmbed ? 1 : 0,
      evidence: { youtubeEmbed: hasEmbed },
    };
  },
};

export const contentSignals = [readability, length, youtubeEmbed];
