import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AgentAuditSpec } from '@/components/agent/agent-chart';
import { AuditResultCard } from './audit-result-card';

/**
 * The Agent's audit card (render_audit) shows the score with its range, as
 * get_site_audit gives it: "64 ± 2" on the gauge and the sentence beside it,
 * the way the audit report does.
 */

// The audit report's components the card reuses link to Settings.
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const spec = (over: Partial<AgentAuditSpec> = {}): AgentAuditSpec => ({
  url: 'https://shop.com/bags',
  totalScore: 0.64,
  categoryScores: {},
  recommendations: [],
  signalsEvaluated: 45,
  signalsTotal: 48,
  ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(audit: AgentAuditSpec) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditResultCard audit={audit} />
      </NextIntlClientProvider>,
    );
  });
}

const mark = () => container.querySelector('[data-slot="score-range"]');

describe('AuditResultCard score range', () => {
  it('shows the range beside the score, and says what it means', () => {
    render(spec({ scoreRange: { plusMinus: 2, low: 62, high: 66, audits: 5 } }));
    expect(mark()?.textContent).toBe('± 2');
    expect(mark()?.parentElement?.textContent).toBe('64± 2');
    expect(mark()?.getAttribute('title')).toBe(
      "This page's last 5 audits scored 62 to 66, changes to the page included.",
    );
    expect(container.textContent).toContain(
      "This page's last 5 audits scored 62 to 66, changes to the page included.",
    );
  });

  it('says the audits scored the same when the range is ± 0', () => {
    render(spec({ scoreRange: { plusMinus: 0, low: 64, high: 64, audits: 3 } }));
    expect(mark()?.textContent).toBe('± 0');
    expect(container.textContent).toContain("This page's last 3 audits all scored 64.");
  });

  it('shows no range when get_site_audit gave none, or on a card drawn before it', () => {
    render(spec({ scoreRange: null }));
    expect(container.textContent).not.toContain('±');
    render(spec());
    expect(container.textContent).not.toContain('±');
    expect(container.textContent).toContain('64');
  });

  it("shows no range the rule couldn't give, or without a score", () => {
    render(spec({ scoreRange: { plusMinus: 5, low: 62, high: 66, audits: 5 } }));
    expect(mark()).toBeNull();
    render(spec({ totalScore: null, scoreRange: { plusMinus: 2, low: 62, high: 66, audits: 5 } }));
    expect(mark()).toBeNull();
  });
});

describe('AuditResultCard copy', () => {
  it('words its headings and counts from the messages, in the reader’s language', () => {
    const audit = messages.audit;
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="tr"
          messages={{
            ...messages,
            audit: {
              ...audit,
              title: 'Site Denetimi',
              signalsEvaluated: 'sinyal değerlendirildi',
              categoryBreakdown: 'Kategori dökümü',
              na: 'yok',
              topRecommendations: 'Öne çıkan öneriler',
            },
          }}
          timeZone="UTC"
        >
          <AuditResultCard
            audit={spec({
              categoryScores: { structure: { score: null, evaluated: 0, total: 14 } },
              recommendations: [
                {
                  signalKey: 'faq-schema',
                  label: 'FAQ schema',
                  category: 'structure',
                  priority: 'high',
                  recommendation: 'Add an FAQ block.',
                  draft: null,
                },
              ],
            })}
          />
        </NextIntlClientProvider>,
      );
    });
    const text = container.textContent ?? '';
    for (const words of [
      'Site Denetimi',
      '45 / 48 sinyal değerlendirildi',
      'Kategori dökümü',
      'yok',
      'Öne çıkan öneriler',
    ]) {
      expect(text).toContain(words);
    }
    for (const english of [
      'Site Audit',
      'signals evaluated',
      'Category breakdown',
      'Top recommendations',
    ]) {
      expect(text).not.toContain(english);
    }
  });
});
