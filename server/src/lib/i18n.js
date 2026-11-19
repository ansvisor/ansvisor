import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.js';

/**
 * The database client, loaded when a language is first read: the words and
 * formats below are pure, and modules that only word things (the Pulse's,
 * a plan's summary) import them without a database.
 */
const database = async () => (await import('../config/supabase.js')).default;

/**
 * The words of e-mails the server sends, in each person's interface
 * language (LOC-008). Same idea as the web's next-intl files: one JSON tree
 * per language (server/messages/<code>.json, English the master), `{name}`
 * placeholders, and English wherever a language has no text, never a raw
 * key. The files live here, not in web/messages, because the server's image
 * is built from ./server alone and cannot read the web folder; the format is
 * the web's, so the same translate script can fill them.
 *
 * The language is the person's own (profiles.ui_language, 00549), apart from
 * a brand's content language. None set, or one with no file: English.
 */

export const DEFAULT_LOCALE = 'en';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../messages');

const isTree = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** `base` with `over`'s text where `over` has a non-empty string; keys only `over` has are dropped. */
export function mergeMessages(base, over) {
  if (!isTree(over)) return base;
  const out = {};
  for (const [key, value] of Object.entries(base)) {
    const next = over[key];
    if (isTree(value)) out[key] = mergeMessages(value, next);
    else out[key] = typeof next === 'string' && next !== '' ? next : value;
  }
  return out;
}

/** The codes that have a file, as written on disk ("pt-BR"). */
function availableCodes() {
  try {
    return fs
      .readdirSync(DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length));
  } catch {
    return [DEFAULT_LOCALE];
  }
}

/**
 * The language to write in for a stored code: the file of that code
 * ("pt-br" → "pt-BR"), else of its language ("de-AT" → "de"), else English.
 * The staff pseudo-locale (en-XA) and anything unknown come out English.
 */
export function resolveLocale(code) {
  const wanted = String(code ?? '')
    .trim()
    .toLowerCase();
  if (!wanted) return DEFAULT_LOCALE;
  const codes = availableCodes();
  const exact = codes.find((c) => c.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0];
  return codes.find((c) => c.toLowerCase() === base) ?? DEFAULT_LOCALE;
}

const cache = new Map();

function readFile(code) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIR, `${code}.json`), 'utf8'));
  } catch {
    return null;
  }
}

/** The messages of a language over English. */
export function messagesFor(code) {
  const locale = resolveLocale(code);
  if (!cache.has(locale)) {
    const english = readFile(DEFAULT_LOCALE) ?? {};
    cache.set(
      locale,
      locale === DEFAULT_LOCALE ? english : mergeMessages(english, readFile(locale)),
    );
  }
  return cache.get(locale);
}

/** For tests: forget the files read. */
export function forgetMessages() {
  cache.clear();
}

/** The index of the `}` closing the `{` at `from`, or -1. */
function closingBrace(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}' && (depth -= 1) === 0) return i;
  }
  return -1;
}

/** The branches of a plural's body: { one: '# page', other: '# pages', '=0': ... }. */
function pluralBranches(body) {
  const branches = {};
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i);
    const selector = /^\s*(=\d+|\w+)\s*\{/.exec(rest);
    if (!selector) break;
    const open = i + selector[0].length - 1;
    const close = closingBrace(body, open);
    if (close < 0) break;
    branches[selector[1]] = body.slice(open + 1, close);
    i = close + 1;
  }
  return branches;
}

/**
 * The ICU subset the server's messages use: `{name}`, and
 * `{count, plural, one {# page} other {# pages}}` with `=N` and the
 * language's plural categories (Intl.PluralRules); `#` is the count. A
 * placeholder with no value stays as written.
 */
export function formatMessage(text, values, code = DEFAULT_LOCALE) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const close = closingBrace(text, open);
    if (close < 0) break;
    out += text.slice(i, open);
    const inner = text.slice(open + 1, close);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural) {
      const count = Number(values[plural[1]]);
      const branches = pluralBranches(plural[2]);
      let category = 'other';
      try {
        category = new Intl.PluralRules(formatLocale(code)).select(count);
      } catch {
        category = 'other';
      }
      const chosen = branches[`=${count}`] ?? branches[category] ?? branches.other ?? '';
      const shown = new Intl.NumberFormat(formatLocale(code)).format(count);
      out += formatMessage(chosen.replace(/#/g, shown), values, code);
    } else if (/^\w+$/.test(inner)) {
      out += inner in values ? String(values[inner]) : text.slice(open, close + 1);
    } else {
      out += text.slice(open, close + 1);
    }
    i = close + 1;
  }
  return out + text.slice(i);
}

