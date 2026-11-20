'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { OAuthButtons } from '@/components/auth/oauth-buttons';
import { OrDivider } from '@/components/auth/or-divider';
import { siteConfig } from '@/config/site';
import { track } from '@/lib/analytics';
import { stripInviteParams } from '@/lib/analytics-privacy';
import { cn } from '@/lib/utils';
import { LOCALE_NAMES, type AnyUiLocale } from '@/i18n/locales';
import { setSignUpUiLanguage } from '@/lib/actions/ui-language';

/**
 * The sign-up form. `languages` is the Language field (the page's
 * getSignUpLanguageState): shown only while more than one language is offered.
 */
export function SignUpForm({
  languages,
}: {
  languages?: { options: AnyUiLocale[]; selected: AnyUiLocale };
}) {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  // An invitation link's address and way back are read once: the link's token
  // and the invited address then leave the address bar (history, replays).
  const [invitedEmail] = useState(() => searchParams.get('email') ?? '');
  const [nextPath] = useState(() => searchParams.get('next'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [language, setLanguage] = useState(languages?.selected);
  const [changingLanguage, setChangingLanguage] = useState(false);

  // Before the account exists, in the visitor's cookie only; saved on their
  // profile when they first sign in. The page then shows in it.
  async function chooseLanguage(locale: AnyUiLocale) {
    const before = language;
    setLanguage(locale);
    setChangingLanguage(true);
    try {
      await setSignUpUiLanguage(locale);
      router.refresh();
    } catch {
      setLanguage(before);
      toast.error(t('languageFailed'));
    } finally {
      setChangingLanguage(false);
    }
  }

  useEffect(() => {
    const clean = stripInviteParams(window.location.href);
    if (clean) window.history.replaceState(null, '', clean);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (password.length < 8) {
      toast.error(t('errors.passwordTooShort'));
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (error) {
      toast.error(t('errors.generic'));
      setIsLoading(false);
      return;
    }

    track('signup_completed', { source: 'email' });

    toast.success(t('verificationEmailSent'));
    const nextQuery = nextPath ? `&next=${encodeURIComponent(nextPath)}` : '';
    router.push(`/sign-in?verified=pending${nextQuery}`);
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="fullName">{t('fullName')}</Label>
          <Input
            id="fullName"
            type="text"
            placeholder={t('fullNamePlaceholder')}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            autoComplete="name"
            disabled={isLoading}
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">{t('email')}</Label>
          <Input
            id="email"
            type="email"
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            aria-describedby="email-hint"
            disabled={isLoading || Boolean(invitedEmail)}
            className="h-11"
          />
          {/* A suggestion only: any address can sign up. */}
          <p id="email-hint" className="text-sm text-muted-foreground">
            {t('workEmailSuggested')}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">{t('password')}</Label>
          <PasswordInput
            id="password"
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            disabled={isLoading}
            className="h-11"
          />
          <p
            className={cn(
              'flex items-center gap-2 text-sm transition-colors',
              password.length >= 8 ? 'text-muted-foreground' : 'text-muted-foreground/70',
            )}
          >
            <Check
              className={cn(
                'h-4 w-4',
                password.length >= 8 ? 'text-emerald-500' : 'text-muted-foreground/40',
              )}
            />
            {t('passwordRuleLength')}
          </p>
        </div>

        {languages && languages.options.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="signup-language">{t('language')}</Label>
            <select
              id="signup-language"
              value={language}
              disabled={isLoading || changingLanguage}
              onChange={(e) => {
                const picked = languages.options.find((code) => code === e.target.value);
                if (picked) void chooseLanguage(picked);
              }}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-start text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
            >
              {languages.options.map((code) => (
                <option key={code} value={code} lang={code}>
                  {LOCALE_NAMES[code]}
                </option>
              ))}
            </select>
          </div>
        )}

        <Button type="submit" className="h-11 w-full text-base" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
              {t('signingUp')}
            </>
          ) : (
            <>
              {t('createAccount')}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <OrDivider label={t('orContinueWith')} />
      <OAuthButtons next={nextPath} />

      <p className="text-center text-sm text-muted-foreground">
        {t('termsAgreement')}{' '}
        <a
          href={siteConfig.legal.terms}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('termsOfService')}
        </a>{' '}
        {t('and')}{' '}
        <a
          href={siteConfig.legal.privacy}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t('privacyPolicy')}
        </a>
        .
      </p>
    </div>
  );
}
