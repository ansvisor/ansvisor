/**
 * What does the ChatGPT Ads key read (Ads Phase 1 spike)? Its findings decide
 * whether Phase 1 connects ChatGPT Ads through an API or imports Ads
 * Manager's CSV; nothing in the product reads them.
 *
 * Run by hand only, from server/, by whoever holds the key. Nothing
 * schedules or imports it (ads-probe-parts.test.js checks the imports).
 * GET only: it never creates, changes or spends anything.
 *
 *   node src/scripts/probe-openai-ads.js /path [/path …]
 *
 * In server/.env:
 *   OPENAI_ADS_API_KEY   the ChatGPT Ads key (server-side only);
 *   OPENAI_ADS_API_BASE  the API's base URL, as OpenAI's Ads API docs give it.
 *
 * The paths come from those docs too (an account list, campaigns, a report):
 * we don't guess them. Each is asked once with the key as a Bearer token.
 *
 * Prints, per path, the HTTP status and the answer's shape (keys and list
 * lengths, never values: ads-probe-parts.js shapeOf), which tells:
 * - whether the key reads only our own ad account, or can list accounts
 *   that other people grant it (needed for customers to connect theirs);
 * - which metrics a report carries (spend, clicks, conversions).
 * Never prints the key.
 */
import 'dotenv/config';
import { redact, safeProbePath, shapeOf } from './ads-probe-parts.js';

const key = process.env.OPENAI_ADS_API_KEY;
const base = String(process.env.OPENAI_ADS_API_BASE ?? '').replace(/\/+$/, '');
const say = (text) => console.log(redact(text, [key]));

if (!key) {
  console.error('OPENAI_ADS_API_KEY is not set (server/.env).');
  process.exit(1);
}
if (!/^https:\/\/[^/]+/.test(base)) {
  console.error('Set OPENAI_ADS_API_BASE to the https base URL from OpenAI’s Ads API docs.');
  process.exit(1);
}
const paths = process.argv.slice(2).map(safeProbePath);
if (!paths.length || paths.some((p) => !p)) {
  console.error(
    'Give one or more read paths from the docs, each starting with "/", e.g. /accounts',
  );
  process.exit(1);
}

say(`ChatGPT Ads probe · ${new URL(base).host} · ${paths.length} path(s), GET only`);
for (const path of paths) {
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // Not JSON: only its length is shown.
    }
    const error = data?.error?.message ?? data?.error?.code ?? null;
    say(
      `\nGET ${path}: ${res.status}${error ? ` · ${String(error).slice(0, 200)}` : ''}\n   ${
        data === null ? `${text.length} chars, not JSON` : JSON.stringify(shapeOf(data))
      }`,
    );
  } catch (err) {
    say(`\nGET ${path}: request failed · ${err.message}`);
  }
}
