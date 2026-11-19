/**
 * An AEO Operator's summary as the server words it (AEO Operator plan §4.2
 * step 7): chat_agent_plans.summary_json, which the web's sweep made by code
 * from the runs' own records (web lib/chat/operator/summary.ts), read
 * defensively, and the words the e-mail (chat-notices/agent-plan.js) and
 * the Slack message (slack/blocks/agent-plan.js) share. Its only words not
 * the app's own are the names of the agents the person sees; never an
 * action's title or a page's content. The e-mail passes its reader's
 * interface language (LOC-008); the Slack message, to a channel, is
 * English. Pure.
 */

import { DEFAULT_LOCALE, formatLocale, formatPercentIn, translate } from '../i18n.js';

const STATES = ['done', 'failed', 'stopped', 'waiting', 'working', 'not_started'];
const WHYS = ['done', 'deadline'];
const COUNTS = ['drafts', 'findings', 'tasks', 'shipped'];
/** Agents one plan starts at most (00545's backstop). */
const MAX_CHILDREN = 10;

const STATE_KEYS = {
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  waiting: 'waiting',
  working: 'working',
  not_started: 'notStarted',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOr = (value) => (typeof value === 'string' && UUID.test(value) ? value : null);
const shareOr = (value) => {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};
const countOr = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 10_000 ? n : 0;
};

/**
 * One agent of the summary, or null when it doesn't read.
 * @returns {{ agentId: string|null, name: string|null, hidden: boolean, state: string,
 *   chatId: string|null, share: number|null, used: number|null,
 *   counts: Record<string, number>, approveAll: boolean } | null}
 */
function childOf(raw) {
  if (!raw || typeof raw !== 'object' || !STATES.includes(raw.state)) return null;
  const hidden = raw.hidden === true;
  return {
    agentId: hidden ? null : uuidOr(raw.agent_id),
    name:
      !hidden && typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 120) : null,
    hidden,
    state: raw.state,
    chatId: hidden ? null : uuidOr(raw.chat_id),
    share: shareOr(raw.share),
    used: shareOr(raw.used),
    counts: Object.fromEntries(COUNTS.map((key) => [key, countOr(raw.counts?.[key])])),
    approveAll: !hidden && raw.approve_all === true,
  };
}

/**
 * The plan's summary_json, read defensively: what doesn't read is left out;
 * null when it isn't a summary at all.
 */
export function readPlanSummary(json) {
  if (!json || typeof json !== 'object' || json.v !== 1 || !WHYS.includes(json.why)) return null;
  const children = (Array.isArray(json.children) ? json.children : [])
    .slice(0, MAX_CHILDREN)
    .map(childOf)
    .filter(Boolean);
  const budget = shareOr(json.budget);
  return {
    why: json.why,
    partial: json.partial === true,
    budget,
    used: budget === null ? null : shareOr(json.used),
    children,
    waiting: children.filter((child) => child.state === 'waiting').length,
    approveAll: children.some((child) => child.approveAll),
  };
}

/** How many agents are in each state, and how many in all. */
export function tally(summary) {
  const count = (state) => summary.children.filter((child) => child.state === state).length;
  return {
    total: summary.children.length,
    done: count('done'),
    waiting: count('waiting'),
    failed: count('failed'),
    stopped: count('stopped'),
    working: count('working'),
    notStarted: count('not_started'),
  };
}

/** A share of the monthly AI limit in words: "5%", "1.2%" ("%1,2" in Turkish). */
export const percent = (share, locale = DEFAULT_LOCALE) => formatPercentIn(locale, share * 100);

/** A plan's day in words: "Nov 18". */
export function dayWords(day, locale = DEFAULT_LOCALE) {
  const at = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(at.getTime())
    ? String(day)
    : at.toLocaleDateString(formatLocale(locale), {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
}

/** An agent as the person may see it: its name, "An agent you can't see", or "An agent". */
export const childName = (child, locale = DEFAULT_LOCALE) =>
  child.hidden
    ? translate(locale, 'planSummary.hiddenAgent')
    : (child.name ?? translate(locale, 'planSummary.anAgent'));

/**
 * One agent's line after its name: where it is, what it did, its AI.
 * "Done · 2 drafts saved · 1 Action Center finding · 0.8% of its 1.5%".
 */
export function childLine(child, locale = DEFAULT_LOCALE) {
  const t = (key, values) => translate(locale, `planSummary.${key}`, values);
  const parts = [t(`state.${STATE_KEYS[child.state]}`)];
  if (!child.hidden && child.state !== 'not_started') {
    const work = COUNTS.filter((key) => child.counts[key] > 0).map((key) =>
      t(`count.${key}`, { count: child.counts[key] }),
    );
    parts.push(work.length ? work.join(' · ') : t('noChanges'));
  }
  if (child.used !== null && child.share !== null) {
    parts.push(
      t('usedOf', { used: percent(child.used, locale), share: percent(child.share, locale) }),
    );
  }
  return parts.join(' · ');
}

/** What the plan used of the day's budget; null with no AI limit. */
export function totalLine(summary, locale = DEFAULT_LOCALE) {
  return summary.budget === null || summary.used === null
    ? null
    : translate(locale, 'planSummary.total', {
        used: percent(summary.used, locale),
        budget: percent(summary.budget, locale),
      });
}

/** The headline: "3 of 4 agents done · 1 waits for you", or that none was started. */
export function headline(summary, locale = DEFAULT_LOCALE) {
  const n = tally(summary);
  if (n.total === 0) return translate(locale, 'planSummary.noneStarted');
  const done = translate(locale, 'planSummary.headline', { done: n.done, total: n.total });
  return n.waiting
    ? `${done} · ${translate(locale, 'planSummary.waiting', { count: n.waiting })}`
    : done;
}

/** Why it came now, in a sentence. */
export function whyLine(summary, { operator, brand, day }, locale = DEFAULT_LOCALE) {
  const plan = translate(locale, 'planSummary.plan', {
    operator,
    brand,
    day: dayWords(day, locale),
  });
  if (summary.partial) return translate(locale, 'planSummary.partial', { plan });
  return translate(locale, summary.why === 'done' ? 'planSummary.done' : 'planSummary.deadline', {
    plan,
  });
}
