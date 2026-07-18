'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, Link } from '@/i18n/navigation';
import { dashboardNav } from '@/config/dashboard';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { useAgentKeyStatus } from '@/hooks/use-agent-key-status';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { UserProfileNavItem } from '@/components/layout/user-profile-nav-item';
import { useBrandStore } from '@/stores/use-brand-store';
import { Crown, Menu, MessageSquareText } from 'lucide-react';
import Image from 'next/image';
import { useTheme } from 'next-themes';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations('nav');
  const tBrands = useTranslations('brands');
  const { canUse, requiredPlanFor, isCloud } = useFeatureGate();
  // Probe once per session — shares the module-level cache with sidebar.tsx
  // so at most one network request is made even when both components mount.
  const agentKeyStatus = useAgentKeyStatus(isCloud);
  const agentKeyMissing = isCloud && agentKeyStatus === 'missing';
  const { activeBrandId } = useBrandStore();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Hydration guard — see sidebar.tsx for the rationale; the two
  // components mirror each other and can't share a hook without breaking
  // their independent layout contexts.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const logoSrc = mounted && resolvedTheme === 'dark' ? '/logo_dark.svg' : '/logo_light.svg';

  const getLabel = (title: string): string => {
    const map: Record<string, string> = {
      Overview: t('overview'),
      Brands: tBrands('title'),
      'Answer Engine Insights': t('insights'),
      'AI Traffic Analytics': t('traffic'),
      Prompts: t('prompts'),
      'Content Optimization': t('content'),
      Competitors: t('competitors'),
      Citations: t('citations'),
      Reports: t('reports'),
      Settings: t('settings'),
    };
    return map[title] ?? title;
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" />}>
        <Menu className="h-5 w-5" />
        <span className="sr-only">Toggle menu</span>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-64 flex-col p-0">
        <div className="flex gap-2 h-16 items-center border-b px-4">
          <Image
            src={logoSrc}
            alt={siteConfig.name}
            width={24}
            height={24}
            className="h-6 w-6 shrink-0"
            priority
          />
          <span className="font-semibold">{siteConfig.name}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <nav className="space-y-0.5 p-3">
            {activeBrandId && (
              <Link
                href={`/dashboard/brands/${activeBrandId}/prompts`}
                onClick={() => setOpen(false)}
              >
                <span
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    pathname.includes(`/brands/${activeBrandId}/prompts`)
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  <MessageSquareText className="h-4 w-4 shrink-0" />
                  Prompts
                </span>
              </Link>
            )}
            {dashboardNav.flatMap((group) =>
              group.items.map((item) => {
                const isActive =
                  item.href === '/dashboard'
                    ? pathname === '/dashboard'
                    : pathname.startsWith(item.href);
                const label = getLabel(item.title);

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
                      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/50 cursor-not-allowed"
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      <Badge
                        variant="outline"
                        className="h-5 gap-0.5 px-1.5 text-[10px] font-normal"
                      >
                        <Crown className="h-2.5 w-2.5" />
                        {requiredPlanFor(item.requiredFeature!)}
                      </Badge>
                    </span>
                  );
                }

                return (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                    <span
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{label}</span>
                      {effectiveBadge && (
                        <Badge
                          variant="secondary"
                          className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                        >
                          {effectiveBadge}
                        </Badge>
                      )}
                    </span>
                  </Link>
                );
              }),
            )}
          </nav>
        </div>
        <div className="border-t p-2">
          <UserProfileNavItem onClick={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
