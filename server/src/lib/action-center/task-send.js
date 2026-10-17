/**
 * Sending an Action Center task onward (AC-004): to Content as an
 * opportunity, or to the brand's webhook.
 *
 * Send to Content takes a content task — where, why, how, done when — into
 * Content Optimization, where a brief and a draft can be written for it. The
 * opportunity is the task's, not a generation: it uses none of the monthly
 * opportunity quota, and it points back at its action, so Content offers
 * "Open in Actions" rather than a second action for the same work.
 *
 * Send to webhook posts the task to the brand's active webhooks, in the shape
 * Content's opportunity.sent uses, for a workflow outside Ansvisor to pick up.
 *
 * Either way the task records where it went (details.sent), the action's
 * History says so, and a task that has been sent survives "Regenerate tasks".
 */

import supabaseAdmin from '../../config/supabase.js';
import { logger } from '../logger.js';
import { dispatchBrandWebhook } from '../webhook-dispatch.js';
import { ownDomainMatcher } from '../response-parser.js';
import { OPPORTUNITY_ACTION_KIND } from './from-opportunity.js';

export class TaskSendError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** The dashboard's origin, for links in what a webhook receives. */
function appOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** A task and its action, with what sending needs to know about them. */
export async function loadTask(taskId) {
  const { data: task, error } = await supabaseAdmin
    .from('action_tasks')
    .select('id, action_id, task_key, title, status, details')
    .eq('id', taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!task) throw new TaskSendError('not_found', 'Task not found', 404);
  const { data: action, error: actionError } = await supabaseAdmin
    .from('actions')
    .select(
      'id, action_no, brand_id, kind, category, impact, status, priority_score, priority_level',
    )
    .eq('id', task.action_id)
    .single();
  if (actionError) throw new Error(actionError.message);
  return { task, action };
}

/**
 * The brand's page a task's Where names, as a URL: "acme.example/pricing ·
 * lost on ChatGPT" gives https://acme.example/pricing, and a bare path is on
 * the brand's first domain. Null when Where names no page of the brand's.
 */
export function ownPageOf(where, brandDomains) {
  const isOwn = ownDomainMatcher(brandDomains);
  for (const token of text(where).split(/[\s·,;()]+/)) {
    const cleaned = token.replace(/^["'“”]+|["'“”.]+$/g, '');
    if (!cleaned) continue;
    if (cleaned.startsWith('/') && cleaned.length > 1 && brandDomains[0]) {
      const domain = String(brandDomains[0])
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');
      return `https://${domain}${cleaned}`;
    }
    if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(cleaned)) {
      const url = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
      if (isOwn(url)) return url;
    }
  }
  return null;
}

/**
 * The opportunity a content task becomes. Its one asset is the page to work
 * on, or a new page when Where names none of the brand's; the asset carries
 * every field Content reads, `pages` included.
 */
export function opportunityFromTask({ task, title, action, brandDomains }) {
  const d = task.details ?? {};
  const page = ownPageOf(d.where, brandDomains);
  const decision = page ? 'optimize' : 'create';
  const targetPages = page ? [{ url: page, title: '' }] : [];
  return {
    brand_id: action.brand_id,
    prompt_id: null,
    title,
    description: text(d.why) || null,
    type: 'owned',
    impact: action.impact,
    opportunity_score: action.priority_score ?? 0,
    status: 'new',
    source: 'action',
    decision,
    source_data: {
      targetPages,
      assets: [
        { key: 'a1', type: 'blog_post', channel: 'owned', decision, title, pages: targetPages },
      ],
      // Content's "Open in Actions": the action the task came from.
      actions: { all: action.id },
      fromAction: {
        actionId: action.id,
        actionNo: action.action_no,
        taskId: task.id,
        task: {
          where: text(d.where),
          why: text(d.why),
          how: Array.isArray(d.how) ? d.how.map(text).filter(Boolean) : [],
          doneWhen: text(d.doneWhen),
          effort: text(d.effort),
          role: text(d.role),
        },
      },
    },
  };
}

/**
 * Record where the task went, merged into what it carries as it is now: a
 * send can take seconds (a webhook), and an edit saved meanwhile must not be
 * written over. Guarded on updated_at, and read again when it moved.
 */
async function markSent(taskId, to, value) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: row, error } = await supabaseAdmin
      .from('action_tasks')
      .select('details, updated_at')
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return;
    const details = { ...(row.details ?? {}) };
    details.sent = { ...(details.sent ?? {}), [to]: value };
    const { data: saved, error: saveError } = await supabaseAdmin
      .from('action_tasks')
      .update({ details, updated_at: new Date().toISOString() })
      .eq('id', taskId)
      .eq('updated_at', row.updated_at)
      .select('id');
    if (saveError) throw new Error(saveError.message);
    if (saved?.length) return;
  }
  throw new Error('The task kept changing; the send was not recorded on it.');
}

/** The open opportunity a task was sent as, if any (00151 keeps it to one). */
async function openOpportunityFor(taskId) {
  const { data, error } = await supabaseAdmin
    .from('content_opportunities')
    .select('id')
    .eq('source', 'action')
    .eq('source_data->fromAction->>taskId', taskId)
    .neq('status', 'archived')
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}

