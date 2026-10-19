import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SignUpForm } from '@/components/auth/sign-up-form';

export default function SignUpPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <SignUpCard />
      </div>
    </div>
  );
}

function SignUpCard() {
  const t = useTranslations('auth');

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('signUp')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('hasAccount')}{' '}
          <Link
            href="/sign-in"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('signIn')}
          </Link>
        </p>
      </div>
      <SignUpForm />
    </div>
  );
}
