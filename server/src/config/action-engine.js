/**
 * Action Engine thresholds — the numbers that decide what counts (#818).
 *
 * Every value here answers a judgement call: how far something has to move
 * before it is a signal, how much evidence is enough to raise an action, how
 * long to wait before believing a measurement. They were scattered across the
 * detectors that used them, which is survivable at a dozen detectors and
 * unmanageable at forty — and phase 3 brings forty. Tuning the engine should
 * mean editing this file, not going hunting.
 *
 * Grouped by the question each number answers rather than by the file that
 * currently reads it, so a later refactor moving a detector does not move its
 * threshold.
 *
 * Resolution order, per the specification: system default → definition
 * default → workspace override. Only the first exists today; `resolve()` is
 * the seam the other two arrive through, so callers already read their
 * thresholds through a function rather than a constant and none of them has
 * to change when they do.
 *
 * What is deliberately *not* here: retry counts, page sizes, poll intervals,
 * display limits. Those are operational choices with one right answer, not
 * product judgements anyone would want to tune per workspace.
 */

/**
 * @typedef {typeof ENGINE_THRESHOLDS} EngineThresholds
 */
export const ENGINE_THRESHOLDS = Object.freeze({
  /** What a detector looks at, and how much movement it takes to speak up. */
  detection: Object.freeze({
    /** Days of history a detector compares against. */
    windowDays: 7,

    /**
     * A visibility fall is judged by how much of the brand's own level it
     * took, not by a fixed number of points.
     *
     * Brands sit anywhere from under 1% to 88% visible; a points threshold
     * decides which of them are allowed to have the signal at all. At 15
     * points a brand sitting at 12% could lose four fifths of its visibility
     * unreported, having never had 15 points to lose — which is why the
     * detector had not fired once in production.
     *
     * The floor exists only to clear measurement noise: week-to-week movement
     * averages 1.2 points across live brands, so 3 sits comfortably above the
     * wobble without excluding anyone. Measured across 124 brands, the pair
     * reports about four a week.
     */
    visibilityDropRatio: 0.3,
    visibilityDropFloorPoints: 3,
    /** Below this many tracked prompts the average is too thin to trust. */
    visibilityDropMinPrompts: 10,

    /**
     * Early deterioration — the Protect family's trigger.
     *
     * Judged relatively like the collapse above, one band below it, so the two
     * grades are measured the same way and differ only in severity. A fixed
     * points band would have been almost empty: with the collapse at 30% of a
     * baseline, five points from a baseline of twenty leaves less than a point
     * of room between the grades.
     *
     * The baseline keeps it to brands with something to protect. Scores across
     * live brands average 9.8 and top out at 48, so ten is "above average" —
     * a real position, not a brand that was barely visible to begin with.
     */
    slippingMinRatio: 0.1,
    slippingMinBaseline: 10,

    /** A competitor's rise, in points, before it is worth reporting. */
    competitorSurgePoints: 15,

    /** Cited on this share of days, then nothing — the pattern that makes a
     *  gap look deliberate rather than random. */
    lostCitationCitedRatio: 0.6,
    /** Consecutive result-days with no citation before calling it lost. */
    lostCitationQuietDays: 3,

    /** A rise smaller than this is not a story worth telling. */
    moverMinGain: 5,

    /** Mentioned across at least this many prompts before an uncited-mentions
     *  signal is worth an action: one prompt is an anecdote. */
    uncitedMinPrompts: 3,

    /**
     * A platform gap worth naming.
     *
     * Platforms differ for everyone: the spread between a brand's best and
     * worst averages 12 points across live brands, so a gap alone is the
     * normal state. Twenty is comfortably above that average, and the floor
     * on the best platform is what makes the gap mean "achievable here,
     * absent there" rather than "weak everywhere". Together they report
     * about one brand in five.
     */
    platformGapPoints: 20,
    platformBestFloor: 25,
    /** A platform needs this many tracked prompts before its rate is a rate,
     *  and this many platforms must qualify before a comparison is one. */
    platformMinPrompts: 10,
    platformMinCompared: 3,

    /**
     * A citation gap worth naming.
     *
     * A competitor leads two thirds of brands on citations in any given week,
     * so being behind is not the signal — being behind by a multiple is. The
     * absolute floor keeps the multiple off small numbers, where twice as
     * many citations can mean four against two. Reports about one brand in
     * four.
     */
    citationGapMultiple: 2,
    citationGapMinAbsolute: 20,

    /** Site Audit score below this is a problem; an audit older than this is
     *  not evidence about the page as it stands today. */
    auditLowScore: 50,
    auditMaxAgeDays: 90,

    /** A page earning at least this many sessions, in the top percentile of
     *  its brand's pages, is worth acting on. Below it, the opportunity is
     *  too small to spend anyone's week on. */
    pageMinSessions: 10,
    pageMinPercentile: 70,
    /** Window the page opportunity detector measures over. Longer than the
     *  others: traffic needs weeks to say anything. */
    pageWindowDays: 28,
  }),

  /** Guards against the engine talking over itself. */
  noise: Object.freeze({
    /**
     * How long a kind rests after a cycle closes before a new one may open.
     * Without it, a condition that is still firing produces a fresh action
     * the night after someone closed the last one — a treadmill.
     */
    restAfterCloseDays: 14,

    /**
     * How many new actions one brand may be given in a day.
     *
     * A ceiling, not a target. Today it binds on nothing: eight definitions
     * produce at most three actions on a brand's busiest day, because a brand
     * rarely has more than a couple of distinct conditions firing at once.
     * The ceiling is the definition count, and the plan takes that to sixty —
     * at which point a bad night could hand someone a list nobody reads, and
     * the engine would have talked its way out of being believed.
     *
     * Five is what one person can plausibly start on in a week. Anything over
     * it is not lost: the condition is still firing, so the slot opens again
     * tomorrow, in priority order.
     */
    maxNewActionsPerDay: 5,

    /**
     * How many tasks the engine may carry out for itself in one nightly sweep,
     * across every brand.
     *
     * A ceiling on a night that goes wrong, not a target. Every tool reads —
     * one from our own rollups, one from the brand's analytics property — so
     * the cost of overshooting is API calls and time rather than damage, but a
     * detector misfiring across the base should not turn into a thousand
     * requests to a third party before anyone is awake to see it.
     *
     * Sized from what exists: seven brands have analytics connected and an
     * action carries at most two tool-backed tasks, so a normal night is well
     * under this. Reaching it is a signal in itself, and the sweep says so.
     */
    maxTaskRunsPerNight: 50,

    /**
     * Platform-wide result volume collapsing to this fraction of its trailing
     * daily average is a collection incident on our side, not a visibility
     * change on the customer's. Signals are suppressed rather than reported.
     */
    outageCollapseRatio: 0.25,
    /** Below this daily baseline the ratio above is meaningless. */
    outageMinBaseline: 20,
  }),

  /**
   * How the queue of waiting findings is ordered (#818 phase 6).
   *
   * Everything the engine finds becomes a candidate; only some become actions
   * tonight, because a definition's slot may be busy, resting, or the brand
   * may already have had its day's worth. These weights decide which of the
   * ones that can be promoted goes first.
   *
   * They reproduce the ordering the Action Center has always sorted by —
   * impact, then weight of evidence — and add the one thing a queue needs
   * that a sort does not: age. Without it a low-impact finding sitting behind
   * a brand with a steady stream of urgent ones would never be worked on at
   * all.
   *
   * The numbers are chosen so two rules hold, and the arithmetic is the only
   * thing enforcing them:
   *
   *   * **Nothing starves.** A full two-week wait is worth 42, and the gap
   *     between low and medium is 35 — so a low-impact finding that has
   *     waited out the cap outranks a medium one detected tonight with
   *     comparable evidence. Patience is worth one grade.
   *   * **A high-impact finding is never outranked.** It sits at 200, out of
   *     reach of any wait and any amount of evidence (65 + 15 + 42 = 122 at
   *     most). A brand losing ground right now is worked on before a queue of
   *     older, milder findings, however patient — a queue that lets forty
   *     pages of low-impact opportunity outrank a visibility collapse is not
   *     a priority order, it is a vote.
   */
  priority: Object.freeze({
    impactHigh: 200,
    impactMedium: 65,
    impactLow: 30,
    /** Per linked signal, up to `evidenceCap` signals: at most 15. */
    evidencePerSignal: 1.5,
    evidenceCap: 10,
    /** Per day waited, up to `ageCapDays` days: at most 42. */
    agePerDay: 3,
    ageCapDays: 14,
  }),

  /** How an action's effect is measured once it closes. */
  validation: Object.freeze({
    /** Length of the before and after windows. Equal, so the comparison is
     *  between like periods. */
    windowDays: 7,

    /**
     * How much a metric must move to count as movement, as a fraction of its
     * before value. These numbers drift week to week on their own; without a
     * floor every outcome would be a verdict and none would mean anything.
     */
    meaningfulChangeRatio: 0.05,
  }),
});

/**
 * Thresholds for one caller, with overrides layered over the defaults.
 *
 * Merges one group deep — `resolve({ detection: { windowDays: 14 } })` keeps
 * every other detection threshold. Deeper nesting would invite a config that
 * is harder to read than the code it configures.
 *
 * @param {Partial<Record<keyof EngineThresholds, Record<string, number>>>} [overrides]
 * @returns {EngineThresholds}
 */
export function resolve(overrides) {
  if (!overrides) return ENGINE_THRESHOLDS;
  const merged = {};
  for (const [group, defaults] of Object.entries(ENGINE_THRESHOLDS)) {
    merged[group] = Object.freeze({ ...defaults, ...(overrides[group] ?? {}) });
  }
  return Object.freeze(merged);
}
