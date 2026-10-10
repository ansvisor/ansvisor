'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, Link } from '@/i18n/navigation';
import { dashboardNav } from '@/config/dashboard';
import {
  getDashboardNavLabel,
  getDashboardNavGroupLabel,
  shouldShowDashboardNavItem,
} from '@/lib/dashboard-navigation';
import { useSidebarStore } from '@/stores/use-sidebar-store';
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
import {
  ChevronsLeft,
  ChevronsRight,
  Crown,
  ExternalLink,
  Lock,
  MessageSquareHeart,
} from 'lucide-react';

/** How long the pointer rests on the collapsed sidebar before it opens. */
const PEEK_DELAY_MS = 150;

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, toggleCollapse } = useSidebarStore();
  // A collapsed sidebar opens over the page while the pointer is on it
  // ("peeking") and while its brand menu is open, and closes again after.
  const [peeking, setPeeking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const asideRef = useRef<HTMLElement>(null);
  const compact = isCollapsed && !peeking && !menuOpen;
  const t = useTranslations('nav');
  const tBrands = useTranslations('brands');
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();
  // Probe once per session whether the org has saved an Anthropic key.
  // Returns 'configured' immediately on self-host (no network call).
  const agentKeyStatus = useAgentKeyStatus(isCloud);
  const agentKeyMissing = isCloud && agentKeyStatus === 'missing';
  // Brand-scoped gates follow the active brand, not the org. Selecting the
  // derived brand keeps this reactive: switching brands via BrandSwitcher or
  // toggling the flag in Brand Settings flips the gate without a route change.
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  // Map from a NavItem.requiresBrandPref key to the active brand's value.
  // Sidebar hides the item entirely when this returns false — see #155/#170
  // for why Shopping uses this on top of the existing plan-feature gate.
  const brandPrefs = { shoppingModeEnabled: !!activeBrand?.shoppingModeEnabled };
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
    toggleCollapse();
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
        className={cn(
          'absolute inset-y-0 left-0 z-40 flex flex-col border-r bg-sidebar transition-[width] duration-200',
          compact ? 'w-16' : 'w-60',
          isCollapsed && !compact && 'shadow-xl',
        )}
      >
        <div
          className={cn('flex h-16 items-center border-b px-3', compact && 'justify-center px-0')}
        >
          <Link
            href="/dashboard"
            className={cn('flex items-center gap-2 overflow-hidden', !compact && 'w-full')}
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
        </div>

        <div className={cn('border-b px-2 py-2', compact && 'px-1')}>
          <BrandSwitcher collapsed={compact} onOpenChange={handleMenuOpenChange} />
        </div>

        <ScrollArea className="flex-1 px-2 py-3">
          {dashboardNav.map((group, i) => (
            <div key={i} className="mb-4">
              {group.title && !compact && (
                <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {getDashboardNavGroupLabel(group.title, t)}
                </p>
              )}
              {/* A group with no title has no header to set it apart, so it
                carries a rule instead — without one its items read as the tail
                of the group above. The first group needs neither: nothing
                precedes it. */}
              {!group.title && i > 0 && <Separator className="mb-2" />}
              {group.title && compact && i > 0 && <Separator className="my-2" />}
              <nav className="space-y-0.5">
                {group.items.map((item) => {
                  if (!shouldShowDashboardNavItem(item, brandPrefs)) {
                    return null;
                  }

                  const isActive =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname.startsWith(item.href);
                  const label = getDashboardNavLabel(item.title, t, tBrands);

                  // Dynamic badge override: show "Set up" on the Agent item
                  // when the org has no Anthropic key saved (cloud only).
                  const effectiveBadge =
                    item.href === '/dashboard/agent' && agentKeyMissing ? 'Set up' : item.badge;

                  const isLocked =
                    isCloud && item.requiredFeature != null && !canUse(item.requiredFeature);

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

                  return (
                    <Link key={item.href} href={item.href}>
                      <span
                        className={cn(
                          'flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          compact && 'justify-center',
                        )}
                        title={
                          compact
                            ? effectiveBadge
                              ? `${label} (${effectiveBadge})`
                              : label
                            : undefined
                        }
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!compact && (
                          <>
                            <span className="flex-1 truncate">{label}</span>
                            {effectiveBadge && (
                              <Badge
                                variant="secondary"
                                className="ml-auto h-5 shrink-0 px-1.5 text-[10px] font-normal"
                              >
                                {effectiveBadge}
                              </Badge>
                            )}
                          </>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </ScrollArea>

        <div className="space-y-1 p-2">
          <a
            href={siteConfig.links.feedback}
            target="_blank"
            rel="noopener noreferrer"
            title={compact ? t('feedback') : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              compact && 'justify-center',
            )}
          >
            <MessageSquareHeart className="h-4 w-4 shrink-0" />
            {!compact && (
              <>
                <span className="flex-1 truncate">{t('feedback')}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
              </>
            )}
          </a>
          <Button
            variant="ghost"
            onClick={handleToggleCollapse}
            aria-label={isCollapsed ? t('keepSidebarOpen') : t('collapseSidebar')}
            title={isCollapsed ? t('keepSidebarOpen') : t('collapseSidebar')}
            className={cn(
              'flex h-9 w-full items-center gap-2 px-2',
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
          <UserProfileNavItem collapsed={compact} />
        </div>
      </aside>
    </>
  );
}
