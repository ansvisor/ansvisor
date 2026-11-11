'use client';

import { useContext, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChevronDown,
  CircleHelp,
  CreditCard,
  LogOut,
  MessageSquareHeart,
  Plug,
  Settings,
  Sparkles,
  Terminal,
  UserRound,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { siteConfig } from '@/config/site';
import { PLANS } from '@/config/plans';
import { createClient } from '@/lib/supabase/client';
import { startChatRun } from '@/lib/chat/start-chat';
import { daysUntil, type SettingsDot, type SettingsDotPlace } from '@/lib/settings-dots';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBrandStore } from '@/stores/use-brand-store';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RoleContext } from '@/components/providers/role-provider';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import {
  hasSettingsSection,
  teamSection,
} from '@/app/[locale]/(dashboard)/dashboard/settings/_sections';
import { MenuDot } from './menu-dot';
import { SettingsDotMark, useSettingsDotWords, useSettingsDots } from './settings-dots';

const SETTINGS_HREF = '/dashboard/settings';

/** Where the dot sits on the avatar and the gear. */
const CORNER_DOT = 'absolute -right-0.5 -top-0.5 ring-2 ring-sidebar';

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * ⌘, (Ctrl+, elsewhere) opens Settings, as the account menu says: listened
 * for once, by the desktop sidebar's footer.
 */
function useSettingsShortcut(on: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!on) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ',' || event.altKey || event.shiftKey) return;
      if (!(isMac() ? event.metaKey : event.ctrlKey)) return;
      event.preventDefault();
      router.push(SETTINGS_HREF);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on, router]);
}

interface UserProfileNavItemProps {
  collapsed?: boolean;
  onClick?: () => void;
  className?: string;
  /** Listen for ⌘, (the desktop sidebar's; the mobile menu's doesn't). */
  shortcut?: boolean;
}

/**
 * The sidebar's footer: the person, whose name opens the account menu (a
 * dropdown of Settings' shortcuts, What's new, Help, Send feedback and Sign
 * out), and the gear, which opens Settings as before. Collapsed, the avatar
 * opens the same menu. Admins and managers see Settings' dots on the menu's
 * items, and the strongest one on the avatar and the gear.
 */
