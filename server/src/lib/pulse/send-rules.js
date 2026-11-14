/**
 * Whether "Only when notable" skips this pulse. A brand's very first pulse
 * always goes out, so the person sees their starting point even when there is
 * nothing to highlight yet; after that it needs a highlight or a warning.
 */
export function skipsAsNotNotable({ frequency, isFirstPulse, metrics }) {
  if (frequency !== 'notable' || isFirstPulse) return false;
  return !metrics.highlights.length && !metrics.warnings.length;
}
