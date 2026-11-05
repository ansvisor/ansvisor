import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { AgentImpact, AgentImpactRow } from '@/lib/chat/agent-impact';
import { checkpointMarks } from '@/lib/impact/report';

/**
 * "What this agent did" on the agent's page (the owner's approved mockup):
 * the last 30 days, no period to pick; the headline as Reports has it
 * (Improved X of Y over Medium and High verdicts, "—" before any); each
 * change with how it went live (on its own, you approved, by a teammate)
 * and from which run, its outcome in Reports' words and its next
 * checkpoint; the drafts not live yet; the method line and Open in
 * Reports. Three states: with results, the first week, nothing live yet.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AgentImpactCard } = await import('./agent-impact-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const AGENT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHAT = 'cccccccc-0000-4000-8000-000000000031';

type Entry = { checkpoint: string; outcome: string; effect?: number; direction?: string };

/** A change as the API answers it, its checkpoints as Reports' strip reads them. */
function change(
  key: string,
  more: Partial<AgentImpactRow> & { entries?: Entry[] } = {},
): AgentImpactRow {
  const { entries = [], ...rest } = more;
  const shippedAt = rest.shippedAt ?? '2026-10-28T10:00:00.000Z';
  return {
    key,
    title: 'Refresh of /guides/cold-brew-ratio',
    kind: 'cms_publish',
    source: 'content_editor',
    shippedAt,
    actionNo: null,
    by: { who: 'you', name: null },
    executionMode: 'automated',
    targetPrompts: 6,
    pages: [],
    outcome: 'pending',
    confidence: null,
    checkpoint: null,
    metric: 'visibility',
    before: null,
    after: null,
    controlBefore: null,
    controlAfter: null,
    effect: null,
    direction: null,
    window: null,
    notMeasurableReason: null,
    concurrent: [],
    checkpoints: checkpointMarks(shippedAt, entries, false),
    credit: { who: 'own' },
    run: { number: 31, chatId: null },
    ...rest,
  };
}

/** The mockup's "with results": five changes, three verdicts, one pending. */
const full = (): AgentImpact => ({
  rows: [
    change('r1', {
      checkpoint: 'd7',
      direction: 'up',
      credit: { who: 'you' },
      run: { number: 31, chatId: CHAT },
      entries: [{ checkpoint: 'd7', outcome: 'pending', direction: 'up' }],
    }),
    change('r2', {
      title: 'FAQ block on /subscriptions',
      shippedAt: '2026-10-14T10:00:00.000Z',
      targetPrompts: 9,
      outcome: 'improved',
      confidence: 'high',
      checkpoint: 'd14',
      effect: 6.4,
      run: { number: 27, chatId: null },
      entries: [
        { checkpoint: 'd7', outcome: 'pending', direction: 'up' },
        { checkpoint: 'd14', outcome: 'improved', effect: 6.4 },
      ],
    }),
    change('r3', {
      title: 'Refresh of /blog/best-beans-for-espresso',
      shippedAt: '2026-10-09T10:00:00.000Z',
      targetPrompts: 4,
      outcome: 'no_meaningful_change',
      confidence: 'medium',
      checkpoint: 'd14',
      effect: 0.8,
      credit: { who: 'teammate', name: 'Sam Lee' },
      run: { number: 24, chatId: null },
      // No day-7 reading: its next check is still day 30, never a day 7 in the past.
      entries: [{ checkpoint: 'd14', outcome: 'no_meaningful_change', effect: 0.8 }],
    }),
    change('r4', {
      title: 'Refresh of /blog/decaf-guide',
      shippedAt: '2026-10-07T10:00:00.000Z',
      targetPrompts: 7,
      outcome: 'improved',
      confidence: 'medium',
      checkpoint: 'd14',
      effect: 3.9,
      credit: { who: 'you' },
      run: { number: 19, chatId: null },
      entries: [{ checkpoint: 'd14', outcome: 'improved', effect: 3.9 }],
    }),
    change('r5', {
      title: 'Comparison table on /gift-boxes',
      shippedAt: '2026-10-08T10:00:00.000Z',
      targetPrompts: 2,
      outcome: 'not_measurable',
      checkpoint: 'd14',
      notMeasurableReason: 'too_few_prompts',
      credit: { who: 'you' },
      run: { number: 22, chatId: null },
      entries: [{ checkpoint: 'd14', outcome: 'not_measurable' }],
    }),
  ],
  capped: false,
  summary: { shipped: 5, previous: null, improved: 2, judged: 3, pending: 1 },
  draftsNotLive: 3,
});