export function UserProfileNavItem({
  collapsed = false,
  onClick,
  className,
  shortcut = false,
}: UserProfileNavItemProps) {
  useSettingsShortcut(shortcut);
  const t = useTranslations('nav');
  const tMenu = useTranslations('accountMenu');
  const tAccess = useTranslations('chatAccess');
  const tHome = useTranslations('chatShell.home');
  const router = useRouter();
  // With the new Chat on, the row says the person's role (CHAT-20 §4b).
  const { role } = useContext(RoleContext);
  const chatAgentic = useChatAgentic();
  const { isCloud, ownPlanId, subscriptionStatus, trialEndsAt, workspaceName } = usePlanContext();
  const { isLocked, openUpgrade } = useUpgradeGate();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { dots, top } = useSettingsDots();
  const dotWords = useSettingsDotWords();
  const pathname = usePathname();
  // The gear opens Settings, so it marks Settings as current.
  const active = pathname.startsWith(SETTINGS_HREF);
  const user = useAuthStore((state) => state.user);
  const fullName = user?.user_metadata?.full_name;
  const displayName = typeof fullName === 'string' ? fullName : '';
  const email = user?.email ?? '';
  // What's new's unread dot, as Chat's chip reads it: asked when the menu opens.
  const [whatsNewUnread, setWhatsNewUnread] = useState(false);

  const label = displayName || email || 'User Name';
  const initials = displayName
    ? displayName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('')
    : (email[0]?.toUpperCase() ?? 'U');

  const plan =
    subscriptionStatus === 'trialing' && trialEndsAt
      ? tMenu('trialLeft', { days: daysUntil(trialEndsAt, new Date()) })
      : PLANS[ownPlanId].name;
  const workspaceLine = workspaceName
    ? tMenu('workspacePlan', { workspace: workspaceName, plan })
    : plan;

  const go = (href: string) => {
    onClick?.();
    router.push(href);
  };
  const openTab = (href: string) => {
    onClick?.();
    window.open(href, '_blank', 'noopener,noreferrer');
  };

  const onOpenChange = (open: boolean) => {
    if (!open || !chatAgentic) return;
    void fetch('/api/chat/whats-new?unread=true&limit=1&days=14')
      .then((res) => res.json())
      .then((body: { ok?: boolean; hasUnread?: boolean }) => {
        if (body?.ok) setWhatsNewUnread(!!body.hasUnread);
      })
      .catch(() => undefined);
  };

  // What's new asks Chat, as Chat Home's What's new chip does.
  const whatsNew = async () => {
    onClick?.();
    if (isLocked) {
      openUpgrade();
      return;
    }
    const started = await startChatRun(tHome('forYou.whatsNewMessage'), brandId ?? null);
    if (!started.ok) {
      if (started.code === 'subscription_inactive' || started.code === 'demo_brand') openUpgrade();
      else toast.error(started.error ?? tHome('startFailed'));
      return;
    }
    router.push(`/dashboard/chat/${started.chatId}`);
  };

  const signOut = async () => {
    onClick?.();
    await createClient().auth.signOut();
    router.push('/sign-in');
    router.refresh();
  };

  // Settings' sections, by the rules the Settings page lists them with.
  const sections: {
    place: SettingsDotPlace | null;
    href: string;
    label: string;
    icon: typeof Settings;
  }[] = [
    { place: null, href: `${SETTINGS_HREF}/account`, label: tMenu('account'), icon: UserRound },
    {
      place: 'members',
      href: `${SETTINGS_HREF}/${teamSection(chatAgentic)}`,
      label: tMenu('members'),
      icon: Users,
    },
    {
      place: 'integrations',
      href: `${SETTINGS_HREF}/integrations`,
      label: tMenu('integrations'),
      icon: Plug,
    },
    { place: 'api', href: `${SETTINGS_HREF}/api-keys`, label: tMenu('api'), icon: Terminal },
    ...(hasSettingsSection('billing', { isCloud })
      ? [
          {
            place: 'billing' as const,
            href: `${SETTINGS_HREF}/billing`,
            label: tMenu('billing'),
            icon: CreditCard,
          },
        ]
      : []),
  ];

  const itemBody = (icon: ReactNode, text: string, dot: SettingsDot | null) => (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{text}</span>
        {dot && (
          <span aria-hidden className="block truncate text-xs text-muted-foreground">
            {dotWords(dot)}
          </span>
        )}
      </span>
      {dot && <SettingsDotMark dot={dot} />}
    </>
  );

  const avatar = (
    <span className="relative shrink-0">
      {/* The initials repeat the name, so screen readers skip them. */}
      <Avatar className="h-8 w-8" aria-hidden>
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {initials}
        </AvatarFallback>
      </Avatar>
      {top && <SettingsDotMark dot={top} className={CORNER_DOT} />}
    </span>
  );

  return (
    <div className={cn('flex items-center gap-1', className)}>
      <DropdownMenu onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          data-slot="account-menu-trigger"
          title={collapsed ? label : undefined}
          render={
            <button
              type="button"
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[popup-open]:bg-sidebar-accent',
                collapsed && 'justify-center px-0',
              )}
            />
          }
        >
          {avatar}
          {!collapsed && (
            <>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium capitalize">{label}</span>
                {chatAgentic && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {tAccess(`roleNames.${role}`)}
                  </span>
                )}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </>
          )}
          <span className="sr-only">
            {collapsed ? tMenu('openFor', { name: label }) : tMenu('open')}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block truncate text-foreground">{email || label}</span>
              <span className="block truncate font-normal">{workspaceLine}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => go(SETTINGS_HREF)}>
            <Settings className="text-muted-foreground" />
            <span className="flex-1">{tMenu('settings')}</span>
            <DropdownMenuShortcut>{isMac() ? '⌘,' : 'Ctrl+,'}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {sections.map(({ place, href, label: text, icon: Icon }) => (
            <DropdownMenuItem
              key={href}
              data-account-item={place ?? 'account'}
              onClick={() => go(href)}
            >
              {itemBody(
                <Icon className="text-muted-foreground" />,
                text,
                place ? (dots[place] ?? null) : null,
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {chatAgentic && (
            <DropdownMenuItem data-account-item="whats-new" onClick={() => void whatsNew()}>
              <Sparkles className="text-muted-foreground" />
              <span className="flex-1">{tMenu('whatsNew')}</span>
              {whatsNewUnread && (
                <MenuDot dot={{ colour: 'green' }} label={tMenu('whatsNewUnread')} />
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => openTab(siteConfig.links.docs)}>
            <CircleHelp className="text-muted-foreground" />
            {tMenu('help')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openTab(siteConfig.links.feedback)}>
            <MessageSquareHeart className="text-muted-foreground" />
            {t('feedback')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void signOut().catch(() => undefined)}>
            <LogOut className="text-muted-foreground" />
            {tMenu('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The gear opens Settings, as it always has. */}
      {!collapsed && (
        <Link
          href={SETTINGS_HREF}
          onClick={onClick}
          aria-current={active ? 'page' : undefined}
          title={t('settings')}
          className={cn(
            'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            active
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
          )}
        >
          <Settings className="h-4 w-4" aria-hidden />
          {top && <SettingsDotMark dot={top} className={CORNER_DOT} />}
          <span className="sr-only">{t('settings')}</span>
        </Link>
      )}
    </div>
  );
}
