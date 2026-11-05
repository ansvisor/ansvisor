'use client';

import { useEffect, useState, type ComponentProps, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import {
  BRAND_VISIBILITY_TABS,
  brandVisibilityTabHref,
  brandVisibilityTabOf,
  type BrandVisibilityTab,
} from '@/lib/brand-visibility';
import { cn } from '@/lib/utils';

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
 * The three tabs under the header: Overview, Mentions, Citations. Each is
 * its own route, so a tab loads its own data only when it is opened, and
 * the header above stays as it is.
 */
export function BrandVisibilityTabs({ current }: { current: BrandVisibilityTab | null }) {
  const t = useTranslations('brandVisibility.tabs');
  return (
    <nav aria-label={t('label')} className="flex gap-6 overflow-x-auto border-b">
      {BRAND_VISIBILITY_TABS.map(({ id }) => {
        const active = id === current;
        return (
          <BrandVisibilityTabLink
            key={id}
            tab={id}
            aria-current={active ? 'page' : undefined}
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
