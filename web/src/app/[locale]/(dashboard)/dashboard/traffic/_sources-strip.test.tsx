import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { SourceState } from '@/lib/actions/integrations';
import type { TrafficSources } from '@/lib/actions/traffic';

/**
 * AT-001: the data sources strip says what feeds the page, what's missing,
 * and connects a missing Google source without leaving it.
 */

const connect = vi.fn();
vi.mock('@/hooks/use-integration-connect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { SourcesStrip } = await import('./_sources-strip');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const source = (over: Partial<SourceState> = {}): SourceState => ({
  configured: true,
  connected: true,
  mapped: true,
  firstDataAt: hoursAgo(500),
  lastDataAt: hoursAgo(2),
  property: null,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onShowCode = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(sources: TrafficSources | null, { canConnect = true } = {}) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SourcesStrip
          sources={sources}
          domain="acme-coffee.example.com"
          hasTrackingCode
          canConnect={canConnect}
          onShowCode={onShowCode}
          onConnected={() => {}}
        />
      </NextIntlClientProvider>,
    );
  });
}

/** Each card's title, sub-line and button, in order. */
const cards = () =>
  [...container.querySelectorAll('section > div')].map((card) => ({
    title: card.querySelector('p')?.textContent,
    line: card.querySelectorAll('p')[1]?.textContent,
    button: card.querySelector('a, button')?.textContent ?? null,
  }));

describe('SourcesStrip', () => {
  it('shows each connected source with its property and last sync', () => {
    render({
      snippetLastVisitAt: hoursAgo(1),
      ga: source({ property: '123456789' }),
      gsc: source({ property: 'sc-domain:acme-coffee.example.com', lastDataAt: hoursAgo(5) }),
    });
    expect(cards()).toEqual([
      { title: 'Tracking snippet', line: 'Active · last visit 1h ago', button: 'Code' },
      {
        title: 'Google Analytics',
        line: 'acme-coffee.example.com (GA4) · synced 2h ago',
        button: 'Manage',
      },
      {
        title: 'Google Search Console',
        line: 'acme-coffee.example.com (GSC) · synced 5h ago',
        button: 'Manage',
      },
      { title: 'AI bots', line: 'Cloudflare / Vercel · coming soon', button: null },
    ]);
    expect(container.querySelector('a')!.getAttribute('href')).toBe(
      '/dashboard/settings?tab=integrations',
    );
  });

  it('names a URL-prefix Search Console property by its host', () => {
    render({
      snippetLastVisitAt: hoursAgo(1),
      ga: source(),
      gsc: source({ property: 'https://blog.acme-coffee.example.com/' }),
    });
    expect(cards()[2].line).toBe('blog.acme-coffee.example.com (GSC) · synced 2h ago');
  });

  it('says how long the first sync takes, and what a missing source unlocks', () => {
    render({
      snippetLastVisitAt: null,
      ga: source({ lastDataAt: null }),
      gsc: source({ connected: false, mapped: false }),
    });
    expect(cards().slice(0, 3)).toEqual([
      { title: 'Tracking snippet', line: 'Not detected', button: 'Install' },
      { title: 'Google Analytics', line: 'Syncing · first data in ~15 min', button: 'Manage' },
      {
        title: 'Google Search Console',
        line: 'Not connected · see if AI is taking Google clicks',
        button: 'Connect',
      },
    ]);
  });

  it('connects from the strip, and opens the snippet code from its button', () => {
    render({
      snippetLastVisitAt: hoursAgo(1),
      ga: source({ connected: false, mapped: false }),
      gsc: source(),
    });
    const button = (name: string) =>
      [...container.querySelectorAll('button')].find((b) => b.textContent === name)!;
    act(() => button('Connect').click());
    expect(connect).toHaveBeenCalledTimes(1);
    act(() => button('Code').click());
    expect(onShowCode).toHaveBeenCalledTimes(1);
  });

  it("keeps Connect off for members who can't connect", () => {
    render(
      { snippetLastVisitAt: null, ga: source({ connected: false }), gsc: source() },
      { canConnect: false },
    );
    const connectButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Connect',
    )!;
    expect(connectButton.disabled).toBe(true);
    expect(connectButton.parentElement!.getAttribute('title')).toBe(
      'Only admins and managers can connect a source.',
    );
  });

  it('asks for a property, or says the server has no Google keys', () => {
    render({
      snippetLastVisitAt: null,
      ga: source({ mapped: false, lastDataAt: null }),
      gsc: source({ configured: false, connected: false, mapped: false, lastDataAt: null }),
    });
    expect(cards().slice(1, 3)).toEqual([
      {
        title: 'Google Analytics',
        line: 'Connected · choose a property for this brand',
        button: 'Manage',
      },
      { title: 'Google Search Console', line: 'Not set up on this server', button: null },
    ]);
  });
});
