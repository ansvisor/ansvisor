'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, Link } from '@/i18n/navigation';
import { dashboardNav } from '@/config/dashboard';
import { useSidebarStore } from '@/stores/use-sidebar-store';
import { useBrandStore } from '@/stores/use-brand-store';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { BrandSwitcher } from '@/components/layout/brand-switcher';
import { UserProfileNavItem } from '@/components/layout/user-profile-nav-item';
import { ChevronsLeft, ChevronsRight, Crown, Lock } from 'lucide-react';

export function Sidebar() {
  const pathname = usePathname();
  const { isCollapsed, toggleCollapse } = useSidebarStore();
  const t = useTranslations('nav');
  const tBrands = useTranslations('brands');
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();
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

  const logoSrc = mounted && resolvedTheme === 'dark' ? '/logo_dark.svg' : '/logo_light.svg';

  const navKeyMap: Record<string, () => string> = {
    Overview: () => t('overview'),
    Brands: () => tBrands('title'),
    Agent: () => t('agent'),
    'Answer Engine Insights': () => t('insights'),
    'AI Traffic Analytics': () => t('traffic'),
    Prompts: () => t('prompts'),
    Topics: () => t('topics'),
    'Content Optimization': () => t('content'),
    'Site Audit': () => t('audit'),
    Competitors: () => t('competitors'),
    Citations: () => t('citations'),
    Shopping: () => t('shopping'),
    Reports: () => t('reports'),
    Settings: () => t('settings'),
  };

  return (
    <aside
      className={cn(
        'relative flex h-full flex-col border-r bg-card transition-all duration-300',
        isCollapsed ? 'w-16' : 'w-60',
      )}
    >
      <div
        className={cn('flex h-16 items-center border-b px-3', isCollapsed && 'justify-center px-0')}
      >
        <Link
          href="/dashboard"
          className={cn('flex items-center gap-2 overflow-hidden', !isCollapsed && 'w-full')}
        >
          <Image
            src={logoSrc}
            alt={siteConfig.name}
            width={24}
            height={24}
            className="h-6 w-6 shrink-0"
            priority
          />
          {!isCollapsed && <span className="truncate font-semibold">{siteConfig.name}</span>}
        </Link>
      </div>

      <div className={cn('border-b px-2 py-2', isCollapsed && 'px-1')}>
        <BrandSwitcher collapsed={isCollapsed} />
      </div>

      <ScrollArea className="flex-1 px-2 py-3">
        {dashboardNav.map((group, i) => (
          <div key={i} className="mb-4">
            {group.title && !isCollapsed && (
              <p className="mb-1 px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.title}
              </p>
            )}
            {group.title && isCollapsed && i > 0 && <Separator className="my-2" />}
            <nav className="space-y-0.5">
              {group.items.map((item) => {
                // Hide entirely if a required brand preference is off — the
                // user shouldn't see "Shopping (upgrade)" when the active
                // brand simply isn't in e-commerce.
                if (item.requiresBrandPref && !brandPrefs[item.requiresBrandPref]) {
                  return null;
                }

                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href);
                const labelFn = navKeyMap[item.title];
                const label = labelFn ? labelFn() : item.title;

                const isLocked =
                  isCloud && item.requiredFeature != null && !canUse(item.requiredFeature);

                if (isLocked) {
                  return (
                    <span
                      key={item.href}
                      className={cn(
                        'flex cursor-not-allowed items-center gap-3 rounded-md px-2 py-1.5 text-[13px] font-medium text-muted-foreground/50',
                        isCollapsed && 'justify-center',
                      )}
                      title={
                        isCollapsed
                          ? `${label} (${requiredPlanFor(item.requiredFeature!)})`
                          : undefined
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!isCollapsed && (
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
                      {isCollapsed && (
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
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                        isCollapsed && 'justify-center',
                      )}
                      title={isCollapsed ? label : undefined}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!isCollapsed && <span className="truncate">{label}</span>}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
        ))}
      </ScrollArea>

      <div className="p-2">
        <Button
          variant="ghost"
          onClick={toggleCollapse}
          className={cn(
            'flex h-9 w-full items-center gap-2 px-2',
            isCollapsed ? 'justify-center' : 'justify-start',
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
        <UserProfileNavItem collapsed={isCollapsed} />
      </div>
    </aside>
  );
}
