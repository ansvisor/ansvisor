/**
 * Recover — the brand held a position and lost it.
 *
 * Kept apart from protect_visibility on purpose: the work differs. Recovering
 * asks what was lost and how to win it back; protecting asks what is slipping
 * and how to hold it, while the position still exists to hold.
 */
export default {
  id: 'recover_visibility',
  version: 1,
  category: 'recover',
  signalKinds: ['sharp_drop', 'lost_citations'],
  requires: ['tracking'],
  // Traffic is not needed to raise the action, but with it connected the plan
  // can show what the drop cost in sessions rather than only in points.
  optional: ['analytics'],
  tasks: ['analyze_losses', 'coverage_gaps', 'update_content', 'internal_links', 'validate'],

  payload(byKind) {
    const out = { promptCount: (byKind.get('lost_citations') ?? []).length };
    const drop = (byKind.get('sharp_drop') ?? [])[0];
    if (drop) {
      out.dropFrom = drop.previous_value;
      out.dropTo = drop.current_value;
    }
    return out;
  },
};
