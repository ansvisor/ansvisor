/**
 * Record the Content Agent's own answers on the no-fabrication test set
 * (src/lib/__fixtures__/no-fabrication/cases.js, Quality spec §9), for
 * no-fabrication.test.js to read: every figure that survives the guards
 * must be in what the agent was given.
 *
 * Run from server/, with .env holding the content model's provider key (the
 * model is IMPROVE_SUGGESTION_MODEL, else DEFAULT_SUGGESTION_MODEL, else
 * google/gemini-3-flash-preview) and the Supabase keys the agent's modules
 * load with (nothing is read or written there):
 *   node src/scripts/eval-no-fabrication.js [count]
 *   count defaults to every draft (54): two calls each, the suggestions Fix
 *   open rules asks for and a page written whole, as Start asks for it.
 *
 * Writes src/lib/__fixtures__/no-fabrication/recorded.json, only when at
 * least one draft was answered. Reads and writes no database, never prints a
 * key, and isn't run in CI: the answers it keeps
 * are the model's of the day, for a person to re-record when the prompts or
 * the model change. A few cents at today's prices.
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { generateObject } from 'ai';
import { CASES } from '../lib/__fixtures__/no-fabrication/cases.js';
import { resolveModel } from '../lib/ai-provider.js';
import {
  SYSTEM_PROMPT,
  buildFixPrompt,
  draftPassages,
  suggestionsSchema,
} from '../lib/content-agent.js';
import { contentBriefModelId } from '../lib/content-brief.js';
import { inputSources } from '../lib/content-inputs.js';
import { numberSources, sourcesPrompt } from '../lib/content-sources.js';
import {
  WRITE_SYSTEM_PROMPT,
  briefText,
  buildWritePrompt,
  pageSchema,
} from '../lib/content-writer.js';

const count = Math.max(
  1,
  Math.min(CASES.length, Number.parseInt(process.argv[2] ?? `${CASES.length}`, 10) || CASES.length),
);

/** The open rules: the ones that tempt a model to make things up. */
const RULES = [
  { key: 'dated', name: 'A dated data point', detail: 'missing' },
  { key: 'expert', name: 'A quote from an expert', detail: 'missing' },
  { key: 'example', name: 'A real customer example', detail: 'missing' },
];

const modelId = contentBriefModelId();
const model = resolveModel(modelId);
const recorded = {};
const started = Date.now();

for (const c of CASES.slice(0, count)) {
  const numbered = numberSources({
    prompts: c.prompts,
    fanouts: c.fanouts,
    inputs: inputSources(c.inputs, c.brand.name),
  });
  const draft = { title: c.title, page_type: 'blog_post', body_html: c.html };
  const brand = { ...c.brand, language: c.language, site_type: c.siteType };
  const input = {
    rules: RULES,
    textRules: [],
    locked: [],
    sources: {
      promptIds: [],
      fanouts: c.fanouts,
      pages: [],
      queries: [],
      headings: [],
      length: 2500,
    },
  };
  try {
    const [fix, page] = await Promise.all([
      generateObject({
        model,
        schema: suggestionsSchema,
        system: SYSTEM_PROMPT,
        prompt: buildFixPrompt({
          brand,
          draft,
          passages: draftPassages(c.html),
          lockedKeys: new Set(),
          input,
          sources: sourcesPrompt(numbered),
        }),
      }),
      generateObject({
        model,
        schema: pageSchema,
        system: WRITE_SYSTEM_PROMPT,
        prompt: buildWritePrompt({ brand, draft, numbered, brief: briefText(null, null), input }),
      }),
    ]);
    recorded[c.id] = { fix: fix.object.suggestions, page: page.object };
    console.log(`${c.id}: ${fix.object.suggestions.length} suggestions and a page`);
  } catch (err) {
    console.error(`${c.id}: failed (${err?.message ?? err})`);
  }
}

if (!Object.keys(recorded).length) {
  console.error('No draft was answered: recorded.json is left as it was.');
  process.exit(1);
}
writeFileSync(
  new URL('../lib/__fixtures__/no-fabrication/recorded.json', import.meta.url),
  `${JSON.stringify({ model: modelId, recordedAt: new Date().toISOString(), ...recorded }, null, 2)}\n`,
);
console.log(
  `Recorded ${Object.keys(recorded).length} of ${count} drafts with ${modelId} in ${((Date.now() - started) / 1000).toFixed(0)} s.`,
);
