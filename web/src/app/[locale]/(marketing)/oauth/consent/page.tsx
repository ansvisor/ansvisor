import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { AuthShell } from '@/components/auth/auth-shell';
import { ConsentCard, ConsentErrorCard } from '@/components/oauth/consent-card';
import { CONSENT_ERROR_CODES, type ConsentErrorCode } from '@/lib/mcp-oauth/authorize';
import { mcpOAuthEnabled } from '@/lib/mcp-oauth/config';
import { loadConsent } from '@/lib/mcp-oauth/consent';
import { approveConnection, denyConnection, switchAccount } from '@/lib/mcp-oauth/consent-actions';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('oauthConsent');
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const ACTIONS = {
  approve: approveConnection,
  deny: denyConnection,
  switchAccount,
};

function SignedInAs({ email }: { email: string }) {
  const t = useTranslations('oauthConsent');
  return <span className="text-sm text-muted-foreground">{t('signedInAs', { email })}</span>;
}

/**
 * Where a person decides whether an app may connect to Ansvisor as them
 * (MCP over OAuth, #2141; the approved mockup's screens 2 to 6). The
 * authorization endpoint sends them here with the request's id; signed out,
 * they sign in first and come back. A request that can't be used is
 * explained here and never sent anywhere. 404 while MCP over OAuth is off.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; error?: string }>;
}) {
  if (!mcpOAuthEnabled()) notFound();
  const { request, error } = await searchParams;

  if (error) {
    const code = (CONSENT_ERROR_CODES as readonly string[]).includes(error)
      ? (error as ConsentErrorCode)
      : 'invalid_request';
    return (
      <AuthShell pitch={false}>
        <ConsentErrorCard code={code} />
      </AuthShell>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const state = await loadConsent(request, user ? { id: user.id, email: user.email ?? '' } : null);

  if (state.kind === 'sign_in') {
    redirect(`/sign-in?next=${encodeURIComponent(`/oauth/consent?request=${state.requestId}`)}`);
  }
  if (state.kind === 'error') {
    return (
      <AuthShell pitch={false}>
        <ConsentErrorCard code={state.code} />
      </AuthShell>
    );
  }
  return (
    <AuthShell pitch={false} aside={<SignedInAs email={state.view.email} />}>
      <ConsentCard view={state.view} actions={ACTIONS} />
    </AuthShell>
  );
}
