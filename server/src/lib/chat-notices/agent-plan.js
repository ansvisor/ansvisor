import supabaseAdmin from '../../config/supabase.js';
import { brandReaders } from '../access.js';
import { DEFAULT_LOCALE, translator } from '../i18n.js';
import { postAgentPlan } from '../slack/agent-plan.js';
import { BUTTON, frame, membersOf, one, tell } from './go-live.js';
import { appOrigin, emailOf, escapeHtml } from './own-key.js';
import {
  childLine,
  childName,
  headline,
  readPlanSummary,
  tally,
  totalLine,
  whyLine,
} from './plan-summary.js';

/**
 * Telling a person an AEO Operator's summary is in (AEO Operator plan §4.2
 * step 7, 00545): once the agents its approved plan started are done (or 8
 * hours on), the web's sweep keeps the summary on the plan (summarized,
 * summary_json, made by code from the runs' records) and posts it in the
 * Operator's chat, then asks for this. The person the Operator's run acts
 * as (its acting user, else the Operator's owner), when they are a member
 * and reach the plan's brand, gets a notice in their Inbox (kind
 * agent_plan_summary, once per plan: agent_plan_summary:{plan id}), and by
 * their "Notify me when an agent needs me" (chat_user_prefs.notify_via,
 * 00408): an e-mail with "Inbox + email", the brand's Slack channel with
 * "Inbox + Slack" (lib/slack/agent-plan.js; the e-mail where the brand
 * doesn't post it), nothing more with "Inbox only". Through Resend
 * (email.js), a silent no-op where it isn't configured.
 *
 * Its only words not the app's own are the agents' names the person sees
 * (the summary leaves out the others) and the brand's and the Operator's
 * names; never an action's title or a page's content. Never on the sweep's
 * way: the caller logs what fails.
 */

/** Where Approve all is: the Inbox's Needs you. */
const approveAllUrlOf = () => `${appOrigin()}/dashboard/chat/inbox?tab=needsYou`;
const chatUrlOf = (chatId) => `${appOrigin()}/dashboard/chat/${chatId}`;
/** Where the summary is: the Operator's chat, else the Operator. */
const summaryUrlOf = (chatId, agentId) =>
  chatId ? chatUrlOf(chatId) : `${appOrigin()}/dashboard/agents/${agentId}`;

const LINK = 'color:#111827;';

/**
 * The e-mail of an Operator's summary.
 * @param {{ operator: string, brand: string, day: string, agentId: string,
 *   chatId: string|null, summary: NonNullable<ReturnType<typeof readPlanSummary>>,
 *   locale?: string }} input `locale`: the reader's interface language (LOC-008).
 */
export function renderAgentPlanEmail({
  operator,
  brand,
  day,
  agentId,
  chatId,
  summary,
  locale = DEFAULT_LOCALE,
}) {
  const t = translator(locale);
  const head = headline(summary, locale);
  const subject = t('agentPlan.subject', { operator, brand, headline: head });
  const lines = [
    escapeHtml(whyLine(summary, { operator, brand, day }, locale)),
    ...summary.children.map(
      (child) =>
        `<strong>${escapeHtml(childName(child, locale))}</strong> · ${escapeHtml(childLine(child, locale))}${
          child.chatId
            ? ` · <a href="${escapeHtml(chatUrlOf(child.chatId))}" style="${LINK}">${t('agentPlan.openChat')}</a>`
            : ''
        }`,
    ),
  ];
  const total = totalLine(summary, locale);
  if (total) lines.push(escapeHtml(total));
  const { waiting } = tally(summary);
  if (waiting) {
    lines.push(
      `<strong>${t('agentPlan.waitsLabel')}</strong> ${t(
        summary.approveAll ? 'agentPlan.waitsApproveAll' : 'agentPlan.waits',
        { count: waiting },
      )}`,
    );
  }
  const html = frame(
    escapeHtml(subject),
    lines,
    [
      `<a href="${escapeHtml(summaryUrlOf(chatId, agentId))}" style="${BUTTON}">${t('agentPlan.openSummary')}</a>`,
      ...(summary.approveAll
        ? [
            `<a href="${escapeHtml(approveAllUrlOf())}" style="${BUTTON}">${t('agentPlan.approveAll')}</a>`,
          ]
        : []),
    ],
    t('agentPlan.footer'),
  );
  return { subject, html };
}

/**
 * The Inbox notice's payload (≤ 4 KB): the Operator, its chat, the day, and
 * where its agents are, counted. No agent's name.
 */
export function noticePayload({ operator, agentId, planId, chatId, day, summary }) {
  return {
    agent: String(operator).slice(0, 120),
    agentId,
    planId,
    chatId,
    day,
    ...tally(summary),
    approveAll: summary.approveAll,
  };
}

/**
 * A summarized plan's notice, its e-mail or its Slack message, once per
 * plan. What went out: { notices, emails, slack? }; 0 and 0 for a plan not
 * summarized, not the workspace's, or with no one to tell.
 * @param {{ orgId: string, planId: string }} input
 */
export async function tellAgentPlan({ orgId, planId }) {
  const plan = await one(
    supabaseAdmin
      .from('chat_agent_plans')
      .select('id, organization_id, agent_id, run_id, brand_id, plan_day, status, summary_json')
      .eq('id', planId)
      .eq('organization_id', orgId),
  );
  const summary = plan?.status === 'summarized' ? readPlanSummary(plan.summary_json) : null;
  if (!plan || !summary) return { notices: 0, emails: 0 };
  const [agent, run, brand, convo] = await Promise.all([
    one(
      supabaseAdmin
        .from('chat_agents')
        .select('name, owner_id')
        .eq('id', plan.agent_id)
        .eq('organization_id', orgId),
    ),
    one(
      supabaseAdmin
        .from('chat_agent_runs')
        .select('acting_user_id')
        .eq('id', plan.run_id)
        .eq('organization_id', orgId),
    ),
    one(
      supabaseAdmin
        .from('brands')
        .select('id, name, organization_id, is_demo')
        .eq('id', plan.brand_id)
        .eq('organization_id', orgId),
    ),
    one(
      supabaseAdmin
        .from('chat_conversations')
        .select('id')
        .eq('agent_run_id', plan.run_id)
        .eq('organization_id', orgId)
        .limit(1),
    ),
  ]);
  if (!agent || !brand) return { notices: 0, emails: 0 };

  // The person the Operator's run acts as, when they are a member and reach its brand.
  const members = await membersOf(orgId, [run?.acting_user_id ?? agent.owner_id]);
  const readers = await brandReaders(orgId, [plan.brand_id]);
  const people = members.filter((id) => readers.has(id));
  const chatId = convo?.id ?? null;
  const facts = { operator: agent.name, brand: brand.name, day: plan.plan_day, summary };
  return tell({
    orgId,
    people,
    kind: 'agent_plan_summary',
    brandId: plan.brand_id,
    dedupe: `agent_plan_summary:${plan.id}`,
    payload: noticePayload({ ...facts, agentId: plan.agent_id, planId: plan.id, chatId }),
    email: (locale) => renderAgentPlanEmail({ ...facts, agentId: plan.agent_id, chatId, locale }),
    // Inbox + Slack: the brand's channel, mentioning them; the e-mail where it doesn't post.
    slack: (ids) =>
      postAgentPlan(
        {
          brand,
          planId: plan.id,
          operator: agent.name,
          day: plan.plan_day,
          summary,
          chatUrl: summaryUrlOf(chatId, plan.agent_id),
          chatUrlOf,
          approveAllUrl: approveAllUrlOf(),
          people: ids,
        },
        { emailOf },
      ),
  });
}
