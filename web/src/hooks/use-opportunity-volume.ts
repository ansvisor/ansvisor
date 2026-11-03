'use client';

import { useEffect, useState } from 'react';
import { getOpportunityBasket } from '@/lib/actions/content';
import { getPromptDemand } from '@/lib/actions/action-center';
import { keptVolume } from '@/lib/content/opportunity-markdown';
import { sumEstimates, type VolumeEstimate } from '@/lib/volume-estimate';
import type { ContentOpportunity, OpportunityBasket } from '@/types';

/**
 * The opportunity's basket, read once for its card, and its AI volume
 * (PROMPT-013): the sum of its prompts' current estimates, or the volume kept
 * on it if those can't be read. `volume` is undefined while it is read.
 */
export function useOpportunityVolume(opportunity: ContentOpportunity | null) {
  const id = opportunity?.id;
  const brandId = opportunity?.brandId;
  const promptId = opportunity?.promptId;
  const clusterId = opportunity?.clusterId;
  const [basket, setBasket] = useState<{
    id: string;
    basket: OpportunityBasket | null;
    failed: boolean;
  } | null>(null);
  const [live, setLive] = useState<{ key: string; estimates: VolumeEstimate[] | null } | null>(
    null,
  );

  useEffect(() => {
    if (!id || !clusterId) return;
    let cancelled = false;
    getOpportunityBasket(id)
      .then((read) => !cancelled && setBasket({ id, basket: read, failed: false }))
      .catch(() => !cancelled && setBasket({ id, basket: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [id, clusterId]);

  const read = basket?.id === id ? basket : null;
  // Its prompts: a cluster's members once its basket is in (none if it can't
  // be read: its prompt_id is only the cluster's representative), else its one prompt.
  const ready = !!id && (!clusterId || read !== null);
  const promptIds = !ready
    ? null
    : clusterId
      ? [...new Set(read?.basket?.clusters.flatMap((c) => c.prompts.map((p) => p.id)) ?? [])]
      : promptId
        ? [promptId]
        : [];
  const key = promptIds?.length && brandId ? `${brandId}:${promptIds.join(',')}` : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    // The key is "brand:prompt,prompt", all UUIDs.
    const [brand, ids] = key.split(':');
    getPromptDemand(brand, ids.split(','))
      .then((byPrompt) => !cancelled && setLive({ key, estimates: Object.values(byPrompt) }))
      .catch(() => !cancelled && setLive({ key, estimates: null }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  const estimates = live?.key === key ? live.estimates : undefined;
  // A cluster's prompts are summed, even one; a lone prompt keeps its own note.
  const current = !estimates?.length
    ? null
    : clusterId || estimates.length > 1
      ? sumEstimates(estimates)
      : estimates[0];
  const kept = opportunity && keptVolume(opportunity);
  const volume = !promptIds
    ? undefined
    : !key
      ? kept
      : estimates === undefined
        ? undefined
        : (current ?? kept);
  return { basket: read?.basket ?? null, basketFailed: read?.failed ?? false, volume };
}
