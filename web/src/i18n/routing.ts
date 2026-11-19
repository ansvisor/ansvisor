import { defineRouting } from 'next-intl/routing';

// The address carries no interface language: that is the person's own
// (i18n/request.ts, locales.ts), so the only locale an address knows is en,
// and every existing link keeps working.
export const routing = defineRouting({
  locales: ['en'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',
});

export type Locale = (typeof routing.locales)[number];
