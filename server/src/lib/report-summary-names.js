/**
 * The report snapshot as the summary model reads it (RP-05): every engine,
 * model and AI referrer by its display name, never by a raw id such as
 * `gemini-web`, which the model would otherwise copy into the summary. The
 * saved report keeps its ids; only the copy sent to the model is renamed.
 */
import { createRequire } from 'module';
import { ENGINE_NAMES, engineName } from '../config/engine-names.js';

const require = createRequire(import.meta.url);
// The AI Traffic page's names for referrers ("chatgpt.com" → "ChatGPT").
const REFERRER_NAMES = require('./traffic-digest/platform-names.json');

// An API model's answers are stored under its engine's API platform, as the
// tracking worker's resolveModelPlatform files them.
const MODEL_PLATFORMS = [
  ['claude-', 'claude'],
  ['gemini-', 'gemini'],
  ['gpt-', 'chatgpt'],
];

/** An engine id or an API model id by the engine's display name; anything else as it is. */
export function engineOrModelName(id) {
  if (typeof id !== 'string' || !id) return id;
  if (Object.hasOwn(ENGINE_NAMES, id)) return ENGINE_NAMES[id];
  const model = MODEL_PLATFORMS.find(([prefix]) => id.startsWith(prefix));
  return model ? engineName(model[1]) : id;
}

/** An AI referrer by the name AI Traffic shows; an unknown one as it is. */
export function referrerName(id) {
  return typeof id === 'string' && Object.hasOwn(REFERRER_NAMES, id) ? REFERRER_NAMES[id] : id;
}

/** Each row of a list with one field renamed; anything that isn't a list as it is. */
function renameIn(rows, field, name) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) =>
    row && typeof row === 'object' && field in row ? { ...row, [field]: name(row[field]) } : row,
  );
}

/** A copy of the snapshot with its engines and referrers named; the snapshot itself is left alone. */
export function namedSnapshot(snapshot) {
  const named = { ...snapshot };
  if (named.insights && typeof named.insights === 'object') {
    named.insights = {
      ...named.insights,
      platformBreakdown: renameIn(named.insights.platformBreakdown, 'platform', engineOrModelName),
    };
  }
  named.mentionEvidence = renameIn(named.mentionEvidence, 'platform', engineOrModelName);
  if (Array.isArray(named.queryFanout)) {
    named.queryFanout = named.queryFanout.map((q) =>
      q && Array.isArray(q.engines) ? { ...q, engines: q.engines.map(engineOrModelName) } : q,
    );
  }
  named.queryFanoutEngines = renameIn(named.queryFanoutEngines, 'engine', engineOrModelName);
  if (named.aiTraffic && typeof named.aiTraffic === 'object') {
    named.aiTraffic = {
      ...named.aiTraffic,
      platformBreakdown: renameIn(named.aiTraffic.platformBreakdown, 'platform', referrerName),
    };
  }
  if (named.aiPipeline && typeof named.aiPipeline === 'object') {
    named.aiPipeline = {
      ...named.aiPipeline,
      byEngine: renameIn(named.aiPipeline.byEngine, 'source', referrerName),
    };
  }
  return named;
}
