import { useTranslations } from 'next-intl';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';
import { NewUserTheme } from '@/components/theme/new-user-theme';
import { getSignUpLanguageState } from '@/lib/i18n/sign-up-language';

export default async function SignUpPage() {
  return <SignUpView languages={await getSignUpLanguageState()} />;
}

function SignUpView({
  languages,
}: {
  languages: Awaited<ReturnType<typeof getSignUpLanguageState>>;
}) {
  const t = useTranslations('auth');

  return (
    <>
      {/* Before the page: a new person starts on the dark theme, for a while (config/theme.ts). */}
      <NewUserTheme />
      <AuthShell
        prompt={t('hasAccount')}
        cta={{ href: '/sign-in', label: t('signIn') }}
        headline={t('signUpHeadline')}
        footnote={t('tracksEngines')}
        backdrop="agent"
      >
        <AuthCard>
          <SignUpForm languages={languages} />
        </AuthCard>
      </AuthShell>
    </>
  );
}
