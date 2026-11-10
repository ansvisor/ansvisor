import { useTranslations } from 'next-intl';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';
import { NewUserTheme } from '@/components/theme/new-user-theme';

export default function SignUpPage() {
  const t = useTranslations('auth');

  return (
    <>
      {/* Before the page: a new person starts on the dark theme, for a while (config/theme.ts). */}
      <NewUserTheme />
      <AuthShell prompt={t('hasAccount')} cta={{ href: '/sign-in', label: t('signIn') }}>
        <AuthCard title={t('signUp')} subtitle={t('signUpSubtitle')}>
          <SignUpForm />
        </AuthCard>
      </AuthShell>
    </>
  );
}
