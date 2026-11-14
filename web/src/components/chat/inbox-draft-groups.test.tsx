import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ApprovalGroup } from '@/lib/chat/pending-approvals';

/**
 * A draft several runs wait on, in the Inbox's Needs you: Approve all when
 * at most one change rewrites the page, with how many changes were made and
 * the ones that weren't; "one by one" with no Approve all when the changes
 * would overwrite each other, each change opening its own chat.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const server = vi.hoisted(() => ({ list: vi.fn(), approve: vi.fn() }));
vi.mock('@/lib/actions/chat-approve-all', () => ({
  listDraftApprovalGroups: server.list,
  approveGroup: server.approve,
}));

const { InboxDraftGroups } = await import('./inbox-draft-groups');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const group = (row: Partial<ApprovalGroup> = {}): ApprovalGroup => ({
  key: 'k1',
  version: 'v1',
  title: 'Pricing FAQ',
  agents: 2,
  together: true,
  items: [
    { agent: 'SEO agent', summary: 'Changed the draft', chatId: 'chat-1' },
    { agent: 'Tone agent', summary: 'Marked ready', chatId: 'chat-2' },
  ],
  ...row,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  server.list.mockReset();
  server.approve.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <InboxDraftGroups brandId="brand-1" />
      </NextIntlClientProvider>,
    );
  });
}

const approveAll = () => host.querySelector<HTMLButtonElement>('[data-action="inbox.approveAll"]');

describe('InboxDraftGroups', () => {
  it('approves all and says how many changes were made, listing one that was not', async () => {
    server.list.mockResolvedValueOnce({ ok: true, groups: [group()] });
    server.list.mockResolvedValue({ ok: true, groups: [] });
    server.approve.mockResolvedValue({
      ok: true,
      made: 1,
      failed: [{ agent: 'Tone agent', summary: 'Marked ready', error: '', approved: true }],
    });
    await render();
    expect(host.textContent).toContain('2 changes from 2 agents');
    await act(async () => approveAll()!.click());
    expect(server.approve).toHaveBeenCalledWith('brand-1', 'k1', 'v1');
    const status = host.querySelector('[role="status"]')!.textContent;
    // The count is what was made: never "2 approved" when one change wasn't.
    expect(status).toContain('1 change made to “Pricing FAQ”.');
    expect(status).toContain('1 change wasn’t made');
    expect(status).toContain(
      'Tone agent · Marked ready: Approved, but not made. Its chat says why.',
    );
    expect(status).not.toContain('2 changes');
  });

  it('asks for changes one by one, with no Approve all, when they would overwrite each other', async () => {
    server.list.mockResolvedValue({ ok: true, groups: [group({ together: false })] });
    await render();
    expect(approveAll()).toBeNull();
    expect(host.querySelector('[data-testid="inbox-one-by-one"]')!.textContent).toBe(
      'Approve these one by one: they change the same page.',
    );
    // Each change opens its own chat, where its own card's Approve is.
    const links = [...host.querySelectorAll('[data-action="inbox.draftGroupItem"]')];
    expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['/dashboard/chat/chat-1', 'SEO agent · Changed the draft'],
      ['/dashboard/chat/chat-2', 'Tone agent · Marked ready'],
    ]);
  });

  it('says so when the server refuses the group as one by one', async () => {
    server.list.mockResolvedValue({ ok: true, groups: [group()] });
    server.approve.mockResolvedValue({ ok: false, reason: 'one_by_one' });
    await render();
    await act(async () => approveAll()!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toBe(
      'Approve these one by one: they change the same page.',
    );
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
