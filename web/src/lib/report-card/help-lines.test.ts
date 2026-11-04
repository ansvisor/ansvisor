import { describe, expect, it } from 'vitest';
import type { HelpIndex } from '@/lib/help/search';
import { HELP_LINES, helpLine, type HelpLineId } from './help-lines';

/**
 * The action plan quotes approved Help articles word for word. When an
 * article changes or loses its approval, this fails until the line is
 * brought back in step with it.
 */

describe('helpLine', () => {
  it.each(Object.keys(HELP_LINES) as HelpLineId[])('finds %s in its approved article', (id) => {
    const line = helpLine(id);
    expect(line).not.toBeNull();
    expect(line?.article).toBe(HELP_LINES[id].article);
    expect(line?.text.startsWith(HELP_LINES[id].startsWith)).toBe(true);
    expect(line?.text).not.toContain('**');
  });

  const index: HelpIndex = {
    articles: [
      {
        id: 'chat/chat',
        title: "Use Chat's answers",
        route: '/dashboard/chat',
        keywords: [],
        synonyms: [],
        plan: 'all',
        updated: '2026-11-03',
        sections: [
          { heading: null, text: 'Intro.' },
          {
            heading: 'More',
            text: 'Chat answers questions about **your** "brand". It saves every chat. More here.',
          },
        ],
      },
    ],
  };

  it('takes the sentence from any section, drops bold and curls quotes', () => {
    expect(helpLine('chat', index)).toEqual({
      text: 'Chat answers questions about your “brand”.',
      article: 'chat/chat',
      title: 'Use Chat’s answers',
    });
  });

  it('is null when the article is not among the approved ones or the sentence changed', () => {
    expect(helpLine('agents', index)).toBeNull();
    const changed: HelpIndex = {
      articles: [{ ...index.articles[0], sections: [{ heading: null, text: 'Chat is a chat.' }] }],
    };
    expect(helpLine('chat', changed)).toBeNull();
  });
});
