import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Right-to-left (Arabic) needs logical Tailwind classes: ms/me, ps/pe,
 * start/end, text-start/end, border-s/e, rounded-s/e. In left-to-right a
 * logical class looks the same as the physical one, so nothing changes today.
 *
 * This test stops new physical left/right classes from landing. Today's code
 * is allowed through a baseline (per-file counts in
 * rtl-physical-classes.baseline.json) that only shrinks: a file may not have
 * more physical classes than its baseline, and when a file has fewer the
 * baseline must be lowered too. Write `rtl-ok` in a comment on the same line
 * when a physical class is intended (for example a centering offset).
 *
 * To regenerate the baseline after converting files:
 *   UPDATE_RTL_BASELINE=1 yarn test src/lib/rtl-physical-classes
 */

const SRC = join(__dirname, '..');
const BASELINE_PATH = join(__dirname, 'rtl-physical-classes.baseline.json');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// A class token, after an optional variant such as `md:` or `[&>svg]:`.
const PHYSICAL = new RegExp(
  '(?<![\\w-])-?(?:' +
    [
      'm[lr]-',
      'p[lr]-',
      '(?:left|right)-',
      'text-(?:left|right)(?![\\w-])',
      'border-[lr](?![a-z])',
      'rounded-(?:l|r|tl|tr|bl|br)(?![a-z])',
      'translate-x-',
      'space-x-',
    ].join('|') +
    ')',
  'g',
);

function countPhysical(text: string): number {
  return text
    .split('\n')
    .filter((line) => !line.includes('rtl-ok'))
    .reduce((sum, line) => sum + (line.match(PHYSICAL)?.length ?? 0), 0);
}

function currentCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const path of filesUnder(SRC).sort()) {
    const n = countPhysical(readFileSync(path, 'utf8'));
    if (n > 0) counts[relative(SRC, path)] = n;
  }
  return counts;
}

describe('physical left/right classes', () => {
  const counts = currentCounts();

  if (process.env.UPDATE_RTL_BASELINE) {
    writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
  }
  const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

  it('are not added beyond the baseline', () => {
    const over = Object.entries(counts)
      .filter(([file, n]) => n > (baseline[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${baseline[file] ?? 0})`);
    expect(
      over,
      'Use logical classes (ms/me, ps/pe, start/end, text-start/end, border-s/e, rounded-s/e).',
    ).toEqual([]);
  });

  it('has a baseline that is lowered when files are converted', () => {
    const stale = Object.entries(baseline)
      .filter(([file, n]) => (counts[file] ?? 0) < n)
      .map(([file, n]) => `${file}: baseline ${n}, now ${counts[file] ?? 0}`);
    expect(stale, 'Run UPDATE_RTL_BASELINE=1 yarn test src/lib/rtl-physical-classes').toEqual([]);
  });
});
