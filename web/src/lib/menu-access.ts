import type { SupabaseClient } from '@supabase/supabase-js';
import { dashboardNav, type NavItem } from '@/config/dashboard';
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

/** A section of the left menu, with the menu entry that names it. */
export interface MenuSectionEntry {
  section: string;
  /** The entry's title in config/dashboard.ts (getDashboardNavLabel names it). */
  title: string;
  icon: NavItem['icon'];
}

/**
 * The sections of these menu items, in the menu's order: each item's, then
 * those of its submenu entries that are sections of their own (Brand
 * Visibility's Mentions, Citations and Products, items of their own before
 * it gathered them, keep their sections and names, so menus already set
 * keep them).
 */
export function menuSectionEntries(items: readonly NavItem[]): MenuSectionEntry[] {
  const entries: MenuSectionEntry[] = [];
  const add = (href: string, title: string, icon: NavItem['icon']) => {
    const section = menuSectionOf(href);
    if (section && !entries.some((entry) => entry.section === section)) {
      entries.push({ section, title, icon });
    }
  };
  for (const item of items) {
    add(item.href, item.title, item.icon);
    for (const child of item.children ?? []) {
      add(child.href, child.sectionTitle ?? child.title, child.icon ?? item.icon);
    }
  }
  return entries;
}

/**
 * Every section of the left menu, in its order: Chat, the Action Center and
 * Agents under it, then Analytics' and More's. Agents keeps Agent Center's
 * section name, so every menu saved for a role, a person or a work area
 * keeps working.
 */
export const MENU_SECTIONS: string[] = menuSectionEntries(
  dashboardNav.flatMap((group) => group.items),
).map((entry) => entry.section);

/**
 * Sections only the new Chat has (CHAT_AGENTIC): Action Center › Agents.
 * While it is off for the workspace they are on no menu and in no list of
 * sections.
 */
export const CHAT_AGENTIC_SECTIONS: string[] = [
  ...new Set(
    dashboardNav
      .flatMap((group) => group.items)
      .flatMap((item) => [item, ...(item.children ?? [])])
      .filter((entry) => entry.requiresChatAgentic)
      .map((entry) => menuSectionOf(entry.href))
      .filter((section): section is string => section !== null),
  ),
];

/**
 * Sections only Ads has (ADS_ENABLED, lib/ads/flag.ts): Ads. While it is off
 * they are on no menu and in no list of sections; on, roles, people and work
 * areas hide it as they hide any other.
 */
export const ADS_SECTIONS: string[] = dashboardNav
  .flatMap((group) => group.items)
  .filter((item) => item.requiresAds)
  .map((item) => menuSectionOf(item.href))
  .filter((section): section is string => section !== null);

/**
 * The left menu's sections a workspace has, in its order: Agents only with
 * the new Chat on, Ads only with Ads on; all of them with both.
 */
export function menuSectionsFor(chatAgentic: boolean, ads = false): string[] {
  return MENU_SECTIONS.filter(
    (section) =>
      (chatAgentic || !CHAT_AGENTIC_SECTIONS.includes(section)) &&
      (ads || !ADS_SECTIONS.includes(section)),
  );
}

/**
 * What a person works on or leads, with the sections that work needs. They
 * follow the audiences on ansvisor.com › Solutions. Agent Center is in every
 * area Chat is in, right after it; AEO/GEO & Audit, Developers and Analytics
 * have it without Chat, right after Action Center. Ads, paid and earned
 * answers side by side, is for Founders & leaders, Growth and Analytics,
 * right after AI Referral Traffic where they have it.
 */
