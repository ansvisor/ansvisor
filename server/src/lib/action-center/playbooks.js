/**
 * Choosing the play (AC-ACTION-PLAN-BY-BUSINESS-TYPE spec §5, K5; PR P-2).
 *
 * When G15, G16 or C09 opens an action, the chooser reads what its prompts
 * ask and picks the page to write: the play, with the measured reasons
 * behind it and up to two more worth doing for the same prompts. It is kept
 * on the action as `payload.play`:
 *
 *   { version, id, assetType, siteType, reasons, supporting }
 *
 * The definitions' tasks stay as they are. A draft started from the action
 * takes the play's page type (startDraftFromAction), and the drawer shows
 * it under "What to do for {an online store | a SaaS | an app | a travel
 * brand}".
 *
 * Data picks the play, never the business type alone: a play qualifies on
 * its prompts' intents (prompt_volumes.intent), as the spec's rules read
 * them (§7.1, §7.2), and plays are ranked by weight × the share of the
 * prompts' AI searches behind them. The plays here are the ones those
 * intents decide, which every kind of site writes; the plays that read
 * fan-out phrases, cited page and domain classes, the catalog or
 * conversions come with the PRs that bring that data (P-5, P-6, P-7, P-9,
 * P-17, P-18) and join PLAYS. Pure: no reads, no AI call.
 */

/** The definitions the chooser runs for (spec §5): G15, G16, C09. */
export const PLAY_DEFINITIONS = Object.freeze([
  'create_content_for_demand',
  'create_content_for_topics',
  'create_content_for_competitor_gaps',
]);

/** The payload's play format. */
export const PLAY_VERSION = 1;

/**
 * The share of the prompts' AI searches an intent play needs to qualify
 * (first setting, as the spec's fan-out rules read ≥15%).
 */
export const MIN_PLAY_SHARE = 0.15;
/** Plays shown beside the pick (spec §5: the next two). */
export const MAX_SUPPORTING = 2;

/**
 * The plays the prompts' intents decide (spec §7.1, §7.2), with the page
 * type each writes on every kind of site, the intents behind it and its
 * weight. Weights are first settings, to be tuned by the per-play
 * scorecard (§11, P-4). `leads`: it qualifies only as the prompts' biggest
 * intent ("what-is intent leads").
 */
export const PLAYS = Object.freeze([
  {
    id: 'comparison',
    assetType: 'comparison',
    intents: ['comparison', 'vs-review'],
    weight: 1,
  },
  {
    id: 'best_of',
    assetType: 'best_of',
    intents: ['best-top'],
    weight: 1,
  },
  {
    id: 'guide',
    assetType: 'guide',
    intents: ['how-to', 'problem-solving'],
    weight: 0.9,
  },
  {
    id: 'definition',
    assetType: 'definition',
    intents: ['what-is'],
    weight: 0.8,
    leads: true,
  },
]);

const PLAY_IDS = new Set(PLAYS.map((play) => play.id));

/** Whether a play id is one the chooser picks (the drawer names only those). */
export function isPlayId(id) {
  return PLAY_IDS.has(id);
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * The prompts' demand by intent: each intent's prompts and AI searches,
 * and the total. A prompt with no volume counts one search, so a topic
 * whose volumes aren't read yet is still read by its prompts.
 *
 * @param {Array<{ id: string, intent: string|null, volume: number|null }>} prompts
 */
export function intentMix(prompts) {
  const byIntent = new Map();
  let total = 0;
  let known = 0;
  for (const prompt of prompts) {
    const weight = Number.isFinite(prompt.volume) && prompt.volume > 0 ? prompt.volume : 1;
    total += weight;
    if (!prompt.intent) continue;
    known += 1;
    const entry = byIntent.get(prompt.intent) ?? { prompts: 0, volume: 0 };
    entry.prompts += 1;
    entry.volume += weight;
    byIntent.set(prompt.intent, entry);
  }
  return { byIntent, total, prompts: prompts.length, known };
}

/**
 * The plays the prompts qualify for, best first: each with its score
 * (weight × share), its share of the prompts' AI searches and how many of
 * them ask for it.
 */
export function rankPlays(prompts) {
  const mix = intentMix(prompts);
  if (!mix.known || !mix.total) return [];
  const lead = Math.max(...[...mix.byIntent.values()].map((entry) => entry.volume));
  const ranked = [];
  for (const play of PLAYS) {
    const behind = play.intents.map((intent) => mix.byIntent.get(intent)).filter(Boolean);
    const volume = behind.reduce((sum, entry) => sum + entry.volume, 0);
    const count = behind.reduce((sum, entry) => sum + entry.prompts, 0);
    if (!count) continue;
    const share = volume / mix.total;
    if (share < MIN_PLAY_SHARE) continue;
    if (play.leads && behind.every((entry) => entry.volume < lead)) continue;
    ranked.push({
      play,
      score: round(play.weight * share),
      share: round(share),
      prompts: count,
      of: mix.prompts,
    });
  }
  // Best first; on a tie, in PLAYS' order.
  return ranked.sort((a, b) => b.score - a.score || PLAYS.indexOf(a.play) - PLAYS.indexOf(b.play));
}

/**
 * The play for an action's prompts on a kind of site (above), as the
 * payload keeps it; null when none qualifies (no intents read, or none
 * strong enough): then nothing is proposed rather than a guess.
 *
 * @param {{ siteType: string,
 *   prompts: Array<{ id: string, intent: string|null, volume: number|null }> }} input
 */
export function choosePlay({ siteType, prompts }) {
  const [top, ...rest] = rankPlays(prompts);
  if (!top) return null;
  return {
    version: PLAY_VERSION,
    id: top.play.id,
    assetType: top.play.assetType,
    siteType,
    reasons: [
      {
        kind: 'intent',
        intents: top.play.intents,
        prompts: top.prompts,
        of: top.of,
        share: top.share,
      },
    ],
    supporting: rest.slice(0, MAX_SUPPORTING).map((entry) => ({
      id: entry.play.id,
      assetType: entry.play.assetType,
      prompts: entry.prompts,
      of: entry.of,
      share: entry.share,
    })),
  };
}
