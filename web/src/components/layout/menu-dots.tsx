'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import type { NavGroup, NavItem } from '@/config/dashboard';
import { getMenuState } from '@/lib/actions/menu-state';
import { track } from '@/lib/analytics';
import { isEcommerceBrand } from '@/lib/brand-visibility';
import { formatNumber } from '@/lib/format';
import {
  BROKEN_AREAS,
  areasToRead,
  dotAreasOnMenu,
  dotReason,
  dotOf,
  groupDot,
  itemDot,
  menuDots,
  needsYouShown,
  openActionCount,
  redShown,
  withOpened,
  type Dot,
  type DotArea,
  type DotColour,
  type MenuState,
} from '@/lib/menu-dots';
import { MenuDot } from './menu-dot';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useAdsEnabled } from '@/components/providers/ads-provider';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { useDemoBrand } from '@/components/providers/demo-brand-provider';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useUserRole } from '@/hooks/use-user-role';
import { useBrandStore } from '@/stores/use-brand-store';
import { useMenuStateStore } from '@/stores/use-menu-state-store';

/** How old a read may be before a page change reads again. */
export const MENU_STATE_MAX_AGE_MS = 5 * 60_000;

/** A grey dot reads once more after this, so it goes out soon after its job ends. */
export const GREY_RECHECK_MS = 60_000;

export { MenuDot, useDotLabel } from './menu-dot';

/** The dots on the menu, as the sidebar and the mobile menu show them. */
export interface MenuDotsView {
  /** A submenu entry's, or an item's without one, by its route. */
  dotOf: (href: string) => Dot | null;
  /** An item's: its own, or the strongest of its submenu's. */
  itemDot: (item: Pick<NavItem, 'href' | 'children'>) => Dot | null;
  /** A titled group's, for its title while folded. */
  groupDot: (group: Pick<NavGroup, 'items'>) => Dot | null;
  /** The Action Center's open actions; null shows none. */
  openActions: number | null;
  /** A row with a dot was clicked (menu_dot_clicked). */
  clicked: (dot: Dot | null, collapsed: boolean) => void;
}

/**
 * Reads the brand's menu state for these areas (comma-separated) unless the
 * same read is on its way or under 5 minutes old; a grey dot's `recheck`
 * reads whatever the age. One read serves every menu on the page; a reply
 * for a read since replaced is dropped.
 */
function readMenuState(
  brandId: string,
  areasKey: string,
  count: boolean,
  waiting: boolean,
  red: boolean,
  recheck = false,
) {
  const areas = areasKey ? (areasKey.split(',') as DotArea[]) : [];
  if (areas.length === 0 && !count) return;
  const key = `${brandId}|${areasKey}|${count ? 'count' : ''}|${waiting ? 'waiting' : ''}|${red ? 'red' : ''}`;
  const { read, pending } = useMenuStateStore.getState();
  if (pending === key) return;
  if (!recheck && read?.key === key && Date.now() - read.at < MENU_STATE_MAX_AGE_MS) return;
  useMenuStateStore.setState({ pending: key });
  const done = (state: MenuState | null) => {
    if (useMenuStateStore.getState().pending !== key) return;
    useMenuStateStore.setState({
      read: { key, brandId, at: Date.now(), state, recheck },
      pending: null,
    });
  };
  getMenuState(brandId, { areas, count, waiting, red }).then(done, () => done(null));
}

/**
 * The menu's dots and the Action Center's count: read once per brand
 * (getMenuState) on a brand switch, and again on a page change once the
 * read is 5 minutes old, shared by every menu on the page. Yellow only for admins
 * and managers, and neither yellow nor the count once the plan ended; the
 * demo brand gets green alone. A section off the person's menu or locked
 * by the plan has none.
 */
