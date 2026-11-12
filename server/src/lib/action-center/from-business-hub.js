/**
 * ChatGPT Business Hub (Businesses in ChatGPT), behind BUSINESS_HUB_ENABLED:
 * the action that asks a brand to set up its Business Hub profile, raised
 * once per brand by the nightly signal pass (signals/pass.js).
 *
 * Business Hub is OpenAI's free place for a business to claim its profile in
 * ChatGPT, correct the facts ChatGPT shows, connect a product feed and, in
 * the US, turn on a Business Agent. There is no API, so the tasks are worked
 * by hand: each says why, how and when it is done, links to Business Hub,
 * and is checked by the person (`check: 'manual'`). Its outcome isn't
 * measured (no KPI): nothing says claiming a profile moves a brand in
 * answers.
 *
 * Raised when the brand has a website (Business Hub needs one) and ChatGPT
 * is tracked (answers on `chatgpt-web` in the last EVIDENCE_DAYS, which also
 * give it its evidence), never for a demo brand, and never again once the
 * brand had one in any status: a dismissed or completed one stays closed.
 * It takes one of the day's new actions (config/action-engine.js
 * maxNewActionsPerDay); with none left it waits for the next night.
 *
 * Where claiming is open (BUSINESS_HUB_OPEN_REGIONS, the US by default) it
 * has medium impact; elsewhere, Turkey included, low impact, a first task
 * that says to join the waitlist, and no Business Agent task.
 *
 * Every Business Hub name, step and address here is still to be confirmed
 * by a person with Business Hub access: the addresses live in
 * business-hub/links.js, the words below.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/action-engine.js';
import { businessHubEnabled, openRegions } from '../business-hub/flag.js';
import { BUSINESS_HUB_URL, OPENAI_FEED_SPEC_URL } from '../business-hub/links.js';
import { siteTypeOf } from '../content-page-types.js';
import { priorityOnCreate } from './priority-data.js';

export const BUSINESS_HUB_SETUP_KIND = 'business_hub_setup';
/** The `source` its payload, tasks and History lines carry. */
export const BUSINESS_HUB_SOURCE = 'business_hub';
/** ChatGPT, as tracking stores it. */
export const CHATGPT_PLATFORM = 'chatgpt-web';
/** The window ChatGPT's answers are counted over: tracked, and its evidence. */
export const EVIDENCE_DAYS = 30;

const DAY_MS = 86_400_000;
const ACTIVE = ['new', 'in_progress', 'on_hold'];
const OPEN_TASKS = ['todo', 'in_progress'];
/** Where the numbers are entered: Visibility's card, its dialog open. */
export const NUMBERS_PATH = '/dashboard/insights?businessHub=enter';
/** Where every task is done. */
const WHERE = 'ChatGPT Business Hub';
/** A brand's name, or its domain, in a task's text. */
const NAME_CHARS = 80;

/** One per brand, ever: a closed one is never raised again. */
export function businessHubSetupDedupKey(brandId) {
  return `${BUSINESS_HUB_SETUP_KIND}:${brandId}`;
}

const short = (text) => (text.length > NAME_CHARS ? `${text.slice(0, NAME_CHARS - 1)}…` : text);
const nameOf = (brandName) => short(String(brandName ?? '').trim() || 'your business');

const task = (step, title, details) => ({
  title,
  details: {
    source: BUSINESS_HUB_SOURCE,
    step,
    url: BUSINESS_HUB_URL,
    where: WHERE,
    check: 'manual',
    ...details,
  },
});

/**
 * The setup action's tasks, in order: claim, verify, correct the facts,
 * the product feed (an online shop only), the Business Agent (open
 * regions only) and the first numbers, entered in Visibility. English, as the drawer, Chat, exports and MCP read them.
 * A brand that already sends OpenAI a direct feed (`directFeed`) gets the
 * feed task as completed.
 *
 * @param {{ brandName?: string|null, domain?: string|null, region?: string|null,
 *   open: boolean, ecommerce: boolean, directFeed?: boolean }} brand
 * @returns {Array<{ title: string, details: object, status: 'todo'|'completed' }>}
 */
