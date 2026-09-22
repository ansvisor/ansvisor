/**
 * Compete — a competitor is gaining visibility, or has passed the brand.
 *
 * One action per cycle however many competitors moved: the response is the
 * same piece of work, and three rows would be three copies of it.
 */
export default {
  id: 'close_competitor_gap',
  version: 1,
  category: 'compete',
  signalKinds: ['competitor_surge', 'competitor_crossed'],
  requires: ['tracking', 'competitors'],
  optional: [],
  tasks: ['analyze_competitor', 'coverage_gaps', 'strengthen_content', 'validate'],

  payload(byKind) {
    const names = new Set();
    for (const signals of byKind.values()) {
      for (const signal of signals) {
        const name = signal.payload?.competitorName;
        if (name) names.add(name);
      }
    }
    return { competitorNames: [...names].slice(0, 3) };
  },
};
