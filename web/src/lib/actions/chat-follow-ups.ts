'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assertWritable } from '@/lib/subscription-guard';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  createFollowUpCheck,
  type FollowUpRefusal,
  type MadeFollowUp,
  type NewFollowUp,
} from '@/lib/chat/schedule/followup';

/**
 * Chat's follow-up checks, as the signed-in person (CHAT-20 §13; W3-05):
 * the change Set check makes (or a Full auto run, by itself), through their
 * session as the app's other changes are, refused while the workspace is
 * read-only or on the demo brand. Written with the service role after
 * schedule/followup.ts's checks for them. Behind CHAT_AGENTIC.
 */

async function member(): Promise<{ userId: string; organizationId: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the member: ${error.message}`);
  const organizationId = profile?.organization_id as string | null | undefined;
  if (!organizationId || !chatAgenticEnabled(organizationId)) return null;
  return { userId: user.id, organizationId };
}

/**
 * Sets the check, as the card had it (or as a Full auto run asked), on the
 * person's clock (`timezone`, the run's), in the chat of the run that set it.
 */
export async function setChatFollowUp(
  input: NewFollowUp,
  place: { timezone: string; runId: string | null; via: 'card' | 'full_auto' },
): Promise<MadeFollowUp | FollowUpRefusal> {
  await assertWritable({ brandId: input.brandId });
  const who = await member();
  if (!who) return { ok: false, reason: 'forbidden_role', message: 'Chat is off.' };
  return createFollowUpCheck({ ...who, ...place }, input);
}
