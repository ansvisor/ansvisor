'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether the simplified layout is on (SIMPLE_NAV, lib/simple-nav/flag.ts),
 * read once by the dashboard's layout on the server: the variable never
 * reaches the browser, only this answer. Off by default, so a tree without
 * the provider shows the menu, tabs and pages as they were.
 */
const SimpleNavContext = createContext(false);

export function SimpleNavProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return <SimpleNavContext.Provider value={enabled}>{children}</SimpleNavContext.Provider>;
}

export function useSimpleNav(): boolean {
  return useContext(SimpleNavContext);
}