export function useMenuDots(nav: NavGroup[], collapsed = false): MenuDotsView {
  const pathname = usePathname();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  const { canManage } = useUserRole();
  const { isDemo } = useDemoBrand();
  const { subscriptionActive } = usePlanContext();
  const { canUse, isCloud } = useFeatureGate();
  const hiddenSections = useHiddenMenuSections();
  const chatAgentic = useChatAgentic();
  const ads = useAdsEnabled();
  const viewer = { canAct: canManage, demo: isDemo, ended: !subscriptionActive };

  const onMenu = dotAreasOnMenu(nav, {
    brandPrefs: { ecommerce: isEcommerceBrand(activeBrand) },
    hiddenSections,
    chatAgentic,
    ads,
    canUse,
    isCloud,
  });
  // What to read, as text: the read waits for a change in it, not in a list.
  const areasKey = areasToRead(onMenu, viewer).join(',');
  const count = !viewer.ended;
  // Prompts waiting for a spot light Tracked Prompts yellow: counted only for those who see yellow.
  const waiting = needsYouShown(viewer) && onMenu.has('prompts/tracked');
  // What broke is read only for those who see red, and only with a red entry on their menu.
  const red = redShown(viewer) && BROKEN_AREAS.some((area) => onMenu.has(area));

  useEffect(() => {
    if (brandId) readMenuState(brandId, areasKey, count, waiting, red);
  }, [brandId, areasKey, count, waiting, red, pathname]);

  const read = useMenuStateStore((s) => s.read);
  const opened = useMenuStateStore((s) => (brandId ? s.opened[brandId] : undefined));
  const state = read && read.brandId === brandId ? read.state : null;
  const dots = menuDots(withOpened(state, opened), viewer, onMenu);

  // Something grey: read once more in about a minute, so the dot goes out
  // soon after its job ends. Only after a read of the usual cadence; the
  // re-read asks for no other.
  const recheckAfter =
    read && state?.working && Object.keys(state.working).length > 0 && !read.recheck
      ? read.at
      : null;
  useEffect(() => {
    if (recheckAfter === null || !brandId) return;
    const timer = setTimeout(
      () => readMenuState(brandId, areasKey, count, waiting, red, true),
      GREY_RECHECK_MS,
    );
    return () => clearTimeout(timer);
  }, [recheckAfter, brandId, areasKey, count, waiting, red]);
  const why = (dot: Dot | null): Dot | null =>
    dot && { ...dot, reason: dotReason(state, dot) ?? undefined };

  // menu_dot_shown: once per area each session.
  const shownKey = Object.entries(dots)
    .map(([area, colour]) => `${area}:${colour}`)
    .join(',');
  useEffect(() => {
    for (const entry of shownKey ? shownKey.split(',') : []) {
      const [area, colour] = entry.split(':') as [DotArea, DotColour];
      const { shown } = useMenuStateStore.getState();
      if (shown[area]) continue;
      useMenuStateStore.setState({ shown: { ...shown, [area]: true } });
      track('menu_dot_shown', { area, colour, collapsed });
    }
  }, [shownKey, collapsed]);

  return {
    dotOf: (href) => why(dotOf(dots, href)),
    itemDot: (item) => why(itemDot(dots, item)),
    groupDot: (group) => why(groupDot(dots, group)),
    openActions: openActionCount(state, viewer),
    clicked: (dot, isCollapsed) => {
      if (dot)
        track('menu_dot_clicked', { area: dot.area, colour: dot.colour, collapsed: isCollapsed });
    },
  };
}

/** Where a dot sits on an item's icon: icons only, or a closed submenu's row. */
export const ICON_DOT = 'absolute top-1 ring-2 ring-sidebar';

/** "New results" in words beside Visibility's dot; the dot says it to screen readers. */
export function NewResultsWords() {
  const t = useTranslations('menuDots');
  return (
    <span
      aria-hidden
      className="shrink-0 text-[11px] font-medium text-green-700 dark:text-green-400"
    >
      {t('newResults')}
    </span>
  );
}

/** The Action Center's open actions, unassigned or the person's. */
export function OpenActionsCount({ count }: { count: number }) {
  const t = useTranslations('menuDots');
  const label = t('openActions', { count });
  return (
    <span
      title={label}
      data-open-actions={count}
      className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold tabular-nums text-background"
    >
      <span aria-hidden>{formatNumber(count)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A titled group's name (ANALYTICS, MORE), with its items' dot while it is
 * folded; the name alone otherwise, as it was.
 */
export function FoldedGroupLabel({ label, dot }: { label: string; dot: Dot | null }) {
  if (!dot) return <>{label}</>;
  return (
    <span className="flex items-center gap-2">
      {label}
      <MenuDot dot={dot} />
    </span>
  );
}
