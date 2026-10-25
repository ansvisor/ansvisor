/**
 * Quality's weights against AI citations (Content Editor Quality spec §11,
 * CE-055): reads a JSON-lines file of pages a maintainer exported, one page
 * a line, and prints, per profile, score and check, how many pages had the
 * check and the rank correlation between its share and the AI citations the
 * page got; given the weights in use, the ones the correlations suggest.
 * See src/lib/quality-calibration.js for what a row holds.
 *
 * Run from server/:
 *   node src/scripts/calibrate-quality-weights.js <pages.jsonl> [--weights <weights.json>] [--min 30] [--out <report.json>]
 *
 *   --weights  the weights in use, as web/src/lib/content/quality-profiles.ts's
 *              PROFILE_WEIGHTS gives them (profile → score → check → points)
 *   --min      the fewest pages a check's correlation is read from (30)
 *   --out      also write the report as JSON
 *
 * Reads no database and no network, and prints and writes aggregates only:
 * a row's fields other than its profile, checks and citations are dropped,
 * and a line that isn't a row is counted, never printed. Isn't run in CI.
 */
import { readFileSync, writeFileSync } from 'fs';
import { MIN_PAGES, QUALITY_SCORES, calibrate, parseRows } from '../lib/quality-calibration.js';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
if (!file) {
  console.error(
    'Usage: node src/scripts/calibrate-quality-weights.js <pages.jsonl> [--weights <weights.json>] [--min 30] [--out <report.json>]',
  );
  process.exit(1);
}
const minPages = Math.max(3, Number.parseInt(option('--min') ?? `${MIN_PAGES}`, 10) || MIN_PAGES);
const weightsFile = option('--weights');
const out = option('--out');

const { rows, invalid } = parseRows(readFileSync(file, 'utf8'));
const weights = weightsFile ? JSON.parse(readFileSync(weightsFile, 'utf8')) : null;
const report = calibrate(rows, { minPages, weights });

console.log(
  `${rows.length} pages read${invalid ? `, ${invalid} ${invalid === 1 ? 'line' : 'lines'} skipped` : ''}.`,
);
for (const [profile, { pages, scores }] of Object.entries(report.profiles)) {
  console.log(`\n${profile} · ${pages} pages`);
  for (const score of QUALITY_SCORES) {
    const { checks, suggested } = scores[score];
    for (const [check, { pages: had, rho }] of Object.entries(checks)) {
      const now = weights?.[profile]?.[score]?.[check];
      const next = suggested?.[check];
      console.log(
        `  ${score}.${check}`.padEnd(32),
        `${had} pages`.padEnd(11),
        `rho ${rho === null ? '—' : rho.toFixed(3)}`.padEnd(11),
        now === undefined ? '' : `${now} → ${next}`,
      );
    }
  }
}
if (out) {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nReport written to ${out}.`);
}
