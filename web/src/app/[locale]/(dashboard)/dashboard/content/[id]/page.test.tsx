import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentOpportunity } from '@/types';

/**
 * A content opportunity's own page (step 9's detail pages): what Chat's side
 * panel sees of it, from the opportunity its panel reads.
 */

const ID = '0b2c3d4e-5f60-4a1b-8c2d-3e4f5a6b7c8d';
vi.mock('next/navigation', () => ({ useParams: () => ({ id: ID }) }));
const read = vi.hoisted(() => ({ opportunity: null as ContentOpportunity | null }));
vi.mock('@/components/content/opportunity-detail', () => ({
  OpportunityDetail: ({
    onOpportunity,
  }: {
    onOpportunity?: (opportunity: ContentOpportunity) => void;
  }) => {
    useEffect(() => {
      if (read.opportunity) onOpportunity?.(read.opportunity);
    }, [onOpportunity]);
    return null;
  },
}));
const { chatPage } = vi.hoisted(() => ({ chatPage: vi.fn() }));
vi.mock('@/components/chat/panel/chat-panel-context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useChatPageContext: chatPage,
}));

const { default: ContentDetailPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  chatPage.mockClear();
  read.opportunity = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(<ContentDetailPage />));
}

describe("what Chat's side panel sees (the owner's plan, step 9's detail pages)", () => {
  it('holds the content opportunity open by its id, with its title, once read', async () => {
    read.opportunity = { id: ID, title: 'Office coffee subscriptions' } as ContentOpportunity;
    await render();
    expect(chatPage.mock.lastCall![0]).toEqual({
      pageName: 'Office coffee subscriptions',
      view: { open: { ref: ID, label: 'Office coffee subscriptions' } },
    });
  });

  it('says nothing while it reads', async () => {
    await render();
    expect(chatPage.mock.lastCall![0]).toBeNull();
  });
});
