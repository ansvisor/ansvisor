'use client';

import { usePathname as useNextPathname, useRouter } from 'next/navigation';
import { stripLocalePrefix } from './strip-locale';

/** The client hooks of i18n/navigation.ts, kept apart so server components can import Link. */
export { useRouter };

export function usePathname(): string {
  return stripLocalePrefix(useNextPathname());
}
