import { create } from 'zustand';
import type { SettingsSeenPlace, SettingsState } from '@/lib/settings-dots';

/**
 * Settings' dots (getSettingsState), shared by the footer's account menu
 * and the Settings page, so one read serves both. `opened` keeps the places
 * opened on this device since, per brand: their green clears at once,
 * before the next read brings the visit back. Nothing is kept in the
 * browser beyond the page's life.
 */
interface SettingsStateStore {
  read: { key: string; at: number; state: SettingsState | null } | null;
  /** The read on its way, by what it asked for. */
  pending: string | null;
  opened: Record<string, Partial<Record<SettingsSeenPlace, string>>>;
  markOpened: (brandId: string, place: SettingsSeenPlace, at: string) => void;
}

export const useSettingsStateStore = create<SettingsStateStore>()((set) => ({
  read: null,
  pending: null,
  opened: {},
  markOpened: (brandId, place, at) =>
    set((s) => ({ opened: { ...s.opened, [brandId]: { ...s.opened[brandId], [place]: at } } })),
}));
