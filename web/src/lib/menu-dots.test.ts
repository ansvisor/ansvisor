// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { simpleDashboardNav } from '@/config/dashboard';
import type { Feature } from '@/config/plans';
import {
  DOT_AREAS,
  areasToRead,
  dotAreaOfHref,
  dotAreaOfPath,
  dotAreasOnMenu,
  groupDot,
  itemDot,
  menuDots,
  openActionCount,
  strongest,
  withOpened,
  type DotArea,
  type DotMenuGates,
  type DotViewer,
  type MenuState,
} from './menu-dots';
import { NAV_AREAS } from './user-brand-state';

/**
 * The simplified menu's dots (SIMPLE_NAV, PR 13): which entry is which
 * area, what lights each from one read and the person's visits, who sees
 * yellow, and what the menu leaves out.
 */

const RUN = '2026-11-11T03:10:00.000Z';
const BEFORE = '2026-11-10T18:00:00.000Z';
const AFTER = '2026-11-11T09:00:00.000Z';

const manager: DotViewer = { canAct: true, demo: false, ended: false };
const analyst: DotViewer = { canAct: false, demo: false, ended: false };
const ALL: ReadonlySet<DotArea> = new Set(DOT_AREAS);

/** A night after which everything is new, for a person who looked at it all yesterday. */
function night(over: Partial<MenuState> = {}): MenuState {
  return {
    nightlyRunAt: RUN,
    newSuggestionAt: RUN,
    newActionAt: RUN,
    newOpportunityAt: RUN,
    traffic: { connectedAt: null },
    openActions: 3,
    navSeen: Object.fromEntries(DOT_AREAS.map((area) => [area, BEFORE])),
    ...over,
  };
}

describe('the areas', () => {
  it('are nav_seen keys, each a page of the simplified menu', () => {
    for (const area of DOT_AREAS) expect(NAV_AREAS).toContain(area);
    // Today keeps its own visit and has no dot.
    expect(DOT_AREAS).not.toContain('today');
    const hrefs = simpleDashboardNav.flatMap((group) =>
      group.items.flatMap((item) => [item.href, ...(item.children ?? []).map((c) => c.href)]),
    );
    for (const area of DOT_AREAS) expect(hrefs).toContain(`/dashboard/${area}`);
  });

  it('name a menu entry by its route, and the page shown by its address', () => {
    expect(dotAreaOfHref('/dashboard/prompts/tracked')).toBe('prompts/tracked');
    expect(dotAreaOfHref('/dashboard/prompts/topics')).toBeNull();
    expect(dotAreaOfPath('/dashboard/mentions')).toBe('mentions');
    // An action's own page is in Actions.
    expect(dotAreaOfPath('/dashboard/action-center/actions/abc')).toBe('action-center/actions');
    // Overview and Opportunities only at their own address.
    expect(dotAreaOfPath('/dashboard/insights')).toBe('insights');
    expect(dotAreaOfPath('/dashboard/insights/abc')).toBeNull();
    expect(dotAreaOfPath('/dashboard/content')).toBe('content');
    expect(dotAreaOfPath('/dashboard/content/library')).toBeNull();
    expect(dotAreaOfPath('/dashboard/action-center/today')).toBeNull();
    expect(dotAreaOfPath('/dashboard/prompts-tracked')).toBeNull();
  });
});

