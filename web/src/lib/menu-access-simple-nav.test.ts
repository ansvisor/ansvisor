import { describe, expect, it } from 'vitest';
import { simpleDashboardNav } from '@/config/dashboard';
import { visibleNavChildren } from '@/lib/dashboard-navigation';
import {
  ALWAYS_ON_SECTION,
  CHAT_AGENTIC_SECTIONS,
  MENU_SECTIONS,
  SIMPLE_MENU_SECTIONS,
  WORK_AREAS,
  hiddenMenuSections,
  menuOfProfile,
  menuSectionEntries,
  menuSectionsFor,
} from './menu-access';

/**
 * Menu access with the simplified menu (SIMPLE_NAV): the same sections by
 * the same names, so menus saved for roles, people and work areas keep
 * working with no data change; Agent Center's section, `agents`, is Action
 * Center › Agents there, and the Action Center (Today, Actions, Signals,
 * History) stays on every menu.
 */

const actionCenter = simpleDashboardNav[0].items[1];
const tabsShown = (hidden: Iterable<string>) =>
  visibleNavChildren(actionCenter, new Set(hidden), {
    brandPrefs: { ecommerce: false },
    canUse: () => true,
    chatAgentic: true,
  }).map((tab) => tab.title);

describe('the simplified menu’s sections', () => {
  it('are the menu’s sections, none added or renamed, in its order', () => {
    expect([...SIMPLE_MENU_SECTIONS].sort()).toEqual([...MENU_SECTIONS].sort());
    expect(SIMPLE_MENU_SECTIONS).toEqual([
      'agent',
      'action-center',
      'agents',
      'prompts',
      'insights',
      'mentions',
      'citations',
      'shopping',
      'traffic',
      'ads',
      'content',
      'audit',
      'reports',
      'competitors',
    ]);
  });

  it('name Agents’ section agents, under the Action Center', () => {
    const entries = menuSectionEntries(simpleDashboardNav.flatMap((group) => group.items));
    expect(entries.find((entry) => entry.section === 'agents')?.title).toBe(
      'Agents · in Action Center',
    );
    expect(entries.map((entry) => entry.section).indexOf('agents')).toBe(
      entries.map((entry) => entry.section).indexOf('action-center') + 1,
    );
  });

  it('have Agents only with the new Chat on, from either menu', () => {
    expect(CHAT_AGENTIC_SECTIONS).toEqual(['agents']);
    expect(menuSectionsFor(false, false, true)).not.toContain('agents');
    expect(menuSectionsFor(true, false, true)).toContain('agents');
    expect(menuSectionsFor(true, false, true).indexOf('agents')).toBe(2);
    // Ads only with Ads on, last of Analytics.
    expect(menuSectionsFor(true, false, true)).not.toContain('ads');
    expect(menuSectionsFor(true, true, true).indexOf('ads')).toBe(
      menuSectionsFor(true, true, true).indexOf('traffic') + 1,
    );
    // The same set either way; only the order is the menu's.
    expect([...menuSectionsFor(true, true, true)].sort()).toEqual(
      [...menuSectionsFor(true, true)].sort(),
    );
    expect(menuSectionsFor(true, true)).toEqual(MENU_SECTIONS);
  });
});

describe('menus saved before', () => {
  it('hide Agents in the Action Center where a role hid Agent Center', () => {
    const hidden = hiddenMenuSections(
      { role: 'analyst', roleHidden: ['agents'], shown: [], hidden: [], workAreas: [] },
      menuSectionsFor(true, false, true),
    );
    expect([...hidden]).toEqual(['agents']);
    expect(tabsShown(hidden)).toEqual(['Today', 'Actions', 'Signals', 'History']);
  });

  it('hide it for a person who hid it, and show it for one shown it over their role', () => {
    const profile = {
      role: 'analyst' as const,
      work_areas: null,
      work_areas_asked_at: '2026-11-01T00:00:00Z',
      menu_shown: [],
      menu_hidden: ['agents'],
      can_manage_menus: false,
    };
    const sections = menuSectionsFor(true, false, true);
    expect(menuOfProfile(profile, [], sections).hidden).toEqual(['agents']);
    expect(
      menuOfProfile({ ...profile, menu_hidden: [], menu_shown: ['agents'] }, ['agents'], sections)
        .hidden,
    ).toEqual([]);
  });

  it('never take the Action Center, its tabs with it, off a menu', () => {
    const hidden = hiddenMenuSections(
      {
        role: 'analyst',
        roleHidden: [ALWAYS_ON_SECTION, 'agents', 'content'],
        shown: [],
        hidden: [ALWAYS_ON_SECTION],
        workAreas: ['developers'],
      },
      menuSectionsFor(true, false, true),
    );
    expect(hidden.has(ALWAYS_ON_SECTION)).toBe(false);
    expect(tabsShown(hidden)).toEqual(['Today', 'Actions', 'Signals', 'History']);
  });

  it('keep the work areas as they are: each still names agents', () => {
    for (const area of WORK_AREAS) {
      expect(area.sections).toContain('agents');
      expect(area.sections).toContain(ALWAYS_ON_SECTION);
    }
  });
});
