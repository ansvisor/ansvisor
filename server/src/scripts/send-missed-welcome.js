/**
 * Send the welcome e-mail's event (Resend's `user.signed_up`, which starts the
 * welcome Automation) to the accounts that missed it. Run by hand on the API
 * server, which has RESEND_API_KEY and the Supabase service key:
 *
 *   node src/scripts/send-missed-welcome.js            # dry run: counts and dates
 *   node src/scripts/send-missed-welcome.js --send     # claim, send, release on a 4xx
 *
 * Options:
 *   --since <date>         accounts made from then on (ISO date). Default, and
 *                          earliest: 13 Nov 2026 00:00 Istanbul time, when the
 *                          Automation started.
 *   --dry-run              the default: list only, claim and send nothing.
 *   --send                 claim each account as the web's pages do
 *                          (lib/welcome-claim.js), send the event, and
 *                          release the claim only when Resend refused it (a
 *                          4xx). On a 5xx, a timeout or a network error the
 *                          claim is kept and the account counted "kept
 *                          (unknown)": Resend may have the event, and sending
 *                          again could send a second welcome.
 *   --pause-ms <n>         wait between two sends (default 1000).
 *   --include-early-oauth  also Google and GitHub accounts made before the
 *                          claim went live (14 Nov 2026, 16:00 UTC). The old
 *                          sign-in callback may have sent theirs, keeping no
 *                          claim: include them only once Resend's Events tab
 *                          shows it received no `user.signed_up` then.
 *   --include-old-claims   also accounts whose `signup_event_at` is an
 *                          old-style claim (no `signup_event_tries`, no
 *                          `signup_claim_id`): written before this change for
 *                          both events, even when Resend got nothing. Off by
 *                          default. Each is claimed again the new way (a new
 *                          claim id, the wait, the read-back), sent, and
 *                          released only on a 4xx; it is then new-style, so it
 *                          is never picked again.
 *
 *   USE --include-old-claims ONLY AFTER CHECKING RESEND'S LOGS show no
 *   `/events/send` request from 13 Nov 2026 until this change went live (as on
 *   production on 16 Nov 2026). An old-style claim written while the web had
 *   RESEND_API_KEY may have sent the welcome already: with the flag, that
 *   person would get a second one. Requests after this change went live come
 *   from new-style claims, which are never included.
 *
 * Who: made since --since, e-mail confirmed, not invited, signed in at least
 * once, and no `signup_event_at` in app_metadata (or an old-style one, with
 * --include-old-claims). It prints counts, the accounts' creation dates and
 * sign-in providers: never an e-mail address, a name or a key.
 *
 * A "kept (unknown)" account is never picked again: its claim is new-style.
 * Look for its `user.signed_up` in Resend's Events at the time printed; only
 * if none arrived, remove that account's `signup_event_at` by hand (find it
 * by its creation date) and run --send again. The run exits 1 when any send
 * was refused or unknown, or a claim couldn't be released.
 */

import { pathToFileURL } from 'node:url';
import {
  OAUTH_CALLBACK_SENT_UNTIL,
  SIGNUP_EVENT_SINCE,
  claimWelcome,
  isOldClaim,
  releaseWelcome,
  sendWelcomeEvent,
  welcomeStatus,
} from '../lib/welcome-claim.js';

export const USAGE =
  'Usage: node src/scripts/send-missed-welcome.js [--dry-run | --send] [--since <ISO date>] ' +
  '[--pause-ms <n>] [--include-early-oauth] [--include-old-claims]';

const PER_PAGE = 1000;

/** The command line's options. Throws on an unknown or bad one. */
export function parseArgs(argv) {
  const opts = {
    send: false,
    since: SIGNUP_EVENT_SINCE,
    pauseMs: 1000,
    includeEarlyOAuth: false,
    includeOldClaims: false,
    help: false,
  };
  let dryRun = false;
  const args = [...argv];
  while (args.length) {
    const arg = args.shift();
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const value = () => (eq === -1 ? args.shift() : arg.slice(eq + 1));
    if (flag === '--send') opts.send = true;
    else if (flag === '--dry-run') dryRun = true;
    else if (flag === '--include-early-oauth') opts.includeEarlyOAuth = true;
    else if (flag === '--include-old-claims') opts.includeOldClaims = true;
    else if (flag === '--help' || flag === '-h') opts.help = true;
    else if (flag === '--since') {
      const text = value() ?? '';
      opts.since = Date.parse(text);
      if (Number.isNaN(opts.since)) throw new Error(`--since isn't a date: ${text}`);
    } else if (flag === '--pause-ms') {
      const text = value() ?? '';
      opts.pauseMs = Number(text);
      if (!/^\d+$/.test(text)) throw new Error(`--pause-ms isn't a whole number: ${text}`);
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.send && dryRun) throw new Error('--send and --dry-run: pick one');
  if (opts.since < SIGNUP_EVENT_SINCE) {
    throw new Error(
      `--since is before ${new Date(SIGNUP_EVENT_SINCE).toISOString()}, when the welcome ` +
        'Automation started: older accounts are never sent the welcome',
    );
  }
  return opts;
}

/** Every account, page by page, kept to what the script needs. */
async function listAccounts(admin) {
  const accounts = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`listing the accounts failed (${error.status ?? error.name})`);
    const users = data?.users ?? [];
    accounts.push(...users);
    if (users.length < PER_PAGE) return accounts;
  }
}

