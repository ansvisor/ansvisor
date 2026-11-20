/**
 * Pure helpers for scripts/translate-messages.mjs: flattening the message file,
 * the ICU / rich-text validator, the per-key cache and batching. No network and
 * no file access here, so they can be unit tested.
 */
import { createHash } from 'node:crypto';

export const LOCALE_NAMES = {
  tr: 'Turkish',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  'pt-BR': 'Brazilian Portuguese',
  nl: 'Dutch',
  ja: 'Japanese',
  pl: 'Polish',
};

// ---------------------------------------------------------------- flatten

/** Leaf strings of a message tree as [path, text]; arrays use numeric segments. */
export function flatten(tree, prefix = []) {
  const out = [];
  for (const [k, v] of Object.entries(tree)) {
    const p = [...prefix, k];
    if (typeof v === 'string') out.push([p.join('.'), v]);
    else if (v && typeof v === 'object') out.push(...flatten(v, p));
  }
  return out;
}

/** Rebuild the tree of `source`, taking each leaf from `values[path]` (else the source text). */
export function unflatten(source, values, prefix = []) {
  if (typeof source === 'string') return values[prefix.join('.')] ?? source;
  if (Array.isArray(source))
    return source.map((v, i) => unflatten(v, values, [...prefix, String(i)]));
  if (source && typeof source === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(source)) out[k] = unflatten(v, values, [...prefix, k]);
    return out;
  }
  return source;
}

