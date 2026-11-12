/**
 * Ask Cloro for one answer per platform and show where it carries sponsored
 * units (ADS-01 §5, the Ads Phase 0 spike). Its findings decide which
 * platforms the sponsored-units parser covers; nothing in the product reads
 * them.
 *
 * Run by hand only, from server/, with CLORO_API_KEY in .env. Nothing
 * schedules or imports it (cloro-ad-keys.test.js checks the imports). Sends
 * ONE billed async task per platform, four by default:
 *   node src/scripts/probe-cloro-ads.js ["prompt"] [country] [platforms]
 *   prompt    defaults to a buying-intent question;
 *   country   defaults to US;
 *   platforms a comma-separated subset, default
 *             chatgpt-web,google-aio,google-aimode,copilot-web.
 *
 * - chatgpt-web asks with `include.ads: true` on top of the production body
 *   (Cloro's ads add-on, per its docs as seen in search summaries; the credit
 *   cost wasn't confirmed);
 * - google-aio, google-aimode and copilot-web (Bing AI Mode) send exactly the
 *   body production sends (buildRequestBody), so what comes back is what we
 *   already pay for.
 *
 * Prints, per platform, every key that looks like an ad and every text that
 * says "Sponsored" (cloro-ad-keys.js), and writes each full response to a temp
 * file outside the repo. Never prints the API key. Redact advertiser data
 * before saving a response as a test fixture.
 *
 * Two read-only checks on data already stored, for the same question:
 *
 *   -- Does any stored answer text carry a "Sponsored" label?
 *   select platform, count(*) from prompt_results
 *   where created_at > now() - interval '30 days' and response ilike '%sponsored%'
 *   group by platform;
 *
 *   -- Does any stored AI Mode (or other) product card look paid?
 *   select platform, count(*) from prompt_result_shopping_cards
 *   where raw::text ~* '(sponsor|"ad"|isAd|promoted|aclk)'
 *   group by platform;
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildRequestBody,
  CLORO_API,
  parseScraperResponse,
  SCRAPER_TASK_TYPES,
} from '../lib/cloro-scraper.js';
import { describe, findAdKeys } from './cloro-ad-keys.js';

const DEFAULT_PLATFORMS = ['chatgpt-web', 'google-aio', 'google-aimode', 'copilot-web'];

const prompt = process.argv[2] ?? 'What is the best CRM for a small business?';
const country = process.argv[3] ?? 'US';
const platforms = (process.argv[4] ?? DEFAULT_PLATFORMS.join(','))
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

const key = process.env.CLORO_API_KEY;
if (!key) {
  console.error('CLORO_API_KEY is not set (server/.env).');
  process.exit(1);
}
const unknown = platforms.filter((p) => !SCRAPER_TASK_TYPES[p]);
if (unknown.length || !platforms.length) {
  console.error(
    `Unknown platform "${unknown.join(', ')}". One of: ${Object.keys(SCRAPER_TASK_TYPES).join(', ')}`,
  );
  process.exit(1);
}

// Where Cloro's docs (search summaries, unverified) put each platform's ads.
const EXPECTED = {
  'chatgpt-web': ['ads', 'result.ads'],
  'google-aio': ['aioverview.ads', 'result.aioverview.ads', 'ads', 'result.ads'],
  'google-aimode': ['ads', 'result.ads', 'result.ads.ads'],
  'copilot-web': ['ads', 'result.ads'],
};

const read = (value, path) =>
  path
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), value);

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function probe(platform) {
  const payload = buildRequestBody(prompt, platform, country);
  if (platform === 'chatgpt-web') payload.include = { ...payload.include, ads: true };

  const submit = await fetch(`${CLORO_API}/v1/async/task`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ taskType: SCRAPER_TASK_TYPES[platform], payload }),
  });
  const submitted = await submit.json().catch(() => ({}));
  if (!submitted.success || !submitted.task?.id) {
    return {
      platform,
      error: `submit failed (${submit.status}): ${JSON.stringify(submitted).slice(0, 300)}`,
    };
  }
  console.log(`Submitted ${platform}; waiting for Cloro…`);

  let data = {};
  for (let i = 0; i < 90; i++) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const res = await fetch(`${CLORO_API}/v1/async/task/${submitted.task.id}`, { headers });
    data = await res.json().catch(() => ({}));
    const status = String(data.task?.status ?? data.status ?? '').toUpperCase();
    if (status === 'COMPLETED' || status === 'FAILED') break;
  }

  const file = join(tmpdir(), `cloro-ads-${platform}-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify({ platform, request: payload, data }, null, 2));

  const response = data.response ?? {};
  let answer;
  try {
    answer = `${parseScraperResponse(response, platform).text.length} chars`;
  } catch (err) {
    answer = `none: ${err.message}`;
  }
  const found = findAdKeys(response);
  return {
    platform,
    status: data.task?.status ?? data.status,
    askedForAds: platform === 'chatgpt-web',
    answer,
    expected: Object.fromEntries(
      (EXPECTED[platform] ?? []).map((path) => [path, describe(read(response, path))]),
    ),
    adKeys: found.keys.map((k) => `${k.path} (×${k.seen}): ${k.value}`),
    sponsoredText: found.labels.map((k) => `${k.path} (×${k.seen}): ${k.value}`),
    truncated: found.truncated,
    fullResponse: file,
  };
}

const results = await Promise.all(
  platforms.map((platform) =>
    probe(platform).catch((err) => ({ platform, error: String(err?.message ?? err) })),
  ),
);
console.log(JSON.stringify({ prompt, country, results }, null, 2));
process.exit(0);