export function businessHubSetupTasks({ brandName, domain, open, ecommerce, directFeed = false }) {
  const name = nameOf(brandName);
  const site = short(String(domain ?? '').trim() || 'your website');
  const tasks = [
    task(
      'claim',
      open ? 'Claim your business in ChatGPT Business Hub' : 'Join ChatGPT Business Hub',
      {
        why: `ChatGPT describes ${name} in its answers. Business Hub is OpenAI's free place to claim that profile and correct what it says. Claiming it doesn't move you up in answers by itself.`,
        how: [
          ...(open
            ? []
            : [
                "If Business Hub says it isn't open in your country yet, join the waitlist and mark this task done.",
              ]),
          "Open Business Hub, or Business Hub in ChatGPT's sidebar, and sign in with the ChatGPT account your team will manage the profile with.",
          `Find ${name} by its name or ${site} and claim it. If it isn't listed, add it with your website.`,
          'Keep that sign-in where your team can reach it: each business is managed on its own.',
        ],
        doneWhen: open
          ? `Business Hub lists ${name} as your business, waiting for verification or verified.`
          : `Business Hub lists ${name} as your business, or you joined its waitlist.`,
        type: 'technical',
        effort: '~10m',
        role: 'Marketing lead',
      },
    ),
    task('verify', `Verify that ${name} is yours`, {
      why: 'Business Hub checks that the business is yours before your changes go live. It may also ask for an ID check (Persona) before you can publish changes or see its Insights.',
      how: [
        'In Business Hub, pick how to verify. It may offer your website domain (DNS), a business phone, a business email or Shopify.',
        `The domain is the surest: add the DNS record Business Hub gives you for ${site} at your domain host, then confirm it in Business Hub.`,
        'When Business Hub asks, complete the ID check with Persona.',
      ],
      doneWhen: 'Business Hub shows your business as verified, with the blue check.',
      type: 'technical',
      effort: '~30m',
      role: 'Web developer',
    }),
    task('facts', 'Correct your business facts in Business Hub', {
      why: `ChatGPT answers about ${name} from what it finds. The profile is where you state the facts yourself. OpenAI may still fill in or replace a field from other sources, so your site should say the same.`,
      how: [
        'To see what ChatGPT gets wrong first, use Check what ChatGPT says on this action (the ChatGPT profile check, /chatgpt-profile in Chat): it lists each wrong or missing fact and writes your corrections, asking you for what nothing confirms.',
        'In Business Hub, open your profile and check each field it shows, such as name, category, address or service area, hours, contact details, products and services.',
        'Fix any field that is wrong or empty, using the facts as your own site states them.',
        'Where your site says something else, correct the site too, so both agree.',
        'Publish the changes.',
      ],
      doneWhen:
        'Every profile field matches your site, and Business Hub shows the changes as published.',
      type: 'content',
      effort: '~30m',
      role: 'Marketing lead',
    }),
  ];
  if (ecommerce) {
    tasks.push(
      task('feed', 'Connect your product feed in Business Hub', {
        why: "A product feed gives ChatGPT your products with current prices and stock. It doesn't guarantee ChatGPT will recommend them.",
        how: [
          'In Business Hub, open the product feed section.',
          `On Shopify, connect your store if Business Hub offers it. Otherwise upload a CSV or a hosted file in OpenAI's product feed format: ${OPENAI_FEED_SPEC_URL}`,
          'Check the feed status in Business Hub and fix any product it refuses.',
          'In Product Visibility, turn on We send OpenAI a direct product feed (admins and managers can).',
        ],
        doneWhen: 'Business Hub shows the feed as connected, with no products refused.',
        type: 'product',
        effort: '~1h',
        role: 'E-commerce manager',
      }),
    );
  }
  if (open) {
    tasks.push(
      task('agent', 'Turn on your Business Agent (optional)', {
        why: `In the US, Business Hub can run an agent for ${name} in ChatGPT that answers from your products, services and policies. OpenAI builds it. Skip this task if Business Hub doesn't offer it.`,
        how: [
          "In Business Hub, open Business Agent. If it isn't there, skip this task.",
          'Check the products, services and policies it answers from, and add your returns, shipping and warranty policies.',
          'Turn the agent on.',
        ],
        doneWhen:
          "Business Hub shows your agent as live, or you skipped this task because it isn't offered.",
        type: 'product',
        effort: '~30m',
        role: 'Marketing lead',
      }),
    );
  }
  // Last: the numbers Business Hub shows, once the profile is there.
  // Checked automatically: the first save completes it (completeFirstNumbersTask).
  tasks.push(
    task('numbers', 'Enter your first Business Hub numbers', {
      url: NUMBERS_PATH,
      where: 'Visibility › Overview',
      why: 'Business Hub shows only the last 7 or 28 days and has no export. Entered in Ansvisor, its numbers are kept week by week, beside what Ansvisor measures in ChatGPT for the same days.',
      how: [
        'In Business Hub, open Insights and pick 7 days.',
        'In Visibility, choose Enter numbers on the ChatGPT Business Hub card.',
        "Copy Mentions, Website clicks, Profile views and the top discovery topics, and save. Leave a number empty if Business Hub doesn't show it.",
      ],
      doneWhen: 'Your first entry is saved. Checked automatically when it is.',
      check: 'auto',
      type: 'technical',
      effort: '~10m',
      role: 'Marketing lead',
    }),
  );
  return tasks.map((t) => ({
    ...t,
    status: t.details.step === 'feed' && directFeed ? 'completed' : 'todo',
  }));
}

