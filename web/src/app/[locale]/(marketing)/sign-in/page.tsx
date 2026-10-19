import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SignInForm } from '@/components/auth/sign-in-form';
import { MailCheck } from 'lucide-react';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string }>;
}) {
  const params = await searchParams;
  const showVerificationBanner = params.verified === 'pending';

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        {showVerificationBanner && <VerificationBanner />}
        <SignInCard />
      </div>
    </div>
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

function SignInCard() {
  const t = useTranslations('auth');

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('signIn')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link
            href="/sign-up"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('createAccount')}
          </Link>
        </p>
      </div>
      <SignInForm />
    </div>
  );
}
