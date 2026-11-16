import { useTranslations } from 'next-intl';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';
import { NewUserTheme } from '@/components/theme/new-user-theme';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');

  return (
    <>
      {/* Before the page: a browser with no theme yet starts on dark, for a while (config/theme.ts). */}
      <NewUserTheme />
      <AuthShell cta={{ href: '/sign-in', label: t('signIn') }} brandAboveCard>
        <AuthCard title={t('forgotPasswordTitle')} subtitle={t('forgotPasswordSubtitle')}>
          <ForgotPasswordForm />
        </AuthCard>
      </AuthShell>
    </>
  );
}
