/**
 * Translates web/messages/en.json into web/messages/<locale>.json with an LLM
 * on OpenRouter (LOC-006/007). Same key structure; ICU syntax and rich-text
 * tags are validated per key (retry, then English fallback); a per-key cache
 * keyed by the hash of the English text means a rerun only pays for new or
 * changed keys.
 *
 * Run from web/:
 *   node scripts/translate-messages.mjs --locale tr [--model anthropic/claude-sonnet-5.5]
 *        [--max-usd 8] [--dry-run] [--sample 300] [--batch-keys 40] [--concurrency 4]
 *
 * Key: OPENROUTER_API_KEY from the environment, else from server/.env of the
 * main checkout. It is never printed or logged. Only Node's built-in fetch.
 * A sample run (--sample N) never writes <locale>.json; it only fills the cache
 * (use --cache-dir to keep a comparison run out of the real cache).
 * Stops (exit code 2) once the running cost passes --max-usd; finished batches
 * are already cached, so a rerun continues from there.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LOCALE_NAMES,
  cachedTranslation,
  emptyCache,
  estimateTokens,
  flatten,
  makeBatches,
  parseJsonReply,
  pendingEntries,
  pruneCache,
  sampleEntries,
  storeTranslation,
  unflatten,
  validateTranslation,
} from './translate-messages-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES = path.resolve(HERE, '../messages');
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
const API = 'https://openrouter.ai/api/v1';
// Output tokens per English source token, a starting guess for --dry-run.
const OUT_RATIO = {
  tr: 1.7,
  pl: 1.7,
  ja: 1.6,
  de: 1.5,
  fr: 1.45,
  es: 1.4,
  it: 1.4,
  'pt-BR': 1.4,
  nl: 1.4,
};

function flag(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const v = process.argv[at + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function readApiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  let root;
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: HERE },
    )
      .toString()
      .trim();
    root = path.dirname(common);
  } catch {
    root = path.resolve(HERE, '../..');
  }
  const envFile = path.join(root, 'server/.env');
  if (!fs.existsSync(envFile)) return undefined;
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
    if (m) return m[1].trim().replace(/^['"]|['"]$/g, '') || undefined;
  }
  return undefined;
}

async function modelPrices(model) {
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error(`models list failed (${res.status})`);
  const m = (await res.json()).data.find((x) => x.id === model);
  if (!m) throw new Error(`model ${model} not found on OpenRouter`);
  return { inUsd: Number(m.pricing.prompt), outUsd: Number(m.pricing.completion) };
}

function systemPrompt(locale, glossary) {
  const lang = LOCALE_NAMES[locale] ?? locale;
  const terms = Object.entries(glossary.terms)
    .filter(([, v]) => v[locale])
    .map(([en, v]) => `- ${en} => ${v[locale]}`)
    .join('\n');
  return `You translate the user interface of Ansvisor (a SaaS product for AI search visibility) from English into ${lang} (locale ${locale}).

You receive a JSON object {"id": {"ctx": "<message key path, context only>", "en": "<English text>"}, ...}.
Reply with ONLY a JSON object {"id": "<${lang} text>", ...} containing every id, no commentary, no code fences.

Rules:
- Natural, concise product UI language (buttons short, errors clear). Use the polite form people expect in SaaS UIs of that language.
- Keep ICU MessageFormat intact: placeholders like {name}, {count, plural, one {...} other {...}}, {x, select, a {...} other {...}}, # inside plurals. Never translate placeholder names, select keywords or the words plural/select/other. Adapt plural categories to ${lang} (always include "other"). Keep every select option.
- Keep rich-text tags exactly (<b>...</b>, <link>...</link>, <note>...</note>, any tag name): translate the text between them, never rename, add or drop a tag.
- Keep HTML entities, emoji, markdown, URLs, code, numbers, units and punctuation conventions that are not language-specific. Do not add or remove sentences.
- An apostrophe directly before { or } or < is ICU quoting: do not introduce one.
- Keep these terms in English (they may take local suffixes): ${glossary.keepInEnglish.join(', ')}.
- Use these glossary choices when the English term appears:
${terms || '- (none for this language)'}
- Translate the same English word the same way everywhere.`;
}

async function callModel({ key, model, system, items, maxTokens, retryNotes }) {
  const payload = {};
  for (const [id, ctx, en] of items)
    payload[id] = { ctx, en, ...(retryNotes?.[id] ? { fix: retryNotes[id] } : {}) };
  const body = {
    model,
    temperature: 0.2,
    max_tokens: maxTokens,
    // Translation needs no long reasoning: keep the model's thinking short (and cheap).
    reasoning: { effort: 'low' },
    usage: { include: true },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content:
          (retryNotes
            ? 'Some earlier answers were invalid; "fix" says why. Translate again.\n'
            : '') + JSON.stringify(payload),
      },
    ],
  };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'Ansvisor UI translation',
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastErr = new Error(
          `OpenRouter ${res.status}: ${String(json?.error?.message ?? 'request failed').slice(0, 200)}`,
        );
        if (res.status === 401 || res.status === 402 || res.status === 403)
          throw Object.assign(lastErr, { fatal: true });
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage: json.usage ?? {},
        finish: json.choices?.[0]?.finish_reason,
      };
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const locale = flag('locale');
  if (!locale || locale === true) throw new Error('--locale <code> is required (e.g. --locale tr)');
  const model = flag('model', DEFAULT_MODEL);
  const maxUsd = Number(flag('max-usd', 8));
  const dry = flag('dry-run', false) === true;
  const sampleN = flag('sample') ? Number(flag('sample')) : 0;
  const batchKeys = Number(flag('batch-keys', 40));
  const concurrency = Number(flag('concurrency', 4));
  const cacheDir = path.resolve(flag('cache-dir', path.join(MESSAGES, '.translate-cache')));
  const outRatio = Number(flag('out-ratio', OUT_RATIO[locale] ?? 1.5));

  const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, 'en.json'), 'utf8'));
  const glossary = JSON.parse(fs.readFileSync(path.join(MESSAGES, 'glossary.json'), 'utf8'));
  const all = flatten(source);
  const entries = sampleN ? sampleEntries(all, sampleN) : all;

  const cacheFile = path.join(cacheDir, `${locale}.json`);
  const cache = fs.existsSync(cacheFile)
    ? JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    : emptyCache();
  if (!sampleN) pruneCache(cache, all);
  const todo = pendingEntries(entries, cache);
  const batches = makeBatches(todo, { maxKeys: batchKeys });
  const system = systemPrompt(locale, glossary);
  const prices = await modelPrices(model);

  console.log(
    `${locale} | model ${model} | $${(prices.inUsd * 1e6).toFixed(2)} in / $${(prices.outUsd * 1e6).toFixed(2)} out per 1M tokens`,
  );
  console.log(
    `keys: ${entries.length} selected, ${entries.length - todo.length} cached, ${todo.length} to translate in ${batches.length} calls`,
  );

  if (dry) {
    const srcTok = todo.reduce((a, [, t]) => a + estimateTokens(t), 0);
    const inTok = batches.length * estimateTokens(system) + srcTok + todo.length * 22;
    const outTok = Math.round(srcTok * outRatio) + todo.length * 8;
    const cost = inTok * prices.inUsd + outTok * prices.outUsd;
    console.log(
      `DRY RUN (estimate, no API calls): ~${inTok} input tokens, ~${outTok} output tokens (ratio ${outRatio}), ~$${cost.toFixed(2)}`,
    );
    return;
  }

  const key = readApiKey();
  if (!key)
    throw new Error(
      'OPENROUTER_API_KEY not found (environment or server/.env of the main checkout)',
    );

  const enforceKeep = glossary.enforceKeep ?? [];
  const stats = { inTok: 0, outTok: 0, usd: 0, calls: 0, translated: 0, fallback: 0, retried: 0 };
  let stopped = false;
  const failed = new Map(); // path -> English, for keys that fell back

  const account = (usage) => {
    const inT = usage.prompt_tokens ?? 0;
    const outT = usage.completion_tokens ?? 0;
    stats.inTok += inT;
    stats.outTok += outT;
    stats.calls++;
    stats.usd +=
      typeof usage.cost === 'number' ? usage.cost : inT * prices.inUsd + outT * prices.outUsd;
    console.log(
      `  call ${stats.calls}: running total $${stats.usd.toFixed(4)} (${stats.inTok} in / ${stats.outTok} out tokens)`,
    );
  };
  const saveCache = () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 1) + '\n');
  };

  // One batch: ask, validate, retry the invalid keys (smaller, with the reason) twice, else fall back.
  async function runBatch(batch) {
    let remaining = batch.map(([p, t], i) => ({ id: `k${i + 1}`, path: p, text: t }));
    let notes;
    for (let round = 0; round < 3 && remaining.length; round++) {
      if (stopped || stats.usd >= maxUsd) {
        stopped = true;
        return;
      }
      // A fixed, roomy ceiling: a model that thinks first spends its thinking
      // from the same allowance, and a tight one cut replies off mid-JSON
      // ("finish: length"), which cost a retry each. Billing is per token used.
      const maxTokens = 16000;
      const items = remaining.map((r) => [r.id, r.path.split('.').slice(-3).join('.'), r.text]);
      let reply;
      try {
        reply = await callModel({ key, model, system, items, maxTokens, retryNotes: notes });
      } catch (e) {
        if (e.fatal) throw e;
        console.log(`  batch error: ${e.message}`);
        continue;
      }
      account(reply.usage);
      let parsed = {};
      try {
        parsed = parseJsonReply(reply.text);
      } catch (e) {
        console.log(`  unreadable reply (${e.message}, finish: ${reply.finish}); retrying`);
      }
      const bad = [];
      notes = {};
      for (const r of remaining) {
        const problems = validateTranslation(r.text, parsed[r.id], { enforceKeep });
        if (problems.length) {
          bad.push(r);
          notes[r.id] = problems.join('; ');
        } else {
          storeTranslation(cache, r.path, r.text, parsed[r.id]);
          stats.translated++;
        }
      }
      if (bad.length) stats.retried += bad.length;
      remaining = bad;
    }
    for (const r of remaining) {
      failed.set(r.path, r.text);
      stats.fallback++;
    }
  }

  const queue = [...batches];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length && !stopped) {
      if (stats.usd >= maxUsd) {
        stopped = true;
        break;
      }
      await runBatch(queue.shift());
      saveCache();
    }
  });
  await Promise.all(workers);
  saveCache();

  console.log(
    `\nDone: ${stats.translated} translated, ${stats.fallback} fell back to English, ${stats.retried} invalid answers retried; ${stats.calls} calls, ${stats.inTok} in / ${stats.outTok} out tokens, $${stats.usd.toFixed(4)} total`,
  );
  if (stopped) {
    console.log(
      `STOPPED: the cost limit of $${maxUsd} was reached. Cached batches are kept; rerun to continue.`,
    );
    process.exitCode = 2;
  }

  if (!sampleN && !stopped) {
    const values = {};
    for (const [p, t] of all) values[p] = cachedTranslation(cache, p, t) ?? t;
    const missing = all.filter(([p, t]) => cachedTranslation(cache, p, t) === undefined).length;
    const out = path.join(MESSAGES, `${locale}.json`);
    fs.writeFileSync(out, JSON.stringify(unflatten(source, values), null, 2) + '\n');
    console.log(`Wrote ${path.relative(process.cwd(), out)} (${missing} keys still in English)`);
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
