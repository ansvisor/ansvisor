import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ContentAuthor } from '@/lib/content/authors';
import type { QualityTodo } from '@/lib/content/quality-todos';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string } & Record<string, unknown>) => (
    <a href={href} {...props} />
  ),
}));

const { NextNudge, useNextNudge } = await import('./_next-nudge');
type NudgeMoment = import('./_next-nudge').NudgeMoment;

/**
 * The next-step nudge (Quality spec §4, CE-040): "Next for you: {first open
 * to-do} · 1 of n", at the agent's end, Accept all and Mark ready, once per
 * moment and to-do; Later hides it for the session.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ada: ContentAuthor = {
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: null,
  photoUrl: null,
  sameAs: [],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
};
const pick: QualityTodo = { id: 'byline', done: false, gain: 60, action: 'pickAuthor' };
const profile: QualityTodo = { id: 'authorProfile', done: false, gain: 40, action: 'editAuthor' };

let container: HTMLDivElement;
let root: Root;
const onPickAuthor = vi.fn();
const onShowPlaceholder = vi.fn();
const MOMENTS: NudgeMoment[] = ['agent', 'acceptAll', 'markReady'];

/** The editor's part: the hook, a button per moment, and the nudge while it shows. */
function Harness({ todos, author }: { todos: QualityTodo[]; author: ContentAuthor | null }) {
  const nudge = useNextNudge('d1', todos);
  return (
    <>
      {MOMENTS.map((moment) => (
        <button key={moment} type="button" data-moment={moment} onClick={() => nudge.at(moment)} />
      ))}
      <NextNudge
        shown={nudge.shown}
        quality={{ author, team: 'Acme Team', canEdit: true }}
        onShowPlaceholder={onShowPlaceholder}
        onPickAuthor={onPickAuthor}
        onLater={nudge.later}
        onAct={nudge.close}
      />
    </>
  );
}

async function render(todos: QualityTodo[], author: ContentAuthor | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness todos={todos} author={author} />
      </NextIntlClientProvider>,
    );
  });
}
const nudge = () => container.querySelector('[aria-label="Your next step"]');
const status = () => container.querySelector('[role="status"]')!.textContent;
const nudgeAt = (moment: NudgeMoment) =>
  container.querySelector<HTMLButtonElement>(`[data-moment="${moment}"]`)!.click();
const button = (name: string) =>
  [...container.querySelectorAll<HTMLElement>('button, a')].find((b) => b.textContent === name)!;

beforeEach(() => {
  sessionStorage.clear();
  onPickAuthor.mockReset();
  onShowPlaceholder.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('NextNudge', () => {
  it('names the first open to-do at a moment, and opens the author menu', async () => {
    await render([pick]);
    expect(nudge()).toBeNull();
    // A status kept on the page, so screen readers hear the nudge when it shows.
    expect(status()).toBe('');
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe("Next for you: pick the page's author · 1 of 1Pick nowLater");
    expect(nudge()!.querySelector('b')!.textContent).toBe("pick the page's author");
    expect(status()).toBe("Next for you: pick the page's author · 1 of 1");
    await act(async () => button('Pick now').click());
    expect(onPickAuthor).toHaveBeenCalled();
    expect(nudge()).toBeNull();
    expect(status()).toBe('');
  });

  it('shows the first placeholder the agent left (CE-044)', async () => {
    const fill: QualityTodo = {
      id: 'placeholders',
      done: false,
      gain: 0,
      action: 'showPlaceholder',
      count: 2,
    };
    await render([fill, pick]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toBe('Next for you: fill 2 placeholders · 1 of 2Show nowLater');
    await act(async () => button('Show now').click());
    expect(onShowPlaceholder).toHaveBeenCalled();
    expect(nudge()).toBeNull();
  });

  it('counts the open ones and skips the done', async () => {
    await render([{ ...pick, done: true }, profile], ada);
    await act(async () => nudgeAt('markReady'));
    expect(nudge()!.textContent).toContain(
      "Next for you: complete Ada Lovelace's profile · 1 of 1",
    );
    expect(button('Edit now').getAttribute('href')).toBe('/dashboard/settings/authors');
  });

  it('shows once per moment and to-do, and not with none open', async () => {
    await render([pick]);
    await act(async () => nudgeAt('acceptAll'));
    await act(async () => button('Pick now').click());
    await act(async () => nudgeAt('acceptAll'));
    expect(nudge()).toBeNull();
    // Another moment for the same to-do still shows.
    await act(async () => nudgeAt('markReady'));
    expect(nudge()).not.toBeNull();

    await render([{ ...pick, done: true }]);
    expect(nudge()).toBeNull();
    sessionStorage.clear();
    await act(async () => nudgeAt('agent'));
    expect(nudge()).toBeNull();
  });

  it('hides for the session on Later', async () => {
    await render([pick, profile]);
    await act(async () => nudgeAt('agent'));
    expect(nudge()!.textContent).toContain('1 of 2');
    await act(async () => button('Later').click());
    expect(nudge()).toBeNull();
    await act(async () => nudgeAt('markReady'));
    expect(nudge()).toBeNull();
    expect(JSON.parse(sessionStorage.getItem('aeo:quality-nudge:d1')!)).toMatchObject({
      later: true,
    });
  });

  it('goes once the to-dos are done, and moves on to the next one meanwhile', async () => {
    await render([pick]);
    await act(async () => nudgeAt('agent'));
    // Picked from the header instead: the profile is next.
    await render([{ ...pick, done: true }, profile], ada);
    expect(nudge()!.textContent).toContain("complete Ada Lovelace's profile");
    await render([
      { ...pick, done: true },
      { ...profile, done: true },
    ]);
    expect(nudge()).toBeNull();
    // A to-do open again later waits for its moment.
    await render([pick]);
    expect(nudge()).toBeNull();
  });
});
