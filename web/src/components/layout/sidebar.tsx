'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { usePathname, Link } from '@/i18n/navigation';
import { carriedParams, PROMPTS_BASE } from '@/lib/prompts-routes';
import { dashboardNav, type NavGroup } from '@/config/dashboard';
import { saveChatRailOpen } from '@/lib/actions/chat-prefs';
import {
  activeChildHref,
  CHAT_AGENTIC_HREF,
  childLinkHref,
  dashboardNavBadge,
  getDashboardNavLabel,
  getDashboardNavGroupLabel,
  isNavItemActive,
  navItemHref,
  shouldShowDashboardNavItem,
  visibleNavChildren,
} from '@/lib/dashboard-navigation';
import { brandVisibilityTabOf, isEcommerceBrand } from '@/lib/brand-visibility';
import { BrandVisibilityTabLink } from '@/components/brand-visibility/tabs';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useAdsEnabled } from '@/components/providers/ads-provider';
import { useSidebarStore } from '@/stores/use-sidebar-store';
import { useChatRailStore } from '@/stores/use-chat-rail-store';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useAgentKeyStatus } from '@/hooks/use-agent-key-status';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { BrandSwitcher } from '@/components/layout/brand-switcher';
import { UserProfileNavItem } from '@/components/layout/user-profile-nav-item';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { NewPill } from '@/components/agentic/new-pill';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { menuSectionOf } from '@/lib/menu-access';
import { ACTION_CENTER_ITEM, NEW_RESULTS_ITEM } from '@/lib/menu-dots';
import {
  FoldedGroupLabel,
  ICON_DOT,
  MenuDot,
  NewResultsWords,
  OpenActionsCount,
  useDotLabel,
  useMenuDots,
} from '@/components/layout/menu-dots';
import { ChevronDown, ChevronsLeft, ChevronsRight, Crown, Lock } from 'lucide-react';

/** How long the pointer rests on the collapsed sidebar before it opens. */
const PEEK_DELAY_MS = 150;

/**
 * The menu's viewport. Its edges fade out where items are hidden above or
 * below, by as much as has scrolled out (up to 1.5rem), so a long menu says
 * there's more without a heavier control (prefixed too, for Chromium before
 * 120). The scroll padding keeps an item scrolled into view (the current
 * page, keyboard focus) clear of the fade. It only scrolls up and down: while
 * a collapsed sidebar widens, its labels would otherwise scroll it sideways.
 * Base UI makes it a tab stop once it overflows, so its focus ring sits
 * inside, where the fade can't clip it.
 */
const NAV_VIEWPORT =
  'px-2 py-3 scroll-py-6 overflow-x-hidden! focus-visible:ring-inset [--nav-fade:1.5rem] [--nav-mask:linear-gradient(to_bottom,transparent,#000_min(var(--nav-fade),var(--scroll-area-overflow-y-start,0px)),#000_calc(100%_-_min(var(--nav-fade),var(--scroll-area-overflow-y-end,0px))),transparent)] [mask-image:var(--nav-mask)] [-webkit-mask-image:var(--nav-mask)]';

/**
 * A slim scrollbar over the menu's right edge: it shows only while the pointer
 * is on the menu or it is scrolling, and never takes width from the items.
 */
const NAV_SCROLLBAR =
  'data-vertical:w-2 opacity-0 transition-opacity duration-300 data-hovering:opacity-100 data-scrolling:opacity-100 data-scrolling:duration-75 [&>[data-slot=scroll-area-thumb]]:bg-muted-foreground/25 [&>[data-slot=scroll-area-thumb]:hover]:bg-muted-foreground/45';

/** A menu's items that open a submenu (the Action Center, Prompts, Brand Visibility, Content). */
function expandableItemsOf(nav: NavGroup[]) {
  return nav.flatMap((group) => group.items.filter((item) => item.children?.length));
}
const EXPANDABLE_HREFS = expandableItemsOf(dashboardNav).map((item) => item.href);

/**
 * Where a submenu's open/closed state is remembered, per item: Prompts keeps
 * its key from PROMPT-001 (ansvisor.sidebar.promptsOpen), Content gets
 * ansvisor.sidebar.contentOpen, the Action Center
 * ansvisor.sidebar.action-centerOpen.
 */
function submenuKey(href: string) {
  return `ansvisor.sidebar.${href.split('/').pop()}Open`;
}

