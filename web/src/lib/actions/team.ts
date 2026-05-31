'use server';

import { randomBytes } from 'crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { enforceLimit, getOrgPlan } from '@/lib/guards/plan-guard';

export type TeamRole = 'admin' | 'manager' | 'analyst' | 'agency_partner';

export interface TeamMember {
  userId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: TeamRole;
  createdAt: string;
  isCurrentUser: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: TeamRole;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  invitedBy: string | null;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
}

export interface TeamInfo {
  memberCount: number;
  pendingCount: number;
  seatsUsed: number;
  maxTeamMembers: number;
  canInvite: boolean;
  planName: string;
}

async function getCurrentUserAndOrg() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('Unauthorized');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) throw new Error('No organization');

  return {
    user,
    profile: profile as { id: string; role: TeamRole; organization_id: string },
  };
}

async function requireAdmin() {
  const { user, profile } = await getCurrentUserAndOrg();
  if (profile.role !== 'admin') {
    throw new Error('Only admins can manage team members');
  }
  return { user, profile };
}

export async function getTeamInfo(): Promise<TeamInfo> {
  const { profile } = await getCurrentUserAndOrg();

  const [{ count: memberCount }, { count: pendingCount }, plan] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id),
    supabaseAdmin
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id)
      .eq('status', 'pending'),
    getOrgPlan(profile.organization_id),
  ]);

  const mc = memberCount ?? 0;
  const pc = pendingCount ?? 0;
  const seatsUsed = mc + pc;
  const max = plan.limits.maxTeamMembers;
  const canInvite = max === -1 || seatsUsed < max;

  return {
    memberCount: mc,
    pendingCount: pc,
    seatsUsed,
    maxTeamMembers: max,
    canInvite,
    planName: plan.name,
  };
}

export async function listMembers(): Promise<TeamMember[]> {
  const { user, profile } = await getCurrentUserAndOrg();

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name, avatar_url, role, created_at')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  const userIds = (data ?? []).map((p) => p.id as string);
  if (userIds.length === 0) return [];

  const emailMap = new Map<string, string>();
  for (const uid of userIds) {
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);
    if (authUser?.user?.email) emailMap.set(uid, authUser.user.email);
  }

  return (data ?? []).map((p) => ({
    userId: p.id as string,
    email: emailMap.get(p.id as string) ?? '',
    fullName: (p.full_name as string | null) ?? null,
    avatarUrl: (p.avatar_url as string | null) ?? null,
    role: p.role as TeamRole,
    createdAt: p.created_at as string,
    isCurrentUser: p.id === user.id,
  }));
}

export async function listInvitations(): Promise<TeamInvitation[]> {
  const { profile } = await getCurrentUserAndOrg();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((i) => ({
    id: i.id as string,
    email: i.email as string,
    role: i.role as TeamRole,
    status: i.status as TeamInvitation['status'],
    invitedBy: (i.invited_by as string | null) ?? null,
    expiresAt: i.expires_at as string,
    createdAt: i.created_at as string,
    acceptedAt: (i.accepted_at as string | null) ?? null,
  }));
}

export async function inviteMember(email: string, role: TeamRole) {
  const { user, profile } = await requireAdmin();
  const normalizedEmail = email.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('Invalid email address');
  }

  const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
    supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id),
    supabaseAdmin
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', profile.organization_id)
      .eq('status', 'pending'),
  ]);

  const total = (memberCount ?? 0) + (inviteCount ?? 0);
  await enforceLimit(profile.organization_id, 'maxTeamMembers', total);

  const { data: existingMember } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', profile.organization_id)
    .limit(1);

  if (existingMember && existingMember.length > 0) {
    const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const matched = authUsers?.users?.find((u) => u.email?.toLowerCase() === normalizedEmail);
    if (matched) {
      const { data: matchedProfile } = await supabaseAdmin
        .from('profiles')
        .select('organization_id')
        .eq('id', matched.id)
        .maybeSingle();
      if (matchedProfile?.organization_id === profile.organization_id) {
        throw new Error('This user is already a member of your team');
      }
    }
  }

  const token = randomBytes(32).toString('hex');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  // What we hand to Supabase as `redirectTo`. It becomes `{{ .RedirectTo }}`
  // in the Invite User template, which we use as the *base* for the
  // /auth/confirm URL — token_hash + type get appended in the template.
  // The benefit: the prefix is whatever appUrl is for *this* environment
  // (localhost when running `pnpm dev`, app.ansvisor.com in production),
  // independent of Supabase's project-level Site URL. So a single template
  // works for both dev and prod.
  const inviteLink = `${appUrl}/auth/confirm?next=${encodeURIComponent(`/invite/${token}`)}`;

  const { data: invitation, error: insertError } = await supabaseAdmin
    .from('invitations')
    .insert({
      organization_id: profile.organization_id,
      email: normalizedEmail,
      role,
      token,
      invited_by: user.id,
    })
    .select()
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      throw new Error('A pending invitation already exists for this email');
    }
    throw new Error(insertError.message);
  }

  try {
    await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo: inviteLink,
      data: { invitation_token: token },
    });
  } catch {
    // Supabase may fail if user already has an account; we still keep the
    // invitation row so that the direct link works.
  }

  revalidatePath('/dashboard/settings');
  return { invitation, inviteLink };
}

