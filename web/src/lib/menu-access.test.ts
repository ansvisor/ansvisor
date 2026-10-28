import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ON_SECTION,
  MENU_SECTIONS,
  WORK_AREAS,
  cleanMenuSections,
  hiddenMenuSections,
  menuSectionOf,
  workAreaSections,
  type MenuAccess,
} from './menu-access';

const analyst: MenuAccess = {
  role: 'analyst',
  roleHidden: [],
  shown: [],
  hidden: [],
  workAreas: [],
};

const hidden = (access: Partial<MenuAccess>) => [...hiddenMenuSections({ ...analyst, ...access })];

describe('menuSectionOf', () => {
  it('names a route by its first part under /dashboard', () => {
    expect(menuSectionOf('/dashboard/content/plan')).toBe('content');
    expect(menuSectionOf('/dashboard/agent')).toBe('agent');
    expect(menuSectionOf('/dashboard')).toBeNull();
    expect(menuSectionOf('/pricing')).toBeNull();
  });
});

describe('MENU_SECTIONS', () => {
  it('lists the left menu, Action Center first', () => {
    expect(MENU_SECTIONS[0]).toBe(ALWAYS_ON_SECTION);
    expect(MENU_SECTIONS).toEqual(
      expect.arrayContaining(['agent', 'content', 'audit', 'insights', 'shopping', 'reports']),
    );
  });

  it('knows every section a work area names', () => {
    for (const area of WORK_AREAS) {
      for (const section of area.sections) expect(MENU_SECTIONS).toContain(section);
    }
  });
});

describe('hiddenMenuSections', () => {
  it('shows everything when nothing is hidden', () => {
    expect(hidden({})).toEqual([]);
  });

  it('leaves out what the role hides', () => {
    expect(hidden({ roleHidden: ['content', 'audit'] })).toEqual(['content', 'audit']);
  });

  it('shows a section for a person although the role hides it, and hides one it shows', () => {
    expect(
      hidden({ roleHidden: ['content', 'audit'], shown: ['audit'], hidden: ['reports'] }),
    ).toEqual(['content', 'reports']);
  });

  it('narrows the menu to the work areas', () => {
    expect(hidden({ workAreas: ['brand'] }).sort()).toEqual(
      ['audit', 'content', 'prompts', 'shopping', 'traffic'].sort(),
    );
  });

  it('keeps a section shown for the person to their work areas', () => {
    expect(hidden({ workAreas: ['brand'], shown: ['content'] })).toContain('content');
  });

  it('ignores work areas it does not know', () => {
    expect(hidden({ workAreas: ['retired-area'] })).toEqual([]);
  });

  it('keeps a section no work area names', () => {
    const sections = [...MENU_SECTIONS, 'new-section'];
    expect([...hiddenMenuSections({ ...analyst, workAreas: ['brand'] }, sections)]).not.toContain(
      'new-section',
    );
  });

  it('never hides Action Center', () => {
    expect(
      hidden({
        roleHidden: [ALWAYS_ON_SECTION],
        hidden: [ALWAYS_ON_SECTION],
        workAreas: ['brand'],
      }),
    ).not.toContain(ALWAYS_ON_SECTION);
  });

  it('takes nothing off an admin’s menu but their own work areas', () => {
    expect(hidden({ role: 'admin', roleHidden: ['content'], hidden: ['reports'] })).toEqual([]);
    expect(
      hidden({ role: 'admin', roleHidden: ['mentions'], workAreas: ['brand'] }).sort(),
    ).toEqual(['audit', 'content', 'prompts', 'shopping', 'traffic'].sort());
  });
});

describe('workAreaSections', () => {
  it('joins the areas’ sections', () => {
    const sections = workAreaSections(['developers', 'brand']);
    expect(sections?.has('audit')).toBe(true);
    expect(sections?.has('mentions')).toBe(true);
    expect(sections?.has('shopping')).toBe(false);
  });

  it('is null for no known area', () => {
    expect(workAreaSections([])).toBeNull();
  });
});

describe('cleanMenuSections', () => {
  it('keeps known sections once, in the menu’s order, without Action Center', () => {
    expect(cleanMenuSections(['reports', 'nope', 'content', 'reports', ALWAYS_ON_SECTION])).toEqual(
      ['content', 'reports'],
    );
  });
});
