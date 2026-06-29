import { AlertCircle } from 'lucide-react';
import { OnboardingSignOutButton } from '@/components/auth/onboarding-sign-out-button';

/**
 * Shown to a non-admin member when their org's subscription has lapsed.
 * They can't renew or re-onboard, so instead of the payment / onboarding flow
 * they get a clear "contact your account owner" message (plus a way out).
 */
export function SubscriptionExpiredNotice({ ownerName }: { ownerName?: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="mt-4 text-lg font-semibold">Subscription required</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This account&rsquo;s subscription has ended, so tracking and dashboard access are paused.
          {ownerName
            ? ` Please contact your account owner (${ownerName}) to renew it.`
            : ' Please contact your account owner or an admin to renew it.'}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          You don&rsquo;t have billing access on this account, so you can&rsquo;t renew it or make
          changes until it&rsquo;s active again.
        </p>
      </div>
      <OnboardingSignOutButton />
    </div>
  );
}
