'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Globe, MessageSquareText, Plus, Settings, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BrandCardProps {
  brand: Brand;
}

export function BrandCard({ brand }: BrandCardProps) {
  const tNav = useTranslations('nav');
  const tCard = useTranslations('brands.card');
  const { activeBrandId, setActiveBrand } = useBrandStore();
  const isActive = brand.id === activeBrandId;

  const initials = brand.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const primaryDomain = brand.domains.find((d) => d.isPrimary);

  const select = () => setActiveBrand(brand.id);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-card transition-all',
        'hover:border-primary/40 hover:shadow-sm',
        isActive && 'ring-2 ring-primary border-primary/60',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3.5">
        <Avatar className="h-10 w-10 rounded-lg bg-zinc-50 dark:bg-zinc-100">
          <AvatarImage src={brand.logoUrl} alt={brand.name} className="object-contain p-1" />
          <AvatarFallback className="rounded-lg bg-background text-foreground text-sm font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold leading-tight">{brand.name}</h3>
            {isActive && (
              <Badge
                variant="secondary"
                className="gap-1 border-primary/30 bg-primary/15 text-[10px] text-primary"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Active
              </Badge>
            )}
          </div>
          {primaryDomain && (
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Globe className="h-3 w-3 shrink-0" />
              {primaryDomain.domain}
            </p>
          )}
        </div>
      </div>

      <div className="border-t">
        <NavRow
          icon={Tag}
          label={tCard('addTopic')}
          href={`/dashboard/brands/${brand.id}/topics`}
          addHref={`/dashboard/brands/${brand.id}/topics#add-topic`}
          addLabel={tCard('addTopic')}
          onSelect={select}
        />
        <NavRow
          icon={MessageSquareText}
          label={tCard('addPrompt')}
          href={`/dashboard/brands/${brand.id}/prompts`}
          addHref={`/dashboard/brands/${brand.id}/prompts#add-prompt`}
          addLabel={tCard('addPrompt')}
          onSelect={select}
        />
        <NavRow
          icon={Settings}
          label={tNav('settings')}
          href={`/dashboard/brands/${brand.id}/settings`}
          onSelect={select}
        />
      </div>
    </div>
  );
}

interface NavRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
  addHref?: string;
  addLabel?: string;
  onSelect: () => void;
}

function NavRow({ icon: Icon, label, href, addHref, addLabel, onSelect }: NavRowProps) {
  return (
    <div className="flex items-center border-t text-sm first:border-t-0 hover:bg-muted/50">
      <Link href={href} onClick={onSelect} className="flex flex-1 items-center gap-3 px-4 py-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{label}</span>
      </Link>
      {addHref && addLabel ? (
        <Link
          href={addHref}
          onClick={onSelect}
          aria-label={addLabel}
          title={addLabel}
          className="flex items-center px-4 py-2.5 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
        </Link>
      ) : (
        <div className="px-4 py-2.5 text-muted-foreground">
          <ChevronRight className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
