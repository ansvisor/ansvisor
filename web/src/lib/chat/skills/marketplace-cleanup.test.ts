import { describe, expect, it } from 'vitest';
import { cleanMarketplaceFiles, cleanMarketplaceText, editWords } from './marketplace-cleanup';
import { MARKETPLACE_SKILLS } from './marketplace';

/**
 * The Library's cleanup (CHAT-17 items 15–16, W4-18): each cleanup a
 * catalog row names takes its text out of the body, as the pinned files
 * hold it (excerpts below); the front matter and the rest stay; what went
 * is counted, in words that never name the competitor.
 */

const FRONT = `---
name: ai-seo
description: When the user wants to optimize content for AI search engines.
---
`;

describe('cleanMarketplaceText', () => {
  it('drops each line that cites the competitor’s research, tables too', () => {
    const body = [
      '| Platform | Key Citation Sources |',
      '|----------|---------------------|',
      '| **ChatGPT** | Wikipedia (47.9%), Reddit (11.3%) (Profound, 2025-06-05) |',
      '| **Perplexity** | Reddit (46.7%) of top-10 cited sources (Profound, 2025-06-05) |',
      '| **Bing Copilot** | Bing index, authoritative sites |',
      '',
      'Based on the Ahrefs December 2025 study and corroborating research from Profound (2025):',
      '- Wikipedia (7.8% of ChatGPT citations in Profound’s Aug 2024–Jun 2025 data)',
      '- Industry publications and guest posts',
    ].join('\n');
    const { text, edits } = cleanMarketplaceText(FRONT + body, ['research-lines']);
    expect(text).toBe(
      `${FRONT}| Platform | Key Citation Sources |\n|----------|---------------------|\n| **Bing Copilot** | Bing index, authoritative sites |\n\n- Industry publications and guest posts`,
    );
    expect(text.toLowerCase()).not.toContain('profound');
    expect(edits).toEqual([{ cleanup: 'research-lines', lines: 4 }]);
  });

  it('takes the extension out of its list, so the sentence still reads', () => {
    const body =
      'installed: firecrawl, dataforseo, and image-gen, plus `/seo ahrefs`,\n`/seo bing`, `/seo matomo`, `/seo profound`, `/seo seranking`, and\n`/seo unlighthouse`.\n';
    const { text, edits } = cleanMarketplaceText(FRONT + body, ['extension-line']);
    expect(text).toBe(
      `${FRONT}installed: firecrawl, dataforseo, and image-gen, plus \`/seo ahrefs\`,\n\`/seo bing\`, \`/seo matomo\`, \`/seo seranking\`, and\n\`/seo unlighthouse\`.\n`,
    );
    expect(edits).toEqual([{ cleanup: 'extension-line', lines: 1 }]);
  });

  it('drops a paid-pack promo between its markers, markers and all', () => {
    const body = [
      '- Follow: [@someone on X](https://x.com/someone)',
      '',
      '<!-- gingiris-community-cta:start -->',
      '## 加入出海社群与购买资料包 · Community & Resources',
      '',
      'Join the WeChat group, or buy the paid resource pack.',
      '<!-- gingiris-community-cta:end -->',
      'After the promo.',
    ].join('\n');
    const { text, edits } = cleanMarketplaceText(FRONT + body, ['promo-block']);
    expect(text).toBe(
      `${FRONT}- Follow: [@someone on X](https://x.com/someone)\n\nAfter the promo.`,
    );
    expect(edits).toEqual([{ cleanup: 'promo-block', lines: 5 }]);
  });

  it('leaves the front matter, other text and a skill without cleanups as they are', () => {
    const front = `---\nname: geo\ndescription: Profound insights for brands.\n---\n`;
    const { text, edits } = cleanMarketplaceText(`${front}Profound research says so.\nKeep me.\n`, [
      'research-lines',
    ]);
    expect(text).toBe(`${front}Keep me.\n`);
    expect(edits).toEqual([{ cleanup: 'research-lines', lines: 1 }]);
    expect(cleanMarketplaceText('---\nname: a\n---\nAs is.\r\n', [])).toEqual({
      text: '---\nname: a\n---\nAs is.\n',
      edits: [],
    });
    // A cleanup that finds nothing isn't listed.
    expect(cleanMarketplaceText(`${FRONT}Nothing to drop.`, ['promo-block']).edits).toEqual([]);
  });
});

describe('editWords', () => {
  it('says what went without naming the competitor', () => {
    const words = [
      editWords({ cleanup: 'research-lines', lines: 2 }),
      editWords({ cleanup: 'extension-line', lines: 1 }),
      editWords({ cleanup: 'promo-block', lines: 13 }),
    ];
    expect(words).toEqual([
      "2 lines citing a competitor's research",
      "a competitor's extension (1 line)",
      'a paid-pack promo (13 lines)',
    ]);
    expect(words.join(' ').toLowerCase()).not.toContain('profound');
  });
});

describe('cleanMarketplaceFiles', () => {
  it('cleans the SKILL.md only, and hands the other files on', () => {
    const license = new TextEncoder().encode('MIT License, Profound');
    const { files, edits } = cleanMarketplaceFiles(
      [
        { path: 'SKILL.md', bytes: new TextEncoder().encode(`${FRONT}Profound data.\nKeep.\n`) },
        { path: 'LICENSE', bytes: license },
        { path: 'references/a.md', bytes: null },
      ],
      ['research-lines'],
    );
    expect(new TextDecoder().decode(files[0].bytes!)).toBe(`${FRONT}Keep.\n`);
    expect(files[1].bytes).toBe(license);
    expect(files[2]).toEqual({ path: 'references/a.md', bytes: null });
    expect(edits).toEqual([{ cleanup: 'research-lines', lines: 1 }]);
  });

  it('knows every cleanup the catalog names', () => {
    const named = MARKETPLACE_SKILLS.flatMap((skill) => skill.cleanup ?? []);
    expect(named).toHaveLength(8);
    for (const cleanup of named) {
      expect(() => cleanMarketplaceText(FRONT, [cleanup])).not.toThrow();
    }
  });
});
