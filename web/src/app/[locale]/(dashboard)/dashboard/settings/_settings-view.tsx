'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { usePlanContext } from '@/components/providers/plan-provider';
import { BillingSection } from '@/components/settings/billing-section';
import { TeamSection } from '@/components/settings/team-section';
import { AuthorsSection } from '@/components/settings/authors-section';
import { ApiKeysSection } from '@/components/settings/api-keys-section';
import { AiProvidersSection } from '@/components/settings/ai-providers-section';
import { NotificationsSection } from '@/components/settings/notifications-section';
import { IntegrationsSection } from '@/components/settings/integrations-section';
import { OrganizationSection } from '@/components/settings/organization-section';
import { updateAccountName } from '@/lib/actions/organization';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  SETTINGS_SECTIONS,
  hasSettingsSection,
  settingsSectionPath,
  type SettingsSection,
} from './_sections';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';

/**
 * Settings, opened on `section`: from its own address (/dashboard/settings/
 * ai-providers) or the older ?tab= one, which e-mails and the integrations'
 * OAuth return still use. Picking a section moves the address to it.
 */
export function SettingsView({ section }: { section: SettingsSection }) {
  const t = useTranslations('settings');
  const tAuth = useTranslations('auth');
  const router = useRouter();
  const { isCloud } = usePlanContext();
  const [active, setActive] = useState<SettingsSection>(section);

  const show = (next: SettingsSection) => {
    setActive(next);
    window.history.replaceState(null, '', settingsSectionPath(window.location.pathname, next));
  };
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      setDisplayName(u?.user_metadata?.full_name ?? '');
      setEmail(u?.email ?? '');
    });
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/sign-in');
    router.refresh();
  }

  async function handleSaveAccount() {
    setSavingName(true);
    try {
      await updateAccountName(displayName);
      toast.success(t('saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accountSaveFailed'));
    } finally {
      setSavingName(false);
    }
  }

  const labels: Record<SettingsSection, string> = {
    account: t('account'),
    organization: t('organization'),
    team: t('team'),
    authors: t('authors.title'),
    notifications: t('notifications'),
    integrations: t('integrations'),
    'api-keys': t('apiKeys'),
    'ai-providers': t('aiProviders'),
    billing: t('billing'),
  };
  // AI Providers (bring your own key) and Billing are cloud-only: self-host
  // operators set ANTHROPIC_API_KEY in their own env.
  const navItems = SETTINGS_SECTIONS.filter((id) => hasSettingsSection(id, { isCloud })).map(
    (id) => ({ id, label: labels[id] }),
  );

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>

      <Separator />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sidebar nav */}
        <nav className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => show(item.id)}
              className={cn(
                'w-full text-left rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Main content — only active section shown */}
        <div className="lg:col-span-2">
          {/* Account */}
          {active === 'account' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('account')}</CardTitle>
                <CardDescription>{t('accountDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">{t('displayName')}</Label>
                  <Input
                    id="name"
                    placeholder="Your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">{t('email')}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={() => {}}
                    disabled
                  />
                </div>
                <Button onClick={handleSaveAccount} disabled={savingName || !displayName.trim()}>
                  {savingName && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
                <Separator className="my-2" />
                <Button
                  variant="outline"
                  onClick={handleSignOut}
                  className="text-destructive hover:text-destructive"
                >
                  {tAuth('signOut')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Organization */}
          {active === 'organization' && <OrganizationSection />}

          {/* Team */}
          {active === 'team' && <TeamSection />}

          {active === 'authors' && hasSettingsSection('authors', { isCloud }) && <AuthorsSection />}

          {active === 'notifications' && <NotificationsSection />}

          {active === 'integrations' && <IntegrationsSection />}

          {/* API Keys */}
          {active === 'api-keys' && <ApiKeysSection />}

          {/* AI Providers (cloud BYOK) */}
          {active === 'ai-providers' && isCloud && <AiProvidersSection />}

          {/* Billing */}
          {active === 'billing' && isCloud && <BillingSection />}
        </div>
      </div>
    </div>
  );
}
