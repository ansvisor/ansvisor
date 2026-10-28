import { dashboardNav } from '@/config/dashboard';
import type { UserRole } from '@/types';

/**
 * Menu access: which left-menu sections a person sees. Hide only: a hidden
 * section is off the menu, its pages still open from a link, and what the
 * person can do there doesn't change.
 *
 * A section is named by its route under /dashboard ('content', 'audit',
 * 'insights'…), the name the database keeps (00374).
 */

/** On everyone's menu, always: where the work is. */
export const ALWAYS_ON_SECTION = 'action-center';

/** The section a route belongs to: '/dashboard/content/plan' → 'content'. */
export function menuSectionOf(href: string): string | null {
  const [, root, section] = href.split('/');
  return root === 'dashboard' && section ? section : null;
}

/** Every section of the left menu, in its order. */
export const MENU_SECTIONS: string[] = dashboardNav
  .flatMap((group) => group.items)
  .map((item) => menuSectionOf(item.href))
  .filter((section): section is string => section !== null);

/**
 * What a person works on or leads, with the sections that work needs. They
 * follow the audiences on ansvisor.com › Solutions.
 */
export const WORK_AREAS = [
  {
    id: 'leaders',
    sections: ['action-center', 'agent', 'insights', 'mentions', 'traffic', 'reports'],
  },
  {
    id: 'aeo',
    sections: ['action-center', 'content', 'audit', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'content',
    sections: ['action-center', 'agent', 'content', 'prompts', 'citations', 'reports'],
  },
  {
    id: 'brand',
    sections: ['action-center', 'agent', 'insights', 'mentions', 'citations', 'reports'],
  },
  {
    id: 'growth',
    sections: ['action-center', 'agent', 'insights', 'prompts', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'product',
    sections: ['action-center', 'agent', 'insights', 'prompts', 'mentions', 'shopping', 'reports'],
  },
  {
    id: 'bizdev',
    sections: ['action-center', 'agent', 'insights', 'prompts', 'mentions', 'citations', 'reports'],
  },
  {
    id: 'developers',
    sections: ['action-center', 'audit', 'prompts', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'analytics',
    sections: [
      'action-center',
      'insights',
      'prompts',
      'mentions',
      'citations',
      'shopping',
      'traffic',
      'reports',
    ],
  },
] as const;

export type WorkAreaId = (typeof WORK_AREAS)[number]['id'];

export const WORK_AREA_IDS: WorkAreaId[] = WORK_AREAS.map((area) => area.id);

/** Sections some work area names: work areas narrow only these. */
const AREA_SECTIONS = new Set<string>(WORK_AREAS.flatMap((area) => area.sections));

export function isWorkAreaId(value: string): value is WorkAreaId {
  return (WORK_AREA_IDS as string[]).includes(value);
}

/** The sections a set of work areas needs; every section for none. */
export function workAreaSections(areas: readonly string[]): Set<string> | null {
  const known = WORK_AREAS.filter((area) => areas.includes(area.id));
  if (!known.length) return null;
  return new Set(known.flatMap((area) => area.sections));
}

/** What decides a person's menu. */
export interface MenuAccess {
  role: UserRole;
  /** The sections the person's role doesn't see (organization_menu_roles). */
  roleHidden: readonly string[];
  /** Sections shown for the person although the role hides them. */
  shown: readonly string[];
  /** Sections hidden for the person although the role shows them. */
  hidden: readonly string[];
  workAreas: readonly string[];
}

/**
 * The sections of `sections` a person's menu leaves out: their role's,
 * changed by their own exceptions, then narrowed to their work areas. A
 * section no work area names (one added later) stays. Nobody takes a
 * section off an admin's menu, only their own work areas narrow it; Action
 * Center is never left out.
 */
export function hiddenMenuSections(
  access: MenuAccess,
  sections: readonly string[] = MENU_SECTIONS,
): Set<string> {
  const left = new Set<string>();
  const areaSections = workAreaSections(access.workAreas);
  for (const section of sections) {
    if (section === ALWAYS_ON_SECTION) continue;
    const byPerson =
      access.role === 'admin' ||
      (access.shown.includes(section)
        ? true
        : access.hidden.includes(section)
          ? false
          : !access.roleHidden.includes(section));
    const byArea = !areaSections || !AREA_SECTIONS.has(section) || areaSections.has(section);
    if (!byPerson || !byArea) left.add(section);
  }
  return left;
}

/**
 * The sections off a menu with these work areas, given those the person's
 * role and exceptions take off whatever they work on: as they pick, before
 * it's saved.
 */
export function hiddenWithWorkAreas(
  hiddenByAdmin: readonly string[],
  workAreas: readonly string[],
): string[] {
  const byAreas = hiddenMenuSections({
    role: 'admin',
    roleHidden: [],
    shown: [],
    hidden: [],
    workAreas,
  });
  return MENU_SECTIONS.filter((section) => hiddenByAdmin.includes(section) || byAreas.has(section));
}

/** Known sections only, once each, in the menu's order; never Action Center. */
export function cleanMenuSections(values: readonly string[]): string[] {
  return MENU_SECTIONS.filter(
    (section) => section !== ALWAYS_ON_SECTION && values.includes(section),
  );
}
