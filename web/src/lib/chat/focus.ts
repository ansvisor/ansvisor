import { z } from 'zod';

/**
 * What Chat focuses on for a person (CHAT-24 §2; chat_user_prefs.focus,
 * 00400): one or more interest areas, kept in the order picked, the first
 * leading Home. Focus only changes what Chat suggests, never what the
 * person may do: their role decides that (CHAT-20).
 */

/** The areas, in the picker's order (mockup #s-dept). */
export const FOCUS_AREAS = [
  'lead',
  'comp',
  'growth',
  'seo',
  'content',
  'brand',
  'pd',
  'bd',
] as const;
export type FocusArea = (typeof FOCUS_AREAS)[number];

export function isFocusArea(value: unknown): value is FocusArea {
  return typeof value === 'string' && (FOCUS_AREAS as readonly string[]).includes(value);
}

/**
 * A saved focus: null when the person was never asked (or it can't be
 * read), an empty list when they skipped or cleared it. Unknown or
 * repeated areas are dropped.
 */
export function focusOf(value: unknown): FocusArea[] | null {
  if (!Array.isArray(value)) return null;
  const picks: FocusArea[] = [];
  for (const area of value) if (isFocusArea(area) && !picks.includes(area)) picks.push(area);
  return picks;
}

/**
 * Chat Home's view (chat_user_prefs.home_view, 00485): the Default view
 * (the greeting, one line and the box) or the one the focus tailors.
 */
export type HomeView = 'default' | 'focus';

/** A saved view: anything but 'focus' is the Default view. */
export function homeViewOf(value: unknown): HomeView {
  return value === 'focus' ? 'focus' : 'default';
}

/** A focus to keep: known areas, each once. Empty clears it. */
export const focusPicks = z
  .array(z.enum(FOCUS_AREAS))
  .max(FOCUS_AREAS.length)
  .refine((picks) => new Set(picks).size === picks.length);

/** Where a focus was picked (CHAT-24 §8 `chat_focus_saved.source`). */
export type FocusSource = 'first_open' | 'settings' | 'home_pill';