/**
 * Completes the setup action's Enter your first Business Hub numbers task
 * once the brand's numbers are saved (business-hub/snapshots.js
 * afterBusinessHubSave), as checked automatically: its card's last check
 * and a task_checked line in its History, as the shopping check's
 * (from-shopping-check.js). The action itself stays as it is: the person
 * closes it, as any action. Returns whether a task was completed.
 *
 * @param {string} brandId
 * @param {{ db?: object, now?: Date }} [opts]
 */
export async function completeFirstNumbersTask(
  brandId,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const { data: actions, error } = await db
    .from('actions')
    .select('id, status')
    .eq('brand_id', brandId)
    .eq('dedup_key', businessHubSetupDedupKey(brandId))
    .in('status', ACTIVE)
    .limit(1);
  if (error) throw new Error(`actions read: ${error.message}`);
  const action = actions?.[0];
  if (!action) return false;

  const { data: tasks, error: tasksErr } = await db
    .from('action_tasks')
    .select('id, title, status, details')
    .eq('action_id', action.id)
    .in('status', OPEN_TASKS);
  if (tasksErr) throw new Error(`action_tasks read: ${tasksErr.message}`);
  const own = (tasks ?? []).filter(
    (t) => t.details?.source === BUSINESS_HUB_SOURCE && t.details?.step === 'numbers',
  );
  const at = now.toISOString();
  let completed = 0;
  for (const t of own) {
    const autoCheck = { at, triedAt: at, passed: true, missing: [] };
    const { data: changed, error: taskErr } = await db
      .from('action_tasks')
      .update({
        status: 'completed',
        skip_reason: null,
        details: { ...t.details, autoCheck },
        updated_at: at,
      })
      .eq('id', t.id)
      .eq('status', t.status)
      .select('id');
    if (taskErr) throw new Error(`action_tasks write: ${taskErr.message}`);
    if (!changed?.length) continue;
    completed += 1;
    // Best effort, as the drawer's: a missing History line doesn't undo the change.
    await db.from('action_events').insert({
      action_id: action.id,
      event: 'task_checked',
      data: { taskId: t.id, task: null, title: t.title ?? null },
      actor_id: null,
    });
  }
  // The action moves up its list.
  if (completed) await db.from('actions').update({ updated_at: at }).eq('id', action.id);
  return completed > 0;
}

/**
 * Whether the brand's region can claim a profile now, as
 * BUSINESS_HUB_OPEN_REGIONS lists them. A brand with no region is the
 * column's default, the US.
 */
export function isOpenRegion(region, env = process.env) {
  const code =
    String(region ?? '')
      .trim()
      .toUpperCase() || 'US';
  return openRegions(env).includes(code);
}

/** Its actions so far, in any status: one is enough to never raise it again. */
async function hadAction(db, brandId) {
  const { data, error } = await db
    .from('actions')
    .select('id')
    .eq('brand_id', brandId)
    .eq('dedup_key', businessHubSetupDedupKey(brandId))
    .limit(1);
  if (error) throw new Error(`actions read: ${error.message}`);
  return (data ?? []).length > 0;
}

/** ChatGPT's tracked answers since `since`: all, naming the brand, citing its site. */
async function chatgptAnswers(db, brandId, since) {
  const count = async (column) => {
    let query = db
      .from('prompt_results')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('platform', CHATGPT_PLATFORM)
      .gte('created_at', since);
    if (column) query = query.gt(column, 0);
    const { count: n, error } = await query;
    if (error) throw new Error(`prompt_results read: ${error.message}`);
    return n ?? 0;
  };
  const answers = await count(null);
  if (!answers) return { answers: 0, named: 0, cited: 0 };
  const [named, cited] = await Promise.all([count('mention_count'), count('citation_count')]);
  return { answers, named, cited };
}

