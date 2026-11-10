import { AI_SOURCES } from '../ai-sources.js';

/**
 * The "Ansvisor" property group Ansvisor makes in a brand's HubSpot account
 * on connect (#2140), and its contact properties. Pure: setup.js makes them,
 * the contact stamping fills them (once, first touch) and the pipeline
 * report reads them back. Made only with the person's consent to mark
 * contacts (connection.js).
 *
 * Internal names start with `ansvisor_`, so they never meet a property the
 * customer made (their own `ai_source`). People see the labels.
 *
 * PROPERTIES_VERSION goes up when a definition changes, so setup runs again
 * on a connection made with an older one. The AI source dropdown follows the
 * AI source list (ai-sources.json): a source added there is added as an
 * option, and an option is never removed (contacts may hold it).
 */

export const PROPERTIES_VERSION = 1;

export const GROUP = Object.freeze({ name: 'ansvisor', label: 'Ansvisor', displayOrder: -1 });

/**
 * The AI sources by the name people know them by, keyed as the AI source
 * list keys them (and the web's lib/traffic-platforms.ts names them).
 */
export const SOURCE_LABELS = Object.freeze({
  'chatgpt.com': 'ChatGPT',
  'perplexity.ai': 'Perplexity',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'copilot.microsoft.com': 'Copilot',
  'grok.com': 'Grok',
  'deepseek.com': 'DeepSeek',
  'meta.ai': 'Meta AI',
  'you.com': 'You.com',
  'phind.com': 'Phind',
  'poe.com': 'Poe',
  'labs.google': 'Google Labs',
  'bing.com': 'Bing',
});

/** The AI source dropdown's options: one per source of the list, in its order. */
export function sourceOptions(sources = AI_SOURCES) {
  return sources.map((source, index) => ({
    label: SOURCE_LABELS[source.key] ?? source.key,
    value: source.key,
    displayOrder: index,
    hidden: false,
  }));
}

/** The contact properties, as HubSpot's properties API takes them. */
export function contactProperties(sources = AI_SOURCES) {
  const base = { groupName: GROUP.name, formField: false };
  return [
    {
      ...base,
      name: 'ansvisor_ai_source',
      label: 'AI source',
      description:
        'The AI assistant whose answer first brought this contact to the site, as Ansvisor saw it.',
      type: 'enumeration',
      fieldType: 'select',
      options: sourceOptions(sources),
    },
    {
      ...base,
      name: 'ansvisor_ai_landing_page',
      label: 'AI landing page',
      description: 'The page of that first visit from an AI answer, without its query string.',
      type: 'string',
      fieldType: 'text',
    },
    {
      ...base,
      name: 'ansvisor_ai_first_visit_at',
      label: 'AI first visit',
      description: 'When the contact first came from an AI answer.',
      type: 'datetime',
      fieldType: 'date',
    },
    {
      ...base,
      name: 'ansvisor_ai_converted_at',
      label: 'AI converted',
      description: 'When the contact sent the form or was identified after that visit.',
      type: 'datetime',
      fieldType: 'date',
    },
    {
      ...base,
      name: 'ansvisor_brand',
      label: 'Ansvisor brand',
      description: 'The Ansvisor brand whose site the contact converted on.',
      type: 'string',
      fieldType: 'text',
    },
    {
      ...base,
      name: 'ansvisor_brand_id',
      label: 'Ansvisor brand id',
      description: "The Ansvisor brand's id, for Ansvisor's own report.",
      type: 'string',
      fieldType: 'text',
      hidden: true,
    },
  ];
}

/** The internal names, as the stamping writes and the report reads them. */
export const PROPERTY_NAMES = Object.freeze(contactProperties().map((p) => p.name));

/**
 * The options of `wanted` that `existing` lacks (by value), placed after
 * HubSpot's own: an option is never removed or renamed, contacts may hold it.
 */
export function missingOptions(existing = [], wanted = []) {
  const have = new Set(existing.map((o) => o.value));
  let order = existing.reduce((max, o) => Math.max(max, Number(o.displayOrder) || 0), -1);
  return wanted
    .filter((o) => !have.has(o.value))
    .map((o) => ({ ...o, displayOrder: (order += 1) }));
}
