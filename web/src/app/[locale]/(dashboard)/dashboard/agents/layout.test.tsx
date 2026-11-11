import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * Agent Center's pages: seen when opened; with the simplified layout on
 * (SIMPLE_NAV), Action Center › Agents, under the Action Center's header
 * and tabs, at the same addresses.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock('@/components/chat/agents/agents-seen', () => ({
  AgentsSeen: () => <i data-testid="seen" />,
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({
  ActionCenterTabs: () => <nav data-testid="tabs" />,
}));

const { default: AgentCenterLayout } = await import('./layout');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllEnvs();
});

async function draw(simpleNav: boolean) {
  vi.stubEnv('SIMPLE_NAV', simpleNav ? 'true' : undefined);
  const tree = AgentCenterLayout({ children: <p data-testid="agents-page">Agent Center</p> });
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {tree}
      </NextIntlClientProvider>,
    );
  });
}

describe('Agent Center’s layout', () => {
  it('is as it was while SIMPLE_NAV is off: the page alone, seen', async () => {
    await draw(false);
    expect(container.querySelector('[data-testid="seen"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="tabs"]')).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('[data-frame]')).toBeNull();
    expect(container.innerHTML).toBe(
      '<i data-testid="seen"></i><p data-testid="agents-page">Agent Center</p>',
    );
  });

  it('puts the Action Center’s header and tabs above the page with SIMPLE_NAV on', async () => {
    await draw(true);
    expect(container.querySelector('[data-testid="seen"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Action Center');
    expect(container.textContent).toContain('Agents do recurring work for you.');
    const frame = container.querySelector('[data-frame="action-center"]')!;
    const tabs = frame.querySelector('[data-testid="tabs"]')!;
    const page = frame.querySelector('[data-testid="agents-page"]')!;
    expect(tabs.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
