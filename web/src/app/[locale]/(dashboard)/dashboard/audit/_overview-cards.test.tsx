import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { AuditOverview, AuditQuota } from '@/lib/actions/audits';
import { AuditOverviewCards } from './_overview-cards';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const overview = (over: Partial<AuditOverview> = {}): AuditOverview => ({
  primaryHost: 'acme.com',
  pages: 48,
  otherPages: 0,
  siteScore: 0.68,
  siteScoreChange: 4,
  authority: 0.38,
  eeat: 0.36,
  gaps: [
    { key: 'author-byline', label: 'Author byline', category: 'authority', pages: 31 },
    { key: 'press-mentions', label: 'Press mentions', category: 'eeat', pages: 22 },
    { key: 'case-study-evidence', label: 'Case study evidence', category: 'eeat', pages: 9 },
  ],
  ...over,
});

const growth: AuditQuota = { used: 245, running: 5, limit: 500, remaining: 250 };

let container: HTMLDivElement;
let root: Root;

function render(data: AuditOverview | null, quota: AuditQuota | null = growth) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditOverviewCards overview={data} quota={quota} />
      </NextIntlClientProvider>,
    );
  });
}

/** Each card's label, value, change and sub-line, as text. */
const cards = () =>
  [...container.querySelectorAll('[data-slot=card]')].map((card) => card.textContent ?? '');

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditOverviewCards', () => {
  it('shows the four cards of the mockup', () => {
    render(overview());
    const [site, pages, authority, audits] = cards();

    expect(site).toContain('Site score');
    expect(site).toContain('68+4');
    expect(site).toContain('average of latest audits');

    expect(pages).toContain('Pages audited');
    expect(pages).toContain('48');
    expect(pages).toContain('on acme.com');

    expect(authority).toContain('Authority · E-E-A-T');
    expect(authority).toContain('38 · 36');
    expect(authority).toContain('Top gaps');
    const gaps = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(gaps).toEqual([
      'Author byline31 of 48',
      'Press mentions22 of 48',
      'Case study evidence9 of 48',
    ]);

    expect(audits).toContain('Audits this month');
    expect(audits).toContain('250of 500 left');
    expect(audits).toContain('245 used · 5 running');
    // Running audits fill the bar with the used ones.
    expect(container.querySelector('[role=img][aria-label]')?.getAttribute('aria-label')).toBe(
      '250 of 500 audits used',
    );
  });

  it('counts the pages on other sites apart, and says when there are no gaps or pages', () => {
    render(overview({ otherPages: 3, gaps: [] }));
    expect(cards()[1]).toContain('+ 3 on other sites');
    expect(cards()[2]).toContain('No Authority or E-E-A-T gaps');

    render(
      overview({
        primaryHost: null,
        pages: 0,
        siteScore: null,
        siteScoreChange: null,
        authority: null,
        eeat: null,
        gaps: [],
      }),
    );
    expect(cards()[0]).toContain('—');
    expect(cards()[1]).toContain('on your domain');
    expect(cards()[2]).toContain('— · —');
    expect(cards()[2]).toContain('No pages audited yet');
  });

  it('shows an unlimited plan without a bar', () => {
    render(overview(), { used: 0, running: 0, limit: -1, remaining: -1 });
    expect(cards()[3]).toContain('Unlimited');
    expect(cards()[3]).toContain('no monthly limit');
    expect(cards()[3]).not.toContain('left');
  });

  it('holds the cards with placeholders while loading', () => {
    render(null);
    expect(container.querySelectorAll('[data-slot=card]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(0);
    expect(container.textContent).toBe('');
  });
});
