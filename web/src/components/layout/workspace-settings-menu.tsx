'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/use-user-role';
import { usePlanContext } from '@/components/providers/plan-provider';
import {
  hasSettingsSection,
  teamSection,
  type SettingsSection,
} from '@/app/[locale]/(dashboard)/dashboard/settings/_sections';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Building2, ChevronDown, CreditCard, Settings, UserRound, Users } from 'lucide-react';

/** The workspace's own sections, in the settings page's order. */
const SECTIONS = [
  { id: 'account', icon: UserRound },
  { id: 'organization', icon: Building2 },
  { id: 'billing', icon: CreditCard },
  { id: 'team', icon: Users },
] satisfies { id: SettingsSection; icon: typeof Settings }[];

/**
 * Workspace Settings, top right of the brands page and a brand's page: the
 * settings that aren't a brand's (account, organization, team, billing), each
 * opening its section of /dashboard/settings. Admins and managers only;
 * Billing only where the settings page has it (Ansvisor Cloud).
 */
export function WorkspaceSettingsMenu() {
  const t = useTranslations('settings');
  const tBrands = useTranslations('brands');
  const router = useRouter();
  const { canManage } = useUserRole();
  const { isCloud } = usePlanContext();
  // Team is in Team, roles & access with the new Chat on (owner, 2026-11-09).
  const team = teamSection(useChatAgentic());

  if (!canManage) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className="gap-2" />}>
        <Settings className="h-4 w-4" />
        {tBrands('workspaceSettings')}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {SECTIONS.filter((s) => hasSettingsSection(s.id, { isCloud })).map(({ id, icon: Icon }) => {
          const section = id === 'team' ? team : id;
          return (
            <DropdownMenuItem
              key={id}
              onClick={() => router.push(`/dashboard/settings/${section}`)}
            >
              <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {section === 'roles-access' ? t('teamRolesAccess') : t(id)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
