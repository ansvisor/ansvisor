/**
 * The theme a browser with no theme yet starts on, on Ansvisor Cloud: dark,
 * for a while (owner decision 2026-11-10). NewUserTheme gives it on the
 * sign-up, sign-in and password pages and in onboarding, the pages a new
 * person sees first. A browser with a theme keeps it. Someone who already
 * uses Ansvisor keeps light: see EXISTING_USER_THEME. Set to null to stop:
 * people who already started on dark keep it until they switch.
 */
export const NEW_USER_THEME: 'dark' | 'light' | null = 'dark';

/**
 * The theme KeepCurrentTheme saves, on Ansvisor Cloud, in a browser with no
 * theme yet when a signed-in person opens a dashboard page: light, the
 * ThemeProvider's default ([locale]/layout.tsx), so the theme they already
 * see. Someone who used Ansvisor before NEW_USER_THEME and never pressed the
 * sun/moon button keeps light when they next sign in, instead of starting on
 * dark (owner decision 2026-11-16, option B). A new person doesn't get it:
 * NEW_USER_THEME was saved on sign-up, sign-in or onboarding, before the
 * dashboard. It must stay the ThemeProvider's default, or the page would
 * change theme as it opens.
 *
 * To stop it, set it to null (KeepCurrentTheme then does nothing), or remove
 * KeepCurrentTheme from the dashboard's layout along with this. Browsers it
 * already saved light in keep light until the person switches.
 */
export const EXISTING_USER_THEME: 'light' | null = 'light';

/** Where next-themes keeps a browser's theme (its default storage key). */
export const THEME_STORAGE_KEY = 'theme';