/**
 * The text at a dotted key ("ownKey.why.invalid"), formatted with `values`
 * (formatMessage). A missing key gives the key itself, so a typo shows in
 * tests rather than hiding.
 */
export function translate(code, key, values = {}) {
  let node = messagesFor(code);
  for (const part of key.split('.')) node = isTree(node) ? node[part] : undefined;
  if (typeof node !== 'string') return key;
  return formatMessage(node, values, code);
}

/** `translate` bound to a language. */
export const translator = (code) => (key, values) => translate(code, key, values);

/**
 * Each person's interface language, by id: Map(id → resolved code). A person
 * with none set, and any read that fails, is English: an e-mail is never held
 * back for its language.
 */
export async function uiLanguagesOf(ids) {
  const wanted = [...new Set((ids ?? []).filter(Boolean))];
  const out = new Map(wanted.map((id) => [id, DEFAULT_LOCALE]));
  if (wanted.length === 0) return out;
  try {
    const supabaseAdmin = await database();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, ui_language')
      .in('id', wanted);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) out.set(row.id, resolveLocale(row.ui_language));
  } catch (err) {
    logger.warn({ err }, 'could not read UI languages for an e-mail, using English');
  }
  return out;
}

const sameAddress = (address) =>
  String(address ?? '')
    .trim()
    .toLowerCase();

/**
 * The interface language of each address of a list kept as addresses (a
 * Pulse's recipients): Map(lowercased address → resolved code). An address
 * that is a member of `orgId` with a language set gets theirs; any other
 * (no member, none set, a read that fails) is English. Only members with a
 * language set are looked up.
 */
export async function uiLanguagesOfAddresses(orgId, addresses) {
  const out = new Map((addresses ?? []).map((address) => [sameAddress(address), DEFAULT_LOCALE]));
  if (!orgId || out.size === 0) return out;
  try {
    const supabaseAdmin = await database();
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, ui_language')
      .eq('organization_id', orgId)
      .not('ui_language', 'is', null);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const locale = resolveLocale(row.ui_language);
      if (locale === DEFAULT_LOCALE) continue;
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(row.id);
      const address = sameAddress(user?.user?.email);
      if (address && out.has(address)) out.set(address, locale);
    }
  } catch (err) {
    logger.warn({ err }, 'could not read UI languages for an e-mail, using English');
  }
  return out;
}

/**
 * Addresses grouped by their language (uiLanguagesOfAddresses), in the
 * order first met: [[locale, addresses], …]. One send per language.
 */
export async function addressesByLanguage(orgId, addresses) {
  const languages = await uiLanguagesOfAddresses(orgId, addresses);
  const groups = new Map();
  for (const address of addresses ?? []) {
    const locale = languages.get(sameAddress(address)) ?? DEFAULT_LOCALE;
    groups.set(locale, [...(groups.get(locale) ?? []), address]);
  }
  return [...groups];
}

/** One person's interface language. */
export async function uiLanguageOf(id) {
  return (await uiLanguagesOf([id])).get(id) ?? DEFAULT_LOCALE;
}

/** The BCP 47 tag for number and date formats: English stays en-US, as before. */
export function formatLocale(code) {
  const locale = resolveLocale(code);
  if (locale === DEFAULT_LOCALE) return 'en-US';
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length ? locale : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** A number in the language's format: "1,234.5" in English, "1.234,5" in German. */
export function formatNumberIn(code, value, options = {}) {
  return new Intl.NumberFormat(formatLocale(code), options).format(Number(value) || 0);
}

/**
 * A percentage given as 0–100 (12.5 → "12.5%", "%12,5" in Turkish), to at
 * most `digits` decimals.
 */
export function formatPercentIn(code, value, digits = 1) {
  return new Intl.NumberFormat(formatLocale(code), {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format((Number(value) || 0) / 100);
}