const SKIPPED = {
  claimed: 'already claimed (signup_event_at)',
  'old-claim':
    'old-style claim (signup_event_at from before the split; --include-old-claims, read the header first)',
  'early-oauth': `Google or GitHub, made before ${new Date(OAUTH_CALLBACK_SENT_UNTIL).toISOString()} (may have had it from the old sign-in callback; --include-early-oauth)`,
  unconfirmed: 'e-mail never confirmed (never welcomed, by design)',
  invited: 'invited to a workspace (never welcomed)',
  'never-signed-in': 'never signed in',
  'no-email': 'no e-mail address',
};

/**
 * List the accounts that missed the welcome and, with `send`, send it to
 * each. `deps`: `admin` (the service client's auth.admin), `apiKey`
 * (RESEND_API_KEY), `fetchImpl`, `sleep(ms)`, `log(line)`. Returns the counts.
 */
export async function run(opts, { admin, apiKey, fetchImpl = fetch, sleep, log, now = Date.now }) {
  if (opts.send && !apiKey) throw new Error('RESEND_API_KEY is not set: nothing claimed or sent');
  const counts = {};
  const owed = [];
  for (const user of await listAccounts(admin)) {
    const status = welcomeStatus(user, opts);
    if (status === 'before-since') continue;
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === 'owed') {
      owed.push({
        id: user.id,
        created: user.created_at,
        provider: user.app_metadata?.provider ?? 'unknown',
        oldClaim: isOldClaim(user.app_metadata),
      });
    }
  }
  owed.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));

  log(
    `Accounts made since ${new Date(opts.since).toISOString()} that missed the welcome: ${owed.length}`,
  );
  const label = (account) =>
    `made ${account.created} (${account.provider}${account.oldClaim ? ', old-style claim' : ''})`;
  for (const account of owed) log(`  ${label(account)}`);
  const oldClaims = owed.filter((account) => account.oldClaim).length;
  if (opts.includeOldClaims) log(`Of these, old-style claims (--include-old-claims): ${oldClaims}`);
  for (const [status, label] of Object.entries(SKIPPED)) {
    if (counts[status]) log(`Left out, ${label}: ${counts[status]}`);
  }
  const result = {
    owed: owed.length,
    oldClaims,
    sent: 0,
    refused: 0,
    unknown: 0,
    skipped: 0,
    unreleased: 0,
  };
  if (!opts.send) {
    log('Dry run: nothing claimed or sent. Run again with --send to send.');
    return result;
  }

  const isOwed = (user) => welcomeStatus(user, opts) === 'owed';
  for (const [i, account] of owed.entries()) {
    if (i > 0) await sleep(opts.pauseMs);
    const claimed = await claimWelcome(admin, account.id, { isOwed, sleep, now });
    if (!claimed) {
      result.skipped++;
      log(`  ${label(account)}: skipped (no longer owed, claimed elsewhere, or not claimable)`);
      continue;
    }
    const answer = await sendWelcomeEvent(claimed, { apiKey, fetchImpl });
    const why = answer.status ? `HTTP ${answer.status}` : answer.error;
    if (answer.result === 'accepted') {
      result.sent++;
      log(`  ${label(account)}: sent`);
      continue;
    }
    if (answer.result === 'unknown') {
      // Resend may have it: kept, so it is never sent twice.
      result.unknown++;
      log(`  ${label(account)}: unknown (${why}); claim kept, as Resend may have it`);
      continue;
    }
    result.refused++;
    const released = await releaseWelcome(admin, claimed);
    if (!released) result.unreleased++;
    log(`  ${label(account)}: refused (${why}); claim ${released ? 'released' : 'NOT released'}`);
  }
  log(
    `Done: ${result.sent} sent, ${result.refused} refused (claim released), ` +
      `${result.unknown} kept (unknown), ${result.skipped} skipped` +
      (result.unreleased ? `, ${result.unreleased} claim(s) not released` : ''),
  );
  if (result.unknown) {
    log(
      "Kept (unknown): check Resend's Events for user.signed_up at those times before " +
        'clearing a claim by hand (see the header of this script).',
    );
  }
  return result;
}

/** The exit code: 1 when a send was refused or unknown, or a claim wasn't released. */
export function exitCodeOf(result) {
  return result.refused || result.unknown || result.unreleased ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(USAGE);
    process.exit(0);
  }
  await import('dotenv/config');
  const { default: supabaseAdmin } = await import('../config/supabase.js');
  try {
    const result = await run(opts, {
      admin: supabaseAdmin.auth.admin,
      apiKey: process.env.RESEND_API_KEY,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.log(line),
    });
    process.exit(exitCodeOf(result));
  } catch (err) {
    console.error(`send-missed-welcome: ${err instanceof Error ? err.message : 'failed'}`);
    process.exit(1);
  }
}
