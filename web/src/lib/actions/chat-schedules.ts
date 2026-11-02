'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { assertWritable } from '@/lib/subscription-guard';
import { chatAgenticEnabled } from '@/lib/chat/flag';
import {
  createSchedule,
  type MadeSchedule,
  type NewSchedule,
  type ScheduleRefusal,
} from '@/lib/chat/schedule/store';

/**
 * Chat's scheduled jobs, as the signed-in person (CHAT-12; W3-02): the
 * change the schedule card's Create schedule makes, through their session
 * as the app's other changes are, refused while the workspace is read-only
 * or on the demo brand. The job is written with the service role after
 * schedule/store.ts's checks for them (role, brand, skill, the plan's active
 * jobs). Behind CHAT_AGENTIC.
 */

/** The signed-in person and their workspace, with Chat on; null otherwise. */
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
 * Makes a scheduled job from its card's click: the job as the card had it,
 * read on the person's clock (`timezone`, the run's), named with the run
 * whose card made it.
 */
export async function createChatSchedule(
  input: NewSchedule,
  place: { timezone: string; runId: string | null },
): Promise<MadeSchedule | ScheduleRefusal> {
  await assertWritable({ brandId: input.brandId });
  const who = await member();
  if (!who) return { ok: false, reason: 'forbidden_role', message: 'Chat is off.' };
  return createSchedule({ ...who, timezone: place.timezone, runId: place.runId }, input);
}
