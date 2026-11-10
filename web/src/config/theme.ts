/**
 * The theme a new person starts on: dark, for a while (owner decision
 * 2026-11-10). Everyone else keeps the ThemeProvider's default, light
 * ([locale]/layout.tsx), or the theme they picked. Set to null to stop:
 * people who already started on dark keep it until they switch.
 */
export const NEW_USER_THEME: 'dark' | 'light' | null = 'dark';

/** Where next-themes keeps a browser's theme (its default storage key). */
export const THEME_STORAGE_KEY = 'theme';
