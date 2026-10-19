import { useTranslations } from 'next-intl';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <ResetPasswordCard />
      </div>
    </div>
  );
}

function ResetPasswordCard() {
  const t = useTranslations('auth');

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('resetPasswordTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('resetPasswordSubtitle')}</p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
