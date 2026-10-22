import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentOpportunity, OpportunityBasket } from '@/types';
import { guessedVolumeEstimate, type VolumeEstimate } from '@/lib/volume-estimate';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const getOpportunityBasket = vi.fn<(id: string) => Promise<OpportunityBasket>>();
const getPromptDemand =
  vi.fn<(brandId: string, ids: string[]) => Promise<Record<string, VolumeEstimate>>>();
vi.mock('@/lib/actions/content', () => ({
  getOpportunityBasket: (id: string) => getOpportunityBasket(id),
}));
vi.mock('@/lib/actions/action-center', () => ({
  getPromptDemand: (brandId: string, ids: string[]) => getPromptDemand(brandId, ids),
}));

const { useOpportunityVolume } = await import('./use-opportunity-volume');

type Read = ReturnType<typeof useOpportunityVolume>;

function Probe({ opportunity, seen }: { opportunity: ContentOpportunity; seen: Read[] }) {
  seen.push(useOpportunityVolume(opportunity));
  return null;
}

let root: Root;

async function render(opportunity: ContentOpportunity): Promise<Read[]> {
  const seen: Read[] = [];
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(<Probe opportunity={opportunity} seen={seen} />));
  return seen;
}

const opportunity = (over: Partial<ContentOpportunity> = {}): ContentOpportunity => ({
  id: 'o1',
  brandId: 'b1',
  clusterId: 'c1',
  title: 'Espresso grinders',
  description: '',
  type: 'owned',
  impact: 'high',
  opportunityScore: 70,
  status: 'new',
  sourceData: { estAiVolume: 1000 },
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

const basket = (ids: string[]): OpportunityBasket => ({
  clusters: [
    {
      id: 'c1',
      label: 'Grinders',
      need: '',
      topicName: null,
      prompts: ids.map((id) => ({ id, text: id })),
    },
  ],
  queries: [],
});

const estimate = (value: number) => guessedVolumeEstimate(value, '2026-10-01T00:00:00Z');

beforeEach(() => {
  getOpportunityBasket.mockReset();
  getPromptDemand.mockReset();
});

afterEach(() => act(() => root.unmount()));

/** A content opportunity's AI volume (PROMPT-013): its prompts' estimates now, read once. */
describe('useOpportunityVolume', () => {
  it("sums its cluster's prompts' current estimates and hands the basket on", async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1', 'p2']));
    getPromptDemand.mockResolvedValue({ p1: estimate(300), p2: estimate(500) });
    const seen = await render(opportunity());

    expect(seen[0].volume).toBeUndefined();
    const last = seen.at(-1)!;
    expect(getPromptDemand).toHaveBeenCalledWith('b1', ['p1', 'p2']);
    expect(last.volume).toMatchObject({ value: 800, count: 2 });
    expect(last.basket?.clusters[0].prompts).toHaveLength(2);
    expect(getOpportunityBasket).toHaveBeenCalledTimes(1);
  });

  it('reads one prompt without a basket, keeping its own estimate', async () => {
    getPromptDemand.mockResolvedValue({ p9: estimate(400) });
    const last = (await render(opportunity({ clusterId: null, promptId: 'p9' }))).at(-1)!;

    expect(getOpportunityBasket).not.toHaveBeenCalled();
    expect(last.volume).toMatchObject({ value: 400, basis: 'guess' });
    expect(last.volume).not.toHaveProperty('count');
  });

  it('sums a cluster even when only one of its prompts has an estimate', async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1', 'p2']));
    getPromptDemand.mockResolvedValue({ p1: estimate(300) });
    const last = (await render(opportunity())).at(-1)!;

    expect(last.volume).toMatchObject({ value: 300, count: 1 });
  });

  it('falls back to the volume kept on it, undated, when the estimates fail', async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1']));
    getPromptDemand.mockRejectedValue(new Error('down'));
    const last = (await render(opportunity())).at(-1)!;

    expect(last.volume).toMatchObject({
      basis: 'snapshot',
      value: 1000,
      low: 500,
      high: 2000,
      confidence: 'low',
      asOf: null,
    });
  });

  it('marks a failed basket and still shows the kept volume', async () => {
    getOpportunityBasket.mockRejectedValue(new Error('down'));
    // A cluster's prompt_id is only its representative: never read as the whole.
    const last = (await render(opportunity({ promptId: 'p0' }))).at(-1)!;

    expect(last.basketFailed).toBe(true);
    expect(getPromptDemand).not.toHaveBeenCalled();
    expect(last.volume).toMatchObject({ basis: 'snapshot', value: 1000 });
  });

  it('shows nothing when no prompt has an estimate and none was kept', async () => {
    getOpportunityBasket.mockResolvedValue(basket(['p1']));
    getPromptDemand.mockResolvedValue({});
    const last = (await render(opportunity({ sourceData: {} }))).at(-1)!;

    expect(last.volume).toBeNull();
  });
});
