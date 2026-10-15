'use client';

import { useTranslations } from 'next-intl';
import { Settings } from 'lucide-react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/use-auth-store';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface UserProfileNavItemProps {
  collapsed?: boolean;
  onClick?: () => void;
  className?: string;
}

export function UserProfileNavItem({
  collapsed = false,
  onClick,
  className,
}: UserProfileNavItemProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  // The row is the sidebar's way into Settings, so it marks Settings as current.
  const active = pathname.startsWith('/dashboard/settings');
  const user = useAuthStore((state) => state.user);
  const fullName = user?.user_metadata?.full_name;
  const displayName = typeof fullName === 'string' ? fullName : '';
  const email = user?.email ?? '';

  const label = displayName || email || 'User Name';
  const initials = displayName
    ? displayName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('')
    : (email[0]?.toUpperCase() ?? 'U');

  return (
    <Link
      href="/dashboard/settings"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'bg-primary/10 text-primary' : 'hover:bg-sidebar-accent',
        collapsed && 'justify-center px-0',
        className,
      )}
      title={collapsed ? `${label} · ${t('settings')}` : undefined}
    >
      {/* The initials repeat the name, so screen readers skip them. */}
      <Avatar className="h-8 w-8 shrink-0" aria-hidden>
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {initials}
        </AvatarFallback>
      </Avatar>
      {!collapsed && (
        <>
          <span className="truncate text-sm font-medium capitalize">{label}</span>
          {/* The whole row opens Settings; the gear says so. */}
          <Settings
            className={cn(
              'ml-auto h-4 w-4 shrink-0 transition-colors',
              active
                ? 'text-primary'
                : 'text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground',
            )}
            aria-hidden
          />
        </>
      )}
      {/* Read as "<name>, Settings"; collapsed, the name comes from here too. */}
      <span className="sr-only">{collapsed ? `${label}, ${t('settings')}` : t('settings')}</span>
    </Link>
  );
}
