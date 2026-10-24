'use client';

import { useEffect, useState } from 'react';
import { getBrandFacts } from '@/lib/actions/brand-facts';
import type { BrandFactsRead } from '@/lib/content/brand-facts';

export type BrandFactsState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'ready'; read: BrandFactsRead }
  | { status: 'failed' };

/**
 * The brand's facts in the editor (Quality CE-047): read once with Quality's
 * second phase, and again when the person comes back to the tab (from Brand
 * settings › Brand facts, where they approve them; a read of what is kept,
 * not of the site). An API with them off is 'off'; a failed read keeps the
 * one before it.
 */
export function useBrandFacts(brandId: string, enabled: boolean): BrandFactsState {
  const [state, setState] = useState<BrandFactsState>({ status: 'loading' });
  const [visits, setVisits] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setVisits((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void getBrandFacts(brandId).then((result) => {
      if (!live) return;
      if (!('error' in result)) setState({ status: 'ready', read: result });
      else if (result.error === 'off') setState({ status: 'off' });
      else setState((prev) => (prev.status === 'ready' ? prev : { status: 'failed' }));
    });
    return () => {
      live = false;
    };
  }, [brandId, enabled, visits]);
  return enabled ? state : { status: 'off' };
}
