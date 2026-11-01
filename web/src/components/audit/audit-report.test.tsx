import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { AuditRecommendation, AuditResult } from '@/lib/actions/audits';
import { AuditReport } from './audit-report';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const NOTE =
  'Your input needed: replace each highlighted [bracket] with your own details before you publish.';

const rec = (over: Partial<AuditRecommendation> = {}): AuditRecommendation => ({
  signalKey: 'case-study-evidence',
  label: 'Case study evidence',
  category: 'eeat',
  priority: 'medium',
  recommendation: 'Add one real customer result next to the plans.',
  draft: null,
  ...over,
});

const audit = (
  recommendations: AuditRecommendation[],
  previous: Pick<AuditResult, 'previousScore' | 'previousCreatedAt' | 'partial'> = {},
): AuditResult => ({
  id: 'a1',
  brandId: 'b1',
  url: 'https://ansvisor.com/pricing',
  finalUrl: 'https://ansvisor.com/pricing',
  status: 'completed',
  totalScore: 0.63,
  categoryScores: {},
  signalsEvaluated: 45,
  signalsTotal: 47,
  rubricVersion: '1',
  error: null,
  createdAt: '2026-10-17T09:00:00.000Z',
  completedAt: '2026-10-17T09:01:00.000Z',
  signals: [],
  recommendations,
  ...previous,
});

let container: HTMLDivElement;
let root: Root;

function render(
  recommendations: AuditRecommendation[],
  previous: Pick<AuditResult, 'previousScore' | 'previousCreatedAt' | 'partial'> = {},
) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditReport audit={audit(recommendations, previous)} />
      </NextIntlClientProvider>,
    );
  });
}

const marks = () => [...container.querySelectorAll('pre mark')].map((m) => m.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('AuditReport recommendations', () => {
  it('highlights the brand’s own facts in a draft as its input needed', () => {
    render([rec({ draft: '[customer name] grew AI citations by [your result] with Growth.' })]);

    expect(container.querySelector('pre')?.textContent).toBe(
      '[customer name] grew AI citations by [your result] with Growth.',
    );
    expect(marks()).toEqual(['[customer name]', '[your result]']);
    expect([...container.querySelectorAll('mark')].map((m) => m.getAttribute('title'))).toEqual([
      'Your input needed',
      'Your input needed',
    ]);
    expect(container.textContent).toContain(NOTE);
  });

  it('shows the code in its own block with its own copy button', () => {
    render([
      rec({
        signalKey: 'faq-schema',
        draft: 'How much is Starter? Starter costs $49 a month.',
        code: '{"@type": "FAQPage", "dateModified": "[date]", "mainEntity": ["a", "b"]}',
      }),
    ]);

    const blocks = [...container.querySelectorAll('pre')].map((p) => p.textContent);
    expect(blocks).toEqual([
      'How much is Starter? Starter costs $49 a month.',
      '{"@type": "FAQPage", "dateModified": "[date]", "mainEntity": ["a", "b"]}',
    ]);
    expect(container.querySelector('[aria-label="Copy draft"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Copy code"]')).not.toBeNull();
    // A JSON array is not a placeholder.
    expect(marks()).toEqual(['[date]']);
    expect(container.textContent).toContain(NOTE);
  });

  it('adds no note to copy without placeholders, or to an older audit without code', () => {
    render([rec({ draft: 'Ansvisor pricing: AI visibility plans for every team size' })]);

    expect(container.querySelectorAll('pre')).toHaveLength(1);
    expect(marks()).toEqual([]);
    expect(container.textContent).not.toContain(NOTE);
  });
});

describe('AuditReport score change', () => {
  it('shows a positive percentage-point delta and the previous audit date', () => {
    render([], {
      previousScore: 0.56,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });

    expect(container.textContent).toContain('+7 since Sep 28');
  });

  it('shows negative and zero deltas accurately', () => {
    render([], {
      previousScore: 0.7,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(container.textContent).toContain('-7 since Sep 28');

    render([], {
      previousScore: 0.63,
      previousCreatedAt: '2026-09-28T09:00:00.000Z',
    });
    expect(container.textContent).toContain('0 since Sep 28');
  });

  it('does not show a delta when there is no prior completed score/date', () => {
    render([]);
    expect(container.textContent).not.toContain('since');

    render([], { previousScore: 0.56 });
    expect(container.textContent).not.toContain('since');
  });
});

describe('AuditReport partial audit', () => {
  const PARTIAL = messages.audit.partialNote;

  it("says when the AI checks didn't run, and not otherwise", () => {
    render([], { partial: true });
    expect(container.textContent).toContain(PARTIAL);

    render([]);
    expect(container.textContent).not.toContain(PARTIAL);
  });
});