export async function revokeInvitation(invitationId: string) {
  const { profile } = await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from('invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}

export async function resendInvitation(invitationId: string) {
  const { profile } = await requireAdmin();

  const { data: invitation, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('id', invitationId)
    .eq('organization_id', profile.organization_id)
    .single();

  if (error || !invitation) throw new Error('Invitation not found');
  if (invitation.status !== 'pending') {
    throw new Error('Only pending invitations can be resent');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const inviteLink = `${appUrl}/invite/${invitation.token}`;

  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin
    .from('invitations')
    .update({ expires_at: newExpiresAt })
    .eq('id', invitationId);

  try {
    await supabaseAdmin.auth.admin.inviteUserByEmail(invitation.email as string, {
      redirectTo: inviteLink,
      data: { invitation_token: invitation.token },
    });
  } catch {
    // Ignore: link is still valid regardless of email delivery outcome.
  }

  revalidatePath('/dashboard/settings');
  return { inviteLink };
}

export async function updateMemberRole(userId: string, role: TeamRole) {
  const { user, profile } = await requireAdmin();

  if (userId === user.id) {
    throw new Error('You cannot change your own role');
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ role })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}

export async function removeMember(userId: string) {
  const { user, profile } = await requireAdmin();

  if (userId === user.id) {
    throw new Error('You cannot remove yourself from the team');
  }

  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ organization_id: null })
    .eq('id', userId)
    .eq('organization_id', profile.organization_id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/settings');
}

export interface AcceptInvitationResult {
  organizationId: string;
  role: TeamRole;
}

export async function acceptInvitation(token: string): Promise<AcceptInvitationResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error('You must be signed in to accept an invitation');

  const { data: invitation, error } = await supabaseAdmin
    .from('invitations')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error || !invitation) throw new Error('Invitation not found');

  if (invitation.status !== 'pending') {
    throw new Error('This invitation is no longer valid');
  }

  const expiresAt = new Date(invitation.expires_at as string);
  if (expiresAt.getTime() < Date.now()) {
    await supabaseAdmin.from('invitations').update({ status: 'expired' }).eq('id', invitation.id);
    throw new Error('This invitation has expired');
  }

  const inviteEmail = (invitation.email as string).toLowerCase();
  const userEmail = user.email?.toLowerCase() ?? '';
  if (inviteEmail !== userEmail) {
    throw new Error(`This invitation was sent to ${inviteEmail}. Please sign in with that email.`);
  }

  const { error: profileErr } = await supabaseAdmin
    .from('profiles')
    .update({
      organization_id: invitation.organization_id,
      role: invitation.role,
      onboarding_completed: true,
    })
    .eq('id', user.id);

  if (profileErr) throw new Error(profileErr.message);

  await supabaseAdmin
    .from('invitations')
    .update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invitation.id);

  revalidatePath('/dashboard');

  return {
    organizationId: invitation.organization_id as string,
    role: invitation.role as TeamRole,
  };
}

export async function getInvitationByToken(token: string) {
  const { data, error } = await supabaseAdmin
    .from('invitations')
    .select('id, email, role, status, expires_at, organization_id, organizations(name)')
    .eq('token', token)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id as string,
    email: data.email as string,
    role: data.role as TeamRole,
    status: data.status as TeamInvitation['status'],
    expiresAt: data.expires_at as string,
    organizationId: data.organization_id as string,
    organizationName: (data.organizations as unknown as { name: string } | null)?.name ?? null,
  };
}
