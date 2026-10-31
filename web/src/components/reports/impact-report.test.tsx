import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ImpactReport } from '@/lib/actions/impact-report';
import type { ImpactRow } from '@/lib/impact/report';

/**
 * Reports › "What Ansvisor did for you" (mockup signature #f-impact): the
 * month's headline (Improved counts Medium and High verdicts only), the
 * method, outcome filters with counts, a row a change with its 7 · 14 · 30
 * · 90 day checkpoints, its evidence, Export as CSV, and the month picker
 * that never goes past this month.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const read = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/impact-report', () => ({ readImpactReport: read }));
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock('@/lib/download', () => download);
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: unknown) => unknown) =>
    pick({ activeBrandId: 'brand-1', brands: [{ id: 'brand-1', name: 'Acme Coffee' }] }),
}));

const { ImpactReportView } = await import('./impact-report');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const row = (key: string, more: Partial<ImpactRow> = {}): ImpactRow => ({
  key,
  title: 'FAQ block on /pricing',
  kind: 'cms_publish',
  source: 'action_center',
  shippedAt: '2026-10-03T10:00:00.000Z',
  actionNo: 1241,
  by: { who: 'you', name: null },
  executionMode: 'assisted',
  targetPrompts: 6,
  pages: ['https://acme.example/pricing'],
  outcome: 'improved',
  confidence: 'high',
  checkpoint: 'd14',
  metric: 'visibility',
  before: 33.3,
  after: 83.3,
  controlBefore: 40,
  controlAfter: 40,
  effect: 50,
  window: {
    preStart: '2026-09-19',
    preEnd: '2026-10-02',
    postStart: '2026-10-04',
    postEnd: '2026-10-17',
  },
  notMeasurableReason: null,
  concurrent: [],
  checkpoints: [
    {
      checkpoint: 'd7',
      state: 'measured',
      outcome: 'pending',
      effect: 33,
      direction: 'up',
      measuredAt: null,
    },
    {
      checkpoint: 'd14',
      state: 'measured',
      outcome: 'improved',
      effect: 50,
      direction: 'up',
      measuredAt: null,
    },
    { checkpoint: 'd30', state: 'due', dueOn: '2026-11-02' },
    { checkpoint: 'd90', state: 'due', dueOn: '2027-01-01' },
  ],
  ...more,
});
const report = (more: Partial<ImpactReport> = {}): ImpactReport => ({
  rows: [
    row('r1'),
    row('r2', {
      title: 'Reddit answer for “AEO tools”',
      source: 'chat',
      kind: 'third_party_observed',
      actionNo: null,
      by: { who: 'teammate', name: 'Alex Kim' },
      targetPrompts: 0,
      outcome: 'not_measurable',
      confidence: null,
      notMeasurableReason: 'too_few_controls',
      before: null,
      after: null,
      controlBefore: null,
      controlAfter: null,
      effect: null,
      checkpoints: [
        { checkpoint: 'd7', state: 'none' },
        {
          checkpoint: 'd14',
          state: 'measured',
          outcome: 'not_measurable',
          effect: null,
          direction: null,
          measuredAt: null,
        },
        { checkpoint: 'd30', state: 'none' },
        { checkpoint: 'd90', state: 'none' },
      ],
    }),
    row('r3', {
      title: 'Schema on /features',
      outcome: 'pending',
      confidence: null,
      checkpoint: 'd7',
    }),
  ],
  summary: { shipped: 3, previous: 10, improved: 1, judged: 1, pending: 1 },
  traffic: { current: 120, previous: 100, pages: 2 },
  generatedAt: '2026-10-31T09:14:00.000Z',
  dataAsOf: '2026-10-31T08:00:00.000Z',
  ...more,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 31, 12, 0));
  read.mockReset().mockResolvedValue({ ok: true, report: report() });
  download.saveBlob.mockClear();
  toast.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ImpactReportView />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => host.textContent ?? '';
const $ = (selector: string) => document.querySelector(selector) as HTMLElement | null;
const click = async (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });

describe('ImpactReportView', () => {
  it('reads the brand’s month in the browser’s time, as instants and as days', async () => {
    await render();
    expect(read).toHaveBeenCalledWith('brand-1', {
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 10, 1).toISOString(),
      previousFrom: new Date(2026, 8, 1).toISOString(),
      days: { from: '2026-10-01', to: '2026-11-01', previousFrom: '2026-09-01' },
    });
  });

  it('shows the month’s headline, its method and a row a change, as the mockup does', async () => {
    await render();
    expect($('h1')?.textContent).toBe('What Ansvisor did for you');
    expect(text()).toContain(
      'Acme Coffee · shipped actions measured against untouched similar prompts',
    );
    expect($('[data-slot="month"]')?.textContent).toBe('October 2026');
    const kpis = $('[data-slot="impact-kpis"]')!.textContent;
    expect(kpis).toContain('Actions shipped3Sep: 10');
    expect(kpis).toContain('Improved1 of 1verdict at 14 days · 1 pending');
    expect(kpis).toContain('AI traffic to changed pages+20%Google Analytics · vs September');
    expect(text()).toContain('Correlation, not causation');
    expect(
      [...document.querySelectorAll('[data-action="impact.filterOutcome"]')].map(
        (b) => b.textContent,
      ),
    ).toEqual([
      'All3',
      'Improved1',
      'Pending1',
      'No meaningful change0',
      'Declined0',
      'Not measurable1',
    ]);
    const first = $('[data-row="r1"]')!;
    expect(first.textContent).toContain('AC-1241 · Action Center · published to your CMS by you');
    expect(first.textContent).toContain('Shipped Oct 3 · 6 prompts');
    expect(first.textContent).toContain('33% → 83%');
    expect(first.textContent).toContain('40% → 40%');
    expect(first.textContent).toContain('+50 pts');
    expect(
      [...first.querySelectorAll('[data-checkpoint]')].map((c) => [
        c.getAttribute('data-state'),
        c.textContent,
      ]),
    ).toEqual([
      ['measured', '▲'],
      ['measured', '+50'],
      ['due', 'Nov 2'],
      ['due', 'Jan 1'],
    ]);
    expect($('[data-row="r2"]')!.textContent).toContain('Chat · seen in AI answers by Alex Kim');
    expect($('[data-row="r2"]')!.textContent).toContain('no tracked prompt');
    expect($('[data-row="r3"]')!.textContent).toContain('Pending · early signal');
  });

  it('filters by outcome, and says when a month has none of one', async () => {
    await render();
    await click($('[data-outcome="not_measurable"]')!);
    expect(
      [...document.querySelectorAll('[data-row]')].map((r) => r.getAttribute('data-row')),
    ).toEqual(['r2']);
    await click($('[data-outcome="declined"]')!);
    expect(text()).toContain('No actions with this outcome in October 2026.');
  });

  it('opens a change’s evidence: windows, numbers, outcome, other changes and checkpoints', async () => {
    await render();
    await click($('[data-row="r1"] [data-action="impact.openEvidence"]')!);
    const drawer = $('[data-slot="impact-evidence"]')!.textContent;
    expect(drawer).toContain('BaselineSep 19 – Oct 2 · 14 days before ship');
    expect(drawer).toContain('Target prompts6 · frozen as it shipped');
    expect(drawer).toContain('Lift vs control+50 pts');
    expect(drawer).toContain('OutcomeImproved · High confidence');
    expect(drawer).toContain('Same windowNo other shipped change on these prompts');
    expect(drawer).toContain('Day 30Confirmeddue Nov 2');
  });

  it('says why a change can’t be measured', async () => {
    await render();
    await click($('[data-row="r2"] [data-action="impact.openEvidence"]')!);
    expect($('[data-slot="impact-evidence"]')!.textContent).toContain(
      'WhyNot enough similar prompts to compare.',
    );
  });

  it('downloads the month as CSV', async () => {
    await render();
    await click($('[data-action="impact.export"]')!);
    await click($('[data-action="impact.exportCsv"]')!);
    expect(download.saveBlob).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text/csv;charset=utf-8' }),
      'ansvisor-impact-2026-10.csv',
    );
    expect(toast).toHaveBeenCalledWith('Downloaded ansvisor-impact-2026-10.csv');
  });

  it('goes back a month, never past this one', async () => {
    await render();
    const [previous, next] = [...document.querySelectorAll('[data-action="impact.changeMonth"]')];
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await click(previous);
    expect($('[data-slot="month"]')?.textContent).toBe('September 2026');
    expect(read).toHaveBeenLastCalledWith(
      'brand-1',
      expect.objectContaining({
        days: { from: '2026-09-01', to: '2026-10-01', previousFrom: '2026-08-01' },
      }),
    );
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks to connect Google Analytics without its data, and says when nothing shipped', async () => {
    read.mockResolvedValue({
      ok: true,
      report: report({
        rows: [],
        summary: { shipped: 0, previous: 0, improved: 0, judged: 0, pending: 0 },
        traffic: null,
      }),
    });
    await render();
    expect(text()).toContain('Connect Google Analytics to see it');
    expect($('[data-action="integrations.connect"]')?.getAttribute('href')).toBe(
      '/dashboard/settings/integrations',
    );
    expect(text()).toContain('Nothing shipped in October 2026.');
    expect(($('[data-action="impact.export"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says it couldn’t load, and tries again', async () => {
    read.mockResolvedValueOnce({ ok: false, failure: 'failed' });
    await render();
    expect(text()).toContain("Couldn't load what Ansvisor did. Try again.");
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!);
    expect(read).toHaveBeenCalledTimes(2);
    expect($('[data-row="r1"]')).not.toBeNull();
  });
});
