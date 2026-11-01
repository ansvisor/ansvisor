import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { AgentFormSetup } from '@/lib/chat/agent-form';
import type { AgentDetail } from '@/lib/chat/agents';
import { ADMIN_CAN, AGENT_ID, NOTHING_CAN, NOW, detail } from '@/lib/chat/testing/agent-fixtures';

/**
 * Create and edit an agent (CHAT-21 §D, §C item 14; governance mockup
 * #g-agent-new; CHAT-27 item 19): the four steps and their checks, the
 * server's refusals on their steps, Save as draft and Turn on, Edit filled
 * with the agent and saved as a PATCH of what changed, Full auto and
 * workspace sharing as the plan and Settings › Chat allow, and the
 * read-only line for the roles that can't.
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => nav,
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/lib/actions/chat-access-requests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { AgentForm } = await import('./agent-form');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = 'bbbbbbbb-0000-4000-8000-000000000001';
const NEW_ID = 'aaaaaaaa-0000-4000-8000-000000000009';

const SETUP: AgentFormSetup = {
  role: 'manager',
  brands: [
    { id: BRAND, name: 'Ansvisor' },
    { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Brand B' },
  ],
  topics: [],
  engines: ['chatgpt-web', 'perplexity-web'],
  fullAuto: 'plan',
  planName: 'Starter',
  fullAutoPlan: 'Growth',
  workspaceAgentsAdminsOnly: false,
  runShareDefault: 0.1,
  takenNames: ['Win back lost citations'],
  ownKeyProvider: null,
};

let container: HTMLDivElement;
let root: Root;
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render(setup: AgentFormSetup = SETUP, agent: AgentDetail | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AgentForm setup={setup} agent={agent} now={NOW} timeZone="UTC" />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const one = (selector: string) => container.querySelector<HTMLElement>(selector);
const step = () => one('[data-slot="agent-form"]')!.getAttribute('data-step');
const errors = () => all('[data-field-error]').map((e) => e.textContent);
const summary = (row: string) => one(`[data-row="${row}"] dd`)!.textContent;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}
/** Types into a controlled field as a person does (React reads the native setter). */
async function type(el: HTMLElement, value: string) {
  await act(async () => {
    const proto =
      el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
  await settle();
}
const next = () => click(action('agentNew.next')[0]);
async function press(el: HTMLElement, key: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
  await settle();
}
const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);
const bodyOf = (n: number) => JSON.parse(String(fetchMock.mock.calls[n][1]?.body));

/** The draft the server saves from a POST's body, as its detail answers it. */
function created(init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body));
  return Response.json(
    {
      ok: true,
      agent: detail({
        id: NEW_ID,
        status: 'draft',
        name: body.name,
        visibility: body.visibility,
        maxRunShare: body.maxRunShare,
        maxMonthShare: body.maxMonthShare ?? null,
        settings: {
          skills: body.skills,
          instructions: body.instructions,
          mode: body.mode,
          connections: body.connections,
          model: body.model,
          effort: body.effort,
          scope: body.scope,
          notifyUserIds: body.notifyUserIds,
          followupDays: body.followupDays,
        },
        triggers: body.triggers.map((t: object) => ({ ...t, nextFireAt: null, lastFiredAt: null })),
      }),
    },
    { status: 201 },
  );
}

/** Pick /winback and walk to the last step. */
async function toLastStep() {
  await click(one('[data-skill="winback"]')!);
  await next();
  await next();
  await next();
  expect(step()).toBe('3');
}

