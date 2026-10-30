import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { AgentDetail as Agent, AgentRunView } from '@/lib/chat/agents';
import {
  ADMIN_CAN,
  AGENT_ID,
  NOTHING_CAN,
  NOW,
  detail,
  run,
} from '@/lib/chat/testing/agent-fixtures';

/**
 * An agent's detail (CHAT-21 §C; governance mockup #g-agent; CHAT-27 item
 * 25): its state, owner and This period; only the buttons `can` allows;
 * skills, mode, connections and model; triggers with the next run; runs
 * with their AI use against their cap ("3.2% of 10%"), state, trigger and
 * brand, never dollars; the side cards; a refused button's answer; and a
 * plain line when it can't be read or isn't there.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: nav.push }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/chat-access-requests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { AgentDetail } = await import('./agent-detail');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
let agent: Agent;
let runs: AgentRunView[];
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

const base = (url: string): Response | null => {
  if (url === `/api/chat/agents/${AGENT_ID}`) return Response.json({ ok: true, agent });
  if (url === `/api/chat/agents/${AGENT_ID}/runs`) return Response.json({ ok: true, runs });
  return null;
};

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AgentDetail id={AGENT_ID} now={NOW} timeZone="UTC" />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const one = (selector: string) => container.querySelector<HTMLElement>(selector);
async function click(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    el.click();
  });
  await settle();
}
const posts = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([url]) => url.replace(`/api/chat/agents/${AGENT_ID}/`, ''));

beforeEach(() => {
  toast.mockClear();
  toast.error.mockClear();
  nav.push.mockClear();
  fetchMock.mockClear();
  agent = detail();
  runs = [
    run(),
    run({
      status: 'stopped',
      stopReason: 'no_answer',
      triggerKind: 'manual',
      by: 'Ayşe Demir',
      brand: 'Brand B',
      outcome: null,
      outcomeConfidence: null,
      usageShare: 0.004,
      maxShare: 0.15,
      chatId: null,
    }),
  ];
  answer = (url) => base(url) ?? Response.json({ ok: false, failure: 'failed' }, { status: 500 });
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

describe('AgentDetail', () => {
  it('shows the name, state, owner, visibility and This period with the monthly cap', async () => {
    agent = detail({ maxMonthShare: 0.2 });
    await render();
    expect(one('h1')?.textContent).toBe('Citation win-back');
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Active · Next run Mon 09:00');
    const meta = one('[data-slot="agent-meta"]')!.textContent;
    expect(meta).toContain('Owner: You');
    expect(meta).toContain('Workspace');
    expect(one('[data-slot="agent-this-period"]')?.textContent).toBe(
      'This period: 2.1% · monthly cap 20%',
    );
  });

  it('shows no write button when `can` allows none', async () => {
    agent = detail({ can: { ...NOTHING_CAN } });
    await render();
    for (const name of [
      'agent.runNow',
      'agent.pause',
      'agent.resume',
      'agent.activate',
      'agent.restore',
      'agent.more',
    ]) {
      expect(action(name)).toHaveLength(0);
    }
  });

  it('shows the buttons `can` allows: Pause, Run now, and Duplicate, Take over and Archive under ⋯', async () => {
    agent = detail({ can: { ...ADMIN_CAN }, mine: false });
    await render();
    expect(action('agent.pause')).toHaveLength(1);
    expect(action('agent.runNow')).toHaveLength(1);
    await click(action('agent.more')[0]);
    expect(
      [...document.body.querySelectorAll('[data-action^="agent."][role="menuitem"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['Duplicate', 'Take over', 'Archive']);
  });

  it('offers Activate for a draft, Resume when paused and Restore when archived', async () => {
    const remount = async () => {
      act(() => root.unmount());
      root = createRoot(container);
      await render();
    };
    agent = detail({ status: 'draft', can: { ...NOTHING_CAN, activate: true } });
    await render();
    expect(action('agent.activate')).toHaveLength(1);
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Draft · Not on yet');

    agent = detail({
      status: 'paused',
      pausedReason: 'manual',
      can: { ...NOTHING_CAN, resume: true },
    });
    await remount();
    expect(action('agent.resume')).toHaveLength(1);
    expect(one('[data-slot="agent-status"]')?.textContent).toBe('Paused · Paused by a person');

    agent = detail({ status: 'archived', can: { ...NOTHING_CAN, restore: true } });
    await remount();
    expect(action('agent.restore')).toHaveLength(1);
    expect(action('agent.runNow')).toHaveLength(0);
  });

  it('pauses the agent and shows it paused, with a toast', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    answer = (url) =>
      url.endsWith('/pause')
        ? Response.json({
            ok: true,
            agent: detail({
              status: 'paused',
              pausedReason: 'manual',
              can: { ...ADMIN_CAN, pause: false, resume: true },
            }),
          })
        : (base(url) as Response);
    await render();
    await click(action('agent.pause')[0]);
    expect(posts()).toEqual(['pause']);
    expect(toast).toHaveBeenCalledWith(
      'Citation win-back paused · its triggers stop until you resume it',
    );
    expect(action('agent.resume')).toHaveLength(1);
  });

  it('runs it now, reads it again, and duplicates it into a draft it opens', async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    answer = (url) =>
      url.endsWith('/run')
        ? Response.json(
            {
              ok: true,
              runs: [
                { brand: 'Ansvisor', status: 'queued', repeated: false, coalesced: false },
                { brand: 'Brand B', status: 'queued', repeated: false, coalesced: false },
              ],
            },
            { status: 202 },
          )
        : url.endsWith('/duplicate')
          ? Response.json(
              {
                ok: true,
                agent: detail({
                  id: 'aaaaaaaa-0000-4000-8000-000000000009',
                  name: 'Citation win-back copy',
                }),
              },
              { status: 201 },
            )
          : (base(url) as Response);
    await render();
    await click(action('agent.runNow')[0]);
    expect(toast).toHaveBeenCalledWith('2 runs queued, one a brand');
    expect(
      fetchMock.mock.calls.filter(([url]) => url === `/api/chat/agents/${AGENT_ID}`),
    ).toHaveLength(2);

    await click(action('agent.more')[0]);
    await click(document.body.querySelector<HTMLElement>('[data-action="agent.duplicate"]')!);
    expect(toast).toHaveBeenCalledWith('Copied as a draft · Citation win-back copy');
    expect(nav.push).toHaveBeenCalledWith(
      '/dashboard/chat/agents/aaaaaaaa-0000-4000-8000-000000000009',
    );
  });

  it('shows skills, mode, connections with Required or Optional, and the model', async () => {
    await render();
    const field = (name: string) => one(`[data-field="${name}"]`)?.textContent;
    expect(field('skills')).toBe('Skills/winback/refresh');
    expect(field('mode')).toBe('ModeAuto, ask before changes');
    expect(field('connections')).toBe('ConnectionsGoogle Search ConsoleRequiredWebflowOptional');
    expect(field('model')).toBe('ModelAutoMonthly AI limit');
  });

  it('lists the triggers with their next run, or when they fire', async () => {
    await render();
    const rows = all('[data-slot="agent-trigger"]');
    expect(rows.map((row) => row.textContent)).toEqual([
      'ScheduleEvery Mon 09:00Next run Mon 09:00 · UTC time',
      'Signal createdNew Recover signalFires when Action Center finds a matching signal',
    ]);
    expect(rows[0].querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('On');
  });

  it("lists the runs with their AI use against their cap, state, trigger and brand, and opens a run's chat", async () => {
    await render();
    const rows = all('[data-slot="agent-run"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute('href')).toBe(
      '/dashboard/chat/cccccccc-0000-4000-8000-000000000001',
    );
    expect(rows[0].querySelector('[data-slot="run-ai-use"]')?.textContent).toBe('3.2% of 10%');
    expect(rows[0].textContent).toContain('Schedule');
    expect(rows[0].textContent).toContain('Ansvisor');
    expect(rows[0].textContent).toContain('Done');
    expect(rows[0].querySelector('[data-slot="run-outcome"]')?.textContent).toBe('Improved');
    expect(rows[1].tagName).toBe('DIV');
    expect(rows[1].textContent).toContain('Manual · Ayşe Demir');
    expect(rows[1].textContent).toContain('Brand B');
    expect(rows[1].textContent).toContain('Stopped');
    expect(rows[1].textContent).toContain('No answer in 7 days');
    expect(rows[1].querySelector('[data-slot="run-ai-use"]')?.textContent).toBe('0.4% of 15%');
    expect(container.textContent).not.toMatch(/\$/);

    await click(action('agent.filterRuns')[3]);
    expect(all('[data-slot="agent-run"]')).toHaveLength(1);
    await click(action('agent.filterRuns')[1]);
    expect(all('[data-slot="agent-run"]')).toHaveLength(1);
  });

  it('shows Access, Scope and AI use as shares beside the runs', async () => {
    agent = detail({ maxRunShare: 0.15 });
    await render();
    const row = (name: string) => one(`[data-row="${name}"]`)?.textContent;
    expect(row('owner')).toBe('You');
    expect(row('visibility')).toBe('Workspace');
    expect(row('brands')).toBe('Ansvisor');
    expect(row('engines')).toBe('Perplexity');
    expect(row('perRun')).toBe('15%');
    expect(row('monthCap')).toBe('None');
    expect(row('thisPeriod')).toBe('2.1%');
    expect(row('days30')).toBe('3.4% · 4 runs');
  });

  it("shows the out-of-permission answer for a refused button, and the server's words for a plain refusal", async () => {
    agent = detail({ can: { ...ADMIN_CAN } });
    answer = (url) =>
      url.endsWith('/run')
        ? Response.json(
            {
              ok: false,
              failure: 'plan',
              code: 'plan_locked',
              error: 'Full auto needs Growth.',
              denial: {
                asked: 'You asked: Run an agent now',
                rule: { kind: 'plan', detail: 'Full auto needs Growth.', source: null },
                whoCan: 'Growth workspaces can do this.',
                nextActions: ['upgrade'],
                needsPlan: 'Growth',
              },
            },
            { status: 402 },
          )
        : url.endsWith('/pause')
          ? Response.json(
              {
                ok: false,
                failure: 'failed',
                code: 'wrong_status',
                error: 'This agent is paused, so it can’t do that now.',
              },
              { status: 409 },
            )
          : (base(url) as Response);
    await render();
    await click(action('agent.runNow')[0]);
    const denial = one('[data-slot="agent-denial"]')!;
    expect(denial.textContent).toContain('You asked: Run an agent now');
    expect(denial.textContent).toContain('Full auto needs Growth.');
    await click(action('agent.pause')[0]);
    expect(one('[data-slot="agent-denial"]')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('This agent is paused, so it can’t do that now.');
  });

  it('says when the agent could not be read, with Retry, and no skeleton left behind', async () => {
    answer = () => Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    await render();
    expect(one('[data-slot="agent-error"]')?.textContent).toContain("Couldn't load this agent.");
    expect(one('[data-slot="skeleton"]')).toBeNull();
    answer = (url) => base(url) as Response;
    await click(action('agent.retry')[0]);
    expect(one('h1')?.textContent).toBe('Citation win-back');
  });

  it("says when the agent isn't there, with the way back to Agents", async () => {
    answer = () => Response.json({ ok: false, failure: 'not_found' }, { status: 404 });
    await render();
    expect(one('[data-slot="agent-error"]')?.textContent).toContain("This agent isn't available.");
    expect(action('agents.back')[0].getAttribute('href')).toBe('/dashboard/chat/agents');
  });

  it('keeps the agent when only its runs could not be read', async () => {
    answer = (url) =>
      url.endsWith('/runs')
        ? Response.json({ ok: false, failure: 'failed' }, { status: 500 })
        : (base(url) as Response);
    await render();
    expect(one('h1')?.textContent).toBe('Citation win-back');
    expect(one('[data-slot="agent-runs-error"]')?.textContent).toContain("Couldn't load the runs.");
  });
});
