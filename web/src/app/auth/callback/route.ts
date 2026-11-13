import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendSignedUpEvent } from '@/lib/resend-event';
import { capturePostHog } from '@/lib/posthog-server';
import { NEXT_COOKIE, nextFromCookie, safeNextPath } from '@/lib/auth-next';

/**
 * GET /auth/callback — where GitHub and Google sign-in come back. Goes on to
 * the page the visitor asked for: `?next=`, or the cookie the OAuth buttons
 * set before leaving (the provider's redirect URL stays the same), and only
 * to a page on this site.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(
    searchParams.get('next') ?? nextFromCookie(request.cookies.get(NEXT_COOKIE)?.value),
  );

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Google or GitHub: a person's first sign-in is the one where the
      // account was only just made (a later sign-in is minutes or more after).
      const user = data?.user;
      const fresh =
        user?.created_at &&
        user.last_sign_in_at &&
        Math.abs(Date.parse(user.last_sign_in_at) - Date.parse(user.created_at)) < 10_000;
      if (user && fresh) {
        await sendSignedUpEvent(user);
        await capturePostHog('signed_up', user.id, {
          source: 'oauth',
          provider: user.app_metadata?.provider ?? null,
        });
      }
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.delete(NEXT_COOKIE);
      return response;
    }
  }

  return NextResponse.redirect(`${origin}/sign-in?error=auth`);
}
