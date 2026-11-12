import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { MarketplaceDetail } from '@/lib/chat/skills/marketplace-store';

/**
 * A Library skill's detail (CHAT-17 item 9, W4-18): its SKILL.md at the
 * pinned commit as plain text, Ansvisor's scan, "Edited by Ansvisor" in
 * words that never name the competitor, what adding leaves out, the file
 * at its commit, the license and its text, "owner/repo · MIT"; Add opens
 * an Admin's review, a Manager's asks the Admins (W4-19); a blocked skill
 * has no Add; a read GitHub couldn't give says so and reads again.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: nav.push }),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ openUpgrade: vi.fn(), isLocked: false }),
}));

const { LibrarySkill } = await import('./library-skill');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ID = 'zubair-trabzada/geo-seo-claude/geo-brand-mentions';
const COMMIT = '989cae01e8ebbc42a9ec798eb9e7cb423f5ec89c';
const DETAIL: MarketplaceDetail = {
  skill: {
    id: ID,
    name: 'Geo brand mentions',
    description: 'Finds where AI engines mention your brand.',
    repo: 'zubair-trabzada/geo-seo-claude',
    topics: ['seo'],
    stars: 4800,
    installs: 1400,
    license: 'MIT',
    added: null,
  },
  fileUrl: `https://github.com/zubair-trabzada/geo-seo-claude/blob/${COMMIT}/skills/geo-brand-mentions/SKILL.md`,
  commit: COMMIT,
  read: {
    ok: true,
    title: 'geo brand mentions',
    body: '## Platform importance\n\n1. YouTube mentions.',
    compatibility: null,
    license: 'MIT',
    licenseText: 'MIT License\n\nPermission is hereby granted, free of charge…',
    scan: { blocks: [], warns: ['Links to an outside site: https://example.com'] },
    removed: ['scripts/ (1 file)'],
    edits: [{ cleanup: 'research-lines', lines: 1 }],
  },
  can: { add: 'add' },
};

let container: HTMLDivElement;
let root: Root;
let detail: MarketplaceDetail | null;
let answer: (url: string, init?: RequestInit) => Response | null;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const custom = answer(url, init);
  if (custom) return custom;
  if (url.startsWith('/api/chat/skills/marketplace/skill?id=')) {
    return detail
      ? Response.json({ ok: true, detail })
      : Response.json({ ok: false, code: 'not_found' }, { status: 404 });
  }
  return Response.json({ ok: true });
});

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <LibrarySkill id={ID} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const slot = (name: string) => container.querySelector<HTMLElement>(`[data-slot="${name}"]`);
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  detail = structuredClone(DETAIL);
  answer = () => null;
  fetchMock.mockClear();
  nav.push.mockReset();
  for (const fn of [toast, toast.error, toast.success]) fn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('LibrarySkill', () => {
  it('shows the skill at its pinned commit, the scan, the edits, the license and the source', async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/chat/skills/marketplace/skill?id=${encodeURIComponent(ID)}`,
      expect.anything(),
    );
    expect(container.querySelector('h1')!.textContent).toBe('Geo brand mentions');
    expect(slot('library-attribution')!.textContent).toBe('zubair-trabzada/geo-seo-claude · MIT');
    expect(slot('library-stars')!.textContent).toContain('4.8K');
    expect(slot('library-body')!.textContent).toBe(
      '## Platform importance\n\n1. YouTube mentions.',
    );
    expect(slot('library-scan')!.textContent).toContain('Links to an outside site');
    expect(slot('library-edits')!.textContent).toBe(
      "Removed 1 line citing a competitor's research.",
    );
    expect(container.textContent).toContain('Edited by Ansvisor');
    expect(container.textContent).not.toMatch(/profound/i);
    expect(slot('library-removed')!.textContent).toBe('scripts/ (1 file)');
    const link = slot('library-source-link')!;
    expect(link.getAttribute('href')).toBe(DETAIL.fileUrl);
    expect(link.getAttribute('href')).toContain(COMMIT);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(container.textContent).toContain('989cae0');
    expect(slot('library-license')!.textContent).toContain('Permission is hereby granted');
    expect(container.querySelector('[data-action="librarySkill.back"]')!.getAttribute('href')).toBe(
      '/dashboard/chat/skills?tab=library',
    );
  });

  it('adds it, on for the person at once, and says Added (owner, 2026-11-09)', async () => {
    answer = (url, init) =>
      init?.method === 'POST'
        ? Response.json({
            ok: true,
            skill: {
              id: 'skill-9',
              name: 'geo-brand-mentions',
              status: 'approved',
              requested: false,
            },
          })
        : null;
    await render();
    expect(slot('library-note')!.textContent).toBe(
      'Adding it scans it again and turns it on for you. Share it from My skills to give it to your team.',
    );
    await click(container.querySelector<HTMLElement>('[data-action="skills.library.add"]')!);
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/api/chat/skills/marketplace/skill');
    expect(JSON.parse(String(init!.body))).toEqual({ id: ID });
    expect(toast.success).toHaveBeenCalledWith(
      "Added. /geo-brand-mentions is on for you; share it from My skills when it's ready for everyone.",
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Added');
  });

  it('opens the review when an Add still waits for one', async () => {
    answer = (url, init) =>
      init?.method === 'POST'
        ? Response.json({
            ok: true,
            skill: { id: 'skill-9', status: 'pending_review', requested: false },
          })
        : null;
    await render();
    await click(container.querySelector<HTMLElement>('[data-action="skills.library.add"]')!);
    expect(toast.success).toHaveBeenCalledWith('Scanned · instructions only · admin review');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/skills/skill-9');
  });

  it('turns a Manager’s Add into a request, then shows Pending approval', async () => {
    detail!.can.add = 'request';
    answer = (url, init) =>
      init?.method === 'POST'
        ? Response.json({
            ok: true,
            skill: { id: 'skill-9', status: 'pending_review', requested: true },
          })
        : null;
    await render();
    expect(slot('library-note')!.textContent).toBe('Adding it asks your Admins to review it.');
    await click(container.querySelector<HTMLElement>('[data-action="skills.library.add"]')!);
    expect(nav.push).not.toHaveBeenCalled();
    expect(slot('library-state')!.textContent).toBe('Pending approval');
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
  });

  it('has no Add for a skill the scan blocks, one added already, or an Analyst', async () => {
    if (detail!.read.ok) detail!.read.scan.blocks = ['Tells Chat to ignore its rules'];
    await render();
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
    expect(slot('library-note')!.textContent).toBe(
      "The scan blocks this skill, so it can't be added.",
    );
    act(() => root.unmount());
    root = createRoot(container);
    detail = structuredClone(DETAIL);
    detail.skill.added = { status: 'approved', skillId: 'skill-9' };
    await render();
    expect(slot('library-state')!.textContent).toBe('Added');
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    detail = structuredClone(DETAIL);
    detail.can.add = null;
    await render();
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
    expect(slot('library-note')).toBeNull();
  });

  it('says when GitHub couldn’t give the file, and reads it again', async () => {
    detail!.read = { ok: false, code: 'github_busy', error: 'GitHub is busy right now.' };
    await render();
    expect(slot('library-read-failed')!.textContent).toContain('GitHub is busy right now.');
    // The source still shows: its file at the pinned commit.
    expect(slot('library-source-link')!.getAttribute('href')).toBe(DETAIL.fileUrl);
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
    detail = structuredClone(DETAIL);
    await click(container.querySelector<HTMLElement>('[data-action="librarySkill.retry"]')!);
    expect(slot('library-body')).not.toBeNull();
  });

  it('says why a skill Ansvisor can’t take can’t be added, with nothing to retry', async () => {
    detail!.read = {
      ok: false,
      code: 'invalid',
      error: 'This skill isn’t valid: metadata takes its keys on the lines under it.',
    };
    await render();
    expect(slot('library-read-failed')!.textContent).toBe(
      "Ansvisor can't take this skill as it is, so it can't be added. This skill isn’t valid: metadata takes its keys on the lines under it.",
    );
    expect(container.querySelector('[data-action="librarySkill.retry"]')).toBeNull();
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
  });

  it('says a skill the Library hasn’t isn’t there', async () => {
    detail = null;
    await render();
    expect(container.textContent).toContain("This skill isn't in the Library.");
  });
});