/** The brand's domains, the primary one first: a bare path is on it. */
async function brandDomainsOf(brandId) {
  const { data } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary')
    .eq('brand_id', brandId);
  return [...(data ?? [])]
    .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)))
    .map((d) => d.domain);
}

async function logSent(action, task, to, title, userId) {
  const { error } = await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'task_sent',
    data: { taskId: task.id, to, title },
    actor_id: userId,
  });
  if (error) logger.warn({ err: error, taskId: task.id }, '[task-send] event insert failed');
}

/**
 * Send a content task to Content as an opportunity. Sending it again returns
 * the opportunity it already made, while that one is open; two sends at once
 * make one (a unique index, 00151).
 *
 * @param {{ taskId: string, title: string, userId: string | null,
 *   loaded?: { task: object, action: object } }} input
 *   `title` is the task's text as the dashboard shows it: a library task's
 *   text is a template only the dashboard renders. `loaded` saves reading
 *   the task again when the caller already has.
 * @returns {Promise<{ opportunityId: string, created: boolean }>}
 */
export async function sendTaskToContent({ taskId, title, userId, loaded }) {
  const { task, action } = loaded ?? (await loadTask(taskId));
  if (action.kind === OPPORTUNITY_ACTION_KIND) {
    throw new TaskSendError('from_content', 'This action was sent from Content.');
  }
  if (task.details?.type !== 'content') {
    throw new TaskSendError('not_content', 'Only a content task can be sent to Content.');
  }
  const name = text(task.title) || text(title);
  if (!name) throw new TaskSendError('no_title', 'The task has no text to send.');

  // Already in Content: say so, and make sure the task says so too (a send
  // whose record failed is finished here rather than made twice).
  const already = await openOpportunityFor(task.id);
  if (already) {
    if (task.details?.sent?.content?.opportunityId !== already) {
      await markSent(task.id, 'content', { opportunityId: already, at: new Date().toISOString() });
    }
    return { opportunityId: already, created: false };
  }

  const row = opportunityFromTask({
    task,
    title: name.slice(0, 200),
    action,
    brandDomains: await brandDomainsOf(action.brand_id),
  });
  const { data: created, error } = await supabaseAdmin
    .from('content_opportunities')
    .insert(row)
    .select('id')
    .single();
  if (error?.code === '23505') {
    // Another send got there first.
    const winner = await openOpportunityFor(task.id);
    if (winner) {
      await markSent(task.id, 'content', { opportunityId: winner, at: new Date().toISOString() });
      return { opportunityId: winner, created: false };
    }
  }
  if (error) throw new Error(error.message);

  await markSent(task.id, 'content', { opportunityId: created.id, at: new Date().toISOString() });
  await logSent(action, task, 'content', name, userId);
  return { opportunityId: created.id, created: true };
}

/**
 * Post a task to the brand's active webhooks as `action_task.sent`.
 *
 * @returns {Promise<{ delivered: number, failed: number }>}
 */
export async function sendTaskToWebhook({ taskId, title, userId, loaded }) {
  const { task, action } = loaded ?? (await loadTask(taskId));
  const name = text(task.title) || text(title);
  if (!name) throw new TaskSendError('no_title', 'The task has no text to send.');

  const [{ data: brand }, { data: domains }] = await Promise.all([
    supabaseAdmin.from('brands').select('name, industry').eq('id', action.brand_id).single(),
    supabaseAdmin
      .from('brand_domains')
      .select('domain, is_primary')
      .eq('brand_id', action.brand_id),
  ]);
  const primary = (domains ?? []).find((d) => d.is_primary) ?? (domains ?? [])[0];
  const d = task.details ?? {};

  const { sent, failed } = await dispatchBrandWebhook(action.brand_id, {
    event: 'action_task.sent',
    task: {
      id: task.id,
      title: name,
      status: task.status,
      type: d.type ?? null,
      where: text(d.where) || null,
      why: text(d.why) || null,
      how: Array.isArray(d.how) ? d.how : [],
      done_when: text(d.doneWhen) || null,
      effort: text(d.effort) || null,
      role: text(d.role) || null,
    },
    action: {
      id: action.id,
      action_no: action.action_no,
      kind: action.kind,
      category: action.category,
      impact: action.impact,
      priority_score: action.priority_score,
      priority_level: action.priority_level,
      link: `${appOrigin()}/dashboard/action-center/actions?action=${action.id}`,
    },
    brand: {
      name: brand?.name ?? null,
      domain: primary?.domain ?? null,
      industry: brand?.industry ?? null,
    },
  });

  if (sent + failed === 0) {
    throw new TaskSendError('no_webhook', 'This brand has no active webhook.', 409);
  }
  if (sent === 0) {
    throw new TaskSendError('webhook_failed', "The webhook didn't accept the task.", 502);
  }
  await markSent(task.id, 'webhook', { at: new Date().toISOString(), delivered: sent, failed });
  await logSent(action, task, 'webhook', name, userId);
  return { delivered: sent, failed };
}