describe('the dots, row by row', () => {
  it('lights Overview, Mentions, Citations and Tracked Prompts green after a nightly run', () => {
    const dots = menuDots(night(), manager, ALL);
    expect(dots.insights).toBe('green');
    expect(dots.mentions).toBe('green');
    expect(dots.citations).toBe('green');
    expect(dots['prompts/tracked']).toBe('green');
  });

  it('clears each when its page was opened after the run, and lights it before any visit', () => {
    const seen = { insights: AFTER, mentions: AFTER };
    const dots = menuDots(night({ navSeen: seen }), manager, ALL);
    expect(dots.insights).toBeUndefined();
    expect(dots.mentions).toBeUndefined();
    // Never opened: new.
    expect(dots.citations).toBe('green');
    expect(menuDots(night({ nightlyRunAt: null }), manager, ALL).insights).toBeUndefined();
  });

  it('lights Prompt Suggestions, Actions and Opportunities yellow for what is new since', () => {
    const dots = menuDots(night(), manager, ALL);
    expect(dots['prompts/suggestions']).toBe('yellow');
    expect(dots['action-center/actions']).toBe('yellow');
    expect(dots.content).toBe('yellow');
    const seen = Object.fromEntries(DOT_AREAS.map((area) => [area, AFTER]));
    const quiet = menuDots(night({ navSeen: seen }), manager, ALL);
    expect(quiet['prompts/suggestions']).toBeUndefined();
    expect(quiet['action-center/actions']).toBeUndefined();
    expect(quiet.content).toBeUndefined();
  });

  it('turns AI Referral Traffic yellow until connected, then green until opened', () => {
    expect(menuDots(night(), manager, ALL).traffic).toBe('yellow');
    // Opening the page doesn't clear yellow: connecting does.
    const opened = night({ navSeen: { traffic: AFTER } });
    expect(menuDots(opened, manager, ALL).traffic).toBe('yellow');
    const connected = night({ traffic: { connectedAt: RUN } });
    expect(menuDots(connected, manager, ALL).traffic).toBe('green');
    expect(
      menuDots({ ...connected, navSeen: { traffic: AFTER } }, manager, ALL).traffic,
    ).toBeUndefined();
    // Not read: no dot either way.
    expect(menuDots(night({ traffic: undefined }), manager, ALL).traffic).toBeUndefined();
  });

  it('turns Tracked Prompts yellow while prompts wait for a spot, over green', () => {
    const dots = menuDots(night({ waitingPrompts: 2 }), manager, ALL);
    expect(dots['prompts/tracked']).toBe('yellow');
    expect(menuDots(night({ waitingPrompts: 0 }), manager, ALL)['prompts/tracked']).toBe('green');
    // Not someone who can act: the green one stays.
    expect(menuDots(night({ waitingPrompts: 2 }), analyst, ALL)['prompts/tracked']).toBe('green');
  });

  it('compares nothing with visits that could not be read', () => {
    const dots = menuDots(night({ navSeen: null, waitingPrompts: 1 }), manager, ALL);
    expect(dots).toEqual({ 'prompts/tracked': 'yellow', traffic: 'yellow' });
    expect(menuDots(null, manager, ALL)).toEqual({});
  });
});

describe('who sees which', () => {
  const greens = {
    insights: 'green',
    mentions: 'green',
    citations: 'green',
    'prompts/tracked': 'green',
  };

  it('gives yellow to admins and managers only', () => {
    expect(menuDots(night(), analyst, ALL)).toEqual(greens);
  });

  it('gives the demo brand green dots only', () => {
    expect(menuDots(night(), { ...manager, demo: true }, ALL)).toEqual(greens);
  });

  it('gives green dots only, and no count, once the plan or trial ended', () => {
    const ended = { ...manager, ended: true };
    expect(menuDots(night({ traffic: { connectedAt: RUN } }), ended, ALL)).toEqual({
      ...greens,
      traffic: 'green',
    });
    expect(openActionCount(night(), ended)).toBeNull();
    expect(openActionCount(night(), manager)).toBe(3);
    expect(openActionCount(night(), { ...manager, demo: true })).toBe(3);
    expect(openActionCount(night({ openActions: 0 }), manager)).toBeNull();
    expect(openActionCount(night({ openActions: null }), manager)).toBeNull();
  });

  it('lights nothing off the menu', () => {
    const onMenu = new Set<DotArea>(['insights', 'traffic']);
    expect(menuDots(night(), manager, onMenu)).toEqual({ insights: 'green', traffic: 'yellow' });
  });
});

