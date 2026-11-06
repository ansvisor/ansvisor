import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { FirstRun } from '@/hooks/use-first-run';
import type { ChatStartAudience } from '@/lib/chat/start-audience';

/**
 * Chat Home's welcome card (owner decision 2026-11-06, 00486): in the free
 * trial "Preparing your data" while the first run goes on, then the Google
 * sources still to connect, then the tour's topics, Show me everything and
 * Not now; the demo gets the tour alone. Not now hides it for good.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);
const prefs = vi.hoisted(() => ({ dismissChatWelcome: vi.fn() }));
vi.mock('@/lib/actions/chat-prefs', () => prefs);
const sources = vi.hoisted(() => ({ getSuggestionSourceStates: vi.fn() }));
vi.mock('@/lib/actions/integrations', () => sources);
const firstRun = vi.hoisted(() => ({
  run: null as FirstRun | null,
  enabled: [] as boolean[],
}));
vi.mock('@/hooks/use-first-run', () => ({
  useFirstRun: ({ enabled }: { enabled: boolean }) => {
    firstRun.enabled.push(enabled);
    return enabled ? firstRun.run : null;
  },
}));
const demo = vi.hoisted(() => ({ isDemo: false }));
vi.mock('@/components/providers/demo-brand-provider', () => ({
  useDemoBrand: () => ({ isDemo: demo.isDemo }),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: 'brand-1' }),
}));

const { WelcomeCard, useChatWelcome } = await import('./welcome-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.clearAllMocks();
  firstRun.run = null;
  firstRun.enabled = [];
  demo.isDemo = false;
  prefs.dismissChatWelcome.mockResolvedValue({ ok: true });
  sources.getSuggestionSourceStates.mockResolvedValue({
    gsc: { configured: true, connected: false },
    ga: { configured: true, connected: true },
    dataForSeo: { configured: false },
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode, role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>{node}</RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

const text = () => host.textContent ?? '';
const q = (selector: string) => host.querySelector<HTMLElement>(selector);
const RUN: FirstRun = {
  brandId: 'brand-1',
  queued: false,
  progress: { current: 12, total: 48 },
  left: { minutes: 15 },
};

const card = (props: Partial<Parameters<typeof WelcomeCard>[0]> = {}) => (
  <WelcomeCard
    trial
    run={RUN}
    connect={{ gsc: true, ga: true }}
    onTopic={() => undefined}
    onEverything={() => undefined}
    onDismiss={() => undefined}
    {...props}
  />
);

describe('WelcomeCard', () => {
  it('shows the first run, the connections and the tour in the trial', async () => {
    await render(card());
    expect(q('[data-slot="welcome-preparing"]')?.textContent).toContain('Preparing your data');
    expect(text()).toContain('first results in about 15 min');
    expect(q('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(text()).toContain(
      'While it runs, connect Google Search Console and Google Analytics. Ansvisor then works from your own data too: your real clicks and AI visits.',
    );
    expect(q('[data-action="welcome.connectGsc"]')?.getAttribute('href')).toBe(
      '/dashboard/settings/integrations#google-search-console',
    );
    expect(q('[data-action="welcome.connectGa"]')?.getAttribute('href')).toBe(
      '/dashboard/settings/integrations#google-analytics',
    );
    expect(text()).toContain('Want a quick tour?');
    expect(
      [...host.querySelectorAll('[data-action="welcome.tourTopic"]')].map((b) => b.textContent),
    ).toEqual([
      'Visibility',
      'Topics and prompts',
      'Positions and locations',
      'Content',
      'Connections',
    ]);
    expect(q('[data-action="welcome.tourAll"]')?.textContent).toBe('Show me everything');
    expect(q('[data-action="welcome.notNow"]')?.textContent).toBe('Not now');
  });

  it('drops the progress once the first results are in, and a source once it is connected', async () => {
    await render(card({ run: null, connect: { gsc: false, ga: true } }));
    expect(q('[data-slot="welcome-preparing"]')).toBeNull();
    expect(text()).toContain('Connect Google Analytics. Ansvisor then works');
    expect(q('[data-action="welcome.connectGsc"]')).toBeNull();
    expect(q('[data-action="welcome.connectGa"]')).not.toBeNull();

    await render(card({ run: null, connect: { gsc: false, ga: false } }));
    expect(q('[data-slot="welcome-connect"]')).toBeNull();
    expect(q('hr')).toBeNull();
  });

  it('says the checks done, or the wait for a slot, before the time left is known', async () => {
    await render(card({ run: { ...RUN, left: null } }));
    expect(text()).toContain('12 of 48 checks');
    await render(card({ run: { ...RUN, left: null, progress: null, queued: true } }));
    expect(text()).toContain('starts as soon as a slot opens');
    expect(q('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('shows the demo the tour alone', async () => {
    await render(card({ trial: false }));
    expect(q('[data-slot="welcome-preparing"]')).toBeNull();
    expect(q('[data-slot="welcome-connect"]')).toBeNull();
    expect(q('hr')).toBeNull();
    expect(q('[data-slot="welcome-tour"]')).not.toBeNull();
  });

  it('hands over a topic, Show me everything and Not now', async () => {
    const onTopic = vi.fn();
    const onEverything = vi.fn();
    const onDismiss = vi.fn();
    await render(card({ onTopic, onEverything, onDismiss }));
    act(() => q('[data-topic="positions"]')!.click());
    act(() => q('[data-action="welcome.tourAll"]')!.click());
    act(() => q('[data-action="welcome.notNow"]')!.click());
    expect(onTopic).toHaveBeenCalledWith('positions');
    expect(onEverything).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

/** The hook as Chat Home uses it, on a card of its own. */
function Harness({ audience }: { audience: ChatStartAudience | null }) {
  const welcome = useChatWelcome(audience);
  if (!welcome.shown) return <p data-slot="no-card" />;
  return (
    <WelcomeCard
      trial={welcome.trial}
      run={welcome.run}
      connect={welcome.connect}
      onTopic={() => undefined}
      onEverything={() => undefined}
      onDismiss={welcome.dismiss}
    />
  );
}

