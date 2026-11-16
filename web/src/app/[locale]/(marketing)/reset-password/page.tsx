import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';
import { NewUserTheme } from '@/components/theme/new-user-theme';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');

  return (
    <>
      {/* Before the page: a browser with no theme yet starts on dark, for a while (config/theme.ts). */}
      <NewUserTheme />
      <AuthShell cta={{ href: '/sign-in', label: t('signIn') }} brandAboveCard>
        <AuthCard title={t('resetPasswordTitle')} subtitle={t('resetPasswordSubtitle')}>
          <ResetPasswordForm />
        </AuthCard>
      </AuthShell>
    </>
  );
}
