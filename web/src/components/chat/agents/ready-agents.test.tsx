import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { PresetLock } from '@/lib/chat/agents/catalog';
import { NOW, listResult } from '@/lib/chat/testing/agent-fixtures';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';

// An in-memory localStorage for the brand store, before it loads: the test environment has none.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

/**
 * Agent Center › Ready to use (AGENTS plan §1, §3; CHAT-21 §D item 15),
 * the tab Agent Center opens on: the eight ready-to-use agents first, each
 * with its skills, triggers and mode and Use this agent, which opens New
 * agent filled with it; then the Soon cards, which say what they wait for
 * and open nothing. A mode the plan keeps closed shows its lock; readers
 * see the list's line instead of Use this agent. Filters: one row of
 * headers (Goal ▾, Business type ▾, Role ▾) for the goals, the business
 * types and the work areas the presets have, each opening its options under
 * it, one at a time, and naming its pick. The packs for the
 * brand's site type and the person's work areas come first, marked. The
 * tab is kept in the address.
 */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
vi.mock('@/lib/actions/chat-access-requests', () => ({
  requestAccess: vi.fn(async () => ({ ok: true, id: 'request-1' })),
}));

const { AgentCenter } = await import('./agent-center');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(async () => Response.json({ ok: true, ...listResult([]) }));

async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
async function render(
  role: TeamRole = 'manager',
  locks: Record<string, PresetLock> = {},
  initialTab?: 'ready' | 'yours',
  workAreas: string[] = [],
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role={role}>
          <AgentCenter
            initialTab={initialTab}
            locks={locks}
            workAreas={workAreas}
            now={NOW}
            timeZone="UTC"
          />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
const all = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
const action = (name: string) => all(`[data-action="${name}"]`);
const cards = () => all('[data-slot="preset-card"]');
const card = (id: string) => container.querySelector<HTMLElement>(`[data-preset="${id}"]`)!;
const ids = () => cards().map((c) => c.getAttribute('data-preset'));
/** A filter's header (Goal ▾), in the row above the cards. */
const header = (filter: string) =>
  container.querySelector<HTMLElement>(
    `[data-action="agents.readyFilter"][data-filter="${filter}"]`,
  )!;
const headers = () => all('[data-action="agents.readyFilter"]');
/** The open panels: they open in a layer over the page, out of the list. */
const panels = () => [...document.querySelectorAll<HTMLElement>('[role="menu"]')];
/** The open panel's options. */
const options = () => [
  ...document.querySelectorAll<HTMLElement>('[data-slot="ready-filter-option"]'),
];
const option = (label: string) => options().find((o) => o.textContent === label)!;
async function press(key: string, el: Element = document.activeElement ?? document.body) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
  await settle();
}
/** Opens a filter's header and picks one of its options. */
async function pick(filter: string, label: string) {
  await click(header(filter));
  await click(option(label));
}
/** The brand on screen, as the brand switcher keeps it. */
function onBrand(siteType: string | undefined) {
  const brand = { id: 'brand-1', name: 'Ansvisor', siteType, shoppingModeEnabled: false } as Brand;
  useBrandStore.setState({ brands: [brand], activeBrandId: brand.id, loaded: true });
}
const panel = (tab: string) =>
  container.querySelector<HTMLElement>(`[data-slot="agent-center-${tab}"]`)!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/dashboard/agents');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  useBrandStore.setState({ brands: [], activeBrandId: null, loaded: false });
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Agent Center tabs', () => {
  it('open on Ready to use, keep the tab in the address, and keep Your agents a click away', async () => {
    await render();
    const tabs = action('agents.tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Ready to use', 'Your agents']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(panel('ready').hidden).toBe(false);
    expect(panel('yours').hidden).toBe(true);
    // Your agents is read already: its count shows beside the title from the start.
    expect(container.querySelector('[data-slot="agents-count"]')?.textContent).toBe('4');

    await click(tabs[1]);
    expect(window.location.search).toBe('?tab=yours');
    expect(panel('ready').hidden).toBe(true);
    expect(panel('yours').hidden).toBe(false);
    await click(action('agents.tab')[0]);
    expect(window.location.search).toBe('?tab=ready');
  });

  it('open on Your agents when the address says so', async () => {
    await render('manager', {}, 'yours');
    expect(action('agents.tab')[1].getAttribute('aria-selected')).toBe('true');
    expect(panel('yours').hidden).toBe(false);
  });
});

