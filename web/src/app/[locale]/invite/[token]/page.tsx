import { getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getInvitationByToken } from '@/lib/actions/team';
import { createClient } from '@/lib/supabase/server';
import { AcceptInvitationCard } from '@/components/team/accept-invitation-card';
import { AlertTriangle } from 'lucide-react';

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token, locale } = await params;
  const t = await getTranslations({ locale, namespace: 'invite' });

  const invitation = await getInvitationByToken(token);

  if (!invitation) {
    return <InvalidInvitation locale={locale} reason="not_found" />;
  }

  if (invitation.status !== 'pending') {
    return <InvalidInvitation locale={locale} reason={invitation.status} />;
  }

  // eslint-disable-next-line react-hooks/purity -- server component renders fresh per request; Date.now() is the correct expiration check, the purity rule targets client-side memoization which doesn't apply on the server.
  if (new Date(invitation.expiresAt).getTime() < Date.now()) {
    return <InvalidInvitation locale={locale} reason="expired" />;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = `/${locale}/invite/${token}`;
    redirect({
      href: `/sign-up?invite=${token}&email=${encodeURIComponent(invitation.email)}&next=${encodeURIComponent(next)}`,
      locale,
    });
  }

  const emailMatches = user!.email?.toLowerCase() === invitation.email.toLowerCase();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <AcceptInvitationCard
          token={token}
          organizationName={invitation.organizationName ?? t('fallbackTeam')}
          email={invitation.email}
          role={invitation.role}
          currentUserEmail={user!.email ?? ''}
          emailMatches={emailMatches}
        />
      </div>
    </div>
  );
}

const INVALID_REASONS = ['not_found', 'expired', 'accepted', 'revoked', 'pending'] as const;

async function InvalidInvitation({
  locale,
  reason,
}: {
  locale: string;
  reason: 'not_found' | 'expired' | 'accepted' | 'revoked' | 'pending';
}) {
  const t = await getTranslations({ locale, namespace: 'invite.invalid' });
  const key = INVALID_REASONS.includes(reason) ? reason : 'pending';
  const msg = { title: t(`${key}.title`), description: t(`${key}.description`) };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h1 className="text-xl font-semibold">{msg.title}</h1>
        <p className="text-sm text-muted-foreground">{msg.description}</p>
      </div>
    </div>
  );
}
