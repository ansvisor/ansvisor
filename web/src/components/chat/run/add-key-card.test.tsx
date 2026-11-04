import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';

/**
 * Add API key (W4-06): a form straight to Settings › AI Providers' route,
 * never through Chat; Admins where own keys are open, a line for everyone
 * else; Anthropic's key for Chat only.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AddKeyCard } = await import('./add-key-card');
const { YourKeysDialog } = await import('../composer/your-keys-dialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const onClose = vi.fn();
const onSaved = vi.fn();
const KEY = `sk-proj-${'Xy9_'.repeat(12)}`;

/** GET answers the access; PUT and PATCH answer `write`. */
function server(
  access: unknown,
  write: unknown = { ok: true, check: 'working' },
  providers: unknown[] = [],
) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/test')) {
      return new Response(JSON.stringify({ ok: true, outcome: 'working' }));
    }
    if (!init?.method) return new Response(JSON.stringify({ access, providers }));
    return new Response(JSON.stringify(write), {
      status: (write as { ok?: boolean }).ok ? 200 : 400,
    });
  });
}

async function render(node: ReactNode, role: TeamRole = 'admin') {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>{node}</RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const action = (name: string) => document.querySelector<HTMLElement>(`[data-action="${name}"]`);
const text = () => document.body.textContent ?? '';

async function typeKey(value: string) {
  const input = action('addKey.key') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  onClose.mockReset();
  onSaved.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AddKeyCard', () => {
  it('saves the key straight to AI Providers, masked, with what it is for, and clears it', async () => {
    server({ state: 'plan' });
    await render(
      <AddKeyCard initial={{ provider: 'openai', key: KEY }} onClose={onClose} onSaved={onSaved} />,
    );
    const input = action('addKey.key') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.value).toBe(KEY);
    await act(async () => (action('addKey.useImages') as HTMLInputElement).click());
    await act(async () => (action('addKey.save') as HTMLButtonElement).click());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(put[0]).toBe('/api/settings/ai-providers');
    expect(JSON.parse(put[1].body)).toEqual({
      provider: 'openai',
      apiKey: KEY,
      settings: { useFor: ['chat', 'images'] },
    });
    expect(text()).toContain('OpenAI key saved and working.');
    expect(onSaved).toHaveBeenCalledWith('openai');
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it('keeps an Anthropic key for Chat: Images is off, with why', async () => {
    server({ state: 'plan' });
    await render(<AddKeyCard initial={{ provider: 'anthropic' }} onClose={onClose} />);
    expect((action('addKey.useImages') as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain('Anthropic has no image models');
  });

  it('names the OpenRouter model, and says why a key was turned down', async () => {
    server({ state: 'plan' }, { error: 'The provider turned down this key' });
    await render(<AddKeyCard onClose={onClose} />);
    await act(async () =>
      (document.querySelector('[data-provider="openrouter"]') as HTMLElement).click(),
    );
    await typeKey(`sk-or-v1-${'0f'.repeat(32)}`);
    await act(async () => (action('addKey.save') as HTMLButtonElement).click());
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).settings).toEqual({
      useFor: ['chat'],
      model: 'anthropic/claude-sonnet-5.5',
    });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'The provider turned down this key',
    );
  });

  it('says own keys come with Enterprise, and that only Admins add them', async () => {
    server({ state: 'locked' });
    await render(<AddKeyCard onClose={onClose} />);
    expect(text()).toContain('Own API keys come with Enterprise.');
    expect(action('addKey.key')).toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    server({ state: 'plan' });
    await render(<AddKeyCard onClose={onClose} />, 'manager');
    expect(text()).toContain('Ask your Admin');
    expect(action('addKey.save')).toBeNull();
  });
});

describe('YourKeysDialog', () => {
  const ROWS = [
    {
      provider: 'openai',
      last4: 'abcd',
      settings: {},
      active: true,
      health: { failingSince: null },
    },
    {
      provider: 'anthropic',
      last4: 'wxyz',
      settings: { useFor: ['chat'] },
      active: false,
      health: { failingSince: null },
    },
  ];

  it('lists the keys with their uses, sets a use, tests one, and adds one', async () => {
    server({ state: 'plan' }, { ok: true, useFor: ['chat', 'images'] }, ROWS);
    await render(<YourKeysDialog open onClose={onClose} />);
    const openai = document.querySelector('[data-provider="openai"]')!;
    expect(openai.textContent).toContain('••••abcd');
    expect(openai.textContent).toContain('Auto');
    const images = openai.querySelector<HTMLButtonElement>('[data-action="yourKeys.use.images"]')!;
    expect(images.getAttribute('aria-pressed')).toBe('false');
    await act(async () => images.click());
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1].body)).toEqual({ provider: 'openai', useFor: ['chat', 'images'] });

    const anthropic = document.querySelector('[data-provider="anthropic"]')!;
    expect(
      anthropic.querySelector<HTMLButtonElement>('[data-action="yourKeys.use.images"]')!.disabled,
    ).toBe(true);

    await act(async () =>
      openai.querySelector<HTMLButtonElement>('[data-action="yourKeys.test"]')!.click(),
    );
    expect(openai.textContent).toContain('Working.');

    await act(async () => action('yourKeys.add')!.click());
    expect(document.querySelector('[data-slot="add-key-card"]')).not.toBeNull();
  });
});
