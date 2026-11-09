import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { MarketplaceCard, MarketplacePage } from '@/lib/chat/skills/marketplace-store';

/**
 * The Library tab (CHAT-17 items 1–7, 11–13; W4-18, W4-19): the topic
 * chips with the catalog's counts, "N skills · MIT license", the sort and
 * the search, read from the API; cards with stars, installs (or "—"),
 * "owner · MIT" and Add, no votes; "Show more (N)"; a card opens its
 * detail; Add keeps it for an Admin's review and opens it, a Manager's
 * asks the Admins; the card then says Pending approval or Added.
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
const gate = vi.hoisted(() => ({ openUpgrade: vi.fn() }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ openUpgrade: gate.openUpgrade, isLocked: false }),
}));

const { MarketplaceTab } = await import('./marketplace-tab');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const cardAt = (i: number, over: Partial<MarketplaceCard> = {}): MarketplaceCard => ({
  id: `acme${i}/skills/skill-${i}`,
  name: `Skill ${i}`,
  description: `What skill ${i} does, in a line.`,
  repo: `acme${i}/skills`,
  topics: ['seo'],
  stars: 19_000 - i,
  installs: 6900,
  license: 'MIT',
  added: null,
  ...over,
});

const COUNTS = {
  all: 701,
  seo: 94,
  content: 83,
  brand: 73,
  analytics: 32,
  social: 94,
  cro: 65,
  email: 53,
  'paid-ads': 44,
  growth: 85,
  gtm: 231,
};

/** The API's page for a query: 35 skills in all, 30 a page. */
function pageFor(url: string): MarketplacePage {
  const params = new URL(url, 'https://app.example.com').searchParams;
  const offset = Number(params.get('offset') ?? 0);
  const total = params.get('q') ? 1 : 35;
  const skills = Array.from({ length: Math.min(30, total - offset) }, (_, i) =>
    cardAt(offset + i, offset + i === 1 ? { installs: null } : {}),
  );
  return {
    skills,
    total,
    next: offset + skills.length < total ? offset + skills.length : null,
    counts: COUNTS,
    can: { add: role },
  };
}

