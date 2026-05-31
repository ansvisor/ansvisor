import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * GET /auth/confirm — locale-prefixed mirror of the root route.
 *
 * next-intl middleware rewrites every `/auth/*` request to `/[locale]/auth/*`,
 * so a root-only file at `/auth/confirm/route.ts` is never actually matched.
 * This file is what serves the URL the user clicks in their invite mail
 * (we keep the root sibling around to match the existing /auth/callback
 * convention, even though the locale version is what handles requests).
 *
 * Server-side OTP verification using the Supabase recommended SSR pattern:
 * read `token_hash` + `type` from the URL, call `verifyOtp` to set the
 * cookie session, then 302 to `redirect_to` or `next` (or `/dashboard`).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const rawRedirect = searchParams.get('redirect_to') ?? searchParams.get('next');
  const redirectTarget = resolveRedirect(rawRedirect, origin);

  if (!tokenHash || !type) {
    return NextResponse.redirect(`${origin}/sign-in?error=auth_confirm_missing_params`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(
      `${origin}/sign-in?error=auth_confirm_failed&reason=${encodeURIComponent(error.message)}`,
    );
  }

  return NextResponse.redirect(redirectTarget);
}

function resolveRedirect(value: string | null, origin: string): string {
  if (!value) return `${origin}/dashboard`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${origin}${value}`;
  return `${origin}/dashboard`;
}