beforeEach(() => {
  toast.mockClear();
  nav.push.mockClear();
  nav.refresh.mockClear();
  fetchMock.mockClear();
  answer = (url, init) => {
    if (url === '/api/chat/agents' && init?.method === 'POST') return created(init);
    if (url === `/api/chat/agents/${NEW_ID}/activate`) {
      return Response.json({ ok: true, agent: detail({ id: NEW_ID, status: 'active' }) });
    }
    return Response.json({ ok: false, failure: 'failed' }, { status: 500 });
  };
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AgentForm: new agent', () => {
  it('walks Skill · Trigger · Mode & approvals · Connections & model, stopping where a step isn’t ready', async () => {
    await render();
    expect(one('h1')!.textContent).toBe('New agent');
    expect(all('[data-action="agentNew.step"]').map((b) => b.textContent)).toEqual([
      '1Skill',
      '2Trigger',
      '3Mode & approvals',
      '4Connections & model',
    ]);
    expect(step()).toBe('0');
    // No skill yet: Next shows why and stays.
    await next();
    expect(step()).toBe('0');
    expect(errors()).toEqual(['Pick a skill.']);
    // Jumping ahead stops on the first step that isn't ready too.
    await click(one('[data-step-button="3"]')!);
    expect(step()).toBe('0');

    await click(one('[data-skill="winback"]')!);
    expect(errors()).toEqual([]);
    // Its name is the skill's, with the brand: the title alone is taken (§O).
    expect(summary('name')).toBe('Win back lost citations · Ansvisor');
    expect(summary('connections')).toBe('Google Search Console, Any CMS');
    await next();
    expect(step()).toBe('1');
    // Monday 07:00 to start, with its next run and its clock.
    const trigger = one('[data-slot="agent-form-trigger"]')!;
    expect(trigger.textContent).toContain('Every Mon 07:00');
    expect(trigger.textContent).toContain('Next run Mon 07:00 · UTC time');
    expect(summary('trigger')).toBe('Every Mon 07:00');
    expect(summary('scope')).toBe('Ansvisor');
    await next();
    expect(step()).toBe('2');
    await next();
    expect(step()).toBe('3');
    expect(one('#agent-name')!.getAttribute('value')).toBe('Win back lost citations · Ansvisor');
    expect((one('#agent-max-run') as HTMLInputElement).value).toBe('10');
    expect(summary('cost')).toBe('Up to 10% of monthly limit per run');
    expect(action('agentNew.saveDraft')).toHaveLength(1);
    expect(action('agentNew.turnOn')).toHaveLength(1);
    // Back goes back, through the stepper too.
    await click(action('agentNew.back')[0]);
    expect(step()).toBe('2');
    await click(one('[data-step-button="0"]')!);
    expect(step()).toBe('0');
  });

  it('adds, edits and removes triggers, and stops on a one-off in the past', async () => {
    await render();
    await click(one('[data-skill="faq"]')!);
    await next();
    await type(one('[data-action="agentNew.repeat"]')!, 'once');
    await type(one('[data-action="agentNew.date"]')!, '2026-10-01');
    await next();
    expect(step()).toBe('1');
    expect(errors()).toContain('A one-time schedule has to be in the future.');
    await type(one('[data-action="agentNew.date"]')!, '2026-11-05');
    expect(errors()).toEqual([]);

    // A second trigger, made a KPI: "Citations −10% in a week".
    await click(action('agentNew.addTrigger')[0]);
    await click(one('[data-trigger="kpi"]')!);
    expect(all('[data-slot="agent-form-trigger"]').map((r) => r.getAttribute('data-kind'))).toEqual(
      ['schedule', 'kpi'],
    );
    await type(one('[data-action="agentNew.threshold"]')!, '0');
    await next();
    expect(errors()).toContain('Enter a number above 0.');
    // The problem is marked on its field and read with it; one alert for the step.
    const threshold = one('[data-action="agentNew.threshold"]')!;
    expect(threshold.getAttribute('aria-invalid')).toBe('true');
    expect(threshold.getAttribute('aria-describedby')).toBe(
      one('[data-field-error^="trigger-"]')!.id,
    );
    expect(all('[role="alert"]')).toHaveLength(1);
    expect(document.activeElement).toBe(threshold);
    await type(threshold, '7');
    // Another kind and back: what it had stays.
    await click(one('[data-trigger="signal"]')!);
    await click(one('[data-trigger="kpi"]')!);
    expect((one('[data-action="agentNew.threshold"]') as HTMLInputElement).value).toBe('7');
    // Manual is always there, as its own line; triggers go only with their ×.
    expect(one('[data-slot="agent-form-manual"]')!.textContent).toContain('Always on');
    expect(one('[data-trigger="manual"]')).toBeNull();
    await click(action('agentNew.removeTrigger')[1]);
    expect(all('[data-slot="agent-form-trigger"]')).toHaveLength(1);
    await click(action('agentNew.removeTrigger')[0]);
    expect(all('[data-slot="agent-form-trigger"]')).toHaveLength(0);
    expect(one('[data-slot="agent-form-rule"]')!.textContent).toContain(
      'You press Run, or Run agent on an action',
    );
    expect(summary('trigger')).toBe('Manual');
    await next();
    expect(step()).toBe('2');
  });

  it('locks Full auto below Growth, with Upgrade, and shows what each step does in the mode', async () => {
    await render();
    await click(one('[data-skill="winback"]')!);
    await next();
    await next();
    const full = one('[data-mode="full_auto"]')!;
    expect(full.getAttribute('aria-disabled')).toBe('true');
    expect(full.textContent).toContain('Needs Growth · you’re on Starter');
    await click(full);
    expect(one('[data-mode="auto"]')!.getAttribute('aria-checked')).toBe('true');
    expect(one('[data-action="plan.upgrade"]')!.getAttribute('href')).toBe(
      '/dashboard/settings/billing',
    );
    expect(one('[data-approval="draft"]')!.textContent).toContain('Approval card');
    expect(one('[data-approval="publish"]')!.textContent).toContain('Needs your click');

    // Turned off by an Admin: not offered at all.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...SETUP, fullAuto: 'policy' });
    await click(one('[data-skill="winback"]')!);
    await next();
    await next();
    expect(one('[data-mode="full_auto"]')).toBeNull();
    expect(one('[data-slot="agent-form-gate"]')).toBeNull();
  });

  it('asks for any CMS, saying which count, Optional for /winback and Required once /publish sends the page', async () => {
    await render();
    await toLastStep();
    const cms = one('[data-connection="cms"]')!;
    expect(cms.querySelector('b')?.textContent).toBe('Any CMS');
    expect(cms.querySelector('[data-slot="connection-counts"]')?.textContent).toBe(
      'Webflow, WordPress, Framer, Wix or a workflow webhook',
    );
    expect(cms.textContent).toContain('Optional');
    expect(one('[data-connection="google_search_console"]')!.textContent).toContain('Optional');
    // An Optional one can be switched off.
    expect(cms.querySelector('[data-action="agentNew.toggleConnection"]')).not.toBeNull();

    await click(one('[data-step-button="0"]')!);
    await type(one('[data-action="agentNew.addFollowOn"]')!, 'publish');
    await click(one('[data-step-button="3"]')!);
    const needed = one('[data-connection="cms"]')!;
    expect(needed.textContent).toContain('Required by /publish');
    expect(needed.querySelector('[data-action="agentNew.toggleConnection"]')).toBeNull();
  });

  it('asks /shopping for any catalog source, uploads included, Required', async () => {
    await render();
    await click(one('[data-skill="shopping"]')!);
    await next();
    await next();
    await next();
    const catalog = one('[data-connection="catalog"]')!;
    expect(catalog.querySelector('b')?.textContent).toBe('Any catalog source');
    expect(catalog.querySelector('[data-slot="connection-counts"]')?.textContent).toBe(
      'Merchant Center, a product feed, an upload or a store',
    );
    expect(catalog.textContent).toContain('Required by /shopping');
  });

  it('saves a draft the API takes, then opens it', async () => {
    await render();
    await toLastStep();
    await type(one('#agent-name')!, 'Win back');
    await click(action('agentNew.saveDraft')[0]);
    expect(calls()).toEqual(['POST /api/chat/agents']);
    expect(bodyOf(0)).toMatchObject({
      name: 'Win back',
      visibility: 'private',
      maxRunShare: 0.1,
      skills: ['winback'],
      mode: 'auto',
      model: 'auto',
      connections: [
        { key: 'google_search_console', required: false },
        { key: 'cms', required: false },
      ],
      scope: { brand_ids: [BRAND] },
      triggers: [
        {
          kind: 'schedule',
          enabled: true,
          config: {
            type: 'recurring',
            rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=7;BYMINUTE=0',
            timezone: 'UTC',
          },
        },
      ],
    });
    // A Manager sends no monthly cap.
    expect(bodyOf(0)).not.toHaveProperty('maxMonthShare');
    expect(toast).toHaveBeenCalledWith('Saved as a draft · Win back');
    expect(nav.push).toHaveBeenCalledWith(`/dashboard/agents/${NEW_ID}`);
  });

  it('turns it on: the draft first, then Activate', async () => {
    await render();
    await toLastStep();
    await click(action('agentNew.turnOn')[0]);
    expect(calls()).toEqual(['POST /api/chat/agents', `POST /api/chat/agents/${NEW_ID}/activate`]);
    expect(toast.mock.calls[0][0]).toMatch(/^Agent is on\. Next run /);
    expect(nav.push).toHaveBeenCalledWith(`/dashboard/agents/${NEW_ID}`);
  });

  it('shows the server’s refusal on its step: a name taken, a one-off in the past, the plan’s active agents, Full auto', async () => {
    await render();
    await toLastStep();

    answer = () =>
      Response.json(
        {
          ok: false,
          failure: 'failed',
          code: 'name_taken',
          error: 'An agent named “Win back” already exists in this workspace. Pick another name.',
        },
        { status: 409 },
      );
    await click(action('agentNew.saveDraft')[0]);
    expect(step()).toBe('3');
    expect(one('[data-field-error="name"]')!.textContent).toBe(
      'An agent named “Win back” already exists in this workspace. Pick another name.',
    );
    expect(nav.push).not.toHaveBeenCalled();
    // Typing a new name clears it.
    await type(one('#agent-name')!, 'Win back 2');
    expect(one('[data-field-error="name"]')).toBeNull();

    answer = () =>
      Response.json(
        {
          ok: false,
          failure: 'failed',
          code: 'schedule_past',
          error: 'A one-time schedule has to be in the future.',
        },
        { status: 400 },
      );
    await click(action('agentNew.saveDraft')[0]);
    expect(step()).toBe('1');
    expect(one('[data-slot="agent-form-refusal"]')!.textContent).toBe(
      'A one-time schedule has to be in the future.',
    );

    answer = () =>
      Response.json(
        {
          ok: false,
          failure: 'plan',
          code: 'plan_locked',
          error: 'Full auto needs Growth.',
          asked: 'fullAuto',
          denial: {
            asked: 'You asked: Run an agent in Full auto.',
            rule: { kind: 'plan', detail: 'Full auto needs Growth.', source: null },
            whoCan: 'Growth and up.',
            nextActions: ['ask_admin'],
          },
        },
        { status: 403 },
      );
    await click(one('[data-step-button="3"]')!);
    await click(action('agentNew.turnOn')[0]);
    expect(step()).toBe('2');
    expect(one('[data-slot="agent-denial"]')!.textContent).toContain('Full auto needs Growth.');
  });

  it('keeps the draft when Turn on is refused, and turns that draft on the next time', async () => {
    let refuse = true;
    answer = (url, init) => {
      if (url === '/api/chat/agents' && init?.method === 'POST') return created(init);
      if (url === `/api/chat/agents/${NEW_ID}/activate` && refuse) {
        return Response.json(
          {
            ok: false,
            failure: 'limit',
            code: 'agent_limit',
            error:
              'Your plan keeps up to 1 agent on at once. Pause or archive one to turn this one on.',
          },
          { status: 403 },
        );
      }
      if (url === `/api/chat/agents/${NEW_ID}/activate`) {
        return Response.json({ ok: true, agent: detail({ id: NEW_ID }) });
      }
      return Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    };
    window.history.replaceState(null, '', '/dashboard/agents/new');
    await render();
    await toLastStep();
    await click(action('agentNew.turnOn')[0]);
    expect(step()).toBe('3');
    // Its name wasn't typed: the server names it (§O, against every agent).
    expect(bodyOf(0)).toMatchObject({ name: 'Win back lost citations', autoName: true });
    // The address is the draft's Edit now: a reload opens it, not a second agent.
    expect(window.location.pathname).toBe(`/dashboard/agents/${NEW_ID}/edit`);
    expect(one('[data-slot="agent-form-refusal"]')!.textContent).toBe(
      'Saved as a draft. It isn’t on yet.Your plan keeps up to 1 agent on at once. Pause or archive one to turn this one on.',
    );
    expect(nav.push).not.toHaveBeenCalled();

    refuse = false;
    await click(action('agentNew.turnOn')[0]);
    // No second agent: the draft is turned on.
    expect(calls()).toEqual([
      'POST /api/chat/agents',
      `POST /api/chat/agents/${NEW_ID}/activate`,
      `POST /api/chat/agents/${NEW_ID}/activate`,
    ]);
    expect(nav.push).toHaveBeenCalledWith(`/dashboard/agents/${NEW_ID}`);
  });

  it('keeps workspace sharing to Admins where Settings › Chat says so, and the monthly cap an Admin’s', async () => {
    await render({ ...SETUP, workspaceAgentsAdminsOnly: true });
    await toLastStep();
    const shared = one('[data-visibility="workspace"]')!;
    expect(shared.getAttribute('aria-disabled')).toBe('true');
    expect(shared.textContent).toContain('Admins only');
    await click(shared);
    expect(one('[data-visibility="private"]')!.getAttribute('aria-checked')).toBe('true');
    expect(action('agentNew.monthCap')).toHaveLength(0);

    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...SETUP, role: 'admin', workspaceAgentsAdminsOnly: true });
    await toLastStep();
    await click(one('[data-visibility="workspace"]')!);
    await click(action('agentNew.monthCap')[0]);
    await type(one('[data-action="agentNew.maxMonth"]')!, '120');
    await click(action('agentNew.saveDraft')[0]);
    expect(errors()).toEqual(['Enter a whole number from 1 to 100.']);
    expect(calls()).toEqual([]);
    await type(one('[data-action="agentNew.maxMonth"]')!, '30');
    await click(action('agentNew.saveDraft')[0]);
    expect(bodyOf(0)).toMatchObject({ visibility: 'workspace', maxMonthShare: 0.3 });
  });

  it('moves with the keyboard: arrows choose a skill, each step opens on its title, a problem takes the focus', async () => {
    await render();
    const first = one('[data-skill="winback"]')!;
    // Tab reaches the group once: the first radio while none is chosen.
    expect(first.tabIndex).toBe(0);
    expect(one('[data-skill="tasks"]')!.tabIndex).toBe(-1);
    first.focus();
    await press(first, 'ArrowRight');
    expect(one('[data-skill="tasks"]')!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(one('[data-skill="tasks"]'));
    await press(one('[data-skill="tasks"]')!, 'ArrowLeft');
    expect(document.activeElement).toBe(first);
    expect(first.getAttribute('aria-checked')).toBe('true');
    expect(first.tabIndex).toBe(0);

    await next();
    const title = one('[data-slot="agent-form-step-title"]')!;
    expect(title.textContent).toBe('Step 2 of 4 · Trigger');
    expect(document.activeElement).toBe(title);
    await next();
    await next();
    // No name: the save stops on it, with the focus there and one alert.
    await type(one('#agent-name')!, '');
    await click(action('agentNew.saveDraft')[0]);
    const name = one('#agent-name')!;
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-describedby')).toBe(
      'agent-form-note-name agent-form-error-name',
    );
    expect(all('[role="alert"]').map((a) => a.textContent)).toEqual([
      'One thing on this step needs fixing.',
    ]);
    expect(calls()).toEqual([]);
  });

  it('never lets Enter pressed again on Next save past the last step unseen (Edit)', async () => {
    await render(SETUP, detail({ can: { ...ADMIN_CAN } }));
    await click(one('[data-step-button="2"]')!);
    const nextButton = action('agentNew.next')[0];
    nextButton.focus();
    await click(nextButton);
    expect(step()).toBe('3');
    // Next is gone, not turned into Save under the focus: the focus is on the step's title.
    expect(nextButton.isConnected).toBe(false);
    expect(document.activeElement).toBe(one('[data-slot="agent-form-step-title"]'));
    await click(document.activeElement as HTMLElement);
    expect(calls()).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('shows Analysts and Agency partners a read-only line with Ask your Admin, and no form', async () => {
    await render({ ...SETUP, role: 'analyst' });
    expect(one('[data-slot="agent-form"]')).toBeNull();
    const note = one('[data-slot="agent-form-read-only"]')!;
    expect(note.textContent).toContain('You see agents read-only (Analyst)');
    expect(note.textContent).toContain('Ask your Admin');

    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...SETUP, role: 'agency_partner' });
    expect(one('[data-slot="agent-form"]')).toBeNull();
    expect(one('[data-slot="agent-form-read-only"]')!.textContent).toContain('Agency partner');
  });
});

