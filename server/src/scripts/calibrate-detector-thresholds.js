/**
 * Detector thresholds against outcomes (learning C6): reads one brand's
 * closed actions, exported by src/scripts/export-detector-outcomes.sql, and
 * prints, per signal kind, how its actions turned out and were dismissed,
 * by the signal's strength in quarters, with a suggested threshold where the
 * weakest quarter rarely leads anywhere. See src/lib/detector-calibration.js
 * for how a suggestion is made: it is a starting point for the maintainer,
 * never applied by itself.
 *
 * Run it on one brand (Ansvisor's own, or your own self-hosted data).
 * Running it across customers' brands is not supported; it waits on the
 * cross-brand learning decision (C5) and a privacy policy update.
 *
 * Run from server/:
 *   node src/scripts/calibrate-detector-thresholds.js <outcomes.jsonl> [--min 20] [--out <report.json>]
 *
 *   --min  the fewest closed actions a signal kind is judged on (20; 5 at least)
 *   --out  also write the report as JSON
 *
 * Reads no database and no network, and prints and writes aggregates only:
 * no action's id. Exits 1 when no row could be read. Isn't run in CI.
 */
import { readFileSync, writeFileSync } from 'fs';
import { MIN_ACTIONS, calibrate, parseRows, renderReport } from '../lib/detector-calibration.js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!file) {
  fail(
    'Usage: node src/scripts/calibrate-detector-thresholds.js <outcomes.jsonl> [--min 20] [--out <report.json>]',
  );
}
const minArg = option('--min');
const min = minArg === null ? MIN_ACTIONS : Number(minArg);
if (!Number.isInteger(min) || min < 5) fail('--min takes a whole number of actions, 5 at least.');
const out = option('--out');

const { rows, skipped } = parseRows(readFileSync(file, 'utf8'));
if (!rows.length) fail('No row could be read.');
const report = calibrate(rows, { min });
console.log(renderReport(report, { skipped, min }));
if (out) {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report written to ${out}.`);
}
