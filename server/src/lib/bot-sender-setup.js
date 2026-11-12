/**
 * What a person copies into Cloudflare, Vercel or Fastly to send AI-bot requests
 * (AT-010, spec §6.1 options B, C and D), built when the connection is made so
 * the secret is in it once:
 *
 *   * a Cloudflare Logpush job on the http_requests dataset, filtered at the
 *     edge to user agents on the bot list (only matching lines are sent),
 *     posting to /bots/ingest with the secret as a header;
 *   * a Vercel drain (logs, JSON) to /bots/ingest with the secret as a
 *     custom header. Vercel sends every request log; the server filters
 *     them, under the raw-record cap;
 *   * a Fastly HTTPS log stream, using FASTLY_LOG_FORMAT and the same
 *     bearer-secret authentication. Fastly sends every request log; the
 *     server verifies and filters them, under the raw-record cap.
 *
 * The Worker (option A) is bot-worker-script.js.
 */

import { AI_BOTS } from './ai-bots.js';

/**
 * Fastly HTTPS logging endpoint format (#2164). `time.start.sec` is emitted
 * as epoch seconds; the parser accepts it alongside the other sender times.
 * The URL is the request path, paired with its host so the ingest pipeline
 * can enforce the brand's domain. The server still verifies the user agent
 * and source IP.
 */
export const FASTLY_LOG_FORMAT = `{
  "timestamp": "%{time.start.sec}V",
  "client_ip": "%{req.http.Fastly-Client-IP}V",
  "host": "%{if(req.http.Fastly-Orig-Host, req.http.Fastly-Orig-Host, req.http.Host)}V",
  "request_user_agent": "%{json.escape(req.http.User-Agent)}V",
  "url": "%{json.escape(req.url)}V",
  "response_status": %{resp.status}V,
  "country": "%{client.geo.country_code}V"
}`;

/** The http_requests fields bot-log-formats.js reads. */
export const LOGPUSH_FIELDS = [
  'ClientRequestUserAgent',
  'ClientIP',
  'ClientRequestHost',
  'ClientRequestURI',
  'EdgeResponseStatus',
  'EdgeStartTimestamp',
  'ClientCountry',
];

/** A Logpush job's settings for the Cloudflare API or dashboard. */
export function logpushJob({ endpoint, secret }) {
  return {
    dataset: 'http_requests',
    destination_conf: `${endpoint}?header_Authorization=${encodeURIComponent(`Bearer ${secret}`)}`,
    output_options: { field_names: LOGPUSH_FIELDS, timestamp_format: 'rfc3339' },
    filter: JSON.stringify({
      where: {
        or: AI_BOTS.map((bot) => ({
          key: 'ClientRequestUserAgent',
          operator: 'contains',
          value: bot.userAgent,
        })),
      },
    }),
    // Small files: each upload stays well under the endpoint's limits
    // (bot-log-formats.js: 16 MB inflated, 20,000 lines).
    max_upload_bytes: 5_000_000,
    max_upload_records: 10_000,
  };
}

/** A Vercel drain's settings (Team Settings › Drains › Add Drain › Logs). */
export function vercelDrain({ endpoint, secret }) {
  return {
    endpoint,
    format: 'json',
    headers: [`Authorization: Bearer ${secret}`],
    sources: ['static', 'lambda', 'edge', 'external', 'redirect'],
  };
}