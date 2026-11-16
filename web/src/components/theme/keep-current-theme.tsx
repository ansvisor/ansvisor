'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { EXISTING_USER_THEME, THEME_STORAGE_KEY } from '@/config/theme';
import { isCloud } from '@/config/plans';

/**
 * Keeps someone who already uses Ansvisor on the theme they see, on Ansvisor
 * Cloud: a signed-in person opening a dashboard page in a browser with no
 * theme yet gets EXISTING_USER_THEME (light) saved, as if they had picked it.
 * Without it, the next sign-in page would start them on dark (NewUserTheme).
 *
 * Light is the ThemeProvider's default, so the page doesn't change as it
 * opens. A browser that already has a theme keeps it: one the person picked
 * with the sun/moon button, or the dark one a new person got on sign-up,
 * sign-in or onboarding. Self-hosted, it does nothing. See config/theme.ts.
 */
export function KeepCurrentTheme() {
  const { setTheme } = useTheme();
  const theme = isCloud() ? EXISTING_USER_THEME : null;

  useEffect(() => {
    if (!theme) return;
    try {
      if (window.localStorage.getItem(THEME_STORAGE_KEY) === null) setTheme(theme);
    } catch {
      // No storage (blocked, or a private window): nothing is saved, as before.
    }
  }, [theme, setTheme]);

  return null;
}
