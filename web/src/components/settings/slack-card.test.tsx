import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { SlackCardRead } from '@/lib/slack-client';

const client = vi.hoisted(() => ({
  readSlack: vi.fn(),
  startSlackConnect: vi.fn(),
  activateSlack: vi.fn(),
  chooseSlackWorkspace: vi.fn(),
  listSlackChannels: vi.fn(),
  saveSlack: vi.fn(),
  sendSlackTest: vi.fn(),
  disconnectSlack: vi.fn(),
}));
vi.mock('@/lib/slack-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/slack-client')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({
    activeBrandId: 'b1',
    brands: [
      { id: 'b1', name: 'Northwind' },
      { id: 'b2', name: 'Contoso' },
    ],
  }),
}));
const demo = vi.hoisted(() => ({ on: false }));
vi.mock('@/components/providers/demo-brand-provider', () => ({
  useDemoBrand: () => ({ isDemo: demo.on }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const openUpgrade = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ isLocked: false }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({
    isLocked: gate.isLocked,
    openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        gate.isLocked ? openUpgrade(options.action) : fn(...args),
  }),
}));
// The pickers as native selects: Base UI's popups don't open in jsdom.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({
    items,
    value,
    onValueChange,
    onOpenChange,
  }: {
    items: { value: string; label: string }[];
    value: { value: string } | null;
    onValueChange: (item: { value: string; label: string } | null) => void;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <select
      data-picker="channel"
      value={value?.value ?? ''}
      onFocus={() => onOpenChange?.(true)}
      onChange={(e) => onValueChange(items.find((i) => i.value === e.target.value) ?? null)}
    >
      <option value="">—</option>
      {items.map((i) => (
        <option key={i.value} value={i.value}>
          {i.label}
        </option>
      ))}
    </select>
  ),
  ComboboxCollection: () => null,
  ComboboxContent: () => null,
  ComboboxEmpty: () => null,
  ComboboxInput: () => null,
  ComboboxItem: () => null,
  ComboboxList: () => null,
  ComboboxTrigger: () => null,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({
    items,
    onValueChange,
  }: {
    items: { value: string; label: string }[];
    onValueChange: (value: string | null) => void;
  }) => (
    <select data-picker="workspace" value="" onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {items.map((i) => (
        <option key={i.value} value={i.value}>
          {i.label}
        </option>
      ))}
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const { SlackCard } = await import('./slack-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Settings › Integrations › Slack (#2139): where the active brand's Pulse
 * and alerts go. Admins and managers connect a workspace, pick the channel
 * and what goes to it, send a test message and disconnect; others see
 * where messages go.
 */

let container: HTMLDivElement;
let root: Root;

const ALL_ON = { pulse: true, drops: true, suggestion: true, needsYou: true };
const CHANNEL = { id: 'C00000001', name: 'seo-alerts', private: false };
const WORKSPACE = {
  accountId: 'acct-1',
  label: 'Acme Test (acme-test.slack.com)',
  connectedBy: 'Sam Lee',
  connectedAt: '2026-11-10T09:00:00Z',
  sharedWith: ['b2'],
};
const card = (over: Partial<SlackCardRead> = {}): SlackCardRead => ({
  configured: true,
  allowed: true,
  state: 'connected',
  workspace: WORKSPACE,
  channel: CHANNEL,
  send: ALL_ON,
  usable: [],
  ...over,
});
const NOT_CONNECTED = card({ state: 'not_connected', workspace: null, channel: null });

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SlackCard />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => container.textContent ?? '';
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const badges = () =>
  [...container.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent);
const switches = () => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
const picker = (name: string) =>
  container.querySelector<HTMLSelectElement>(`select[data-picker="${name}"]`);
async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

beforeEach(() => {
  role.canManage = true;
  demo.on = false;
  gate.isLocked = false;
  openUpgrade.mockClear();
  for (const fn of Object.values(client)) fn.mockReset();
  client.readSlack.mockResolvedValue({ ok: true, ...card() });
  client.listSlackChannels.mockResolvedValue({
    ok: true,
    channels: [
      { id: 'G00000003', name: 'northwind-seo', private: true, members: 3 },
      { ...CHANNEL, members: 12 },
    ],
  });
  client.saveSlack.mockImplementation(async (_brand: string, patch: Record<string, unknown>) => ({
    ok: true,
    ...card(
      patch.channelId
        ? { channel: { id: String(patch.channelId), name: 'northwind-seo', private: true } }
        : { send: { ...ALL_ON, ...(patch.send as object) } },
    ),
  }));
  client.sendSlackTest.mockResolvedValue({ ok: true, sent: true, channel: CHANNEL });
  client.disconnectSlack.mockResolvedValue({ ok: true, success: true });
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SlackCard', () => {
  it('says when this server has no Slack set up', async () => {
    client.readSlack.mockResolvedValue({ ok: true, ...NOT_CONNECTED, configured: false });
    await render();
    expect(badges()).toContain('Not configured');
    expect(text()).toContain('COMPOSIO_SLACK_AUTH_CONFIG_ID');
    expect(button('Connect Slack')).toBeUndefined();
  });

  it('shows where messages go, who connected the workspace and which brands share it', async () => {
    await render();
    expect(client.readSlack).toHaveBeenCalledWith('b1');
    expect(badges()).toEqual(['Connected']);
    expect(text()).toContain(
      'Workspace: Acme Test (acme-test.slack.com) · connected by Sam Lee on Nov 10, 2026 · also used by Contoso',
    );
    expect(picker('channel')!.value).toBe('C00000001');
    // The channels are listed only when the picker opens.
    expect(client.listSlackChannels).not.toHaveBeenCalled();
    expect(
      switches().map((s) => [s.getAttribute('aria-label'), s.getAttribute('aria-checked')]),
    ).toEqual([
      ['Daily Pulse', 'true'],
      ['Drops beyond normal swing', 'true'],
    ]);
    // Only what is posted today: the other kinds' switches come with their sends.
    expect(text()).not.toContain('Daily suggestion');
  });

  it('lists the channels when the picker opens, and saves the one picked', async () => {
    await render();
    await act(async () => {
      picker('channel')!.focus();
    });
    expect(client.listSlackChannels).toHaveBeenCalledWith('b1');
    await choose(picker('channel')!, 'G00000003');
    expect(client.saveSlack).toHaveBeenCalledWith('b1', { channelId: 'G00000003' });
    expect(toast.success).toHaveBeenCalledWith('Messages go to #northwind-seo now.');
  });

  it("asks for a channel as the setup's last step, its list read at once", async () => {
    client.readSlack.mockResolvedValue({ ok: true, ...card({ channel: null }) });
    await render();
    expect(badges()).toEqual(['Pick a channel']);
    expect(text()).toContain(
      'Last step: pick the channel Northwind’s messages go to. Nothing is posted until then.',
    );
    expect(client.listSlackChannels).toHaveBeenCalledWith('b1');
    expect(button('Send a test message')).toBeUndefined();
    expect([...picker('channel')!.options].map((o) => o.textContent)).toEqual([
      '—',
      'northwind-seo',
      'seo-alerts',
    ]);
  });

  it('turns the Pulse in Slack off', async () => {
    await render();
    expect(text()).toContain('As often as the brand’s Pulse goes out: change it in Notifications');
    await act(async () => {
      switches()[0].click();
    });
    expect(client.saveSlack).toHaveBeenCalledWith('b1', { send: { pulse: false } });
    expect(switches()[0].getAttribute('aria-checked')).toBe('false');
  });

  it('turns the drop alerts off on their own', async () => {
    await render();
    await act(async () => {
      switches()[1].click();
    });
    expect(client.saveSlack).toHaveBeenCalledWith('b1', { send: { drops: false } });
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('sends a test message, and says why one failed', async () => {
    await render();
    await act(async () => {
      button('Send a test message')!.click();
    });
    expect(client.sendSlackTest).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith('Test message sent to #seo-alerts.');

    client.sendSlackTest.mockResolvedValue({ ok: false, code: 'not_in_channel' });
    await act(async () => {
      button('Send a test message')!.click();
    });
    expect(toast.error).toHaveBeenCalledWith(
      'The Ansvisor app isn’t in that channel. In Slack, type /invite @Ansvisor there, then try again.',
    );

    // A channel that is gone: the card is read again, and asks for another.
    client.sendSlackTest.mockResolvedValue({ ok: false, code: 'channel_gone' });
    client.readSlack.mockResolvedValue({ ok: true, ...card({ channel: null }) });
    await act(async () => {
      button('Send a test message')!.click();
    });
    expect(client.readSlack).toHaveBeenCalledTimes(2);
    expect(badges()).toEqual(['Pick a channel']);
  });

  it('connects in a popup, and reads the card again once Slack says so', async () => {
    vi.useFakeTimers();
    client.readSlack.mockResolvedValue({ ok: true, ...NOT_CONNECTED });
    client.startSlackConnect.mockResolvedValue({
      ok: true,
      redirectUrl: 'https://slack.test/install',
      accountId: 'acct-new',
    });
    client.activateSlack
      .mockResolvedValueOnce({ ok: true, status: 'pending' })
      .mockResolvedValueOnce({ ok: true, status: 'connected' });
    const popup = { closed: false, close: vi.fn() };
    const open = vi.fn(() => popup);
    vi.stubGlobal('open', open);
    await render();
    expect(text()).toContain('Connect Slack opens Slack to add the Ansvisor app');
    await act(async () => {
      button('Connect Slack')!.click();
    });
    expect(client.startSlackConnect).toHaveBeenCalledWith(
      'b1',
      `${window.location.origin}${window.location.pathname}`,
    );
    expect(open).toHaveBeenCalledWith(
      'https://slack.test/install',
      'slack-install',
      expect.any(String),
    );
    expect(text()).toContain('Waiting for Slack…');
    client.readSlack.mockResolvedValue({ ok: true, ...card({ channel: null }) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(client.activateSlack).toHaveBeenCalledWith('b1', 'acct-new');
    expect(popup.close).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Slack connected. Now pick a channel.');
    expect(badges()).toEqual(['Pick a channel']);
  });

  it('uses the workspace another brand uses, named with its brands', async () => {
    client.readSlack.mockResolvedValue({
      ok: true,
      ...NOT_CONNECTED,
      usable: [{ accountId: 'acct-2', label: 'Contoso HQ', brandIds: ['b2'] }],
    });
    client.chooseSlackWorkspace.mockResolvedValue({ ok: true, ...card({ channel: null }) });
    await render();
    expect([...picker('workspace')!.options].map((o) => o.textContent)).toEqual([
      '—',
      'Contoso HQ · Contoso',
    ]);
    await choose(picker('workspace')!, 'acct-2');
    expect(client.chooseSlackWorkspace).toHaveBeenCalledWith('b1', 'acct-2');
    expect(badges()).toEqual(['Pick a channel']);
  });

  it('asks to reconnect when Slack refuses it, or its connector lost the brand', async () => {
    client.readSlack.mockResolvedValue({ ok: true, ...card({ state: 'refused' }) });
    await render();
    expect(badges()).toEqual(['Reconnect']);
    expect(text()).toContain(
      'Slack no longer accepts this connection: the app may have been removed from Acme Test (acme-test.slack.com).',
    );
    expect(button('Reconnect Slack')).toBeDefined();
    expect(switches()).toEqual([]);

    client.readSlack.mockResolvedValue({ ok: true, ...card({ state: 'access_lost' }) });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(badges()).toEqual(['Paused']);
    expect(text()).toContain('Sam Lee connected Slack and can no longer see Northwind');
  });

  it('shows members where messages go, with nothing to change', async () => {
    role.canManage = false;
    await render();
    expect(text()).toContain(
      'Northwind’s Slack messages go to #seo-alerts. Admins and managers can change this.',
    );
    expect(button('Send a test message')).toBeUndefined();
    expect(button('Disconnect')).toBeUndefined();
    expect(switches()).toEqual([]);

    client.readSlack.mockResolvedValue({ ok: true, ...NOT_CONNECTED });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(text()).toContain('Not connected. Admins and managers can connect Slack.');
    expect(button('Connect Slack')).toBeUndefined();
  });

  it('disconnects after asking', async () => {
    await render();
    await act(async () => {
      button('Disconnect')!.click();
    });
    expect(document.body.textContent).toContain('Disconnect Slack from Northwind?');
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    client.readSlack.mockResolvedValue({ ok: true, ...NOT_CONNECTED });
    await act(async () => {
      confirm[confirm.length - 1].click();
    });
    expect(client.disconnectSlack).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith('Slack disconnected.');
    expect(button('Connect Slack')).toBeDefined();
  });

  it('opens the plan dialog for a read-only workspace or a plan without Slack', async () => {
    client.readSlack.mockResolvedValue({ ok: true, ...NOT_CONNECTED });
    gate.isLocked = true;
    await render();
    await act(async () => {
      button('Connect Slack')!.click();
    });
    expect(openUpgrade).toHaveBeenCalledWith('Connecting an integration needs a plan');
    expect(client.startSlackConnect).not.toHaveBeenCalled();

    gate.isLocked = false;
    client.startSlackConnect.mockResolvedValue({ ok: false, code: 'plan' });
    await act(async () => {
      button('Connect Slack')!.click();
    });
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows the demo brand connected with sample data, its buttons opening the plan dialog', async () => {
    demo.on = true;
    await render();
    expect(client.readSlack).not.toHaveBeenCalled();
    expect(badges()).toEqual(['Connected', 'Sample data']);
    expect(text()).toContain('Northwind’s Slack messages go to #ai-search-alerts.');
    await act(async () => {
      button('Send a test message')!.click();
    });
    expect(openUpgrade).toHaveBeenCalled();
    expect(client.sendSlackTest).not.toHaveBeenCalled();
  });

  it("says when the card couldn't be read, and reads again", async () => {
    client.readSlack.mockResolvedValueOnce({ ok: false, code: 'failed' });
    await render();
    expect(text()).toContain('Couldn’t read the Slack connection right now.');
    await act(async () => {
      button('Try again')!.click();
    });
    expect(client.readSlack).toHaveBeenCalledTimes(2);
    expect(badges()).toEqual(['Connected']);
  });
});
