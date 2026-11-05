import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatAuditCard } from '@/lib/chat/events';

/**
 * A Site Audit under a Chat answer: the page, its score on the audit
 * report's gauge with "64 ± 2" and the sentence that says what it means,
 * when it ran and the change since the page's audit before, and Open report.
 * With fewer than 3 audits there's no range; a partial audit says the AI
 * checks couldn't run, with no range or change.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AuditCard, AuditCards } = await import('./audit-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HREF = '/dashboard/audit/7d3f2c1a-9b8e-4c6d-a5f4-3e2d1c0b9a87';

const card = (over: Partial<ChatAuditCard> = {}): ChatAuditCard => ({
  page: 'https://shop.com/bags',
  score: 0.64,
  range: { plusMinus: 2, low: 62, high: 66, audits: 5 },
  partial: false,
  auditedAt: '2026-10-30T09:01:00Z',
  change: { points: 3, since: '2026-10-21T09:00:00Z' },
  href: HREF,
  ...over,
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const mark = () => host.querySelector('[data-slot="score-range"]');
const change = () => host.querySelector('[data-slot="audit-change"]');
const SENTENCE = "This page's last 5 audits scored 62 to 66, changes to the page included.";

describe('AuditCard', () => {
  it('shows the page, "64 ± 2" with its sentence, the date, the change and Open report', async () => {
    await render(<AuditCard card={card()} timeZone="UTC" />);
    const article = host.querySelector('article')!;
    expect(article.getAttribute('aria-label')).toBe('Site Audit of https://shop.com/bags');
    expect(article.textContent).toContain('Site Audit');
    expect(article.textContent).toContain('https://shop.com/bags');
    expect(mark()?.textContent).toBe('± 2');
    expect(mark()?.parentElement?.textContent).toBe('64± 2');
    expect(mark()?.getAttribute('title')).toBe(SENTENCE);
    expect(article.textContent).toContain(SENTENCE);
    expect(article.textContent).toContain('Audited Oct 30, 2026');
    expect(change()?.textContent).toBe('+3 since Oct 21');
    const open = host.querySelector('a[data-action="audit.openReport"]')!;
    expect(open.getAttribute('href')).toBe(HREF);
    expect(open.textContent).toBe('Open report');
  });

  it('says the audits scored the same when the range is ± 0, and shows a fall', async () => {
    await render(
      <AuditCard
        card={card({
          range: { plusMinus: 0, low: 64, high: 64, audits: 3 },
          change: { points: -4, since: '2026-10-21T09:00:00Z' },
        })}
      />,
    );
    expect(mark()?.textContent).toBe('± 0');
    expect(host.textContent).toContain("This page's last 3 audits all scored 64.");
    expect(change()?.textContent).toBe('-4 since Oct 21');
  });

  it('shows the score with no range for a page with fewer than 3 audits', async () => {
    await render(<AuditCard card={card({ range: null, change: null })} />);
    expect(mark()).toBeNull();
    expect(host.textContent).not.toContain('±');
    expect(host.textContent).not.toContain('scored');
    expect(change()).toBeNull();
    expect(host.textContent).toContain('64');
    expect(host.textContent).toContain('Audited Oct 30, 2026');
  });

  it('says a partial audit leaves the AI checks out, with no range or change', async () => {
    // Even if a card kept them: a partial score isn't compared.
    await render(<AuditCard card={card({ partial: true })} />);
    expect(mark()).toBeNull();
    expect(change()).toBeNull();
    expect(host.textContent).toContain(
      "The AI checks couldn't run this time, so this score leaves them out and isn't compared with your other audits.",
    );
    expect(host.textContent).toContain('64');
    expect(host.querySelector('a[data-action="audit.openReport"]')).not.toBeNull();
  });

  it("shows no range the rule couldn't give", async () => {
    await render(
      <AuditCard card={card({ range: { plusMinus: 5, low: 62, high: 66, audits: 5 } })} />,
    );
    expect(mark()).toBeNull();
    expect(host.textContent).not.toContain(SENTENCE);
  });

  it('dates it in the time zone the answer was shown in', async () => {
    await render(
      <AuditCard
        card={card({ auditedAt: '2026-10-30T23:30:00Z', change: null })}
        timeZone="Europe/Istanbul"
      />,
    );
    expect(host.textContent).toContain('Audited Oct 31, 2026');
  });
});

describe('AuditCards', () => {
  it('shows each audit read, and nothing without one', async () => {
    await render(
      <AuditCards
        cards={[card(), card({ page: 'https://shop.com/shoes', href: '/dashboard/audit/shoes' })]}
      />,
    );
    expect(host.querySelectorAll('[data-slot="audit-card"]')).toHaveLength(2);
    await render(<AuditCards cards={[]} />);
    expect(host.querySelector('[data-slot="audit-cards"]')).toBeNull();
  });
});
