import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Settings › AI Providers: a row per provider with its saved key, the one
 * Chat uses, and — for admins — adding, replacing, switching and removing.
 */

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

let canAdmin = true;
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: canAdmin ? 'admin' : 'member', canManage: canAdmin, canAdmin }),
}));

const { AiProvidersSection } = await import('./ai-providers-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
let saved: unknown[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  canAdmin = true;
  saved = [
    {
      provider: 'anthropic',
      last4: 'abcd',
      settings: {},
      active: true,
      setAt: '2026-10-19T08:00:00Z',
      setByEmail: 'ada@acme.test',
    },
    {
      provider: 'openai',
      last4: 'wxyz',
      settings: { model: 'gpt-5.4' },
      active: false,
      setAt: '2026-10-18T08:00:00Z',
      setByEmail: null,
    },
  ];
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    !init?.method ? json({ configured: true, providers: saved }) : json({ ok: true }),
  );
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <AiProvidersSection />
      </NextIntlClientProvider>,
    );
  });
}

const row = (provider: string) =>
  container.querySelector(`[data-provider="${provider}"]`) as HTMLElement;
const button = (scope: HTMLElement, label: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLElement;

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('AiProvidersSection', () => {
  it('shows each provider, the one Chat uses, and the model each calls', async () => {
    await render();
    expect(row('anthropic').textContent).toContain('Used by Chat');
    expect(row('anthropic').textContent).toContain('Model claude-sonnet-5');
    expect(row('anthropic').textContent).toContain('by ada@acme.test');
    expect(row('openai').textContent).toContain('Key saved');
    expect(row('openai').textContent).toContain('Model gpt-5.4');
    expect(row('azure').textContent).toContain('OpenAI models deployed in your own Azure');
    expect(button(row('azure'), 'Add key')).toBeTruthy();
    expect(button(row('anthropic'), 'Use for Chat')).toBeUndefined();
    expect(container.textContent).not.toContain('No key yet');
  });

  it('switches Chat to another saved provider', async () => {
    await render();
    await act(async () => button(row('openai'), 'Use for Chat').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai' }),
    });
    expect(toast.success).toHaveBeenCalledWith('Chat now uses OpenAI');
  });

  it("checks Azure's endpoint before saving, then saves the key with its settings", async () => {
    await render();
    act(() => button(row('azure'), 'Add key').click());
    const form = row('azure').querySelector('form') as HTMLFormElement;
    type(
      form.querySelector('#ai-provider-azure-key') as HTMLInputElement,
      'azure-key-0123456789abc',
    );
    type(
      form.querySelector('#ai-provider-azure-endpoint') as HTMLInputElement,
      'https://x.example',
    );
    type(form.querySelector('#ai-provider-azure-deployment') as HTMLInputElement, 'gpt-5-chat');
    await act(async () => button(form, 'Save').click());
    expect(form.textContent).toContain("Enter your resource's endpoint");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    type(
      form.querySelector('#ai-provider-azure-endpoint') as HTMLInputElement,
      'https://acme.openai.azure.com/',
    );
    await act(async () => button(form, 'Save').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'azure',
        apiKey: 'azure-key-0123456789abc',
        settings: { endpoint: 'https://acme.openai.azure.com', deployment: 'gpt-5-chat' },
      }),
    });
    expect(toast.success).toHaveBeenCalledWith('Microsoft Azure OpenAI key saved');
    expect(row('azure').querySelector('form')).toBeNull();
  });

  it('removes a key after asking', async () => {
    await render();
    act(() =>
      (
        row('openai').querySelector('button[aria-label="Remove key: OpenAI"]') as HTMLElement
      ).click(),
    );
    expect(document.body.textContent).toContain('Remove the OpenAI API key?');
    await act(async () => button(document.body, 'Remove').click());
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/ai-providers?provider=openai', {
      method: 'DELETE',
    });
  });

  it('shows members the keys without the buttons that change them', async () => {
    canAdmin = false;
    saved = [];
    await render();
    expect(container.textContent).toContain('No key yet');
    expect(container.textContent).toContain('Admin-only setting');
    expect(button(row('anthropic'), 'Add key')).toBeUndefined();
  });
});
