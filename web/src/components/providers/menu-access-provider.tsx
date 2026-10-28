'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The left-menu sections the viewer's menu leaves out (menu access, 00374),
 * read once by the dashboard layout. Empty by default, so a tree without the
 * provider shows the whole menu.
 */
const MenuAccessContext = createContext<ReadonlySet<string>>(new Set());

export function MenuAccessProvider({
  hidden,
  children,
}: {
  hidden: string[];
  children: ReactNode;
}) {
  const value = useMemo(() => new Set(hidden), [hidden]);
  return <MenuAccessContext.Provider value={value}>{children}</MenuAccessContext.Provider>;
}

export function useHiddenMenuSections(): ReadonlySet<string> {
  return useContext(MenuAccessContext);
}
