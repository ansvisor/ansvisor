import createMiddleware from 'next-intl/middleware';
import { type NextRequest, NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { updateSession } from '@/lib/supabase/middleware';
import { nextFromRequest } from '@/lib/auth-next';
import { UI_LOCALE_COOKIE, UI_LOCALE_COOKIE_MAX_AGE } from '@/lib/i18n/ui-locale-cookie';
import { uiLocaleCookieOnSignIn } from '@/lib/i18n/sign-in-locale';
import { chatAgenticForUser, chatPathOfAgentPath } from '@/lib/chat/legacy-route';

const intlMiddleware = createMiddleware(routing);

const protectedPathnames = ['/dashboard'];
const authPathnames = ['/sign-in', '/sign-up'];

function isProtected(pathname: string): boolean {
  return protectedPathnames.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isAuthRoute(pathname: string): boolean {
  return authPathnames.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The interface language cookie (LOC-005) for a person whose cookie is missing
 * or is another person's: their profiles.ui_language (00549), a language they
 * picked while signing up (saved on their profile now), or Automatic. One
 * small read, only until the cookie is set; null when nothing to set.
 */
async function uiLocaleCookieFor(
  request: NextRequest,
  user: { id: string } | null,
  supabase: Awaited<ReturnType<typeof updateSession>>['supabase'] | null,
): Promise<string | null> {
  if (!user || !supabase) return null;
  try {
    return await uiLocaleCookieOnSignIn(
      request.cookies.get(UI_LOCALE_COOKIE)?.value,
      user.id,
      supabase,
    );
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const pathnameWithoutLocale = pathname.replace(/^\/(en)/, '') || '/';

  let supabaseResponse: NextResponse | undefined;
  let user: { id: string } | null = null;
  let supabase: Awaited<ReturnType<typeof updateSession>>['supabase'] | null = null;

  try {
    const session = await updateSession(request);
    supabaseResponse = session.supabaseResponse;
    user = session.user;
    supabase = session.supabase;
  } catch {
    // Supabase session refresh failed — continue without auth context
    // so next-intl locale routing still works
  }

  if (pathnameWithoutLocale === '/') {
    const target = user ? '/dashboard' : '/sign-in';
    return NextResponse.redirect(new URL(target, request.url));
  }

  // The pricing page lives on the marketing site (ansvisor.com/pricing) now,
  // not the app subdomain — redirect any stale links / bookmarks so they
  // land on the canonical page instead of 404'ing (#113).
  if (pathnameWithoutLocale === '/pricing') {
    return NextResponse.redirect('https://ansvisor.com/pricing', 302);
  }

  if (isProtected(pathnameWithoutLocale) && !user) {
    // Back to this page after signing in, query included (an e-mail's
    // `?tab=notifications`): `next` is what the sign-in form and the OAuth
    // callback read.
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set(
      'next',
      nextFromRequest(pathnameWithoutLocale, request.nextUrl.search),
    );
    return NextResponse.redirect(signInUrl);
  }

  if (isAuthRoute(pathnameWithoutLocale) && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Agent Chat's old addresses open the new Chat, where it is on for the
  // person's workspace (CHAT-01 item 2): a 301 to the matching
  // /dashboard/chat address, query kept. Not kept by the browser
  // (no-store), so it stops at once if the flag is turned off again.
  const chatPath = chatPathOfAgentPath(pathnameWithoutLocale);
  if (chatPath && user && supabase) {
    const db = supabase;
    const signedIn = user;
    const on = await chatAgenticForUser(async () => {
      const { data } = await db
        .from('profiles')
        .select('organization_id')
        .eq('id', signedIn.id)
        .maybeSingle();
      return data?.organization_id ?? null;
    }).catch(() => false);
    if (on) {
      const response = NextResponse.redirect(
        new URL(`${chatPath}${request.nextUrl.search}`, request.url),
        301,
      );
      response.headers.set('Cache-Control', 'no-store');
      supabaseResponse?.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie.name, cookie.value, cookie);
      });
      return response;
    }
  }

  // Workaround for a Next.js framework issue (vercel/next.js#91723): RSC
  // prefetch/navigation requests and server-action POSTs that go through
  // next-intl's middleware intermittently die server-side with "The router
  // state header was sent but could not be parsed" — and the client then
  // holds its whole server-action queue behind the failed transition, which
  // froze the Prompts page. With a single 'en' locale the only thing the
  // intl middleware does for these requests is the /en rewrite, so do that
  // by hand and skip the intl machinery entirely.
  // The person's language is in a cookie the server reads before it renders:
  // set here once, and on this very request (request.ts reads it below).
  const uiLocaleCookie = await uiLocaleCookieFor(request, user, supabase);
  if (uiLocaleCookie) request.cookies.set(UI_LOCALE_COOKIE, uiLocaleCookie);
  const withUiLocale = <T extends NextResponse>(response: T): T => {
    if (uiLocaleCookie) {
      response.cookies.set(UI_LOCALE_COOKIE, uiLocaleCookie, {
        path: '/',
        maxAge: UI_LOCALE_COOKIE_MAX_AGE,
        sameSite: 'lax',
      });
    }
    return response;
  };

  const isRscOrAction = request.headers.has('rsc') || request.headers.has('next-action');
  if (isRscOrAction) {
    const needsLocalePrefix = !(pathname === '/en' || pathname.startsWith('/en/'));
    const response = needsLocalePrefix
      ? NextResponse.rewrite(new URL(`/en${pathname}${request.nextUrl.search}`, request.url), {
          request,
        })
      : NextResponse.next({ request });
    if (supabaseResponse) {
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie.name, cookie.value, cookie);
      });
    }
    return withUiLocale(response);
  }

  const intlResponse = intlMiddleware(request);

  if (supabaseResponse) {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      intlResponse.cookies.set(cookie.name, cookie.value, cookie);
    });
  }

  return withUiLocale(intlResponse);
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
