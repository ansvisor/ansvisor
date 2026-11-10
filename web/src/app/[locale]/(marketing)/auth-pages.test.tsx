import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';

/**
 * What each page in the auth frame shows (the owner's options D and E,
 * 2026-11-10): sign-up under one headline, sign-in with the logo above its
 * card, and the other pages still drawn in the frame.
 */

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a stand-in for next/image
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/mcp-oauth/config', () => ({ mcpOAuthEnabled: () => true }));
vi.mock('@/lib/mcp-oauth/consent', () => ({
  appForSignIn: async () => null,
  loadConsent: vi.fn(),
}));
vi.mock('@/lib/mcp-oauth/consent-actions', () => ({
  approveConnection: vi.fn(),
  denyConnection: vi.fn(),
  switchAccount: vi.fn(),
}));
vi.mock('@/lib/mcp-oauth/authorize', () => ({ CONSENT_ERROR_CODES: ['invalid_request'] }));

const { default: SignUpPage } = await import('./sign-up/page');
const { default: SignInPage } = await import('./sign-in/page');
const { default: ForgotPasswordPage } = await import('./forgot-password/page');
const { default: ResetPasswordPage } = await import('./reset-password/page');
const { default: ConsentPage } = await import('./oauth/consent/page');

function html(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const OLD_PITCH = ['AI visibility platform', 'Drive Growth.', 'Discover new opportunities'];

describe('the sign-up page (option D)', () => {
  const markup = html(<SignUpPage />);
  const words = text(markup);

  it('leads with one headline, and the card has no title of its own', () => {
    expect(markup).toMatch(/<h1 data-slot="auth-headline"[^>]*>Be the answer AI gives\.<\/h1>/);
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(words).not.toContain('Create your account to start tracking');
  });

  it('names the six AI engines it tracks, under the card', () => {
    const footnote = markup.match(/<p data-slot="auth-footnote"[^>]*>([^<]*)<\/p>/)?.[1];
    expect(footnote).toBe(
      'Tracks ChatGPT · Claude · Gemini · Google AI Overviews · Google AI Mode · Bing AI Mode',
    );
    for (const engine of [
      'ChatGPT',
      'Claude',
      'Gemini',
      'Google AI Overviews',
      'Google AI Mode',
      'Bing AI Mode',
    ])
      expect(footnote).toContain(engine);
  });

  it('asks for an Email, suggesting a work one', () => {
    expect(markup).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
    expect(markup).toMatch(/<p id="email-hint"[^>]*>Work email suggested<\/p>/);
    expect(markup).toMatch(/<input[^>]*aria-describedby="email-hint"[^>]*>/);
    expect(markup).not.toMatch(/>Work email</);
  });

  it('keeps the logo in the header, an outlined Sign in beside the question, and no pitch', () => {
    expect(markup).toContain('data-place="header"');
    expect(markup).not.toContain('data-place="above-card"');
    expect(words).toContain('Already have an account? Sign in');
    expect(markup).toMatch(/<a href="\/sign-in" class="[^"]*border-black\/10[^"]*">Sign in<\/a>/);
    // Under the headline, the card has no shadow of its own (option D).
    expect(markup).toContain('data-card="flat"');
    for (const line of OLD_PITCH) expect(words).not.toContain(line);
  });

  it('keeps the real form: full name, password rule, Create account, GitHub and Google, terms', () => {
    expect(words).toContain('Full name');
    expect(words).toContain('At least 8 characters');
    expect(words).toContain('Create account');
    expect(words).toContain('Or continue with');
    expect(words).toContain('GitHub');
    expect(words).toContain('Google');
    expect(words).toContain(
      'By creating an account, you agree to our Terms of Service and Privacy Policy',
    );
  });
});

describe('the sign-in page (option E)', () => {
  it('puts the logo above a titled card, and no headline or pitch', async () => {
    const markup = html(await SignInPage({ searchParams: Promise.resolve({}) }));
    const words = text(markup);
    expect(markup).toContain('data-place="above-card"');
    expect(markup).not.toContain('data-place="header"');
    expect(markup).toContain('data-card="raised"');
    expect(markup).not.toContain('data-slot="auth-headline"');
    expect(markup).not.toContain('data-slot="auth-footnote"');
    expect(markup).toMatch(/<h1[^>]*>Sign in<\/h1>/);
    expect(words).toContain('Welcome back! Continue to your workspace.');
    expect(words).toContain("Don't have an account? Sign up");
    expect(markup).toMatch(/<a href="\/sign-up" class="[^"]*">Sign up<\/a>/);
    expect(markup).toMatch(/<label[^>]*for="email"[^>]*>Email<\/label>/);
    expect(words).toContain('Forgot password?');
    for (const line of OLD_PITCH) expect(words).not.toContain(line);
  });

  it('still says a verification e-mail is on its way, above the card', async () => {
    const markup = html(
      await SignInPage({ searchParams: Promise.resolve({ verified: 'pending' }) }),
    );
    const words = text(markup);
    expect(words).toContain('We sent a verification email to your inbox.');
    expect(words.indexOf('We sent a verification email')).toBeLessThan(
      words.indexOf('Welcome back!'),
    );
  });
});

describe('the other pages in the auth frame', () => {
  it('forgot password: like sign-in, with Sign in in the header', () => {
    const markup = html(<ForgotPasswordPage />);
    expect(text(markup)).toContain('Reset your password');
    expect(markup).toContain('data-place="above-card"');
    expect(markup).toMatch(/<a href="\/sign-in" class="[^"]*">Sign in<\/a>/);
    expect(markup).not.toContain('data-slot="auth-headline"');
  });

  it('reset password: like sign-in, with Sign in in the header', () => {
    const markup = html(<ResetPasswordPage />);
    expect(text(markup)).toContain('Set a new password');
    expect(markup).toContain('data-place="above-card"');
    expect(markup).toMatch(/<a href="\/sign-in" class="[^"]*">Sign in<\/a>/);
  });

  it('the consent page: the logo in the header and a wider column', async () => {
    const markup = html(
      await ConsentPage({ searchParams: Promise.resolve({ error: 'invalid_request' }) }),
    );
    expect(text(markup)).toContain("This connection request can't be used");
    expect(markup).toContain('data-place="header"');
    expect(markup).toContain('max-w-lg');
    expect(markup).not.toContain('data-slot="auth-headline"');
  });
});
