import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { AuthorsRead } from '@/lib/content/authors';

/**
 * Settings › Authors (CE-037): the workspace's real authors; the author
 * themself or an admin edits one; admins and managers pick each brand's
 * default, or the "{Brand} Team" byline.
 */

const actions = vi.hoisted(() => ({
  getContentAuthors: vi.fn(),
  saveContentAuthor: vi.fn(),
  deleteContentAuthor: vi.fn(),
  setDefaultAuthor: vi.fn(),
}));
vi.mock('@/lib/actions/content-authors', () => actions);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { AuthorsSection } = await import('./authors-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ME = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function workspace(role: string): AuthorsRead {
  return {
    authors: [
      {
        id: ADA,
        name: 'Ada Lovelace',
        title: 'Head of Content',
        bio: null,
        photoUrl: null,
        sameAs: ['https://www.linkedin.com/in/ada'],
        userId: ME,
        defaultFor: [ACME],
      },
      {
        id: BOB,
        name: 'Bob Stone',
        title: null,
        bio: null,
        photoUrl: null,
        sameAs: [],
        userId: null,
        defaultFor: [],
      },
    ],
    brands: [{ id: ACME, name: 'Acme' }],
    me: { id: ME, role },
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.getContentAuthors.mockResolvedValue(workspace('analyst'));
  actions.saveContentAuthor.mockResolvedValue({ id: BOB });
  actions.deleteContentAuthor.mockResolvedValue(undefined);
  actions.setDefaultAuthor.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AuthorsSection />
      </NextIntlClientProvider>,
    );
  });
}

const buttons = (name: string) =>
  [...document.body.querySelectorAll('button')].filter((b) => b.textContent === name);
const row = (name: string) =>
  [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!;
const select = () => container.querySelector<HTMLSelectElement>(`#default-${ACME}`)!;

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(input) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AuthorsSection', () => {
  it('lists the authors with their profiles and brand defaults, and the real-people note', async () => {
    await render();
    expect(container.textContent).toContain(
      "Real people only. Content Agent can't add, edit or invent authors.",
    );
    expect(row('Ada Lovelace').textContent).toContain('(you)');
    expect(row('Ada Lovelace').textContent).toContain('1 profile link · Default for Acme');
    expect(row('Bob Stone').textContent).toContain('No profile links');
  });

  it("lets a member edit only their own author, and not the brands' defaults", async () => {
    await render();
    expect(row('Ada Lovelace').querySelectorAll('button')).toHaveLength(2);
    expect(row('Bob Stone').querySelectorAll('button')).toHaveLength(0);
    expect(select().disabled).toBe(true);
    expect(container.textContent).toContain('Admins and managers set the defaults.');
  });

  it("lets an admin pick a brand's default author, or its team byline", async () => {
    actions.getContentAuthors.mockResolvedValue(workspace('admin'));
    await render();
    expect(row('Bob Stone').querySelectorAll('button')).toHaveLength(2);
    expect(select().disabled).toBe(false);
    expect(select().value).toBe(ADA);
    expect([...select().options].map((o) => o.text)).toEqual([
      'Acme Team',
      'Ada Lovelace',
      'Bob Stone',
    ]);

    await act(async () => {
      select().value = BOB;
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(actions.setDefaultAuthor).toHaveBeenCalledWith(ACME, BOB);
    await act(async () => {
      select().value = '';
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(actions.setDefaultAuthor).toHaveBeenLastCalledWith(ACME, null);
  });

  it('adds an author, one profile link per line, and holds a link that is not https', async () => {
    await render();
    await act(async () => buttons('Add author')[0].click());
    const name = document.querySelector<HTMLInputElement>('#author-name')!;
    const links = document.querySelector<HTMLTextAreaElement>('#author-links')!;
    const save = () => buttons('Save author')[0];

    expect(save().disabled).toBe(true);
    await act(async () => type(name, 'Grace Hopper'));
    await act(async () => type(links, 'https://github.com/grace\nhttp://example.com'));
    expect(save().disabled).toBe(true);
    expect(document.body.textContent).toContain("http://example.com isn't an https link.");

    await act(async () => type(links, 'https://github.com/grace\n\n https://x.com/grace '));
    expect(save().disabled).toBe(false);
    await act(async () => save().click());
    expect(actions.saveContentAuthor).toHaveBeenCalledWith({
      name: 'Grace Hopper',
      title: '',
      bio: '',
      photoUrl: '',
      sameAs: ['https://github.com/grace', 'https://x.com/grace'],
      isMe: false,
    });
    expect(actions.getContentAuthors).toHaveBeenCalledTimes(2);
  });

  it('edits an author with its id, and keeps it as the member', async () => {
    await render();
    await act(async () => row('Ada Lovelace').querySelector('button')!.click());
    expect(document.querySelector<HTMLInputElement>('#author-name')!.value).toBe('Ada Lovelace');
    await act(async () => buttons('Save author')[0].click());
    expect(actions.saveContentAuthor).toHaveBeenCalledWith(
      expect.objectContaining({ id: ADA, name: 'Ada Lovelace', isMe: true }),
    );
  });

  it('asks before removing an author', async () => {
    await render();
    await act(async () => row('Ada Lovelace').querySelectorAll('button')[1].click());
    expect(document.body.textContent).toContain('Remove Ada Lovelace?');
    expect(actions.deleteContentAuthor).not.toHaveBeenCalled();

    const confirm = buttons('Delete').find((b) => !container.contains(b))!;
    await act(async () => confirm.click());
    expect(actions.deleteContentAuthor).toHaveBeenCalledWith(ADA);
  });

  it("says so when the authors can't be read", async () => {
    actions.getContentAuthors.mockResolvedValue(null);
    await render();
    expect(container.textContent).toContain("Couldn't load the authors.");
  });
});
