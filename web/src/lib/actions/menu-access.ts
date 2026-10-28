'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readMemberEmails } from '@/lib/member-emails';
import {
  WORK_AREA_IDS,
  cleanMenuSections,
  hiddenMenuSections,
  isWorkAreaId,
  type WorkAreaId,
} from '@/lib/menu-access';
import type { UserRole } from '@/types';

/**
 * Menu access (00374): who sees which left-menu sections. Admins, and the
 * managers they let change menus, set what each role sees and each
 * non-admin's exceptions; the server writes them. A person sets their own
 * work areas. Hide only: nothing here changes what anyone can open or do.
 */

/** The roles whose menu can be set: nobody takes a section off an admin's menu. */
export type MenuRole = Exclude<UserRole, 'admin'>;

const MENU_ROLES: MenuRole[] = ['manager', 'analyst', 'agency_partner'];

const userId = z.guid();
const sections = z.array(z.string().max(64)).max(64);

export interface MyMenu {
  /** Sections off this person's left menu. */
  hidden: string[];
  /** Of those, the ones their role or an exception takes off, whatever their work areas. */
  hiddenByAdmin: string[];
  workAreas: WorkAreaId[];
  /** Whether they answered (or skipped) "What do you work on?". */
  workAreasAsked: boolean;
  /** Admin, or a manager an admin let change menus. */
  canManageMenus: boolean;
}

export interface MenuMember {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: UserRole;
  workAreas: WorkAreaId[];
  shown: string[];
  hidden: string[];
  canManageMenus: boolean;
  isCurrentUser: boolean;
}

export interface MenuAccessSettings {
  /** The sections each role doesn't see. */
  roles: Record<MenuRole, string[]>;
  members: MenuMember[];
  /** The viewer is an admin: only they let managers change menus. */
  viewerIsAdmin: boolean;
}

interface Profile {
  id: string;
  role: UserRole;
  organization_id: string;
  work_areas: string[] | null;
  work_areas_asked_at: string | null;
  menu_shown: string[] | null;
  menu_hidden: string[] | null;
  can_manage_menus: boolean | null;
}

async function currentProfile(): Promise<Profile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'id, role, organization_id, work_areas, work_areas_asked_at, menu_shown, menu_hidden, can_manage_menus',
    )
    .eq('id', user.id)
    .single();
  if (!profile?.organization_id) throw new Error('No organization');
  return profile as Profile;
}

function canManage(profile: Pick<Profile, 'role' | 'can_manage_menus'>): boolean {
  return profile.role === 'admin' || (profile.role === 'manager' && !!profile.can_manage_menus);
}

async function requireMenuManager(): Promise<Profile> {
  const profile = await currentProfile();
  if (!canManage(profile)) throw new Error('Only admins and menu managers can change menus');
  return profile;
}

function workAreasOf(values: string[] | null): WorkAreaId[] {
  return (values ?? []).filter(isWorkAreaId);
}

/** The sections each role of the organization doesn't see. */
async function readRoles(organizationId: string): Promise<Record<MenuRole, string[]>> {
  const { data, error } = await supabaseAdmin
    .from('organization_menu_roles')
    .select('role, hidden_sections')
    .eq('organization_id', organizationId);
  if (error) throw new Error(error.message);

  const roles = { manager: [], analyst: [], agency_partner: [] } as Record<MenuRole, string[]>;
  for (const row of data ?? []) {
    const role = row.role as UserRole;
    if (role !== 'admin') roles[role] = cleanMenuSections(row.hidden_sections ?? []);
  }
  return roles;
}

/** The viewer's left menu: what it leaves out, and their work areas. */
export async function getMyMenu(): Promise<MyMenu> {
  const profile = await currentProfile();
  const workAreas = workAreasOf(profile.work_areas);
  let roleHidden: string[] = [];
  if (profile.role !== 'admin') {
    // Their role's row, as RLS lets members of the organization read it.
    const supabase = await createClient();
    const { data } = await supabase
      .from('organization_menu_roles')
      .select('hidden_sections')
      .eq('organization_id', profile.organization_id)
      .eq('role', profile.role)
      .maybeSingle();
    roleHidden = data?.hidden_sections ?? [];
  }

  const access = {
    role: profile.role,
    roleHidden,
    shown: profile.menu_shown ?? [],
    hidden: profile.menu_hidden ?? [],
  };
  const hidden = hiddenMenuSections({ ...access, workAreas });
  return {
    hidden: [...hidden],
    hiddenByAdmin: [...hiddenMenuSections({ ...access, workAreas: [] })],
    workAreas,
    workAreasAsked: profile.work_areas_asked_at !== null,
    canManageMenus: canManage(profile),
  };
}