describe('Ready to use', () => {
  it('shows the eight launch agents first, then the ready packs, then the Soon ones', async () => {
    await render();
    const shown = cards();
    expect(shown.slice(0, 8).map((c) => c.getAttribute('data-preset'))).toEqual([
      'visibility-watch',
      'citation-winback',
      'competitor-watch',
      'content-freshness',
      'ready-to-publish',
      'task-finisher',
      'weekly-report',
      'brand-facts-guardian',
    ]);
    // Fan-out Gap Filler, Prompt Portfolio Manager and Onboarding & Help, the next core
    // agents ready, then the packs.
    expect(shown[8].getAttribute('data-preset')).toBe('fanout-gap-filler');
    expect(shown[9].getAttribute('data-preset')).toBe('prompt-portfolio');
    expect(shown[10].getAttribute('data-preset')).toBe('onboarding-help');
    expect(shown.slice(8, 21).every((c) => c.getAttribute('data-status') === 'ready')).toBe(true);
    expect(shown.slice(21).every((c) => c.getAttribute('data-status') === 'soon')).toBe(true);
    expect(shown).toHaveLength(39);
    // No brand on screen and no work areas: nothing is marked.
    expect(all('[data-slot="preset-fit"]')).toHaveLength(0);
  });

  it('gives a ready card its line, skills, mode and triggers, and Use this agent into New agent', async () => {
    await render();
    const watch = card('citation-winback');
    expect(watch.querySelector('h3')?.textContent).toBe('Citation Win-back');
    expect(watch.textContent).toContain('drafts a refresh and an FAQ block');
    expect(watch.querySelector('[data-slot="agent-formula"]')?.textContent).toBe(
      '/winback/faqAuto, ask before changes',
    );
    expect(watch.querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerNew Recover signal',
    );
    const use = watch.querySelector<HTMLElement>('[data-action="agents.usePreset"]')!;
    expect(use.textContent).toBe('Use this agent');
    expect(use.getAttribute('href')).toBe('/dashboard/agents/new?preset=citation-winback');
    expect(use.getAttribute('aria-label')).toBe('Use this agent: Citation Win-back');

    expect(card('visibility-watch').querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerEvery day 08:00 · AI Visibility ±10% in a day',
    );
    expect(card('ready-to-publish').querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerManual only',
    );
    expect(action('agents.usePreset')).toHaveLength(21);

    // Fan-out Gap Filler: its skills on Mondays, in its mode.
    const added = card('fanout-gap-filler');
    expect(added.querySelector('[data-slot="agent-formula"]')?.textContent).toBe(
      '/fanout/answerfirstAuto, ask before changes',
    );
    expect(added.querySelector('[data-action="agents.usePreset"]')?.getAttribute('href')).toBe(
      '/dashboard/agents/new?preset=fanout-gap-filler',
    );

    // Onboarding & Help: its setup skill, on each brand added, asking before every change.
    const help = card('onboarding-help');
    expect(help.querySelector('[data-slot="agent-formula"]')?.textContent).toBe(
      '/setupAsk me first',
    );
    expect(help.querySelector('[data-cell="trigger"]')?.textContent).toBe(
      'TriggerWhen a brand is added',
    );
    expect(help.querySelector('[data-action="agents.usePreset"]')?.getAttribute('href')).toBe(
      '/dashboard/agents/new?preset=onboarding-help',
    );

    // Prompt Portfolio Manager: its skill on Mondays, in its mode.
    const portfolio = card('prompt-portfolio');
    expect(portfolio.querySelector('[data-slot="agent-formula"]')?.textContent).toBe(
      '/promptsAsk me first',
    );
    expect(portfolio.querySelector('[data-action="agents.usePreset"]')?.getAttribute('href')).toBe(
      '/dashboard/agents/new?preset=prompt-portfolio',
    );
  });

  it('says what a Soon card waits for, and opens nothing from it', async () => {
    await render();
    const localization = card('localization');
    expect(localization.querySelector('[data-slot="preset-soon"]')?.textContent).toBe(
      'SoonNeeds a page-published trigger',
    );
    expect(localization.querySelector('a')).toBeNull();
    expect(localization.querySelector('button')).toBeNull();
    expect(card('aeo-operator').textContent).toContain('Needs sub-agents');
    expect(card('revenue-attribution').textContent).toContain('Needs HubSpot');
    for (const soon of cards().filter((c) => c.getAttribute('data-status') === 'soon')) {
      expect(soon.querySelector('[data-action="agents.usePreset"]')).toBeNull();
    }
  });

  it('shows the plan a mode needs where the workspace’s plan keeps it closed', async () => {
    await render('manager', {
      'weekly-report': { kind: 'plan', plan: 'Growth', current: 'Starter' },
    });
    const report = card('weekly-report');
    expect(report.querySelector('[data-slot="agent-formula"]')?.textContent).toContain('Full auto');
    const lock = report.querySelector<HTMLElement>('[data-slot="preset-lock"]')!;
    expect(lock.textContent).toBe('Needs Growth · you’re on Starter');
    expect(lock.title).toBe('Use this agent opens it on Auto, ask before changes');
    // Still usable: it opens on a mode the plan has.
    expect(report.querySelector('[data-action="agents.usePreset"]')).not.toBeNull();
    expect(all('[data-slot="preset-lock"]')).toHaveLength(1);
  });

  it('says when an Admin turned Full auto off', async () => {
    await render('manager', { 'weekly-report': { kind: 'policy' } });
    expect(card('weekly-report').querySelector('[data-slot="preset-lock"]')?.textContent).toBe(
      'Your Admin turned Full auto off',
    );
  });

  it('gives Analysts and Agency partners the cards with the list’s line, not Use this agent', async () => {
    for (const role of ['analyst', 'agency_partner'] as const) {
      await render(role);
      expect(action('agents.usePreset')).toHaveLength(0);
      expect(action('agents.new')).toHaveLength(0);
      expect(
        card('weekly-report').querySelector('[data-slot="preset-read-only"]')?.textContent,
      ).toBe('Only Admins and Managers create, run and change agents');
      expect(container.querySelector('[data-slot="agents-read-only"]')?.textContent).toContain(
        'Ask your Admin',
      );
      await act(async () => root.unmount());
      root = createRoot(container);
    }
  });

  it('shows the filters as one row of headers, each with its arrow and its panel closed', async () => {
    await render();
    // Industry has no agent yet: no header for it.
    expect(headers().map((h) => h.textContent)).toEqual(['Goal', 'Business type', 'Role']);
    expect(headers().every((h) => h.closest('[data-slot="ready-filters"]'))).toBe(true);
    for (const h of headers()) {
      expect(h.tagName).toBe('BUTTON');
      expect(h.getAttribute('aria-haspopup')).toBe('menu');
      expect(h.getAttribute('aria-expanded')).toBe('false');
      expect(h.querySelector('svg')).not.toBeNull();
    }
    expect(panels()).toHaveLength(0);
  });

  it('filters by goal from its header, with only the goals the agents have, and All resets it', async () => {
    await render();
    await click(header('goal'));
    expect(header('goal').getAttribute('aria-expanded')).toBe('true');
    expect(panels()).toHaveLength(1);
    expect(header('goal').getAttribute('aria-controls')).toBe(panels()[0].id);
    // Its options right under it, All picked.
    expect(options().map((o) => o.textContent)).toEqual([
      'All',
      'Visibility',
      'Citations',
      'Content',
      'Competitors',
      'Technical',
      'Shopping',
      'Tasks',
      'Reporting',
      'Help',
    ]);
    expect(option('All').getAttribute('aria-checked')).toBe('true');

    // Picking one closes the panel, and the header names it.
    await click(option('Reporting'));
    expect(panels()).toHaveLength(0);
    expect(header('goal').getAttribute('aria-expanded')).toBe('false');
    expect(header('goal').textContent).toBe('Goal: Reporting');
    expect(header('goal').getAttribute('data-picked')).toBe('reporting');
    expect(ids()).toEqual([
      'weekly-report',
      'ceo-brief',
      'revenue-attribution',
      'agency-reporter',
      'ai-traffic-signups',
    ]);

    await click(header('goal'));
    expect(option('Reporting').getAttribute('aria-checked')).toBe('true');
    await click(option('All'));
    expect(header('goal').textContent).toBe('Goal');
    expect(header('goal').getAttribute('data-picked')).toBeNull();
    expect(cards()).toHaveLength(39);
  });

  it('opens one panel at a time, and closes it with Escape or a click outside', async () => {
    await render();
    await click(header('goal'));
    // The panel takes the focus.
    expect(panels()[0].contains(document.activeElement)).toBe(true);

    // Another header: its panel opens and the first closes.
    await click(header('businessType'));
    expect(header('goal').getAttribute('aria-expanded')).toBe('false');
    expect(header('businessType').getAttribute('aria-expanded')).toBe('true');
    expect(panels()).toHaveLength(1);
    expect(options().map((o) => o.textContent)).toEqual([
      'All',
      'E-commerce',
      'Mobile app',
      'B2B',
      'B2C',
    ]);

    // Escape closes it and gives the focus back to its header; nothing is filtered.
    await press('Escape');
    expect(panels()).toHaveLength(0);
    expect(header('businessType').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(header('businessType'));
    expect(cards()).toHaveLength(39);

    // A click outside closes it too.
    await click(header('role'));
    expect(panels()).toHaveLength(1);
    await act(async () => {
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        document.body.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
    });
    await settle();
    expect(panels()).toHaveLength(0);
    expect(header('role').getAttribute('aria-expanded')).toBe('false');
    expect(cards()).toHaveLength(39);
  });

  it('works with the keyboard: the arrow keys open a header and move through its options', async () => {
    await render();
    header('goal').focus();
    await press('ArrowDown');
    expect(header('goal').getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(option('All'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(option('Visibility'));
    await press('Enter');
    expect(panels()).toHaveLength(0);
    expect(header('goal').textContent).toBe('Goal: Visibility');
    expect(document.activeElement).toBe(header('goal'));
    expect(ids()[0]).toBe('visibility-watch');
  });

  it('filters by business type and by role beside the goal, each with the values the agents have', async () => {
    await render();
    await click(header('role'));
    expect(options().map((o) => o.textContent)).toEqual([
      'All',
      'Founders & leaders',
      'AEO/GEO & Audit',
      'Content',
      'Brand & PR',
      'Growth',
      'Product Development',
      'Business Development',
      'Developers',
    ]);
    await press('Escape');

    await pick('businessType', 'B2C');
    expect(header('businessType').textContent).toBe('Business type: B2C');
    expect(ids()).toEqual(['social-proof-pages', 'reviews-ugc-watch', 'local-store-locator']);
    expect(card('reviews-ugc-watch').textContent).toContain(
      'Needs review site data and Reddit and YouTube',
    );
    // Two filters at once keep what both match, and the row names both.
    await pick('goal', 'Content');
    expect(ids()).toEqual(['social-proof-pages']);
    expect(headers().map((h) => h.textContent)).toEqual([
      'Goal: Content',
      'Business type: B2C',
      'Role',
    ]);
    await pick('goal', 'All');
    await pick('businessType', 'All');
    expect(headers().map((h) => h.textContent)).toEqual(['Goal', 'Business type', 'Role']);

    await pick('role', 'Content');
    expect(header('role').textContent).toBe('Role: Content');
    expect(ids()).toEqual(['content-freshness', 'content-plan-builder']);
    await pick('role', 'AEO/GEO & Audit');
    expect(ids()).toEqual(['prompt-portfolio', 'technical-fixer']);
  });

  it('puts the agents for the brand’s site type and the person’s work areas first, marked', async () => {
    onBrand('b2b');
    await render('manager', {}, undefined, ['product', 'content']);
    expect(ids().slice(0, 5)).toEqual([
      'content-freshness',
      'alternatives-comparison-pages',
      'integration-questions',
      'unmet-needs-miner',
      'visibility-watch',
    ]);
    const fit = (id: string) => card(id).querySelector('[data-slot="preset-fit"]')?.textContent;
    expect(fit('alternatives-comparison-pages')).toBe('For your site type');
    expect(fit('unmet-needs-miner')).toBe('For your role');
    expect(fit('content-freshness')).toBe('For your role');
    expect(fit('visibility-watch')).toBeUndefined();
    expect(fit('product-answer-pages')).toBeUndefined();
    // The Soon ones still come last, theirs first among them.
    const soon = cards().filter((c) => c.getAttribute('data-status') === 'soon');
    expect(soon.slice(0, 2).map((c) => c.getAttribute('data-preset'))).toEqual([
      'review-site-presence',
      'content-plan-builder',
    ]);
    expect(cards()).toHaveLength(39);
  });

  it('reads a brand without a site type as its guess, and an e-commerce brand gets its pack', async () => {
    onBrand(undefined);
    await render();
    // Unset and nothing else to go by: guessed B2B, as Content's page types are.
    expect(ids().slice(0, 2)).toEqual(['alternatives-comparison-pages', 'integration-questions']);
    await act(async () => root.unmount());
    root = createRoot(container);
    onBrand('ecommerce');
    await render();
    expect(ids()[0]).toBe('product-answer-pages');
    expect(card('product-answer-pages').getAttribute('data-fit')).toBe('siteType');
    // Mobile app isn't a site type a brand has yet: its pack is never marked.
    expect(card('feature-question-coverage').getAttribute('data-fit')).toBeNull();
  });

  it('brings the card a link from Chat names into view, once the brands set the order', async () => {
    const scrolled: string[] = [];
    const scrollIntoView = vi.fn(function (this: HTMLElement) {
      scrolled.push(this.id);
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      // Setup's recommendations link each agent to its card (list_ready_agents' href).
      window.history.replaceState(null, '', '/dashboard/agents?tab=ready#preset-ceo-brief');
      await render();
      expect(card('ceo-brief').id).toBe('preset-ceo-brief');
      // The brands aren't in yet: the site type may still move the card.
      expect(scrollIntoView).not.toHaveBeenCalled();
      await act(async () => onBrand('b2b'));
      await settle();
      expect(scrolled).toEqual(['preset-ceo-brief']);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });

      // No card named: nothing moves.
      await act(async () => root.unmount());
      root = createRoot(container);
      scrolled.length = 0;
      window.history.replaceState(null, '', '/dashboard/agents#top');
      await render();
      expect(scrolled).toEqual([]);
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
