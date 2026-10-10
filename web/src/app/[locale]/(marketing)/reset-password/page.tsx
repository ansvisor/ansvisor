import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');

  return (
    <AuthShell cta={{ href: '/sign-in', label: t('signIn') }}>
      <AuthCard title={t('resetPasswordTitle')} subtitle={t('resetPasswordSubtitle')}>
        <ResetPasswordForm />
      </AuthCard>
    </AuthShell>
  );
}
