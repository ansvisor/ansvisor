import supabaseAdmin from '../../config/supabase.js';
import { brandReaders } from '../access.js';
import { BUTTON, frame, membersOf, one, tell } from './go-live.js';
import { appOrigin, escapeHtml } from './own-key.js';

/**
 * Telling a person an agent's run waits for them: "Notify me when an agent
 * needs me" (Settings › Chat, chat_user_prefs.notify_via, 00408; 00474).
 * The run stopped to ask them something or for their OK on a change (its
 * status needs_you). The person it acts as (its acting user, else the
 * agent's owner), when they are a member and reach the run's brand, gets one
 * e-mail with "Inbox + email": once per run. A chat_notices row records it
 * (agent_needs_you:{run id}); the Inbox lists the run's chat under Needs
 * you already, so the web doesn't show the row. Through Resend (email.js), a
 * silent no-op where it isn't configured. Never on the run's way: the caller
 * logs what fails.
 */

/**
 * The e-mail for an agent's run that waits for its person.
 * @param {{ agent: string, brand: string | null, chatId: string | null }} input
 */
export function renderNeedsYouEmail({ agent, brand, chatId }) {
  const subject = `${agent} needs you`;
  const where = brand ? ` on ${escapeHtml(brand)}` : '';
  const html = frame(
    escapeHtml(subject),
    [
      `${escapeHtml(agent)} stopped${where} to ask you something or to wait for your OK on a change. It goes on once you answer.`,
      'Nothing was changed or sent while it waits.',
    ],
    [
      `<a href="${escapeHtml(chatId ? `${appOrigin()}/dashboard/chat/${chatId}` : `${appOrigin()}/dashboard/chat`)}" style="${BUTTON}">Open the run</a>`,
    ],
    "You get this as the person the agent runs for, by your Chat settings' Notify me when an agent needs me. Once per run.",
  );
  return { subject, html };
}

/**
 * An agent's run that waits for its person: the notice and its e-mail, once
 * per run. What went out: { notices, emails }; 0 and 0 for a run that
 * doesn't wait, isn't the workspace's, or has no one to tell.
 * @param {{ orgId: string, agentRunId: string }} input
 */
export async function tellNeedsYou({ orgId, agentRunId }) {
  const run = await one(
    supabaseAdmin
      .from('chat_agent_runs')
      .select('id, organization_id, agent_id, acting_user_id, brand_id, status')
      .eq('id', agentRunId),
  );
  if (!run || run.organization_id !== orgId || run.status !== 'needs_you' || !run.agent_id) {
    return { notices: 0, emails: 0 };
  }
  const [agent, brand, convo] = await Promise.all([
    one(supabaseAdmin.from('chat_agents').select('name, owner_id').eq('id', run.agent_id)),
    run.brand_id ? one(supabaseAdmin.from('brands').select('name').eq('id', run.brand_id)) : null,
    one(supabaseAdmin.from('chat_conversations').select('id').eq('agent_run_id', run.id).limit(1)),
  ]);
  if (!agent) return { notices: 0, emails: 0 };

  // The person it runs for, when they are a member and reach its brand.
  let people = await membersOf(orgId, [run.acting_user_id ?? agent.owner_id]);
  if (run.brand_id) {
    const readers = await brandReaders(orgId, [run.brand_id]);
    people = people.filter((id) => readers.has(id));
  }
  const chatId = convo?.id ?? null;
  return tell({
    orgId,
    people,
    kind: 'agent_needs_you',
    brandId: run.brand_id ?? null,
    dedupe: `agent_needs_you:${run.id}`,
    payload: { agent: agent.name, agentId: run.agent_id, runId: run.id, chatId },
    email: renderNeedsYouEmail({ agent: agent.name, brand: brand?.name ?? null, chatId }),
  });
}
