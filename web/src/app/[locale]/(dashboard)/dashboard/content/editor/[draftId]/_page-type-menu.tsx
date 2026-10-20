'use client';

import { useTranslations } from 'next-intl';
import { ChevronDown, Settings } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { badgeVariants } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isPageType, type PageType } from '@/lib/content/drafts';
import { SITE_PAGE_TYPES, type SiteType } from '@/lib/content/page-types';
import { cn } from '@/lib/utils';

/**
 * The draft's page type in the editor's header (CE-023): detected from the
 * page until the person picks one from the types their kind of site writes.
 * A type from another kind of site, picked before the site type changed,
 * stays on the list so the menu still shows it.
 */
export function PageTypeMenu({
  brandId,
  siteType,
  pageType,
  detected,
  isNew,
  onPick,
}: {
  brandId: string;
  siteType: SiteType;
  pageType: string | null;
  /** Whether the type is detected (not picked). */
  detected: boolean;
  /** A new page: the tag says so after the type. */
  isNew: boolean;
  onPick: (type: PageType) => void;
}) {
  const t = useTranslations('contentEditor.editor');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const tSites = useTranslations('brands.siteTypes');
  const current = isPageType(pageType) ? pageType : null;
  const offered = SITE_PAGE_TYPES[siteType];
  const types = current && !offered.includes(current) ? [...offered, current] : offered;
  const label = current ? tTypes(current) : t('pageType.none');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('pageType.change', { type: label })}
        title={detected ? t('pageType.detectedHint') : undefined}
        className={cn(
          badgeVariants({ variant: 'outline' }),
          'cursor-pointer gap-1 font-normal hover:bg-muted',
          !current && 'border-dashed text-muted-foreground',
        )}
      >
        {[label, isNew ? t('newPage') : null].filter(Boolean).join(' · ')}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('pageType.title', { site: tSites(siteType) })}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current ?? ''}
            onValueChange={(value) => {
              if (isPageType(value)) onPick(value);
            }}
          >
            {types.map((type) => (
              <DropdownMenuRadioItem key={type} value={type} closeOnClick>
                {tTypes(type)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-xs text-muted-foreground">
          {detected ? t('pageType.detectedHint') : t('pageType.pickedHint')}
        </p>
        <DropdownMenuItem
          render={<Link href={`/dashboard/brands/${brandId}/settings`} />}
          className="text-xs"
        >
          <Settings className="h-3.5 w-3.5" />
          {t('pageType.siteSettings')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
