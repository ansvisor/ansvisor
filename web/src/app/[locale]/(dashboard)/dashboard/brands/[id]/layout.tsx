'use client';

import { use } from 'react';
import { usePathname, Link } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { Button } from '@/components/ui/button';
import { BrandAvatar } from '@/components/brand-avatar';
import { cn } from '@/lib/utils';
import { ArrowLeft, MessageSquareText, Settings, Tag } from 'lucide-react';

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
  const { brands } = useBrandStore();
  const brand = brands.find((b) => b.id === id);

  return (
    <div className="space-y-6">
      {/* Brand header + back */}
      <div className="flex items-center gap-4">
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
              <h1 className="text-xl font-bold tracking-tight">{brand.name}</h1>
              <p className="text-xs text-muted-foreground">
                {brand.domains.find((d) => d.isPrimary)?.domain ?? ''}
              </p>
            </div>
          </div>
        )}
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