let container: HTMLDivElement;
let root: Root;
let role: MarketplacePage['can']['add'];
let answer: (url: string, init?: RequestInit) => Response | null;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const custom = answer(url, init);
  if (custom) return custom;
  if (url.startsWith('/api/chat/skills/marketplace?')) {
    return Response.json({ ok: true, ...pageFor(url) });
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
        <MarketplaceTab />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string, within: ParentNode = container) => [
  ...within.querySelectorAll<HTMLElement>(selector),
];
const card = (id: string) => container.querySelector<HTMLElement>(`[data-skill="${id}"]`)!;
const cards = () => all('[data-slot="library-card"]');
async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}
const reads = () =>
  fetchMock.mock.calls
    .map(([url]) => url)
    .filter((url) => url.startsWith('/api/chat/skills/marketplace?'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  role = 'add';
  answer = () => null;
  fetchMock.mockClear();
  nav.push.mockReset();
  for (const fn of [toast, toast.error, toast.success, gate.openUpgrade]) fn.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/dashboard/chat/skills');
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MarketplaceTab', () => {
  it('shows the chips with the catalog’s counts, the meta row, the sort and 30 cards', async () => {
    await render();
    expect(all('[data-action="skills.library.topic"]').map((chip) => chip.textContent)).toEqual([
      'All 701',
      'SEO 94',
      'Content 83',
      'Brand 73',
      'Analytics 32',
      'Social 94',
      'CRO 65',
      'Email 53',
      'Paid Ads 44',
      'Growth 85',
      'GTM 231',
    ]);
    // The label and its count centred in the 32px pill, the gap between them.
    const seo = container.querySelector<HTMLElement>('[data-topic="seo"]')!;
    expect(seo.className).toEqual(expect.stringContaining('inline-flex h-8 items-center'));
    expect(seo.className).toEqual(expect.stringContaining('justify-center gap-1'));
    expect(seo.querySelector('span')!.className).not.toContain('ml-1');
    expect(container.querySelector('[data-slot="library-meta"]')!.textContent).toBe(
      '35 skills · MIT license',
    );
    const sort = container.querySelector<HTMLSelectElement>('[data-action="skills.library.sort"]')!;
    expect([...sort.options].map((o) => o.textContent)).toEqual(['Most stars', 'Most installs']);
    expect(
      container.querySelector<HTMLInputElement>('[data-action="skills.library.search"]')!
        .placeholder,
    ).toBe('Search skills…');
    expect(cards()).toHaveLength(30);
    expect(reads()).toEqual(['/api/chat/skills/marketplace?sort=stars&offset=0']);
    // No likes or votes anywhere (item 7).
    expect(container.textContent).not.toMatch(/like|vote/i);
  });

  it('shows a card’s stars, installs or a dash, and “owner · MIT”', async () => {
    await render();
    const first = card('acme0/skills/skill-0');
    expect(first.textContent).toContain('Skill 0');
    const stars = first.querySelector<HTMLElement>('[data-slot="library-stars"]')!;
    expect(stars.title).toBe('GitHub stars of acme0/skills');
    expect(stars.textContent).toContain('19K');
    const installs = first.querySelector<HTMLElement>('[data-slot="library-installs"]')!;
    expect(installs.title).toBe('Installs on skills.sh');
    expect(installs.textContent).toContain('6.9K');
    expect(
      card('acme1/skills/skill-1').querySelector('[data-slot="library-installs"]')!.textContent,
    ).toContain('—');
    expect(first.textContent).toContain('acme0 · MIT');
    expect(first.querySelector('[title="acme0/skills"]')).not.toBeNull();
  });

  it('pages on with Show more, and reads again for a topic, a sort and a search', async () => {
    await render();
    const more = container.querySelector<HTMLElement>('[data-action="skills.library.showMore"]')!;
    expect(more.textContent).toBe('Show more (5)');
    await click(more);
    expect(cards()).toHaveLength(35);
    expect(container.querySelector('[data-action="skills.library.showMore"]')).toBeNull();
    await click(container.querySelector<HTMLElement>('[data-topic="seo"]')!);
    expect(reads().at(-1)).toBe('/api/chat/skills/marketplace?sort=stars&offset=0&topic=seo');
    expect(window.location.search).toBe('?tab=library&topic=seo');
    const sort = container.querySelector<HTMLSelectElement>('[data-action="skills.library.sort"]')!;
    await act(async () => {
      sort.value = 'installs';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(reads().at(-1)).toBe('/api/chat/skills/marketplace?sort=installs&offset=0&topic=seo');
    const search = container.querySelector<HTMLInputElement>(
      '[data-action="skills.library.search"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'schema');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // A moment after typing stops.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    await settle();
    expect(reads().at(-1)).toBe(
      '/api/chat/skills/marketplace?sort=installs&offset=0&topic=seo&q=schema',
    );
    expect(container.querySelector('[data-slot="library-meta"]')!.textContent).toBe(
      '1 skill · MIT license',
    );
  });

  it('starts from the topic, the sort and the search the address holds', async () => {
    window.history.replaceState(null, '', '/dashboard/chat/skills?tab=library&topic=gtm&q=launch');
    await render();
    expect(reads().at(-1)).toBe(
      '/api/chat/skills/marketplace?sort=stars&offset=0&topic=gtm&q=launch',
    );
    expect(container.querySelector('[data-topic="gtm"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('opens a card’s detail, but not from its Add', async () => {
    answer = (url, init) =>
      init?.method === 'POST'
        ? Response.json(
            { ok: false, code: 'github_busy', error: 'GitHub is busy.' },
            { status: 429 },
          )
        : null;
    await render();
    const first = card('acme0/skills/skill-0');
    await click(first.querySelector<HTMLElement>('p')!);
    expect(nav.push).toHaveBeenCalledWith(
      `/dashboard/chat/skills/library?skill=${encodeURIComponent('acme0/skills/skill-0')}`,
    );
    expect(first.querySelector('[data-action="skills.library.open"]')!.getAttribute('href')).toBe(
      `/dashboard/chat/skills/library?skill=${encodeURIComponent('acme0/skills/skill-0')}`,
    );
    nav.push.mockReset();
    await click(first.querySelector<HTMLElement>('[data-action="skills.library.add"]')!);
    expect(nav.push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('GitHub is busy.');
  });

  it('turns an Add on for the person at once: Added, no review (owner, 2026-11-09)', async () => {
    answer = (url, init) =>
      url === '/api/chat/skills/marketplace/skill' && init?.method === 'POST'
        ? Response.json({
            ok: true,
            skill: { id: 'skill-9', name: 'skill-0', status: 'approved', requested: false },
          })
        : null;
    await render();
    await click(
      card('acme0/skills/skill-0').querySelector<HTMLElement>(
        '[data-action="skills.library.add"]',
      )!,
    );
    expect(toast.success).toHaveBeenCalledWith(
      "Added. /skill-0 is on for you; share it from My skills when it's ready for everyone.",
    );
    expect(nav.push).not.toHaveBeenCalled();
    const badge = card('acme0/skills/skill-0').querySelector<HTMLElement>(
      '[data-slot="library-state"]',
    )!;
    expect(badge.textContent).toBe('Added');
  });

  it('keeps an Admin’s Add for review and opens it', async () => {
    answer = (url, init) =>
      url === '/api/chat/skills/marketplace/skill' && init?.method === 'POST'
        ? Response.json({
            ok: true,
            skill: { id: 'skill-9', status: 'pending_review', requested: false },
          })
        : null;
    await render();
    await click(
      card('acme0/skills/skill-0').querySelector<HTMLElement>(
        '[data-action="skills.library.add"]',
      )!,
    );
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(String(init!.body))).toEqual({ id: 'acme0/skills/skill-0' });
    expect(toast.success).toHaveBeenCalledWith('Scanned · instructions only · admin review');
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/skills/skill-9');
    const badge = card('acme0/skills/skill-0').querySelector<HTMLElement>(
      '[data-slot="library-state"]',
    )!;
    expect(badge.textContent).toBe('Pending approval');
  });

  it('turns a Manager’s Add into a request, and shows what became of each', async () => {
    role = 'request';
    answer = (url, init) => {
      if (init?.method === 'POST') {
        return Response.json({
          ok: true,
          skill: { id: 'skill-9', status: 'pending_review', requested: true },
        });
      }
      if (url.startsWith('/api/chat/skills/marketplace?')) {
        const page = pageFor(url);
        page.skills[2].added = { status: 'approved', skillId: null };
        return Response.json({ ok: true, ...page });
      }
      return null;
    };
    await render();
    expect(card('acme2/skills/skill-2').textContent).toContain('Added');
    expect(
      card('acme2/skills/skill-2').querySelector('[data-action="skills.library.add"]'),
    ).toBeNull();
    await click(
      card('acme0/skills/skill-0').querySelector<HTMLElement>(
        '[data-action="skills.library.add"]',
      )!,
    );
    expect(toast.success).toHaveBeenCalledWith(
      'Scanned · instructions only · sent to your Admins for review',
    );
    expect(nav.push).not.toHaveBeenCalled();
    const pending = card('acme0/skills/skill-0').querySelector<HTMLElement>(
      '[data-action="skills.library.review"]',
    )!;
    expect(pending.getAttribute('href')).toBe('/dashboard/chat/skills/skill-9');
    expect(pending.textContent).toBe('Pending approval');
  });

  it('has no Add for an Analyst, and opens the plans for the trial', async () => {
    role = null;
    await render();
    expect(container.querySelector('[data-action="skills.library.add"]')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    role = 'add';
    answer = (url, init) =>
      init?.method === 'POST'
        ? Response.json({ ok: false, code: 'library_plan', error: 'Starter.' }, { status: 403 })
        : null;
    await render();
    await click(container.querySelector<HTMLElement>('[data-action="skills.library.add"]')!);
    expect(gate.openUpgrade).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says when the Library can’t be read, and reads it again', async () => {
    answer = (url) =>
      url.startsWith('/api/chat/skills/marketplace?') ? new Response('', { status: 500 }) : null;
    await render();
    expect(container.textContent).toContain("The Library couldn't be loaded.");
    answer = () => null;
    await click(container.querySelector<HTMLElement>('[data-action="skills.library.retry"]')!);
    expect(cards()).toHaveLength(30);
  });
});
