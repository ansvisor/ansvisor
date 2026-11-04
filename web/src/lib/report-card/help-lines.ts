import { HELP_INDEX, type HelpIndex } from '@/lib/help/search';

/**
 * What the report card's action plan says each feature does, word for word
 * from its approved Help article, so the card promises only what Help
 * already says the app does (REPORT-CARD §1, page 2). A line names its
 * article and the sentence it starts with; `count` takes that many
 * sentences from there. Help's bold marks are dropped. A line whose article
 * is no longer approved, or whose sentence changed, is left out, and
 * help-lines.test.ts fails until it is brought back in step.
 */

export const HELP_LINES = {
  brandVisibility: {
    article: 'visibility/brand-visibility',
    startsWith: 'It’s your daily view',
    count: 1,
  },
  trackPrompts: { article: 'prompts/add-prompts', startsWith: 'A prompt is a question', count: 2 },
  contentOpportunities: {
    article: 'content/content-opportunities',
    startsWith: 'The Opportunities page',
    count: 1,
  },
  compareCompetitors: {
    article: 'competitors/compare-competitors',
    startsWith: 'The Competitors page',
    count: 1,
  },
  mentions: {
    article: 'mentions/mentions-and-sentiment',
    startsWith: 'The Mentions & Sentiment page',
    count: 1,
  },
  competitorGaps: {
    article: 'citations/competitor-gaps',
    startsWith: 'These are outreach targets',
    count: 1,
  },
  siteAudit: { article: 'site-audit/run-a-site-audit', startsWith: 'Site Audit checks', count: 1 },
  actionCenter: {
    article: 'action-center/action-center-overview',
    startsWith: 'The Action Center is where',
    count: 1,
  },
  agents: { article: 'chat/agents', startsWith: 'An agent is a saved skill', count: 1 },
  aiTraffic: {
    article: 'ai-traffic/ai-referral-traffic',
    startsWith: 'It measures real visits',
    count: 1,
  },
  chat: { article: 'chat/chat', startsWith: 'Chat answers questions', count: 1 },
} as const satisfies Record<string, { article: string; startsWith: string; count: number }>;

export type HelpLineId = keyof typeof HELP_LINES;

export interface HelpLine {
  text: string;
  /** The article it is from: "{area}/{slug}" and its title. */
  article: string;
  title: string;
}

/** Help's text as the card prints it: no bold marks, curly quotes. */
const plain = (text: string) =>
  text
    .replace(/\*\*/g, '')
    .replace(/"([^"]*)"/g, '“$1”')
    .replace(/'/g, '’');

/** A paragraph's sentences. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);

/** The line, from the approved articles; null when it can't be found there. */
export function helpLine(id: HelpLineId, index: HelpIndex = HELP_INDEX): HelpLine | null {
  const { article: articleId, startsWith, count } = HELP_LINES[id];
  const article = index.articles.find((a) => a.id === articleId);
  if (!article) return null;
  for (const section of article.sections) {
    const all = sentences(plain(section.text));
    const at = all.findIndex((s) => s.startsWith(startsWith));
    if (at >= 0 && at + count <= all.length) {
      return {
        text: all.slice(at, at + count).join(' '),
        article: article.id,
        title: plain(article.title),
      };
    }
  }
  return null;
}
