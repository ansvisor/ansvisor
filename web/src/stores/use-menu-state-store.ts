import { create } from 'zustand';
import type { DotArea, MenuState } from '@/lib/menu-dots';

/** The last read of the menu's state (getMenuState): what it asked for, for which brand, when. */
export interface MenuStateRead {
  key: string;
  brandId: string;
  at: number;
  state: MenuState | null;
}

/**
 * The menu's dots and Action Center count, shared
 * by the sidebar, the mobile menu and NavSeen, so one read serves them all.
 * `opened` keeps the pages opened on this device since, per brand: their
 * dots clear at once, before the next read brings the visit back from the
 * server. Nothing is kept in the browser beyond the page's life.
 */
interface MenuStateStore {
  read: MenuStateRead | null;
  /** The read on its way, by what it asked for. */
  pending: string | null;
  opened: Record<string, Partial<Record<DotArea, string>>>;
  markOpened: (brandId: string, area: DotArea, at: string) => void;
  /** The areas whose dot showed this session (menu_dot_shown is sent once for each). */
  shown: Partial<Record<DotArea, true>>;
}

export const useMenuStateStore = create<MenuStateStore>()((set) => ({
  read: null,
  pending: null,
  opened: {},
  shown: {},
  markOpened: (brandId, area, at) =>
    set((s) => ({ opened: { ...s.opened, [brandId]: { ...s.opened[brandId], [area]: at } } })),
}));