/** The brand's new actions since midnight UTC, as the generator counts them (generate.js). */
async function actionsToday(db, brandId, now) {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const { count, error } = await db
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .gte('created_at', dayStart);
  if (error) throw new Error(`actions read: ${error.message}`);
  return count ?? 0;
}

/**
 * Raises the brand's setup action when it qualifies. Returns 'opened',
 * 'exists' (it had one, in any status, or a pass beside this one just
 * opened it), 'ineligible' (the flag is off, a demo brand, no website, or
 * no ChatGPT answers in EVIDENCE_DAYS) or 'held' (the day's new actions
 * are spent: `open` is false, or the brand's count for today says so).
 *
 * @param {string} brandId
 * @param {{ db?: object, now?: Date, open?: boolean, env?: NodeJS.ProcessEnv }} [opts]
 */
export async function syncBusinessHubSetupAction(
  brandId,
  { db = supabaseAdmin, now = new Date(), open = true, env = process.env } = {},
) {
  if (!businessHubEnabled(env)) return 'ineligible';
  // Cheapest first: once raised, a brand costs this one read a night.
  if (await hadAction(db, brandId)) return 'exists';

  const { data: brand, error: brandErr } = await db
    .from('brands')
    .select(
      'name, region, site_type, industry, shopping_mode_enabled, is_demo, openai_product_feed',
    )
    .eq('id', brandId)
    .maybeSingle();
  if (brandErr) throw new Error(`brands read: ${brandErr.message}`);
  if (!brand || brand.is_demo) return 'ineligible';

  const { data: domains, error: domainErr } = await db
    .from('brand_domains')
    .select('domain, is_primary')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .limit(1);
  if (domainErr) throw new Error(`brand_domains read: ${domainErr.message}`);
  const domain = domains?.[0]?.domain ?? null;
  if (!domain) return 'ineligible';

  const since = new Date(now.getTime() - EVIDENCE_DAYS * DAY_MS).toISOString();
  const evidence = await chatgptAnswers(db, brandId, since);
  if (!evidence.answers) return 'ineligible';

  if (!open) return 'held';
  if ((await actionsToday(db, brandId, now)) >= resolve().noise.maxNewActionsPerDay) return 'held';

  const openRegion = isOpenRegion(brand.region, env);
  const region =
    String(brand.region ?? '')
      .trim()
      .toUpperCase() || 'US';
  const ecommerce =
    siteTypeOf({
      siteType: brand.site_type,
      industry: brand.industry,
      shoppingModeEnabled: brand.shopping_mode_enabled,
    }) === 'ecommerce';
  const payload = {
    source: BUSINESS_HUB_SOURCE,
    variant: openRegion ? 'open' : 'waitlist',
    region,
    domain,
    evidence: { ...evidence, since },
    targetEntity: 'platforms',
    targetCount: 1,
    targets: [{ id: CHATGPT_PLATFORM, label: 'ChatGPT' }],
  };
  const category = 'growth';
  const impact = openRegion ? 'medium' : 'low';
  const nowIso = now.toISOString();
  const { data: action, error } = await db
    .from('actions')
    .insert({
      brand_id: brandId,
      category,
      kind: BUSINESS_HUB_SETUP_KIND,
      definition_version: 1,
      impact,
      status: 'new',
      payload,
      kpi_keys: [],
      baseline: { capturedAt: nowIso, ...evidence },
      dedup_key: businessHubSetupDedupKey(brandId),
      // Its tasks are complete as written: the task writer leaves them be.
      tasks_generated_at: nowIso,
      ...(await priorityOnCreate(
        { brand_id: brandId, kind: BUSINESS_HUB_SETUP_KIND, category, impact, payload },
        now,
      )),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // A pass beside this one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') return 'exists';
    throw new Error(`actions write: ${error.message}`);
  }

  const tasks = businessHubSetupTasks({
    brandName: brand.name,
    domain,
    region,
    open: openRegion,
    ecommerce,
    directFeed: brand.openai_product_feed === true,
  });
  const { error: taskErr } = await db.from('action_tasks').insert(
    tasks.map((t, i) => ({
      action_id: action.id,
      position: i + 1,
      title: t.title,
      details: t.details,
      status: t.status,
    })),
  );
  if (taskErr) throw new Error(`action_tasks write: ${taskErr.message}`);

  await db.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: null,
    data: { source: BUSINESS_HUB_SOURCE, variant: payload.variant, taskCount: tasks.length },
  });
  return 'opened';
}
