'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether Ads is on (ADS_ENABLED, lib/ads/flag.ts), read once by the
 * dashboard's layout on the server: the variable never reaches the browser,
 * only this answer. Off by default, so a tree without the provider has no
 * Ads on its menu.
 */
const AdsContext = createContext(false);

export function AdsProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <AdsContext.Provider value={enabled}>{children}</AdsContext.Provider>;
}

export function useAdsEnabled(): boolean {
  return useContext(AdsContext);
}