describe('useChatWelcome', () => {
  it('reads the first run and the sources to connect in the trial', async () => {
    firstRun.run = RUN;
    await render(<Harness audience="trial" />);
    expect(sources.getSuggestionSourceStates).toHaveBeenCalledWith('brand-1');
    expect(q('[data-slot="welcome-preparing"]')).not.toBeNull();
    expect(q('[data-action="welcome.connectGsc"]')).not.toBeNull();
    // Analytics is connected already: its button is gone.
    expect(q('[data-action="welcome.connectGa"]')).toBeNull();
    expect(analytics.track).toHaveBeenCalledWith('chat_welcome_shown', { audience: 'trial' });
  });

  it('offers no connection to someone who cannot connect', async () => {
    await render(<Harness audience="trial" />, 'analyst');
    expect(sources.getSuggestionSourceStates).not.toHaveBeenCalled();
    expect(q('[data-slot="welcome-connect"]')).toBeNull();
  });

  it('reads nothing for the demo, or with the demo brand on screen', async () => {
    firstRun.run = RUN;
    await render(<Harness audience="demo" />);
    expect(firstRun.enabled.every((on) => !on)).toBe(true);
    expect(sources.getSuggestionSourceStates).not.toHaveBeenCalled();
    expect(q('[data-slot="welcome-tour"]')).not.toBeNull();

    demo.isDemo = true;
    await render(<Harness audience="trial" />);
    expect(q('[data-slot="welcome-preparing"]')).toBeNull();
    expect(sources.getSuggestionSourceStates).not.toHaveBeenCalled();
  });

  it('shows nothing to someone it does not greet', async () => {
    await render(<Harness audience={null} />);
    expect(q('[data-slot="no-card"]')).not.toBeNull();
  });

  it('hides at once on Not now and keeps it; a failure brings it back and says so', async () => {
    await render(<Harness audience="demo" />);
    await act(async () => q('[data-action="welcome.notNow"]')!.click());
    expect(prefs.dismissChatWelcome).toHaveBeenCalledTimes(1);
    expect(q('[data-slot="no-card"]')).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    prefs.dismissChatWelcome.mockResolvedValue({ ok: false });
    await render(<Harness audience="demo" />);
    await act(async () => q('[data-action="welcome.notNow"]')!.click());
    expect(q('[data-slot="chat-welcome"]')).not.toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Couldn’t hide the card. Try again.');
  });
});
