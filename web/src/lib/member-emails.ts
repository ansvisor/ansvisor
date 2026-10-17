import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Members' e-mails, which live in auth rather than on their profiles. The
 * one identifier every member has, and what the team list and the assignee
 * pickers show when a profile has no name (most have none). Read in parallel:
 * one admin call per member, which one after another made a team of ten take
 * as long as ten calls. Server only — callers check the ids are members of
 * the caller's organization first.
 */
export async function readMemberEmails(userIds: string[]): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  await Promise.all(
    [...new Set(userIds)].map(async (id) => {
      const { data } = await supabaseAdmin.auth.admin.getUserById(id);
      if (data?.user?.email) emails.set(id, data.user.email);
    }),
  );
  return emails;
}
