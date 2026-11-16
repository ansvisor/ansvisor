import { z } from 'zod';
import supabaseAdmin from '../../config/supabase.js';
import { chatAgenticDeployed } from '../chat-flag.js';
import { postToChatInternal } from '../chat-agents.js';
import { appOrigin } from '../chat-notices/own-key.js';
import logger from '../logger.js';
import { slackGet } from './api.js';
import { decidedMessage, decidedStatus, refusalMessage } from './blocks/approval.js';
import { APPROVE_ACTION, REJECT_ACTION } from './blocks/needs-you.js';
import { brandSlack } from './connection.js';
import { slackAllowed } from './deliver.js';
import { slackSigningSecret } from './signature.js';

/**
 * Approve and Reject from Slack (#2139, N7): a click on the buttons of an
 * "agent needs you" message (needs-you.js), once routes/slack-interactivity.js
 * has checked Slack's signature and answered Slack. Nothing in the payload
 * is trusted alone:
 *
 *   1. The button names our own post (slack_posts), found by its id only as
 *      Slack shows it (its channel and ts), with its workspace, brand, agent
 *      run and person. Anything else is "not found".
 *   2. The brand still uses that post's Slack connection, connected, and
 *      the click came from the Slack workspace it is installed in
 *      (auth.test's team).
 *   3. The plan has Approve from Slack (slack_approvals: Growth and up,
 *      self-host), active.
 *   4. The card is read from the web, limited to that workspace, brand and
 *      agent run: one no longer waiting says how it ended and the message
 *      loses its buttons.
 *   5. Only the person the card waits for decides, as in the app: the Slack
 *      user who clicked must be the one Slack finds for their confirmed
 *      Ansvisor e-mail (users.lookupByEmail, as the mention is found), in
 *      that Slack workspace. No new link is kept.
 *   6. The web decides as the app does (/api/internal/chat/slack/decide:
 *      role, brand access, read-only, the demo brand, one decision).
 *
 * The answer goes back through the click's response_url: the message with
 * who decided and when and no buttons, or a reply only the clicker sees.
 * Logs carry codes, never words. Never throws.
 */

export const ACTION_IDS = new Set([APPROVE_ACTION, REJECT_ACTION]);

const CARD_TIMEOUT_MS = 8_000;
const DECIDE_TIMEOUT_MS = 20_000;
const RESPOND_TIMEOUT_MS = 10_000;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const VALUE = new RegExp(`^(${UUID}):(\\d{1,6}):([0-9a-f]{8,128})$`);
const NEEDS_YOU_KEY = new RegExp(`^needs_you:(${UUID}):(${UUID})$`);
/** Slack's own hooks: a response_url anywhere else is never called. */
const RESPONSE_URL = /^https:\/\/hooks\.slack\.com\/[!-~]+$/;

const payloadSchema = z.object({
  type: z.literal('block_actions'),
  team: z.object({ id: z.string().min(1) }).nullish(),
  user: z.object({ id: z.string().min(1), team_id: z.string().optional() }),
  container: z.object({ channel_id: z.string().optional(), message_ts: z.string().optional() }),
  channel: z.object({ id: z.string() }).nullish(),
  response_url: z.string().max(1000).regex(RESPONSE_URL),
  actions: z
    .array(z.object({ action_id: z.string(), value: z.string().max(300).optional() }))
    .min(1),
});

/** Whether this server takes clicks: Slack's signing secret, and the web's Chat to decide. */
export function slackApprovalsReady() {
  return Boolean(slackSigningSecret() && process.env.CHAT_INTERNAL_SECRET && chatAgenticDeployed());
}

const runUrlOf = (chatId) =>
  chatId ? `${appOrigin()}/dashboard/chat/${chatId}` : `${appOrigin()}/dashboard/chat`;

/**
 * The card an agent run waits on (or, with `n`, the one a message showed),
 * from the web; null when it can't say.
 * @param {{ organizationId: string, brandId: string, agentRunId: string }} ref
 */
export async function slackCard(ref, n, { callWeb = postToChatInternal } = {}) {
  const res = await callWeb('slack/card', n ? { ...ref, n } : ref, { timeoutMs: CARD_TIMEOUT_MS });
  return res?.status === 200 && res.body?.card ? res.body.card : null;
}

/** Answers on the click's response_url (Slack's hooks only); never throws. */
export async function respondToSlack(url, body, { fetchImpl = fetch } = {}) {
  if (!RESPONSE_URL.test(url)) return false;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESPOND_TIMEOUT_MS),
    });
    if (!res.ok) logger.warn({ status: res.status }, '[slack] response_url refused the answer');
    return res.ok;
  } catch (err) {
    logger.warn({ code: err?.name ?? null }, '[slack] response_url did not answer');
    return false;
  }
}

/** The person's Ansvisor e-mail, once confirmed: what their Slack account is found by. */
async function confirmedEmailOf(id) {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(id);
  if (error) throw new Error(error.message);
  const user = data?.user;
  return user?.email && user.email_confirmed_at ? user.email : null;
}

async function one(query, what) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return data;
}

/**
 * The Slack user of the person the card waits for, in the workspace `teamId`:
 * 'not_member' when they left the Ansvisor workspace, null when Slack has no
 * one (or someone else's, or a deactivated or unconfirmed account) for their e-mail.
 */
