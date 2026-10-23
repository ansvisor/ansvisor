/**
 * The Content Editor's Quality scores (Quality spec §2): E-E-A-T, Trust and
 * Readability, 0–100 each, shown in Instructions › Quality and as one
 * "Quality {avg}" chip in the header. Ansvisor estimates, not Google scores.
 */

/** Which of the spec's three phases are live (NEXT_PUBLIC_CONTENT_QUALITY_PHASE): 0 is none. */
export function qualityPhase(): number {
  const phase = Number(process.env.NEXT_PUBLIC_CONTENT_QUALITY_PHASE ?? 0);
  return Number.isInteger(phase) && phase > 0 ? Math.min(phase, 3) : 0;
}

export type QualityBand = 'strong' | 'improve' | 'needsWork';

/** 80+ Strong, 60–79 Can improve, under 60 Needs work (spec §2). */
export function qualityBand(score: number): QualityBand {
  return score >= 80 ? 'strong' : score >= 60 ? 'improve' : 'needsWork';
}

/** The band's colours: green, amber, red, each with its dark mode. */
export const BAND_CLASSES: Record<QualityBand, string> = {
  strong:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  improve:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  needsWork:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
};

/** The header chip's figure: the scores that could be read, averaged; null with none. */
export function qualityAverage(scores: (number | null)[]): number | null {
  const read = scores.filter((s): s is number => s !== null);
  return read.length ? Math.round(read.reduce((a, b) => a + b, 0) / read.length) : null;
}
