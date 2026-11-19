import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { FormatLocale } from '@/components/providers/format-locale';
import { notFound } from 'next/navigation';
import { ThemeProvider } from 'next-themes';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { localeDirection } from '@/i18n/locales';
import { routing } from '@/i18n/routing';
import { Toaster } from '@/components/ui/sonner';

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // The address's locale is always en; the screen's language is the person's
  // own (i18n/request.ts), and formats follow it.
  const [messages, uiLocale] = await Promise.all([getMessages(), getLocale()]);

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <NextIntlClientProvider messages={messages} locale={uiLocale}>
        <DirectionProvider direction={localeDirection(uiLocale)}>
          <FormatLocale locale={uiLocale} />
          {children}
          <Toaster richColors position="top-right" />
        </DirectionProvider>
      </NextIntlClientProvider>
    </ThemeProvider>
  );
}
