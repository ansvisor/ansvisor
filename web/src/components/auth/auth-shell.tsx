import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';

/**
 * The frame every auth page shares (the owner's options D and E, 2026-11-10):
 * a header with the switch to the other auth page, and one centred column
 * with the page's card. Around the card, each page picks: a headline above
 * it (sign-up), the logo above it instead of in the header (sign-in) and a
 * muted line below it. The card sits on a soft shadow, except under a
 * headline (sign-up, option D).
 */
export function AuthShell({
  prompt,
  cta,
  aside,
  headline,
  footnote,
  brandAboveCard = false,
  wide = false,
  children,
}: {
  /** The question beside the header button, e.g. "Don't have an account?" */
  prompt?: string;
  /** The header's outlined button to the other auth page. */
  cta?: { href: '/sign-in' | '/sign-up'; label: string };
  /** Shown at the header's right instead of a button, e.g. who is signed in (the consent page). */
  aside?: React.ReactNode;
  /** The page's heading, large above the card; the card then goes untitled. */
  headline?: string;
  /** One muted line under the card. */
  footnote?: string;
  /** The logo above the card, and none in the header. */
  brandAboveCard?: boolean;
  /** A wider column, for a card with more to say (the consent page). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations('auth');

  return (
    <div
      data-card={headline ? 'flat' : 'raised'}
      className="relative flex min-h-svh flex-col overflow-hidden bg-[#f7f5f1] dark:bg-background"
    >
      <header
        className={cn(
          'relative z-10 flex w-full items-center gap-4 px-4 py-5 sm:px-8 sm:py-7 lg:px-14',
          brandAboveCard ? 'justify-end' : 'justify-between',
        )}
      >
        {!brandAboveCard && <Brand />}

        <div className="flex items-center gap-3.5 text-sm">
          {prompt && (
            <span className={cn('text-muted-foreground', !brandAboveCard && 'hidden sm:inline')}>
              {prompt}
            </span>
          )}
          {cta && (
            <Link
              href={cta.href}
              className={cn(
                buttonVariants({ variant: 'outline' }),
                'h-9 border-black/10 bg-transparent px-4 dark:border-input dark:bg-input/30',
              )}
            >
              {cta.label}
            </Link>
          )}
          {aside}
        </div>
      </header>

      <main className="relative z-10 flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 pb-8 pt-2 sm:px-8">
        {brandAboveCard && <Brand large />}
        {headline && (
          <h1
            data-slot="auth-headline"
            className="max-w-3xl text-balance text-center font-[family-name:var(--font-jakarta)] text-4xl font-bold leading-[1.05] tracking-[-0.03em] sm:text-[52px]"
          >
            {headline}
          </h1>
        )}
        <div className={cn('w-full', wide ? 'max-w-lg' : 'max-w-[420px]')}>{children}</div>
        {footnote && (
          <p
            data-slot="auth-footnote"
            className="max-w-xl text-balance text-center text-[13px] text-muted-foreground"
          >
            {footnote}
          </p>
        )}
      </main>

      <footer className="relative z-10 w-full px-4 py-6 text-center text-xs text-muted-foreground sm:px-8">
        <p className="text-balance">
          &copy; {new Date().getFullYear()} {siteConfig.name}. {t('footer.openSource')}{' '}
          <a
            href="https://github.com/ansvisor/ansvisor/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {t('footer.mitLicense')}
          </a>
          <span aria-hidden> · </span>
          <a
            href={siteConfig.legal.terms}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {t('footer.terms')}
          </a>
          <span aria-hidden> · </span>
          <a
            href={siteConfig.legal.privacy}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {t('footer.privacy')}
          </a>
        </p>
      </footer>
    </div>
  );
}

/** The card holding a page's form; untitled under a shell headline. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="auth-card"
      className="rounded-2xl border bg-card p-6 sm:p-8 in-data-[card=raised]:shadow-[0_30px_80px_rgba(60,45,30,0.10)] dark:in-data-[card=raised]:shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
    >
      {title && (
        <div className="mb-6 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

/** The logo and name, linking to the website: in the header, or larger above the card. */
function Brand({ large = false }: { large?: boolean }) {
  const logo = cn('shrink-0', large ? 'size-10' : 'size-8.5');

  return (
    <a
      href={siteConfig.url}
      data-slot="auth-brand"
      data-place={large ? 'above-card' : 'header'}
      className="flex items-center gap-3"
    >
      <Image
        src="/logo_light.svg"
        alt=""
        width={40}
        height={40}
        className={cn(logo, 'dark:hidden')}
        priority
      />
      <Image
        src="/logo_dark.svg"
        alt=""
        width={40}
        height={40}
        className={cn(logo, 'hidden dark:block')}
        priority
      />
      <span
        className={cn('font-semibold tracking-[-0.01em]', large ? 'text-[22px]' : 'text-[19px]')}
      >
        {siteConfig.name}
      </span>
    </a>
  );
}