let container: HTMLDivElement;
let root: Root;
let answer: () => Response;
const fetchMock = vi.fn(async (url: string) => {
  if (url !== `/api/chat/agents/${AGENT_ID}/impact`) throw new Error(`unexpected ${url}`);
  return answer();
});
const reply = (impact: AgentImpact) => () => Response.json({ ok: true, impact });

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AgentImpactCard id={AGENT_ID} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const one = (selector: string) => container.querySelector<HTMLElement>(selector);
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const text = (selector: string) => one(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const kpi = (slot: string) => text(`[data-kpi="${slot}"]`);
const rowTexts = (slot: string) =>
  all('[data-slot="agent-impact-row"]').map((row) =>
    row.querySelector(`[data-slot="${slot}"]`)?.textContent?.replace(/\s+/g, ' ').trim(),
  );

beforeEach(() => {
  fetchMock.mockClear();
  answer = reply(full());
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AgentImpactCard: with results', () => {
  it('says the last 30 days, with no period to pick, and Reports’ headline', async () => {
    await render();
    expect(text('#agent-impact-title')).toBe('What this agent did');
    expect(text('[data-slot="agent-impact-period"]')).toBe('Last 30 days');
    expect(one('select, [role="combobox"]')).toBeNull();
    expect(kpi('shipped')).toBe('Changes shipped5pages that went live from its runs');
    expect(kpi('improved')).toBe('Improved2 of 3verdict at 14 days · Medium and High only');
    expect(kpi('pending')).toBe('Pending1first verdict 14 days after it ships');
  });

  it('lists each change with how it went live, its run, its outcome and its next checkpoint', async () => {
    await render();
    expect(rowTexts('agent-impact-meta')).toEqual([
      'Published to your CMS · run #31, you approved · Shipped Oct 28 · 6 prompts',
      'Published to your CMS · run #27, on its own · Shipped Oct 14 · 9 prompts',
      'Published to your CMS · run #24, by Sam Lee · Shipped Oct 9 · 4 prompts',
      'Published to your CMS · run #19, you approved · Shipped Oct 7 · 7 prompts',
      'Published to your CMS · run #22, you approved · Shipped Oct 8 · 2 prompts',
    ]);
    expect(rowTexts('agent-impact-outcome')).toEqual([
      'Pending · early signal',
      'Improved',
      'No meaningful change',
      'Improved',
      'Not measurable',
    ]);
    expect(rowTexts('agent-impact-detail')).toEqual([
      'Early direction: up · Day 14, due Nov 11',
      '+6.4 pts · High · Day 30, due Nov 13',
      '+0.8 pts · Medium · Day 30, due Nov 8',
      '+3.9 pts · Medium · Day 30, due Nov 6',
      undefined,
    ]);
    expect(rowTexts('agent-impact-reason')).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'Too few target prompts for a verdict.',
    ]);
    // A run whose chat the person may open links to it.
    const link = one('[data-action="agent.openImpactRun"]');
    expect(link?.getAttribute('href')).toBe(`/dashboard/chat/${CHAT}`);
    expect(link?.textContent).toBe('run #31');
    expect(all('[data-action="agent.openImpactRun"]')).toHaveLength(1);
  });

  it('counts the drafts not live yet, and gives the method and Open in Reports', async () => {
    await render();
    expect(text('[data-slot="agent-impact-drafts"]')).toBe(
      "3 drafts from this agent aren't live yet. Drafts aren't measured until they go live.",
    );
    expect(text('[data-slot="agent-impact-method"] span')).toBe(
      'Baseline: 14 days before ship · Control: untouched similar prompts · Min. change: 3 pts · Correlation, not causation',
    );
    const reports = one('[data-action="agent.openReports"]');
    expect(reports?.getAttribute('href')).toBe('/dashboard/reports/impact');
    expect(reports?.textContent).toBe('Open in Reports →');
  });

  it('names a teammate who left as a teammate, and a change with no run by how it went live', async () => {
    answer = reply({
      ...full(),
      rows: [
        change('r1', { credit: { who: 'teammate', name: null }, run: null }),
        change('r2', { credit: { who: 'own' }, run: null }),
      ],
      draftsNotLive: 0,
    });
    await render();
    expect(rowTexts('agent-impact-meta')).toEqual([
      'Published to your CMS · by a teammate · Shipped Oct 28 · 6 prompts',
      'Published to your CMS · on its own · Shipped Oct 28 · 6 prompts',
    ]);
    expect(one('[data-slot="agent-impact-drafts"]')).toBeNull();
  });

  it('shows the newest 5, then all of them on a click', async () => {
    const impact = full();
    impact.rows.push(change('r6', { title: 'Sixth' }), change('r7', { title: 'Seventh' }));
    answer = reply(impact);
    await render();
    expect(all('[data-slot="agent-impact-row"]')).toHaveLength(5);
    const more = one('[data-action="agent.showAllImpact"]')!;
    expect(more.textContent).toBe('Show all 7');
    await act(async () => more.click());
    expect(all('[data-slot="agent-impact-row"]')).toHaveLength(7);
    expect(more.textContent).toBe('Show fewer');
  });
});