describe('pages opened here before the next read', () => {
  it('clear their dots at once; a later visit from the server stands', () => {
    const state = night();
    const opened = withOpened(state, { insights: AFTER, 'action-center/actions': AFTER });
    const dots = menuDots(opened, manager, ALL);
    expect(dots.insights).toBeUndefined();
    expect(dots['action-center/actions']).toBeUndefined();
    expect(dots.mentions).toBe('green');
    const server = night({ navSeen: { insights: AFTER } });
    expect(withOpened(server, { insights: BEFORE })?.navSeen?.insights).toBe(AFTER);
    expect(withOpened(null, { insights: AFTER })).toBeNull();
    expect(withOpened(state, undefined)).toBe(state);
  });
});

describe('where a dot shows', () => {
  const nav = simpleDashboardNav;
  const item = (href: string) =>
    nav.flatMap((group) => group.items).find((entry) => entry.href === href)!;

  it('puts the strongest of a submenu on its item, yellow over green', () => {
    expect(strongest([null, { area: 'insights', colour: 'green' }])).toEqual({
      area: 'insights',
      colour: 'green',
    });
    const dots = menuDots(night({ waitingPrompts: 0 }), manager, ALL);
    expect(itemDot(dots, item('/dashboard/prompts'))).toEqual({
      area: 'prompts/suggestions',
      colour: 'yellow',
    });
    expect(itemDot(dots, item('/dashboard/insights'))?.colour).toBe('green');
    expect(itemDot(dots, item('/dashboard/traffic'))?.colour).toBe('yellow');
    expect(itemDot(dots, item('/dashboard/audit'))).toBeNull();
    expect(itemDot(menuDots(night(), analyst, ALL), item('/dashboard/prompts'))?.colour).toBe(
      'green',
    );
  });

  it('puts the strongest of a group on its title', () => {
    const [, analytics, more] = nav;
    const dots = menuDots(night(), manager, ALL);
    expect(groupDot(dots, analytics)?.colour).toBe('yellow');
    expect(groupDot(dots, more)).toEqual({ area: 'content', colour: 'yellow' });
    expect(groupDot(menuDots(night(), analyst, ALL), more)).toBeNull();
  });
});

describe('the menu’s areas', () => {
  const gates = (over: Partial<DotMenuGates> = {}): DotMenuGates => ({
    brandPrefs: { ecommerce: false },
    hiddenSections: new Set(),
    chatAgentic: true,
    ads: false,
    canUse: () => true,
    isCloud: true,
    ...over,
  });

  it('are every area on a full menu', () => {
    expect([...dotAreasOnMenu(simpleDashboardNav, gates())].sort()).toEqual([...DOT_AREAS].sort());
  });

  it('leave out sections off the person’s menu', () => {
    const areas = dotAreasOnMenu(
      simpleDashboardNav,
      gates({ hiddenSections: new Set(['mentions', 'content', 'traffic']) }),
    );
    expect(areas.has('mentions')).toBe(false);
    expect(areas.has('content')).toBe(false);
    expect(areas.has('traffic')).toBe(false);
    expect(areas.has('insights')).toBe(true);
  });

  it('leave out items the plan locks, on the cloud only', () => {
    const starter = (feature: Feature) =>
      feature !== 'advanced_analytics' && feature !== 'basic_insights';
    const locked = dotAreasOnMenu(simpleDashboardNav, gates({ canUse: starter }));
    expect(locked.has('traffic')).toBe(false);
    expect(locked.has('insights')).toBe(false);
    expect(locked.has('mentions')).toBe(false);
    expect(locked.has('prompts/tracked')).toBe(true);
    const selfHosted = dotAreasOnMenu(
      simpleDashboardNav,
      gates({ canUse: starter, isCloud: false }),
    );
    expect(selfHosted.has('traffic')).toBe(true);
  });

  it('are read only where a dot can show for the person', () => {
    expect(areasToRead(ALL, manager)).toEqual(DOT_AREAS);
    expect(areasToRead(ALL, analyst)).toEqual([
      'insights',
      'mentions',
      'citations',
      'prompts/tracked',
      'traffic',
    ]);
    expect(areasToRead(new Set<DotArea>(['content', 'insights']), manager)).toEqual([
      'insights',
      'content',
    ]);
  });
});
