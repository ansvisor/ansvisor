import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALWAYS_ON_SECTION,
  MENU_SECTIONS,
  WORK_AREAS,
  WORK_AREA_IDS,
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

describe('the database (00374)', () => {
  const migration = (name: string) =>
    readFileSync(join(__dirname, `../../../supabase/migrations/${name}.sql`), 'utf8');
  const sql = migration('00374_menu_access');
  const triggerName = (text: string, fn: string) =>
    text.match(
      new RegExp(`create trigger (\\w+)\\s+before update[^;]*?function public\\.${fn}`),
    )?.[1];

  it('accepts exactly the work areas the app knows', () => {
    const check = sql.match(/work_areas <@ array\[([^\]]*)\]/)?.[1] ?? '';
    expect([...check.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual(WORK_AREA_IDS);
  });

  it('clears menu access when the person moves organization, the right to change menus on a new role', () => {
    const body = sql.match(
      /function public\.reset_profile_menu_access\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/,
    )?.[1];
    const flat = body?.replace(/\s+/g, ' ');
    // A new organization or role clears the right to change menus…
    expect(flat).toContain(
      '(new.organization_id is distinct from old.organization_id or new.role is distinct from old.role) and new.can_manage_menus is not distinct from old.can_manage_menus then new.can_manage_menus := false;',
    );
    // …and a new organization the person's exceptions, unless the same
    // update sets them.
    expect(flat).toContain(
      "if new.organization_id is distinct from old.organization_id then if new.menu_shown is not distinct from old.menu_shown then new.menu_shown := '{}'; end if; if new.menu_hidden is not distinct from old.menu_hidden then new.menu_hidden := '{}'; end if;",
    );
    // Before-update triggers run in name order: the guard sees what the
    // person asked for, then the reset clears.
    expect(sql).toMatch(
      /create trigger profiles_reset_menu_access\s+before update of organization_id, role on public\.profiles/,
    );
    const guard = triggerName(
      migration('00228_profiles_server_columns'),
      'guard_profile_server_columns',
    );
    const reset = triggerName(sql, 'reset_profile_menu_access');
    expect(guard).toBeTruthy();
    expect(reset).toBeTruthy();
    expect(guard! < reset!).toBe(true);
  });
});