describe('AgentForm: edit', () => {
  const editable = () => detail({ can: { ...ADMIN_CAN } });

  it('opens with the agent’s version filled in, and saves only what changed as a PATCH', async () => {
    answer = (url, init) =>
      url === `/api/chat/agents/${AGENT_ID}` && init?.method === 'PATCH'
        ? Response.json({ ok: true, agent: detail({ name: 'Win back weekly', version: 2 }) })
        : Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    await render(SETUP, editable());
    // Its name in the title, now that no breadcrumb above names it.
    expect(one('h1')!.textContent).toBe('Edit · Citation win-back');
    expect(one('h1')!.getAttribute('title')).toBe('Citation win-back');
    expect(one('[data-skill="winback"]')!.getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('/refresh');
    await click(one('[data-step-button="1"]')!);
    expect(all('[data-slot="agent-form-trigger"]').map((r) => r.getAttribute('data-kind'))).toEqual(
      ['schedule', 'signal'],
    );
    // The schedule on its own clock (Istanbul), named.
    expect(all('[data-slot="agent-form-trigger"]')[0].textContent).toContain(
      'Next run Mon 09:00 · Europe/Istanbul time',
    );
    await click(one('[data-step-button="3"]')!);
    expect((one('#agent-name') as HTMLInputElement).value).toBe('Citation win-back');
    expect(one('[data-visibility="workspace"]')!.getAttribute('aria-checked')).toBe('true');
    // On or paused: saved in place, not a draft.
    expect(action('agentNew.saveDraft')).toHaveLength(0);

    // Nothing changed: nothing sent.
    await click(action('agentNew.save')[0]);
    expect(calls()).toEqual([]);
    expect(toast).toHaveBeenCalledWith('Nothing changed');
    expect(nav.push).toHaveBeenLastCalledWith(`/dashboard/agents/${AGENT_ID}`);

    await type(one('#agent-name')!, 'Win back weekly');
    await click(action('agentNew.save')[0]);
    expect(calls()).toEqual([`PATCH /api/chat/agents/${AGENT_ID}`]);
    expect(bodyOf(0)).toEqual({
      expectedVersion: 2,
      expectedUpdatedAt: '2026-10-29T10:00:00.000Z',
      name: 'Win back weekly',
    });
    expect(toast).toHaveBeenLastCalledWith('Saved · Win back weekly');
  });

  it('shows a save over someone else’s with Reload', async () => {
    answer = () =>
      Response.json(
        {
          ok: false,
          failure: 'failed',
          code: 'version_conflict',
          error: 'This agent was changed since you opened it. Reload to see its latest version.',
        },
        { status: 409 },
      );
    await render(SETUP, editable());
    await click(one('[data-step-button="3"]')!);
    await type(one('#agent-name')!, 'Mine');
    await click(action('agentNew.save')[0]);
    expect(one('[data-slot="agent-form-alert"]')!.getAttribute('data-refusal')).toBe(
      'version_conflict',
    );
    // The focus is on the refusal, so it is read and Reload is next.
    expect(document.activeElement).toBe(one('[data-slot="agent-form-alert"]'));
    await click(action('agentNew.reload')[0]);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('turns an edited draft on with Save as draft or Turn on', async () => {
    answer = (url) =>
      url === `/api/chat/agents/${AGENT_ID}/activate`
        ? Response.json({ ok: true, agent: detail() })
        : Response.json({ ok: false, failure: 'failed' }, { status: 500 });
    await render(SETUP, detail({ status: 'draft', can: { ...ADMIN_CAN } }));
    await click(one('[data-step-button="3"]')!);
    expect(action('agentNew.saveDraft')).toHaveLength(1);
    await click(action('agentNew.turnOn')[0]);
    expect(calls()).toEqual([`POST /api/chat/agents/${AGENT_ID}/activate`]);
  });

  it('is read-only without the right to change it', async () => {
    await render(SETUP, detail({ mine: false, can: { ...NOTHING_CAN } }));
    expect(one('[data-slot="agent-form"]')).toBeNull();
    // Still named, read-only too.
    expect(one('h1')!.textContent).toBe('Edit · Citation win-back');
    expect(one('[data-slot="agent-form-read-only"]')!.textContent).toContain(
      'Only its owner or an Admin can change it',
    );
    act(() => root.unmount());
    root = createRoot(container);
    await render(SETUP, detail({ status: 'archived', can: { ...NOTHING_CAN } }));
    expect(one('[data-slot="agent-form-read-only"]')!.textContent).toContain(
      'This agent is archived',
    );
    expect(one('[data-slot="agent-form-read-only"]')!.textContent).not.toContain('Ask your Admin');
  });
});
