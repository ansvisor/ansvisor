import supabaseAdmin from '../../config/supabase.js';
import {
  chatProposalSchema,
  findCoveringActions,
  sendChatAction,
} from '../action-center/from-chat.js';
import { pageName, quote } from '../action-center/tasks/concrete.js';
import { logger } from '../logger.js';
import { logAdsActivity } from './activity.js';
import { SNAPSHOT_PERIOD, readOpportunities } from './opportunities.js';
import { NotFound } from './standing.js';

/**
 * The Earn card (ADS-01 §3.2): a prompt's fix as one Action Center action,
 * sent through Chat's Send to Action Center (from-chat.js) with source `ads`,
 * so it is a `chat_finding` like Chat's, with no conversation or run.
 *
 *  - One task, as AC-004 asks: refresh the prompt's target page
 *    (prompt_target_urls) to answer it, or write a new page that does, with
 *    Done when. Templated from the row's standing: no model call.
 *  - An active action that already covers the prompt is answered instead of
 *    a second one (findCoveringActions); the same key again answers what it
 *    made.
 *  - Logged (ads_activity_log); an action the log can't hold is taken back.
 */

/** The prompt's target page, the first one mapped, within the brand and organization; or null. */
async function targetPage(brandId, orgId, promptId) {
  const { data, error } = await supabaseAdmin
    .from('prompt_target_urls')
    .select('url, prompts!inner(prompt_sets!inner(brand_id, brands!inner(organization_id)))')
    .eq('prompt_id', promptId)
    .eq('prompts.prompt_sets.brand_id', brandId)
    .eq('prompts.prompt_sets.brands.organization_id', orgId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`prompt_target_urls: ${error.message}`);
  return data?.[0]?.url ?? null;
}

/**
 * An action as the card names it: its id, its old global number, and its
 * number in its brand once the brand is numbered (00534), so the card shows
 * the code the Action Center shows ("AC-03"; actionCodeNo on the web).
 */
const cardAction = (id, no, brandNo) => ({ id, no, ...(brandNo ? { brandNo } : {}) });

/** The brand's active action that covers the prompt, as { id, no, brandNo? }, or null. */
async function coveringAction(brandId, promptId) {
  const entities = { prompts: [promptId], pages: [], competitors: [], platforms: [] };
  const found = (await findCoveringActions(brandId, entities)).covering[0];
  return found ? cardAction(found.actionId, found.actionNo, found.brandNo) : null;
}

/**
 * The drawer's Earn card: the prompt's target page and the action covering
 * it, if any; an export reads the page alone (`action: false`).
 */
export async function readEarn(brandId, orgId, promptId, { action: covering = true } = {}) {
  const [page, action] = await Promise.all([
    targetPage(brandId, orgId, promptId),
    covering ? coveringAction(brandId, promptId) : null,
  ]);
  return { page, action };
}

/** The fix, as Chat's proposal: one task naming its page, from the row's standing. */
export function earnProposal(row, page) {
  const prompt = quote(row.text);
  const rival = row.reasons.some((r) => r.code === 'rival_leads')
    ? (row.leaderName ?? 'A competitor')
    : null;
  const protect = !rival && (row.weCited || row.leader === 'us');
  const why = rival
    ? `${rival} leads the AI answer to ${prompt}.`
    : protect
      ? `AI picks you for ${prompt}: keep the page that earns it current.`
      : `No one leads the AI answer to ${prompt} yet.`;
  const name = page ? pageName(page) : 'The new page';
  return chatProposalSchema.parse({
    title: `Earn ${prompt} in AI answers`,
    category: rival ? 'compete' : protect ? 'protect' : 'growth',
    impact: row.decision === 'earn_pay' ? 'high' : 'medium',
    why,
    entities: { prompts: [row.promptId], platforms: (row.engines ?? []).slice(0, 8) },
    tasks: [
      {
        ...(page
          ? { title: `Refresh ${name} to answer ${prompt}`, type: 'on_page', url: page }
          : {
              title: `Write a new page that answers ${prompt}`,
              type: 'content',
              where: `A new page on your site for ${prompt}`,
            }),
        why,
        how: [
          `Put a direct, two-sentence answer to ${prompt} at the top`,
          ...(rival ? [`Say plainly how you compare with ${rival}`] : []),
          'Add a short FAQ with the questions buyers ask about it',
          'Publish the change',
        ],
        done_when: `${name} answers ${prompt} in its first paragraph, and it is live.`,
        check: 'manual',
      },
    ],
  });
}

/**
 * Sends the prompt's fix (Admins and Managers, checked by the route), or
 * answers the active action that already covers it (`covered`). A prompt
 * that isn't one of the brand's opportunities reads as not found.
 *
 * @returns {Promise<{ promptId: string, action: { id: string, no: number, brandNo?: number },
 *   created: boolean, covered: boolean }>}
 */
export async function sendEarn({ brand, orgId, promptId, userId, idempotencyKey }) {
  const { rows } = await readOpportunities({ brand, orgId, period: SNAPSHOT_PERIOD });
  const row = rows.find((r) => r.promptId === promptId);
  if (!row) throw new NotFound('Prompt not found');
  const page = await targetPage(brand.id, orgId, promptId);
  let sent;
  try {
    sent = await sendChatAction(brand.id, {
      proposal: earnProposal(row, page),
      userId,
      // Ads' own keys, per prompt: never one of Chat's, nor another prompt's.
      idempotencyKey: `ads:${promptId}:${idempotencyKey}`,
      source: 'ads',
    });
  } catch (err) {
    if (err?.code !== 'duplicate') throw err;
    const { id, no, brandNo } = err.extra.action;
    return { promptId, action: cardAction(id, no, brandNo), created: false, covered: true };
  }
  const action = cardAction(sent.actionId, sent.actionNo, sent.brandNo);
  if (sent.created) {
    try {
      await logAdsActivity({
        orgId,
        brandId: brand.id,
        actor: { userId },
        event: 'earn.sent',
        target: { promptId, actionId: action.id },
        after: { actionNo: action.no, decision: row.decision, page },
      });
    } catch (err) {
      // Nothing changes unlogged: the action goes, with its tasks and History (cascade).
      const undo = await supabaseAdmin
        .from('actions')
        .delete()
        .eq('id', action.id)
        .eq('brand_id', brand.id);
      if (undo.error) logger.error({ err: undo.error.message }, '[ads] earn take-back failed');
      throw err;
    }
  }
  return { promptId, action, created: sent.created, covered: false };
}
