/**
 * The key walker behind probe-cloro-ads.js (ADS-01 §5): where a Cloro answer
 * carries something that looks like an ad. Pure, no network, so it is tested
 * on a fixture (cloro-ad-keys.test.js) and the probe itself never runs in CI.
 *
 * Two lists:
 * - `keys`: every key whose name matches /ad|sponsor|promot|paid/, read per
 *   word of the key (camelCase, snake_case and kebab-case split), so `ads`,
 *   `isAd`, `topAds`, `ad_block`, `AdSection`, `adsection`, `advertiser`,
 *   `sponsored`, `promotedBy` and `paid` count, and `metadata`, `headers`,
 *   `thread` or `address` don't;
 * - `labels`: text values that say "Sponsored" or "Promoted", and Google
 *   ad-click URLs (`/aclk?`, googleadservices.com), for units that are only
 *   marked in their text.
 *
 * Array indexes are folded to `[]`, so a key seen on every item of a list is
 * listed once with the number of times it was seen.
 */

const MAX_DEPTH = 40;
const MAX_ENTRIES = 200;

/** True when one word of a key names an ad. */
function isAdWord(word) {
  return (
    word === 'ad' ||
    word.startsWith('ads') ||
    word.startsWith('advert') ||
    word.includes('sponsor') ||
    word.includes('promot') ||
    word.includes('paid')
  );
}

/** `isAd` → is, ad; `ad_block` → ad, block; `AdSection` → ad, section. */
export function keyWords(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

export function isAdKey(key) {
  return keyWords(key).some(isAdWord);
}

const LABEL = /\b(sponsored|sponsor|promoted)\b|\/aclk\?|googleadservices\.com/i;

/** A short, single-line picture of a value, for the summary. */
export function describe(value) {
  if (Array.isArray(value)) {
    const first = value[0];
    const keys =
      first && typeof first === 'object' && !Array.isArray(first)
        ? ` of {${Object.keys(first).join(', ')}}`
        : '';
    return `array(${value.length})${keys}`.slice(0, 240);
  }
  if (value && typeof value === 'object') {
    return `object {${Object.keys(value).join(', ')}}`.slice(0, 240);
  }
  if (typeof value === 'string') return `string "${value.slice(0, 120)}"`;
  return String(value);
}

/**
 * Walk a Cloro response and list where ads may sit.
 * @param {unknown} root
 * @returns {{ keys: Array<{ path: string, seen: number, value: string }>,
 *   labels: Array<{ path: string, seen: number, value: string }>, truncated: boolean }}
 */
export function findAdKeys(root) {
  const keys = new Map();
  const labels = new Map();
  let truncated = false;

  const note = (map, path, value) => {
    const hit = map.get(path);
    if (hit) {
      hit.seen += 1;
      return;
    }
    if (map.size >= MAX_ENTRIES) {
      truncated = true;
      return;
    }
    map.set(path, { path, seen: 1, value });
  };

  const walk = (value, path, depth) => {
    if (depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    if (typeof value === 'string') {
      if (LABEL.test(value)) note(labels, path || '(root)', describe(value));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, `${path}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isAdKey(key)) note(keys, childPath, describe(child));
      walk(child, childPath, depth + 1);
    }
  };

  walk(root, '', 0);
  return { keys: [...keys.values()], labels: [...labels.values()], truncated };
}
