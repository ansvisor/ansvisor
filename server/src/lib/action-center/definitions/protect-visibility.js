/**
 * Protect — a real position losing ground, caught before it collapses.
 *
 * The Protect family's first definition (#823). Its trigger is the relative
 * slip detector rather than the collapse, so the two grades differ in
 * severity and in the work they ask for, not in how they are measured.
 */
export default {
  id: 'protect_visibility',
  version: 1,
  category: 'protect',
  signalKinds: ['visibility_slipping'],
  requires: ['tracking'],
  // Who is taking the ground is context, not a precondition.
  optional: ['competitors'],
  tasks: ['diagnose_slip', 'review_responses', 'reinforce_content', 'validate'],

  payload(byKind) {
    const slip = (byKind.get('visibility_slipping') ?? [])[0];
    if (!slip) return {};
    return { dropFrom: slip.previous_value, dropTo: slip.current_value };
  },
};
