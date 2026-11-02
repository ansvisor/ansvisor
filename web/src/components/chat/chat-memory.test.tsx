import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { MemoryItemView, MemoryList } from '@/lib/chat/memory/store';

/**
 * Memory (CHAT-14 items 21–25; W3-12b): tabs with their counts for Me,
 * the brand in the switcher and Workspace; the rows with their source and
 * date; Edit inline and Delete with Undo where the role changes the scope,
 * and off where it doesn't; the brand's rules read-only; "Use memory"; and
 * the workspace's switch off.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: '22222222-2222-4222-8222-222222222222' }),
}));

const { ChatMemory } = await import('./chat-memory');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const item = (id: string, over: Partial<MemoryItemView> = {}): MemoryItemView => ({
  id,
  scope: 'user',
  text: `Note ${id}`,
  source: 'chat',
  updatedAt: '2026-11-01T10:00:00.000Z',
  can: { edit: true, remove: true },
  ...over,
});

function listOf(over: Partial<MemoryList> = {}): MemoryList {
  return {
    switches: { workspace: true, personal: true },
    canSwitchWorkspace: false,
    brand: { id: '22222222-2222-4222-8222-222222222222', name: 'Northwind' },
    brandRules: ['No topics comparing us with a named competitor'],
    items: {
      user: [item('m1', { text: 'Call me Cihan', source: 'profile' }), item('m2')],
      brand: [item('b1', { scope: 'brand', text: 'Say Northwind CRM' })],
      workspace: [
        item('w1', {
          scope: 'workspace',
          text: 'House style: AP',
          can: { edit: false, remove: false },
        }),
      ],
    },
    used: { user: 20, brand: 17, workspace: 15 },
    rights: { user: 'edit', brand: 'edit', workspace: 'request' },
    limits: { line: 300, scope: 4000 },
    ...over,
  };
}

let container: HTMLDivElement;
let root: Root;
let list: MemoryList;
let answer: (url: string, init?: RequestInit) => Response;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => answer(url, init));

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
const openUpgrade = vi.fn();
async function render({ isLocked = false } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ChatMemory />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const tab = (scope: string) => container.querySelector<HTMLElement>(`[data-scope="${scope}"]`)!;
const rows = () => all('[data-slot="memory-row"]');
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  list = listOf();
  answer = (url) =>
    new Response(
      JSON.stringify(url.startsWith('/api/chat/memory?') ? { ok: true, ...list } : { ok: true }),
    );
  fetchMock.mockClear();
  toast.mockClear();
  toast.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Memory', () => {
  it('shows the tabs with their counts for the brand in the switcher, and the Me rows', async () => {
    await render();
    expect(fetchMock.mock.calls[0][0]).toBe(
      '/api/chat/memory?brand_id=22222222-2222-4222-8222-222222222222',
    );
    expect(container.querySelector('h1')?.textContent).toBe('Memory');
    expect(container.textContent).toContain('What Chat remembers between chats.');
    // Said the same way whether it is on or off (smoke test 2026-11-02).
    expect(container.textContent).toContain(
      "Use memoryWhen off, Chat doesn't use your notes or save new ones.",
    );
    expect(all('[role="tab"]').map((el) => el.textContent)).toEqual([
      'Me2',
      'Brand: Northwind2',
      'Workspace1',
    ]);
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Call me CihanProfile'),
      expect.stringContaining('Note m2Saved from chat'),
    ]);
    expect(container.textContent).toContain('20 of 4,000 characters');
    expect(container.textContent).toContain('Say “remember that…” in any chat to add one.');
  });

  it('shows the brand’s rules read-only beside its notes, with where to edit them', async () => {
    await render();
    await click(tab('brand'));
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Say Northwind CRM'),
    ]);
    const rule = container.querySelector('[data-slot="memory-brand-rule"]')!;
    expect(rule.textContent).toContain('No topics comparing us with a named competitor');
    expect(rule.textContent).toContain('Brand rules');
    expect(rule.querySelector('a')?.getAttribute('href')).toBe('/dashboard/settings/content');
    expect(container.textContent).toContain("don't count toward this tab's limit");
  });

  it('keeps Edit and Delete off on a scope the role only reads, and says who changes it', async () => {
    await render();
    await click(tab('workspace'));
    const [row] = rows();
    for (const name of ['memory.edit', 'memory.delete']) {
      expect((row.querySelector(`[data-action="${name}"]`) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
    expect(container.textContent).toContain('Admins change Workspace memory.');
  });

  it('edits a line inline with its counter, and keeps it', async () => {
    await render();
    await click(rows()[1].querySelector<HTMLElement>('[data-action="memory.edit"]')!);
    const area = container.querySelector('textarea')!;
    expect(container.textContent).toContain('7 of 300 characters');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        area,
        'Write in US English',
      );
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(container.querySelector<HTMLElement>('[data-action="memory.save"]')!);
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(patch[0]).toBe('/api/chat/memory/m2');
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ text: 'Write in US English' });
    expect(toast.success).toHaveBeenCalledWith('Memory saved');
  });

  it('says why an edit isn’t kept, in the server’s words', async () => {
    answer = (url, init) =>
      init?.method === 'PATCH'
        ? new Response(JSON.stringify({ ok: false, error: 'Memory is full.' }), { status: 409 })
        : new Response(JSON.stringify({ ok: true, ...list }));
    await render();
    await click(rows()[1].querySelector<HTMLElement>('[data-action="memory.edit"]')!);
    await click(container.querySelector<HTMLElement>('[data-action="memory.save"]')!);
    expect(toast.error).toHaveBeenCalledWith('Memory is full.');
  });

  it('deletes at once, with Undo for 10 seconds that brings it back', async () => {
    await render();
    await click(rows()[1].querySelector<HTMLElement>('[data-action="memory.delete"]')!);
    expect(
      fetchMock.mock.calls.some(([u, i]) => u === '/api/chat/memory/m2' && i?.method === 'DELETE'),
    ).toBe(true);
    expect(rows()).toHaveLength(1);
    const [words, options] = toast.mock.calls.at(-1)!;
    expect(words).toBe('Removed from memory');
    expect(options).toMatchObject({ duration: 10_000, action: { label: 'Undo' } });
    await act(async () => (options as { action: { onClick: () => void } }).action.onClick());
    await settle();
    expect(
      fetchMock.mock.calls.some(
        ([u, i]) => u === '/api/chat/memory/m2/restore' && i?.method === 'POST',
      ),
    ).toBe(true);
  });

  it('turns the person’s Use memory off, and says what it means', async () => {
    await render();
    await click(container.querySelector<HTMLElement>('[data-action="memory.useMemory"]')!);
    const patch = fetchMock.mock.calls.find(([u]) => u === '/api/chat/memory/settings')!;
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ personal: false });
    expect(container.querySelector('[data-slot="memory-personal-off"]')?.textContent).toBe(
      "Use memory is off, so Chat doesn't use your notes or save new ones.",
    );
  });

  it('lets a read-only workspace’s person delete their own Me line and turn Use memory off (KVKK/GDPR)', async () => {
    list = listOf({
      items: {
        ...listOf().items,
        user: [item('m2', { can: { edit: false, remove: true } })],
        brand: [item('b1', { scope: 'brand', can: { edit: false, remove: false } })],
      },
    });
    openUpgrade.mockClear();
    await render({ isLocked: true });
    const [row] = rows();
    expect((row.querySelector('[data-action="memory.edit"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
    await click(row.querySelector<HTMLElement>('[data-action="memory.delete"]')!);
    expect(
      fetchMock.mock.calls.some(([u, i]) => u === '/api/chat/memory/m2' && i?.method === 'DELETE'),
    ).toBe(true);
    await click(container.querySelector<HTMLElement>('[data-action="memory.useMemory"]')!);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/chat/memory/settings')).toBe(true);
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('hides the notes from all but Admins while the workspace switch is off', async () => {
    list = listOf({ switches: { workspace: false, personal: true } });
    await render();
    expect(container.querySelector('[data-slot="memory-off"]')?.textContent).toBe(
      'Memory is off for this workspace. An Admin can turn it on in Settings › Chat.',
    );
    expect(rows()).toEqual([]);
    expect(container.querySelector('[role="tablist"]')).toBeNull();

    // An Admin opens the page: the notes stay, with the switch's place named.
    list = listOf({ switches: { workspace: false, personal: true }, canSwitchWorkspace: true });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('[data-slot="memory-off"]')?.textContent).toContain(
      'Turn it on in Settings › Chat.',
    );
    expect(rows()).toHaveLength(2);
  });
});