/**
 * Where a titled group's open/closed state is remembered:
 * ansvisor.sidebar.group.analyticsOpen, ansvisor.sidebar.group.moreOpen.
 */
function groupKey(title: string) {
  return `ansvisor.sidebar.group.${title.toLowerCase()}Open`;
}

/** The titled groups (Analytics, More), which fold under their title. */
const GROUP_TITLES = dashboardNav.flatMap((group) => (group.title ? [group.title] : []));

/**
 * Arrow keys in the sidebar's links (PROMPT-001): up and down move between
 * them; right opens a submenu (or enters it), left leaves or closes it.
 * Enter follows the focused link, as links do.
 */
function handleNavKeys(
  e: React.KeyboardEvent<HTMLElement>,
  setSubmenuOpen: (href: string, open: boolean) => void,
) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]')];
  const current = document.activeElement as HTMLElement | null;
  const i = current ? items.indexOf(current) : -1;
  if (i < 0) return;
  const focus = (el: HTMLElement | undefined) => {
    if (!el) return;
    e.preventDefault();
    el.focus();
  };
  const isParent = current?.dataset.navItem === 'parent';
  const isChild = current?.dataset.navItem === 'child';
  const submenu = current?.dataset.submenu ?? '';
  if (e.key === 'ArrowDown') focus(items[i + 1]);
  else if (e.key === 'ArrowUp') focus(items[i - 1]);
  else if (e.key === 'ArrowRight' && isParent) {
    e.preventDefault();
    if (current?.getAttribute('aria-expanded') === 'true') focus(items[i + 1]);
    else setSubmenuOpen(submenu, true);
  } else if (e.key === 'ArrowLeft' && isParent) {
    e.preventDefault();
    setSubmenuOpen(submenu, false);
  } else if (e.key === 'ArrowLeft' && isChild) {
    focus(
      items
        .slice(0, i)
        .reverse()
        .find((el) => el.dataset.navItem === 'parent'),
    );
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed: pinnedClosed, toggleCollapse } = useSidebarStore();
  // On Chat's screens (the new Chat on) the sidebar is the rail unless the
  // person expanded it with the logo, a choice kept on them for every device
  // (CHAT-01 item 4f); elsewhere it keeps its own pinned state.
  const chatAgentic = useChatAgentic();
  const nav = dashboardNav;
  const onChat =
    chatAgentic && (pathname === CHAT_AGENTIC_HREF || pathname.startsWith(`${CHAT_AGENTIC_HREF}/`));
  const railOpen = useChatRailStore((s) => s.open);
  const setRailOpen = useChatRailStore((s) => s.setOpen);
  const isCollapsed = onChat ? !railOpen : pinnedClosed;
  // A collapsed sidebar opens over the page while the pointer is on it
  // ("peeking") and while its brand menu is open, and closes again after.
  const [peeking, setPeeking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const asideRef = useRef<HTMLElement>(null);
  const compact = isCollapsed && !peeking && !menuOpen;
  const searchParams = useSearchParams();
  const underPrompts = pathname.startsWith(PROMPTS_BASE);
  // Each submenu (Prompts, Content): remembered per browser, open until closed,
  // and open whenever one of its routes is showing so the current view is
  // always visible in it.
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({});
  const isSubmenuOpen = (href: string) => openMenus[href] ?? true;
  // Brand Visibility's tabs keep their own routes (Mentions, Citations), so
  // an item is under the page shown when one of its entries is.
  const underMenu =
    expandableItemsOf(nav).find((item) => isNavItemActive(item, pathname))?.href ?? null;
  // Each titled group (Execution, Analytics) folds under its title the same
  // way: remembered per browser, open until closed, and open whenever one of
  // its pages is showing.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const isGroupOpen = (title: string) => openGroups[title] ?? true;
  const underGroup =
    nav.find((group) => group.title && group.items.some((item) => isNavItemActive(item, pathname)))
      ?.title ?? null;
  const t = useTranslations('nav');
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();
  // Probe once per session whether the org has a provider key for Chat.
  // Returns 'configured' immediately on self-host and with the new Chat on
  // (no network call): that one runs on the plan's AI limit.
  const agentKeyStatus = useAgentKeyStatus(isCloud && !chatAgentic);
  const agentKeyMissing = isCloud && !chatAgentic && agentKeyStatus === 'missing';
  const chatSetUp = agentKeyMissing ? t('chatSetUp') : null;
  // Brand-scoped gates follow the active brand, not the org. Selecting the
  // derived brand keeps this reactive: switching brands via BrandSwitcher or
  // toggling the flag in Brand Settings flips the gate without a route change.
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  // Map from a requiresBrandPref key to the active brand's value. The
  // sidebar hides the entry entirely when it is false — Visibility's
  // Products shows for brands that sell online (#155/#170, 2026-11-06).
  const brandPrefs = { ecommerce: isEcommerceBrand(activeBrand) };
  const childGates = { brandPrefs, canUse, chatAgentic };
  // The items the viewer sees, and the groups that keep one: a group whose
  // sections are all off their menu goes, title and all. Ads only with Ads on.
  const hiddenSections = useHiddenMenuSections();
  const ads = useAdsEnabled();
  const visibleNav = nav
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        shouldShowDashboardNavItem(item, brandPrefs, hiddenSections, chatAgentic, canUse, ads),
      ),
    }))
    .filter((group) => group.items.length > 0);
  // The menu's dots and the Action Center's count.
  const dots = useMenuDots(nav, compact);
  const dotLabel = useDotLabel();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Hydration guard: SSR can't know the resolved theme, so we render the
  // light logo first and swap after mount. This is the canonical Next.js
  // pattern for "render client-only content after hydration" — there's no
  // useEffect-free version that avoids the hydration mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => () => clearTimeout(peekTimer.current), []);

  // When the menu is longer than the window, the current page's item is
  // scrolled into view, so it is never hidden below the fold: on every page
  // change, and when the sidebar opens or closes (its layout changes) unless
  // the user has scrolled the menu since, which then stays where they put it.
  const menuScrolledByUser = useRef(false);
  useEffect(() => {
    menuScrolledByUser.current = false;
  }, [pathname]);
  useEffect(() => {
    if (menuScrolledByUser.current) return;
    asideRef.current
      ?.querySelector<HTMLElement>('nav [aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [pathname, compact]);
  const markMenuScrolled = () => {
    menuScrolledByUser.current = true;
  };

  useEffect(() => {
    const stored: Record<string, boolean> = {};
    for (const href of EXPANDABLE_HREFS) {
      try {
        const value = localStorage.getItem(submenuKey(href));
        if (value !== null) stored[href] = value === '1';
      } catch {
        // Storage can be unavailable (private mode); the default stands.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenMenus((prev) => ({ ...stored, ...prev }));
    const storedGroups: Record<string, boolean> = {};
    for (const title of GROUP_TITLES) {
      try {
        const value = localStorage.getItem(groupKey(title));
        if (value !== null) storedGroups[title] = value === '1';
      } catch {
        // Storage can be unavailable (private mode); the default stands.
      }
    }
    setOpenGroups((prev) => ({ ...storedGroups, ...prev }));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (underMenu) setOpenMenus((prev) => ({ ...prev, [underMenu]: true }));
  }, [underMenu]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (underGroup) setOpenGroups((prev) => ({ ...prev, [underGroup]: true }));
  }, [underGroup]);

  const setSubmenuOpen = (href: string, open: boolean) => {
    setOpenMenus((prev) => ({ ...prev, [href]: open }));
    try {
      localStorage.setItem(submenuKey(href), open ? '1' : '0');
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  };

  const setGroupOpen = (title: string, open: boolean) => {
    setOpenGroups((prev) => ({ ...prev, [title]: open }));
    try {
      localStorage.setItem(groupKey(title), open ? '1' : '0');
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  };

  const logoSrc = mounted && resolvedTheme === 'dark' ? '/logo_dark.svg' : '/logo_light.svg';

  function handleMouseEnter() {
    if (!isCollapsed) return;
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeeking(true), PEEK_DELAY_MS);
  }

  function handleMouseLeave() {
    clearTimeout(peekTimer.current);
    setPeeking(false);
  }

  function handleMenuOpenChange(open: boolean) {
    setMenuOpen(open);
    if (open) return;
    // While the menu is open it covers the page, so the pointer can move off
    // the sidebar without a mouseleave. Check where it is on its next move.
    document.addEventListener(
      'pointermove',
      (e) => {
        const rect = asideRef.current?.getBoundingClientRect();
        const inside =
          rect != null &&
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!inside) setPeeking(false);
      },
      { once: true },
    );
  }

  function handleToggleCollapse() {
    // Collapsing takes effect at once, even with the pointer still on it.
    clearTimeout(peekTimer.current);
    setPeeking(false);
    if (onChat) {
      setRailOpen(!railOpen);
      void saveChatRailOpen(!railOpen);
    } else {
      toggleCollapse();
    }
  }

  return (
    <>
      {/* Holds the page layout at the pinned width. The sidebar itself is
          laid over it, so a collapsed one can widen over the page. */}
      <div
        aria-hidden
        className={cn('shrink-0 transition-[width] duration-200', isCollapsed ? 'w-16' : 'w-60')}
      />
      <aside
        ref={asideRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        // Keyboard users open a collapsed sidebar by tabbing into it, as
        // pointer users do by hovering.
        onFocus={() => isCollapsed && setPeeking(true)}
        onBlur={(e) => {
          if (!asideRef.current?.contains(e.relatedTarget as Node | null)) setPeeking(false);
        }}
        onKeyDown={(e) => handleNavKeys(e, setSubmenuOpen)}
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex flex-col border-r bg-sidebar transition-[width] duration-200',
          compact ? 'w-16' : 'w-60',
          isCollapsed && !compact && 'shadow-xl',
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center gap-2 border-b px-3',
            compact && 'justify-center px-0',
          )}
        >
          {onChat ? (
            // On Chat's screens the logo expands the rail, and collapses it again (CHAT-23 rail.toggle).
            <button
              type="button"
              data-action="rail.toggle"
              onClick={handleToggleCollapse}
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? t('expandRail') : t('collapseRail')}
              title={t('railTip')}
              className={cn(
                'flex items-center gap-2 overflow-hidden rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                !compact && 'min-w-0 flex-1',
              )}
            >
              <Image
                src={logoSrc}
                alt=""
                width={24}
                height={24}
                className="h-6 w-6 shrink-0"
                priority
              />
              {!compact && <span className="truncate font-semibold">{siteConfig.name}</span>}
            </button>
          ) : (
            <Link
              href="/dashboard"
              className={cn(
                'flex items-center gap-2 overflow-hidden',
                !compact && 'min-w-0 flex-1',
              )}
            >
              <Image
                src={logoSrc}
                alt={siteConfig.name}
                width={24}
                height={24}
                className="h-6 w-6 shrink-0"
                priority
              />
              {!compact && <span className="truncate font-semibold">{siteConfig.name}</span>}
            </Link>
          )}
          {/* Too narrow beside the logo when collapsed; it shows while the
              sidebar is open over the page. */}
          {!compact && <ThemeToggle className="shrink-0" />}
        </div>

        <div className={cn('border-b px-2 py-2', compact && 'px-1')}>
          <BrandSwitcher collapsed={compact} onOpenChange={handleMenuOpenChange} />
        </div>

        {/* Only the menu scrolls; the logo, the brand switcher and the footer
            stay put. min-h-0 lets it shrink below its content in the column. */}
        <ScrollArea
          className="min-h-0 flex-1"
          viewportClassName={NAV_VIEWPORT}
          scrollbarClassName={NAV_SCROLLBAR}
          onWheel={markMenuScrolled}
          onTouchMove={markMenuScrolled}
          onPointerDown={(e) => {
            // Dragging the scrollbar counts; clicking an item doesn't.
            if ((e.target as Element).closest('[data-slot="scroll-area-scrollbar"]')) {
              markMenuScrolled();
            }
          }}
        >
          {visibleNav.map((group, i) => (
            <div key={i} className="mb-4">
              {/* A titled group folds under its title, the chevron on the
                right. Icons alone (compact) have no titles to fold, so they
                show every item. */}
              {group.title && !compact && (
                <button
                  type="button"
                  aria-expanded={isGroupOpen(group.title)}
                  aria-controls={isGroupOpen(group.title) ? `nav-group-${i}` : undefined}
                  data-nav-group={group.title}
                  onClick={() => setGroupOpen(group.title!, !isGroupOpen(group.title!))}
                  className="mb-1 flex w-full items-center justify-between rounded-md px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {/* Folded, its items' dot beside it. */}
                  <FoldedGroupLabel
                    label={getDashboardNavGroupLabel(group.title, t)}
                    dot={isGroupOpen(group.title) ? null : dots.groupDot(group)}
                  />
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-transform',
                      !isGroupOpen(group.title) && '-rotate-90',
                    )}
                  />
                </button>
              )}
              {/* A group with no title has no header to set it apart, so it
                carries a rule instead — without one its items read as the tail
                of the group above. The first group needs neither: nothing
                precedes it. */}
              {!group.title && i > 0 && <Separator className="mb-2" />}
              {group.title && compact && i > 0 && <Separator className="my-2" />}
              {(!group.title || compact || isGroupOpen(group.title)) && (
                <nav id={`nav-group-${i}`} className="space-y-0.5">
                  {group.items.map((item) => {
                    const href = navItemHref(item, chatAgentic);
                    const isActive = isNavItemActive(item, pathname, href);
                    const label = getDashboardNavLabel(item.title, t);
                    // The entries this person's menu shows (menu access).
                    const children = visibleNavChildren(item, hiddenSections, childGates);

                    // Chat's own badge: "Set up" when the org has no provider key for
                    // it (cloud only, never with the new Chat on).
                    const effectiveBadge = dashboardNavBadge(item, { chatAgentic, chatSetUp });

                    const isLocked =
                      isCloud && item.requiredFeature != null && !canUse(item.requiredFeature);
                    // Its dot (a locked item has none): its own, or its submenu's strongest.
                    const dot = dots.itemDot(item);

                    if (isLocked) {
                      return (
                        <span
                          key={item.href}
                          className={cn(
                            'flex cursor-not-allowed items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground/50',
                            compact && 'justify-center',
                          )}
                          title={
                            compact
                              ? `${label} (${requiredPlanFor(item.requiredFeature!)})`
                              : undefined
                          }
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {!compact && (
                            <>
                              <span className="flex-1 truncate">{label}</span>
                              <Badge
                                variant="outline"
                                className="ml-auto h-5 shrink-0 gap-0.5 px-1.5 text-[10px] font-normal"
                              >
                                <Crown className="h-2.5 w-2.5" />
                                {requiredPlanFor(item.requiredFeature!)}
                              </Badge>
                            </>
                          )}
                          {compact && (
                            <Lock className="absolute right-1 top-1 h-2.5 w-2.5 text-muted-foreground/40" />
                          )}
                        </span>
                      );
                    }

                    if (children.length > 0 && !compact) {
                      // Expandable item (PROMPT-001): the row toggles the
                      // submenu, whose links are the item's views.
                      const carry =
                        underPrompts && item.href === PROMPTS_BASE
                          ? carriedParams(searchParams.toString())
                          : '';
                      const submenuId = `submenu-${item.href.replace(/\W+/g, '-')}`;
                      const submenuOpen = isSubmenuOpen(item.href);
                      const currentChild = activeChildHref(children, pathname);
                      // Closed, its icon carries its entries' dot. Visibility
                      // says "New results" in words too, its dot by its name
                      // while open.
                      const words = dot?.colour === 'green' && item.href === NEW_RESULTS_ITEM;
                      const iconDot = submenuOpen ? null : dot;
                      const nameDot = submenuOpen && words ? dot : null;
                      const openActions =
                        item.href === ACTION_CENTER_ITEM ? dots.openActions : null;
                      return (
                        <div key={item.href}>
                          <button
                            type="button"
                            data-nav-item="parent"
                            data-submenu={item.href}
                            aria-expanded={submenuOpen}
                            aria-controls={submenuId}
                            onClick={() => setSubmenuOpen(item.href, !submenuOpen)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                              isActive
                                ? 'text-primary'
                                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                              iconDot && 'relative',
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span className={nameDot ? 'truncate' : 'flex-1 truncate'}>
                              {label}
                            </span>
                            {nameDot && <MenuDot dot={nameDot} className="mr-auto" />}
                            {iconDot && (
                              <MenuDot dot={iconDot} className={cn(ICON_DOT, 'left-5')} />
                            )}
                            {words && <NewResultsWords />}
                            {openActions !== null && <OpenActionsCount count={openActions} />}
                            {effectiveBadge && (
                              <Badge
                                variant="secondary"
                                className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                              >
                                {effectiveBadge}
                              </Badge>
                            )}
                            <ChevronDown
                              className={cn(
                                'h-3.5 w-3.5 shrink-0 transition-transform',
                                !submenuOpen && '-rotate-90',
                              )}
                            />
                          </button>
                          {submenuOpen && (
                            <ul
                              id={submenuId}
                              className="mt-0.5 ml-[18px] space-y-0.5 border-l pl-2"
                            >
                              {children.map((child) => {
                                const childActive = child.href === currentChild;
                                const childDot = dots.dotOf(child.href);
                                const childName = (
                                  <>
                                    <span className={childDot ? 'truncate' : 'flex-1 truncate'}>
                                      {getDashboardNavLabel(child.title, t)}
                                    </span>
                                    {childDot && <MenuDot dot={childDot} className="mr-auto" />}
                                  </>
                                );
                                const onDotClick = childDot
                                  ? () => dots.clicked(childDot, false)
                                  : undefined;
                                const childClass = cn(
                                  'flex items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                                  childActive
                                    ? 'bg-primary/10 font-medium text-primary'
                                    : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                );
                                // Brand Visibility's tabs keep the date range,
                                // engine, country and topic, as its tab bar does.
                                const tab = brandVisibilityTabOf(child.href);
                                if (tab) {
                                  return (
                                    <li key={child.href}>
                                      <BrandVisibilityTabLink
                                        tab={tab}
                                        data-nav-item="child"
                                        aria-current={childActive ? 'page' : undefined}
                                        className={childClass}
                                        onClick={onDotClick}
                                      >
                                        {childName}
                                      </BrandVisibilityTabLink>
                                    </li>
                                  );
                                }
                                return (
                                  <li key={child.href}>
                                    <Link
                                      href={`${childLinkHref(child, pathname)}${carry}`}
                                      data-nav-item="child"
                                      aria-current={childActive ? 'page' : undefined}
                                      className={childClass}
                                      onClick={onDotClick}
                                    >
                                      {childName}
                                      {child.badge && (
                                        <Badge
                                          variant="secondary"
                                          className="h-4 shrink-0 px-1.5 text-[10px] font-normal"
                                        >
                                          {child.badge}
                                        </Badge>
                                      )}
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      );
                    }

                    const ownSection = menuSectionOf(item.href);
                    const linkHref =
                      children.length > 0 && ownSection && hiddenSections.has(ownSection)
                        ? children[0].href
                        : href;
                    // Icons only, the item's name says its dot ("Visibility, New results").
                    const iconName = compact && dot ? dotLabel(dot, label) : undefined;
                    return (
                      <Link
                        key={item.href}
                        href={linkHref}
                        data-nav-item="link"
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={iconName}
                        onClick={dot ? () => dots.clicked(dot, compact) : undefined}
                      >
                        <span
                          className={cn(
                            'flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                            compact && 'justify-center',
                            iconName && 'relative',
                          )}
                          title={
                            iconName ??
                            (compact
                              ? effectiveBadge
                                ? `${label} (${effectiveBadge})`
                                : label
                              : undefined)
                          }
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          {iconName && dot && (
                            <MenuDot dot={dot} className={cn(ICON_DOT, 'left-7')} />
                          )}
                          {!compact && (
                            <>
                              <span className={dot ? 'truncate' : 'flex-1 truncate'}>{label}</span>
                              {dot && <MenuDot dot={dot} className="mr-auto" />}
                              {effectiveBadge && (
                                <Badge
                                  variant="secondary"
                                  className="ml-auto h-5 shrink-0 px-1.5 text-[10px] font-normal"
                                >
                                  {effectiveBadge}
                                </Badge>
                              )}
                              {item.newPill && <NewPill className="ml-auto" />}
                            </>
                          )}
                        </span>
                      </Link>
                    );
                  })}
                </nav>
              )}
            </div>
          ))}
        </ScrollArea>

        <div className="space-y-1 p-2">
          {/* Menu access: how much is off the viewer's menu, and where they change it. */}
          {!compact && hiddenSections.size > 0 && (
            <p className="px-2 pb-1 text-[11px] text-muted-foreground">
              {t('menuOff', { count: hiddenSections.size })}{' '}
              <Link
                href="/dashboard/settings/account"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {t('menuOffChange')}
              </Link>
            </p>
          )}
          <Button
            variant="ghost"
            onClick={handleToggleCollapse}
            aria-label={isCollapsed ? t('keepSidebarOpen') : t('collapseSidebar')}
            title={isCollapsed ? t('keepSidebarOpen') : t('collapseSidebar')}
            className={cn(
              // In the menu items' gray, not the button's black.
              'flex h-9 w-full items-center gap-2 px-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              compact ? 'justify-center' : 'justify-start',
            )}
          >
            {isCollapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="border-t p-2">
          <UserProfileNavItem collapsed={compact} shortcut />
        </div>
      </aside>
    </>
  );
}
