import { useTranslations } from 'next-intl';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');

  return (
    <AuthShell cta={{ href: '/sign-in', label: t('signIn') }}>
      <AuthCard title={t('forgotPasswordTitle')} subtitle={t('forgotPasswordSubtitle')}>
        <ForgotPasswordForm />
      </AuthCard>
    </AuthShell>
  );
}
