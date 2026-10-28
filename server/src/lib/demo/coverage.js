/**
 * What the demo brand covers. Every brand-scoped table (one with a
 * `brand_id` column, as the migrations leave it) is either built by a demo
 * module (its `tables`), skipped here with the reason, or pending here with
 * the PR that will build it. coverage.test.js reads the migrations and fails
 * on a table that is in none of these, so a new feature's table can't ship
 * without the demo saying what it shows for it.
 */

/** Tables a demo brand never has rows in, and why. */
export const SKIPPED = {
  cloro_pending_tasks: "Tracking's queue of scraper tasks: a demo brand is never tracked.",
  jobs: 'The tracking and content job queue: no job runs for a demo brand.',
  sent_pulses: 'Pulse e-mails sent: nobody is mailed about a demo brand.',
  pulse_settings:
    'Pulse e-mail settings: a demo brand is never mailed; its settings show the defaults.',
  ai_traffic_digests: 'Weekly AI traffic e-mails sent: never for a demo brand.',
  suggestion_relevance_usage:
    'AI spend on suggestion relevance: nothing is spent for a demo brand.',
  webhook_configs: 'Outgoing webhooks: a demo brand never calls out.',
  prompt_table_views:
    "A person's saved Tracked Prompts columns (00363): the demo brand starts on the default ones.",
  sentiment_overrides:
    "A person's sentiment corrections on Mentions: the demo's answers carry their own.",
};

const WORKFLOWS = 'demo-workflows (PR 2): Action Center, Content, suggestions, reports';
const SITE = 'demo-site (PR 3): Site Audit, AI traffic, integrations, Product Visibility';
const CHAT = 'demo Chat, once Chat ships (the demo shows Chat as Soon until then)';

/** Tables a later demo PR builds; listed so the gap stays visible until then. */
export const PENDING = {
  actions: WORKFLOWS,
  action_candidates: WORKFLOWS,
  action_task_runs: WORKFLOWS,
  signals: WORKFLOWS,
  signal_runs: WORKFLOWS,
  kpi_definitions: WORKFLOWS,
  getting_started: WORKFLOWS,
  getting_started_steps: WORKFLOWS,
  content_opportunities: WORKFLOWS,
  content_drafts: WORKFLOWS,
  content_plan_marks: WORKFLOWS,
  content_author_defaults: WORKFLOWS,
  content_shopping_checks: WORKFLOWS,
  prompt_suggestions: WORKFLOWS,
  prompt_improve_suggestions: WORKFLOWS,
  prompt_clusters: WORKFLOWS,
  prompt_cluster_scopes: WORKFLOWS,
  topic_suggestions: WORKFLOWS,
  reports: WORKFLOWS,

  site_audits: SITE,
  site_pages: SITE,
  site_trust: SITE,
  site_audit_brand_settings: SITE,
  site_audit_page_prefs: SITE,
  brand_facts: SITE,
  brand_fact_pages: SITE,
  ai_traffic_logs: SITE,
  ai_traffic_events: SITE,
  ai_bot_connections: SITE,
  ai_bot_daily: SITE,
  ai_bot_events: SITE,
  ga_ai_traffic_stats: SITE,
  ga_channel_stats: SITE,
  ga_item_stats: SITE,
  ga_page_stats: SITE,
  gsc_page_stats: SITE,
  gsc_query_stats: SITE,
  page_opportunities: SITE,
  brand_cms_connections: SITE,
  content_draft_deliveries: SITE,
  catalog_sources: SITE,
  catalog_products: SITE,
  catalog_variants: SITE,
  catalog_images: SITE,
  catalog_categories: SITE,
  catalog_product_categories: SITE,
  catalog_category_pages: SITE,
  catalog_item_issues: SITE,

  agent_conversations: CHAT,
  prompt_demand:
    "demo follow-up (PR 7): each demo prompt's demand level (PROMPT-014, 00370); the nightly read never runs for a demo brand",
};

const name = (raw) =>
  raw
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();

/** The text of a parenthesized list starting at `open` (the index of its "("). */
function balanced(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  return sql.slice(open + 1);
}

const BRAND_ID_COLUMN = /(^|[\s,(])"?brand_id"?\s+/i;

/**
 * The tables with a `brand_id` column once the given migrations have run,
 * in order: created with one, given one (`add column brand_id`), losing it,
 * renamed or dropped.
 *
 * @param {string[]} migrations - each migration's SQL, in order
 * @returns {Set<string>}
 */
export function brandScopedTables(migrations) {
  const tables = new Map();
  const statement =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([^;]*);|drop\s+table\s+(?:if\s+exists\s+)?([\w.",\s]+?)\s*(?:cascade|restrict)?\s*;/gi;
  for (const migration of migrations) {
    const sql = migration.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of sql.matchAll(statement)) {
      if (m[1]) {
        tables.set(name(m[1]), BRAND_ID_COLUMN.test(balanced(sql, m.index + m[0].length - 1)));
      } else if (m[2]) {
        const table = name(m[2]);
        const rename = m[3].match(/^rename\s+to\s+([\w."]+)/i);
        if (rename) {
          const had = tables.get(table);
          tables.delete(table);
          tables.set(name(rename[1]), had);
        } else if (/add\s+column\s+(?:if\s+not\s+exists\s+)?"?brand_id"?\s/i.test(m[3])) {
          tables.set(table, true);
        } else if (/drop\s+column\s+(?:if\s+exists\s+)?"?brand_id"?/i.test(m[3])) {
          tables.set(table, false);
        }
      } else if (m[4]) {
        for (const table of m[4].split(',')) tables.delete(name(table.trim()));
      }
    }
  }
  return new Set([...tables].filter(([, hasBrandId]) => hasBrandId).map(([table]) => table));
}
