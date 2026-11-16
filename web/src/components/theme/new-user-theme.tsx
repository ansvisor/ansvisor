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
 * Starts a browser with no theme yet on the dark theme (NEW_USER_THEME), on
 * Ansvisor Cloud: on the sign-up, sign-in and password pages and in
 * onboarding, the first pages a browser sees. The theme is stored as if the
 * person had picked it, so the rest of the app opens dark too, and the
 * sun/moon button beside the logo switches it back. A browser that already
 * has a theme (picked, or given here before) keeps it.
 *
 * Sign-in can't tell new people from returning ones, so someone signing in
 * on a new browser or device starts dark too (the owner accepted this).
 * Someone who already uses Ansvisor and never picked a theme keeps light:
 * KeepCurrentTheme saves it when they open a dashboard page signed in, so
 * this finds a theme on their next sign-in and leaves it.
 *
 * The inline script covers a page loaded from the server; the effect covers
 * a page reached in the app (a link from another page), where React doesn't
 * run inline scripts.
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
