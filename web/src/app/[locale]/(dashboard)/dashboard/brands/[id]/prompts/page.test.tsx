import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Manage prompts on a read-only workspace (plan not active): AI Generate and
 * a prompt's Include toggle open the upgrade dialog instead of running.
 */

const actions = vi.hoisted(() => ({
  getPromptSets: vi.fn(),
  savePromptSet: vi.fn(),
  addPromptToSet: vi.fn(),
  setPromptActive: vi.fn(),
  updatePrompt: vi.fn(),
  updatePromptLocations: vi.fn(),
  bulkUpdatePromptLocations: vi.fn(),
  getLocationQuota: vi.fn(async () => null),
  deletePrompt: vi.fn(),
}));
vi.mock('@/lib/actions/prompt', () => actions);
vi.mock('@/lib/actions/brand', () => ({
  getBrandById: vi.fn(async () => ({ id: 'b1', name: 'Acme', shoppingModeEnabled: false })),
}));
vi.mock('@/lib/actions/topic', () => ({
  getTopics: vi.fn(async () => [
    { id: 't1', brandId: 'b1', name: 'Coffee', isActive: true, createdAt: '2026-10-01' },
  ]),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'b1' }) }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => ({ canManage: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: ManagePromptsPage } = await import('./page');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const fetchMock = vi.fn();

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ManagePromptsPage />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
}

const button = (name: string) =>
  [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name,
  )!;
const include = () =>
  container.querySelector<HTMLButtonElement>(
    '[role="checkbox"][aria-label="Include this prompt"]',
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  actions.getPromptSets.mockResolvedValue([
    {
      id: 'set-1',
      prompts: [
        {
          id: 'p1',
          promptSetId: 'set-1',
          text: 'Best coffee subscription?',
          category: 'Coffee',
          platforms: ['chatgpt'],
          regions: ['US'],
          models: [],
          isActive: true,
          workStatus: null,
          targetUrlCount: 0,
          citedUrlCount: 0,
          createdAt: '2026-10-01T00:00:00.000Z',
        },
      ],
    },
  ]);
  actions.setPromptActive.mockResolvedValue({ success: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Manage prompts on a read-only workspace', () => {
  it('generates nothing and pauses nothing, and says why', async () => {
    await render(true);
    await act(async () => button('Generate Prompts').click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Generating prompts needs a plan');
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => include().click());
    expect(openUpgrade).toHaveBeenLastCalledWith('Pausing prompts needs a plan');
    expect(openUpgrade).toHaveBeenCalledTimes(2);
    expect(actions.setPromptActive).not.toHaveBeenCalled();
  });

  it('pauses a prompt on an active plan', async () => {
    await render(false);
    await act(async () => include().click());
    expect(actions.setPromptActive).toHaveBeenCalledWith('p1', false);
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
