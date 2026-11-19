import { getTranslations } from 'next-intl/server';
import { SignUpForm } from '@/components/auth/sign-up-form';
import { AuthCard, AuthShell } from '@/components/auth/auth-shell';
import { NewUserTheme } from '@/components/theme/new-user-theme';
import { getSignUpLanguageState } from '@/lib/i18n/sign-up-language';

export default async function SignUpPage() {
  const [t, languages] = await Promise.all([getTranslations('auth'), getSignUpLanguageState()]);

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
