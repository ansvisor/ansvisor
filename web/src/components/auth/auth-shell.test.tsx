import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The auth pages' frame (the owner's options D and E, 2026-11-10): one
 * centred column, with a headline, the logo above the card and a line under
 * it as each page's choice. The old product pitch is gone.
 */

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element -- a stand-in for next/image
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
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
}));

const { AuthCard, AuthShell } = await import('./auth-shell');

function html(node: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );
}

const count = (markup: string, needle: string) => markup.split(needle).length - 1;

const OLD_PITCH = [
  'AI visibility platform',
  'Improve AI Visibility and',
  'Drive Growth.',
  'Monitor brand mentions and citations',
  'Discover new opportunities',
];

describe('AuthShell', () => {
  it('by default: the logo in the header, the card alone in the column', () => {
    const markup = html(
      <AuthShell
        prompt="Already have an account?"
        cta={{ href: '/sign-in', label: 'Sign in' }}
        aside={<span data-testid="aside">signed in as cal@acme.test</span>}
      >
        <p>the card</p>
      </AuthShell>,
    );
    expect(markup).toContain('data-place="header"');
    expect(markup).not.toContain('data-place="above-card"');
    expect(count(markup, 'src="/logo_light.svg"')).toBe(1);
    expect(count(markup, 'src="/logo_dark.svg"')).toBe(1);
    expect(markup).not.toContain('data-slot="auth-headline"');
    expect(markup).not.toContain('data-slot="auth-footnote"');
    expect(markup).toContain('max-w-[420px]');
    // The header's button is outlined, and the prompt beside it stays off phones.
    expect(markup).toMatch(/<a href="\/sign-in" class="[^"]*border-black\/10[^"]*">Sign in<\/a>/);
    expect(markup).toMatch(/<span class="text-muted-foreground hidden sm:inline">Already/);
    expect(markup).toContain('signed in as cal@acme.test');
    expect(markup).toContain('the card');
    for (const line of OLD_PITCH) expect(markup).not.toContain(line);
  });

  it('draws every slot a page asks for: headline, logo above the card and footnote', () => {
    const markup = html(
      <AuthShell
        prompt="Don't have an account?"
        cta={{ href: '/sign-up', label: 'Sign up' }}
        headline="Be the answer AI gives."
        footnote="Tracks ChatGPT · Claude"
        brandAboveCard
      >
        <p>the card</p>
      </AuthShell>,
    );
    expect(markup).toMatch(/<h1 data-slot="auth-headline"[^>]*>Be the answer AI gives\.<\/h1>/);
    expect(markup).toMatch(/<p data-slot="auth-footnote"[^>]*>Tracks ChatGPT · Claude<\/p>/);
    // The logo moves above the card: none in the header.
    expect(markup).toContain('data-place="above-card"');
    expect(markup).not.toContain('data-place="header"');
    // Above the card, the headline, the card, then the footnote.
    const order = ['data-place="above-card"', 'auth-headline', 'the card', 'auth-footnote'].map(
      (needle) => markup.indexOf(needle),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // With the logo off the header, the prompt shows on phones too.
    expect(markup).toMatch(/<span class="text-muted-foreground">Don&#x27;t have an account\?/);
    for (const line of OLD_PITCH) expect(markup).not.toContain(line);
  });

  it('raises the card on a soft shadow, except under a headline (sign-up)', () => {
    const raised = html(
      <AuthShell brandAboveCard>
        <AuthCard title="Sign in">
          <p>form</p>
        </AuthCard>
      </AuthShell>,
    );
    expect(raised).toContain('data-card="raised"');
    expect(raised).toMatch(/data-slot="auth-card" class="[^"]*in-data-\[card=raised\]:shadow-/);
    const flat = html(
      <AuthShell headline="Be the answer AI gives.">
        <AuthCard>
          <p>form</p>
        </AuthCard>
      </AuthShell>,
    );
    expect(flat).toContain('data-card="flat"');
  });

  it('draws nothing behind the page unless asked: the agent animation, before the content', () => {
    const none = html(
      <AuthShell>
        <p>the card</p>
      </AuthShell>,
    );
    expect(none).not.toContain('agent-backdrop');
    for (const [backdrop, slot] of [['agent', 'agent-backdrop']] as const) {
      const host = document.createElement('div');
      host.innerHTML = html(
        <AuthShell backdrop={backdrop}>
          <p>the card</p>
        </AuthShell>,
      );
      const shell = host.querySelector('[data-card]')!;
      // First in the frame, so the header, the column and the footer (z-10) sit above it.
      expect(shell.firstElementChild!.getAttribute('data-slot')).toBe(slot);
      expect(shell.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
      expect(shell.firstElementChild!.getAttribute('class')).toContain('pointer-events-none');
      for (const part of shell.querySelectorAll(':scope > header, :scope > main, :scope > footer'))
        expect(part.className).toMatch(/\brelative z-10\b/);
    }
  });

  it('marks the text, links and card the backdrops keep clear of', () => {
    const host = document.createElement('div');
    host.innerHTML = html(
      <AuthShell
        prompt="Already have an account?"
        cta={{ href: '/sign-in', label: 'Sign in' }}
        headline="Be the answer AI gives."
        footnote="Tracks ChatGPT · Claude"
        backdrop="agent"
      >
        <p>the card</p>
      </AuthShell>,
    );
    const marked = (value: string) =>
      [...host.querySelectorAll(`[data-keep-clear="${value}"]`)].map((el) =>
        (el.textContent ?? '').trim().slice(0, 24),
      );
    // In the header: the logo, and the question with its button; and the footer line.
    expect(marked('')).toEqual([
      'Ansvisor',
      'Already have an account?',
      `© ${new Date().getFullYear()} Ansvisor. Open so`,
    ]);
    // In the column: the headline, the card and the line under it.
    expect(marked('column')).toEqual([
      'Be the answer AI gives.',
      'the card',
      'Tracks ChatGPT · Claude',
    ]);
  });

  it('widens the column for a card with more to say', () => {
    const markup = html(
      <AuthShell wide>
        <p>the card</p>
      </AuthShell>,
    );
    expect(markup).toContain('max-w-lg');
    expect(markup).not.toContain('max-w-[420px]');
  });

  it('keeps the footer: copyright, licence, terms and privacy', () => {
    const markup = html(
      <AuthShell>
        <p>the card</p>
      </AuthShell>,
    );
    expect(markup).toContain(`© ${new Date().getFullYear()} Ansvisor. Open source under`);
    expect(markup).toContain('>MIT license</a>');
    expect(markup).toContain('>Terms</a>');
    expect(markup).toContain('>Privacy</a>');
  });
});

describe('AuthCard', () => {
  it('heads the card with its title and subtitle', () => {
    const markup = html(
      <AuthCard title="Sign in" subtitle="Welcome back!">
        <p>form</p>
      </AuthCard>,
    );
    expect(markup).toMatch(/<h1[^>]*>Sign in<\/h1>/);
    expect(markup).toContain('Welcome back!');
  });

  it('has no heading of its own without a title (under a shell headline)', () => {
    const markup = html(
      <AuthCard>
        <p>form</p>
      </AuthCard>,
    );
    expect(markup).not.toContain('<h1');
    expect(markup).toContain('form');
  });
});

describe('the auth messages', () => {
  it('no longer carry the old pitch or the sign-up card subtitle', () => {
    expect(messages.auth).not.toHaveProperty('pitch');
    expect(messages.auth).not.toHaveProperty('signUpSubtitle');
  });
});
