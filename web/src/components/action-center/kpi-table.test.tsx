import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { KpiSnapshot } from '@/lib/actions/kpis';
import { KpiTable } from './kpi-table';

/**
 * The KPIs table's values and goals in each KPI's unit: the Visibility score
 * is out of 100, never a % (AC-02, D2); a share keeps its %.
 */

vi.mock('next/dynamic', () => ({ default: () => () => null }));

const snapshot = (over: Partial<KpiSnapshot>): KpiSnapshot => ({
  key: 'ai_visibility',
  category: 'visibility',
  unit: 'points',
  direction: 'higher_is_better',
  timeframe: 'monthly',
  value: 29.94,
  change: 1.2,
  changeKind: 'points',
  trend: [],
  target: 40,
  progress: 75,
  status: 'at_risk',
  ...over,
});

const cells = (kpi: KpiSnapshot) => {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <KpiTable kpis={[kpi]} busyKey={null} />
    </NextIntlClientProvider>,
  );
  const body = html.slice(html.indexOf('<tbody'));
  return [...body.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(([, cell]) =>
    cell.replace(/<[^>]+>/g, ''),
  );
};

describe('KpiTable', () => {
  it('shows the Visibility score and its goal out of 100, with no %', () => {
    const [, value, change, , , goal] = cells(snapshot({}));
    expect(value).toBe('29.9/100');
    expect(goal).toBe('40/100');
    expect(change).toBe('1.2 pts');
  });

  it('keeps a share in percent', () => {
    const [, value, , , , goal] = cells(
      snapshot({ key: 'share_of_voice', unit: 'percent', value: 12.46, target: 20 }),
    );
    expect(value).toBe('12.5%');
    expect(goal).toBe('20%');
  });
});
