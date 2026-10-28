import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brand, Topic } from '@/types';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A brand tracking more topics than one prompts call takes, its description longer. */
const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Coffee',
  description: 'd'.repeat(2500),
  language: 'en',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [{ id: 'd1', brandId: 'brand-id', domain: 'acme.com', isPrimary: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
const topics: Topic[] = Array.from({ length: 21 }, (_, i) => ({
  id: `t${i + 1}`,
  brandId: 'brand-id',
  name: `topic ${i + 1}`,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}));

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'brand-id' }) }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
  }),
}));
vi.mock('@/lib/actions/prompt', () => ({
  getPromptSets: async () => [],
  savePromptSet: vi.fn(),
  addPromptToSet: vi.fn(),
  setPromptActive: vi.fn(),
  updatePrompt: vi.fn(),
  updatePromptLocations: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
  getLocationQuota: async () => null,
  deletePrompt: vi.fn(),
}));
vi.mock('@/lib/actions/brand', () => ({ getBrandById: async () => brand }));
vi.mock('@/lib/actions/topic', () => ({ getTopics: async () => topics }));
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ planId: 'growth', allowedModelIds: null }),
}));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('@/lib/tracking-job-store', () => ({ saveTrackingJob: vi.fn() }));
vi.mock('@/components/dashboard/prompt-suggestion-card', () => ({
  PromptSuggestionCard: ({ text }: { text: string }) => <p>{text}</p>,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { default: PromptsPage } = await import('./page');

/** The API: /prompts/from-topics answers 400 past its limits, as the server's schema does. */
const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
  if (!url.endsWith('/api/prompts/from-topics')) {
    return { ok: true, json: async () => ({ prompts: [] }) };
  }
  const body = JSON.parse(init?.body ?? '{}');
  const ok =
    body.topics.length <= 20 &&
    body.brandName.length <= 200 &&
    (body.industry ?? '').length <= 200 &&
    (body.description ?? '').length <= 2000;
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () =>
      ok
        ? {
            topicPrompts: body.topics.map((topic: string) => ({
              topic,
              prompts: [`best ${topic}`],
            })),
          }
        : { error: 'Invalid request' },
  };
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  fetchMock.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a brand's Prompts page", () => {
  it('generates prompts for every topic of a brand with more than one call takes', async () => {
    await act(async () => root.render(<PromptsPage />));
    expect(container.textContent).toContain('21 topics selected');

    const generate = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Generate Prompts',
    );
    await act(async () => generate?.click());

    const calls = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/api/prompts/from-topics'))
      .map(([, init]) => JSON.parse(init?.body ?? '{}'));
    expect(calls.map((body) => body.topics.length)).toEqual([20, 1]);
    for (const body of calls) {
      expect(body.description).toHaveLength(2000);
      expect(body.industry).toBe('Coffee');
    }
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('21 prompt suggestions generated!');
    expect(container.textContent).toContain('best topic 1');
    expect(container.textContent).toContain('best topic 21');
  });
});
