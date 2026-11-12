'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { getSettingsState } from '@/lib/actions/settings-state';
import { markSeen } from '@/lib/actions/user-brand-state';
import {
  SETTINGS_SEEN_KEYS,
  settingsDots,
  strongestSettingsDot,
  type SettingsDot,
  type SettingsDotPlace,
  type SettingsDots,
  type SettingsSeenPlace,
  type SettingsState,
} from '@/lib/settings-dots';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useUserRole } from '@/hooks/use-user-role';
import { useBrandStore } from '@/stores/use-brand-store';
import { useSettingsStateStore } from '@/stores/use-settings-state-store';
import { MENU_STATE_MAX_AGE_MS } from './menu-dots';
import { MenuDot, useDotLabel } from './menu-dot';

/**
 * Reads Settings' state for the brand open now unless the same read is on
 * its way or under 5 minutes old, the menu's cadence. A reply for a read
 * since replaced is dropped.
 */
function readSettingsState(brandId: string | null) {
  const key = brandId ?? '';
  const { read, pending } = useSettingsStateStore.getState();
  if (pending === key) return;
  if (read?.key === key && Date.now() - read.at < MENU_STATE_MAX_AGE_MS) return;
  useSettingsStateStore.setState({ pending: key });
  const done = (state: SettingsState | null) => {
    if (useSettingsStateStore.getState().pending !== key) return;
    useSettingsStateStore.setState({ read: { key, at: Date.now(), state }, pending: null });
  };
  getSettingsState(brandId).then(done, () => done(null));
}

export interface SettingsDotsView {
  /** Each place's dot. */
  dots: SettingsDots;
  /** The strongest, for the footer's avatar and gear. */
  top: SettingsDot | null;
  /** The read, for Members' note on who joined. */
  state: SettingsState | null;
}

/**
 * Settings' dots, for admins and managers only (nothing is read for anyone
 * else): read with the menu's cadence, on a brand switch and on a page
 * change once 5 minutes old.
 */
export function useSettingsDots(): SettingsDotsView {
  const pathname = usePathname();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { canManage } = useUserRole();
  const { isCloud, subscriptionStatus, trialEndsAt } = usePlanContext();

  useEffect(() => {
    if (canManage) readSettingsState(brandId);
  }, [canManage, brandId, pathname]);

  const read = useSettingsStateStore((s) => s.read);
  const opened = useSettingsStateStore((s) => s.opened[brandId ?? '']);
  if (!canManage) return { dots: {}, top: null, state: null };
  const state = read && read.key === (brandId ?? '') ? read.state : null;
  const dots = settingsDots(
    state,
    opened ?? {},
    { isCloud, subscriptionStatus, trialEndsAt },
    new Date(),
  );
  return { dots, top: strongestSettingsDot(dots), state };
}

/**
 * Opening a place clears its green: here at once, and on the server for the
 * next read (user_brand_state.nav_seen on the brand open now).
 */
export function markSettingsSeen(brandId: string | null, place: SettingsSeenPlace) {
  useSettingsStateStore.getState().markOpened(brandId ?? '', place, new Date().toISOString());
  if (!brandId) return;
  markSeen(brandId, SETTINGS_SEEN_KEYS[place]).catch(() => {
    // Offline: the dot is cleared here; the next visit keeps it.
  });
}

/** The place a Settings section is, whose dot it carries. */
export function settingsPlaceOf(section: string): SettingsDotPlace | null {
  if (section === 'team' || section === 'roles-access') return 'members';
  if (section === 'integrations') return 'integrations';
  if (section === 'api-keys') return 'api';
  if (section === 'billing') return 'billing';
  return null;
}

/** "Ayşe, Mehmet, Can", and how many more. */
export function useJoinedNames(): (names: string[], count: number) => string {
  const t = useTranslations('settingsDots');
  return (names, count) => {
    const more = count - names.length;
    const list = names.join(', ');
    if (!list) return t('people', { count });
    return more > 0 ? t('namesAndMore', { names: list, count: more }) : list;
  };
}

/** What a Settings dot says: "3 people joined: Ayşe, Mehmet, Can". */
export function useSettingsDotWords(): (dot: SettingsDot) => string {
  const t = useTranslations('settingsDots');
  const names = useJoinedNames();
  return ({ reason }) => {
    switch (reason.kind) {
      case 'joined':
        return t('joined', { count: reason.count, names: names(reason.names, reason.count) });
      case 'inviteExpired':
        return t('inviteExpired', { count: reason.count });
      case 'integrationBroken':
        return t('integrationBroken', { provider: reason.provider });
      case 'integrationNew':
        return reason.by
          ? t('integrationNew', { provider: reason.provider, by: reason.by })
          : t('integrationNewSomeone', { provider: reason.provider });
      case 'clientNew':
        return t('clientNew', { name: reason.name });
      case 'trialEnding':
        return t('trialEnding', { days: reason.days });
      default:
        return t(reason.kind);
    }
  };
}

/** A Settings dot: the menu's, named by its colour and why ("Needs you: the seat limit is reached"). */
export function SettingsDotMark({ dot, className }: { dot: SettingsDot; className?: string }) {
  const t = useTranslations('menuDots');
  const colourWords = useDotLabel()({ colour: dot.colour });
  const words = useSettingsDotWords()(dot);
  return (
    <MenuDot
      dot={{ colour: dot.colour }}
      label={t('withReason', { dot: colourWords, reason: words })}
      className={className}
    />
  );
}