/** Settings › Menu access: the role table and every member's menu. */
export async function getMenuAccessSettings(): Promise<MenuAccessSettings> {
  const profile = await requireMenuManager();

  const [roles, { data, error }] = await Promise.all([
    readRoles(profile.organization_id),
    supabaseAdmin
      .from('profiles')
      .select(
        'id, full_name, avatar_url, role, work_areas, menu_shown, menu_hidden, can_manage_menus, created_at',
      )
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: true }),
  ]);
  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const emails = await readMemberEmails(rows.map((row) => row.id as string));
  return {
    roles,
    viewerIsAdmin: profile.role === 'admin',
    members: rows.map((row) => ({
      userId: row.id as string,
      email: emails.get(row.id as string) ?? '',
      fullName: (row.full_name as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      role: row.role as UserRole,
      workAreas: workAreasOf(row.work_areas as string[] | null),
      shown: cleanMenuSections((row.menu_shown as string[] | null) ?? []),
      hidden: cleanMenuSections((row.menu_hidden as string[] | null) ?? []),
      canManageMenus: canManage({
        role: row.role as UserRole,
        can_manage_menus: row.can_manage_menus as boolean | null,
      }),
      isCurrentUser: row.id === profile.id,
    })),
  };
}

/** The sections a role doesn't see. */
export async function setRoleMenu(role: MenuRole, hidden: string[]) {
  const profile = await requireMenuManager();
  if (!MENU_ROLES.includes(role)) throw new Error('Nobody sets the admins’ menu');
  const parsed = sections.parse(hidden);

  const { error } = await supabaseAdmin.from('organization_menu_roles').upsert(
    {
      organization_id: profile.organization_id,
      role,
      hidden_sections: cleanMenuSections(parsed),
      updated_by: profile.id,
    },
    { onConflict: 'organization_id,role' },
  );
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard', 'layout');
}

/**
 * A non-admin's exceptions to their role: sections shown although the role
 * hides them, and hidden although it shows them. Empty both = the role's menu.
 */
export async function setMemberMenu(memberId: string, menu: { shown: string[]; hidden: string[] }) {
  const profile = await requireMenuManager();
  const id = userId.parse(memberId);
  const shown = cleanMenuSections(sections.parse(menu.shown));
  const hidden = cleanMenuSections(sections.parse(menu.hidden)).filter(
    (section) => !shown.includes(section),
  );

  const { data: member } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (!member) throw new Error('Not a member of your organization');
  if (member.role === 'admin') throw new Error('Nobody sets an admin’s menu');

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ menu_shown: shown, menu_hidden: hidden })
    .eq('id', id)
    .eq('organization_id', profile.organization_id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard', 'layout');
}

/** Lets a manager change menus, or takes it back. Admins only. */
export async function setMenuManager(memberId: string, allowed: boolean) {
  const profile = await currentProfile();
  if (profile.role !== 'admin') throw new Error('Only admins can choose who changes menus');
  const id = userId.parse(memberId);
  const canChange = z.boolean().parse(allowed);

  const { data: member } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (!member) throw new Error('Not a member of your organization');
  if (member.role !== 'manager') throw new Error('Only managers can be given this');

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ can_manage_menus: canChange })
    .eq('id', id)
    .eq('organization_id', profile.organization_id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}

/**
 * What the viewer works on or leads; none = every section. Answers "What do
 * you work on?" too, so it isn't asked again.
 */
export async function setMyWorkAreas(areas: string[]) {
  const parsed = z.array(z.enum(WORK_AREA_IDS as [WorkAreaId, ...WorkAreaId[]])).parse(areas);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // Their own row, as RLS and 00374's guard let a person change it.
  const { error } = await supabase
    .from('profiles')
    .update({
      work_areas: WORK_AREA_IDS.filter((area) => parsed.includes(area)),
      work_areas_asked_at: new Date().toISOString(),
    })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  revalidatePath('/dashboard', 'layout');
}
