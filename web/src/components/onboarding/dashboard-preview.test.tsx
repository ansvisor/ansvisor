import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The dashboard drawn behind the onboarding wizard: its menu is the one the
 * wizard leads to, Ads only with Ads on.
 */

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));

const { DashboardPreview } = await import('./dashboard-preview');
const { ChatAgenticProvider } = await import('@/components/providers/chat-agentic-provider');
const { AdsProvider } = await import('@/components/providers/ads-provider');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

async function render(chatAgentic: boolean, ads = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ChatAgenticProvider enabled={chatAgentic}>
          <AdsProvider enabled={ads}>
            <DashboardPreview
              brandName="Acme Coffee"
              domain=""
              topics={[]}
              promptCount={0}
              competitors={[]}
            />
          </AdsProvider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const menu = () => [...container.querySelectorAll('aside span.truncate')].map((s) => s.textContent);

describe('DashboardPreview', () => {
  it('shows the menu the wizard leads to: Chat, Action Center, ANALYTICS, MORE', async () => {
    await render(true, true);
    expect(menu()).toEqual([
      'Ansvisor',
      'Acme Coffee',
      'Chat',
      'Action Center',
      'Prompts',
      'Visibility',
      'AI Referral Traffic',
      'Ads',
      'Content',
      'Audit',
      'Reports',
      'Competitors',
    ]);
    const titles = [...container.querySelectorAll('aside p')].map((p) => p.textContent);
    expect(titles).toEqual(['Analytics', 'More']);
    expect(menu()).not.toContain('Agent Center');
  });

  it('has the same items with the new Chat off', async () => {
    await render(false);
    expect(menu()).toContain('Chat');
    expect(menu()).toContain('Action Center');
  });

  it('has Ads after AI Referral Traffic only with Ads on (ADS_ENABLED)', async () => {
    await render(true);
    expect(menu()).not.toContain('Ads');
    await render(true, true);
    const items = menu();
    expect(items.indexOf('Ads')).toBe(items.indexOf('AI Referral Traffic') + 1);
  });

  it('marks the Action Center, where Today is, as the page the wizard leads to', async () => {
    await render(true);
    const marked = [...container.querySelectorAll('aside div.bg-accent')].map(
      (item) => item.textContent,
    );
    expect(marked).toEqual(['Action Center']);
  });
});
