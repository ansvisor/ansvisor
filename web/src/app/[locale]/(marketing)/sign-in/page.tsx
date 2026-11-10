import { useTranslations } from 'next-intl';
import { SignInForm } from '@/components/auth/sign-in-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';
import { Link2, MailCheck } from 'lucide-react';
import { mcpOAuthEnabled } from '@/lib/mcp-oauth/config';
import { appForSignIn, type ConsentApp } from '@/lib/mcp-oauth/consent';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; next?: string }>;
}) {
  const params = await searchParams;
  const showVerificationBanner = params.verified === 'pending';
  // On the way to connecting an app (MCP over OAuth): the line names it.
  const connecting = mcpOAuthEnabled() ? await appForSignIn(params.next) : null;

  return <SignInView showVerificationBanner={showVerificationBanner} connecting={connecting} />;
}

function SignInView({
  showVerificationBanner,
  connecting,
}: {
  showVerificationBanner: boolean;
  connecting: ConsentApp | null;
}) {
  const t = useTranslations('auth');

  return (
    <AuthShell prompt={t('noAccount')} cta={{ href: '/sign-up', label: t('createAccount') }}>
      <div className="flex flex-col gap-6">
        {connecting && <ConnectingBanner app={connecting} />}
        {showVerificationBanner && <VerificationBanner />}
        <AuthCard title={t('signIn')} subtitle={t('signInSubtitle')}>
          <SignInForm />
        </AuthCard>
      </div>
    </AuthShell>
  );
}

function VerificationBanner() {
  const t = useTranslations('auth');

  return (
    <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50">
      <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
      <p className="text-sm text-blue-800 dark:text-blue-300">{t('verificationPending')}</p>
    </div>
  );
}

function ConnectingBanner({ app }: { app: ConsentApp }) {
  const t = useTranslations('auth');
  const bold = (chunks: React.ReactNode) => <b className="font-semibold">{chunks}</b>;

  return (
    <div
      data-slot="oauth-sign-in-line"
      className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950/50"
    >
      <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
      <p className="text-sm text-blue-800 dark:text-blue-300">
        {app.recognised && app.name
          ? t.rich('oauthSignInLine', { app: app.name, b: bold })
          : t.rich('oauthSignInLineUnchecked', { b: bold })}
      </p>
    </div>
  );
}
