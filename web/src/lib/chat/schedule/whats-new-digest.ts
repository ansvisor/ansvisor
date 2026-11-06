import { createTranslator } from 'next-intl';
import messages from '../../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import type { EntryPlan } from '../whats-new/entries';
import {
  UNREAD_DAYS,
  markWhatsNewRead,
  pickWhatsNew,
  readWhatsNewReads,
  whatsNewFlags,
  type WhatsNewItem,
} from '../whats-new/reads';
import { startTouchedBrands } from '../touched-brands';

/**
 * What's new for my plan, on a schedule (Chat Wave 4 W4-23, 00489): a job
 * a person sets up on the schedule card, "1st of every month" unless they
 * pick another time. Nothing is set up for anyone in advance (owner
 * decision 14). Each run calls no model, takes no run slot and uses none of
 * the AI limit: it lists the creator's unread What's new entries for their
 * plan (reads.ts, the same pick as get_whats_new) in the job's chat, and
 * marks them read so the next run lists only newer ones. With nothing new
 * it delivers nothing, and its run row is Unchanged. The worker
 * (worker.ts) checks the job and keeps its run row. Server only.
 */

/** chat_schedules.digest for a What's new job (00489). */
export const WHATS_NEW_DIGEST = 'whats_new';

/** The most entries one digest lists; older ones wait for "What's new" in Chat. */
export const DIGEST_MAX = 10;

const t = createTranslator({ locale: 'en', messages, namespace: 'chatSchedules' });

/** Whether a job is a What's new digest. */
export const isWhatsNewDigest = (job: { digest?: string | null }) =>
  job.digest === WHATS_NEW_DIGEST;

/** The message a digest's chat shows for each run, as a person's would be. */
export const digestPrompt = () => t('digest.prompt');

/** Text from an entry, safe as Markdown: its own characters, never formatting. */
const plain = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, '\\$1');

/**
 * The digest's answer, in Markdown (remark-breaks: one line each): how many
 * updates, then each one's feature, its plans when the person's doesn't
 * include it, its lines and Try it, then "Ask me “What's new”" when older
 * ones are left. Pure.
 */
export function digestAnswer(items: readonly WhatsNewItem[], more: boolean): string {
  const blocks = items.map((item) => {
    const title = `**${plain(item.feature)}**`;
    const head = item.onPlans
      ? `${title} · ${t('digest.onPlans', { plans: item.onPlans })}`
      : title;
    return [head, ...item.lines.map(plain), `[${t('digest.tryIt')}](${item.route})`].join('\n');
  });
  return [
    t('digest.intro', { count: items.length }),
    ...blocks,
    ...(more ? [t('digest.older')] : []),
  ].join('\n\n');
}

/** The job as the digest reads it. */
export interface DigestJob {
  id: string;
  organization_id: string;
  title: string;
  prompt: string | null;
}

export interface DigestInput {
  job: DigestJob;
  /** The job's run row, for its Chat run and answer. */
  runRowId: string;
  /** The job's creator: the digest is theirs, read as they read What's new. */
  userId: string;
  plan: EntryPlan;
  /** The job's live chat; null makes it. */
  chatId: string | null;
  /** The slot it runs for, shown under the message as a scheduled run's is. */
  slot: string;
  timezone: string;
  now: Date;
}

export type DigestOutcome =
  | { kind: 'nothing' }
  | { kind: 'sent'; conversationId: string; chatRunId: string; answerId: string; count: number };

async function insertId(table: string, row: Record<string, unknown>, what: string) {
  const { data, error } = await supabaseAdmin
    .from(table as 'chat_messages')
    .insert(row as never)
    .select('id')
    .single();
  if (error || !data) {
    const failure = new Error(`Could not ${what}: ${error?.message ?? 'no row'}`);
    (failure as Error & { code?: string }).code = error?.code;
    throw failure;
  }
  return (data as { id: string }).id;
}

/**
 * Sends one run's digest (above). Answers what it came to, or null when its
 * chat was made by another worker at the same time (one live chat per job):
 * the worker reads the chat again and tries once more.
 */
export async function sendWhatsNewDigest(input: DigestInput): Promise<DigestOutcome | null> {
  const { job, userId, now } = input;
  const read = await readWhatsNewReads(userId);
  const pick = pickWhatsNew({
    plan: input.plan,
    // As get_whats_new: an entry for a switch shows only where it's on.
    flags: whatsNewFlags(job.organization_id),
    read,
    now,
    unreadOnly: true,
    days: UNREAD_DAYS,
    limit: DIGEST_MAX,
  });
  if (pick.items.length === 0) return { kind: 'nothing' };

  let conversationId = input.chatId;
  if (!conversationId) {
    try {
      conversationId = await insertId(
        'chat_conversations',
        {
          organization_id: job.organization_id,
          user_id: userId,
          brand_id: null,
          title: job.title.slice(0, 200),
          origin: 'schedule',
          schedule_id: job.id,
        },
        "start the digest's chat",
      );
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    }
    await startTouchedBrands(conversationId);
  }
  const chips = [
    { key: 'schedule', label: t('run.chip.job'), value: job.title },
    { key: 'slot', label: t('run.chip.slot'), value: input.slot },
  ];
  // One after the other, so the message comes before its answer.
  await insertId(
    'chat_messages',
    {
      conversation_id: conversationId,
      role: 'user',
      content_md: job.prompt?.trim() || digestPrompt(),
      context_json: { context: { route: '/dashboard/chat', chips } } as unknown as Json,
    },
    "keep the digest's message",
  );
  const answerId = await insertId(
    'chat_messages',
    {
      conversation_id: conversationId,
      role: 'assistant',
      content_md: digestAnswer(pick.items, pick.more),
      timezone: input.timezone,
      generated_at: now.toISOString(),
    },
    "write the digest's answer",
  );
  // A run that ended as it began: the chat list and Inbox show it as an unread result.
  const chatRunId = await insertId(
    'chat_runs',
    {
      message_id: answerId,
      conversation_id: conversationId,
      status: 'done',
      started_at: now.toISOString(),
      finished_at: now.toISOString(),
    },
    "keep the digest's run",
  );
  const updates = [
    supabaseAdmin
      .from('chat_schedule_runs')
      .update({ run_id: chatRunId, message_id: answerId })
      .eq('id', input.runRowId),
    supabaseAdmin
      .from('chat_schedules')
      .update({ conversation_id: conversationId })
      .eq('id', job.id),
  ];
  for (const { error } of await Promise.all(updates)) {
    if (error) throw new Error(`Could not keep the digest's run: ${error.message}`);
  }
  // Delivered: the next run lists only newer ones. A failed mark shows them again, nothing worse.
  await markWhatsNewRead(
    userId,
    pick.items.map((item) => item.slug),
  );
  return { kind: 'sent', conversationId, chatRunId, answerId, count: pick.items.length };
}