describe('AgentImpactCard: the first week', () => {
  it('shows the pending change with its first checkpoint, and no Improved yet', async () => {
    answer = reply({
      rows: [
        change('r1', {
          shippedAt: '2026-11-01T10:00:00.000Z',
          credit: { who: 'you' },
          run: { number: 3, chatId: null },
        }),
      ],
      capped: false,
      summary: { shipped: 1, previous: null, improved: 0, judged: 0, pending: 1 },
      draftsNotLive: 2,
    });
    await render();
    expect(kpi('shipped')).toBe('Changes shipped1pages that went live from its runs');
    expect(kpi('improved')).toBe('Improved—no verdict yet');
    expect(kpi('pending')).toBe('Pending1first verdict 14 days after it ships');
    expect(rowTexts('agent-impact-meta')).toEqual([
      'Published to your CMS · run #3, you approved · Shipped Nov 1 · 6 prompts',
    ]);
    expect(rowTexts('agent-impact-outcome')).toEqual(['Pending']);
    expect(rowTexts('agent-impact-detail')).toEqual(['Day 7, due Nov 8']);
    expect(text('[data-slot="agent-impact-drafts"]')).toBe(
      "2 drafts from this agent aren't live yet. Drafts aren't measured until they go live.",
    );
  });
});

describe('AgentImpactCard: nothing live yet', () => {
  const empty = (draftsNotLive: number): AgentImpact => ({
    rows: [],
    capped: false,
    summary: { shipped: 0, previous: null, improved: 0, judged: 0, pending: 0 },
    draftsNotLive,
  });

  it('says what will show and when, with the method and Open in Reports', async () => {
    answer = reply(empty(0));
    await render();
    expect(text('[data-slot="agent-impact-empty"]')).toBe(
      "Nothing from this agent has gone live yet.When a page from one of its runs goes live, it shows here: an early signal 7 days later, the first verdict at 14 days. Drafts aren't measured until they go live.",
    );
    expect(one('[data-slot="agent-impact-kpis"]')).toBeNull();
    expect(one('[data-slot="agent-impact-drafts"]')).toBeNull();
    expect(one('[data-action="agent.openReports"]')).not.toBeNull();
  });

  it('counts its drafts not live yet, without saying twice that they aren’t measured', async () => {
    answer = reply(empty(1));
    await render();
    expect(text('[data-slot="agent-impact-drafts"]')).toBe(
      "1 draft from this agent isn't live yet.",
    );
  });
});

describe('AgentImpactCard: when it can’t be read', () => {
  it('says so, and reads again on Retry', async () => {
    answer = () => Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    await render();
    expect(text('[data-slot="agent-impact-error"]')).toBe(
      "Couldn't load what this agent did. Retry",
    );
    answer = reply(full());
    await act(async () => one('[data-action="agent.retryImpact"]')!.click());
    await settle();
    expect(one('[data-slot="agent-impact-error"]')).toBeNull();
    expect(all('[data-slot="agent-impact-row"]')).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says when the 30 days hold more changes than it lists', async () => {
    answer = reply({ ...full(), capped: true });
    await render();
    expect(text('[data-slot="agent-impact-capped"]')).toBe(
      'Showing the newest 5 changes; the counts above cover only these.',
    );
  });
});
