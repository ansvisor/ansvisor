'use client';

import { Link } from '@/i18n/navigation';
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
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors hover:bg-sidebar-accent',
        collapsed && 'justify-center px-0',
        className,
      )}
      title={collapsed ? label : undefined}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {initials}
        </AvatarFallback>
      </Avatar>
      {!collapsed && <span className="truncate text-sm font-medium capitalize">{label}</span>}
    </Link>
  );
}
