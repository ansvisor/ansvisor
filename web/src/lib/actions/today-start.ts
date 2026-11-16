'use server';

import { getTodayOverview, getTodayStanding, type TodayOverview } from '@/lib/actions/today';
import { getTodayChanges, type TodayChanges } from '@/lib/actions/today-changes';
import { getTodayFocus, type FocusCard } from '@/lib/actions/today-focus';
import { getTodayWaiting, type TodayWaiting } from '@/lib/actions/today-waiting';
import { getGettingStarted } from '@/lib/actions/getting-started';
import { readUserBrandState } from '@/lib/actions/user-brand-state';
import type { TodayStanding } from '@/lib/action-center/focus';
import type { GettingStartedStatus } from '@/lib/getting-started/steps';
import type { UserBrandState } from '@/lib/user-brand-state';

/**
 * Today's reads, each a promise of its own that the page's part waits for.
 * A part the day doesn't show is null: on a brand's first day, the normal
 * day's parts; after the plan ended, all but the focus.
 */
export interface TodayStart {
  overview: Promise<TodayOverview>;
  state: Promise<UserBrandState | null>;
  focus: Promise<FocusCard[] | null>;
  changes: Promise<TodayChanges | null>;
  waiting: Promise<TodayWaiting | null>;
  setup: Promise<GettingStartedStatus | null>;
  standing: Promise<TodayStanding | null>;
}

/**
 * Action Center › Today's first reads, as the signed-in person, in one
 * call. The browser runs Server Actions one at a time, so Today's parts,
 * each asked for on its own, read one after another; here they start
 * together on the server, and each part comes back as soon as it has
 * read. The focus and Since yesterday read from the person's last visit,
 * and the normal day's parts start once the overview says the brand has
 * answers (a failed overview reads them, as the page then shows the normal
 * day). Each part fails on its own, and only its part stays away.
 */
export async function getTodayStart(
  brandId: string,
  browserZone: string | null,
  hidden: string[],
  ended: boolean,
): Promise<TodayStart> {
  const overview = getTodayOverview(brandId, browserZone);
  const state = readUserBrandState(brandId);
  const seenAt = state.then((read) => read?.navSeen.today ?? null);
  const day: Promise<'ended' | 'day1' | 'normal'> = ended
    ? Promise.resolve('ended')
    : overview.then(
        (read) => (read.lastRunAt === null ? 'day1' : 'normal'),
        () => 'normal',
      );
  const on = <T>(days: string[], read: () => Promise<T>): Promise<T | null> =>
    day.then((today) => (days.includes(today) ? read() : null));
  const start: TodayStart = {
    overview,
    state,
    focus: on(['normal', 'ended'], async () => getTodayFocus(brandId, await seenAt)),
    changes: on(['normal'], async () => getTodayChanges(brandId, await seenAt, hidden)),
    waiting: on(['normal'], () => getTodayWaiting(brandId, browserZone)),
    setup: on(['normal'], () => getGettingStarted(brandId)),
    standing: on(['normal'], () => getTodayStanding(brandId)),
  };
  // Handled from the start: a part that fails before the response takes it
  // is still sent as failed, never an unhandled rejection.
  for (const part of Object.values(start)) (part as Promise<unknown>).catch(() => {});
  return start;
}
