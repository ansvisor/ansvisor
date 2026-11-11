import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * Action Center › Agents' pages: seen when opened, under the Action
 * Center's header and tabs, at Agent Center's addresses.
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
});

async function draw() {
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
  it('puts the Action Center’s header and tabs above the page', async () => {
    await draw();
    expect(container.querySelector('[data-testid="seen"]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Action Center');
    expect(container.textContent).toContain('Agents do recurring work for you.');
    const frame = container.querySelector('[data-frame="action-center"]')!;
    const tabs = frame.querySelector('[data-testid="tabs"]')!;
    const page = frame.querySelector('[data-testid="agents-page"]')!;
    expect(tabs.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
