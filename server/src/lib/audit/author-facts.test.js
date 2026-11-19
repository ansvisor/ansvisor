import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { authorFacts } from './author-facts.js';

/** The author's facts the model reads beside the page text (2026-11-19). */

const ctx = (body, head = '') => ({
  $: cheerio.load(`<html><head>${head}</head><body>${body}</body></html>`),
});
const ld = (json) => `<script type="application/ld+json">${JSON.stringify(json)}</script>`;

describe('authorFacts', () => {
  it('reads an author box at the end of an article, and its LinkedIn link', () => {
    const filler = '<p>' + 'Word '.repeat(3000) + '</p>';
    const facts = authorFacts(
      ctx(`<article>${filler}</article>
        <div class="ansvisor-author-box"><h4>About the Author</h4>
          <p>Cihan Geyik, Co-founder at Ansvisor, has more than 15 years of experience in digital marketing and growth.</p>
          <a href="https://www.linkedin.com/in/example/">LinkedIn</a></div>`),
    );
    expect(facts).toContain('Author box: About the Author Cihan Geyik, Co-founder at Ansvisor');
    expect(facts).toContain('15 years of experience');
    expect(facts).toContain('Profile links: https://www.linkedin.com/in/example/');
  });

  it('reads Person JSON-LD, an article’s author too: jobTitle, description and sameAs', () => {
    const facts = authorFacts(
      ctx(
        '',
        ld({
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'BlogPosting',
              author: {
                '@type': 'Person',
                name: 'Cihan Geyik',
                jobTitle: 'Co-founder',
                sameAs: ['https://www.linkedin.com/in/example/'],
              },
            },
          ],
        }),
      ),
    );
    expect(facts).toBe(
      'Person: Cihan Geyik\njobTitle: Co-founder\nsameAs: https://www.linkedin.com/in/example/',
    );
  });

  it('is null when the page names no author', () => {
    expect(authorFacts(ctx('<p>Pricing</p>'))).toBeNull();
    expect(authorFacts({})).toBeNull();
  });
});
