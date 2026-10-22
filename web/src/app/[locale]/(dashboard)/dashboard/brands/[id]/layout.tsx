'use client';

import { use } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { Button } from '@/components/ui/button';
import { BrandAvatar } from '@/components/brand-avatar';
import { BrandSwitchItems } from '@/components/layout/brand-switcher';
import { WorkspaceSettingsMenu } from '@/components/layout/workspace-settings-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { brandPagePath } from '@/lib/brand-path';
import { cn } from '@/lib/utils';
import { ArrowLeft, ChevronsUpDown, MessageSquareText, Settings, Tag } from 'lucide-react';

const SUB_NAV = [
  { href: 'topics', label: 'Topics', icon: Tag },
  { href: 'prompts', label: 'Prompts', icon: MessageSquareText },
  { href: 'settings', label: 'Settings', icon: Settings },
] as const;

export default function BrandDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
}) {
  const { id } = use(params) as { id: string };
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations('brands');
  const { brands, setActiveBrand } = useBrandStore();
  const brand = brands.find((b) => b.id === id);
  // Another brand from the header opens the same page of that brand (its
  // settings, from the settings), and becomes the brand the app shows.
  const switchTo = (brandId: string) => {
    if (brandId === id) return;
    setActiveBrand(brandId);
    router.push(brandPagePath(pathname, brandId) ?? `/dashboard/brands/${brandId}/settings`);
  };

  return (
    <div className="space-y-6">
      {/* Brand header + back; Workspace Settings wraps below it on a phone. */}
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/dashboard/brands">
          <Button variant="ghost" size="icon" aria-label="Back to brands list">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        {brand && (
          <div className="flex items-center gap-3">
            <BrandAvatar
              logoUrl={brand.logoUrl}
              name={brand.name}
              domains={brand.domains}
              className="h-9 w-9 rounded-lg bg-zinc-50 dark:bg-zinc-100"
              fallbackClassName="rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
              imageClassName="object-contain p-1"
            />
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-xl font-bold tracking-tight">{brand.name}</h1>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t('switchBrand')}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <ChevronsUpDown className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56" align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {t('switchBrand')}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <BrandSwitchItems brands={brands} currentId={id} onSelect={switchTo} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="text-xs text-muted-foreground">
                {brand.domains.find((d) => d.isPrimary)?.domain ?? ''}
              </p>
            </div>
          </div>
        )}
        <div className="ml-auto">
          <WorkspaceSettingsMenu />
        </div>
      </div>

      {/* Sub-nav */}
      <nav className="flex gap-1 border-b">
        {SUB_NAV.map((item) => {
          const fullHref = `/dashboard/brands/${id}/${item.href}`;
          const isActive = pathname.includes(`/${item.href}`);

          return (
            <Link key={item.href} href={fullHref}>
              <span
                className={cn(
                  'inline-flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Page content */}
      {children}
    </div>
  );
}
