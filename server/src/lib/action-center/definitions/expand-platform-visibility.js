/**
 * Growth — the brand ranks on one engine and is absent on another.
 *
 * It is the engine, not the material, that differs: content that already
 * ranks somewhere proves the content can rank, which is what separates this
 * from a brand that is simply weak everywhere.
 */
export default {
  id: 'expand_platform_visibility',
  version: 1,
  category: 'growth',
  signalKinds: ['platform_gap'],
  requires: ['tracking'],
  optional: [],
  tasks: ['compare_platforms', 'coverage_gaps', 'optimize_content', 'validate'],

  payload(byKind) {
    const gap = (byKind.get('platform_gap') ?? [])[0];
    if (!gap) return {};
    return {
      platform: gap.payload?.platform,
      bestPlatform: gap.payload?.bestPlatform,
      dropFrom: gap.previous_value,
      dropTo: gap.current_value,
    };
  },
};