export const WORK_AREAS = [
  {
    id: 'leaders',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'mentions',
      'traffic',
      'ads',
      'reports',
    ],
  },
  {
    id: 'aeo',
    sections: ['action-center', 'agents', 'content', 'audit', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'content',
    sections: ['action-center', 'agent', 'agents', 'content', 'prompts', 'citations', 'reports'],
  },
  {
    id: 'brand',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'mentions',
      'citations',
      'reports',
    ],
  },
  {
    id: 'growth',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'prompts',
      'citations',
      'traffic',
      'ads',
      'reports',
    ],
  },
  {
    id: 'product',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'prompts',
      'mentions',
      'shopping',
      'reports',
    ],
  },
  {
    id: 'bizdev',
    sections: [
      'action-center',
      'agent',
      'agents',
      'insights',
      'competitors',
      'prompts',
      'mentions',
      'citations',
      'reports',
    ],
  },
  {
    id: 'developers',
    sections: ['action-center', 'agents', 'audit', 'prompts', 'citations', 'traffic', 'reports'],
  },
  {
    id: 'analytics',
    sections: [
      'action-center',
      'agents',
      'insights',
      'competitors',
      'prompts',
      'mentions',
      'citations',
      'shopping',
      'traffic',
      'ads',
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
 * it's saved. Of `sections`, the menu's the workspace has.
 */
export function hiddenWithWorkAreas(
  hiddenByAdmin: readonly string[],
  workAreas: readonly string[],
  sections: readonly string[] = MENU_SECTIONS,
): string[] {
  const byAreas = hiddenMenuSections(
    {
      role: 'admin',
      roleHidden: [],
      shown: [],
      hidden: [],
      workAreas,
    },
    sections,
  );
  return sections.filter((section) => hiddenByAdmin.includes(section) || byAreas.has(section));
}

/** A person's menu, as the dashboard and Settings read it. */
export interface MyMenu {
  /** Sections off this person's left menu. */
  hidden: string[];
  /** Of those, the ones their role or an exception takes off, whatever their work areas. */
  hiddenByAdmin: string[];
  /** The work areas that narrow it (workAreasOf); none is Everything. */
  workAreas: WorkAreaId[];
  /** Admin, or a manager an admin let change menus. */
  canManageMenus: boolean;
}

/** The profile's menu columns (00374), read with the rest of the profile. */
export interface MenuProfile {
  role: UserRole;
  work_areas: string[] | null;
  work_areas_asked_at: string | null;
  menu_shown: string[] | null;
  menu_hidden: string[] | null;
  can_manage_menus: boolean | null;
}

export function canManageMenus(profile: Pick<MenuProfile, 'role' | 'can_manage_menus'>): boolean {
  return profile.role === 'admin' || (profile.role === 'manager' && !!profile.can_manage_menus);
}

/**
 * When everyone's work areas went back to Everything (owner, 2026-11-11):
 * "What do you work on?" left onboarding, and nobody's menu stays narrowed
 * by an answer to it. Work areas saved before then are kept but no longer
 * count; picking them again in Settings (setMyWorkAreas stamps
 * work_areas_asked_at) does. Moving it later resets everyone again.
 */
export const WORK_AREAS_RESET_AT = '2026-11-11T12:00:00Z';

/**
 * A person's work areas: the known ones they saved since WORK_AREAS_RESET_AT;
 * none (Everything) when they haven't picked any since. Everything that
 * reads work areas (the menu, Agent Center, MCP) goes through this.
 */
export function workAreasOf(
  profile: {
    work_areas?: readonly string[] | null;
    work_areas_asked_at?: string | null;
  } | null,
): WorkAreaId[] {
  const savedAt = profile?.work_areas_asked_at ? Date.parse(profile.work_areas_asked_at) : NaN;
  if (!(savedAt >= Date.parse(WORK_AREAS_RESET_AT))) return [];
  return (profile?.work_areas ?? []).filter(isWorkAreaId);
}

/**
 * A person's menu from their profile and their role's hidden sections, of
 * `sections`: the menu's the workspace has (menuSectionsFor).
 */
export function menuOfProfile(
  profile: MenuProfile,
  roleHidden: readonly string[],
  sections: readonly string[] = MENU_SECTIONS,
): MyMenu {
  const workAreas = workAreasOf(profile);
  const access = {
    role: profile.role,
    roleHidden,
    shown: profile.menu_shown ?? [],
    hidden: profile.menu_hidden ?? [],
  };
  return {
    hidden: [...hiddenMenuSections({ ...access, workAreas }, sections)],
    hiddenByAdmin: [...hiddenMenuSections({ ...access, workAreas: [] }, sections)],
    workAreas,
    canManageMenus: canManageMenus(profile),
  };
}

/**
 * The sections a role's row hides, as RLS lets members of the organization
 * read it. None for admins, without a read; none, logged, when it can't be
 * read, so the menu shows whole rather than not at all.
 */
export async function readRoleHidden(
  supabase: Pick<SupabaseClient, 'from'>,
  organizationId: string,
  role: UserRole,
): Promise<string[]> {
  if (role === 'admin') return [];
  const { data, error } = await supabase
    .from('organization_menu_roles')
    .select('hidden_sections')
    .eq('organization_id', organizationId)
    .eq('role', role)
    .maybeSingle();
  if (error) {
    console.error('[menu-access] the role menu could not be read; showing the whole menu', error);
    return [];
  }
  return (data?.hidden_sections as string[] | null) ?? [];
}

/** Known sections only, once each, in the menu's order; never Action Center. */
export function cleanMenuSections(values: readonly string[]): string[] {
  return MENU_SECTIONS.filter(
    (section) => section !== ALWAYS_ON_SECTION && values.includes(section),
  );
}