async function slackUserOf(slack, personId, organizationId, teamId, { get, emailOf }) {
  const member = await one(
    supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', personId)
      .eq('organization_id', organizationId),
    'a member',
  );
  if (!member) return 'not_member';
  const email = await emailOf(personId);
  if (!email) return null;
  let user;
  try {
    ({ user } = await get(slack, 'users.lookupByEmail', { email }));
  } catch (err) {
    if (err?.code === 'users_not_found') return null;
    throw err;
  }
  if (
    typeof user?.id !== 'string' ||
    user.deleted === true ||
    user.is_bot === true ||
    user.is_email_confirmed === false ||
    (user.team_id && user.team_id !== teamId)
  ) {
    return null;
  }
  return user.id;
}

/**
 * Handles one verified click. What became of it, for the log and tests:
 * approved, rejected, decided (already), a refusal's reason, or ignored.
 * @param {unknown} payload Slack's block_actions payload, its signature checked
 */
export async function handleSlackDecision(payload, deps = {}) {
  const {
    get = slackGet,
    callWeb = postToChatInternal,
    respond = respondToSlack,
    emailOf = confirmedEmailOf,
    allowed = slackAllowed,
    now = () => new Date(),
  } = deps;
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return 'ignored';
  const p = parsed.data;
  const action = p.actions[0];
  const decision =
    action.action_id === APPROVE_ACTION
      ? 'approve'
      : action.action_id === REJECT_ACTION
        ? 'reject'
        : null;
  if (!decision) return 'ignored';
  const say = (body) => respond(p.response_url, body);
  const refuse = async (reason, { runUrl = runUrlOf(null), person = null, status } = {}) => {
    await say(refusalMessage(reason, { runUrl, person, status }));
    return reason;
  };

  try {
    const value = VALUE.exec(action.value ?? '');
    if (!value) return await refuse('not_found');
    const [, postId, nText, digest] = value;
    const n = Number(nText);
    const post = await one(
      supabaseAdmin
        .from('slack_posts')
        .select(
          'organization_id, brand_id, account_id, kind, dedupe_key, channel_id, message_ts, status',
        )
        .eq('id', postId),
      'a Slack post',
    );
    const key = NEEDS_YOU_KEY.exec(post?.dedupe_key ?? '');
    if (
      !post ||
      !key ||
      post.kind !== 'needs_you' ||
      post.status !== 'sent' ||
      post.channel_id !== (p.container.channel_id ?? p.channel?.id) ||
      post.message_ts !== p.container.message_ts
    ) {
      return await refuse('not_found');
    }
    const [, agentRunId, personId] = key;
    const brand = await one(
      supabaseAdmin
        .from('brands')
        .select('id, name, organization_id, is_demo')
        .eq('id', post.brand_id)
        .eq('organization_id', post.organization_id),
      'a brand',
    );
    if (!brand || brand.is_demo) return await refuse('not_found');

    const slack = await brandSlack(brand.id);
    if (
      slack?.status !== 'connected' ||
      slack.accountId !== post.account_id ||
      slack.organizationId !== brand.organization_id
    ) {
      return await refuse('connection');
    }
    // The click came from the Slack workspace this connection is installed in.
    const teamId = (await get(slack, 'auth.test'))?.team_id;
    if (!teamId || p.team?.id !== teamId || (p.user.team_id && p.user.team_id !== teamId)) {
      return await refuse('other_workspace');
    }
    if (!(await allowed(brand.organization_id, 'slack_approvals'))) return await refuse('plan');

    const ref = { organizationId: brand.organization_id, brandId: brand.id, agentRunId };
    const card = await slackCard(ref, n, { callWeb });
    if (!card) return await refuse('not_found');
    const runUrl = runUrlOf(card.conversationId);
    const shown = { agent: card.agent, brand: brand.name, runUrl };
    // Decided in Ansvisor, or by an earlier click: the message stops offering buttons.
    const already = async (ended) => {
      const { how = 'closed', at = null, inSlack = false } = ended.decided ?? {};
      const where = inSlack ? 'slack' : how === 'approved' ? 'ansvisor' : null;
      const decided = { how, at, where };
      await say(decidedMessage({ ...shown, card: ended, decided }));
      await refuse('already', { runUrl, status: decidedStatus(ended, decided) });
      return 'decided';
    };
    if (card.state === 'decided') return await already(card);

    // Only the person it waits for decides it, from their own Slack account.
    const person = card.person;
    const slackUser = await slackUserOf(slack, personId, brand.organization_id, teamId, {
      get,
      emailOf,
    });
    if (slackUser === 'not_member') return await refuse('not_member', { runUrl, person });
    if (!slackUser) return await refuse('not_linked', { runUrl, person });
    if (slackUser !== p.user.id) return await refuse('not_yours', { runUrl, person });

    const res = await callWeb(
      'slack/decide',
      { ...ref, userId: personId, decision, n, digest },
      { timeoutMs: DECIDE_TIMEOUT_MS },
    );
    const answer = res?.status === 200 ? res.body?.decision : null;
    if (answer?.outcome === 'approved' || answer?.outcome === 'rejected') {
      const decided = { how: answer.outcome, at: now().toISOString(), where: 'slack' };
      await say(decidedMessage({ ...shown, card: answer.card ?? card, decided }));
      logger.info({ brandId: brand.id, outcome: answer.outcome }, '[slack] card decided');
      return answer.outcome;
    }
    if (answer?.outcome === 'decided' && answer.card) return await already(answer.card);
    if (answer?.outcome === 'refused') return await refuse(answer.reason, { runUrl, person });
    logger.warn({ brandId: brand.id, status: res?.status ?? null }, '[slack] card not decided');
    return await refuse('failed', { runUrl });
  } catch (err) {
    logger.error({ err: { name: err?.name, code: err?.code ?? null } }, '[slack] click failed');
    await refuse('failed').catch(() => {});
    return 'failed';
  }
}
