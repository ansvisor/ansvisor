import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatSettingsView, PolicyRow } from '@/lib/actions/chat-settings';

/** Settings › Chat (CHAT-20 §5, mockup #g-policy). */

const actions = vi.hoisted(() => ({
  getChatSettingsView: vi.fn(),
  setToolPolicy: vi.fn(),
  resetToolPolicies: vi.fn(),
  setChatSwitch: vi.fn(),
  setManagerExecute: vi.fn(),
  removeAutoChoice: vi.fn(),
}));
vi.mock('@/lib/actions/chat-settings', () => actions);
vi.mock('@/lib/actions/chat-access-requests', () => ({ requestAccess: vi.fn() }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ guard: (fn: unknown) => fn }),
}));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: null, refresh: vi.fn() }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ChatSettingsSection } = await import('./chat-settings-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  for (const fn of [...Object.values(actions), ...Object.values(toast)]) fn.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flags = { alwaysCard: false, costCard: false, adminMayTurnOff: false };
const rows: PolicyRow[] = [
  {
    key: 'trackedPrompts',
    area: 'prompts',
    class: 'read',
    flags,
    policy: 'on',
    defaultPolicy: 'on',
    changed: false,
    choices: [],
  },
  {
    key: 'saveDraft',
    area: 'content',
    class: 'write',
    flags,
    policy: 'ask_full_auto',
    defaultPolicy: 'ask_full_auto',
    changed: false,
    choices: [
      { policy: 'never', locked: false },
      { policy: 'ask', locked: false },
      { policy: 'ask_full_auto', locked: true },
      { policy: 'always', locked: true },
    ],
  },
];
const view = (over: Partial<ChatSettingsView> = {}): ChatSettingsView => ({
  role: 'admin',
  plan: null,
  fullAutoLocked: null,
  fullAutoForMembers: true,
  dontAskAgain: true,
  managerExecuteOff: ['feeds'],
  rows,
  autoChoices: ['saveDraft'],
  ...over,
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatSettingsSection />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);

describe('ChatSettingsSection', () => {
  it("lets an Admin pick a tool's policy, saved and read again", async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view() });
    actions.setToolPolicy.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain('Read tracked prompts');
    expect(text()).toContain('Runs freely');
    expect(text()).toContain('Auto in Full auto');
    expect(text()).not.toContain('create_draft');
    await act(async () => button('Never')!.click());
    expect(actions.setToolPolicy).toHaveBeenCalledWith('saveDraft', 'never');
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(actions.getChatSettingsView).toHaveBeenCalledTimes(2);
  });

  it('switches a go-live group for Managers, and says why a save failed', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view() });
    actions.setManagerExecute.mockResolvedValue({ ok: false, failure: 'read_only' });
    await render();
    const feeds = container.querySelector('[role="switch"][aria-label="Product feeds"]')!;
    expect(feeds.getAttribute('aria-checked')).toBe('false');
    await act(async () => (feeds as HTMLButtonElement).click());
    expect(actions.setManagerExecute).toHaveBeenCalledWith('feeds', true);
    expect(toast.error).toHaveBeenCalledWith('This workspace is read-only until a plan is active.');
  });

  it('locks what the plan locks, and Full auto below Growth', async () => {
    actions.getChatSettingsView.mockResolvedValue({
      ok: true,
      view: view({ fullAutoLocked: 'growth', plan: null }),
    });
    await render();
    const always = button('Always') as HTMLButtonElement;
    expect(always.disabled).toBe(true);
    expect(always.title).toBe('Needs Growth');
    expect(container.querySelectorAll('[role="switch"][aria-label^="Full auto"]')).toHaveLength(0);
    expect(text()).toContain('Needs Growth · you');
    expect(text()).toContain('Card in every mode');
  });

  it('is read-only for anyone else, who still removes their own tick', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: true, view: view({ role: 'manager' }) });
    actions.removeAutoChoice.mockResolvedValue({ ok: true });
    await render();
    expect(text()).toContain('Read-only · only Admins change the Chat tool policy');
    expect(container.querySelector('[role="radiogroup"]')).toBeNull();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(button('Reset to defaults')).toBeUndefined();
    await act(async () => button('Remove')!.click());
    expect(actions.removeAutoChoice).toHaveBeenCalledWith('saveDraft');
    expect(toast.success).toHaveBeenCalledWith('Removed: it asks again');
  });

  it('says so in plain words when it can’t be read, and reads again on Retry', async () => {
    actions.getChatSettingsView.mockResolvedValue({ ok: false, failure: 'failed' });
    await render();
    expect(text()).toContain("Couldn't load Chat's settings.");
    await act(async () => button('Retry')!.click());
    expect(actions.getChatSettingsView).toHaveBeenCalledTimes(2);
  });
});
