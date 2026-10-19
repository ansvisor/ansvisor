import { useTranslations } from 'next-intl';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';

export default function SignUpPage() {
  const t = useTranslations('auth');

  return (
    <AuthShell prompt={t('hasAccount')} cta={{ href: '/sign-in', label: t('signIn') }}>
      <AuthCard title={t('signUp')} subtitle={t('signUpSubtitle')}>
        <SignUpForm />
      </AuthCard>
    </AuthShell>
  );
}
