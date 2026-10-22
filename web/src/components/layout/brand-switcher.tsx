'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUserRole } from '@/hooks/use-user-role';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BrandAvatar } from '@/components/brand-avatar';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Check, ChevronsUpDown, LayoutGrid, Plus, Settings } from 'lucide-react';

interface BrandSwitcherProps {
  collapsed?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called when it leaves for another page (the mobile menu closes then). */
  onNavigate?: () => void;
}

/**
 * The brand switcher at the top of the menu. Beside the selected brand, its
 * settings (a separate button, so the switcher still opens on the name and
 * the chevron); in the list, every brand to switch to, then all brands and a
 * new one. The brands page has no menu item of its own: this is its way in.
 */
export function BrandSwitcher({ collapsed = false, onOpenChange, onNavigate }: BrandSwitcherProps) {
  const t = useTranslations('brands');
  const router = useRouter();
  const { brands, activeBrandId, setActiveBrand } = useBrandStore();
  // Only admins and managers add a brand (brands: admin/manager insert).
  const { canManage } = useUserRole();

  const activeBrand = brands.find((b) => b.id === activeBrandId) ?? null;

  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };

  if (brands.length === 0) {
    if (!canManage) return null;
    return (
      <button
        onClick={() => go('/dashboard/brands/new')}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-dashed px-2 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary',
          collapsed && 'justify-center px-0',
        )}
        title={collapsed ? t('addBrand') : undefined}
      >
        <Plus className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="truncate text-xs">{t('addBrand')}</span>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none',
            collapsed && 'justify-center px-0',
          )}
          aria-label={t('switchBrand')}
        >
          {activeBrand ? (
            <BrandAvatar
              logoUrl={activeBrand.logoUrl}
              name={activeBrand.name}
              domains={activeBrand.domains}
              className="h-6 w-6 shrink-0 rounded-md bg-zinc-50 dark:bg-zinc-100"
            />
          ) : (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
              ?
            </span>
          )}

          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left text-sm font-medium">
                {activeBrand?.name ?? t('selectBrand')}
              </span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56" align="start" side="bottom" sideOffset={4}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('switchBrand')}
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />

          {brands.map((brand) => {
            const isActive = brand.id === activeBrandId;
            const primaryDomain = brand.domains.find((d) => d.isPrimary);

            return (
              <DropdownMenuItem
                key={brand.id}
                onClick={() => setActiveBrand(brand.id)}
                className="flex items-center gap-2"
              >
                <BrandAvatar
                  logoUrl={brand.logoUrl}
                  name={brand.name}
                  domains={brand.domains}
                  className="h-5 w-5 shrink-0 rounded-md bg-zinc-50 dark:bg-zinc-100"
                  fallbackClassName="rounded-md bg-primary/10 text-primary text-xs font-semibold"
                />
                <div className="flex-1 overflow-hidden">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    <span className="truncate">{brand.name}</span>
                    {!brand.isActive && (
                      <span className="shrink-0 rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
                        Paused
                      </span>
                    )}
                  </p>
                  {primaryDomain && (
                    <p className="truncate text-xs text-muted-foreground">{primaryDomain.domain}</p>
                  )}
                </div>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </DropdownMenuItem>
            );
          })}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => go('/dashboard/brands')}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border">
              <LayoutGrid className="h-3 w-3" />
            </div>
            <span className="text-sm">{t('showAllBrands')}</span>
          </DropdownMenuItem>
          {canManage && (
            <DropdownMenuItem
              onClick={() => go('/dashboard/brands/new')}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border">
                <Plus className="h-3 w-3" />
              </div>
              <span className="text-sm">{t('addBrand')}</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The selected brand's settings; too narrow beside the logo when collapsed. */}
      {activeBrand && !collapsed && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={`/dashboard/brands/${activeBrand.id}/settings`}
                onClick={onNavigate}
                aria-label={t('visitBrandSettings')}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            }
          >
            <Settings className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="right">{t('visitBrandSettings')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
