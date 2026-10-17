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

const NOTE = 'Replace placeholders in [brackets] with your real data before publishing.';

const rec = (over: Partial<AuditRecommendation> = {}): AuditRecommendation => ({
  signalKey: 'case-study-evidence',
  label: 'Case study evidence',
  category: 'eeat',
  priority: 'medium',
  recommendation: 'Add one real customer result next to the plans.',
  draft: null,
  ...over,
});

const audit = (recommendations: AuditRecommendation[]): AuditResult => ({
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
});

let container: HTMLDivElement;
let root: Root;

function render(recommendations: AuditRecommendation[]) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuditReport audit={audit(recommendations)} />
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
  it('highlights the placeholders in a draft and says to replace them', () => {
    render([rec({ draft: '[customer name] grew AI citations by [real metric] with Growth.' })]);

    expect(container.querySelector('pre')?.textContent).toBe(
      '[customer name] grew AI citations by [real metric] with Growth.',
    );
    expect(marks()).toEqual(['[customer name]', '[real metric]']);
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
