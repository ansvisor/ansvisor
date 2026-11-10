'use client';

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { NEW_USER_THEME, THEME_STORAGE_KEY } from '@/config/theme';
import { isCloud } from '@/config/plans';

/**
 * The script that starts a new person on NEW_USER_THEME before the page
 * paints, so they never see the light theme flash first. It does nothing in
 * a browser that already has a theme: one the person picked with the
 * sun/moon button, or one this gave them before. Exported for its test.
 */
export function newUserThemeScript(theme: string, storageKey: string): string {
  const t = JSON.stringify(theme);
  const k = JSON.stringify(storageKey);
  return (
    `try{if(localStorage.getItem(${k})===null){localStorage.setItem(${k},${t});` +
    `var d=document.documentElement;d.classList.remove('light','dark');d.classList.add(${t});` +
    `d.style.colorScheme=${t}}}catch(e){}`
  );
}

/**
 * Starts a new person on the dark theme (NEW_USER_THEME), on Ansvisor Cloud:
 * on the sign-up page and in onboarding, the pages only new people see. The
 * theme is stored as if they had picked it, so the rest of the app opens
 * dark too, and the sun/moon button beside the logo switches it back. A
 * browser that already has a theme keeps it, so no one who uses Ansvisor
 * today changes.
 *
 * The inline script covers a page loaded from the server; the effect covers
 * a page reached in the app (sign-in to sign-up), where React doesn't run
 * inline scripts.
 */
export function NewUserTheme() {
  const { setTheme } = useTheme();
  const theme = isCloud() ? NEW_USER_THEME : null;

  useEffect(() => {
    if (!theme) return;
    try {
      if (window.localStorage.getItem(THEME_STORAGE_KEY) !== null) return;
    } catch {
      return;
    }
    setTheme(theme);
  }, [theme, setTheme]);

  if (!theme) return null;
  return (
    <script
      // Before paint: next-themes then reads the stored theme on hydration.
      dangerouslySetInnerHTML={{ __html: newUserThemeScript(theme, THEME_STORAGE_KEY) }}
    />
  );
}
