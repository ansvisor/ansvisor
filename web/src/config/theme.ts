/**
 * The theme a browser with no theme yet starts on, on Ansvisor Cloud: dark,
 * for a while (owner decision 2026-11-10). NewUserTheme gives it on the
 * sign-up, sign-in and password pages and in onboarding. A browser with a
 * theme keeps it; one that never reaches those pages keeps the
 * ThemeProvider's default, light ([locale]/layout.tsx). Set to null to stop:
 * people who already started on dark keep it until they switch.
 */
export const NEW_USER_THEME: 'dark' | 'light' | null = 'dark';

/** Where next-themes keeps a browser's theme (its default storage key). */
export const THEME_STORAGE_KEY = 'theme';
