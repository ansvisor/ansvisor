'use client';

import { useEffect, useState, type ComponentProps, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import {
  BRAND_VISIBILITY_TABS,
  brandVisibilityTabHref,
  brandVisibilityTabOf,
  hasProductVisibilityTab,
  type BrandVisibilityTab,
} from '@/lib/brand-visibility';
import { menuSectionOf } from '@/lib/menu-access';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';

/** Whether the active brand has Product Visibility as Visibility's fourth tab (hasProductVisibilityTab). */
export function useProductVisibilityTab(): boolean {
  const brand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId) ?? null);
  const { canUse } = useFeatureGate();
  return hasProductVisibilityTab(brand, canUse);
}

/**
 * A link to one of Brand Visibility's tabs that keeps the filters the tabs
 * share (brandVisibilityTabHref). The tabs write their filters into the
 * address as they change, without telling the router, so the address is
 * read when the link is pointed at, focused or followed, not only when it
 * was drawn. The tab bar and the menu's Brand Visibility entries use it.
 */
export function BrandVisibilityTabLink({
  tab,
  onClick,
  ...props
}: { tab: BrandVisibilityTab } & Omit<ComponentProps<typeof Link>, 'href'>) {
  const pathname = usePathname();
  const router = useRouter();
  const current = brandVisibilityTabOf(pathname);
  const [search, setSearch] = useState('');
  const read = () => setSearch(window.location.search);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the address after each page change
    setSearch(window.location.search);
  }, [pathname]);
  const href = brandVisibilityTabHref(tab, current, search);

  const follow = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    // A new tab or window opens the drawn link, as links do.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    const now = brandVisibilityTabHref(tab, current, window.location.search);
    if (now !== href) {
      e.preventDefault();
      router.push(now);
    }
  };

  return <Link {...props} href={href} onPointerEnter={read} onFocus={read} onClick={follow} />;
}

/**
 * The tabs under the header: Overview, Mentions, Citations, and Product
 * Visibility for a brand that sells online (useProductVisibilityTab). Each
 * is its own route, so a tab loads its own data only when it is opened, and
 * the header above stays as it is. A tab whose section the person's menu
 * hides (menu access) is left off, as the menu leaves it off. With
 * `prefetch` (once the open tab's figures are on screen) the others are
 * prefetched whole, so a switch doesn't wait for the server to draw the
 * tab; before that nothing is prefetched, so it doesn't compete with the
 * open tab's reads.
 */
export function BrandVisibilityTabs({
  current,
  prefetch = false,
}: {
  current: BrandVisibilityTab | null;
  prefetch?: boolean;
}) {
  const t = useTranslations('brandVisibility.tabs');
  const products = useProductVisibilityTab();
  const hiddenSections = useHiddenMenuSections();
  const tabs = BRAND_VISIBILITY_TABS.filter(({ id, href }) => {
    if (id === 'products' && !products) return false;
    const section = menuSectionOf(href);
    return !section || !hiddenSections.has(section);
  });
  return (
    <nav aria-label={t('label')} className="flex gap-6 overflow-x-auto border-b">
      {tabs.map(({ id }) => {
        const active = id === current;
        return (
          <BrandVisibilityTabLink
            key={id}
            tab={id}
            aria-current={active ? 'page' : undefined}
            prefetch={prefetch && !active}
            className={cn(
              '-mb-px shrink-0 border-b-2 pb-2 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(id)}
          </BrandVisibilityTabLink>
        );
      })}
    </nav>
  );
}