export function hashText(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- ICU / tags

/**
 * Signature of an ICU message: argument names with their type, select
 * selectors, plurals missing `other`, rich-text tag names.
 */
export function icuSignature(text) {
  const sig = {
    args: new Set(),
    selectors: new Set(),
    tags: new Set(),
    pluralsWithoutOther: 0,
    errors: [],
  };
  let i = 0;
  const n = text.length;

  function skipWs() {
    while (i < n && /\s/.test(text[i])) i++;
  }

  // Parses message text. At depth > 0 it stops after the closing brace and returns true.
  function parseText(depth) {
    while (i < n) {
      const c = text[i];
      if (c === "'") {
        const next = text[i + 1];
        if (next === "'") i += 2;
        else if (next === '{' || next === '}' || next === '<' || next === '>') {
          const end = text.indexOf("'", i + 1);
          i = end === -1 ? n : end + 1;
        } else i++;
      } else if (c === '{') {
        i++;
        parseArgument();
      } else if (c === '}') {
        if (depth === 0) {
          sig.errors.push('unmatched }');
          i++;
        } else {
          i++;
          return true;
        }
      } else if (c === '<') {
        const m = /^<(\/?)([A-Za-z][\w-]*)\s*(\/?)>/.exec(text.slice(i));
        if (m) {
          sig.tags.add(m[1] ? `/${m[2]}` : m[3] ? `${m[2]}/` : m[2]);
          i += m[0].length;
        } else i++;
      } else i++;
    }
    return depth === 0;
  }

  function parseArgument() {
    skipWs();
    let start = i;
    while (i < n && !',}'.includes(text[i])) i++;
    const name = text.slice(start, i).trim();
    if (!name) sig.errors.push('empty argument');
    if (i >= n) return void sig.errors.push('unclosed {');
    if (text[i] === '}') {
      i++;
      sig.args.add(`${name}:`);
      return;
    }
    i++; // comma
    skipWs();
    start = i;
    while (i < n && !',}'.includes(text[i])) i++;
    const type = text.slice(start, i).trim();
    sig.args.add(`${name}:${type}`);
    if (i >= n) return void sig.errors.push('unclosed {');
    if (text[i] === '}') {
      i++;
      return;
    }
    i++; // comma
    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      let hasOther = false;
      for (;;) {
        skipWs();
        if (i >= n) return void sig.errors.push('unclosed {');
        if (text[i] === '}') {
          i++;
          break;
        }
        start = i;
        while (i < n && text[i] !== '{' && text[i] !== '}') i++;
        const selector = text.slice(start, i).trim().replace(/\s+/g, ' ');
        if (text[i] !== '{' || !selector) return void sig.errors.push('bad option');
        if (selector === 'other') hasOther = true;
        if (type === 'select') sig.selectors.add(`${name}/${selector}`);
        i++;
        if (!parseText(1)) return void sig.errors.push('unclosed option');
      }
      if (!hasOther) sig.pluralsWithoutOther++;
    } else {
      // number / date / time with a style: skip to the matching brace
      let d = 1;
      while (i < n && d > 0) {
        if (text[i] === '{') d++;
        else if (text[i] === '}') d--;
        i++;
      }
      if (d > 0) sig.errors.push('unclosed {');
    }
  }

  parseText(0);
  return sig;
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Checks a translation against its English source. Returns [] when fine, else
 * readable problems (also sent back to the model on a retry).
 * `enforceKeep`: terms of the source that must appear verbatim in the translation.
 * Plural categories may differ per language, so only `other` is required there.
 */
export function validateTranslation(source, translated, { enforceKeep = [] } = {}) {
  const problems = [];
  if (typeof translated !== 'string' || !translated.trim()) return ['empty translation'];
  const s = icuSignature(source);
  const t = icuSignature(translated);
  if (t.errors.length) problems.push(`ICU syntax error: ${[...new Set(t.errors)].join(', ')}`);
  if (!sameSet(s.args, t.args)) {
    const miss = [...s.args].filter((x) => !t.args.has(x));
    const extra = [...t.args].filter((x) => !s.args.has(x));
    if (miss.length) problems.push(`missing placeholders: ${miss.join(', ')}`);
    if (extra.length) problems.push(`unexpected placeholders: ${extra.join(', ')}`);
  }
  if (!sameSet(s.selectors, t.selectors)) problems.push('select options differ from the source');
  if (t.pluralsWithoutOther > 0) problems.push('a plural/select is missing its "other" option');
  if (!sameSet(s.tags, t.tags))
    problems.push(`rich-text tags differ (source: ${[...s.tags].join(' ') || 'none'})`);
  if (translated.length > Math.max(40, source.length * 4))
    problems.push('translation far longer than the source');
  for (const term of enforceKeep) {
    if (source.includes(term) && !translated.includes(term))
      problems.push(`"${term}" must stay in English`);
  }
  return problems;
}

// ---------------------------------------------------------------- cache

/** Cache shape: { entries: { [path]: { h: sourceHash, t: translation } } }. */
export function emptyCache() {
  return { entries: {} };
}

export function cachedTranslation(cache, path, sourceText) {
  const e = cache.entries[path];
  return e && e.h === hashText(sourceText) ? e.t : undefined;
}

export function storeTranslation(cache, path, sourceText, translated) {
  cache.entries[path] = { h: hashText(sourceText), t: translated };
}

/** Keys that still need translating: new, changed, or not in the cache. */
export function pendingEntries(entries, cache) {
  return entries.filter(([path, text]) => cachedTranslation(cache, path, text) === undefined);
}

/** Drops cache entries for keys that no longer exist in the source. */
export function pruneCache(cache, entries) {
  const live = new Set(entries.map((e) => e[0]));
  for (const k of Object.keys(cache.entries)) if (!live.has(k)) delete cache.entries[k];
}

// ---------------------------------------------------------------- batching

/** Groups consecutive entries into batches of at most maxKeys keys and maxChars source characters. */
export function makeBatches(entries, { maxKeys = 40, maxChars = 7000 } = {}) {
  const batches = [];
  let cur = [];
  let chars = 0;
  for (const e of entries) {
    if (cur.length && (cur.length >= maxKeys || chars + e[1].length > maxChars)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(e);
    chars += e[1].length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Evenly spread sample of n entries (keeps variety across namespaces). */
export function sampleEntries(entries, n) {
  if (n >= entries.length) return entries;
  const step = entries.length / n;
  return Array.from({ length: n }, (_, i) => entries[Math.floor(i * step)]);
}

/** Pulls a JSON object out of a model reply (tolerates code fences and prose around it). */
export function parseJsonReply(reply) {
  const text = String(reply ?? '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;
  const a = body.indexOf('{');
  const b = body.lastIndexOf('}');
  if (a === -1 || b <= a) throw new Error('no JSON object in reply');
  const obj = JSON.parse(body.slice(a, b + 1));
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    throw new Error('reply is not an object');
  return obj;
}

/** Rough token estimate (no tokenizer dependency): about 3.6 characters per token. */
export function estimateTokens(text) {
  return Math.ceil(text.length / 3.6);
}
