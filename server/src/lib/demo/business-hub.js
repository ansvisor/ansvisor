/**
 * The demo brand's ChatGPT Business Hub numbers (00526): four weekly
 * entries, as a member would copy them from Business Hub, so Visibility's
 * Business Hub card can be seen in the demo. Each ends a week after the one
 * before, the newest a week before the day of the latest run: this week's
 * are due, and the Action Center's weekly reminder asks for them
 * (action-center.js, with BUSINESS_HUB_ENABLED). The second-oldest has no
 * Profile views, as Business Hub shows none below its threshold; the rest
 * grow a little each week. Its topics are the questions coffee buyers bring
 * to ChatGPT, two of them the demo's own tracked topics.
 */

import supabaseAdmin from '../../config/supabase.js';
import { latestRunStart } from './core.js';
import { demoId } from './random.js';
import { demoWriter } from './write.js';

const DAY_MS = 86_400_000;

/** Oldest first: Mentions, Website clicks, Profile views (null: not shown), topics. */
const WEEKS = [
  {
    mentions: 41,
    websiteClicks: 12,
    profileViews: 96,
    topics: [
      'Coffee subscriptions',
      'Whole bean coffee',
      'Espresso beans for home',
      'Low acid coffee',
      'Coffee gifts',
    ],
  },
  {
    mentions: 46,
    websiteClicks: 15,
    profileViews: null,
    topics: [
      'Coffee subscriptions',
      'Espresso beans for home',
      'Whole bean coffee',
      'Decaf coffee',
      'Coffee gifts',
    ],
  },
  {
    mentions: 44,
    websiteClicks: 14,
    profileViews: 118,
    topics: [
      'Coffee subscriptions',
      'Whole bean coffee',
      'Espresso beans for home',
      'Coffee roast dates',
      'Low acid coffee',
    ],
  },
  {
    mentions: 53,
    websiteClicks: 19,
    profileViews: 131,
    topics: [
      'Coffee subscriptions',
      'Espresso beans for home',
      'Whole bean coffee',
      'Low acid coffee',
      'Single origin coffee',
    ],
  },
];

/**
 * The table's unique key (00526: unique (brand_id, period_days, period_end)),
 * which a rebuild writes over. Keyed by id, a rebuild a week on moved each
 * entry onto the end its newer neighbour still held, and broke that key.
 */
const KEYS = { business_hub_snapshots: 'brand_id,period_days,period_end' };

/** A UTC day as YYYY-MM-DD. */
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The newest entry ends this many days before the latest run's (UTC) day: the numbers are due. */
export const NEWEST_DAYS_AGO = 7;

/**
 * The four entries, the newest ending NEWEST_DAYS_AGO before the latest
 * run's day (UTC), each entered the morning after it ends.
 *
 * @param {{ brandId: string, now: Date }} ctx
 */
export function businessHubRows({ brandId, now }) {
  const runDay = Date.parse(dayOf(latestRunStart(now).getTime()));
  return WEEKS.map((week, i) => {
    const weeksBack = WEEKS.length - 1 - i;
    const end = runDay - NEWEST_DAYS_AGO * DAY_MS - weeksBack * 7 * DAY_MS;
    const entered = new Date(Math.min(end + DAY_MS + 9 * 3_600_000, now.getTime())).toISOString();
    // The id follows the key, so the row a rebuild writes over keeps its own.
    return {
      id: demoId(brandId, `business-hub:7:${dayOf(end)}`),
      brand_id: brandId,
      period_days: 7,
      period_end: dayOf(end),
      mentions: week.mentions,
      website_clicks: week.websiteClicks,
      profile_views: week.profileViews,
      discovery_topics: week.topics,
      source: 'manual',
      entered_by: null,
      created_at: entered,
      updated_at: entered,
    };
  });
}

export const businessHub = {
  name: 'businessHub',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  keys: KEYS,
  tables: ['business_hub_snapshots'],

  /**
   * Through the build's writer (a writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild, keys: KEYS }).write,
  }) {
    const rows = businessHubRows({ brandId, now });
    await write('business_hub_snapshots', rows);
    return { snapshots: rows.length };
  },
};
